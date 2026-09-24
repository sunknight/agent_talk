/**
 * 存储层 — SQLite（node:sqlite）+ 内容寻址 blob 文件。
 * 结构化数据（用户/圆桌/席位/用户↔席位归属/token/邀请/消息/请求/产物/文档/审计）
 * 落 <dataDir>/roundtable.db；文档与产物版本内容落 <dataDir>/blobs/<sha256>，库内只存元数据与 hash。
 * 旧格式 state.json：构造时发现且库为空 → 自动迁移（migrateLegacy），成功后改名 .migrated 备份。
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { sha256, tableTypeOf, type AuditRecord, type Envelope, type PauseInfo, type SeatInfo, type TableSummary } from "@rt/shared";
import type { ArtifactRecord, DirectiveRecord, ModelCallLogRecord, OwnerDirectiveRecord, PauseRequestRecord, RequestRecord, StoredArtifactVersion, StoredMsg, TableDocumentRecord, TableMeta } from "./model";

const SCHEMA_VERSION = 1;

const DDL = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'user', disabled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tables (
  table_id TEXT PRIMARY KEY, topic TEXT NOT NULL, template TEXT NOT NULL, goals TEXT NOT NULL,
  deliverables TEXT NOT NULL, rules TEXT NOT NULL, role_plan TEXT NOT NULL, owner_seat TEXT NOT NULL,
  phase TEXT NOT NULL, round_no INTEGER NOT NULL, deadlock_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL, closed_at INTEGER, seat_count INTEGER NOT NULL,
  max_review_rounds INTEGER NOT NULL, turn_timeout_ms INTEGER NOT NULL,
  mode TEXT NOT NULL DEFAULT 'self',
  table_type TEXT NOT NULL DEFAULT 'review');
CREATE TABLE IF NOT EXISTS seats (
  table_id TEXT NOT NULL, seat_id TEXT NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY (table_id, seat_id));
CREATE TABLE IF NOT EXISTS seat_tokens (token_hash TEXT PRIMARY KEY, table_id TEXT NOT NULL, seat_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS seat_owners (
  table_id TEXT NOT NULL, seat_id TEXT NOT NULL, user_id TEXT NOT NULL,
  PRIMARY KEY (table_id, seat_id));
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY, table_id TEXT NOT NULL, role TEXT NOT NULL,
  expires_at INTEGER NOT NULL, uses_left INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS messages (
  table_id TEXT NOT NULL, seq INTEGER NOT NULL, msg_id TEXT NOT NULL UNIQUE,
  from_seat TEXT NOT NULL, to_seat TEXT NOT NULL, type TEXT NOT NULL, ts INTEGER NOT NULL,
  flags TEXT, payload TEXT NOT NULL, sig TEXT,
  PRIMARY KEY (table_id, seq));
CREATE TABLE IF NOT EXISTS requests (
  table_id TEXT NOT NULL, request_id TEXT NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY (table_id, request_id));
CREATE TABLE IF NOT EXISTS artifacts (
  table_id TEXT NOT NULL, artifact_id TEXT NOT NULL, name TEXT NOT NULL, format TEXT NOT NULL,
  owner_seat TEXT NOT NULL, locked_by TEXT, locked_at INTEGER,
  PRIMARY KEY (table_id, artifact_id));
CREATE TABLE IF NOT EXISTS artifact_versions (
  table_id TEXT NOT NULL, artifact_id TEXT NOT NULL, v INTEGER NOT NULL,
  sha256 TEXT NOT NULL, size INTEGER NOT NULL, change_note TEXT NOT NULL,
  published_by TEXT NOT NULL, ts INTEGER NOT NULL, diff_from_prev TEXT, request_id TEXT, request_ids TEXT,
  PRIMARY KEY (table_id, artifact_id, v));
CREATE TABLE IF NOT EXISTS documents (
  table_id TEXT NOT NULL, doc_id TEXT NOT NULL, name TEXT NOT NULL, purpose TEXT NOT NULL,
  visibility TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL,
  uploaded_by TEXT NOT NULL, uploaded_at INTEGER NOT NULL,
  PRIMARY KEY (table_id, doc_id));
CREATE TABLE IF NOT EXISTS audit (
  id TEXT PRIMARY KEY, ts INTEGER NOT NULL, table_id TEXT NOT NULL, seat_id TEXT NOT NULL,
  event TEXT NOT NULL, detail TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS directives (
  table_id TEXT NOT NULL, directive_id TEXT NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY (table_id, directive_id));
CREATE TABLE IF NOT EXISTS pause_requests (
  table_id TEXT NOT NULL, request_id TEXT NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY (table_id, request_id));
CREATE TABLE IF NOT EXISTS owner_directives (
  table_id TEXT NOT NULL, directive_id TEXT NOT NULL, seat_id TEXT NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY (table_id, directive_id));
CREATE TABLE IF NOT EXISTS login_links (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER);
CREATE TABLE IF NOT EXISTS user_tokens (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS user_table_prefs (
  user_id TEXT NOT NULL, table_id TEXT NOT NULL, chat_sides TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (user_id, table_id));
CREATE TABLE IF NOT EXISTS model_call_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL, time TEXT NOT NULL,
  provider TEXT NOT NULL, purpose TEXT NOT NULL, table_id TEXT,
  model TEXT NOT NULL, url TEXT NOT NULL,
  status INTEGER NOT NULL, ok INTEGER NOT NULL, duration_ms INTEGER NOT NULL,
  usage TEXT, request TEXT NOT NULL, response TEXT, error TEXT);
`;

/** node:sqlite 行类型（.get/.all 返回的原样记录） */
type Row = Record<string, string | number | bigint | null>;

/** 旧 state.json 的实体形状（迁移用；版本/文档内容仍是 contentBase64） */
interface LegacyState {
  users: Record<string, { userId: string; name: string; tokenHash: string; createdAt: number; role?: "user" | "systemadmin"; disabled?: boolean }>;
  tables: Record<string, TableMeta>;
  seats: Record<string, SeatInfo>;
  artifacts: Record<string, { artifactId: string; tableId: string; name: string; format: string; ownerSeat: string; versions: Array<{ v: number; contentBase64: string; changeNote: string; publishedBy: string; ts: number; size: number; diffFromPrev?: string; requestId?: string }>; lockedBy: string | null; lockedAt?: number }>;
  documents: Record<string, Array<{ docId: string; name: string; purpose: string; visibility: string; contentBase64: string; size: number; uploadedBy: string; uploadedAt: number }>>;
  invites: Record<string, { code: string; tableId: string; role: string; expiresAt: number; usesLeft: number }>;
  messages: Record<string, StoredMsg[]>;
  requests: Record<string, RequestRecord[]> | RequestRecord[];
  audit: AuditRecord[];
  seatTokens: Record<string, { tableId: string; seatId: string }>;
  seatOwners: Record<string, string>;
}

const J = (v: unknown) => JSON.stringify(v);
const nullable = (v: string | number | null | undefined) => (v === undefined ? null : v);

export class Store extends EventEmitter {
  private readonly db: DatabaseSync;
  private readonly dataDir: string;
  private readonly blobDir: string;
  private readonly st: {
    [K: string]: ReturnType<DatabaseSync["prepare"]>;
  };

  constructor(dataDir: string) {
    super();
    mkdirSync(dataDir, { recursive: true });
    this.dataDir = dataDir;
    this.blobDir = join(dataDir, "blobs");
    mkdirSync(this.blobDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, "roundtable.db"));
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec(DDL);
    this.migrateSchema();
    this.st = {
      metaGet: this.db.prepare("SELECT value FROM meta WHERE key = ?"),
      metaSet: this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)"),

      userInsert: this.db.prepare("INSERT INTO users (user_id, name, token_hash, role, disabled, created_at) VALUES (?, ?, ?, ?, ?, ?)"),
      userByToken: this.db.prepare("SELECT * FROM users WHERE token_hash = ?"),
      userById: this.db.prepare("SELECT * FROM users WHERE user_id = ?"),
      userAll: this.db.prepare("SELECT * FROM users ORDER BY created_at, rowid"),
      userSetRole: this.db.prepare("UPDATE users SET role = ? WHERE user_id = ?"),
      userSetDisabled: this.db.prepare("UPDATE users SET disabled = ? WHERE user_id = ?"),

      loginLinkInsert: this.db.prepare("INSERT INTO login_links (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"),
      loginLinkConsume: this.db.prepare("UPDATE login_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?"),
      loginLinkUserId: this.db.prepare("SELECT user_id FROM login_links WHERE token_hash = ?"),
      loginLinkCleanup: this.db.prepare("DELETE FROM login_links WHERE expires_at < ? OR used_at IS NOT NULL"),
      webTokenInsert: this.db.prepare("INSERT INTO user_tokens (token_hash, user_id, created_at) VALUES (?, ?, ?)"),
      webTokenUserByHash: this.db.prepare("SELECT u.* FROM user_tokens t JOIN users u ON u.user_id = t.user_id WHERE t.token_hash = ?"),
      webTokenDeleteOfUser: this.db.prepare("DELETE FROM user_tokens WHERE user_id = ?"),

      prefChatSidesGet: this.db.prepare("SELECT chat_sides FROM user_table_prefs WHERE user_id = ? AND table_id = ?"),
      prefChatSidesSet: this.db.prepare("INSERT OR REPLACE INTO user_table_prefs (user_id, table_id, chat_sides) VALUES (?, ?, ?)"),
      prefDeleteOfTable: this.db.prepare("DELETE FROM user_table_prefs WHERE table_id = ?"),

      modelCallInsert: this.db.prepare(
        "INSERT INTO model_call_logs (ts, time, provider, purpose, table_id, model, url, status, ok, duration_ms, usage, request, response, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
      modelCallAll: this.db.prepare("SELECT * FROM model_call_logs ORDER BY id"),
      modelCallOfTable: this.db.prepare("SELECT * FROM model_call_logs WHERE table_id = ? ORDER BY id"),
      modelCallDeleteOfTable: this.db.prepare("DELETE FROM model_call_logs WHERE table_id = ?"),

      tableUpsert: this.db.prepare(`INSERT OR REPLACE INTO tables VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      tableGet: this.db.prepare("SELECT * FROM tables WHERE table_id = ?"),
      tableAll: this.db.prepare("SELECT * FROM tables ORDER BY rowid"),

      seatUpsert: this.db.prepare("INSERT OR REPLACE INTO seats (table_id, seat_id, data) VALUES (?, ?, ?)"),
      seatsOfTable: this.db.prepare("SELECT * FROM seats WHERE table_id = ? ORDER BY rowid"),
      seatGet: this.db.prepare("SELECT * FROM seats WHERE table_id = ? AND seat_id = ?"),

      seatTokenUpsert: this.db.prepare("INSERT OR REPLACE INTO seat_tokens (token_hash, table_id, seat_id) VALUES (?, ?, ?)"),
      seatTokenByHash: this.db.prepare("SELECT * FROM seat_tokens WHERE token_hash = ?"),
      seatTokenRevoke: this.db.prepare("DELETE FROM seat_tokens WHERE table_id = ? AND seat_id = ?"),

      ownerUpsert: this.db.prepare("INSERT OR REPLACE INTO seat_owners (table_id, seat_id, user_id) VALUES (?, ?, ?)"),
      ownerGet: this.db.prepare("SELECT user_id FROM seat_owners WHERE table_id = ? AND seat_id = ?"),
      ownerSeatsOfUserInTable: this.db.prepare("SELECT seat_id FROM seat_owners WHERE table_id = ? AND user_id = ? ORDER BY rowid"),
      ownersByUser: this.db.prepare("SELECT table_id, seat_id FROM seat_owners WHERE user_id = ? ORDER BY rowid"),

      inviteUpsert: this.db.prepare("INSERT OR REPLACE INTO invites (code, table_id, role, expires_at, uses_left) VALUES (?, ?, ?, ?, ?)"),
      inviteGet: this.db.prepare("SELECT * FROM invites WHERE code = ?"),
      inviteDecr: this.db.prepare("UPDATE invites SET uses_left = uses_left - 1 WHERE code = ?"),
      invitesOfTable: this.db.prepare("SELECT * FROM invites WHERE table_id = ? ORDER BY rowid"),

      msgNextSeq: this.db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS s FROM messages WHERE table_id = ?"),
      msgInsert: this.db.prepare("INSERT INTO messages (table_id, seq, msg_id, from_seat, to_seat, type, ts, flags, payload, sig) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
      msgsAll: this.db.prepare("SELECT * FROM messages WHERE table_id = ? ORDER BY seq"),
      msgsSince: this.db.prepare("SELECT * FROM messages WHERE table_id = ? AND seq > ? ORDER BY seq"),
      msgLatestSeq: this.db.prepare("SELECT COALESCE(MAX(seq), 0) AS s FROM messages WHERE table_id = ?"),

      reqUpsert: this.db.prepare("INSERT OR REPLACE INTO requests (table_id, request_id, data) VALUES (?, ?, ?)"),
      reqsOfTable: this.db.prepare("SELECT * FROM requests WHERE table_id = ? ORDER BY rowid"),

      artUpsert: this.db.prepare("INSERT OR REPLACE INTO artifacts (table_id, artifact_id, name, format, owner_seat, locked_by, locked_at) VALUES (?, ?, ?, ?, ?, ?, ?)"),
      verUpsert: this.db.prepare("INSERT OR REPLACE INTO artifact_versions (table_id, artifact_id, v, sha256, size, change_note, published_by, ts, diff_from_prev, request_id, request_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
      artGet: this.db.prepare("SELECT * FROM artifacts WHERE table_id = ? AND artifact_id = ?"),
      artAll: this.db.prepare("SELECT * FROM artifacts WHERE table_id = ? ORDER BY rowid"),
      verAll: this.db.prepare("SELECT * FROM artifact_versions WHERE table_id = ? ORDER BY artifact_id, v"),

      docUpsert: this.db.prepare("INSERT OR REPLACE INTO documents (table_id, doc_id, name, purpose, visibility, size, sha256, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"),
      docAll: this.db.prepare("SELECT * FROM documents WHERE table_id = ? ORDER BY rowid"),
      docGet: this.db.prepare("SELECT * FROM documents WHERE table_id = ? AND doc_id = ?"),

      auditInsert: this.db.prepare("INSERT INTO audit (id, ts, table_id, seat_id, event, detail) VALUES (?, ?, ?, ?, ?, ?)"),
      auditRecent: this.db.prepare("SELECT * FROM audit ORDER BY ts DESC, rowid DESC LIMIT ?"),

      dirUpsert: this.db.prepare("INSERT OR REPLACE INTO directives (table_id, directive_id, data) VALUES (?, ?, ?)"),
      dirsOfTable: this.db.prepare("SELECT * FROM directives WHERE table_id = ? ORDER BY rowid"),

      pauseReqUpsert: this.db.prepare("INSERT OR REPLACE INTO pause_requests (table_id, request_id, data) VALUES (?, ?, ?)"),
      pauseReqsOfTable: this.db.prepare("SELECT * FROM pause_requests WHERE table_id = ? ORDER BY rowid"),

      ownerDirInsert: this.db.prepare("INSERT OR REPLACE INTO owner_directives (table_id, directive_id, seat_id, data) VALUES (?, ?, ?, ?)"),
      ownerDirsOfSeat: this.db.prepare("SELECT * FROM owner_directives WHERE table_id = ? AND seat_id = ? ORDER BY rowid"),
      ownerDirGet: this.db.prepare("SELECT * FROM owner_directives WHERE table_id = ? AND directive_id = ?"),

      counts: this.db.prepare("SELECT (SELECT COUNT(*) FROM users) + (SELECT COUNT(*) FROM tables) + (SELECT COUNT(*) FROM messages) + (SELECT COUNT(*) FROM documents) AS n"),
    };
    const cur = (this.st.metaGet.get("schema_version") as Row | undefined)?.value;
    if (cur === undefined) this.st.metaSet.run("schema_version", String(SCHEMA_VERSION));
    this.migrateLegacy();
  }

  // ---------- meta ----------
  private getMeta(key: string): string | null {
    const r = this.st.metaGet.get(key) as Row | undefined;
    return (r?.value as string | undefined) ?? null;
  }
  private setMeta(key: string, value: string) { this.st.metaSet.run(key, value); }

  private dbIsEmpty(): boolean {
    return Number((this.st.counts.get() as Row).n) === 0;
  }

  /** 轻量加列迁移：已存在的库无损升级（列已存在时 ALTER 报错，吞掉即可） */
  private migrateSchema() {
    try {
      this.db.exec("ALTER TABLE artifact_versions ADD COLUMN request_ids TEXT");
    } catch { /* duplicate column：已是新 schema */ }
    try {
      this.db.exec("ALTER TABLE tables ADD COLUMN mode TEXT NOT NULL DEFAULT 'self'");
    } catch { /* duplicate column：已是新 schema */ }
    try {
      this.db.exec("ALTER TABLE tables ADD COLUMN table_type TEXT NOT NULL DEFAULT 'review'");
    } catch { /* duplicate column：已是新 schema */ }
    try {
      this.db.exec("ALTER TABLE tables ADD COLUMN paused TEXT");
    } catch { /* duplicate column：已是新 schema */ }
    try {
      this.db.exec("ALTER TABLE tables ADD COLUMN precheck_enabled INTEGER NOT NULL DEFAULT 1");
    } catch { /* duplicate column：已是新 schema */ }
  }

  // ---------- 旧 state.json 自动迁移 ----------
  private migrateLegacy() {
    const legacyFile = join(this.dataDir, "state.json");
    if (!existsSync(legacyFile)) return;
    if (!this.dbIsEmpty() || this.getMeta("migrated_from_state_json")) {
      if (!this.getMeta("migrated_from_state_json")) {
        process.stderr.write(`[store] ${legacyFile} 存在但 SQLite 库非空：忽略旧文件（如需重新迁移请先清空 roundtable.db）\n`);
      }
      return;
    }
    const raw = JSON.parse(readFileSync(legacyFile, "utf8")) as Partial<LegacyState>;
    const legacy: LegacyState = {
      users: raw.users ?? {}, tables: raw.tables ?? {}, seats: raw.seats ?? {}, artifacts: raw.artifacts ?? {},
      documents: raw.documents ?? {}, invites: raw.invites ?? {}, messages: raw.messages ?? {},
      requests: raw.requests ?? {}, audit: raw.audit ?? [], seatTokens: raw.seatTokens ?? {}, seatOwners: raw.seatOwners ?? {},
    };
    // blob 先落盘（库事务外）：失败直接中止启动，不留半迁移库
    const artVerHash = new Map<string, string>();
    for (const a of Object.values(legacy.artifacts)) {
      for (const v of a.versions) artVerHash.set(`${a.tableId}:${a.artifactId}:${v.v}`, this.saveBlob(v.contentBase64));
    }
    const docHash = new Map<string, string>();
    for (const [tid, docs] of Object.entries(legacy.documents)) {
      for (const d of docs) docHash.set(`${tid}:${d.docId}`, this.saveBlob(d.contentBase64));
    }
    try {
      this.db.exec("BEGIN");
      for (const u of Object.values(legacy.users)) {
        this.st.userInsert.run(u.userId, u.name, u.tokenHash, u.role ?? "user", u.disabled ? 1 : 0, u.createdAt);
      }
      for (const t of Object.values(legacy.tables)) this.upsertTableRow(t);
      for (const [k, s] of Object.entries(legacy.seats)) {
        const i = k.indexOf(":");
        this.st.seatUpsert.run(k.slice(0, i), k.slice(i + 1), J(s));
      }
      for (const a of Object.values(legacy.artifacts)) {
        this.st.artUpsert.run(a.tableId, a.artifactId, a.name, a.format, a.ownerSeat, nullable(a.lockedBy), nullable(a.lockedAt));
        for (const v of a.versions) {
          this.st.verUpsert.run(a.tableId, a.artifactId, v.v, artVerHash.get(`${a.tableId}:${a.artifactId}:${v.v}`)!, v.size, v.changeNote, v.publishedBy, v.ts, nullable(v.diffFromPrev), nullable(v.requestId), null);
        }
      }
      for (const [tid, docs] of Object.entries(legacy.documents)) {
        for (const d of docs) {
          this.st.docUpsert.run(tid, d.docId, d.name, d.purpose, d.visibility, d.size, docHash.get(`${tid}:${d.docId}`)!, d.uploadedBy, d.uploadedAt);
        }
      }
      for (const inv of Object.values(legacy.invites)) {
        this.st.inviteUpsert.run(inv.code, inv.tableId, inv.role, inv.expiresAt, inv.usesLeft);
      }
      for (const [tid, msgs] of Object.entries(legacy.messages)) {
        for (const m of msgs) {
          this.st.msgInsert.run(tid, m.seq, m.msgId, m.fromSeat, m.toSeat, m.type, m.ts, m.flags ? J(m.flags) : null, J(m.payload), nullable(m.sig));
        }
      }
      const reqLists = Array.isArray(legacy.requests) ? [] : Object.entries(legacy.requests);
      for (const [tid, reqs] of reqLists) {
        for (const r of reqs) this.st.reqUpsert.run(tid, r.req.requestId, J(r));
      }
      for (const a of legacy.audit) {
        this.st.auditInsert.run(a.id, a.ts, a.tableId, a.seatId, a.event, J(a.detail));
      }
      for (const [h, t] of Object.entries(legacy.seatTokens)) {
        this.st.seatTokenUpsert.run(h, t.tableId, t.seatId);
      }
      for (const [k, userId] of Object.entries(legacy.seatOwners)) {
        const i = k.indexOf(":");
        this.st.ownerUpsert.run(k.slice(0, i), k.slice(i + 1), userId);
      }
      this.setMeta("migrated_from_state_json", new Date().toISOString());
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw new Error(`旧 state.json 迁移失败（库已回滚，未破坏原文件）：${String(e)}`);
    }
    renameSync(legacyFile, `${legacyFile}.migrated`);
    process.stdout.write(`[store] 旧 state.json 已迁移至 SQLite + blobs，原文件备份为 state.json.migrated\n`);
  }

  // ---------- blob（文档/产物内容：sha256 内容寻址，天然去重） ----------
  saveBlob(contentBase64: string): string {
    const buf = Buffer.from(contentBase64, "base64");
    const hash = createHash("sha256").update(buf).digest("hex");
    const file = join(this.blobDir, hash);
    if (!existsSync(file)) {
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(tmp, buf);
      renameSync(tmp, file);
    }
    return hash;
  }
  readBlob(hash: string): Buffer {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`非法 blob hash：${hash}`);
    const file = join(this.blobDir, hash);
    if (!existsSync(file)) throw new Error(`blob 文件缺失：${hash}`);
    return readFileSync(file);
  }

  // ---------- users ----------
  addUser(name: string, tokenHash: string): string {
    const userId = `u_${randomBytes(4).toString("hex")}`; // crypto 随机（Math.random 可预测且理论撞库）
    this.st.userInsert.run(userId, name, tokenHash, "user", 0, Date.now());
    return userId;
  }
  private rowUser(r: Row): { userId: string; name: string; role: "user" | "systemadmin"; disabled: boolean; createdAt: number } {
    return { userId: String(r.user_id), name: String(r.name), role: (r.role as "user" | "systemadmin") ?? "user", disabled: Number(r.disabled) === 1, createdAt: Number(r.created_at) };
  }
  findUserByToken(token: string): { userId: string; name: string; role: "user" | "systemadmin"; disabled: boolean } | null {
    const h = sha256(token);
    const r = this.st.userByToken.get(h) as Row | undefined;
    // 并行登录 token（网页登录链接兑换签发）：与主 token 同权，用户状态实时跟随 users 行
    const row = r ?? (this.st.webTokenUserByHash.get(h) as Row | undefined);
    if (!row) return null;
    const u = this.rowUser(row);
    return { userId: u.userId, name: u.name, role: u.role, disabled: u.disabled };
  }
  listUsers(): Array<{ userId: string; name: string; role: "user" | "systemadmin"; disabled: boolean; createdAt: number }> {
    return (this.st.userAll.all() as Row[]).map((r) => this.rowUser(r));
  }
  getUser(userId: string): { userId: string; name: string; role: "user" | "systemadmin"; disabled: boolean } | null {
    const r = this.st.userById.get(userId) as Row | undefined;
    return r ? this.rowUser(r) : null;
  }
  setUserRole(userId: string, role: "user" | "systemadmin") {
    return this.st.userSetRole.run(role, userId).changes > 0;
  }
  /** 管理台强制下线：禁用后该用户 token 全部失效（席位 token 独立，不受影响） */
  setUserDisabled(userId: string, disabled: boolean) {
    return this.st.userSetDisabled.run(disabled ? 1 : 0, userId).changes > 0;
  }
  /** 重签用户登录 token（原始 token 只存 hash 不可取回，恢复登录 = 换新 token） */
  resetUserToken(userId: string, tokenHash: string) {
    return this.db.prepare("UPDATE users SET token_hash = ? WHERE user_id = ?").run(tokenHash, userId).changes > 0;
  }

  // ---------- 网页登录链接（agent 生成 → 持有人一键登录；一次性 + 短时效） ----------

  /** 新链接入库；顺带清理全表已用/过期链接，保持表小（生成是低频操作） */
  addLoginLink(tokenHash: string, userId: string, expiresAt: number) {
    this.st.loginLinkCleanup.run(Date.now());
    this.st.loginLinkInsert.run(tokenHash, userId, Date.now(), expiresAt);
  }
  /**
   * 原子消费链接：UPDATE 仅在「未用且未过期」时命中（并发下恰好一个请求 changes>0）。
   * 返回关联 userId；无效/已用/过期返回 null。
   */
  consumeLoginLink(tokenHash: string): string | null {
    const changes = this.st.loginLinkConsume.run(Date.now(), tokenHash, Date.now()).changes;
    if (changes === 0) return null;
    const r = this.st.loginLinkUserId.get(tokenHash) as Row | undefined;
    return r ? String(r.user_id) : null;
  }

  /** 登录链接兑换签发的并行 token（不动 users 主 token，agent 侧凭证不受影响） */
  addUserToken(userId: string, tokenHash: string) {
    this.st.webTokenInsert.run(tokenHash, userId, Date.now());
  }
  /** 清除某用户的全部并行 token（重签主 token 时联动：旧网页登录凭证一并失效） */
  deleteUserTokensOf(userId: string) {
    this.st.webTokenDeleteOfUser.run(userId);
  }

  /** 用户参桌索引：seatOwners 反查（管理台参桌明细用） */
  seatsOfUser(userId: string): Array<{ tableId: string; seatId: string }> {
    return (this.st.ownersByUser.all(userId) as Row[]).map((r) => ({ tableId: String(r.table_id), seatId: String(r.seat_id) }));
  }

  // ---------- user_table_prefs（观察端个人视图偏好：chatbox 左右侧） ----------
  /** 某用户在某桌的左右侧覆盖表 { seatId|'asker': 'L'|'R' }；坏数据容错回空（个人视图偏好不拖垮详情页） */
  getChatSides(tableId: string, userId: string): Record<string, string> {
    const r = this.st.prefChatSidesGet.get(userId, tableId) as Row | undefined;
    if (!r) return {};
    try {
      const m = JSON.parse(String(r.chat_sides)) as Record<string, unknown>;
      if (typeof m !== "object" || m === null || Array.isArray(m)) return {};
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(m)) if (v === "L" || v === "R") out[k] = v;
      return out;
    } catch { return {}; }
  }
  setChatSides(tableId: string, userId: string, sides: Record<string, string>) {
    this.st.prefChatSidesSet.run(userId, tableId, J(sides));
  }

  /** 删除圆桌：连带清理全部关联数据（blob 内容寻址不可变，不随删；GC 见维护项） */
  deleteTable(tableId: string) {
    // 单事务：中途失败整体回滚，不留半删的脏关联数据
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM tables WHERE table_id = ?").run(tableId);
      this.db.prepare("DELETE FROM seats WHERE table_id = ?").run(tableId);
      this.db.prepare("DELETE FROM seat_owners WHERE table_id = ?").run(tableId);
      this.db.prepare("DELETE FROM seat_tokens WHERE table_id = ?").run(tableId);
      this.db.prepare("DELETE FROM invites WHERE table_id = ?").run(tableId);
      this.db.prepare("DELETE FROM messages WHERE table_id = ?").run(tableId);
      this.db.prepare("DELETE FROM requests WHERE table_id = ?").run(tableId);
      this.db.prepare("DELETE FROM artifact_versions WHERE table_id = ?").run(tableId);
      this.db.prepare("DELETE FROM artifacts WHERE table_id = ?").run(tableId);
      this.db.prepare("DELETE FROM documents WHERE table_id = ?").run(tableId);
      this.db.prepare("DELETE FROM directives WHERE table_id = ?").run(tableId);
      this.db.prepare("DELETE FROM pause_requests WHERE table_id = ?").run(tableId);
      this.st.prefDeleteOfTable.run(tableId);
      this.st.modelCallDeleteOfTable.run(tableId);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  // ---------- tables ----------
  private upsertTableRow(t: TableMeta) {
    this.st.tableUpsert.run(
      t.tableId, t.topic, t.template, t.goals, t.deliverables, t.rules, t.rolePlan, t.ownerSeat,
      t.phase, t.roundNo, t.deadlockCount, t.createdAt, nullable(t.closedAt), t.seatCount, t.maxReviewRounds, t.turnTimeoutMs,
      t.mode ?? "self",
      t.tableType ?? "review",
      t.pause ? J(t.pause) : null,
      t.precheckEnabled === false ? 0 : 1,
    );
  }
  /** paused 列（PauseInfo JSON）→ 结构化；坏数据（手改库）按未暂停处理，不让单行脏数据拖垮启动 */
  private static rowPause(v: string | number | bigint | null | undefined): PauseInfo | null {
    if (v === null || v === undefined || String(v) === "") return null;
    try {
      const p = JSON.parse(String(v)) as PauseInfo;
      return typeof p === "object" && p !== null && typeof p.pausedAt === "number" && (p.via === "direct" || p.via === "request")
        ? p
        : null;
    } catch { return null; }
  }
  private rowTable(r: Row): TableMeta {
    return {
      tableId: String(r.table_id), topic: String(r.topic), template: String(r.template) as TableMeta["template"],
      tableType: tableTypeOf(String(r.table_type ?? "review")).id,
      goals: String(r.goals), deliverables: String(r.deliverables), rules: String(r.rules), rolePlan: String(r.role_plan),
      ownerSeat: String(r.owner_seat), phase: String(r.phase) as TableMeta["phase"], roundNo: Number(r.round_no),
      deadlockCount: Number(r.deadlock_count), createdAt: Number(r.created_at),
      ...(r.closed_at === null ? {} : { closedAt: Number(r.closed_at) }),
      seatCount: Number(r.seat_count), maxReviewRounds: Number(r.max_review_rounds), turnTimeoutMs: Number(r.turn_timeout_ms),
      mode: r.mode === "hosted" ? "hosted" : "self",
      pause: Store.rowPause(r.paused),
      precheckEnabled: Number(r.precheck_enabled ?? 1) !== 0,
    };
  }
  saveTable(meta: TableMeta) { this.upsertTableRow(meta); }
  getTable(tableId: string): TableMeta | null {
    const r = this.st.tableGet.get(tableId) as Row | undefined;
    return r ? this.rowTable(r) : null;
  }
  listTableMetas(): TableMeta[] { return (this.st.tableAll.all() as Row[]).map((r) => this.rowTable(r)); }
  listTables(): TableSummary[] {
    return (this.st.tableAll.all() as Row[])
      .sort((a, b) => Number(b.created_at) - Number(a.created_at))
      .map((r) => {
        const t = this.rowTable(r);
        return { tableId: t.tableId, topic: t.topic, template: t.template, phase: t.phase, tableType: t.tableType, ownerSeat: t.ownerSeat, seatCount: t.seatCount, createdAt: t.createdAt, paused: !!t.pause };
      });
  }

  // ---------- seats ----------
  saveSeat(tableId: string, seat: SeatInfo) { this.st.seatUpsert.run(tableId, seat.seatId, J(seat)); }
  getSeats(tableId: string): SeatInfo[] {
    return (this.st.seatsOfTable.all(tableId) as Row[]).map((r) => JSON.parse(String(r.data)) as SeatInfo);
  }
  getSeat(tableId: string, seatId: string): SeatInfo | null {
    const r = this.st.seatGet.get(tableId, seatId) as Row | undefined;
    return r ? JSON.parse(String(r.data)) as SeatInfo : null;
  }

  // ---------- seat tokens ----------
  saveSeatToken(token: string, tableId: string, seatId: string) {
    this.st.seatTokenUpsert.run(sha256(token), tableId, seatId);
  }
  findSeatByToken(token: string): { tableId: string; seatId: string } | null {
    const r = this.st.seatTokenByHash.get(sha256(token)) as Row | undefined;
    return r ? { tableId: String(r.table_id), seatId: String(r.seat_id) } : null;
  }
  /** 吊销某席位的全部 token（agent 替代场景：原 agent 立即失去访问权） */
  revokeSeatTokens(tableId: string, seatId: string) {
    this.st.seatTokenRevoke.run(tableId, seatId);
  }

  // ---------- seat owners（观察端：user ↔ 席位归属） ----------
  bindSeatOwner(tableId: string, seatId: string, userId: string) {
    this.st.ownerUpsert.run(tableId, seatId, userId);
  }
  seatOwnerOf(tableId: string, seatId: string): string | null {
    const r = this.st.ownerGet.get(tableId, seatId) as Row | undefined;
    return r ? String(r.user_id) : null;
  }
  seatOfUser(tableId: string, userId: string): string | null {
    const rows = (this.st.ownerSeatsOfUserInTable.all(tableId, userId) as Row[]);
    if (!rows.length) return null;
    // 用户退席后可重新入席（多行 owner 并存）：优先返回非 left 的 active 席位，
    // 否则 LIMIT 1 会命中旧 left 席，令 my 通道 / 列表可见性 / 防重复入席全部错判
    for (const r of rows) {
      const seatId = String(r.seat_id);
      const seatRow = this.st.seatGet.get(tableId, seatId) as Row | undefined;
      if (seatRow) {
        const status = (JSON.parse(String(seatRow.data)) as SeatInfo).status;
        if (status !== "left") return seatId;
      }
    }
    return String(rows[0].seat_id);
  }
  invitesOfTable(tableId: string) {
    return (this.st.invitesOfTable.all(tableId) as Row[]).map((r) => ({
      code: String(r.code), tableId: String(r.table_id), role: String(r.role),
      expiresAt: Number(r.expires_at), usesLeft: Number(r.uses_left),
    }));
  }

  // ---------- directives（预审点名补充指令） ----------
  saveDirective(rec: DirectiveRecord) {
    this.st.dirUpsert.run(rec.tableId, rec.directiveId, J(rec));
  }
  getDirectives(tableId: string): DirectiveRecord[] {
    return (this.st.dirsOfTable.all(tableId) as Row[]).map((r) => JSON.parse(String(r.data)) as DirectiveRecord);
  }
  /** 当前挂起的点名指令（同一时刻至多一条） */
  pendingDirective(tableId: string): DirectiveRecord | null {
    const pend = this.getDirectives(tableId).filter((d) => d.status === "pending");
    return pend.length ? pend[pend.length - 1] : null;
  }

  // ---------- model_call_logs（预审模型调用审计） ----------
  saveModelCallLog(rec: ModelCallLogRecord) {
    this.st.modelCallInsert.run(
      rec.ts, rec.time, rec.provider, rec.purpose, rec.tableId ?? null, rec.model, rec.url,
      rec.status, rec.ok ? 1 : 0, rec.durationMs,
      rec.usage === undefined ? null : J(rec.usage), J(rec.request),
      rec.response === undefined ? null : J(rec.response), rec.error ?? null,
    );
  }
  /** 调用日志（时间序；可按桌过滤；tableId 为空的记录仅在全量里可见） */
  getModelCallLogs(tableId?: string): ModelCallLogRecord[] {
    const rows = (tableId ? this.st.modelCallOfTable.all(tableId) : this.st.modelCallAll.all()) as Row[];
    return rows.map((r) => ({
      ts: Number(r.ts), time: String(r.time), provider: String(r.provider) as ModelCallLogRecord["provider"],
      purpose: String(r.purpose) as ModelCallLogRecord["purpose"],
      ...(r.table_id === null ? {} : { tableId: String(r.table_id) }),
      model: String(r.model), url: String(r.url),
      status: Number(r.status), ok: Number(r.ok) === 1, durationMs: Number(r.duration_ms),
      ...(r.usage === null ? {} : { usage: JSON.parse(String(r.usage)) as ModelCallLogRecord["usage"] }),
      request: JSON.parse(String(r.request)),
      ...(r.response === null ? {} : { response: JSON.parse(String(r.response)) }),
      ...(r.error === null ? {} : { error: String(r.error) }),
    }));
  }

  // ---------- pause_requests（会议暂停申请） ----------
  savePauseRequest(rec: PauseRequestRecord) {
    this.st.pauseReqUpsert.run(rec.tableId, rec.requestId, J(rec));
  }
  getPauseRequests(tableId: string): PauseRequestRecord[] {
    return (this.st.pauseReqsOfTable.all(tableId) as Row[]).map((r) => JSON.parse(String(r.data)) as PauseRequestRecord);
  }

  // ---------- owner_directives（持有人私有指令：不进消息流，仅本席席位 token 可读） ----------
  /** 新增即发 "message" 事件：唤醒该桌长轮询（poll 把待送达指令当返回条件之一） */
  addOwnerDirective(rec: OwnerDirectiveRecord) {
    this.st.ownerDirInsert.run(rec.tableId, rec.directiveId, rec.seatId, J(rec));
    this.emit("message", rec.tableId, null);
  }
  ownerDirectivesOf(tableId: string, seatId: string): OwnerDirectiveRecord[] {
    return (this.st.ownerDirsOfSeat.all(tableId, seatId) as Row[]).map((r) => JSON.parse(String(r.data)) as OwnerDirectiveRecord);
  }
  /** agent ack：只标记属于本席的指令（未知/他席 id 静默忽略，幂等），返回实际确认条数 */
  ackOwnerDirectives(tableId: string, seatId: string, directiveIds: string[], at: number): number {
    let n = 0;
    for (const id of directiveIds) {
      const r = this.st.ownerDirGet.get(tableId, id) as Row | undefined;
      if (!r || String(r.seat_id) !== seatId) continue;
      const rec = JSON.parse(String(r.data)) as OwnerDirectiveRecord;
      if (rec.deliveredAt) continue;
      this.st.ownerDirInsert.run(tableId, id, seatId, J({ ...rec, deliveredAt: at }));
      n++;
    }
    return n;
  }

  // ---------- messages ----------
  private rowMsg(r: Row): StoredMsg {
    const m: StoredMsg = {
      v: 1, tableId: String(r.table_id), msgId: String(r.msg_id), fromSeat: String(r.from_seat),
      toSeat: String(r.to_seat), type: String(r.type) as Envelope["type"], payload: JSON.parse(String(r.payload)),
      ts: Number(r.ts), seq: Number(r.seq),
    };
    if (r.sig !== null) m.sig = String(r.sig);
    if (r.flags !== null) m.flags = JSON.parse(String(r.flags));
    return m;
  }
  addMessage(tableId: string, env: Envelope, flags?: string[]): StoredMsg {
    const seq = Number((this.st.msgNextSeq.get(tableId) as Row).s);
    const stored: StoredMsg = flags && flags.length ? { ...env, seq, flags } : { ...env, seq };
    this.st.msgInsert.run(tableId, seq, env.msgId, env.fromSeat, env.toSeat, env.type, env.ts, flags && flags.length ? J(flags) : null, J(env.payload), nullable(env.sig));
    this.emit("message", tableId, stored);
    return stored;
  }
  getMessages(tableId: string): StoredMsg[] {
    return (this.st.msgsAll.all(tableId) as Row[]).map((r) => this.rowMsg(r));
  }
  getMessagesSince(tableId: string, since: number): StoredMsg[] {
    return (this.st.msgsSince.all(tableId, since) as Row[]).map((r) => this.rowMsg(r));
  }
  latestSeq(tableId: string): number {
    return Number((this.st.msgLatestSeq.get(tableId) as Row).s);
  }

  // ---------- requests ----------
  saveRequest(tableId: string, rec: RequestRecord) {
    this.st.reqUpsert.run(tableId, rec.req.requestId, J(rec));
  }
  getRequests(tableId: string): RequestRecord[] {
    return (this.st.reqsOfTable.all(tableId) as Row[]).map((r) => JSON.parse(String(r.data)) as RequestRecord);
  }

  // ---------- artifacts ----------
  saveArtifact(tableId: string, rec: ArtifactRecord) {
    this.st.artUpsert.run(tableId, rec.artifactId, rec.name, rec.format, rec.ownerSeat, nullable(rec.lockedBy), nullable(rec.lockedAt));
    for (const v of rec.versions) {
      this.st.verUpsert.run(tableId, rec.artifactId, v.v, v.sha256, v.size, v.changeNote, v.publishedBy, v.ts, nullable(v.diffFromPrev), nullable(v.requestId), v.requestIds ? J(v.requestIds) : null);
    }
  }
  private rowVersion(r: Row): StoredArtifactVersion {
    const v: StoredArtifactVersion = {
      v: Number(r.v), sha256: String(r.sha256), size: Number(r.size), changeNote: String(r.change_note),
      publishedBy: String(r.published_by), ts: Number(r.ts),
    };
    if (r.diff_from_prev !== null) v.diffFromPrev = String(r.diff_from_prev);
    if (r.request_id !== null) v.requestId = String(r.request_id);
    if (r.request_ids !== null && r.request_ids !== undefined) v.requestIds = JSON.parse(String(r.request_ids));
    return v;
  }
  private versionsOf(tableId: string): Map<string, StoredArtifactVersion[]> {
    const byArt = new Map<string, StoredArtifactVersion[]>();
    for (const r of this.st.verAll.all(tableId) as Row[]) {
      const key = String(r.artifact_id);
      const list = byArt.get(key);
      if (list) list.push(this.rowVersion(r));
      else byArt.set(key, [this.rowVersion(r)]);
    }
    return byArt;
  }
  getArtifacts(tableId: string): ArtifactRecord[] {
    const versions = this.versionsOf(tableId);
    return (this.st.artAll.all(tableId) as Row[]).map((r) => ({
      artifactId: String(r.artifact_id), tableId, name: String(r.name),
      format: String(r.format) as ArtifactRecord["format"], ownerSeat: String(r.owner_seat),
      versions: versions.get(String(r.artifact_id)) ?? [],
      ...(r.locked_by === null ? { lockedBy: null } : { lockedBy: String(r.locked_by) }),
      ...(r.locked_at === null ? {} : { lockedAt: Number(r.locked_at) }),
    }));
  }
  getArtifact(tableId: string, artifactId: string): ArtifactRecord | null {
    return this.getArtifacts(tableId).find((a) => a.artifactId === artifactId) ?? null;
  }

  // ---------- documents（资料文档：上传阅资料/投屏） ----------
  saveDocument(tableId: string, rec: TableDocumentRecord) {
    this.st.docUpsert.run(tableId, rec.docId, rec.name, rec.purpose, rec.visibility, rec.size, rec.sha256, rec.uploadedBy, rec.uploadedAt);
  }
  private rowDoc(r: Row): TableDocumentRecord {
    return {
      docId: String(r.doc_id), name: String(r.name), purpose: String(r.purpose),
      visibility: String(r.visibility) as TableDocumentRecord["visibility"], size: Number(r.size),
      sha256: String(r.sha256), uploadedBy: String(r.uploaded_by), uploadedAt: Number(r.uploaded_at),
    };
  }
  getDocuments(tableId: string): TableDocumentRecord[] {
    return (this.st.docAll.all(tableId) as Row[]).map((r) => this.rowDoc(r));
  }
  getDocument(tableId: string, docId: string): TableDocumentRecord | null {
    const r = this.st.docGet.get(tableId, docId) as Row | undefined;
    return r ? this.rowDoc(r) : null;
  }

  // ---------- invites ----------
  addInvite(code: string, tableId: string, role: string) {
    this.st.inviteUpsert.run(code, tableId, role, Date.now() + 7 * 86400_000, 10);
  }
  consumeInvite(code: string): { tableId: string; role: string } | null {
    const r = this.st.inviteGet.get(code) as Row | undefined;
    if (!r || Number(r.expires_at) < Date.now() || Number(r.uses_left) <= 0) return null;
    this.st.inviteDecr.run(code);
    return { tableId: String(r.table_id), role: String(r.role) };
  }
  /** 只读查码（不消费次数）：预检 / 入席前校验归属用 */
  peekInvite(code: string): { tableId: string; role: string; usesLeft: number; expiresAt: number } | null {
    const r = this.st.inviteGet.get(code) as Row | undefined;
    if (!r || Number(r.expires_at) < Date.now() || Number(r.uses_left) <= 0) return null;
    return { tableId: String(r.table_id), role: String(r.role), usesLeft: Number(r.uses_left), expiresAt: Number(r.expires_at) };
  }

  // ---------- audit ----------
  appendAudit(rec: AuditRecord) {
    this.st.auditInsert.run(rec.id, rec.ts, rec.tableId, rec.seatId, rec.event, J(rec.detail));
  }
  /** 审计/运行日志最近记录（运维排查用；API 暂未暴露） */
  listAudit(limit = 200): AuditRecord[] {
    return (this.st.auditRecent.all(limit) as Row[]).map((r) => ({
      id: String(r.id), ts: Number(r.ts), tableId: String(r.table_id), seatId: String(r.seat_id),
      event: String(r.event) as AuditRecord["event"], detail: JSON.parse(String(r.detail)),
    }));
  }

  /**
   * 兼容保留：SQLite 每写事务即持久，无需刷盘。
   * （index.ts 关机路径与旧测试仍调用；新代码请用 close()）
   */
  flushSync() { /* no-op */ }

  close() {
    try { this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);"); } catch { /* 关机尽力而为 */ }
    this.db.close();
  }
}
