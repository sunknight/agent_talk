/** 协议类型定义 v1 — 全部消息与领域模型的单一事实来源 */

// ---------- 席位与能力 ----------

export type Role = "proposer" | "reviewer" | "observer" | "host" | "collaborator" | "answerer" | "asker";

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
  /** 协作者（协作/头脑风暴桌）：与提案方同权——发布自己负责的部分、互审补缺、认领补齐、定稿表决 */
  collaborator: { canPublish: true, canModifyOwn: true, canExecuteRequests: true, canSendRequests: true, canVote: true, canUploadDocs: true },
  observer: { canPublish: false, canModifyOwn: false, canExecuteRequests: false, canSendRequests: false, canVote: false, canUploadDocs: false },
  /** 主持人：只负责初始化圆桌（建桌/定规则/传文档/邀请）与调度管理，不参与评审与协作 */
  host: { canPublish: false, canModifyOwn: false, canExecuteRequests: false, canSendRequests: false, canVote: false, canUploadDocs: true },
  /** 回答方（问询桌）：在声明范围内答问询方所问，可发布产物支撑回答 */
  answerer: { canPublish: true, canModifyOwn: true, canExecuteRequests: true, canSendRequests: true, canVote: true, canUploadDocs: true },
  /** 问询方（主持人建问询桌时凭码加入的角色）：不占席位，提问/开始/结束问询走网页 user token 通道，无席位能力 */
  asker: { canPublish: false, canModifyOwn: false, canExecuteRequests: false, canSendRequests: false, canVote: false, canUploadDocs: false },
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

/** 内置立场预设（用户可在此基础上补充；服务器与网关共享展示）。
 *  forTypes 缺省 = 适用所有桌类型；带 forTypes 的预设只在该类型桌的设定界面出现。 */
export const STANCE_PRESETS: { id: string; label: string; forRole: Role | "any"; text: string; forTypes?: TableType[] }[] = [
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
  {
    id: "coauthor-lead",
    label: "分工协作者",
    forRole: "collaborator",
    forTypes: ["collab"],
    text: "我方是协作者，负责自己分工部分的初稿撰写与后续补齐；主动说明自己部分的已知缺口并求助，也审阅他人部分、指出缺口并支援补缺。对指向自己产物的意见逐条处置：认领补齐（自己改或请意见提出方协助）、记录后续、拒绝或交人工。",
  },
  {
    id: "gap-supporter",
    label: "支援协作者",
    forRole: "collaborator",
    forTypes: ["collab"],
    text: "我方侧重支援：认真审阅各协作者的部分，逐条指出缺口与可行补法（must/should/nice），可被请求或主动认领补齐他人部分；同样完成自己的分工初稿。",
  },
  {
    id: "idea-contributor",
    label: "点子贡献者",
    forRole: "collaborator",
    forTypes: ["brainstorm"],
    text: "我方贡献点子并展开可行性论证，欢迎他人补充与挑战；对他人的点子给出 must/should/nice 级别的补充建议，共同收敛出结构化清单。",
  },
  {
    id: "idea-merger",
    label: "点子整合者",
    forRole: "collaborator",
    forTypes: ["brainstorm"],
    text: "我方负责把散点整合成结构化清单：归类去重、标注成熟度与归属，对无法归位的点子提出澄清问题，最终交付一份可执行的清单。",
  },
  {
    id: "option-owner",
    label: "方案主张方",
    forRole: "proposer",
    forTypes: ["decision"],
    text: "我方是方案主张方，陈述选型主张与依据（收益/成本/风险），逐条回应评估意见：接纳并调整主张、记录保留意见、坚持原案（附理由）或交人工裁决。",
  },
  {
    id: "option-evaluator",
    label: "方案评估方",
    forRole: "reviewer",
    forTypes: ["decision"],
    text: "我方独立评估候选方案：按可行性/成本/风险/迁移代价等维度逐条给出 must/should/nice 级意见，结论面向「选哪个、为何、条件是什么」。",
  },
  {
    id: "scope-answerer",
    label: "范围答疑者",
    forRole: "answerer",
    forTypes: ["inquiry"],
    text: "我方是回答方，仅在本席声明的讨论范围与数据范围内作答：范围内给出准确、有依据的答案；超出范围的提问明确说明不在声明范围内、不作答，并建议可行的问询方向。",
  },
];

// ---------- 会议阶段 ----------

export type Phase =
  | "open" // 建桌、入席
  | "qa" // 问答（问询桌专用：问询方提问、回答方作答的循环，无轮次推进）
  | "statements" // 提案人陈述并发布产物 v1（协作流：各协作者依次发布负责部分初稿）
  | "review" // 评审人结构化评审（协作流：协作者互审补缺）
  | "response" // 提案人逐条回应（协作流：意见归属方逐条处置缺口）
  | "execution" // 已接受的修改请求逐个执行（含审批）
  | "convergence" // 共识表决
  | "human_intervention" // 僵局人工介入（状态机暂停）
  | "closed"; // 出纪要，只读

// ---------- 桌类型 ----------

/** 桌类型：开桌时选定，决定可选角色与流程语义；头脑风暴/方案决策为两种流程形态的变体 */
export type TableType = "review" | "collab" | "brainstorm" | "decision" | "inquiry";

/** 流程形态：review = 博弈评审流（提案 vs 评审）；collab = 协同流（全员共创、互审补缺）；inquiry = 问询流（人问 agent 答） */
export type FlowShape = "review" | "collab" | "inquiry";

export interface TableTypeDef {
  id: TableType;
  /** 中文名（UI 徽章 / 开桌表单） */
  label: string;
  /** 一句话说明（开桌表单卡片） */
  description: string;
  flow: FlowShape;
  /** 该类型可用的参与角色（不含 host——host 由 hosted 建桌模式引入，任何类型可用） */
  roles: Role[];
  /** 唯一席位角色（同桌至多一人，如评审流的 proposer） */
  uniqueRoles: Role[];
  /** 阶段显示名（按流程语义差异化；缺省项用评审流默认文案） */
  phaseLabels: Partial<Record<Phase, string>>;
}

/** 桌类型注册表（单一事实来源：REST / 观察端 / skill 共享） */
export const TABLE_TYPES: TableTypeDef[] = [
  {
    id: "review", label: "评审",
    description: "提案方与评审方博弈：陈述 → 逐条评审 → 四态回应 → 执行 → 表决",
    flow: "review", roles: ["proposer", "reviewer", "observer"], uniqueRoles: ["proposer"],
    phaseLabels: {},
  },
  {
    id: "collab", label: "协作",
    description: "同事协作完成交付：各自初稿 → 互审补缺 → 缺口认领 → 补齐执行 → 定稿表决",
    flow: "collab", roles: ["collaborator", "observer"], uniqueRoles: [],
    phaseLabels: { statements: "初稿发布", review: "互审补缺", response: "缺口认领", execution: "补齐执行", convergence: "定稿表决" },
  },
  {
    id: "brainstorm", label: "头脑风暴",
    description: "共创点子清单：点子提交 → 互评补充 → 认领整合 → 整合执行 → 清单定稿",
    flow: "collab", roles: ["collaborator", "observer"], uniqueRoles: [],
    phaseLabels: { statements: "点子提交", review: "互评补充", response: "认领整合", execution: "整合执行", convergence: "清单定稿" },
  },
  {
    id: "decision", label: "方案决策",
    description: "主张方与评估方对垒选型：方案陈述 → 方案评估 → 决策回应 → 调整执行 → 决议表决",
    flow: "review", roles: ["proposer", "reviewer", "observer"], uniqueRoles: ["proposer"],
    phaseLabels: { statements: "方案陈述", review: "方案评估", response: "决策回应", execution: "调整执行", convergence: "决议表决" },
  },
  {
    id: "inquiry", label: "问询",
    description: "人问 agent 答：web 提问 → 回答方在声明范围内作答 → 问询纪要",
    flow: "inquiry", roles: ["answerer", "observer"], uniqueRoles: [],
    phaseLabels: { qa: "问答" },
  },
];

/** 类型解析：未知/缺失值回落 review（旧数据与旧客户端兼容） */
export function tableTypeOf(id: string | undefined | null): TableTypeDef {
  return TABLE_TYPES.find((t) => t.id === id) ?? TABLE_TYPES[0];
}

/** 阶段显示名：按桌类型取协作语义文案，缺省回落评审流默认文案 */
export function phaseLabelOf(tableType: string | undefined | null, phase: Phase): string {
  const def = tableTypeOf(tableType);
  const DEFAULT_PHASE_LABELS: Record<Phase, string> = {
    open: "设定", qa: "问答", statements: "陈述", review: "评审", response: "回应",
    execution: "执行", convergence: "表决", human_intervention: "人工介入", closed: "结束",
  };
  return def.phaseLabels[phase] ?? DEFAULT_PHASE_LABELS[phase];
}

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
  // 主持人预审（服务器专属系统消息，席位不可直发）
  | "HOST_PREREVIEW" | "SUPPLEMENT"
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
  // 会议暂停（服务器专属系统消息，席位不可直发）
  | "MEETING_PAUSED" | "MEETING_RESUMED" | "PAUSE_REQUESTED"
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
  tableType: TableType;
  /** 建桌席位（问询桌为虚拟标识 "asker"，供问询方归属判定） */
  ownerSeat: string;
  seatCount: number; createdAt: number;
  /** 会议暂停叠加态标记（列表页徽章；未暂停/false） */
  paused?: boolean;
}
export interface TableListPayload { tables: TableSummary[]; }
export interface TableInfoPayload {
  tableId: string; topic: string; template: string; phase: Phase;
  tableType: TableType;
  /** 建桌模式：self 各方自行建桌 / hosted 主持人建桌（预审调度层启用） */
  mode: "self" | "hosted";
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
  /** hosted 桌的预审调度层状态（self 桌恒为 idle） */
  precheck: PrecheckState;
  /** 会议暂停叠加态（进行中可暂停；恢复后清空，phase 始终保留原阶段） */
  pause: PauseInfo | null;
}

/** 会议暂停态投影：叠加在 phase 上的冻结标记（不改变阶段本身） */
export interface PauseInfo {
  pausedAt: number;
  /** 暂停执行者 seatId；systemadmin 执行时为 "-" */
  bySeat: string;
  byName: string;
  /** 席位角色（host/proposer/reviewer/collaborator/observer）或 "systemadmin" */
  byRole: string;
  /** direct = 控制人直接暂停；request = 经参与方申请后同意 */
  via: "direct" | "request";
  reason: string;
  /** via=request 时：申请方（日志与广播均留痕「哪方申请暂停」） */
  requestedBySeat?: string;
  requestedByName?: string;
  requestedByRole?: string;
}

/** 预审调度层状态：预审进行中 / 点名补充指令挂起 / 空闲 */
export interface PrecheckState {
  /** "reviewing" 预审中（暂不授出发言权） | "directive" 点名补充挂起 | "idle" 空闲 */
  state: "idle" | "reviewing" | "directive";
  /** 预审/指令针对的消息或指令 */
  refId?: string;
  /** 指令目标席位（state=directive 时） */
  toSeat?: string;
}

/** 建桌请求：任何已认证连接方可发。录入主题、目标、交付物、规则与参与方身份安排。 */
export interface TableCreatePayload {
  topic: string;
  template: "review-collab";
  /** 桌类型（缺省 review 评审）：决定可选角色与流程语义，见 TABLE_TYPES */
  tableType?: TableType;
  /** 开放邀请码的角色（按类型勾选；缺省 = 该类型全部可邀角色；校验 ⊆ 类型角色 − 建桌人已占角色） */
  inviteRoles?: Role[];
  /** self（默认）= 建桌人自动成为提案方（协作类桌成为协作者），原流程；hosted = 建桌人成为主持人（只管桌与调度，预审层启用） */
  mode?: "self" | "hosted";
  /** 本次讨论需要达成的共识 */
  goals?: string;
  /** 期望交付物 */
  deliverables?: string;
  /** 桌规则（供各方 agent 阅读遵守，如「逐条审阅」） */
  rules?: string;
  /** 参与方身份安排说明（建桌人对各角色职责的补充描述） */
  rolePlan?: string;
  /** 建桌人自己的席位（self 模式自动成为首个席位，角色固定 proposer；hosted 模式角色固定 host） */
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

// ---------- 主持人预审（hosted 桌专用） ----------

/** 预审结论：pass 放行走原调度 / redirect 点名指定席位补充 / skipped 预审跳过（未配置或失败，放行+标注） */
export type PrecheckVerdict = "pass" | "redirect" | "skipped";
export interface PrecheckIssue { severity: Severity; comment: string; }

/** HOST_PREREVIEW 载荷（服务器专属系统消息）：对某条回合提交的 DeepSeek 预审结果 */
export interface HostPrereviewPayload {
  verdict: PrecheckVerdict;
  /** 被预审的席位与消息 */
  reviewedSeatId: string;
  reviewedMsgId: string;
  /** redirect 时：被点名补充的席位（须为 active 的 proposer/reviewer） */
  targetSeatId?: string;
  /** redirect 时：问题清单（为何需要补充） */
  issues: PrecheckIssue[];
  /** 预审说明（含 skipped 原因等） */
  note?: string;
  /** 预审执行方标注（如 "deepseek" / "skipped:no_key"） */
  by?: string;
}

/** SUPPLEMENT 载荷：被点名席位对预审指令的补充提交（turn-bound，指令持有者专属） */
export interface SupplementPayload {
  /** 回应的指令 ID（HOST_PREREVIEW 对应 directive） */
  directiveId: string;
  /** 补充内容全文 */
  text: string;
  /** 可选：补充涉及的新产物版本 */
  artifactId?: string;
  /** 可选：补充涉及的资料文档 */
  docId?: string;
}

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
  | { kind: "pause"; ts: number; msgId: string; fromSeat: string; what: "pause" | "resume" | "request"; bySeat: string; byName: string; byRole: string; reason: string; requestId?: string }
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

// ---------- 会议暂停（服务器专属系统消息，席位直发一律 403） ----------

/** MEETING_PAUSED 载荷：会议进入暂停叠加态（广播全员；agent 停止回合推进） */
export interface MeetingPausedPayload {
  bySeat: string; byName: string; byRole: string;
  via: "direct" | "request";
  reason: string;
  requestedBySeat?: string; requestedByName?: string; requestedByRole?: string;
  /** 给各方的行动指引（补充信息/调整立场/重新就绪） */
  note?: string;
}

/** MEETING_RESUMED 载荷：暂停解除，回到 phase 所指阶段继续 */
export interface MeetingResumedPayload {
  bySeat: string; byName: string; byRole: string;
  phase: Phase;
  /** true = systemadmin 跳过全员就绪强制继续（记审计） */
  forced?: boolean;
}

/** PAUSE_REQUESTED 载荷：参与方申请暂停（广播；主持人/建桌人/系统管理员在网页同意） */
export interface PauseRequestedPayload {
  requestId: string; bySeat: string; byName: string; byRole: string; reason: string;
}

/** 待同意的暂停申请（观察端桌详情投影） */
export interface PauseRequestView {
  requestId: string;
  bySeat: string; byName: string; byRole: string;
  reason: string;
  createdAt: number;
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
  | "asker_question" | "asker_join"
  /** 主持人模式（hosted）：预审与点名补充 */
  | "precheck_result" | "directive_open" | "supplement_done" | "table_update"
  /** 会议暂停/恢复（叠加态）与暂停申请：pause_request/table_pause(via=request) 的 detail 均记录申请方 */
  | "table_pause" | "table_resume" | "pause_request" | "pause_request_approved"
  /** 管理台（systemadmin）事件 */
  | "admin_set_role" | "admin_set_disabled" | "admin_reissue_user_token" | "admin_close" | "admin_human" | "admin_delete_table";

export interface AuditRecord {
  id: string; ts: number; tableId: string; seatId: string;
  event: AuditEvent; detail: Record<string, unknown>;
}
