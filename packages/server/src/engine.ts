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
  INJECTION_FLAG, makeEnvelope, newId, resolveCaps, scanInjection, sha256, tableTypeOf, validateEnvelope,
  type ArtifactPublishedPayload, type ArtifactVersion, type AuditEvent, type AuditRecord,
  type ConsensusResultPayload, type DocUploadedPayload, type DocVisibility, type HostPrereviewPayload,
  type HumanInputPayload, type HumanRulingPayload, type MeetingPausedPayload, type MeetingResumedPayload,
  type MsgType, type PauseInfo, type PauseRequestedPayload, type PauseRequestView, type Phase, type PhaseChangePayload,
  type PrecheckState, type QuestionPayload, type ReplyPayload, type RequestPayload, type RequestResponsePayload, type ResponsePayload,
  type ReviewCommentPayload, type Role, type SeatDocumentMeta, type SeatInfo, type SupplementPayload,
  type TableChange, type TableChangesPayload, type TableDocumentMeta, type TableType, type TableTypeDef,
  type TableInfoPayload, type TurnGrantPayload,
} from "@rt/shared";
import type { DirectiveRecord, PauseRequestRecord, RequestRecord, ReviewItemRecord, StoredArtifactVersion, StoredMsg, TableDocumentRecord, TableMeta } from "./model";
import { Store } from "./store";
import { unifiedDiff } from "./diff";
import { deepseekPrecheck, type PrecheckFn, type PrecheckInput, type PrecheckOutcome } from "./precheck";

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
/** turn 消费型消息：必须持有当前发言权才能发（hosted 桌上发出后过预审层） */
const TURN_BOUND: Partial<Record<MsgType, boolean>> = {
  STATEMENT: true, REVIEW_COMMENT: true, RESPONSE: true, RESPOND_REQUEST: true, CONSENSUS_VOTE: true,
  SUPPLEMENT: true,
};
/** 各阶段接受的会议消息（通用类型另见 COMMON_TYPES） */
const PHASE_ALLOWS: Partial<Record<Phase, MsgType[]>> = {
  open: [],
  statements: ["STATEMENT", "SUPPLEMENT"],
  review: ["REVIEW_COMMENT", "REQUEST", "SUPPLEMENT"],
  response: ["RESPONSE", "REQUEST", "SUPPLEMENT"],
  execution: ["RESPOND_REQUEST", "REQUEST", "SUPPLEMENT"],
  convergence: ["CONSENSUS_VOTE", "SUPPLEMENT"],
  human_intervention: [],
};
/** 任何活跃阶段都允许的通用类型（HUMAN_RULING 不在其中：仅人工介入阶段 + 人工通道可发，见 postMessage） */
const COMMON_TYPES: MsgType[] = ["QUESTION", "REPLY", "HUMAN_INPUT", "ESCALATE"];
/** 人工介入阶段额外放行的人工裁决（仍要求 human_proxied 通道标记） */
const HUMAN_ONLY_TYPES: MsgType[] = ["HUMAN_RULING"];
/** 服务器专属系统消息：席位直发一律拒绝（防伪造预审结论/暂停通知操纵调度） */
const SERVER_ONLY_TYPES: MsgType[] = ["HOST_PREREVIEW", "MEETING_PAUSED", "MEETING_RESUMED", "PAUSE_REQUESTED"];
/** hosted 桌预审点名链上限：同一根提交上最多连续点名次数（防 ping-pong），超出强制放行 */
const DIRECTIVE_CHAIN_MAX = 3;
/** 可暂停的会议阶段：open 未开始、human_intervention 已是人工态、closed 已结束，均不可暂停 */
const PAUSABLE_PHASES: Phase[] = ["qa", "statements", "review", "response", "execution", "convergence"];
/** 问询桌问询方虚拟席位 ID：建桌人不占席位，ownerSeat 与提问消息 fromSeat 用它标识（UI 显示「问询方」） */
const ASKER_SEAT = "asker";

/** 字段长度/范围校验：超限即 422（防巨字段撑库、撑大 poll/changes 全量响应） */
function checkField(value: string, field: string, max: number, min = 1): string {
  const v = value.trim();
  if (v.length < min) throw new ApiError(422, "bad_payload", `${field} 必填（≤${max} 字符）`);
  if (v.length > max) throw new ApiError(422, "bad_payload", `${field} 超长（≤${max} 字符）`);
  return v;
}
function checkIntField(value: number | undefined, field: string, min: number, max: number, dflt: number): number {
  if (value === undefined) return dflt;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ApiError(422, "bad_payload", `${field} 须为 ${min}~${max} 的整数`);
  }
  return value;
}

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
  /** 限频审计去重：tableId:seatId → 上次写 rate_limit 审计的时间 */
  private rateAuditTs = new Map<string, number>();
  /** hosted 桌预审进行中的桌（临界区：预审结论落地前不授出发言权） */
  private precheckInFlight = new Set<string>();
  /** 预审器（默认 DeepSeek；测试可注入） */
  private readonly precheck: PrecheckFn;

  constructor(public readonly store: Store, opts?: { precheck?: PrecheckFn }) {
    this.store.on("message", (tableId: string) => this.notify(tableId));
    this.precheck = opts?.precheck ?? deepseekPrecheck;
  }

  // ================= 用户与桌 =================

  registerUser(name: string): { userId: string; token: string } {
    const clean = checkField(name, "name", 64);
    const token = `rtu_${randomBytes(24).toString("base64url")}`;
    const userId = this.store.addUser(clean, sha256(token));
    this.audit("-", "-", "auth_ok", { name: clean });
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
   * 建桌人自动成为首个席位，并签发角色固定的邀请码（席位不能自封角色，身份安排权在建桌人）。
   * mode=self（默认）：建桌人为提案方（proposer，评审流）或协作者（collaborator，协同流），发其余角色码 —— 各方自行建桌的原流程；
   * mode=hosted：建桌人为主持人（host，只管桌与调度，不参与评审协作），按所选类型发参与方
   * 各角色码邀请各方，且每条消费发言权的回合提交过 DeepSeek 预审调度层（见 runPrecheck）。
   * tableType（缺省 review）：开桌先选类型，再按类型勾选开放邀请码的角色（inviteRoles）。
   */
  createTable(userToken: string, p: {
    topic: string; goals?: string; deliverables?: string; rules?: string; rolePlan?: string;
    mode?: "self" | "hosted";
    tableType?: string;
    inviteRoles?: string[];
    owner: { seatName: string; agentLabel: string };
    maxReviewRounds?: number; turnTimeoutMs?: number;
  }): {
    tableId: string; ownerSeatId: string; ownerSeatToken: string; tableType: TableType;
    inviteCodes: { code: string; role: "proposer" | "reviewer" | "observer" | "collaborator" | "answerer" }[];
  } {
    const user = this.requireUser(userToken);
    const mode: "self" | "hosted" = p.mode === "hosted" ? "hosted" : "self";
    const def = tableTypeOf(p.tableType ?? "review");
    if (p.tableType !== undefined && !["review", "collab", "brainstorm", "decision", "inquiry"].includes(p.tableType)) {
      throw new ApiError(422, "bad_table_type", `tableType 只能是 review / collab / brainstorm / decision / inquiry`);
    }
    if (def.id === "inquiry" && mode === "hosted") {
      throw new ApiError(422, "bad_mode", "问询桌不支持主持人模式（mode 固定 self，预审调度层不适用）");
    }
    const topic = checkField(p.topic, "topic", 300);
    const ownerSeatName = checkField(p.owner?.seatName ?? "", "owner.seatName", 64);
    const ownerAgentLabel = checkField(p.owner?.agentLabel || "unknown", "owner.agentLabel", 64, 0);
    const goals = p.goals !== undefined ? checkField(p.goals, "goals", 4_000, 0) : "";
    const deliverables = p.deliverables !== undefined ? checkField(p.deliverables, "deliverables", 4_000, 0) : "";
    const rules = p.rules !== undefined ? checkField(p.rules, "rules", 4_000, 0) : "";
    const rolePlan = p.rolePlan !== undefined ? checkField(p.rolePlan, "rolePlan", 4_000, 0) : "";
    const maxReviewRounds = checkIntField(p.maxReviewRounds, "maxReviewRounds", 1, 10, 2);
    const turnTimeoutMs = checkIntField(p.turnTimeoutMs, "turnTimeoutMs", 30_000, 3_600_000, 300_000);
    const tableId = newId("tbl");
    const meta: TableMeta = {
      tableId, topic, template: "review-collab", phase: "open", mode,
      tableType: def.id,
      goals, deliverables, rules, rolePlan, ownerSeat: "",
      roundNo: 1, deadlockCount: 0, createdAt: Date.now(), seatCount: 0,
      maxReviewRounds, turnTimeoutMs,
    };

    // 问询桌：建桌人即问询方，不占席位（ownerSeat=ASKER_SEAT 虚拟标识，提问走 my 通道）；
    // 回答方（answerer）凭邀请码入席。owner.seatName/agentLabel 仅用于审计与广播文案。
    if (def.id === "inquiry") {
      meta.ownerSeat = ASKER_SEAT;
      meta.seatCount = 0;
      this.store.saveTable(meta);
      this.store.bindSeatOwner(tableId, ASKER_SEAT, user.userId);
      const inviteRoles = p.inviteRoles !== undefined ? [...new Set(p.inviteRoles)] : def.roles.slice();
      for (const r of inviteRoles) {
        if (!def.roles.includes(r as Role)) {
          throw new ApiError(422, "bad_invite_role", `问询桌的邀请角色只能是 ${def.roles.join(" / ")}（${r} 不可选）`);
        }
      }
      const inviteCodes = inviteRoles.map((role) => ({
        code: randomBytes(5).toString("hex").toUpperCase(), role: role as "proposer" | "reviewer" | "observer" | "collaborator" | "answerer",
      }));
      for (const inv of inviteCodes) this.store.addInvite(inv.code, tableId, inv.role);
      this.sysMsg(tableId, "INFO", { text: `问询桌已创建：问询方 ${ownerSeatName}，等待回答方凭邀请码入席并设定回答范围`, level: "info" });
      this.audit(tableId, ASKER_SEAT, "table_open", { topic, by: user.name, mode, tableType: def.id, inviteRoles });
      return { tableId, ownerSeatId: ASKER_SEAT, ownerSeatToken: "", tableType: def.id, inviteCodes };
    }

    // 建桌人席位（self：评审流 proposer / 协同流 collaborator；hosted：host），绑定用户身份
    const ownerRole: "proposer" | "host" | "collaborator" =
      mode === "hosted" ? "host" : def.flow === "collab" ? "collaborator" : "proposer";
    const ownerSeatId = newId("seat");
    const ownerSeat: ServerSeat = {
      seatId: ownerSeatId, name: ownerSeatName, role: ownerRole,
      caps: resolveCaps(ownerRole, undefined), agentLabel: ownerAgentLabel,
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

    // 邀请码：按类型勾选开放角色（self 模式去掉建桌人已占的**唯一**角色；协作流的 collaborator 可多席，不剔除）
    const invitable = def.roles.filter((r) => !(mode === "self" && def.uniqueRoles.includes(r) && r === ownerRole));
    const inviteRoles = p.inviteRoles !== undefined ? [...new Set(p.inviteRoles)] : invitable;
    for (const r of inviteRoles) {
      if (!invitable.includes(r as Role)) {
        throw new ApiError(422, "bad_invite_role", `${def.label}桌的邀请角色只能是 ${invitable.join(" / ")}（${r} 不可选）`);
      }
    }
    const inviteCodes = inviteRoles.map((role) => ({
      code: randomBytes(5).toString("hex").toUpperCase(), role: role as "proposer" | "reviewer" | "observer" | "collaborator",
    }));
    for (const inv of inviteCodes) this.store.addInvite(inv.code, tableId, inv.role);

    this.sysMsg(tableId, "SEAT_JOINED", { seat: ownerSeat });
    this.audit(tableId, ownerSeatId, "table_open", { topic, by: user.name, mode, tableType: def.id, inviteRoles });
    this.audit(tableId, ownerSeatId, "seat_join", { name: ownerSeatName, role: ownerRole, owner: true });
    return { tableId, ownerSeatId, ownerSeatToken, tableType: def.id, inviteCodes };
  }

  /** 邀请码预检（Web 凭码入桌）：裸码或「完整邀请」整段文本均可，服务端提取码；只读不消费次数 */
  previewInvite(userToken: string, raw: string): {
    code: string; tableId: string; topic: string; phase: string; tableType: TableType;
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
      code, tableId: meta.tableId, topic: meta.topic, phase: meta.phase, tableType: meta.tableType,
      role: inv.role, usesLeft: inv.usesLeft, expiresAt: inv.expiresAt, seatCount: meta.seatCount,
      mySeat: seat ? { seatId: seat.seatId, name: seat.name, role: seat.role } : null,
    };
  }

  joinTable(userToken: string, tableId: string, p: {
    inviteCode: string; seatName: string; role: "proposer" | "reviewer" | "observer" | "collaborator" | "answerer"; agentLabel: string;
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
    // 唯一角色校验（按桌类型：评审流的 proposer 同桌至多一人；协作流的 collaborator 可多人）
    const uniq = tableTypeOf(meta.tableType).uniqueRoles;
    if (uniq.includes(p.role) && seats.some((s) => s.role === p.role)) {
      throw new ApiError(409, "role_exists", `本桌已有 ${p.role} 席位（建桌人）`);
    }
    const seatName = checkField(p.seatName ?? "", "seatName", 64);
    const agentLabel = checkField(p.agentLabel || "unknown", "agentLabel", 64, 0);
    checkField(p.inviteCode, "inviteCode", 64);
    // 校验全过才真正消费次数（并发下恰好被用尽则拒绝）
    if (!this.store.consumeInvite(p.inviteCode)) throw new ApiError(403, "bad_invite", "邀请码无效或已用尽");
    const seatId = newId("seat");
    const seat: ServerSeat = {
      seatId, name: seatName, role: p.role, caps: resolveCaps(p.role, p.capsOverride),
      agentLabel, joinedAt: Date.now(), status: "active", lastSeenAt: Date.now(),
      config: { stance: "", scope: "", dataScope: [], ready: false },
    };
    this.store.saveSeat(tableId, seat);
    this.store.bindSeatOwner(tableId, seatId, user.userId);
    meta.seatCount = seats.length + 1;
    this.store.saveTable(meta);
    const token = `rts_${randomBytes(24).toString("base64url")}`;
    this.store.saveSeatToken(token, tableId, seatId);
    this.sysMsg(tableId, "SEAT_JOINED", { seat });
    this.audit(tableId, seatId, "seat_join", { name: seatName, role: p.role, by: user.name });
    return { seatId, token, seat };
  }

  /** 入桌设定：立场（预设+补充）、讨论范围、数据范围、就绪标记（open 阶段与会议暂停期可反复修改）。
   *  暂停期就绪语义（动设定才重置）：保存时未显式带 ready:true 则置为未就绪——
   *  调整主张中的席位不会被视为「已补充完成」；无需补充的席位不保存即保持就绪。 */
  updateSeatConfig(tableId: string, seat: ServerSeat, p: {
    stancePreset?: string; stance: string; scope?: string; dataScope?: string[]; ready?: boolean;
  }): SeatInfo {
    const meta = this.requireTable(tableId);
    if (meta.phase !== "open" && !meta.pause) throw new ApiError(409, "already_started", "会议已开始，席位设定锁定（暂停期可调整）");
    if (seat.role === "host") throw new ApiError(403, "role", "主持人不参与就绪设定（hosted 桌由各方设定立场后由主持人点开始）");
    const stance = checkField(p.stance, "stance", 8_000);
    const scope = p.scope !== undefined ? checkField(p.scope, "scope", 4_000, 0) : "";
    const stancePreset = p.stancePreset !== undefined ? checkField(p.stancePreset, "stancePreset", 64, 0) : undefined;
    const dataScope = (p.dataScope ?? []).slice(0, 50).map((x) => checkField(x, "dataScope 条目", 500));
    const ready = meta.pause ? (p.ready ?? false) : (p.ready ?? seat.config.ready);
    seat.config = {
      stancePreset,
      stance,
      scope,
      dataScope,
      ready,
    };
    this.store.saveSeat(tableId, seat);
    this.sysMsg(tableId, "SEAT_JOINED", { seat, configUpdate: true });
    this.audit(tableId, seat.seatId, "seat_config", { ready, stancePreset: p.stancePreset, ...(meta.pause ? { paused: true } : {}) });
    return seat;
  }

  /** 点开始：建桌人专属。各方就绪 + 角色齐备 → 进入陈述阶段（主持人不参与就绪设定，豁免）。
   *  角色齐备按流程：评审流需提案方+评审方；协同流需 ≥2 位协作者（含建桌人）。 */
  startTable(tableId: string, seat: ServerSeat): { started: boolean } {
    const meta = this.requireTable(tableId);
    if (meta.phase !== "open") throw new ApiError(409, "already_started", "会议已在进行中");
    if (meta.ownerSeat !== seat.seatId) throw new ApiError(403, "not_owner", "只有建桌人可以点开始");
    if (tableTypeOf(meta.tableType).id === "inquiry") {
      throw new ApiError(409, "not_inquiry", "问询桌由问询方在网页开始（POST /api/tables/:id/start 同一入口按桌类型分流）");
    }
    const def = tableTypeOf(meta.tableType);
    const seats = this.activeSeats(tableId);
    const notReady = seats.filter((s) => !s.config.ready && s.role !== "host");
    if (notReady.length) {
      throw new ApiError(409, "not_ready", `席位未就绪：${notReady.map((s) => `${s.name}(${s.role})`).join("、")}`);
    }
    if (def.flow === "collab") {
      const collaborators = seats.filter((s) => s.role === "collaborator");
      if (collaborators.length < 2) throw new ApiError(409, "no_collaborators", `${def.label}桌需至少 2 位协作者（含建桌人），当前 ${collaborators.length} 位`);
    } else {
      if (!seats.some((s) => s.role === "proposer")) throw new ApiError(409, "no_proposer", "缺少提案方");
      if (!seats.some((s) => s.role === "reviewer")) throw new ApiError(409, "no_reviewer", "缺少评审方");
    }
    this.setPhase(tableId, "statements", `全员就绪，建桌人 ${seat.name} 开始会议`);
    return { started: true };
  }

  // ================= 问询桌（inquiry：人问 agent 答） =================

  /** 问询方归属校验：操作者是否本桌问询方（建桌人，ownerSeat=ASKER_SEAT 的绑定用户） */
  private requireInquiryOwner(meta: TableMeta, tableId: string, user: { userId: string }) {
    if (this.store.seatOwnerOf(tableId, meta.ownerSeat) !== user.userId) {
      throw new ApiError(403, "not_asker", "仅问询方（建桌人）可执行本操作");
    }
  }

  /** 问询桌开始问询（my 通道）：问询方专属；至少 1 个回答方且全部回答方就绪 → 进入问答阶段 */
  startInquiryByUser(userToken: string, tableId: string): { started: boolean } {
    const user = this.requireUser(userToken);
    const meta = this.requireTable(tableId);
    if (tableTypeOf(meta.tableType).id !== "inquiry") {
      throw new ApiError(409, "not_inquiry", "仅问询桌走问询开始（其他桌型由建桌人席位开始）");
    }
    this.requireInquiryOwner(meta, tableId, user);
    if (meta.phase !== "open") throw new ApiError(409, "already_started", "问询已在进行中");
    const answerers = this.activeSeats(tableId).filter((s) => s.role === "answerer");
    if (answerers.length === 0) {
      throw new ApiError(409, "no_answerer", "问询桌需至少 1 个回答方席位凭邀请码入席");
    }
    const notReady = answerers.filter((s) => !s.config.ready);
    if (notReady.length) {
      throw new ApiError(409, "not_ready", `回答方未就绪：${notReady.map((s) => `${s.name}(${s.role})`).join("、")}`);
    }
    this.setPhase(tableId, "qa", `回答方就绪，问询方 ${user.name} 开始问询`);
    return { started: true };
  }

  /** 问询方提问（my 通道）：qa 阶段向回答方提问；toSeat 省略=广播全体回答方各自作答，指定=仅该回答席作答 */
  askByUser(userToken: string, tableId: string, p: { text: string; toSeat?: string }): StoredMsg {
    const user = this.requireUser(userToken);
    const meta = this.requireTable(tableId);
    if (tableTypeOf(meta.tableType).id !== "inquiry") {
      throw new ApiError(409, "not_inquiry", "仅问询桌支持提问通道");
    }
    this.requireInquiryOwner(meta, tableId, user);
    if (meta.phase === "open") throw new ApiError(409, "not_started", "问询尚未开始（回答方就绪后先开始问询）");
    if (meta.phase === "closed") throw new ApiError(409, "table_closed", "问询已结束，只读");
    if (meta.phase !== "qa") throw new ApiError(409, "wrong_phase", `阶段 ${meta.phase} 不接受提问`);
    if (meta.pause) throw new ApiError(409, "meeting_paused", "问询已暂停，恢复后再提问");
    const text = checkField(p.text, "text", 4_000);
    const toSeat = p.toSeat?.trim();
    if (toSeat) {
      const target = this.store.getSeat(tableId, toSeat);
      if (!target || target.status === "left") throw new ApiError(404, "no_seat", "定向回答席位不存在");
      if (target.role !== "answerer") throw new ApiError(422, "bad_payload", "定向目标必须是回答方（answerer）席位");
    }
    const payload: QuestionPayload = toSeat ? { text, toSeat } : { text };
    const env = makeEnvelope({ tableId, from: ASKER_SEAT, to: "all", type: "QUESTION", payload });
    const v = validateEnvelope(env);
    if (!v.ok) throw new ApiError(422, "bad_payload", `消息校验失败：${v.errors.join("; ")}`);
    const msg = this.store.addMessage(tableId, env);
    this.audit(tableId, ASKER_SEAT, "asker_question", { msgId: env.msgId, toSeat: toSeat ?? "all" });
    return msg;
  }

  /** 问询方结束问询（my 通道）：open=撤桌 / qa=生成问询纪要并闭桌；暂停态须先恢复 */
  endInquiryByUser(userToken: string, tableId: string, reason?: string): { closed: boolean } {
    const user = this.requireUser(userToken);
    const meta = this.requireTable(tableId);
    if (tableTypeOf(meta.tableType).id !== "inquiry") {
      throw new ApiError(409, "not_inquiry", "仅问询桌支持结束问询");
    }
    this.requireInquiryOwner(meta, tableId, user);
    if (meta.phase === "closed") throw new ApiError(409, "table_closed", "问询已结束");
    if (meta.phase !== "open" && meta.phase !== "qa") {
      throw new ApiError(409, "wrong_phase", `阶段 ${meta.phase} 不支持结束问询`);
    }
    if (meta.pause) throw new ApiError(409, "meeting_paused", "问询已暂停，请先恢复再结束");
    this.closeTable(tableId, reason?.trim() || (meta.phase === "open" ? "问询方撤桌（未开始问询）" : "问询方结束问询"));
    return { closed: true };
  }

  /** 建桌人修改桌设定（定规则）：仅 open 阶段、建桌人专属；hosted 主持人与 self 建桌人均可用 */
  updateTableConfig(tableId: string, seat: ServerSeat, p: {
    topic?: string; goals?: string; deliverables?: string; rules?: string; rolePlan?: string;
  }): TableInfoPayload {
    const meta = this.requireTable(tableId);
    if (meta.phase !== "open") throw new ApiError(409, "already_started", "会议已开始，桌设定锁定");
    if (meta.ownerSeat !== seat.seatId) throw new ApiError(403, "not_owner", "只有建桌人可以修改桌设定");
    const upd: Partial<Pick<TableMeta, "topic" | "goals" | "deliverables" | "rules" | "rolePlan">> = {};
    if (p.topic !== undefined) upd.topic = checkField(p.topic, "topic", 300);
    if (p.goals !== undefined) upd.goals = checkField(p.goals, "goals", 4_000, 0);
    if (p.deliverables !== undefined) upd.deliverables = checkField(p.deliverables, "deliverables", 4_000, 0);
    if (p.rules !== undefined) upd.rules = checkField(p.rules, "rules", 4_000, 0);
    if (p.rolePlan !== undefined) upd.rolePlan = checkField(p.rolePlan, "rolePlan", 4_000, 0);
    if (Object.keys(upd).length === 0) throw new ApiError(422, "bad_payload", "没有可更新的字段");
    Object.assign(meta, upd);
    this.store.saveTable(meta);
    this.sysMsg(tableId, "INFO", { text: `建桌人更新了桌设定：${Object.keys(upd).join("、")}`, level: "info" });
    this.audit(tableId, seat.seatId, "table_update", { fields: Object.keys(upd) });
    return this.tableInfo(tableId);
  }

  /** 网页持有人通道：修改桌设定（user token → 建桌人席位身份） */
  updateTableConfigByUser(userToken: string, tableId: string, p: {
    topic?: string; goals?: string; deliverables?: string; rules?: string; rolePlan?: string;
  }): TableInfoPayload {
    const user = this.requireUser(userToken);
    const seatId = this.store.seatOfUser(tableId, user.userId);
    if (!seatId) throw new ApiError(403, "no_seat", "你在本桌没有席位，无法修改桌设定");
    const seat = this.requireSeat(tableId, seatId) as ServerSeat;
    return this.updateTableConfig(tableId, seat, p);
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
      tableId, topic: meta.topic, template: meta.template, phase: meta.phase, mode: meta.mode,
      tableType: meta.tableType,
      goals: meta.goals, deliverables: meta.deliverables, rules: meta.rules, ownerSeat: meta.ownerSeat,
      roundNo: meta.roundNo, deadlockCount: meta.deadlockCount, seats, artifacts,
      activeTurn: this.computeTurn(tableId),
      precheck: this.precheckState(tableId, meta),
      pause: (meta.pause ?? null) as PauseInfo | null,
    };
  }

  /** hosted 桌预审调度层状态投影（self 桌恒为 idle） */
  private precheckState(tableId: string, meta: TableMeta): PrecheckState {
    if (meta.mode !== "hosted") return { state: "idle" };
    if (this.precheckInFlight.has(tableId)) return { state: "reviewing" };
    const d = this.store.pendingDirective(tableId);
    return d ? { state: "directive", refId: d.directiveId, toSeat: d.toSeat } : { state: "idle" };
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
    // 双保险：非法 waitMs（NaN 等）按 0 处理立即返回 —— NaN deadline 会形成永不退出的忙循环
    const safeWait = Number.isFinite(waitMs) ? Math.max(0, waitMs) : 0;
    const deadline = Date.now() + safeWait;
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
      case "MEETING_PAUSED": {
        const p = m.payload as MeetingPausedPayload;
        return { kind: "pause", ...base, what: "pause", bySeat: p.bySeat, byName: p.byName, byRole: p.byRole, reason: p.reason };
      }
      case "MEETING_RESUMED": {
        const p = m.payload as MeetingResumedPayload;
        return { kind: "pause", ...base, what: "resume", bySeat: p.bySeat, byName: p.byName, byRole: p.byRole, reason: "" };
      }
      case "PAUSE_REQUESTED": {
        const p = m.payload as PauseRequestedPayload;
        return { kind: "pause", ...base, what: "request", bySeat: p.bySeat, byName: p.byName, byRole: p.byRole, reason: p.reason, requestId: p.requestId };
      }
      default:
        return { kind: "message", ...base, type: m.type };
    }
  }

  /** 本席待办提示：open 阶段按就绪状态给出设定/等待/开始指引，暂停期给出补充/就绪指引，其余阶段沿用发言权的 taskHint */
  private myTaskOf(table: TableInfoPayload, seat: ServerSeat, yourTurn: TurnGrantPayload | null): string | null {
    if (table.phase === "closed") return "会议已结束：纪要在 MINUTES 消息里，无需继续跟进";
    if (table.pause) {
      const viaReq = table.pause.via === "request" ? `（经 ${table.pause.requestedByName} 申请）` : "";
      const ctl = seat.role === "host" || table.ownerSeat === seat.seatId;
      if (ctl) {
        const notReady = table.seats.filter((s) => s.status !== "left" && !s.config.ready && s.role !== "host");
        return `会议已暂停${viaReq}（by ${table.pause.byName}）：等待各方补充信息并重新就绪${notReady.length ? `（未就绪：${notReady.map((s) => s.name).join("、")}）` : "（全员已就绪）"}；继续会议由持有人在观察端网页操作（POST /api/tables/:id/my/resume）`;
      }
      return `会议已暂停${viaReq}（by ${table.pause.byName}）：请持有人按需补充/调整本席立场（POST /api/tables/:id/seat-config，保存后须带 ready:true 重新就绪）并以 HUMAN_INPUT 下达补充信息；回合型消息在恢复前会被 409 meeting_paused 拒绝，等待 MEETING_RESUMED 后继续`;
    }
    if (table.phase === "open") {
      const def = tableTypeOf(table.tableType);
      const seats = table.seats.filter((s) => s.status !== "left");
      const notReady = seats.filter((s) => !s.config.ready && s.role !== "host");
      const rolesOk = def.flow === "collab"
        ? seats.filter((s) => s.role === "collaborator").length >= 2
        : def.flow === "inquiry"
          ? seats.some((s) => s.role === "answerer")
          : seats.some((s) => s.role === "proposer") && seats.some((s) => s.role === "reviewer");
      const rolesGap = def.flow === "collab"
        ? `角色不齐备：${def.label}桌还需协作者席位凭邀请码入席（至少 2 位协作者）`
        : def.flow === "inquiry"
          ? "角色不齐备：还需回答方席位凭邀请码入席（问询方在网页开始问询）"
          : "角色不齐备：还需提案方/评审方席位凭邀请码入席";
      if (seat.role === "host") {
        // 主持人不参与就绪设定：只看各方就绪与角色齐备，然后点开始
        if (notReady.length) return `等待各方完成设定：${notReady.map((s) => s.name).join("、")}`;
        return rolesOk ? "各方已就绪：POST /api/tables/:id/start 开始会议" : rolesGap;
      }
      if (!seat.config.ready) {
        return "入桌设定：向持有人确认立场（GET /api/stances 选预设并补充）、讨论范围、数据范围，然后 POST /api/tables/:id/seat-config 带 ready:true（向导见 skill §1.5）";
      }
      if (table.ownerSeat === seat.seatId) {
        if (notReady.length) return `等待席位完成设定：${notReady.map((s) => s.name).join("、")}`;
        return rolesOk ? "全员已就绪：POST /api/tables/:id/start 开始会议" : rolesGap;
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

  async postMessage(tableId: string, seat: ServerSeat, type: MsgType, payload: unknown, extraFlags?: string[]): Promise<StoredMsg> {
    const meta = this.requireTable(tableId);
    this.touchSeat(seat, tableId);
    this.checkRate(tableId, seat);

    if (SERVER_ONLY_TYPES.includes(type)) {
      throw new ApiError(403, "server_only", `消息类型 ${type} 为服务器专属系统消息，席位不可直发`);
    }
    // hosted 预审临界区：上一条提交的预审尚未落地时，不接受新的回合提交（防抢跑）
    if (this.precheckInFlight.has(tableId) && TURN_BOUND[type]) {
      throw new ApiError(409, "precheck_in_progress", "上一条回合提交的预审仍在进行，稍候再试");
    }

    const env = makeEnvelope({ tableId, from: seat.seatId, to: "all", type, payload });
    const v = validateEnvelope(env);
    if (!v.ok) throw new ApiError(422, "bad_payload", `消息校验失败：${v.errors.join("; ")}`);

    this.checkPhaseRules(meta, seat, type, payload, extraFlags);
    if (TURN_BOUND[type]) {
      const turn = this.computeTurn(tableId);
      if (!turn || turn.seatId !== seat.seatId) {
        throw new ApiError(409, "not_your_turn", `当前发言权：${turn ? turn.seatId : "无（阶段未就绪）"}；消息类型 ${type} 需持有发言权`);
      }
    }
    // hosted 点名期：发言权在被点名席，且回合型消息只接受其 SUPPLEMENT 提交（讨论类消息不受限）
    if (meta.mode === "hosted" && TURN_BOUND[type] && type !== "SUPPLEMENT" && this.store.pendingDirective(tableId)) {
      throw new ApiError(409, "directive_pending", "预审点名补充进行中，当前仅接受被点名席的 SUPPLEMENT 提交");
    }
    // 批量处置：requestIds 展开为逐请求的单一处置（全或无——先全部 precheck，消息入库后再逐个 apply）
    const respondPlan = type === "RESPOND_REQUEST"
      ? this.respondTargetIds(payload as RequestResponsePayload).map((rid) => ({ ...(payload as RequestResponsePayload), requestId: rid, requestIds: undefined }))
      : null;
    if (respondPlan) for (const sp of respondPlan) this.precheckRequestResponse(tableId, seat, sp);
    if (type === "SUPPLEMENT") this.precheckSupplement(tableId, seat, payload as SupplementPayload);

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
    if (type === "SUPPLEMENT") this.closeDirective(tableId, payload as SupplementPayload);
    if (type === "ESCALATE") this.enterHumanMode(tableId, `席位 ${seat.name} 申请人工介入：${String((payload as { reason?: string }).reason ?? "")}`);
    if (type === "HUMAN_INPUT") this.audit(tableId, seat.seatId, "human_input", { toSeat: (payload as { toSeat?: string }).toSeat ?? "all" });
    if (type === "HUMAN_RULING") this.applyRuling(tableId, payload as HumanRulingPayload);
    if (type === "CONSENSUS_VOTE") this.audit(tableId, seat.seatId, "vote_cast", {});

    // 主持人预审调度层（仅 hosted 桌）：消费发言权的回合提交，在原调度推导/阶段推进之前过一道预审；
    // pass/skipped → 照常 maybeAdvance；redirect → 落点名指令并压住推进，等被点名席 SUPPLEMENT。
    if (meta.mode === "hosted" && TURN_BOUND[type]) {
      await this.runPrecheck(tableId, seat, msg);
      return msg;
    }
    this.maybeAdvance(tableId);
    return msg;
  }

  /** 入站前置校验（消息入库前把关）：必须存在指向本席的挂起点名指令 */
  private precheckSupplement(tableId: string, seat: ServerSeat, p: SupplementPayload) {
    const d = this.store.pendingDirective(tableId);
    if (!d || d.directiveId !== p.directiveId) {
      throw new ApiError(422, "bad_directive", "没有待处理的预审点名指令，或 directiveId 不匹配");
    }
    if (d.toSeat !== seat.seatId) throw new ApiError(403, "not_target", "该点名指令的目标席位不是你");
  }

  /** SUPPLEMENT 入库后的指令闭合（校验已在 precheckSupplement 完成） */
  private closeDirective(tableId: string, p: SupplementPayload) {
    const d = this.store.pendingDirective(tableId);
    if (!d || d.directiveId !== p.directiveId) return;
    d.status = "closed";
    d.closedAt = Date.now();
    this.store.saveDirective(d);
    this.audit(tableId, d.toSeat, "supplement_done", { directiveId: d.directiveId });
  }

  // ================= 主持人预审调度层（hosted 桌） =================

  /**
   * 对一条回合提交执行预审并落地调度后果：
   * - pass/skipped → 广播 HOST_PREREVIEW 后照常 maybeAdvance（原调度逻辑不变）；
   * - redirect → 校验点名目标（active 的提案/评审席）与链深后落 pending 指令、广播 HOST_PREREVIEW，
   *   并**压住** maybeAdvance —— 发言权改由 computeTurn 的指令层授予被点名席；
   * - 任何失败（未配 key/超时/异常）→ skipped 放行 + 标注（fail-open，不阻塞会议）。
   */
  private async runPrecheck(tableId: string, seat: ServerSeat, msg: StoredMsg) {
    const input = this.buildPrecheckInput(tableId, seat, msg);
    this.precheckInFlight.add(tableId);
    let outcome: PrecheckOutcome;
    try {
      outcome = await this.precheck(input);
    } catch (e) {
      outcome = { verdict: "skipped", issues: [], note: `预审器异常：${e instanceof Error ? e.message : String(e)}，放行`, by: "skipped" };
    } finally {
      this.precheckInFlight.delete(tableId);
    }

    if (outcome.verdict === "redirect") {
      const demoted = this.demoteRedirect(tableId, msg, outcome);
      if (demoted) outcome = demoted;
    }

    if (outcome.verdict === "redirect") {
      const target = this.store.getSeat(tableId, outcome.targetSeatId!)!;
      const root = this.rootDirectiveOf(tableId, msg);
      const directive: DirectiveRecord = {
        directiveId: newId("dir"),
        tableId,
        toSeat: target.seatId,
        regardingMsgId: msg.msgId,
        rootDirectiveId: root,
        issues: outcome.issues,
        ...(outcome.note ? { note: outcome.note } : {}),
        createdAt: Date.now(),
        status: "pending",
      };
      this.store.saveDirective(directive);
      const seatName = (s: string) => this.store.getSeat(tableId, s)?.name ?? s;
      this.sysMsg(tableId, "HOST_PREREVIEW", {
        verdict: "redirect",
        reviewedSeatId: seat.seatId,
        reviewedMsgId: msg.msgId,
        targetSeatId: target.seatId,
        issues: outcome.issues,
        ...(outcome.note ? { note: outcome.note } : {}),
        by: outcome.by ?? "deepseek",
      } satisfies HostPrereviewPayload);
      this.sysMsg(tableId, "INFO", {
        text: `主持人预审：${seatName(seat.seatId)} 的提交需要补充 —— 点名 ${seatName(target.seatId)} 处理（directiveId=${directive.directiveId}）。补充后以 SUPPLEMENT 提交。`,
        level: "warn",
      });
      this.audit(tableId, seat.seatId, "directive_open", { directiveId: directive.directiveId, toSeat: target.seatId, regardingMsgId: msg.msgId });
      return;
    }

    // pass / skipped：广播结果，原调度照常推进
    this.sysMsg(tableId, "HOST_PREREVIEW", {
      verdict: outcome.verdict,
      reviewedSeatId: seat.seatId,
      reviewedMsgId: msg.msgId,
      issues: outcome.issues,
      ...(outcome.note ? { note: outcome.note } : {}),
      by: outcome.by ?? "deepseek",
    } satisfies HostPrereviewPayload);
    this.audit(tableId, seat.seatId, "precheck_result", { verdict: outcome.verdict, by: outcome.by ?? "deepseek" });
    this.maybeAdvance(tableId);
  }

  /** redirect 降级校验：目标席位非法或链深超限 → 改判 pass（附原因）；返回 null 表示维持 redirect */
  private demoteRedirect(tableId: string, msg: StoredMsg, outcome: PrecheckOutcome): PrecheckOutcome | null {
    const target = outcome.targetSeatId ? this.store.getSeat(tableId, outcome.targetSeatId) : null;
    // 可点名 = 在席的参与方（host / observer 不可被点名；协作桌的 collaborator 可被点名）
    if (!target || target.status === "left" || target.role === "host" || target.role === "observer") {
      return {
        verdict: "pass", issues: [],
        note: `预审点名对象无效（${outcome.targetSeatId ?? "未给出"}，须为本桌在席的参与方），本次放行：${outcome.note ?? ""}`,
        by: outcome.by,
      };
    }
    const root = this.rootDirectiveOf(tableId, msg);
    const depth = this.store.getDirectives(tableId).filter((d) => d.rootDirectiveId === root).length;
    if (depth >= DIRECTIVE_CHAIN_MAX) {
      return {
        verdict: "pass", issues: [],
        note: `同一提交上的预审点名已达 ${DIRECTIVE_CHAIN_MAX} 次上限，本次放行（主持人可用人工指令继续点名）`,
        by: outcome.by,
      };
    }
    return null;
  }

  /** 指令链根：提交本身是 SUPPLEMENT 时沿用其所闭合指令的根，否则以即将新建的指令自身为根 */
  private rootDirectiveOf(tableId: string, msg: StoredMsg): string {
    if (msg.type !== "SUPPLEMENT") return `root_${msg.msgId}`;
    const d = this.store.getDirectives(tableId).find((x) => x.directiveId === (msg.payload as SupplementPayload).directiveId);
    return d?.rootDirectiveId ?? `root_${msg.msgId}`;
  }

  /** 组装预审输入（只读快照：桌上下文/共享资料/提交席立场/提交内容/最近历史/可点名席位） */
  private buildPrecheckInput(tableId: string, seat: ServerSeat, msg: StoredMsg): PrecheckInput {
    const meta = this.requireTable(tableId);
    const seats = this.activeSeats(tableId);
    const nameOf = new Map(seats.map((s) => [s.seatId, s.name]));
    let attachmentExcerpt: string | undefined;
    const pl = (msg.payload ?? {}) as { artifactId?: string; docId?: string };
    if (msg.type === "STATEMENT") {
      // 提交席名下最新产物版本的文本摘录
      const mine = this.store.getArtifacts(tableId)
        .filter((a) => a.ownerSeat === seat.seatId)
        .flatMap((a) => a.versions.map((v) => ({ a, v })))
        .sort((x, y) => y.v.ts - x.v.ts)[0];
      if (mine && mine.a.format !== "png") {
        try { attachmentExcerpt = this.store.readBlob(mine.v.sha256).toString("utf8").slice(0, 8_000); } catch { /* blob 丢失则不带摘录 */ }
      }
    } else if (msg.type === "REVIEW_COMMENT" && pl.docId) {
      const doc = this.store.getDocument(tableId, pl.docId);
      if (doc) attachmentExcerpt = `评审对象资料：${doc.name}（作用：${doc.purpose}）`;
    }
    const history = this.store.getMessages(tableId)
      .filter((m) => m.seq < msg.seq)
      .slice(-8)
      .map((m) => ({ from: m.fromSeat === "server" ? "server" : nameOf.get(m.fromSeat) ?? m.fromSeat, type: m.type, text: JSON.stringify(m.payload) }));
    return {
      table: {
        topic: meta.topic, goals: meta.goals, deliverables: meta.deliverables, rules: meta.rules, rolePlan: meta.rolePlan,
        sharedDocs: this.store.getDocuments(tableId)
          .filter((d) => d.visibility === "shared")
          .map((d) => ({ name: d.name, purpose: d.purpose })),
      },
      seat: { name: seat.name, role: seat.role, stance: seat.config.stance, scope: seat.config.scope },
      submission: { msgId: msg.msgId, type: msg.type, payload: msg.payload, ...(attachmentExcerpt ? { attachmentExcerpt } : {}) },
      history,
      participants: seats
        .filter((s) => s.role !== "host" && s.role !== "observer")
        .map((s) => ({ seatId: s.seatId, name: s.name, role: s.role })),
    };
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
  private checkPhaseRules(meta: TableMeta, seat: ServerSeat, type: MsgType, payload: unknown, extraFlags?: string[]) {
    const p = meta.phase;
    if (p === "closed") throw new ApiError(409, "table_closed", "会议已结束，只读");
    // 暂停叠加态：仅放行讨论类通用消息（QUESTION/REPLY/HUMAN_INPUT/ESCALATE）——
    // 回合型提交、REQUEST、HUMAN_RULING 一律压住，等「继续会议」后按原阶段恢复
    if (meta.pause && !COMMON_TYPES.includes(type)) {
      throw new ApiError(409, "meeting_paused", "会议已暂停：仅接受 QUESTION / REPLY / HUMAN_INPUT / ESCALATE；补充信息或调整立场后重新就绪，等待继续会议");
    }
    const role = seat.role, caps = seat.caps;

    // 问询桌专属：提问仅问询方（网页 my 通道内部构造，席位直发必拒）；
    // 作答仅回答方、须指向问询方的提问消息且每席每题一答；暂停期问答双冻结
    // （不同于其他桌型暂停期放行旁路讨论——问询桌的 QUESTION/REPLY 即回合本体）
    if (tableTypeOf(meta.tableType).flow === "inquiry") {
      if (type === "QUESTION") {
        throw new ApiError(403, "role", "问询桌仅问询方可提问（网页提问通道）");
      }
      if (type === "REPLY") {
        if (meta.pause) throw new ApiError(409, "meeting_paused", "问询已暂停，恢复后再作答");
        if (role !== "answerer") throw new ApiError(403, "role", "问询桌仅回答方（answerer）可作答");
        const rp = payload as ReplyPayload;
        const q = this.store.getMessages(meta.tableId).find((m) => m.msgId === rp.toMsgId);
        if (!q || q.type !== "QUESTION" || q.fromSeat !== ASKER_SEAT) {
          throw new ApiError(404, "no_question", "REPLY 须指向问询方的提问消息（payload.toMsgId）");
        }
        const dup = this.store.getMessages(meta.tableId).some(
          (m) => m.type === "REPLY" && m.fromSeat === seat.seatId && (m.payload as ReplyPayload).toMsgId === rp.toMsgId);
        if (dup) throw new ApiError(409, "already_replied", "本席已回答过该问题（每席每题一答，如需补充请持有人经 HUMAN_INPUT 下达）");
      }
    }

    // 人工裁决通道闸门（先于阶段判定，保证 agent 直发任何阶段都得到明确的 403）：
    // 仅网页持有人（user token → postByUser 携带 human_proxied 标记）可发，
    // agent 席位 token 直发一律拒绝 —— 防任一参会 agent 一条消息强制闭桌/改写阶段
    if (type === "HUMAN_RULING" && !(extraFlags ?? []).includes("human_proxied")) {
      throw new ApiError(403, "human_only", "HUMAN_RULING 为人工专属（网页持有人通道）；agent 请用 ESCALATE 申请人工介入");
    }

    const phaseAllows = PHASE_ALLOWS[p] ?? [];
    if (p === "human_intervention") {
      if (![...COMMON_TYPES, ...HUMAN_ONLY_TYPES].includes(type)) {
        throw new ApiError(409, "human_mode", "人工介入模式：仅接受 HUMAN_INPUT / HUMAN_RULING（及 QUESTION/REPLY/ESCALATE）");
      }
    } else if (!phaseAllows.includes(type) && !COMMON_TYPES.includes(type)) {
      throw new ApiError(409, "wrong_phase", `阶段 ${p} 不接受消息类型 ${type}（HUMAN_RULING 仅人工介入阶段可发）`);
    }

    if (type === "STATEMENT" && !(tableTypeOf(meta.tableType).flow === "collab" ? role === "collaborator" : role === "proposer")) {
      throw new ApiError(403, "role", tableTypeOf(meta.tableType).flow === "collab" ? "仅协作者可发布初稿陈述" : "仅提案人可陈述");
    }
    if (type === "REVIEW_COMMENT" && !(tableTypeOf(meta.tableType).flow === "collab" ? role === "collaborator" : role === "reviewer")) {
      throw new ApiError(403, "role", tableTypeOf(meta.tableType).flow === "collab" ? "仅协作者可互审补缺" : "仅评审人可发评审意见");
    }
    if (type === "RESPONSE" && !(tableTypeOf(meta.tableType).flow === "collab" ? role === "collaborator" : role === "proposer")) {
      throw new ApiError(403, "role", tableTypeOf(meta.tableType).flow === "collab" ? "仅协作者可认领处置互审意见" : "仅提案人可回应评审");
    }
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
      // 审计每席位每窗口只记一条：防高频 429 重试无限撑大 audit 表
      const last = this.rateAuditTs.get(key) ?? 0;
      if (now - last >= RATE_WINDOW_MS) {
        this.rateAuditTs.set(key, now);
        this.audit(tableId, seat.seatId, "policy_reject", { reason: "rate_limit" });
      }
      throw new ApiError(429, "rate_limited", "发言过于频繁，稍候再试");
    }
    list.push(now);
    this.rateWindow.set(key, list);
    // 防御性清扫：桌删除后遗留的窗口条目不无限累积
    if (this.rateWindow.size > 10_000) {
      for (const [k, ts] of this.rateWindow) {
        if (ts.every((t) => now - t >= RATE_WINDOW_MS)) {
          this.rateWindow.delete(k);
          this.rateAuditTs.delete(k);
        }
      }
    }
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
    // 暂停叠加态：不授予任何发言权（含 hosted 预审层），恢复后事件溯源自然重推导
    if (meta.pause) return null;
    const seats = this.activeSeats(tableId);
    const proposer = seats.find((s) => s.role === "proposer");
    const reviewers = seats.filter((s) => s.role === "reviewer");
    const msgs = this.store.getMessages(tableId);
    const grant = (seatId: string, taskHint: string, pendingRequest?: RequestPayload): TurnGrantPayload => ({
      seatId, phase: meta.phase, roundNo: meta.roundNo,
      deadline: Date.now() + meta.turnTimeoutMs, taskHint, pendingRequest,
    });

    // 预审调度层（仅 hosted，在原调度之前）：预审进行中不授出发言权；点名指令挂起时发言权归被点名席
    if (meta.mode === "hosted") {
      if (this.precheckInFlight.has(tableId)) return null;
      const directive = this.store.pendingDirective(tableId);
      if (directive) {
        const issueBrief = directive.issues.slice(0, 3).map((i) => `[${i.severity}] ${i.comment}`).join("；");
        return grant(
          directive.toSeat,
          `主持人预审点名补充：${issueBrief || directive.note || "上一轮提交需要补充"}。按要求补充/修正后 POST /api/tables/:id/messages，type=SUPPLEMENT，payload={"directiveId":"${directive.directiveId}","text":"补充说明（如涉及产物请先发布新版本并在 text 中说明）"}`,
        );
      }
    }

    switch (meta.phase) {
      case "qa": {
        // 问询桌：按时间序找最早的未答完提问（本阶段起问询方 QUESTION），
        // 其应答目标（定向席 / 广播全体 answerer）中第一个未作答者获发言权（taskHint 引导 REPLY）
        const answerers = seats.filter((s) => s.role === "answerer");
        if (answerers.length === 0) return null;
        const startIdx = this.phaseStartSeq(tableId, "qa", null);
        const answered = new Map<string, Set<string>>();
        for (const m of msgs) {
          if (m.seq <= startIdx || m.type !== "REPLY") continue;
          const to = (m.payload as ReplyPayload).toMsgId;
          if (!answered.has(to)) answered.set(to, new Set());
          answered.get(to)!.add(m.fromSeat);
        }
        for (const q of msgs) {
          if (q.seq <= startIdx || q.type !== "QUESTION" || q.fromSeat !== ASKER_SEAT) continue;
          const qp = q.payload as QuestionPayload;
          const targets = qp.toSeat ? answerers.filter((s) => s.seatId === qp.toSeat) : answerers;
          const next = targets.find((s) => !answered.get(q.msgId)?.has(s.seatId));
          if (next) {
            return grant(next.seatId,
              `问询方提问待你作答：${qp.text.slice(0, 120)}…——在本席声明的讨论/数据范围内作答（超范围请明确说明并拒答、给出建议问询方向），POST /api/tables/:id/messages type=REPLY payload={"toMsgId":"${q.msgId}","text":"回答全文"}；如需文档支撑可先发布产物`);
          }
        }
        return null;
      }

      case "open": {
        const owner = seats.find((s) => s.seatId === meta.ownerSeat);
        if (!owner) return null;
        // 主持人不参与就绪设定（hosted 桌）：就绪判定只看各方
        const def = tableTypeOf(meta.tableType);
        const allReady = seats.filter((s) => s.role !== "host").every((s) => s.config.ready);
        const rolesOk = def.flow === "collab"
          ? seats.filter((s) => s.role === "collaborator").length >= 2
          : seats.some((s) => s.role === "proposer") && seats.some((s) => s.role === "reviewer");
        return grant(
          owner.seatId,
          allReady && rolesOk
            ? "全员已就绪：POST /api/tables/:id/start 开始会议"
            : "设定阶段：等待各席位 SEAT_CONFIG 就绪（立场/范围/数据范围），邀请参与方入桌后点开始",
        );
      }

      case "statements": {
        const def = tableTypeOf(meta.tableType);
        if (def.flow === "collab") {
          // 协同流：各协作者依次发布自己负责部分的初稿（产物 + STATEMENT），全员齐备自动进互审
          const collaborators = seats.filter((s) => s.role === "collaborator");
          const artifacts = this.store.getArtifacts(tableId);
          const next = collaborators.find((s) =>
            !msgs.some((m) => m.type === "STATEMENT" && m.fromSeat === s.seatId)
            || !artifacts.some((a) => a.ownerSeat === s.seatId));
          return next ? grant(next.seatId, `${def.phaseLabels.statements ?? "初稿发布"}：先 POST /api/tables/:id/artifacts 发布你负责部分的初稿产物，再发 STATEMENT 概述（分工/覆盖范围/已知缺口）；全员齐备自动进入${def.phaseLabels.review ?? "互审"}`) : null;
        }
        return proposer ? grant(proposer.seatId, "陈述提案：先 POST /api/tables/:id/artifacts 发布产物 v1，再发 STATEMENT 概述（两者齐备自动进入评审）") : null;
      }

      case "review": {
        const def = tableTypeOf(meta.tableType);
        const speakers = def.flow === "collab"
          ? seats.filter((s) => s.role === "collaborator")
          : reviewers;
        const startIdx = this.phaseStartSeq(tableId, "review", meta.roundNo);
        const spoken = new Set<string>(), done = new Set<string>();
        for (const m of msgs) {
          if (m.seq <= startIdx || m.type !== "REVIEW_COMMENT") continue;
          spoken.add(m.fromSeat);
          if ((m.payload as ReviewCommentPayload).done) done.add(m.fromSeat);
        }
        const next = speakers.find((s) => !spoken.has(s.seatId) && !done.has(s.seatId));
        return next ? grant(next.seatId, def.flow === "collab"
          ? `第 ${meta.roundNo} 轮${def.phaseLabels.review ?? "互审"}：REVIEW_COMMENT 对其他协作者的部分逐条指出缺口与建议（severity: must/should/nice；也可对自己部分提求助缺口），全部给完可 done:true`
          : `第 ${meta.roundNo} 轮评审：REVIEW_COMMENT 逐条给意见（severity: must/should/nice），全部给完可 done:true`) : null;
      }

      case "response": {
        const def = tableTypeOf(meta.tableType);
        if (def.flow === "collab") {
          // 协同流：意见归属方依次处置（产物 owner / 资料上传者 / 建桌人统稿）
          const pending = this.collabPendingResponses(tableId);
          const next = pending[0];
          return next ? grant(next.seat.seatId, `${def.phaseLabels.response ?? "缺口认领"}：有 ${next.itemIds.length} 条互审意见待你处置（GET /api/tables/:id/review-items 对照）：RESPONSE items 认领补齐（accept，action.executeBy: self 自己改 / reviewerSeat 请意见提出席改）/ defer / reject / human`) : null;
        }
        return proposer ? grant(proposer.seatId, "逐条回应评审：RESPONSE items[].decision=accept/reject（accept 可带 action.executeBy：self 自己改 / reviewerSeat 请意见提出席改）") : null;
      }

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

  /**
   * 协同流 response 阶段：本轮互审意见的归属与待回应推导（按入席顺序）。
   * 归属规则：REVIEW_COMMENT 带 artifactId → 该产物 owner；仅带 docId → 资料上传者；皆无 → 建桌人（统稿）。
   * 归属席已退席/缺失时回落建桌人；已被任何 RESPONSE 覆盖的条目视为已处置。
   */
  private collabPendingResponses(tableId: string): { seat: ServerSeat; itemIds: string[] }[] {
    const meta = this.requireTable(tableId);
    const seats = this.activeSeats(tableId);
    const msgs = this.store.getMessages(tableId);
    const reviewStart = this.phaseStartSeq(tableId, "review", meta.roundNo);
    const responded = new Set<string>();
    for (const m of msgs) {
      if (m.seq <= reviewStart || m.type !== "RESPONSE") continue;
      for (const it of (m.payload as ResponsePayload).items) responded.add(it.reviewItemId);
    }
    const byOwner = new Map<string, string[]>();
    const activeIds = new Set(seats.map((s) => s.seatId));
    for (const m of msgs) {
      if (m.seq <= reviewStart || m.type !== "REVIEW_COMMENT") continue;
      const pl = m.payload as ReviewCommentPayload;
      let owner = pl.artifactId
        ? this.store.getArtifact(tableId, pl.artifactId)?.ownerSeat
        : pl.docId
          ? this.store.getDocument(tableId, pl.docId)?.uploadedBy
          : undefined;
      if (!owner || !activeIds.has(owner)) owner = meta.ownerSeat; // 归属席退席/缺失 → 建桌人统稿兜底
      const pendingIds = pl.items.filter((it) => !responded.has(it.id)).map((it) => it.id);
      if (pendingIds.length === 0 || !activeIds.has(owner)) continue;
      byOwner.set(owner, [...(byOwner.get(owner) ?? []), ...pendingIds]);
    }
    return seats.filter((s) => byOwner.has(s.seatId)).map((s) => ({ seat: s, itemIds: byOwner.get(s.seatId)! }));
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
    // 暂停叠加态：冻结一切阶段推进（兜底 hosted 预审异步回调晚于暂停落地的竞态）
    if (meta.pause) return;
    const seats = this.activeSeats(tableId);
    const msgs = this.store.getMessages(tableId);
    const proposer = seats.find((s) => s.role === "proposer");
    const def = tableTypeOf(meta.tableType);

    switch (meta.phase) {
      case "open":
        // open 停在设定阶段：全员就绪后由建桌人 startTable 显式开始（不自动流转）
        break;

      case "qa":
        // 问询桌问答循环不自动流转：问与答都是自由消息流，结束由问询方 endInquiryByUser 显式触发
        break;

      case "statements": {
        if (def.flow === "collab") {
          const collaborators = seats.filter((s) => s.role === "collaborator");
          if (collaborators.length === 0) break;
          const artifacts = this.store.getArtifacts(tableId);
          const allDone = collaborators.every((s) =>
            msgs.some((m) => m.type === "STATEMENT" && m.fromSeat === s.seatId)
            && artifacts.some((a) => a.ownerSeat === s.seatId));
          if (allDone) this.setPhase(tableId, "review", "全部协作者已发布初稿并陈述", 1);
          break;
        }
        if (!proposer) break;
        const hasStatement = msgs.some((m) => m.type === "STATEMENT" && m.fromSeat === proposer.seatId);
        const hasArtifact = this.store.getArtifacts(tableId).some((a) => a.ownerSeat === proposer.seatId);
        if (hasStatement && hasArtifact) this.setPhase(tableId, "review", "提案已发布并陈述", 1);
        break;
      }

      case "review": {
        const startIdx = this.phaseStartSeq(tableId, "review", meta.roundNo);
        const speakers = def.flow === "collab"
          ? seats.filter((s) => s.role === "collaborator")
          : seats.filter((s) => s.role === "reviewer");
        if (speakers.length === 0) break;
        const spoken = new Set(msgs.filter((m) => m.seq > startIdx && m.type === "REVIEW_COMMENT").map((m) => m.fromSeat));
        if (speakers.every((r) => spoken.has(r.seatId))) {
          this.setPhase(tableId, "response", def.flow === "collab" ? "全部协作者已完成互审" : "全部评审人已出具意见");
          if (def.flow === "collab") this.maybeAdvance(tableId); // 归属方全部缺位时立即推进，不停在空 response
        }
        break;
      }

      case "response": {
        if (def.flow === "collab") {
          // 协同流：全部归属方处置完即推进（无归属意见时进入即推进）
          const pendingOwners = this.collabPendingResponses(tableId);
          if (pendingOwners.length > 0) break;
          const pendingReq = this.store.getRequests(tableId).some((r) => r.status === "pending");
          this.setPhase(tableId, pendingReq ? "execution" : "convergence", pendingReq ? "存在待执行的认领/补齐请求" : "互审意见已全部处置");
          break;
        }
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
    const from = meta.phase;
    this.sysMsg(tableId, "MINUTES", this.buildMinutes(tableId, reason));
    meta.phase = "closed";
    meta.closedAt = Date.now();
    this.store.saveTable(meta);
    this.sysMsg(tableId, "PHASE_CHANGE", { from, to: "closed", reason });
    this.audit(tableId, "-", "table_close", { reason });
  }

  // ================= RESPONSE → 执行请求 =================

  private deriveRequests(tableId: string, responder: ServerSeat, payload: ResponsePayload) {
    const items = this.collectReviewItems(tableId);
    for (const it of payload.items) {
      if (it.decision !== "accept") continue;
      const rec = items.find((r) => r.item.id === it.reviewItemId);
      if (!rec) continue;
      const executeBy = it.action?.executeBy ?? "self";
      const toSeat = executeBy === "self" ? responder.seatId : rec.fromSeat;
      const req: RequestPayload = {
        requestId: newId("req"),
        toSeat,
        intent: rec.artifactId ? "modify_artifact" : "clarify",
        artifactId: rec.artifactId,
        title: `[${it.reviewItemId}] ${rec.item.comment.slice(0, 80)}`,
        detail: it.action?.note || it.reason || rec.item.comment,
        sourceReviewItemId: it.reviewItemId,
      };
      const record: RequestRecord = { req, status: "pending", createdAt: Date.now(), createdBy: responder.seatId };
      this.store.saveRequest(tableId, record);
      this.sysMsg(tableId, "REQUEST", req);
      this.audit(tableId, responder.seatId, "request_sent", { requestId: req.requestId, toSeat });
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
    if (meta.pause) throw new ApiError(409, "meeting_paused", "会议已暂停，不能发布产物（继续会议后再发）");
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
    const name = checkField(p.name, "name", 200);
    const changeNote = checkField(p.changeNote, "changeNote", 2_000);
    if (!["md", "txt", "json", "png"].includes(p.format)) {
      throw new ApiError(422, "bad_payload", "format 只能是 md / txt / json / png");
    }
    const size = Buffer.byteLength(p.contentBase64, "base64");
    if (size > 5 * 1024 * 1024) throw new ApiError(413, "too_large", "产物超过 5MB 上限");

    const rec = p.artifactId ? this.store.getArtifact(tableId, p.artifactId) : undefined;
    if (p.artifactId && !rec) throw new ApiError(404, "no_artifact", "产物不存在");

    if (rec) {
      // 权限：owner 自改（canModifyOwn），或持有指向本席的修改请求（canExecuteRequests）——协议层强制；批量时任一 rid 命中即可
      const isOwner = rec.ownerSeat === seat.seatId && seat.caps.canModifyOwn;
      const hasReq = seat.caps.canExecuteRequests && rids.some((rid) => this.store.getRequests(tableId).some((r) =>
        r.req.requestId === rid && r.req.toSeat === seat.seatId
        && (r.req.artifactId ?? rec.artifactId) === rec.artifactId
        && (r.status === "pending" || r.status === "human"))); // 已完结（executed/rejected/countered）的请求不再授予写权
      if (!isOwner && !hasReq) {
        this.audit(tableId, seat.seatId, "policy_reject", { reason: "caps_write_artifact", artifactId: rec.artifactId });
        throw new ApiError(403, "caps", "非产物所有者，且无指向本席的待执行修改请求：不允许更新该产物");
      }
      if (rec.lockedBy && rec.lockedBy !== seat.seatId) throw new ApiError(409, "locked", `产物被席位 ${rec.lockedBy} 持有写锁`);
      const prev = rec.versions[rec.versions.length - 1];
      const stored: StoredArtifactVersion = {
        v: rec.versions.length + 1, sha256: this.store.saveBlob(p.contentBase64), size,
        changeNote, publishedBy: seat.seatId, ts: Date.now(), ...traceFields,
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
      changeNote, publishedBy: seat.seatId, ts: Date.now(), ...traceFields,
    };
    const newRec = {
      artifactId, tableId, name, format: p.format, ownerSeat: seat.seatId,
      versions: [stored], lockedBy: null as string | null,
    };
    this.store.saveArtifact(tableId, newRec);
    const published: ArtifactPublishedPayload = {
      artifactId, name, format: p.format, ownerSeat: seat.seatId,
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


  // ================= 会议暂停（叠加态：冻结推进，恢复后回原阶段继续） =================

  /** 控制人判定：主持人席位 / 建桌人席位（systemadmin 走 admin 入口，不占席位） */
  private isPauseController(meta: TableMeta, seat: ServerSeat): boolean {
    return seat.role === "host" || seat.seatId === meta.ownerSeat;
  }

  /** 暂停前置：会议进行中且当前未暂停 */
  private requirePauseable(meta: TableMeta) {
    if (meta.phase === "open") throw new ApiError(409, "not_meeting", "会议尚未开始（设定阶段无需暂停）");
    if (meta.phase === "human_intervention") throw new ApiError(409, "not_meeting", "已在人工介入模式（本身即等待人工的暂停态），无需再暂停");
    if (meta.phase === "closed") throw new ApiError(409, "table_closed", "会议已结束");
    if (meta.pause) throw new ApiError(409, "already_paused", "会议已暂停，请先继续会议");
  }

  /** 网页持有人通道入口的公共骨架：user token → 本桌控制人身份（席位，或问询桌的问询方），不满足即 403 */
  private controllerOf(userToken: string, tableId: string): { meta: TableMeta; by: { seatId: string; name: string; role: string } } {
    const user = this.requireUser(userToken);
    const meta = this.requireTable(tableId);
    if (tableTypeOf(meta.tableType).id === "inquiry" && this.store.seatOwnerOf(tableId, meta.ownerSeat) === user.userId) {
      return { meta, by: { seatId: ASKER_SEAT, name: user.name, role: "asker" } };
    }
    const seatId = this.store.seatOfUser(tableId, user.userId);
    if (!seatId) throw new ApiError(403, "no_seat", "你在本桌没有席位（暂停/继续会议由主持人、建桌人、系统管理员执行）");
    const seat = this.requireSeat(tableId, seatId) as ServerSeat;
    if (!this.isPauseController(meta, seat)) {
      throw new ApiError(403, "not_controller", "仅主持人/建桌人/系统管理员可执行本操作；参与方请申请暂停（POST /api/tables/:id/my/pause-request）");
    }
    return { meta, by: { seatId: seat.seatId, name: seat.name, role: seat.role } };
  }

  /**
   * 暂停核心：置叠加态（phase 不动）→ 广播 MEETING_PAUSED → 审计。
   * via=request 时记申请方（requestedBy*，审计与广播均留痕「哪方申请暂停」）；
   * 触发暂停后，剩余 pending 申请全部置 superseded（同一时刻只挂一个暂停态）。
   */
  private doPause(tableId: string, by: { seatId: string; name: string; role: string }, reason: string, via: "direct" | "request", req?: PauseRequestRecord) {
    const meta = this.requireTable(tableId);
    if (!PAUSABLE_PHASES.includes(meta.phase)) {
      throw new ApiError(409, meta.phase === "closed" ? "table_closed" : "not_meeting",
        meta.phase === "closed" ? "会议已结束" : meta.phase === "open" ? "会议尚未开始（设定阶段无需暂停）" : "人工介入模式无需暂停");
    }
    if (meta.pause) throw new ApiError(409, "already_paused", "会议已暂停，请先继续会议");
    const reasonClean = checkField(reason ?? "", "reason", 1_000, 0);
    meta.pause = {
      pausedAt: Date.now(),
      bySeat: by.seatId, byName: by.name, byRole: by.role,
      via, reason: reasonClean,
      ...(req ? { requestedBySeat: req.bySeat, requestedByName: req.byName, requestedByRole: req.byRole } : {}),
    };
    this.store.saveTable(meta);
    if (req) {
      req.status = "approved";
      req.approvedBy = by.seatId;
      req.approvedAt = Date.now();
      this.store.savePauseRequest(req);
    }
    for (const other of this.store.getPauseRequests(tableId)) {
      if (other.status === "pending" && other.requestId !== req?.requestId) {
        other.status = "superseded";
        this.store.savePauseRequest(other);
      }
    }
    this.sysMsg(tableId, "MEETING_PAUSED", {
      bySeat: by.seatId, byName: by.name, byRole: by.role, via, reason: reasonClean,
      ...(req ? { requestedBySeat: req.bySeat, requestedByName: req.byName, requestedByRole: req.byRole } : {}),
      note: "会议已暂停：各席持有人请按需人工补充或调整立场（seat-config）、给本席 agent 补充信息（HUMAN_INPUT / 资料文档）；完成后重新就绪（无需补充的席位保持就绪），全员就绪后由主持人/建桌人/系统管理员在网页继续会议。",
    } satisfies MeetingPausedPayload);
    this.audit(tableId, by.seatId, "table_pause", {
      by: by.name, role: by.role, via, reason: reasonClean,
      ...(req ? { requestedBy: { seatId: req.bySeat, name: req.byName, role: req.byRole } } : {}),
    });
    return { paused: true };
  }

  /** 网页持有人通道：主持人/建桌人（问询桌为问询方）直接暂停 */
  pauseByUser(userToken: string, tableId: string, reason: string) {
    const { by } = this.controllerOf(userToken, tableId);
    return this.doPause(tableId, by, reason, "direct");
  }

  /** 管理台：systemadmin 直接暂停（任意桌） */
  pauseByAdmin(adminToken: string, tableId: string, reason: string) {
    const admin = this.requireAdmin(adminToken);
    return this.doPause(tableId, { seatId: "-", name: admin.name, role: "systemadmin" }, reason, "direct");
  }

  /** 网页持有人通道：任意本桌席位（含 observer）申请暂停；控制人收到后在 web 同意 */
  requestPauseByUser(userToken: string, tableId: string, reason: string) {
    const user = this.requireUser(userToken);
    const seatId = this.store.seatOfUser(tableId, user.userId);
    if (!seatId) throw new ApiError(403, "no_seat", "你在本桌没有席位，无法申请暂停");
    const seat = this.requireSeat(tableId, seatId) as ServerSeat;
    const meta = this.requireTable(tableId);
    this.requirePauseable(meta);
    const reasonClean = checkField(reason ?? "", "reason", 1_000, 0);
    if (this.store.getPauseRequests(tableId).some((r) => r.status === "pending" && r.bySeat === seat.seatId)) {
      throw new ApiError(409, "dup_pause_request", "你已有一条待同意的暂停申请，请等待处理");
    }
    const rec: PauseRequestRecord = {
      requestId: newId("prq"), tableId,
      bySeat: seat.seatId, byName: seat.name, byRole: seat.role,
      reason: reasonClean, createdAt: Date.now(), status: "pending",
    };
    this.store.savePauseRequest(rec);
    this.sysMsg(tableId, "PAUSE_REQUESTED", {
      requestId: rec.requestId, bySeat: rec.bySeat, byName: rec.byName, byRole: rec.byRole, reason: reasonClean,
    } satisfies PauseRequestedPayload);
    this.audit(tableId, seat.seatId, "pause_request", { requestId: rec.requestId, by: seat.name, role: seat.role, reason: reasonClean });
    return { requestId: rec.requestId };
  }

  /** 同意暂停申请核心（控制人身份已在外层校验） */
  private doApprovePause(tableId: string, requestId: string, by: { seatId: string; name: string; role: string }) {
    const rec = this.store.getPauseRequests(tableId).find((r) => r.requestId === requestId);
    if (!rec) throw new ApiError(404, "no_request", "暂停申请不存在");
    if (rec.status !== "pending") throw new ApiError(409, "no_pending_request", `该申请已处置（${rec.status}）`);
    const requestedBy = { seatId: rec.bySeat, name: rec.byName, role: rec.byRole };
    this.doPause(tableId, by, "", "request", rec);
    this.audit(tableId, by.seatId, "pause_request_approved", { requestId, by: by.name, requestedBy });
    return { paused: true, requestId };
  }

  /** 网页持有人通道：主持人/建桌人（问询桌为问询方）同意某条暂停申请 */
  approvePauseByUser(userToken: string, tableId: string, requestId: string) {
    const { by } = this.controllerOf(userToken, tableId);
    return this.doApprovePause(tableId, requestId, by);
  }

  /** 管理台：systemadmin 同意暂停申请（任意桌） */
  approvePauseByAdmin(adminToken: string, tableId: string, requestId: string) {
    const admin = this.requireAdmin(adminToken);
    return this.doApprovePause(tableId, requestId, { seatId: "-", name: admin.name, role: "systemadmin" });
  }

  /**
   * 恢复核心：清叠加态 + 广播 + 审计。force=true 跳过就绪检查（仅 systemadmin 通道传入，记审计）。
   * 恢复无需修复动作：phase 未动、turn 事件溯源重推导、（hosted）挂起点名指令照常生效。
   */
  private doResume(tableId: string, by: { seatId: string; name: string; role: string }, force: boolean) {
    const meta = this.requireTable(tableId);
    if (!meta.pause) throw new ApiError(409, "not_paused", "会议未处于暂停状态");
    const seats = this.activeSeats(tableId);
    if (!force) {
      const notReady = seats.filter((s) => !s.config.ready && s.role !== "host");
      if (notReady.length) {
        throw new ApiError(409, "not_ready", `席位未就绪：${notReady.map((s) => `${s.name}(${s.role})`).join("、")}`);
      }
    }
    meta.pause = null;
    this.store.saveTable(meta);
    this.sysMsg(tableId, "MEETING_RESUMED", {
      bySeat: by.seatId, byName: by.name, byRole: by.role, phase: meta.phase,
      ...(force ? { forced: true } : {}),
    } satisfies MeetingResumedPayload);
    this.audit(tableId, by.seatId, "table_resume", { by: by.name, role: by.role, forced: force });
    return { resumed: true, phase: meta.phase };
  }

  /** 网页持有人通道：主持人/建桌人（问询桌为问询方）继续会议（要求全员就绪，host 豁免） */
  resumeByUser(userToken: string, tableId: string) {
    const { by } = this.controllerOf(userToken, tableId);
    return this.doResume(tableId, by, false);
  }

  /** 管理台：systemadmin 继续会议；force=true 跳过就绪检查（逃生门，记审计） */
  resumeByAdmin(adminToken: string, tableId: string, force: boolean) {
    const admin = this.requireAdmin(adminToken);
    return this.doResume(tableId, { seatId: "-", name: admin.name, role: "systemadmin" }, force);
  }

  /** 待同意的暂停申请投影（观察端「暂停申请」卡数据源） */
  private pendingPauseViews(tableId: string): PauseRequestView[] {
    return this.store.getPauseRequests(tableId)
      .filter((r) => r.status === "pending")
      .map((r) => ({ requestId: r.requestId, bySeat: r.bySeat, byName: r.byName, byRole: r.byRole, reason: r.reason, createdAt: r.createdAt }));
  }

  // ================= 观察端（Web 控制台） =================

  /** 参与判定：用户在本桌持有 active 席位（left 视为不再参与，与 requireSeat 拒 left 一致） */
  private activeSeatOfUser(tableId: string, userId: string): string | null {
    const seatId = this.store.seatOfUser(tableId, userId);
    if (!seatId) return null;
    const s = this.store.getSeat(tableId, seatId);
    return s && s.status !== "left" ? seatId : null;
  }

  /** 桌列表（按角色收权）：systemadmin 全量；普通用户 = 自己持有 active 席位的桌 + 自己是问询方的问询桌 */
  tablesForUser(user: { userId: string; role: string }) {
    if (user.role === "systemadmin") return this.store.listTables();
    return this.store.listTables().filter((t) =>
      this.activeSeatOfUser(t.tableId, user.userId)
      || (tableTypeOf(t.tableType).id === "inquiry" && this.store.seatOwnerOf(t.tableId, t.ownerSeat) === user.userId));
  }

  /** 观察端桌列表：可见桌摘要 + 当前用户在各桌的席位标记（null = 无席位，供「我的席位」徽章/筛选）；
   *  问询桌的问询方（无席位）以 mySeatRole="asker" 标记 */
  observerTables(userId: string, role: "user" | "systemadmin" = "user") {
    return this.tablesForUser({ userId, role }).map((t) => {
      const seatId = this.store.seatOfUser(t.tableId, userId);
      const seat = seatId ? this.store.getSeat(t.tableId, seatId) : null;
      if (!seat && tableTypeOf(t.tableType).id === "inquiry" && this.store.seatOwnerOf(t.tableId, t.ownerSeat) === userId) {
        return { ...t, mySeatRole: "asker" as const, mySeatName: null };
      }
      return { ...t, mySeatRole: seat ? seat.role : null, mySeatName: seat ? seat.name : null };
    });
  }

  /** 网页持有人（user token）以建桌人席位开始会议：my 通道（网页只有 user token，席位 token 在 agent 手里） */
  startByUser(userToken: string, tableId: string): { started: boolean } {
    // 问询桌：问询方（建桌人）不占席位，同一入口分流到问询开始
    if (tableTypeOf(this.requireTable(tableId).tableType).id === "inquiry") {
      return this.startInquiryByUser(userToken, tableId);
    }
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
    const isAsker = tableTypeOf(meta.tableType).id === "inquiry" && this.store.seatOwnerOf(tableId, meta.ownerSeat) === userId;
    if (userId && role !== "systemadmin" && !this.activeSeatOfUser(tableId, userId) && !isAsker) {
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
      /** 问询桌：当前用户是否问询方（建桌人，无席位）——详情页提问区/结束按钮的显示依据 */
      isAsker: userId ? isAsker : false,
      pauseRequests: this.pendingPauseViews(tableId),
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
  async humanInputByUser(userToken: string, tableId: string, p: { text: string; toSeat?: string; byHuman: string }) {
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
  async postByUser(userToken: string, tableId: string, p: { type: MsgType; payload: unknown }): Promise<StoredMsg> {
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
        tableId, topic: meta?.topic ?? "（桌已删除）", phase: meta?.phase ?? "-", tableType: meta?.tableType ?? "review",
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
  adminCloseTable(adminToken: string, tableId: string, reasonRaw: string) {
    const admin = this.requireAdmin(adminToken);
    const meta = this.requireTable(tableId);
    if (meta.phase === "closed") throw new ApiError(409, "table_closed", "会议已结束");
    const reason = checkField(reasonRaw ?? "", "reason", 1_000, 0);
    this.audit(tableId, "-", "admin_close", { reason, by: admin.userId });
    this.closeTable(tableId, `系统观察员强制闭桌：${reason || "（未填原因）"}`);
    return { closed: true };
  }

  /** 强制人工介入：仅 active 且未在介入模式的桌 */
  adminEnterHumanMode(adminToken: string, tableId: string, reasonRaw: string) {
    const admin = this.requireAdmin(adminToken);
    const meta = this.requireTable(tableId);
    if (meta.phase === "closed") throw new ApiError(409, "table_closed", "会议已结束");
    if (meta.phase === "human_intervention") throw new ApiError(409, "already_human", "已在人工介入模式");
    const reason = checkField(reasonRaw ?? "", "reason", 1_000, 0);
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

  /** 问询纪要：问答对汇总 + 回答方范围声明 + 产物/资料（无评审与表决段） */
  private buildInquiryMinutes(tableId: string, meta: TableMeta, closeReason: string): { tableId: string; topic: string; markdown: string; finalArtifacts: { artifactId: string; name: string; version: number }[] } {
    const seats = this.store.getSeats(tableId);
    const artifacts = this.store.getArtifacts(tableId);
    const msgs = this.store.getMessages(tableId);
    const seatName = (id: string) => seats.find((s) => s.seatId === id)?.name ?? id;
    const askerId = this.store.seatOwnerOf(tableId, meta.ownerSeat);
    const askerName = askerId ? this.store.listUsers().find((u) => u.userId === askerId)?.name ?? "问询方" : "问询方";
    const lines: string[] = [];
    lines.push(`# 问询纪要：${meta.topic}`);
    lines.push("");
    lines.push(`- 圆桌：${tableId} ｜ 桌类型：${tableTypeOf(meta.tableType).label} ｜ 结束：${new Date().toISOString()}`);
    lines.push(`- 结束方式：${closeReason}`);
    if (meta.goals) lines.push(`- 问询目标：${meta.goals}`);
    if (meta.rules) lines.push(`- 桌规则：${meta.rules}`);
    lines.push(`- 问询方：${askerName}（未答问题即问询方自行决断）`);
    const answerers = seats.filter((s) => s.role === "answerer");
    lines.push(`- 回答方席位：${answerers.map((s) => `${s.name}(${s.agentLabel})`).join("、") || "（无）"}`);
    lines.push("");
    lines.push("## 回答方立场与范围");
    for (const s of answerers) {
      if (!s.config.stance) continue;
      lines.push(`- **${s.name}**：${s.config.stance}`);
      if (s.config.scope) lines.push(`  - 回答范围：${s.config.scope}`);
      if (s.config.dataScope.length) lines.push(`  - 数据范围：${s.config.dataScope.join("；")}`);
    }
    lines.push("");
    lines.push("## 问答记录");
    const questions = msgs.filter((m) => m.type === "QUESTION" && m.fromSeat === ASKER_SEAT);
    if (questions.length === 0) lines.push("- （无提问）");
    for (const q of questions) {
      const qp = q.payload as QuestionPayload;
      const target = qp.toSeat ? `（定向 ${seatName(qp.toSeat)}）` : "（广播全体回答方）";
      lines.push(`- **问**：${qp.text}${target}`);
      const replies = msgs.filter((m) => m.type === "REPLY" && (m.payload as ReplyPayload).toMsgId === q.msgId);
      if (replies.length === 0) lines.push("  - （未获作答）");
      for (const r of replies) {
        lines.push(`  - **${seatName(r.fromSeat)} 答**：${(r.payload as ReplyPayload).text}`);
      }
    }
    lines.push("");
    if (artifacts.length) {
      lines.push("## 最终产物");
      for (const a of artifacts) {
        const v = a.versions[a.versions.length - 1];
        lines.push(`- **${a.name}** (${a.artifactId}) 终版 v${v.v}：${v.changeNote}，by ${seatName(v.publishedBy)}`);
      }
      lines.push("");
    }
    const docs = this.store.getDocuments(tableId);
    if (docs.length) {
      lines.push("## 桌内资料（上传阅文档）");
      for (const d of docs) {
        lines.push(`- **${d.name}** (${d.docId})｜作用：${d.purpose}｜${d.visibility === "shared" ? "共享·全桌可读" : "私有·仅本席"}｜by ${seatName(d.uploadedBy)}`);
      }
      lines.push("");
    }
    const humans = msgs.filter((m) => m.type === "HUMAN_INPUT" || m.type === "HUMAN_RULING");
    if (humans.length) {
      lines.push("## 人工介入记录");
      for (const m of humans) {
        const pl = m.payload as { byHuman?: string; instruction?: string; text?: string };
        lines.push(`- ${m.fromSeat === "server" ? "服务器" : seatName(m.fromSeat)}${pl.byHuman ? `（${pl.byHuman}）` : ""}：${pl.instruction ?? pl.text ?? ""}`);
      }
      lines.push("");
    }
    return {
      tableId, topic: meta.topic, markdown: lines.join("\n"),
      finalArtifacts: artifacts.map((a) => ({ artifactId: a.artifactId, name: a.name, version: a.versions.length })),
    };
  }

  private buildMinutes(tableId: string, closeReason: string): { tableId: string; topic: string; markdown: string; finalArtifacts: { artifactId: string; name: string; version: number }[] } {
    const meta = this.requireTable(tableId);
    if (tableTypeOf(meta.tableType).flow === "inquiry") return this.buildInquiryMinutes(tableId, meta, closeReason);
    const seats = this.store.getSeats(tableId);
    const artifacts = this.store.getArtifacts(tableId);
    const seatName = (id: string) => seats.find((s) => s.seatId === id)?.name ?? id;
    const lines: string[] = [];
    lines.push(`# 会议纪要：${meta.topic}`);
    lines.push("");
    lines.push(`- 圆桌：${tableId} ｜ 桌类型：${tableTypeOf(meta.tableType).label}${meta.mode === "hosted" ? "（主持人模式）" : ""} ｜ 结束：${new Date().toISOString()}`);
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
