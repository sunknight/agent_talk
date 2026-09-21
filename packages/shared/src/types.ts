/** 协议类型定义 v1 — 全部消息与领域模型的单一事实来源 */

// ---------- 席位与能力 ----------

export type Role = "proposer" | "reviewer" | "observer";

/** 能力声明：双端强制（请求方网关拒发越权请求，执行方网关拒绝越权执行） */
export interface Caps {
  /** 可发布/更新产物 */
  canPublish: boolean;
  /** 可修改自己名下产物 */
  canModifyOwn: boolean;
  /** 可接受并执行他人 modify 请求 */
  canExecuteRequests: boolean;
  /** 可发出请求 */
  canSendRequests: boolean;
  /** 共识表决权（observer 无） */
  canVote: boolean;
  /** 可上传资料文档（observer 无） */
  canUploadDocs: boolean;
}

export const ROLE_PRESETS: Record<Role, Caps> = {
  proposer: { canPublish: true, canModifyOwn: true, canExecuteRequests: true, canSendRequests: true, canVote: true, canUploadDocs: true },
  reviewer: { canPublish: true, canModifyOwn: true, canExecuteRequests: true, canSendRequests: true, canVote: true, canUploadDocs: true },
  observer: { canPublish: false, canModifyOwn: false, canExecuteRequests: false, canSendRequests: false, canVote: false, canUploadDocs: false },
};

export interface SeatInfo {
  seatId: string;
  name: string; // 持有人显示名
  role: Role;
  caps: Caps;
  agentLabel: string; // 如 "zcode" / "claude" / "human-only"
  joinedAt: number;
  status: "active" | "absent" | "left";
  /** 入桌设定（open 阶段填写，开始后只读）：立场、讨论范围、数据范围 */
  config: SeatConfig;
}

export interface SeatConfig {
  /** 选用的立场预设 ID（见 STANCE_PRESETS），可为空（纯自定义） */
  stancePreset?: string;
  /** 立场声明全文（预设文本 + 持有人补充） */
  stance: string;
  /** 本席讨论范围声明 */
  scope: string;
  /** 数据范围：桌内产物 ID / 自带文档说明（外部目录、任务等，以文本引用） */
  dataScope: string[];
  /** 是否已就绪（点开始的前置） */
  ready: boolean;
}

/** 内置立场预设（用户可在此基础上补充；服务器与网关共享展示） */
export const STANCE_PRESETS: { id: string; label: string; forRole: Role | "any"; text: string }[] = [
  {
    id: "req-owner",
    label: "需求提出方",
    forRole: "proposer",
    text: "我方是需求提出方，接受各方对需求的审阅，可以逐条进行审阅并记录审方的意见，我们可以进行评估并做出选择：接纳、记录后续跟进、拒绝和人工处理。",
  },
  {
    id: "req-reviewer",
    label: "需求评审方",
    forRole: "reviewer",
    text: "我方是需求评审方，需要结合专家技能对每一条进行逐项审核。需要结合当前项目的整体设计和相关模块的设计进行综合评判，对每一条提出准确可行的建议。",
  },
  {
    id: "design-proposer",
    label: "方案提案人",
    forRole: "proposer",
    text: "我方提出设计方案/文档，听取各方评审意见，逐条评估并回应：接纳（修改或请评审方修改）、记录后续跟进、拒绝（附理由）或交人工处理。",
  },
  {
    id: "peer-reviewer",
    label: "同行评审方",
    forRole: "reviewer",
    text: "我方对提案进行结构化评审，逐条给出 must/should/nice 级别的意见与理由，并在被请求时协助修改文档。",
  },
];

// ---------- 会议阶段 ----------

export type Phase =
  | "open" // 建桌、入席
  | "statements" // 提案人陈述并发布产物 v1
  | "review" // 评审人结构化评审
  | "response" // 提案人逐条回应（改/驳）
  | "execution" // 已接受的修改请求逐个执行（含审批）
  | "convergence" // 共识表决
  | "human_intervention" // 僵局人工介入（状态机暂停）
  | "closed"; // 出纪要，只读

// ---------- 消息类型 ----------

export type MsgType =
  // 连接与会话
  | "HELLO" | "AUTH_OK" | "AUTH_ERR" | "PING" | "PONG"
  | "ERROR" | "INFO" | "HISTORY"
  // 桌管理
  | "TABLE_CREATE" | "TABLE_CREATED" | "TABLE_LIST" | "TABLE_INFO" | "TABLE_START"
  | "SEAT_JOIN" | "SEAT_JOINED" | "SEAT_CONFIG" | "SEAT_LEAVE" | "SEAT_LEFT"
  // 调度
  | "TURN_GRANT" | "TURN_RELEASE" | "PHASE_CHANGE"
  // 讨论
  | "STATEMENT" | "QUESTION" | "REPLY"
  // 评审
  | "REVIEW_COMMENT" | "RESPONSE"
  // 请求（合作/博弈原子操作）
  | "REQUEST" | "RESPOND_REQUEST"
  // 产物
  | "ARTIFACT_PUBLISH" | "ARTIFACT_PUBLISHED" | "ARTIFACT_FETCH" | "ARTIFACT_CONTENT"
  | "ARTIFACT_LIST" | "ARTIFACT_LOCK"
  // 资料文档（上传阅资料 / 投屏）
  | "DOC_UPLOADED"
  // 收敛
  | "CONSENSUS_VOTE" | "CONSENSUS_RESULT" | "MINUTES"
  // 人工
  | "ESCALATE" | "HUMAN_INPUT" | "HUMAN_RULING";

/** 消息信封。toSeat = "all" 广播给桌内其他席位；上行 toSeat 固定 "server"。 */
export interface Envelope {
  v: 1;
  tableId: string;
  msgId: string;
  fromSeat: string; // 席位 ID；未入席的连接阶段用 "gw"
  toSeat: string; // "all" | seatId | "server"
  type: MsgType;
  payload: unknown;
  ts: number;
  /** v1.1 预留：网关对消息的 ed25519 签名 */
  sig?: string;
}

// ---------- 各消息 payload ----------

export interface HelloPayload { token: string; clientId: string; }
export interface AuthOkPayload { userId: string; serverTime: number; }
export interface ErrorPayload { code: string; message: string; refMsgId?: string; }
export interface InfoPayload { text: string; level?: "info" | "warn"; }

export interface TableSummary {
  tableId: string; topic: string; template: string; phase: Phase;
  seatCount: number; createdAt: number;
}
export interface TableListPayload { tables: TableSummary[]; }
export interface TableInfoPayload {
  tableId: string; topic: string; template: string; phase: Phase;
  /** 本次讨论要达成的共识 */
  goals: string;
  /** 期望交付物 */
  deliverables: string;
  /** 桌规则（建桌人录入，如逐条审阅、轮次上限等） */
  rules: string;
  ownerSeat: string;
  roundNo: number; deadlockCount: number;
  seats: SeatInfo[];
  artifacts: { artifactId: string; name: string; ownerSeat: string; latestVersion: number; lockedBy: string | null }[];
  activeTurn: TurnGrantPayload | null;
}

/** 建桌请求：任何已认证连接方可发。录入主题、目标、交付物、规则与参与方身份安排。 */
export interface TableCreatePayload {
  topic: string;
  template: "review-collab";
  /** 本次讨论需要达成的共识 */
  goals?: string;
  /** 期望交付物 */
  deliverables?: string;
  /** 桌规则（供各方 agent 阅读遵守，如「逐条审阅」） */
  rules?: string;
  /** 参与方身份安排说明（建桌人对各角色职责的补充描述） */
  rolePlan?: string;
  /** 建桌人自己的席位（自动成为首个席位，角色固定 proposer） */
  owner: { seatName: string; agentLabel: string };
  maxReviewRounds?: number;
  turnTimeoutMs?: number;
}
export interface TableCreatedPayload {
  table: TableInfoPayload;
  /** 分发给各参与方的邀请码（角色由建桌时定死，席位不能自封角色） */
  inviteCodes: { code: string; role: Role }[];
}
export interface TableStartPayload { reason?: string; }
export interface SeatConfigPayload {
  stancePreset?: string;
  stance: string;
  scope: string;
  dataScope: string[];
  ready: boolean;
}

export interface SeatJoinPayload {
  inviteCode: string;
  seatName: string;
  /** 期望角色，必须与邀请码角色一致（身份安排权在建桌人） */
  role: Role;
  agentLabel: string;
  /** 可省略，默认取 ROLE_PRESETS；只允许收紧不允许放宽 */
  capsOverride?: Partial<Caps>;
}
export interface SeatJoinedPayload { seat: SeatInfo; table: TableInfoPayload; }

export interface TurnGrantPayload {
  seatId: string; phase: Phase; roundNo: number;
  deadline: number; taskHint: string;
  /** execution 阶段：本 turn 需处理的请求 */
  pendingRequest?: RequestPayload;
}
export interface TurnReleasePayload { reason?: string; pass?: boolean; }
export interface PhaseChangePayload { from: Phase; to: Phase; reason: string; }

export interface StatementPayload { text: string; }
export interface QuestionPayload { text: string; toSeat?: string; }
export interface ReplyPayload { toMsgId: string; text: string; }

export type Severity = "must" | "should" | "nice";
export interface ReviewItem { id: string; target: string; severity: Severity; comment: string; }
export interface ReviewCommentPayload {
  artifactId?: string;
  /** 评审对象为资料文档时指向 docId（须为 shared 可见性） */
  docId?: string;
  items: ReviewItem[];
  summary?: string;
  /** true = 本席评审完毕，后续轮次不再需要 turn */
  done?: boolean;
}

/** 评审回应四态：接纳 / 记录后续跟进 / 拒绝 / 人工处理 */
export type ResponseDecision = "accept" | "defer" | "reject" | "human";
export interface ResponseItem {
  reviewItemId: string;
  decision: ResponseDecision;
  reason?: string;
  /** accept 时可选：转为执行请求（谁改、改什么） */
  action?: { executeBy: "self" | "reviewerSeat"; note?: string };
}
export interface ResponsePayload { items: ResponseItem[]; }

export type RequestIntent = "modify_artifact" | "clarify";
export interface RequestPayload {
  requestId: string;
  toSeat: string;
  intent: RequestIntent;
  artifactId?: string; // modify_artifact 必填
  title: string;
  detail: string; // 修改意见/澄清问题（进入对端 agent 上下文时被隔离包裹）
  sourceReviewItemId?: string; // 溯源：来自哪条评审意见
}
export type RequestDecision = "accept" | "reject" | "counter" | "escalate_human";
export interface RequestResponsePayload {
  requestId: string;
  decision: RequestDecision;
  reason?: string;
  counterDetail?: string; // counter 时的反提案
  requestIds?: string[]; // 批量处置：与 requestId 二选一，同批必须同 decision（全或无）
}

export type ArtifactFormat = "md" | "txt" | "json" | "png";
export interface ArtifactPublishPayload {
  artifactId?: string; // 空 = 新产物
  name: string;
  format: ArtifactFormat;
  contentBase64: string;
  changeNote: string;
  requestId?: string; // 执行请求产出的版本应溯源
  requestIds?: string[]; // 一个版本满足多个执行请求时批量溯源（与 requestId 可并存，去重后生效）
}
export interface ArtifactVersion {
  v: number; contentBase64: string; changeNote: string;
  publishedBy: string; ts: number; size: number;
  diffFromPrev?: string; // 文本类的 unified diff
  requestId?: string; // 执行请求产出的版本溯源
  requestIds?: string[]; // 批量溯源：本版本同时满足的多个执行请求
}
export interface ArtifactPublishedPayload {
  artifactId: string; name: string; format: ArtifactFormat; ownerSeat: string;
  version: ArtifactVersion;
}
export interface ArtifactFetchPayload { artifactId: string; version?: number; }
export interface ArtifactContentPayload {
  artifactId: string; name: string; format: ArtifactFormat; ownerSeat: string;
  version: ArtifactVersion;
}
export interface ArtifactListPayload { artifacts: TableInfoPayload["artifacts"]; }
export interface ArtifactLockPayload {
  artifactId: string; action: "acquire" | "release";
}
export interface ArtifactLockResult {
  artifactId: string; granted: boolean; holder: string | null; reason?: string;
}

// ---------- 资料文档（上传阅资料 / 投屏，与版本化产物分离） ----------

export type DocVisibility = "shared" | "private";

/** 资料文档元数据（列表/广播用，不含内容） */
export interface TableDocumentMeta {
  docId: string;
  name: string; // 原文件名，如 a.docx
  /** 上传时声明的作用，如「待评审需求文档」「调研原始资料」 */
  purpose: string;
  visibility: DocVisibility; // shared=全桌可下载（投屏）；private=仅上传席位
  size: number; // 字节
  uploadedBy: string; // seatId
  uploadedAt: number;
}

export interface DocUploadPayload {
  name: string;
  purpose: string;
  visibility?: DocVisibility; // 缺省 shared
  contentBase64: string;
}

/** 服务器广播：某席位上传了资料文档（payload 即元数据，不含内容） */
export interface DocUploadedPayload { doc: TableDocumentMeta; }

// ---------- 桌内变动记录（回合开始刷新：消息流的结构化投影 + 当前资料列表） ----------

/** 资料列表项（本席视角）：元数据 + 是否可下载 */
export type SeatDocumentMeta = TableDocumentMeta & { downloadable: boolean };

/** 单条变动：由消息流推导——DOC_UPLOADED→doc、ARTIFACT_PUBLISHED→artifact、PHASE_CHANGE→phase、
 *  SEAT_JOINED/SEAT_LEFT→seat、HUMAN_INPUT→human，其余消息记 message（只带定位信息，全文走 poll/messages） */
export type TableChange =
  | { kind: "doc"; ts: number; msgId: string; fromSeat: string; doc: TableDocumentMeta }
  | { kind: "artifact"; ts: number; msgId: string; fromSeat: string; artifactId: string; name: string; version: number; changeNote: string }
  | { kind: "phase"; ts: number; msgId: string; fromSeat: string; from: Phase; to: Phase; reason: string }
  | { kind: "seat"; ts: number; msgId: string; fromSeat: string; seatName: string; role?: Role; what: "join" | "config" | "left" }
  | { kind: "human"; ts: number; msgId: string; fromSeat: string; toSeat?: string; byHuman?: string }
  | { kind: "message"; ts: number; msgId: string; fromSeat: string; type: MsgType };

/** GET /api/tables/:id/changes 返回形状：最新桌况 + 最新资料列表（本席视角）+ since 之后的变动（按 seq 升序） */
export interface TableChangesPayload {
  table: TableInfoPayload;
  documents: SeatDocumentMeta[];
  changes: TableChange[];
  now: number;
}

export type VoteDecision = "pass" | "conditional_pass" | "reject";
export interface ConsensusVotePayload { decision: VoteDecision; conditions?: string; note?: string; }
export interface ConsensusResultPayload {
  pass: boolean; tally: Record<string, { decision: VoteDecision; conditions?: string }>;
  roundNo: number;
}
export interface MinutesPayload {
  tableId: string; topic: string;
  markdown: string; // 服务器汇总的结构化纪要
  finalArtifacts: { artifactId: string; name: string; version: number }[];
}

export interface EscalatePayload { reason: string; bySeat: string; }
export interface HumanInputPayload { text: string; byHuman: string; /** 定向席位（可选）：语义标注，消息仍全员可读 */ toSeat?: string; }
export interface HumanRulingPayload {
  instruction: string;
  resumePhase?: Phase; // 给定则恢复状态机
  forceConvergence?: boolean; // 直接判定达成共识收会
}

export interface HistoryPayload { messages: Envelope[]; note: string; }

// ---------- 领域事件（审计） ----------

export type AuditEvent =
  | "auth_ok" | "auth_fail" | "table_open"
  | "seat_join" | "seat_leave" | "seat_absent" | "seat_rejoin" | "seat_config" | "seat_token_reissue"
  | "phase_change" | "turn_grant" | "turn_timeout" | "turn_skip"
  | "artifact_publish" | "artifact_lock" | "artifact_lock_release"
  | "doc_upload" | "doc_download"
  | "request_sent" | "request_responded"
  | "vote_cast" | "consensus_result" | "escalate" | "human_input" | "human_ruling"
  | "table_close" | "policy_reject" | "server_error"
  /** 管理台（systemadmin）事件 */
  | "admin_set_role" | "admin_set_disabled" | "admin_reissue_user_token" | "admin_close" | "admin_human" | "admin_delete_table";

export interface AuditRecord {
  id: string; ts: number; tableId: string; seatId: string;
  event: AuditEvent; detail: Record<string, unknown>;
}
