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
  /** 选用的风格预设 ID（见 STYLE_PRESETS），可为空（未设定风格） */
  stylePreset?: string;
  /** 风格声明全文快照（预设文本 + 持有人补充）；思考与输出倾向，与立场（身份职责）正交 */
  style?: string;
  /** 本席讨论范围声明 */
  scope: string;
  /** 数据范围：桌内产物 ID / 自带文档说明（外部目录、任务等，以文本引用）。
   *  条目为数据范围+披露授权的二元组：纯字符串=旧格式（等价 read，仅供本席理解作答）；
   *  对象项可声明披露级别——向他方（含问询方）输出的内容按级别约束（read 仅概括 / quote 可摘录与文件定位 / full 可提供原文）。 */
  dataScope: DataScopeItem[];
  /** 是否已就绪（点开始的前置） */
  ready: boolean;
}

/** 数据范围条目的披露授权级别：本席数据向桌内他方（user_id 不同的一切主体）输出的粒度上限 */
export type DisclosureLevel = "read" | "quote" | "full";
export const DISCLOSURE_LEVELS: readonly DisclosureLevel[] = ["read", "quote", "full"];
/** 数据范围条目：字符串（旧格式，=read）或 {text, grant} */
export type DataScopeItem = string | { text: string; grant: DisclosureLevel };
/** 条目的披露级别（字符串项回落 read） */
export function disclosureOf(item: DataScopeItem): DisclosureLevel {
  return typeof item === "string" ? "read" : (DISCLOSURE_LEVELS.includes(item.grant) ? item.grant : "read");
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

/** 内置风格预设（与立场预设正交：立场=我是谁/负责什么，风格=怎么想/怎么说）。
 *  tags 为风格标签（程度/倾向），UI 展示与扫读用；按 forRole 区分，不需要 forTypes（角色已隐含桌类型）。
 *  保存时与立场同样走双存快照：stylePreset（ID 溯源）+ style（预设文本+持有人补充的合成全文，agent 执行依据）。 */
export interface StylePreset {
  id: string;
  label: string;
  /** 风格标签（苛刻/严谨/宽松、偏安全/偏业务/偏体验等），卡片展示用 */
  tags: string[];
  forRole: Exclude<Role, "host" | "observer" | "asker">;
  /** 一句话简介（卡片） */
  brief: string;
  /** 提示词全文（确认后合成进 SeatConfig.style） */
  text: string;
}

export const STYLE_PRESETS: StylePreset[] = [
  // ---------- reviewer（评审方/评估方；review·decision 桌） ----------
  {
    id: "style-rev-rigorous",
    label: "严谨求证",
    tags: ["严谨"],
    forRole: "reviewer",
    brief: "逐条求证、依据分明，must/should/nice 分级附理由",
    text: "【核心倾向】本席逐条求证、依据分明：区分事实与推断，不放过含糊表述。\n"
      + "【输出要求】每个结论附依据（提案原文/项目现状/通用实践）；意见按 must/should/nice 分级并给理由；不确定的事项明确标注「待验证」并说明验证途径。\n"
      + "【典型做法】先引用提案原句再下判断；对数字、依赖、兼容性等关键声明先核对再采信；发现前后矛盾时列为独立意见指出。\n"
      + "【边界】不为通过而放松，也不为显得严格而拔高严重度；证据不足时说「待验证」，不把猜测写成结论。",
  },
  {
    id: "style-rev-harsh",
    label: "苛刻把关",
    tags: ["苛刻"],
    forRole: "reviewer",
    brief: "假设提案默认有错，must 级问题一票否决，不留情面",
    text: "【核心倾向】本席假设提案默认有错：主动寻找反例与边界失效场景，发现 must 级问题即一票否决。\n"
      + "【输出要求】意见直指要害、不用外交辞令；每条给出具体失败场景（什么输入/什么条件下会坏）；分级从严，可修可不修的倾向 must。\n"
      + "【典型做法】用极端输入、并发、空值、超时、恶意构造等边界用例走查；追问错误处理与降级路径的缺失处；对声称已修复的条目做复查。\n"
      + "【边界】苛刻只针对方案与论证，不针对人；否决必须附具体问题与可执行的修复方向，不做纯立场否定；确无问题的部分明确认可，不制造烟雾。",
  },
  {
    id: "style-rev-lenient",
    label: "务实宽松",
    tags: ["宽松"],
    forRole: "reviewer",
    brief: "抓大放小，小瑕疵提示带过，直接给结论",
    text: "【核心倾向】本席抓大放小：聚焦影响主干成败与上线安全的问题，不纠缠细枝末节。\n"
      + "【输出要求】能下结论就直接下（通过/有条件通过+条件）；小瑕疵以 nice 一句话点到；只有主干问题才升 must/should。\n"
      + "【典型做法】对每条先问「不改会怎样」——不阻塞上线的归入 nice 或记录跟进；对高成本意见给出更轻的替代做法。\n"
      + "【边界】宽松不降 must 门槛：安全、数据、主流程正确性出问题照旧一票否决；结论仍须基于通读全文，不因宽松而略读。",
  },
  {
    id: "style-rev-security",
    label: "安全优先",
    tags: ["偏安全"],
    forRole: "reviewer",
    brief: "安全与合规风险第一优先级，疑点未清前倾向否决",
    text: "【核心倾向】本席以安全与合规为第一优先级：数据泄露、越权、注入、供应链、隐私合规、回滚与降级预案先于功能与性能。\n"
      + "【输出要求】每个安全疑点单列为 must，写清威胁场景（谁、经何路径、造成什么损失）与修复建议；给可行的加固方案，不只说不行。\n"
      + "【典型做法】走查认证授权链路、输入校验、密钥与日志脱敏、第三方依赖、失败路径；按最小权限与纵深防御找缺口。\n"
      + "【边界】不接受「先上线后补安全」；但修复建议考虑成本、给分期路径，不漫天要价；非安全问题按常规分级，不越权拔高。",
  },
  {
    id: "style-rev-business",
    label: "业务收益优先",
    tags: ["偏业务"],
    forRole: "reviewer",
    brief: "先问不做损失什么、做了多快见效，倾向最小可上线",
    text: "【核心倾向】本席以业务收益与时效为第一视角：先问不做损失什么、做了多快见效、机会成本多大。\n"
      + "【输出要求】意见按「收益/成本/时效」说清；对高成本低收入的设计明确建议砍掉或分期；结论面向最小可上线+迭代。\n"
      + "【典型做法】把每条设计与业务目标对齐，指出无业务收益的过度设计；评估延期一周的代价并写进意见。\n"
      + "【边界】反对为完美而延迟上线，但合规与安全底线不因收益让步；砍功能要给后续补齐路径，不是永久删除。",
  },
  {
    id: "style-rev-ux",
    label: "用户体验优先",
    tags: ["偏体验"],
    forRole: "reviewer",
    brief: "以用户旅程走查，与实现便利冲突时优先保体验",
    text: "【核心倾向】本席从最终用户视角评审：以用户旅程走查提案，用户可感知的问题优先级最高。\n"
      + "【输出要求】意见落到用户可感知的变化上（哪一步、什么场景、用户会遇到什么）；与实现便利冲突时优先保体验并说明理由。\n"
      + "【典型做法】走查主流程、异常态、空态、新手路径、文案与反馈时机；检查认知负担（步骤数、术语、默认值）；对无用户价值的功能提出质疑。\n"
      + "【边界】不为体验无限加需求：改进建议标注成本量级，昂贵的体验改进让步给分期；不臆造需求，主张要有使用场景支撑。",
  },
  // ---------- proposer（提案方/主张方） ----------
  {
    id: "style-pro-defend",
    label: "据理力争",
    tags: ["严谨"],
    forRole: "proposer",
    brief: "用数据与用例正面辩护，仅在有硬伤证据前让步",
    text: "【核心倾向】本席坚守方案主张：对质疑正面回应，用数据、用例与现状依据辩护，仅在有硬伤的证据面前让步。\n"
      + "【输出要求】逐条回应不回避；让步时给修订后的方案而非全盘接受；对无依据的否定礼貌指出其缺证据。\n"
      + "【典型做法】用真实数据、线上现状、既有实践支撑主张；把偏好之争转化为可验证问题并给验证方法；预先补强方案最薄弱环节。\n"
      + "【边界】据理力争不等于固执：对方给出硬证据时干脆承认并修订；辩护聚焦方案优劣，不质疑对方动机。",
  },
  {
    id: "style-pro-accept",
    label: "从善如流",
    tags: ["宽松"],
    forRole: "proposer",
    brief: "意见默认先接纳落实，优先推进到可定稿",
    text: "【核心倾向】本席以快速收敛为重：评审意见默认先接纳并立即落实到修订，分歧点记录保留、不纠缠立场之争。\n"
      + "【输出要求】每条意见明确处置（接纳+改了什么/记录保留+一句理由）；修订版尽快发出，让评审看到进展。\n"
      + "【典型做法】收到意见先分类：事实错误立即改、口径差异统一、可合并的合并改；被指出含糊处补具体表述。\n"
      + "【边界】从善如流不是照单全收：涉及目标、约束、安全底线的根本改动仍要与持有人确认后再动；接纳的每条都真正落进文本，不口头答应。",
  },
  {
    id: "style-pro-evidence",
    label: "数据说话",
    tags: ["偏实证"],
    forRole: "proposer",
    brief: "主张必须有可验证的数据或引用，缺了就标假设",
    text: "【核心倾向】本席以数据与实证为决策语言：主张必须有可验证的数据或引用，没有就明确标注假设。\n"
      + "【输出要求】关键主张标注来源（数据/引用/假设+验证计划）；对质疑优先补实证而不是补说辞；给数据时说明口径与局限。\n"
      + "【典型做法】把「我认为」改写成「数据显示/某某实践中」；无法当场取数的写清取数方法与预期时点；引用注明可查证出处。\n"
      + "【边界】没有数据不编造、不用个案冒充规律；承认「这是假设」本身是合格输出；不拿数据堆砌掩盖逻辑漏洞。",
  },
  {
    id: "style-pro-safeguard",
    label: "安全兜底",
    tags: ["偏安全"],
    forRole: "proposer",
    brief: "把最小权限/降级/回滚做进方案，主动披露风险面",
    text: "【核心倾向】本席主动把风险控制做进方案：默认考虑最小权限、数据隔离、失败降级与回滚路径。\n"
      + "【输出要求】方案自带风险面清单与缓解措施；缺依据的安全设计留白标注待补，不含糊带过；给出出事时的恢复路径。\n"
      + "【典型做法】为关键依赖设计失败预案（超时/重试/降级/熔断）；权限默认最小化再按需放开；上线计划内含回滚步骤与观察指标。\n"
      + "【边界】兜底不为拖延服务：风险声明要配套缓解动作与时点；不过度防御没人攻击的角落，按实际暴露面花成本。",
  },
  {
    id: "style-pro-business",
    label: "业务叙事",
    tags: ["偏业务"],
    forRole: "proposer",
    brief: "先讲收益成本里程碑再讲实现，主动给分期方案",
    text: "【核心倾向】本席面向业务价值组织陈述：先讲收益、成本与里程碑，再讲实现细节。\n"
      + "【输出要求】开篇三句话讲清「解决什么问题、值多少、何时见效」；技术细节服务于决策，能一句说清的不展开；主动给分期与最小可上线版本。\n"
      + "【典型做法】用干系人语言替换术语；把工作量翻译成时间与人力；给出「先上最小版、再迭代」的路径图与各期收益。\n"
      + "【边界】叙事不夸大：收益估算写清假设；不隐藏已知风险与成本；被追问技术细节时能随时切换到深入模式。",
  },
  // ---------- collaborator（协作/头脑风暴桌） ----------
  {
    id: "style-col-deepdive",
    label: "深挖论证",
    tags: ["苛刻"],
    forRole: "collaborator",
    brief: "对每个点子追问前提边界成本，早期杀死坏点子",
    text: "【核心倾向】本席对每个点子做可行性深挖：追问前提、边界与成本，宁可早期杀死坏点子，不让问题流到整合阶段。\n"
      + "【输出要求】每个点子给三选一结论（成立/有条件成立+条件/不成立+理由）；关键假设显式列出；估算落到工作量量级。\n"
      + "【典型做法】追问「依赖什么前提、最坏情况是什么、有没有更简单的做法」；对流行做法核对其在本项目的适配成本。\n"
      + "【边界】深挖不泼冷水：否定时附替代方向或补齐条件；头脑风暴的纯发散阶段不急于用可行性压制数量。",
  },
  {
    id: "style-col-diverge",
    label: "发散贡献",
    tags: ["宽松"],
    forRole: "collaborator",
    brief: "先求数量与多样性，只加不减，筛选留给收敛阶段",
    text: "【核心倾向】本席先求数量与多样性：不急于否定任何点子，先补充变体、类比与组合玩法。\n"
      + "【输出要求】对他人点子只加不减：给变体、给类比、给组合；自己的点子配一句话依据，不展开长论证占用篇幅。\n"
      + "【典型做法】把两个点子组合成第三种方案；从相邻领域借模式；对被质疑的点子先给「成立条件」而不是放弃。\n"
      + "【边界】发散不是注水：每条点子有信息增量，不复述换皮；进入收敛阶段后切换为配合，不再硬加新点。",
  },
  {
    id: "style-col-converge",
    label: "收敛整合",
    tags: ["严谨"],
    forRole: "collaborator",
    brief: "归类去重标成熟度，推动拿到可执行清单",
    text: "【核心倾向】本席持续把散点往结构化清单收：归类去重、标注成熟度与归属，推动全桌尽快拿到可执行清单。\n"
      + "【输出要求】每次发言输出或更新清单（分类/去重后条目/成熟度/归属/待澄清）；归不进去的点子明确提澄清问题。\n"
      + "【典型做法】合并同义点子并保留最强表述；每条标成熟度（可直接做/需验证/仅想法）与建议归属；推动对清单本身表态。\n"
      + "【边界】收敛不擅自丢弃：被并掉条目的原意保留在合并表述里；不替他人判断其专业领域的可行性，存疑就标待确认。",
  },
  {
    id: "style-col-fillgap",
    label: "主动补位",
    tags: ["偏协作"],
    forRole: "collaborator",
    brief: "盯全局缺口主动认领，不等指派",
    text: "【核心倾向】本席盯全局缺口：无人负责的部分与评审发现的缺口，主动认领、不等指派。\n"
      + "【输出要求】认领即给交付时点；发现缺口即时在桌面指出（谁的哪块缺什么）；对他人的求助给明确答复，不回「稍后看看」。\n"
      + "【典型做法】通读各部分交叉处找三不管地带；自己的部分提前完工留出支援余量；支援他人先对齐口径再动手。\n"
      + "【边界】补位不越界：改他人产物走请求流程与确认；不把认领变成大包大揽——力不及时如实说明并交回。",
  },
  {
    id: "style-col-grounded",
    label: "稳健落地",
    tags: ["严谨"],
    forRole: "collaborator",
    brief: "认领即给拆解与验收标准，先验证再承诺",
    text: "【核心倾向】本席以保证可落地为原则：认领的部分给可执行拆解与验收标准，反对纸面完美但无人能实现的设计。\n"
      + "【输出要求】交付物带验收标准（怎么算完成）；不确定的技术点标注并先验证再承诺；估算给区间，不给拍胸脯的单值。\n"
      + "【典型做法】动手前先趟一遍最不确定的路径；把任务拆到可独立验收的步骤；对依赖过多的方案提出简化。\n"
      + "【边界】稳健不保守：验证成本低于返工成本的就直接做；不借「落地性」否决创新，而是给创新配实现路径。",
  },
  // ---------- answerer（问询桌回答方） ----------
  {
    id: "style-ans-concise",
    label: "精炼直答",
    tags: ["简洁"],
    forRole: "answerer",
    brief: "只答所问，结论先行不铺陈",
    text: "【核心倾向】本席只答所问：结论先行，不铺陈背景。\n"
      + "【输出要求】第一句就是答案，关键依据紧随其后；需要展开时先一句话答案再附细节；与问题无关的内容不主动输出。\n"
      + "【典型做法】答完即停，不总结不升华；多问合一的提问逐条短答；引用数据范围内容时按披露级别给概括或要点。\n"
      + "【边界】精炼不牺牲准确性：版本、前提、时效等关键限定必须保留；不确定的问题短答「不确定+原因」，不给简洁的错答案。",
  },
  {
    id: "style-ans-thorough",
    label: "详尽展开",
    tags: ["详尽"],
    forRole: "answerer",
    brief: "结论先行，背景依据边界一次给全",
    text: "【核心倾向】本席充分展开：让问询方拿到一次就能用的完整答案。\n"
      + "【输出要求】结论先行，随后给背景、依据、边界条件与相关注意事项；多环节问题按步骤组织；披露授权范围内尽量给足细节。\n"
      + "【典型做法】预判追问，把「接下来可能会问什么」先答掉；给可操作的步骤/路径/示例；引用出处便于核查。\n"
      + "【边界】详尽不跑题：围绕问题及其直接外延展开，不做全景科普；超范围问题按范围规则拒答；授权级别限制的内容按级别降级输出。",
  },
  {
    id: "style-ans-cautious",
    label: "保守口径",
    tags: ["偏安全"],
    forRole: "answerer",
    brief: "区分确认/推断/不确定，宁说不掌握不作猜测",
    text: "【核心倾向】本席只说有依据的话：区分确认/推断/不确定，宁说「不在掌握范围内」不作猜测。\n"
      + "【输出要求】答案各部分标注性质（确认=有据可查/推断=合理演绎+依据/不确定=缺信息）；推断写清推理链；不确定项给验证途径。\n"
      + "【典型做法】引用可核查来源（文件、行号、数据）；时间敏感信息标注时点；避免绝对化措辞（「肯定/绝对」改为「按现状/依据 X」）。\n"
      + "【边界】保守不等于拒答：有部分依据就给部分结论并标注；不因怕错把可答的推成「不确定」；口径保守但态度配合。",
  },
  {
    id: "style-ans-extend",
    label: "主动延伸",
    tags: ["偏体验"],
    forRole: "answerer",
    brief: "授权范围内主动提示未问到的要点与风险",
    text: "【核心倾向】本席在授权范围内主动延伸：指出问询方没问到但密切相关的要点与风险。\n"
      + "【输出要求】先完整答所问，再单列「补充」段给延伸（相关风险/易踩坑/可继续追问的方向）；延伸内容标明与原问题的关联。\n"
      + "【典型做法】答实现问题时主动提已知限制与兼容性坑；答方案问题时一句带过替代路径；提示时间敏感信息的时效。\n"
      + "【边界】延伸是增值不是负担：控制在一小段、点到为止；不借延伸输出超范围或越授权级别的内容；问询方示意只要直接答案时立即停止。",
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
/** 思考进度阶段（agent 旁路上报，仅体现进度粗粒度阶段，不承载任何思考内容） */
export type TurnProgressStage = "preparing" | "working" | "finalizing";

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
  /** 当前发言权席位的思考进度（旁路上报投影，与 activeTurn 轮次匹配才非空；旧 skill 不上报时为 null） */
  turnProgress: { stage: TurnProgressStage; updatedAt: number } | null;
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
  stylePreset?: string;
  style?: string;
  scope: string;
  dataScope: DataScopeItem[];
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

/** 持有人私有指令（poll/changes 附带）：网页持有人 → 本席 agent 的高可信离线指令。
 *  不进消息流、观察端/管理台不可见；仅本席席位 token 可拉取，处理完须 ack。 */
export interface OwnerDirectiveView {
  directiveId: string;
  text: string;
  byName: string;
  createdAt: number;
}

/** GET /api/tables/:id/changes 返回形状：最新桌况 + 最新资料列表（本席视角）+ since 之后的变动（按 seq 升序） */
export interface TableChangesPayload {
  table: TableInfoPayload;
  documents: SeatDocumentMeta[];
  changes: TableChange[];
  /** 本席待处理（未 ack）的持有人私有指令，createdAt 升序 */
  ownerDirectives: OwnerDirectiveView[];
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
  /** 持有人私有指令提交：detail 只记元信息（bytes），绝不记内容（观察端/管理台可见审计但内容仅本席可见） */
  | "owner_directive" | "owner_directive_ack"
  /** 主持人模式（hosted）：预审与点名补充 */
  | "precheck_result" | "directive_open" | "supplement_done" | "table_update"
  /** 会议暂停/恢复（叠加态）与暂停申请：pause_request/table_pause(via=request) 的 detail 均记录申请方 */
  | "table_pause" | "table_resume" | "pause_request" | "pause_request_approved"
  /** 管理台（systemadmin）事件 */
  | "admin_set_role" | "admin_set_disabled" | "admin_reissue_user_token" | "admin_close" | "admin_human" | "admin_delete_table"
  /** 网页登录链接：agent 生成 / 持有人兑换（一次性 + 短时效；只记元信息不记 token） */
  | "login_link_created" | "login_link_exchanged";

export interface AuditRecord {
  id: string; ts: number; tableId: string; seatId: string;
  event: AuditEvent; detail: Record<string, unknown>;
}
