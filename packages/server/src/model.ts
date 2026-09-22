/** 服务器内部领域模型（持久化部分） */
import type { ArtifactFormat, Envelope, PauseInfo, Phase, PrecheckIssue, RequestPayload, RequestResponsePayload, ResponseItem, ReviewItem, TableDocumentMeta, TableType } from "@rt/shared";

export interface TableMeta {
  tableId: string;
  topic: string;
  template: "review-collab";
  /** 桌类型：决定可选角色与流程语义（review/collab/brainstorm/decision，见 TABLE_TYPES） */
  tableType: TableType;
  /** 建桌模式：self 各方自行建桌（原流程）/ hosted 主持人建桌（预审调度层启用） */
  mode: "self" | "hosted";
  /** 本次讨论需要达成的共识 */
  goals: string;
  /** 期望交付物 */
  deliverables: string;
  /** 桌规则（建桌人录入） */
  rules: string;
  /** 参与方身份安排说明 */
  rolePlan: string;
  /** 建桌席位（点开始的权利属于它） */
  ownerSeat: string;
  phase: Phase;
  /** 会议暂停叠加态：进行中冻结推进，恢复后清空（phase 保留原阶段不动）；null/缺省 = 未暂停 */
  pause?: PauseInfo | null;
  roundNo: number; // review 轮次（1 起）
  deadlockCount: number;
  createdAt: number;
  closedAt?: number;
  seatCount: number;
  maxReviewRounds: number;
  turnTimeoutMs: number;
}

/** 暂停申请记录：参与方在 web 申请 → 控制人（host/owner/systemadmin）同意后触发暂停 */
export interface PauseRequestRecord {
  requestId: string;
  tableId: string;
  bySeat: string;
  byName: string;
  byRole: string;
  reason: string;
  createdAt: number;
  status: "pending" | "approved" | "superseded";
  approvedBy?: string;
  approvedAt?: number;
}

/** 持有人私有指令：网页持有人（user token）→ 本席 agent 的高可信离线指令。
 *  不进消息流（观察端/管理台读不到），仅本席席位 token 经 poll 拉取、ack 确认送达。 */
export interface OwnerDirectiveRecord {
  directiveId: string;
  tableId: string;
  /** 目标席位（恒为提交人自己的席位） */
  seatId: string;
  text: string;
  byName: string;
  createdAt: number;
  /** agent ack 时间；缺省 = 待送达（poll 持续重复下发） */
  deliveredAt?: number;
}

/** 预审点名补充指令：HOST_PREREVIEW redirect 落成的调度指令（同一时刻一桌至多一条 pending） */
export interface DirectiveRecord {
  directiveId: string;
  tableId: string;
  /** 被点名补充的席位 */
  toSeat: string;
  /** 触发预审的提交消息 */
  regardingMsgId: string;
  /** 指令链根（同一根提交上的连续点名，用于链深上限） */
  rootDirectiveId: string;
  /** 预审问题清单（为何需要补充） */
  issues: PrecheckIssue[];
  note?: string;
  createdAt: number;
  status: "pending" | "closed";
  closedAt?: number;
}

/** 入库消息：信封 + 桌内单调递增 seq（长轮询增量拉取的游标） */
export interface StoredMsg extends Envelope {
  seq: number;
  /** 注入扫描标记（如 injection_suspect），端侧见标记须警示持有人 */
  flags?: string[];
}

/** 存储层产物版本：内容外置为 sha256 内容寻址 blob 文件，记录只存元数据 */
export interface StoredArtifactVersion {
  v: number;
  sha256: string;
  size: number;
  changeNote: string;
  publishedBy: string;
  ts: number;
  /** 文本类的 unified diff */
  diffFromPrev?: string;
  /** 执行请求产出的版本溯源 */
  requestId?: string;
  /** 批量溯源：本版本同时满足的多个执行请求 */
  requestIds?: string[];
}

export interface ArtifactRecord {
  artifactId: string;
  tableId: string;
  name: string;
  format: ArtifactFormat;
  ownerSeat: string;
  versions: StoredArtifactVersion[];
  /** 写锁：同一时刻只允许一个席位持有修改流程；发布新版本成功后自动释放 */
  lockedBy: string | null;
  lockedAt?: number;
}

/** 资料文档存储记录（上传阅资料/投屏）：元数据 + 内容 hash；内容外置 blob，不版本化、不可改删 */
export interface TableDocumentRecord extends TableDocumentMeta {
  sha256: string;
}

export interface ReviewItemRecord {
  item: ReviewItem;
  fromSeat: string;
  msgId: string;
  ts: number;
  /** 评审意见所属产物（REVIEW_COMMENT payload.artifactId，可能缺省） */
  artifactId?: string;
  /** 评审意见针对的资料文档（REVIEW_COMMENT payload.docId，可能缺省） */
  docId?: string;
  responses: ResponseItem[]; // 提案人回应（可能多条，取最后一条为当前立场）
}

export type RequestStatus = "pending" | "accepted" | "rejected" | "countered" | "executed" | "human";

export interface RequestRecord {
  req: RequestPayload;
  status: RequestStatus;
  response?: RequestResponsePayload;
  createdAt: number;
  createdBy: string; // 发起席位（RESPONSE 派生的请求记 proposer）
}
