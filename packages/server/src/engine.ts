/**
 * Hub — 服务器核心引擎：桌/席位生命周期、Turn 轮转调度、评审协作状态机、
 * 消息处理（能力校验/限频/阶段白名单）、产物仓库、审计、纪要生成。
 *
 * 设计要点（design.md v1.1）：
 * - 服务器保持「哑」：不做任何语义判断，共识靠显式消息收集；
 * - Turn 从消息历史事件溯源推导（崩溃恢复免费）；
 * - 能力声明在协议层强制：越权请求在此处直接拒绝。
 */
import { randomBytes } from "node:crypto";
import {
  INJECTION_FLAG, makeEnvelope, newId, resolveCaps, scanInjection, sha256, validateEnvelope,
  type ArtifactPublishedPayload, type ArtifactVersion, type AuditEvent, type AuditRecord,
  type ConsensusResultPayload, type DocUploadedPayload, type DocVisibility, type HumanInputPayload,
  type HumanRulingPayload, type MsgType, type Phase, type PhaseChangePayload, type RequestPayload,
  type RequestResponsePayload, type ResponsePayload, type ReviewCommentPayload, type SeatDocumentMeta,
  type SeatInfo, type TableChange, type TableChangesPayload, type TableDocumentMeta,
  type TableInfoPayload, type TurnGrantPayload,
} from "@rt/shared";
import type { RequestRecord, ReviewItemRecord, StoredArtifactVersion, StoredMsg, TableDocumentRecord, TableMeta } from "./model";
import { Store } from "./store";
import { unifiedDiff } from "./diff";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** 服务端席位：协议 SeatInfo + 在线心跳 */
export type ServerSeat = SeatInfo & { lastSeenAt?: number };

const SEAT_ABSENT_MS = 120_000;
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 8;
/** 资料文档上限：单份 ≤5MB（与产物一致）；每席 20 份 / 每桌 100 份防滥用 */
const DOC_MAX_BYTES = 5 * 1024 * 1024;
const DOCS_PER_SEAT = 20;
const DOCS_PER_TABLE = 100;
/** turn 消费型消息：必须持有当前发言权才能发 */
const TURN_BOUND: Partial<Record<MsgType, boolean>> = {
  STATEMENT: true, REVIEW_COMMENT: true, RESPONSE: true, RESPOND_REQUEST: true, CONSENSUS_VOTE: true,
};
/** 各阶段接受的会议消息（通用类型另见 COMMON_TYPES） */
const PHASE_ALLOWS: Partial<Record<Phase, MsgType[]>> = {
  open: [],
  statements: ["STATEMENT"],
  review: ["REVIEW_COMMENT", "REQUEST"],
  response: ["RESPONSE", "REQUEST"],
  execution: ["RESPOND_REQUEST", "REQUEST"],
  convergence: ["CONSENSUS_VOTE"],
  human_intervention: [],
};
/** 任何活跃阶段都允许的通用类型 */
const COMMON_TYPES: MsgType[] = ["QUESTION", "REPLY", "HUMAN_INPUT", "HUMAN_RULING", "ESCALATE"];

export interface PollResult {
  table: TableInfoPayload;
  messages: StoredMsg[];
  yourTurn: TurnGrantPayload | null;
  /** 本席当前待办的人话提示（与发言权解耦：open 阶段人人有设定待办但无发言权） */
  myTask: string | null;
  /** 最新资料文档列表（本席视角，含 downloadable）——回合开始刷新用 */
  documents: SeatDocumentMeta[];
  /** since 之后的结构化变动（messages 的同源投影，按 seq 升序） */
  changes: TableChange[];
  now: number;
}

export class Hub {
  /** 长轮询等待者：tableId → 唤醒回调 */
  private waiters = new Map<string, Set<() => void>>();
  /** 席位限频窗口：tableId:seatId → 时间戳数组 */
  private rateWindow = new Map<string, number[]>();

  constructor(public readonly store: Store) {
    this.store.on("message", (tableId: string) => this.notify(tableId));
  }

  // ================= 用户与桌 =================

  registerUser(name: string): { userId: string; token: string } {
    const token = `rtu_${randomBytes(24).toString("base64url")}`;
    const userId = this.store.addUser(name, sha256(token));
    this.audit("-", "-", "auth_ok", { name });
    return { userId, token };
  }

  requireUser(token: string): { userId: string; name: string; role: "user" | "systemadmin"; disabled: boolean } {
    const u = this.store.findUserByToken(token);
    if (!u) throw new ApiError(401, "unauthorized", "用户 token 无效");
    if (u.disabled) throw new ApiError(403, "user_disabled", "该用户已被系统观察员禁用（联系管理员恢复）");
    return u;
  }

  /** 管理台统一鉴权：仅 systemadmin */
  private requireAdmin(token: string) {
    const u = this.requireUser(token);
    if (u.role !== "systemadmin") throw new ApiError(403, "not_admin", "仅系统观察员（systemadmin）可执行管理操作");
    return u;
  }

  /**
   * 建桌（任何已认证方）：录入主题/目标/交付物/规则/参与方安排；
   * 建桌人自动成为首个席位（proposer），并签发角色固定的邀请码
   * （reviewer / observer —— 席位不能自封角色，身份安排权在建桌人）。
   */
  createTable(userToken: string, p: {
    topic: string; goals?: string; deliverables?: string; rules?: string; rolePlan?: string;
    owner: { seatName: string; agentLabel: string };
    maxReviewRounds?: number; turnTimeoutMs?: number;
  }): {
    tableId: string; ownerSeatId: string; ownerSeatToken: string;
    inviteCodes: { code: string; role: "reviewer" | "observer" }[];
  } {
    const user = this.requireUser(userToken);
    if (!p.topic?.trim()) throw new ApiError(422, "bad_payload", "topic 必填");
    if (!p.owner?.seatName?.trim()) throw new ApiError(422, "bad_payload", "owner.seatName 必填");
    const tableId = newId("tbl");
    const meta: TableMeta = {
      tableId, topic: p.topic.trim(), template: "review-collab", phase: "open",
      goals: p.goals ?? "", deliverables: p.deliverables ?? "", rules: p.rules ?? "",
      rolePlan: p.rolePlan ?? "", ownerSeat: "",
      roundNo: 1, deadlockCount: 0, createdAt: Date.now(), seatCount: 0,
      maxReviewRounds: p.maxReviewRounds ?? 2, turnTimeoutMs: p.turnTimeoutMs ?? 300_000,
    };

    // 建桌人席位（proposer，绑定用户身份）
    const ownerSeatId = newId("seat");
    const ownerSeat: ServerSeat = {
      seatId: ownerSeatId, name: p.owner.seatName.trim(), role: "proposer",
      caps: resolveCaps("proposer", undefined), agentLabel: p.owner.agentLabel || "unknown",
      joinedAt: Date.now(), status: "active", lastSeenAt: Date.now(),
      config: { stance: "", scope: "", dataScope: [], ready: false },
    };
    meta.ownerSeat = ownerSeatId;
    meta.seatCount = 1;
    this.store.saveTable(meta);
    this.store.saveSeat(tableId, ownerSeat);
    this.store.bindSeatOwner(tableId, ownerSeatId, user.userId);
    const ownerSeatToken = `rts_${randomBytes(24).toString("base64url")}`;
    this.store.saveSeatToken(ownerSeatToken, tableId, ownerSeatId);

    const inviteCodes = [
      { code: randomBytes(5).toString("hex").toUpperCase(), role: "reviewer" as const },
      { code: randomBytes(5).toString("hex").toUpperCase(), role: "observer" as const },
    ];
    for (const inv of inviteCodes) this.store.addInvite(inv.code, tableId, inv.role);

    this.sysMsg(tableId, "SEAT_JOINED", { seat: ownerSeat });
    this.audit(tableId, ownerSeatId, "table_open", { topic: p.topic, by: user.name });
    this.audit(tableId, ownerSeatId, "seat_join", { name: p.owner.seatName, role: "proposer", owner: true });
    return { tableId, ownerSeatId, ownerSeatToken, inviteCodes };
  }

  /** 邀请码预检（Web 凭码入桌）：裸码或「完整邀请」整段文本均可，服务端提取码；只读不消费次数 */
  previewInvite(userToken: string, raw: string): {
    code: string; tableId: string; topic: string; phase: string;
    role: string; usesLeft: number; expiresAt: number; seatCount: number;
    mySeat: { seatId: string; name: string; role: string } | null;
  } {
    const u = this.requireUser(userToken);
    // 邀请码 = 10 位大写 hex；完整邀请文本里的 tableId / token 均为更长整词，词边界可精确命中
    const m = /\b[0-9A-Fa-f]{10}\b/.exec(String(raw ?? "").trim());
    if (!m) throw new ApiError(403, "bad_invite", "邀请码无效或已用尽");
    const code = m[0].toUpperCase();
    const inv = this.store.peekInvite(code);
    if (!inv) throw new ApiError(403, "bad_invite", "邀请码无效或已用尽");
    let meta: TableMeta;
    try {
      meta = this.requireTable(inv.tableId);
    } catch {
      throw new ApiError(403, "bad_invite", "邀请码无效或已用尽"); // 所属桌已删除
    }
    const seatId = this.activeSeatOfUser(inv.tableId, u.userId);
    const seat = seatId ? this.store.getSeat(inv.tableId, seatId) : null;
    return {
      code, tableId: meta.tableId, topic: meta.topic, phase: meta.phase,
      role: inv.role, usesLeft: inv.usesLeft, expiresAt: inv.expiresAt, seatCount: meta.seatCount,
      mySeat: seat ? { seatId: seat.seatId, name: seat.name, role: seat.role } : null,
    };
  }

  joinTable(userToken: string, tableId: string, p: {
    inviteCode: string; seatName: string; role: "proposer" | "reviewer" | "observer"; agentLabel: string;
    capsOverride?: Partial<Record<"canPublish" | "canModifyOwn" | "canExecuteRequests" | "canSendRequests" | "canVote", boolean>>;
  }): { seatId: string; token: string; seat: SeatInfo } {
    const user = this.requireUser(userToken);
    const meta = this.requireTable(tableId);
    if (meta.phase !== "open") throw new ApiError(409, "already_started", "会议已开始，不再接受凭码入席");
    // 同一用户已持有本桌 active 席位：拒绝重复入席并引导进桌（退席 left 后可重新凭码入席）
    const existed = this.activeSeatOfUser(tableId, user.userId);
    if (existed) {
      const s = this.store.getSeat(tableId, existed);
      throw new ApiError(409, "already_seated", `你已在本桌持有席位「${s?.name ?? existed}」，无需重复入席`);
    }
    // 增减参与人：open 阶段自由入席；开始后由建桌人人工协调
    // 先只读校验码有效性与归属（消费前）：无效或跨桌的尝试不扣减次数
    const inv = this.store.peekInvite(p.inviteCode);
    if (!inv) throw new ApiError(403, "bad_invite", "邀请码无效或已用尽");
    if (inv.tableId !== tableId) throw new ApiError(403, "bad_invite", "邀请码不属于本圆桌");
    // 角色由邀请码固定（身份安排权在建桌人），席位不能自封
    if (inv.role !== "any" && inv.role !== p.role) {
      throw new ApiError(403, "role_mismatch", `该邀请码的角色为 ${inv.role}，与声明的 ${p.role} 不符`);
    }
    const seats = this.activeSeats(tableId);
    if (p.role === "proposer" && seats.some((s) => s.role === "proposer")) {
      throw new ApiError(409, "proposer_exists", "本桌已有提案人（建桌人）");
    }
    if (!p.seatName?.trim()) throw new ApiError(422, "bad_payload", "seatName 必填");
    // 校验全过才真正消费次数（并发下恰好被用尽则拒绝）
    if (!this.store.consumeInvite(p.inviteCode)) throw new ApiError(403, "bad_invite", "邀请码无效或已用尽");
    const seatId = newId("seat");
    const seat: ServerSeat = {
      seatId, name: p.seatName.trim(), role: p.role, caps: resolveCaps(p.role, p.capsOverride),
      agentLabel: p.agentLabel || "unknown", joinedAt: Date.now(), status: "active", lastSeenAt: Date.now(),
      config: { stance: "", scope: "", dataScope: [], ready: false },
    };
    this.store.saveSeat(tableId, seat);
    this.store.bindSeatOwner(tableId, seatId, user.userId);
    meta.seatCount = seats.length + 1;
    this.store.saveTable(meta);
    const token = `rts_${randomBytes(24).toString("base64url")}`;
    this.store.saveSeatToken(token, tableId, seatId);
    this.sysMsg(tableId, "SEAT_JOINED", { seat });
    this.audit(tableId, seatId, "seat_join", { name: p.seatName, role: p.role, by: user.name });
    return { seatId, token, seat };
  }

  /** 入桌设定：立场（预设+补充）、讨论范围、数据范围、就绪标记（open 阶段可反复修改） */
  updateSeatConfig(tableId: string, seat: ServerSeat, p: {
    stancePreset?: string; stance: string; scope?: string; dataScope?: string[]; ready?: boolean;
  }): SeatInfo {
    const meta = this.requireTable(tableId);
    if (meta.phase !== "open") throw new ApiError(409, "already_started", "会议已开始，席位设定锁定");
    if (!p.stance?.trim()) throw new ApiError(422, "bad_payload", "stance（立场声明）必填");
    seat.config = {
      stancePreset: p.stancePreset,
      stance: p.stance.trim(),
      scope: p.scope ?? "",
      dataScope: (p.dataScope ?? []).slice(0, 50),
      ready: p.ready ?? seat.config.ready,
    };
    this.store.saveSeat(tableId, seat);
    this.sysMsg(tableId, "SEAT_JOINED", { seat, configUpdate: true });
    this.audit(tableId, seat.seatId, "seat_config", { ready: seat.config.ready, stancePreset: p.stancePreset });
    return seat;
  }

  /** 点开始：建桌人专属。全员就绪 + 角色齐备 → 进入陈述阶段 */
  startTable(tableId: string, seat: ServerSeat): { started: boolean } {
    const meta = this.requireTable(tableId);
    if (meta.phase !== "open") throw new ApiError(409, "already_started", "会议已在进行中");
    if (meta.ownerSeat !== seat.seatId) throw new ApiError(403, "not_owner", "只有建桌人可以点开始");
    const seats = this.activeSeats(tableId);
    const notReady = seats.filter((s) => !s.config.ready);
    if (notReady.length) {
      throw new ApiError(409, "not_ready", `席位未就绪：${notReady.map((s) => `${s.name}(${s.role})`).join("、")}`);
    }
    if (!seats.some((s) => s.role === "proposer")) throw new ApiError(409, "no_proposer", "缺少提案方");
    if (!seats.some((s) => s.role === "reviewer")) throw new ApiError(409, "no_reviewer", "缺少评审方");
    this.setPhase(tableId, "statements", `全员就绪，建桌人 ${seat.name} 开始会议`);
    return { started: true };
  }

  leaveTable(tableId: string, seat: ServerSeat) {
    const meta = this.requireTable(tableId);
    seat.status = "left";
    this.store.saveSeat(tableId, seat);
    meta.seatCount = this.activeSeats(tableId).length;
    this.store.saveTable(meta);
    this.sysMsg(tableId, "SEAT_LEFT", { seatId: seat.seatId, name: seat.name });
    this.audit(tableId, seat.seatId, "seat_leave", {});
  }

  // ================= 查询与长轮询 =================

  requireTable(tableId: string): TableMeta {
    const t = this.store.getTable(tableId);
    if (!t) throw new ApiError(404, "no_table", "圆桌不存在");
    return t;
  }

  requireSeat(tableId: string, seatId: string): ServerSeat {
    const s = this.store.getSeat(tableId, seatId);
    if (!s) throw new ApiError(404, "no_seat", "席位不存在");
    if (s.status === "left") throw new ApiError(409, "seat_left", "席位已退席");
    return s as ServerSeat;
  }

  tableInfo(tableId: string): TableInfoPayload {
    const meta = this.requireTable(tableId);
    const seats = this.store.getSeats(tableId);
    const artifacts = this.store.getArtifacts(tableId).map((a) => ({
      artifactId: a.artifactId, name: a.name, ownerSeat: a.ownerSeat,
      latestVersion: a.versions.length, lockedBy: a.lockedBy,
    }));
    return {
      tableId, topic: meta.topic, template: meta.template, phase: meta.phase,
      goals: meta.goals, deliverables: meta.deliverables, rules: meta.rules, ownerSeat: meta.ownerSeat,
      roundNo: meta.roundNo, deadlockCount: meta.deadlockCount, seats, artifacts,
      activeTurn: this.computeTurn(tableId),
    };
  }

  touchSeat(seat: ServerSeat, tableId: string) {
    if (seat.status !== "left") seat.status = "active";
    seat.lastSeenAt = Date.now();
    this.store.saveSeat(tableId, seat);
  }

  private seatFresh(seat: SeatInfo): boolean {
    const last = (seat as ServerSeat).lastSeenAt ?? seat.joinedAt;
    return seat.status === "active" && Date.now() - last <= SEAT_ABSENT_MS;
  }

  async poll(tableId: string, seat: ServerSeat, since: number, waitMs: number): Promise<PollResult> {
    this.requireTable(tableId);
    this.touchSeat(seat, tableId);
    const deadline = Date.now() + waitMs;
    for (;;) {
      const messages = this.store.getMessagesSince(tableId, since);
      const table = this.tableInfo(tableId);
      const yourTurn = table.activeTurn && table.activeTurn.seatId === seat.seatId ? table.activeTurn : null;
      const myTask = this.myTaskOf(table, seat, yourTurn);
      if (messages.length > 0 || Date.now() >= deadline) {
        return {
          table, messages, yourTurn, myTask, now: Date.now(),
          documents: this.listDocuments(tableId, seat.seatId) as SeatDocumentMeta[],
          changes: messages.map((m) => this.toChange(m)),
        };
      }
      await this.waitForChange(tableId, deadline);
    }
  }

  /**
   * 最新圆桌信息 + 变动记录（agent 回合开始刷新的一站式抓手）：
   * table（阶段/席位/产物）+ documents（本席视角资料列表）+ since 之后的结构化变动。
   * 不新增存储——变动从消息流推导（哑服务器：只是同一份事实的另一种投影）。
   */
  changesSince(tableId: string, seat: ServerSeat, since: number): TableChangesPayload {
    this.requireTable(tableId);
    this.touchSeat(seat, tableId);
    return {
      table: this.tableInfo(tableId),
      documents: this.listDocuments(tableId, seat.seatId) as SeatDocumentMeta[],
      changes: this.changesOf(tableId, since),
      now: Date.now(),
    };
  }

  private changesOf(tableId: string, since: number): TableChange[] {
    return this.store.getMessagesSince(tableId, since).map((m) => this.toChange(m));
  }

  private toChange(m: StoredMsg): TableChange {
    const base = { ts: m.ts, msgId: m.msgId, fromSeat: m.fromSeat };
    switch (m.type) {
      case "DOC_UPLOADED":
        return { kind: "doc", ...base, doc: (m.payload as DocUploadedPayload).doc };
      case "ARTIFACT_PUBLISHED": {
        const p = m.payload as ArtifactPublishedPayload;
        return { kind: "artifact", ...base, artifactId: p.artifactId, name: p.name, version: p.version.v, changeNote: p.version.changeNote };
      }
      case "PHASE_CHANGE": {
        const p = m.payload as PhaseChangePayload;
        return { kind: "phase", ...base, from: p.from, to: p.to, reason: p.reason };
      }
      case "SEAT_JOINED": {
        const p = m.payload as { seat: SeatInfo; configUpdate?: boolean };
        return { kind: "seat", ...base, seatName: p.seat?.name ?? m.fromSeat, ...(p.seat?.role ? { role: p.seat.role } : {}), what: p.configUpdate ? "config" : "join" };
      }
      case "SEAT_LEFT": {
        const p = m.payload as { name?: string };
        return { kind: "seat", ...base, seatName: p.name ?? m.fromSeat, what: "left" };
      }
      case "HUMAN_INPUT": {
        const p = m.payload as HumanInputPayload;
        return { kind: "human", ...base, ...(p.toSeat ? { toSeat: p.toSeat } : {}), ...(p.byHuman ? { byHuman: p.byHuman } : {}) };
      }
      default:
        return { kind: "message", ...base, type: m.type };
    }
  }

  /** 本席待办提示：open 阶段按就绪状态给出设定/等待/开始指引，其余阶段沿用发言权的 taskHint */
  private myTaskOf(table: TableInfoPayload, seat: ServerSeat, yourTurn: TurnGrantPayload | null): string | null {
    if (table.phase === "closed") return "会议已结束：纪要在 MINUTES 消息里，无需继续跟进";
    if (table.phase === "open") {
      if (!seat.config.ready) {
        return "入桌设定：向持有人确认立场（GET /api/stances 选预设并补充）、讨论范围、数据范围，然后 POST /api/tables/:id/seat-config 带 ready:true（向导见 skill §1.5）";
      }
      const seats = table.seats.filter((s) => s.status !== "left");
      const notReady = seats.filter((s) => !s.config.ready);
      if (table.ownerSeat === seat.seatId) {
        const rolesOk = seats.some((s) => s.role === "proposer") && seats.some((s) => s.role === "reviewer");
        if (notReady.length) return `等待席位完成设定：${notReady.map((s) => s.name).join("、")}`;
        return rolesOk ? "全员已就绪：POST /api/tables/:id/start 开始会议" : "角色不齐备：还需评审方席位凭邀请码入席";
      }
      return "已就绪，等待建桌人开始会议";
    }
    return yourTurn ? yourTurn.taskHint : null;
  }

  private waitForChange(tableId: string, deadline: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const fin = () => { if (!done) { done = true; cleanup(); resolve(); } };
      const w = new Set(this.waiters.get(tableId) ?? []);
      w.add(fin);
      this.waiters.set(tableId, w);
      const timer = setTimeout(fin, Math.max(0, deadline - Date.now()));
      (timer as unknown as { unref?: () => void }).unref?.();
      const cleanup = () => {
        clearTimeout(timer);
        this.waiters.get(tableId)?.delete(fin);
      };
    });
  }

  private notify(tableId: string) {
    for (const fin of this.waiters.get(tableId) ?? []) fin();
  }

  // ================= 消息处理 =================

  postMessage(tableId: string, seat: ServerSeat, type: MsgType, payload: unknown, extraFlags?: string[]): StoredMsg {
    const meta = this.requireTable(tableId);
    this.touchSeat(seat, tableId);
    this.checkRate(tableId, seat);

    const env = makeEnvelope({ tableId, from: seat.seatId, to: "all", type, payload });
    const v = validateEnvelope(env);
    if (!v.ok) throw new ApiError(422, "bad_payload", `消息校验失败：${v.errors.join("; ")}`);

    this.checkPhaseRules(meta, seat, type, payload);
    if (TURN_BOUND[type]) {
      const turn = this.computeTurn(tableId);
      if (!turn || turn.seatId !== seat.seatId) {
        throw new ApiError(409, "not_your_turn", `当前发言权：${turn ? turn.seatId : "无（阶段未就绪）"}；消息类型 ${type} 需持有发言权`);
      }
    }
    // 批量处置：requestIds 展开为逐请求的单一处置（全或无——先全部 precheck，消息入库后再逐个 apply）
    const respondPlan = type === "RESPOND_REQUEST"
      ? this.respondTargetIds(payload as RequestResponsePayload).map((rid) => ({ ...(payload as RequestResponsePayload), requestId: rid, requestIds: undefined }))
      : null;
    if (respondPlan) for (const sp of respondPlan) this.precheckRequestResponse(tableId, seat, sp);

    // 注入扫描：命中不拦截，但打警示标记供端侧（skill/人）处置；extraFlags（如网页人工代答）一并合入
    const injectionHits = scanInjection(payload);
    const flags = injectionHits.length > 0
      ? [...(extraFlags ?? []), INJECTION_FLAG, ...injectionHits]
      : (extraFlags && extraFlags.length > 0 ? [...extraFlags] : undefined);
    const msg = this.store.addMessage(tableId, env, flags);
    if (injectionHits.length > 0) {
      this.audit(tableId, seat.seatId, "policy_reject", { reason: "injection_flagged", hits: injectionHits, msgId: env.msgId });
    }

    // 副作用
    if (type === "REQUEST") this.registerRequest(tableId, seat, payload as RequestPayload);
    if (type === "RESPONSE") this.deriveRequests(tableId, seat, payload as ResponsePayload);
    if (respondPlan) for (const sp of respondPlan) this.applyRequestResponse(tableId, sp);
    if (type === "ESCALATE") this.enterHumanMode(tableId, `席位 ${seat.name} 申请人工介入：${String((payload as { reason?: string }).reason ?? "")}`);
    if (type === "HUMAN_INPUT") this.audit(tableId, seat.seatId, "human_input", { toSeat: (payload as { toSeat?: string }).toSeat ?? "all" });
    if (type === "HUMAN_RULING") this.applyRuling(tableId, payload as HumanRulingPayload);
    if (type === "CONSENSUS_VOTE") this.audit(tableId, seat.seatId, "vote_cast", {});
    this.maybeAdvance(tableId);
    return msg;
  }

  /** 席位直接发送的 REQUEST 入库（deriveRequests 派生的走同一条 store 通道） */
  private registerRequest(tableId: string, seat: ServerSeat, p: RequestPayload) {
    if (this.store.getRequests(tableId).some((r) => r.req.requestId === p.requestId)) {
      throw new ApiError(422, "dup_request", "requestId 已存在");
    }
    const record: RequestRecord = { req: p, status: "pending", createdAt: Date.now(), createdBy: seat.seatId };
    this.store.saveRequest(tableId, record);
    this.audit(tableId, seat.seatId, "request_sent", { requestId: p.requestId, toSeat: p.toSeat, intent: p.intent });
  }

  /** 阶段白名单 + 角色/能力校验（协议层强制的落点） */
  private checkPhaseRules(meta: TableMeta, seat: ServerSeat, type: MsgType, payload: unknown) {
    const p = meta.phase;
    if (p === "closed") throw new ApiError(409, "table_closed", "会议已结束，只读");
    const role = seat.role, caps = seat.caps;

    const phaseAllows = PHASE_ALLOWS[p] ?? [];
    if (p === "human_intervention") {
      if (!COMMON_TYPES.includes(type)) throw new ApiError(409, "human_mode", "人工介入模式：仅接受 HUMAN_INPUT / HUMAN_RULING");
    } else if (!phaseAllows.includes(type) && !COMMON_TYPES.includes(type)) {
      throw new ApiError(409, "wrong_phase", `阶段 ${p} 不接受消息类型 ${type}`);
    }

    if (type === "STATEMENT" && role !== "proposer") throw new ApiError(403, "role", "仅提案人可陈述");
    if (type === "REVIEW_COMMENT" && role !== "reviewer") throw new ApiError(403, "role", "仅评审人可发评审意见");
    if (type === "RESPONSE" && role !== "proposer") throw new ApiError(403, "role", "仅提案人可回应评审");
    if (type === "CONSENSUS_VOTE" && !caps.canVote) throw new ApiError(403, "caps", "该席位无表决权");
    if (type === "REQUEST" && !caps.canSendRequests) throw new ApiError(403, "caps", "该席位不可发起请求");
    if (type === "REQUEST") {
      const rp = payload as RequestPayload;
      const target = this.store.getSeat(meta.tableId, rp.toSeat);
      if (!target || target.status === "left") throw new ApiError(404, "no_seat", "请求目标席位不存在");
      if (!target.caps.canExecuteRequests) throw new ApiError(403, "caps", "目标席位声明不接受执行请求");
      if (rp.intent === "modify_artifact" && (!rp.artifactId || !this.store.getArtifact(meta.tableId, rp.artifactId))) {
        throw new ApiError(404, "no_artifact", "modify_artifact 请求需指向存在的产物");
      }
    }
    if (type === "REVIEW_COMMENT") {
      const rp = payload as ReviewCommentPayload;
      if (rp.artifactId && !this.store.getArtifact(meta.tableId, rp.artifactId)) {
        throw new ApiError(404, "no_artifact", "评审目标产物不存在");
      }
      if (rp.docId) {
        const doc = this.store.getDocument(meta.tableId, rp.docId);
        if (!doc) throw new ApiError(404, "no_doc", "评审目标资料文档不存在");
        if (doc.visibility !== "shared") throw new ApiError(403, "doc_private", "评审意见不能指向他席私有文档（只可评审共享资料）");
      }
    }
  }

  private checkRate(tableId: string, seat: ServerSeat) {
    const key = `${tableId}:${seat.seatId}`;
    const now = Date.now();
    const list = (this.rateWindow.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    if (list.length >= RATE_MAX) {
      this.audit(tableId, seat.seatId, "policy_reject", { reason: "rate_limit" });
      throw new ApiError(429, "rate_limited", "发言过于频繁，稍候再试");
    }
    list.push(now);
    this.rateWindow.set(key, list);
  }

  // ================= 执行请求（RESPOND_REQUEST） =================

  private findRequest(tableId: string, requestId: string): RequestRecord {
    const rec = this.store.getRequests(tableId).find((r) => r.req.requestId === requestId);
    if (!rec) throw new ApiError(404, "no_request", "请求不存在");
    return rec;
  }

  /** 批量处置展开：requestIds 优先（去重），回落 requestId；两者皆无视为协议错误 */
  private respondTargetIds(p: RequestResponsePayload): string[] {
    const ids = p.requestIds?.length ? [...new Set(p.requestIds)] : p.requestId ? [p.requestId] : [];
    if (ids.length === 0) throw new ApiError(422, "bad_payload", "RESPOND_REQUEST 需提供 requestId 或 requestIds");
    return ids;
  }

  /** 入站前置校验（消息入库前把关），状态落库在 applyRequestResponse */
  private precheckRequestResponse(tableId: string, seat: ServerSeat, p: RequestResponsePayload) {
    const rec = this.findRequest(tableId, p.requestId);
    if (rec.status !== "pending" && rec.status !== "human") {
      throw new ApiError(409, "request_closed", `请求已处置（${rec.status}）`);
    }
    if (rec.req.toSeat !== seat.seatId) throw new ApiError(403, "not_target", "该请求的执行席位不是你");
    if (rec.status === "human" && p.decision === "escalate_human") {
      throw new ApiError(409, "already_human", "请求已在人工处理中，请给出最终决定（accept / reject / counter）");
    }
    if (p.decision === "accept" && rec.req.intent === "modify_artifact" && rec.req.artifactId) {
      const art = this.store.getArtifact(tableId, rec.req.artifactId);
      const hasVersion = art?.versions.some((v) => v.requestId === p.requestId || (v.requestIds ?? []).includes(p.requestId));
      if (!hasVersion) {
        throw new ApiError(409, "no_result_version", "先按要求发布新版本（POST artifacts 带 requestId / requestIds），再 RESPOND_REQUEST accept");
      }
    }
  }

  private applyRequestResponse(tableId: string, p: RequestResponsePayload) {
    const rec = this.findRequest(tableId, p.requestId);
    if (rec.status !== "pending" && rec.status !== "human") return;
    rec.response = p;
    rec.status = p.decision === "accept" ? "executed"
      : p.decision === "reject" ? "rejected"
        : p.decision === "counter" ? "countered" : "human";
    this.store.saveRequest(tableId, rec);
    this.audit(tableId, rec.req.toSeat, "request_responded", { requestId: p.requestId, decision: p.decision });
  }

  // ================= Turn 轮转（事件溯源） =================

  computeTurn(tableId: string): TurnGrantPayload | null {
    const meta = this.requireTable(tableId);
    const seats = this.activeSeats(tableId);
    const proposer = seats.find((s) => s.role === "proposer");
    const reviewers = seats.filter((s) => s.role === "reviewer");
    const msgs = this.store.getMessages(tableId);
    const grant = (seatId: string, taskHint: string, pendingRequest?: RequestPayload): TurnGrantPayload => ({
      seatId, phase: meta.phase, roundNo: meta.roundNo,
      deadline: Date.now() + meta.turnTimeoutMs, taskHint, pendingRequest,
    });

    switch (meta.phase) {
      case "open": {
        const owner = seats.find((s) => s.seatId === meta.ownerSeat);
        if (!owner) return null;
        const allReady = seats.every((s) => s.config.ready);
        const rolesOk = seats.some((s) => s.role === "proposer") && seats.some((s) => s.role === "reviewer");
        return grant(
          owner.seatId,
          allReady && rolesOk
            ? "全员已就绪：POST /api/tables/:id/start 开始会议"
            : "设定阶段：等待各席位 SEAT_CONFIG 就绪（立场/范围/数据范围），邀请参与方入桌后点开始",
        );
      }

      case "statements":
        return proposer ? grant(proposer.seatId, "陈述提案：先 POST /api/tables/:id/artifacts 发布产物 v1，再发 STATEMENT 概述（两者齐备自动进入评审）") : null;

      case "review": {
        const startIdx = this.phaseStartSeq(tableId, "review", meta.roundNo);
        const spoken = new Set<string>(), done = new Set<string>();
        for (const m of msgs) {
          if (m.seq <= startIdx || m.type !== "REVIEW_COMMENT") continue;
          spoken.add(m.fromSeat);
          if ((m.payload as ReviewCommentPayload).done) done.add(m.fromSeat);
        }
        const next = reviewers.find((s) => !spoken.has(s.seatId) && !done.has(s.seatId));
        return next ? grant(next.seatId, `第 ${meta.roundNo} 轮评审：REVIEW_COMMENT 逐条给意见（severity: must/should/nice），全部给完可 done:true`) : null;
      }

      case "response":
        return proposer ? grant(proposer.seatId, "逐条回应评审：RESPONSE items[].decision=accept/reject（accept 可带 action.executeBy：self 自己改 / reviewerSeat 请意见提出席改）") : null;

      case "execution": {
        const cur = this.store.getRequests(tableId).find((r) => r.status === "pending");
        if (!cur) return null;
        const target = seats.find((s) => s.seatId === cur.req.toSeat && this.seatFresh(s));
        if (!target) return null;
        return grant(
          target.seatId,
          `处理执行请求「${cur.req.title}」：先按要求修改并发布新版本（POST artifacts 带 requestId=${cur.req.requestId}），再 RESPOND_REQUEST accept；或 reject / counter / escalate_human。有多个待执行请求且由同一次修订满足时：发布一个带 requestIds=[...] 的版本，再发一条带 requestIds 的批量 RESPOND_REQUEST（全或无）`,
          cur.req,
        );
      }

      case "convergence": {
        const startIdx = this.phaseStartSeq(tableId, "convergence", null);
        const voted = new Set(msgs.filter((m) => m.seq > startIdx && m.type === "CONSENSUS_VOTE").map((m) => m.fromSeat));
        const next = seats.find((s) => s.caps.canVote && !voted.has(s.seatId));
        return next ? grant(next.seatId, "共识表决：CONSENSUS_VOTE decision: pass / conditional_pass / reject") : null;
      }

      default:
        return null;
    }
  }

  /** 进入某阶段（第 roundNo 轮 review）的消息 seq 分界 */
  private phaseStartSeq(tableId: string, phase: Phase, roundNo: number | null): number {
    const msgs = this.store.getMessages(tableId);
    if (phase === "review" && roundNo !== null) {
      let seen = 0;
      for (const m of msgs) {
        if (m.type === "PHASE_CHANGE" && (m.payload as { to?: Phase }).to === "review") {
          seen += 1;
          if (seen === roundNo) return m.seq;
        }
      }
      return 0;
    }
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.type === "PHASE_CHANGE" && (m.payload as { to?: Phase }).to === phase) return m.seq;
    }
    return 0;
  }

  // ================= 状态机推进 =================

  private setPhase(tableId: string, to: Phase, reason: string, roundNo?: number) {
    const meta = this.requireTable(tableId);
    const from = meta.phase;
    meta.phase = to;
    if (roundNo !== undefined) meta.roundNo = roundNo;
    if (to === "human_intervention") meta.deadlockCount += 1;
    this.store.saveTable(meta);
    this.sysMsg(tableId, "PHASE_CHANGE", { from, to, reason });
    this.audit(tableId, "-", "phase_change", { from, to, reason });
  }

  maybeAdvance(tableId: string) {
    const meta = this.requireTable(tableId);
    const seats = this.activeSeats(tableId);
    const msgs = this.store.getMessages(tableId);
    const proposer = seats.find((s) => s.role === "proposer");

    switch (meta.phase) {
      case "open":
        // open 停在设定阶段：全员就绪后由建桌人 startTable 显式开始（不自动流转）
        break;

      case "statements": {
        if (!proposer) break;
        const hasStatement = msgs.some((m) => m.type === "STATEMENT" && m.fromSeat === proposer.seatId);
        const hasArtifact = this.store.getArtifacts(tableId).some((a) => a.ownerSeat === proposer.seatId);
        if (hasStatement && hasArtifact) this.setPhase(tableId, "review", "提案已发布并陈述", 1);
        break;
      }

      case "review": {
        const startIdx = this.phaseStartSeq(tableId, "review", meta.roundNo);
        const reviewers = seats.filter((s) => s.role === "reviewer");
        if (reviewers.length === 0) break;
        const spoken = new Set(msgs.filter((m) => m.seq > startIdx && m.type === "REVIEW_COMMENT").map((m) => m.fromSeat));
        if (reviewers.every((r) => spoken.has(r.seatId))) {
          this.setPhase(tableId, "response", "全部评审人已出具意见");
        }
        break;
      }

      case "response": {
        const startIdx = this.phaseStartSeq(tableId, "response", null);
        const hasResponse = msgs.some((m) => m.seq > startIdx && m.type === "RESPONSE");
        if (!hasResponse) break;
        const pending = this.store.getRequests(tableId).some((r) => r.status === "pending");
        this.setPhase(tableId, pending ? "execution" : "convergence", pending ? "存在待执行修改请求" : "评审意见已全部处置");
        break;
      }

      case "execution": {
        const pending = this.store.getRequests(tableId).some((r) => r.status === "pending");
        if (!pending) this.setPhase(tableId, "convergence", "全部执行请求已处置");
        break;
      }

      case "convergence":
        this.maybeTally(tableId);
        break;

      default:
        break;
    }
  }

  /** convergence：全员投票后计票 */
  private maybeTally(tableId: string) {
    const meta = this.requireTable(tableId);
    if (meta.phase !== "convergence") return;
    const seats = this.activeSeats(tableId);
    const voters = seats.filter((s) => s.caps.canVote);
    if (voters.length === 0) return;
    const startIdx = this.phaseStartSeq(tableId, "convergence", null);
    const tally: ConsensusResultPayload["tally"] = {};
    for (const m of this.store.getMessages(tableId)) {
      if (m.seq <= startIdx || m.type !== "CONSENSUS_VOTE") continue;
      const pl = m.payload as { decision: "pass" | "conditional_pass" | "reject"; conditions?: string };
      tally[m.fromSeat] = { decision: pl.decision, conditions: pl.conditions };
    }
    if (Object.keys(tally).length < voters.length) return;
    const pass = Object.values(tally).every((t) => t.decision !== "reject");
    this.sysMsg(tableId, "CONSENSUS_RESULT", { pass, tally, roundNo: meta.roundNo } satisfies ConsensusResultPayload);
    this.audit(tableId, "-", "consensus_result", { pass });
    if (pass) {
      this.closeTable(tableId, "共识达成");
    } else if (meta.roundNo < meta.maxReviewRounds) {
      this.setPhase(tableId, "review", `第 ${meta.roundNo} 轮表决未通过，重回评审`, meta.roundNo + 1);
    } else {
      this.enterHumanMode(tableId, `连续 ${meta.roundNo} 轮未达成共识，自动升级人工介入`);
    }
  }

  private enterHumanMode(tableId: string, reason: string) {
    const meta = this.requireTable(tableId);
    if (meta.phase === "closed" || meta.phase === "human_intervention") return;
    this.setPhase(tableId, "human_intervention", reason);
    this.audit(tableId, "-", "escalate", { reason });
  }

  private applyRuling(tableId: string, p: HumanRulingPayload) {
    const meta = this.requireTable(tableId);
    this.audit(tableId, "-", "human_ruling", { instruction: p.instruction });
    if (p.forceConvergence) {
      this.sysMsg(tableId, "CONSENSUS_RESULT", { pass: true, tally: {}, roundNo: meta.roundNo } as ConsensusResultPayload);
      this.closeTable(tableId, `人工裁决：${p.instruction}`);
      return;
    }
    if (p.resumePhase) {
      this.setPhase(tableId, p.resumePhase, `人工裁决恢复：${p.instruction}`, p.resumePhase === "review" ? 1 : undefined);
    }
  }

  private closeTable(tableId: string, reason: string) {
    const meta = this.requireTable(tableId);
    this.sysMsg(tableId, "MINUTES", this.buildMinutes(tableId, reason));
    meta.phase = "closed";
    meta.closedAt = Date.now();
    this.store.saveTable(meta);
    this.sysMsg(tableId, "PHASE_CHANGE", { from: "convergence", to: "closed", reason });
    this.audit(tableId, "-", "table_close", { reason });
  }

  // ================= RESPONSE → 执行请求 =================

  private deriveRequests(tableId: string, proposer: ServerSeat, payload: ResponsePayload) {
    const items = this.collectReviewItems(tableId);
    for (const it of payload.items) {
      if (it.decision !== "accept") continue;
      const rec = items.find((r) => r.item.id === it.reviewItemId);
      if (!rec) continue;
      const executeBy = it.action?.executeBy ?? "self";
      const toSeat = executeBy === "self" ? proposer.seatId : rec.fromSeat;
      const req: RequestPayload = {
        requestId: newId("req"),
        toSeat,
        intent: rec.artifactId ? "modify_artifact" : "clarify",
        artifactId: rec.artifactId,
        title: `[${it.reviewItemId}] ${rec.item.comment.slice(0, 80)}`,
        detail: it.action?.note || it.reason || rec.item.comment,
        sourceReviewItemId: it.reviewItemId,
      };
      const record: RequestRecord = { req, status: "pending", createdAt: Date.now(), createdBy: proposer.seatId };
      this.store.saveRequest(tableId, record);
      this.sysMsg(tableId, "REQUEST", req);
      this.audit(tableId, proposer.seatId, "request_sent", { requestId: req.requestId, toSeat });
    }
  }

  /** 汇总桌内全部评审条目（含提案人全部回应） */
  collectReviewItems(tableId: string): ReviewItemRecord[] {
    const byId = new Map<string, ReviewItemRecord>();
    const order: ReviewItemRecord[] = [];
    for (const m of this.store.getMessages(tableId)) {
      if (m.type === "REVIEW_COMMENT") {
        const pl = m.payload as ReviewCommentPayload;
        for (const item of pl.items) {
          if (byId.has(item.id)) continue;
          const rec: ReviewItemRecord = { item, fromSeat: m.fromSeat, msgId: m.msgId, ts: m.ts, artifactId: pl.artifactId, docId: pl.docId, responses: [] };
          byId.set(item.id, rec);
          order.push(rec);
        }
      }
    }
    for (const m of this.store.getMessages(tableId)) {
      if (m.type !== "RESPONSE") continue;
      for (const it of (m.payload as ResponsePayload).items) {
        byId.get(it.reviewItemId)?.responses.push(it);
      }
    }
    return order;
  }

  // ================= 产物仓库 =================

  publishArtifact(tableId: string, seat: ServerSeat, p: {
    artifactId?: string; name: string; format: "md" | "txt" | "json" | "png"; contentBase64: string; changeNote: string; requestId?: string; requestIds?: string[];
  }): ArtifactPublishedPayload {
    const meta = this.requireTable(tableId);
    if (meta.phase === "closed") throw new ApiError(409, "table_closed", "会议已结束");
    this.touchSeat(seat, tableId);
    this.checkRate(tableId, seat);
    if (!seat.caps.canPublish) {
      this.audit(tableId, seat.seatId, "policy_reject", { reason: "caps_publish" });
      throw new ApiError(403, "caps", "该席位声明无发布产物能力");
    }
    // 版本溯源请求集合（单值/批量合并去重）：单请求落 requestId（兼容旧展示），多请求落 requestIds
    const rids = [...new Set([...(p.requestIds ?? []), ...(p.requestId ? [p.requestId] : [])])];
    const traceFields: Pick<StoredArtifactVersion, "requestId" | "requestIds"> =
      rids.length === 1 ? { requestId: rids[0] } : rids.length > 1 ? { requestIds: rids } : {};
    const size = Buffer.byteLength(p.contentBase64, "base64");
    if (size > 5 * 1024 * 1024) throw new ApiError(413, "too_large", "产物超过 5MB 上限");

    const rec = p.artifactId ? this.store.getArtifact(tableId, p.artifactId) : undefined;
    if (p.artifactId && !rec) throw new ApiError(404, "no_artifact", "产物不存在");

    if (rec) {
      // 权限：owner 自改（canModifyOwn），或持有指向本席的修改请求（canExecuteRequests）——协议层强制；批量时任一 rid 命中即可
      const isOwner = rec.ownerSeat === seat.seatId && seat.caps.canModifyOwn;
      const hasReq = seat.caps.canExecuteRequests && rids.some((rid) => this.store.getRequests(tableId).some((r) =>
        r.req.requestId === rid && r.req.toSeat === seat.seatId
        && (r.req.artifactId ?? rec.artifactId) === rec.artifactId));
      if (!isOwner && !hasReq) {
        this.audit(tableId, seat.seatId, "policy_reject", { reason: "caps_write_artifact", artifactId: rec.artifactId });
        throw new ApiError(403, "caps", "非产物所有者，且无指向本席的待执行修改请求：不允许更新该产物");
      }
      if (rec.lockedBy && rec.lockedBy !== seat.seatId) throw new ApiError(409, "locked", `产物被席位 ${rec.lockedBy} 持有写锁`);
      const prev = rec.versions[rec.versions.length - 1];
      const stored: StoredArtifactVersion = {
        v: rec.versions.length + 1, sha256: this.store.saveBlob(p.contentBase64), size,
        changeNote: p.changeNote, publishedBy: seat.seatId, ts: Date.now(), ...traceFields,
        diffFromPrev: p.format === "png" ? undefined
          : unifiedDiff(this.store.readBlob(prev.sha256).toString("utf8"), Buffer.from(p.contentBase64, "base64").toString("utf8")),
      };
      rec.versions.push(stored);
      rec.lockedBy = null;
      this.store.saveArtifact(tableId, rec);
      const published: ArtifactPublishedPayload = {
        artifactId: rec.artifactId, name: rec.name, format: rec.format, ownerSeat: rec.ownerSeat,
        version: this.wireVersion(stored, p.contentBase64),
      };
      this.sysMsg(tableId, "ARTIFACT_PUBLISHED", published);
      this.audit(tableId, seat.seatId, "artifact_publish", { artifactId: rec.artifactId, version: stored.v });
      this.maybeAdvance(tableId);
      return published;
    }

    // 新产物：owner = 首发者
    const artifactId = newId("art");
    const stored: StoredArtifactVersion = {
      v: 1, sha256: this.store.saveBlob(p.contentBase64), size,
      changeNote: p.changeNote, publishedBy: seat.seatId, ts: Date.now(), ...traceFields,
    };
    const newRec = {
      artifactId, tableId, name: p.name, format: p.format, ownerSeat: seat.seatId,
      versions: [stored], lockedBy: null as string | null,
    };
    this.store.saveArtifact(tableId, newRec);
    const published: ArtifactPublishedPayload = {
      artifactId, name: p.name, format: p.format, ownerSeat: seat.seatId,
      version: this.wireVersion(stored, p.contentBase64),
    };
    this.sysMsg(tableId, "ARTIFACT_PUBLISHED", published);
    this.audit(tableId, seat.seatId, "artifact_publish", { artifactId, version: 1 });
    this.maybeAdvance(tableId);
    return published;
  }

  listArtifacts(tableId: string) {
    return this.store.getArtifacts(tableId).map((a) => ({
      artifactId: a.artifactId, name: a.name, format: a.format, ownerSeat: a.ownerSeat,
      latestVersion: a.versions.length, lockedBy: a.lockedBy,
      versions: a.versions.map((v) => ({ v: v.v, changeNote: v.changeNote, publishedBy: v.publishedBy, ts: v.ts, size: v.size, requestId: v.requestId })),
    }));
  }

  getArtifactVersion(tableId: string, artifactId: string, version?: number) {
    const rec = this.store.getArtifact(tableId, artifactId);
    if (!rec) throw new ApiError(404, "no_artifact", "产物不存在");
    const v = rec.versions[version ? version - 1 : rec.versions.length - 1];
    if (!v) throw new ApiError(404, "no_version", "版本不存在");
    return {
      artifactId, name: rec.name, format: rec.format, ownerSeat: rec.ownerSeat,
      version: this.wireVersion(v, this.store.readBlob(v.sha256).toString("base64")),
    };
  }

  /** 存储版本 → wire 版本（内容从 blob 读出；消息 payload 与内容端点共用此形状） */
  private wireVersion(sv: StoredArtifactVersion, contentBase64: string): ArtifactVersion {
    const v: ArtifactVersion = {
      v: sv.v, contentBase64, changeNote: sv.changeNote, publishedBy: sv.publishedBy, ts: sv.ts, size: sv.size,
    };
    if (sv.diffFromPrev !== undefined) v.diffFromPrev = sv.diffFromPrev;
    if (sv.requestId !== undefined) v.requestId = sv.requestId;
    if (sv.requestIds !== undefined) v.requestIds = sv.requestIds;
    return v;
  }

  diffArtifact(tableId: string, artifactId: string, from: number, to: number) {
    const rec = this.store.getArtifact(tableId, artifactId);
    if (!rec) throw new ApiError(404, "no_artifact", "产物不存在");
    const a = rec.versions[from - 1], b = rec.versions[to - 1];
    if (!a || !b) throw new ApiError(404, "no_version", "版本不存在");
    if (rec.format === "png") return { artifactId, from, to, diff: "(二进制格式无文本 diff)" };
    return {
      artifactId, from, to,
      diff: unifiedDiff(this.store.readBlob(a.sha256).toString("utf8"), this.store.readBlob(b.sha256).toString("utf8")),
    };
  }

  lockArtifact(tableId: string, seat: ServerSeat, artifactId: string, action: "acquire" | "release") {
    const rec = this.store.getArtifact(tableId, artifactId);
    if (!rec) throw new ApiError(404, "no_artifact", "产物不存在");
    if (action === "acquire") {
      if (rec.lockedBy && rec.lockedBy !== seat.seatId) {
        return { artifactId, granted: false, holder: rec.lockedBy, reason: "已被他人持有" };
      }
      rec.lockedBy = seat.seatId;
      this.store.saveArtifact(tableId, rec);
      this.audit(tableId, seat.seatId, "artifact_lock", { artifactId });
      return { artifactId, granted: true, holder: seat.seatId };
    }
    if (rec.lockedBy === seat.seatId) {
      rec.lockedBy = null;
      this.store.saveArtifact(tableId, rec);
      this.audit(tableId, seat.seatId, "artifact_lock_release", { artifactId });
      return { artifactId, granted: true, holder: null };
    }
    return { artifactId, granted: false, holder: rec.lockedBy, reason: "非持锁者" };
  }

  // ================= 资料文档（上传阅资料 / 投屏） =================

  /** 存量席位 caps 可能无 canUploadDocs 字段（旧库迁移数据）：按 canPublish 兜底 */
  private canUploadDocs(seat: ServerSeat): boolean {
    return seat.caps.canUploadDocs ?? seat.caps.canPublish;
  }

  /**
   * 上传资料文档：上传时必填作用声明（purpose）。
   * shared = 全桌可下载（投屏/共同评审依据）；private = 仅本席可下载（自带资料）。
   * 任何非 closed 阶段可传，不占发言权（与 turn 解耦），走席位限频。
   */
  uploadDocument(tableId: string, seat: ServerSeat, p: {
    name: string; purpose: string; visibility?: string; contentBase64: string;
  }): TableDocumentMeta {
    const meta = this.requireTable(tableId);
    if (meta.phase === "closed") throw new ApiError(409, "table_closed", "会议已结束，不能再上传资料");
    this.touchSeat(seat, tableId);
    this.checkRate(tableId, seat);
    if (!this.canUploadDocs(seat)) {
      this.audit(tableId, seat.seatId, "policy_reject", { reason: "caps_upload_docs" });
      throw new ApiError(403, "caps", "该席位无上传资料文档的能力（observer 只读）");
    }
    // 文件名：取净名（剥离路径成分），换行/分隔符替换，防端侧落盘路径逃逸
    const name = String(p.name ?? "").trim().replace(/[\r\n/\\]+/g, "_");
    if (!name || name.length > 200) throw new ApiError(422, "bad_payload", "name 必填（≤200 字符，取文件名不要带路径）");
    const purpose = String(p.purpose ?? "").trim();
    if (!purpose || purpose.length > 500) throw new ApiError(422, "bad_payload", "purpose（文档作用声明）必填（≤500 字符），如「待评审需求文档」「调研原始资料」");
    const visibility: DocVisibility = p.visibility === "private" ? "private" : "shared";
    if (p.visibility !== undefined && p.visibility !== "shared" && p.visibility !== "private") {
      throw new ApiError(422, "bad_payload", "visibility 只能是 shared / private");
    }
    if (!p.contentBase64) throw new ApiError(422, "bad_payload", "contentBase64 必填");
    const size = Buffer.byteLength(p.contentBase64, "base64");
    if (size === 0) throw new ApiError(422, "bad_payload", "文档内容为空");
    if (size > DOC_MAX_BYTES) throw new ApiError(413, "too_large", "资料文档超过 5MB 上限");
    const all = this.store.getDocuments(tableId);
    if (all.length >= DOCS_PER_TABLE) throw new ApiError(409, "too_many_docs", "本桌资料文档已达上限（100 份）");
    if (all.filter((d) => d.uploadedBy === seat.seatId).length >= DOCS_PER_SEAT) {
      throw new ApiError(409, "too_many_docs", "本席资料文档已达上限（20 份）");
    }

    const rec: TableDocumentRecord = {
      docId: newId("doc"), name, purpose, visibility,
      sha256: this.store.saveBlob(p.contentBase64), size,
      uploadedBy: seat.seatId, uploadedAt: Date.now(),
    };
    this.store.saveDocument(tableId, rec);
    const { sha256: _h, ...docMeta } = rec;
    void _h;
    this.sysMsg(tableId, "DOC_UPLOADED", { doc: docMeta });
    this.audit(tableId, seat.seatId, "doc_upload", { docId: rec.docId, name, visibility, size });
    return docMeta;
  }

  /** 资料列表：全部元数据可见（私有文档他席可见其存在，但内容不可下载）；seatId 给定时附 downloadable 标记 */
  listDocuments(tableId: string, seatId?: string) {
    this.requireTable(tableId);
    return this.store.getDocuments(tableId).map(({ sha256: _h, ...m }) => {
      void _h;
      return seatId
        ? { ...m, downloadable: m.visibility === "shared" || m.uploadedBy === seatId }
        : m;
    });
  }

  /** 下载资料：shared 全桌席位可下；private 仅上传席位本席（协议层强制） */
  getDocument(tableId: string, seat: ServerSeat, docId: string) {
    this.requireTable(tableId);
    this.touchSeat(seat, tableId);
    const rec = this.store.getDocument(tableId, docId);
    if (!rec) throw new ApiError(404, "no_doc", "资料文档不存在");
    if (rec.visibility === "private" && rec.uploadedBy !== seat.seatId) {
      this.audit(tableId, seat.seatId, "policy_reject", { reason: "doc_private", docId });
      throw new ApiError(403, "doc_private", "该文档为上传席位的私有资料，不提供他方下载");
    }
    this.audit(tableId, seat.seatId, "doc_download", { docId, name: rec.name });
    const { sha256: _h, ...meta } = rec;
    return { ...meta, contentBase64: this.store.readBlob(_h).toString("base64") };
  }

  /** 网页持有人（user token）上传资料：my 通道（席位身份与能力校验同 agent 通道） */
  docByUser(userToken: string, tableId: string, p: { name: string; purpose: string; visibility?: string; contentBase64: string }): TableDocumentMeta {
    const user = this.requireUser(userToken);
    const seatId = this.store.seatOfUser(tableId, user.userId);
    if (!seatId) throw new ApiError(403, "no_seat", "你在本桌没有席位，无法上传资料（先凭邀请码入席）");
    const seat = this.requireSeat(tableId, seatId) as ServerSeat;
    return this.uploadDocument(tableId, seat, p);
  }

  /** 网页持有人（user token）下载资料：my 通道 */
  getDocumentByUser(userToken: string, tableId: string, docId: string) {
    const user = this.requireUser(userToken);
    const seatId = this.store.seatOfUser(tableId, user.userId);
    if (!seatId) throw new ApiError(403, "no_seat", "你在本桌没有席位，无法下载资料（先凭邀请码入席）");
    const seat = this.requireSeat(tableId, seatId) as ServerSeat;
    return this.getDocument(tableId, seat, docId);
  }

  // ================= 席位凭证重签（恢复参会 / agent 替代） =================

  /**
   * 重签席位 token（原始 token 只存 hash 不可取回，恢复=发新凭证）：
   * - recover：旧 token 保留有效（agent 临时关闭后接续，多凭证并存）；
   * - replace：吊销本席位全部旧 token（原 agent 即使仍在轮询，下次请求即 401），
   *   可选更新 agentLabel（新 agent 标识），并广播 INFO 告知全桌。
   * 任何阶段（含 closed，供闭桌后拉纪要）可用；left 席位由 requireSeat 拒绝。
   */
  reissueSeatToken(tableId: string, seat: ServerSeat, mode: string, agentLabel?: string, by?: string): { seat: SeatInfo; token: string } {
    this.requireTable(tableId);
    if (mode !== "recover" && mode !== "replace") {
      throw new ApiError(422, "bad_payload", "mode 只能是 recover（恢复，旧凭证保留）/ replace（替代，旧凭证吊销）");
    }
    if (mode === "replace") {
      this.store.revokeSeatTokens(tableId, seat.seatId);
      const label = agentLabel?.trim();
      if (label) seat.agentLabel = label.slice(0, 64);
      this.store.saveSeat(tableId, seat);
      this.sysMsg(tableId, "INFO", {
        text: `席位「${seat.name}」凭证已轮换：原 agent 已禁用${agentLabel?.trim() ? `，接替 agent：${seat.agentLabel}` : ""}`,
        level: "warn",
      });
    }
    const token = `rts_${randomBytes(24).toString("base64url")}`;
    this.store.saveSeatToken(token, tableId, seat.seatId);
    this.audit(tableId, seat.seatId, "seat_token_reissue", { mode, agentLabel: seat.agentLabel, by: by ?? seat.seatId });
    return { seat, token };
  }

  /** 网页持有人（user token）重签本人席位凭证：my 通道（seatOfUser 限定本人，无越权面） */
  reissueByUser(userToken: string, tableId: string, mode: string, agentLabel?: string): { seat: SeatInfo; token: string } {
    const user = this.requireUser(userToken);
    const seatId = this.store.seatOfUser(tableId, user.userId);
    if (!seatId) throw new ApiError(403, "no_seat", "你在本桌没有席位（先凭邀请码入席或建桌）");
    const seat = this.requireSeat(tableId, seatId) as ServerSeat;
    return this.reissueSeatToken(tableId, seat, mode, agentLabel, user.userId);
  }

  /** systemadmin 为任意席位重签凭证（可代任何参与方恢复/替代） */
  adminReissueSeatToken(adminToken: string, tableId: string, seatId: string, mode: string, agentLabel?: string): { seat: SeatInfo; token: string } {
    const admin = this.requireAdmin(adminToken);
    this.requireTable(tableId);
    const seat = this.requireSeat(tableId, seatId);
    return this.reissueSeatToken(tableId, seat as ServerSeat, mode, agentLabel, admin.userId);
  }


  // ================= 观察端（Web 控制台） =================

  /** 参与判定：用户在本桌持有 active 席位（left 视为不再参与，与 requireSeat 拒 left 一致） */
  private activeSeatOfUser(tableId: string, userId: string): string | null {
    const seatId = this.store.seatOfUser(tableId, userId);
    if (!seatId) return null;
    const s = this.store.getSeat(tableId, seatId);
    return s && s.status !== "left" ? seatId : null;
  }

  /** 桌列表（按角色收权）：systemadmin 全量；普通用户仅自己持有 active 席位的桌 */
  tablesForUser(user: { userId: string; role: string }) {
    if (user.role === "systemadmin") return this.store.listTables();
    return this.store.listTables().filter((t) => this.activeSeatOfUser(t.tableId, user.userId));
  }

  /** 观察端桌列表：可见桌摘要 + 当前用户在各桌的席位标记（null = 无席位，供「我的席位」徽章/筛选） */
  observerTables(userId: string, role: "user" | "systemadmin" = "user") {
    return this.tablesForUser({ userId, role }).map((t) => {
      const seatId = this.store.seatOfUser(t.tableId, userId);
      const seat = seatId ? this.store.getSeat(t.tableId, seatId) : null;
      return { ...t, mySeatRole: seat ? seat.role : null, mySeatName: seat ? seat.name : null };
    });
  }

  /** 网页持有人（user token）以建桌人席位开始会议：my 通道（网页只有 user token，席位 token 在 agent 手里） */
  startByUser(userToken: string, tableId: string): { started: boolean } {
    const user = this.requireUser(userToken);
    const seatId = this.store.seatOfUser(tableId, user.userId);
    if (!seatId) throw new ApiError(403, "no_seat", "你在本桌没有席位（开始会议是建桌人专属动作）");
    const seat = this.requireSeat(tableId, seatId) as ServerSeat;
    return this.startTable(tableId, seat);
  }

  /** 桌详情（观察者视角）：状态 + 席位 + 产物 + 资料 + 请求 + 全量消息 + 变动记录 + 下一步动作；userId 给出时附 mySeatId（单方视角面板用）。
   *  收权：普通用户仅可查看自己参与的圆桌（systemadmin 全量观察） */
  observerDetail(tableId: string, userId?: string, role: "user" | "systemadmin" = "user") {
    const meta = this.requireTable(tableId);
    if (userId && role !== "systemadmin" && !this.activeSeatOfUser(tableId, userId)) {
      throw new ApiError(403, "not_participant", "仅可查看自己参与的圆桌（你在本桌没有席位）");
    }
    return {
      table: this.tableInfo(tableId),
      documents: this.listDocuments(tableId),
      requests: this.store.getRequests(tableId),
      reviewItems: this.collectReviewItems(tableId),
      messages: this.store.getMessages(tableId),
      minutes: this.store.getMessages(tableId).filter((m) => m.type === "MINUTES").at(-1)?.payload ?? null,
      recentChanges: this.changesOf(tableId, 0).slice(-50),
      meta: { createdAt: meta.createdAt, closedAt: meta.closedAt ?? null, goals: meta.goals, deliverables: meta.deliverables, rules: meta.rules, rolePlan: meta.rolePlan },
      mySeatId: userId ? this.activeSeatOfUser(tableId, userId) : null,
    };
  }

  /** 邀请码（仅建桌人）：复制入桌凭证 */
  invitesOf(tableId: string, userId: string) {
    const meta = this.requireTable(tableId);
    const ownerUserId = this.store.seatOwnerOf(tableId, meta.ownerSeat);
    if (ownerUserId !== userId) {
      throw new ApiError(403, "not_owner", "仅建桌人可查看本桌邀请码");
    }
    return { invites: this.store.invitesOfTable(tableId).map((i) => ({ code: i.code, role: i.role, usesLeft: i.usesLeft, expiresAt: i.expiresAt })) };
  }

  /** 观察端人工指令：user token → 其在本桌的席位身份发 HUMAN_INPUT（支持定向标注） */
  humanInputByUser(userToken: string, tableId: string, p: { text: string; toSeat?: string; byHuman: string }) {
    const user = this.requireUser(userToken);
    const seatId = this.store.seatOfUser(tableId, user.userId);
    if (!seatId) throw new ApiError(403, "no_seat", "你在本桌没有席位，人工指令需以席位身份发出（先入席）");
    const seat = this.requireSeat(tableId, seatId) as ServerSeat;
    if (!p.text?.trim()) throw new ApiError(422, "bad_payload", "text 必填");
    if (p.toSeat && !this.store.getSeat(tableId, p.toSeat)) throw new ApiError(404, "no_seat", "目标席位不存在");
    return this.postMessage(tableId, seat, "HUMAN_INPUT", {
      text: p.text.trim(), byHuman: p.byHuman?.trim() || user.name, toSeat: p.toSeat,
    });
  }

  /** 网页持有人（user token）完成入桌设定：与 agent 通道同一入口（open 阶段可反复修改） */
  seatConfigByUser(userToken: string, tableId: string, p: {
    stancePreset?: string; stance: string; scope?: string; dataScope?: string[]; ready?: boolean;
  }): SeatInfo {
    const user = this.requireUser(userToken);
    const seatId = this.store.seatOfUser(tableId, user.userId);
    if (!seatId) throw new ApiError(403, "no_seat", "你在本桌没有席位，无法设定（先凭邀请码入席）");
    const seat = this.requireSeat(tableId, seatId) as ServerSeat;
    return this.updateSeatConfig(tableId, seat, p);
  }

  /** 网页持有人替本席发言（人工代答）：以本席身份走全部 phase/turn/caps 校验，消息 flags 标 human_proxied。
   * 代答发送成功后 turn 被自然消费（事件溯源），agent 下次 poll 读到代答消息作为本轮答案上下文。 */
  postByUser(userToken: string, tableId: string, p: { type: MsgType; payload: unknown }): StoredMsg {
    const user = this.requireUser(userToken);
    const seatId = this.store.seatOfUser(tableId, user.userId);
    if (!seatId) throw new ApiError(403, "no_seat", "你在本桌没有席位，无法以席位身份发言（先凭邀请码入席）");
    const seat = this.requireSeat(tableId, seatId) as ServerSeat;
    if (!p.type) throw new ApiError(422, "bad_payload", "type 必填");
    return this.postMessage(tableId, seat, p.type, p.payload, ["human_proxied"]);
  }

  // ================= 管理台（systemadmin） =================

  /** 用户列表（含角色/禁用态/参桌数） */
  adminUsers(adminToken: string) {
    this.requireAdmin(adminToken);
    return this.store.listUsers().map((u) => ({ ...u, seatCount: this.store.seatsOfUser(u.userId).length }));
  }

  /** systemadmin 为用户重签登录 token：原 token 立即失效，新 token 仅本次返回（粘贴到浏览器登录框） */
  adminReissueUserToken(adminToken: string, userId: string): { userId: string; name: string; token: string } {
    const admin = this.requireAdmin(adminToken);
    const u = this.store.getUser(userId);
    if (!u) throw new ApiError(404, "no_user", "用户不存在");
    const token = `rtu_${randomBytes(24).toString("base64url")}`;
    this.store.resetUserToken(userId, sha256(token));
    this.audit("-", "-", "admin_reissue_user_token", { userId, by: admin.userId });
    return { userId, name: u.name, token };
  }

  /** 某用户的参桌明细：每席所属桌主题/阶段 + 席位名/角色/状态/就绪 */
  adminUserTables(adminToken: string, userId: string) {
    this.requireAdmin(adminToken);
    if (!this.store.getUser(userId)) throw new ApiError(404, "no_user", "用户不存在");
    return this.store.seatsOfUser(userId).map(({ tableId, seatId }) => {
      const meta = this.store.getTable(tableId);
      const seat = this.store.getSeat(tableId, seatId);
      return {
        tableId, topic: meta?.topic ?? "（桌已删除）", phase: meta?.phase ?? "-",
        seatId, seatName: seat?.name ?? seatId, role: seat?.role ?? "-", status: seat?.status ?? "left",
        ready: seat?.config?.ready ?? false,
      };
    });
  }

  /** 授予/撤销 systemadmin（界面通道；bootstrap 仍可手工标记数据文件） */
  adminSetRole(adminToken: string, userId: string, role: "user" | "systemadmin") {
    const admin = this.requireAdmin(adminToken);
    if (role !== "user" && role !== "systemadmin") throw new ApiError(422, "bad_payload", "role 只能是 user / systemadmin");
    if (!this.store.getUser(userId)) throw new ApiError(404, "no_user", "用户不存在");
    this.store.setUserRole(userId, role);
    this.audit("-", "-", "admin_set_role", { userId, role, by: admin.userId });
    return this.store.getUser(userId);
  }

  /** 强制下线（禁用）/恢复：禁用后该用户 token 全部 403，可随时恢复 */
  adminSetDisabled(adminToken: string, userId: string, disabled: boolean) {
    const admin = this.requireAdmin(adminToken);
    if (!this.store.getUser(userId)) throw new ApiError(404, "no_user", "用户不存在");
    if (disabled && userId === admin.userId) throw new ApiError(409, "self_disable", "不能禁用自己（避免唯一管理员自锁）");
    this.store.setUserDisabled(userId, disabled);
    this.audit("-", "-", "admin_set_disabled", { userId, disabled, by: admin.userId });
    return this.store.getUser(userId);
  }

  /** 邀请码：systemadmin 可看任意桌（普通用户仍仅建桌人）；观察端与管理台共用 */
  observerInvites(userToken: string, tableId: string) {
    const u = this.requireUser(userToken);
    this.requireTable(tableId);
    if (u.role === "systemadmin") {
      return { invites: this.store.invitesOfTable(tableId).map((i) => ({ code: i.code, role: i.role, usesLeft: i.usesLeft, expiresAt: i.expiresAt })) };
    }
    return this.invitesOf(tableId, u.userId);
  }

  /** 管理台看任意桌邀请码（显式 admin 鉴权入口） */
  adminInvites(adminToken: string, tableId: string) {
    this.requireAdmin(adminToken);
    return this.observerInvites(adminToken, tableId);
  }

  /** 强制闭桌：仅 active 桌；走既有 closeTable（纪要 + PHASE_CHANGE 自动留痕） */
  adminCloseTable(adminToken: string, tableId: string, reason: string) {
    const admin = this.requireAdmin(adminToken);
    const meta = this.requireTable(tableId);
    if (meta.phase === "closed") throw new ApiError(409, "table_closed", "会议已结束");
    this.audit(tableId, "-", "admin_close", { reason, by: admin.userId });
    this.closeTable(tableId, `系统观察员强制闭桌：${reason || "（未填原因）"}`);
    return { closed: true };
  }

  /** 强制人工介入：仅 active 且未在介入模式的桌 */
  adminEnterHumanMode(adminToken: string, tableId: string, reason: string) {
    const admin = this.requireAdmin(adminToken);
    const meta = this.requireTable(tableId);
    if (meta.phase === "closed") throw new ApiError(409, "table_closed", "会议已结束");
    if (meta.phase === "human_intervention") throw new ApiError(409, "already_human", "已在人工介入模式");
    this.audit(tableId, "-", "admin_human", { reason, by: admin.userId });
    this.setPhase(tableId, "human_intervention", `系统观察员介入：${reason || "（未填原因）"}`);
    return { phase: "human_intervention" };
  }

  /** 删除圆桌：连带全部数据（消息/产物/席位/邀请/token 归属），仅审计流留痕 */
  adminDeleteTable(adminToken: string, tableId: string) {
    const admin = this.requireAdmin(adminToken);
    const meta = this.requireTable(tableId);
    this.audit("-", "-", "admin_delete_table", { tableId, topic: meta.topic, phase: meta.phase, by: admin.userId });
    this.store.deleteTable(tableId);
    return { deleted: true, tableId };
  }

  // ================= 纪要 =================

  private buildMinutes(tableId: string, closeReason: string): { tableId: string; topic: string; markdown: string; finalArtifacts: { artifactId: string; name: string; version: number }[] } {
    const meta = this.requireTable(tableId);
    const seats = this.store.getSeats(tableId);
    const artifacts = this.store.getArtifacts(tableId);
    const seatName = (id: string) => seats.find((s) => s.seatId === id)?.name ?? id;
    const lines: string[] = [];
    lines.push(`# 会议纪要：${meta.topic}`);
    lines.push("");
    lines.push(`- 圆桌：${tableId} ｜ 模板：评审+协作 ｜ 结束：${new Date().toISOString()}`);
    lines.push(`- 结束方式：${closeReason}`);
    if (meta.goals) lines.push(`- 目标共识：${meta.goals}`);
    if (meta.deliverables) lines.push(`- 期望交付物：${meta.deliverables}`);
    if (meta.rules) lines.push(`- 桌规则：${meta.rules}`);
    lines.push(`- 参会席位：${seats.map((s) => `${s.name}(${s.role}/${s.agentLabel})`).join("、")}`);
    lines.push("");
    lines.push("## 各方立场与范围");
    for (const s of seats) {
      if (!s.config.stance) continue;
      lines.push(`- **${s.name}**（${s.role}）：${s.config.stance}`);
      if (s.config.scope) lines.push(`  - 讨论范围：${s.config.scope}`);
      if (s.config.dataScope.length) lines.push(`  - 数据范围：${s.config.dataScope.join("；")}`);
    }
    lines.push("");
    lines.push("## 最终产物");
    for (const a of artifacts) {
      const v = a.versions[a.versions.length - 1];
      lines.push(`- **${a.name}** (${a.artifactId}) 终版 v${v.v}：${v.changeNote}，by ${seatName(v.publishedBy)}`);
    }
    lines.push("");
    const docs = this.store.getDocuments(tableId);
    if (docs.length) {
      lines.push("## 桌内资料（上传阅文档）");
      for (const d of docs) {
        lines.push(`- **${d.name}** (${d.docId})｜作用：${d.purpose}｜${d.visibility === "shared" ? "共享·全桌可读" : "私有·仅本席"}｜by ${seatName(d.uploadedBy)}`);
      }
      lines.push("");
    }
    lines.push("## 评审意见与处置");
    const decisionLabel: Record<string, string> = { accept: "接纳", defer: "记录后续跟进", reject: "拒绝", human: "人工处理" };
    const followups: string[] = [];
    for (const r of this.collectReviewItems(tableId)) {
      const resp = r.responses[r.responses.length - 1];
      const stance = resp ? `【${decisionLabel[resp.decision] ?? resp.decision}】${resp.reason ? `：${resp.reason}` : ""}` : "（未回应）";
      lines.push(`- [${r.item.severity}] ${r.item.comment}（${seatName(r.fromSeat)}）→ ${stance}`);
      if (resp?.decision === "defer") followups.push(`${r.item.target}：${resp.reason ?? ""}`);
      if (resp?.decision === "human") followups.push(`（待人工）${r.item.target}：${r.item.comment}`);
    }
    lines.push("");
    if (followups.length) {
      lines.push("## 后续跟进清单");
      for (const f of followups) lines.push(`- ${f}`);
      lines.push("");
    }
    lines.push("## 执行请求");
    for (const r of this.store.getRequests(tableId)) {
      lines.push(`- ${r.req.title}（${seatName(r.createdBy)} → ${seatName(r.req.toSeat)}）→ ${r.status}${r.response?.reason ? `（${r.response.reason}）` : ""}`);
    }
    lines.push("");
    lines.push("## 人工介入记录");
    const humans = this.store.getMessages(tableId).filter((m) => m.type === "HUMAN_INPUT" || m.type === "HUMAN_RULING");
    if (humans.length === 0) lines.push("- （无）");
    for (const m of humans) {
      const pl = m.payload as { byHuman?: string; instruction?: string; text?: string };
      lines.push(`- ${m.fromSeat === "server" ? "服务器" : seatName(m.fromSeat)}${pl.byHuman ? `（${pl.byHuman}）` : ""}：${pl.instruction ?? pl.text ?? ""}`);
    }
    lines.push("");
    lines.push("## 表决");
    for (const v of this.store.getMessages(tableId).filter((m) => m.type === "CONSENSUS_VOTE")) {
      const pl = v.payload as { decision: string; conditions?: string };
      lines.push(`- ${seatName(v.fromSeat)}: ${pl.decision}${pl.conditions ? `（条件：${pl.conditions}）` : ""}`);
    }
    return {
      tableId, topic: meta.topic, markdown: lines.join("\n"),
      finalArtifacts: artifacts.map((a) => ({ artifactId: a.artifactId, name: a.name, version: a.versions.length })),
    };
  }

  // ================= 基础 =================

  private activeSeats(tableId: string): ServerSeat[] {
    return this.store.getSeats(tableId)
      .filter((s) => s.status !== "left")
      .sort((a, b) => a.joinedAt - b.joinedAt) as ServerSeat[];
  }

  private sysMsg(tableId: string, type: MsgType, payload: unknown): StoredMsg {
    const env = makeEnvelope({ tableId, from: "server", to: "all", type, payload });
    return this.store.addMessage(tableId, env);
  }

  private audit(tableId: string, seatId: string, event: AuditEvent, detail: Record<string, unknown>) {
    const rec: AuditRecord = { id: newId("aud"), ts: Date.now(), tableId, seatId, event, detail };
    this.store.appendAudit(rec);
  }
}
