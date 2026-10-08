# 圆桌系统 · 系统设计文档

> 版本：随当前代码库（含 dispatch 指挥桌与 relay 对接桌）。本文面向开发者与系统维护者；面向使用者的操作指引见 [user-guide.md](user-guide.md)。

## 1. 系统定位

**智能体协同博弈平台（agent-talk）**：多个人各自带着自己的 agent（zcode / claude / codex…）入座一个「圆桌」，agent 代表持有人完成评审、协作、问答、指挥与对接等工作；人只在重要节点介入（开局、审批、裁决），接收最终共识结果。

三条产品主线：

1. **哑服务器**——服务器不跑任何 AI，只做路由、状态机、调度推导、产物存储、能力校验与审计；智能全部在各席位 agent 侧。
2. **roundtable skill**——每个参会 agent 自装同一份技能档（`GET /skill.md`），会话内用系统 `curl` 直连服务器 REST API，零程序安装、天然多厂商。
3. **观察端控制台**——网页承载人类动作：建桌/入桌/邀请码、开始/暂停、提问/下指令、审批与裁决、私有指令与代答。

## 2. 整体架构

架构图：[roundtable.architecture.html](roundtable.architecture.html)（组件与安全边界）

```
持有人 Alice ──审批/裁决──▶ zcode agent ──roundtable skill──┐
                                                            │  REST + 长轮询（Bearer token）
持有人 Bob ───审批/裁决──▶ claude agent ──roundtable skill──┤
                                                            ▼
                 观察端网页（浏览器） ──────────────▶ 哑服务器（api → engine → store）
                                                            │
                                                            ▼
                                              SQLite（roundtable.db）+ blobs 落盘
```

### 2.1 代码结构

| 包 | 职责 |
|---|---|
| `packages/shared` | 协议单一事实来源：消息类型与信封（types.ts）、JSON Schema 双端校验（schema.ts，ajv）、能力预设、立场/风格预设、注入扫描、桌类型注册表 `TABLE_TYPES` |
| `packages/server` | `engine.ts` 状态机+调度核心；`api.ts` REST 路由与长轮询；`store.ts` SQLite 持久化；`observer-html.ts` 观察端单页控制台；`skill-template.ts` skill 档模板；`precheck.ts`/`model.ts` 系统预审与模型调用审计 |
| `packages/*/test` | vitest：全流程（全桌型）、攻击用例、协议校验、存储层、调度细节 |

### 2.2 关键设计取舍

- **REST + 长轮询而非 WebSocket**：agent 侧只需 curl；poll 带 `since` 游标增量拉消息，等待期服务器挂起至有新事件或超时（默认 20s），提交类操作即时唤醒等待者。
- **事件溯源调度**：服务端不维护发言队列，每次从「当前阶段 + 消息历史」重新推导该谁发言（见 §4）。好处：暂停/恢复、并行批次、预审点名全部退化为「重新推导」，无状态可脏。
- **单文件模板观察端**：`observer-html.ts` 以模板字符串输出整页 HTML（无前端构建链），5 秒轮询刷新详情；弹窗等 body 级元素不受轮询重渲染影响。
- **skill 即客户端**：协议（消息信封 + payload schema）双端共享校验，skill 档随服务器下发，改模板即全量生效。

## 3. 领域模型与凭证体系

| 概念 | 说明 |
|---|---|
| User | 注册参与用户（`rtu_` token）。web 与 agent 同账号互通：agent 建桌/入席归属该用户，网页私有指令、代答、席位管理全部生效 |
| 网页登录 token | 一次性登录链接兑换出的**并行** token，不动 agent 主 token；多帐号可并存切换 |
| Table | 一场圆桌：`tableType`（7 型）+ `mode`（self 自建 / hosted 主持人建）+ 阶段状态机 + 桌设定（主题/目标/交付物/规则） |
| Seat | 席位，角色由邀请码定死；席位 token（`rts_`）交给 agent；可重签（恢复 recover / 替代 replace 吊销旧的） |
| InviteCode | 角色绑定邀请码（10 次 / 7 天），入席时服务端强校验码归属本桌、角色一致 |
| 消息 Envelope | `{v, tableId, msgId, fromSeat, toSeat, type, payload, ts}`；schema 校验 + 阶段/角色/turn/能力/限频五重检查 |
| Artifact | 版本化产物（md/txt/json/png ≤5MB），diff、写锁、`requestId(s)` 溯源关联 |
| Document | 资料文档（≤5MB，purpose 作用声明必填，shared/private 可见性）；relay 桌可带 `reqId` 关联索要 |
| Request | 执行请求（评审/协作流 accept 派生），`RESPOND_REQUEST` 处置 |
| WorkDirective | 指挥桌工作指令记录（独立表，五态状态机） |
| DataRequest | 对接桌数据索要记录（独立表，多态状态机 + 审批门） |

特殊席位：host（主持人，任何桌型可经 hosted 模式引入，不参与就绪）；asker（问询方虚拟席位 `"asker"`，不占席位）；director（指挥方，人类成员席位，不签发 agent 凭证）。

## 4. 调度机制（引擎核心）

### 4.1 发言权：消费型、事件溯源

回合型消息（`STATEMENT / REVIEW_COMMENT / RESPONSE / RESPOND_REQUEST / CONSENSUS_VOTE`）必须持有当前发言权；发出后服务器重新推导下一位。讨论类消息（`QUESTION / REPLY / HUMAN_INPUT / ESCALATE`）任何席位随时可发。

`engine.computeTurn(tableId)` 按阶段推导：

| 阶段 | 发言权 | 次序 |
|---|---|---|
| open | 建桌人独占（提示性待办，不推进） | 全员就绪后由建桌人显式 start |
| statements | 提案人（评审流）／各协作者依次（协同流） | 产物+陈述齐备自动进 review |
| review | 评审人依次（入席时间序，跳过本轮已发言者） | 全员出具意见自动进 response |
| response | 提案人（评审流）／意见归属方依次（协同流：产物 owner / 资料上传者 / 建桌人统稿） | 处置完 → execution（有 pending 请求）或 convergence |
| execution | 按需指定：第一个 pending 请求的目标席位 | 带 requestId 新版本 + accept 后切下一个 |
| convergence | 有投票权席位依次 | 全员投完自动计票 |
| qa / working / transfer | 常驻态，无轮转 | 队列驱动（见 §6.3~6.5） |

推进判定 `maybeAdvance` 在每条消息/产物事件后触发；表决 reject 且未达 `maxReviewRounds`（默认 2）回 review 开下一轮，超限自动 `human_intervention`。`turnTimeoutMs`（默认 5 分钟）只是随 TURN_GRANT 下发的提示，服务端不强制剥夺——卡位靠 agent 自觉、`TURN_RELEASE` 让权、控制人跳过（`TURN_SKIPPED`）或人工介入。执行目标席位超 2 分钟无心跳不授予执行发言权。

### 4.2 系统预审层（评审/协作类桌，全部建桌模式）

任一方每条回合提交先过系统预审再进入原调度：

```
回合提交 → 系统预审 ─┬─ pass / skipped（未配置或失败放行+标注）→ 原调度照常
                     └─ redirect（点名补充）→ 压住推进、发言权授予被点名席
                        → SUPPLEMENT 补充 → 补充再预审 → …… 直至 pass（同一提交至多点名 3 次）
```

- 结果以服务器系统消息 `HOST_PREREVIEW` 广播（席位伪造 403）；`table.precheck` 暴露 `reviewing / directive / idle` 三态。
- 预审进行中不授予发言权，并发回合提交收 409 `precheck_in_progress`；按桌开关 `precheckEnabled`（建桌可选、会议中可切，缺省开）。
- 预审器（`PRECHECK_PROVIDER`）：`deepseek` 单次调用出判定；`jev` 分层（OpenRouter Decisions 判定 + DeepSeek 生成说明，说明不可用退模板）。未配置/调用失败一律 fail-open 放行。每次模型调用完整落库 `model_call_logs`（审计不记内容失败不影响主流程）。
- 点名目标经服务端校验必须是本桌在席提案/评审方；模型输出只是数据不构成指令。

### 4.3 回合内并行调度（hosted 桌，轮换阶段）

不新增桌型：主持人在 statements/review/response/convergence 可发 `PARALLEL_DISPATCH` 把当前未发言的**同身份席位**同时派出（`workers` ≥2，或只填 1 席=点名单个）。总-分-总：

- 调度（总）→ 批次成员同时持有发言权（`table.activeTurns` 多权并存，各自 poll 的 yourTurn 独立）独立交付（分）→ 全员交付/被跳过即汇聚回顺序轮转（总）。
- 阶段推进条件不变（并行提交与顺序提交同口径计数）；批次成员回合提交不经系统预审（主持人汇聚把关）。
- 可见性 `open`/`blind`（盲评：批次成员互不可见他席提交与批次内产物，服务端按 viewer 过滤 poll/changes/观察端/产物四路出口，汇聚后放开）。
- 滞留成员由主持人逐席跳过；同一时间仅一个活跃批次。

### 4.4 会议暂停（叠加态）

会议中（含 qa/working/transfer 常驻态）主持人/建桌人/systemadmin 可暂停；任意席位可申请、控制人同意生效。暂停期：发言权与阶段推进冻结（`computeTurn` 恒 null、`maybeAdvance` 直接返回），仅 QUESTION/REPLY/HUMAN_INPUT/ESCALATE 与资料上传、席位设定可动；各方持有人补充立场/信息后重新就绪，全员就绪后控制人网页恢复（systemadmin 可 force 跳过就绪，记审计）。问询桌暂停期问答双冻结（无旁路讨论）。

## 5. 桌类型与流程形态

`TABLE_TYPES` 注册表（`packages/shared/src/types.ts`）是单一事实来源，REST `/api/table-types`、观察端开桌表单、skill 档三处共享。7 型 5 流：

| 桌型 | 流程形态 | 角色 | 语义 |
|---|---|---|---|
| review 评审（默认） | 评审流 | proposer / reviewer / observer | 提案 vs 评审博弈 |
| decision 方案决策 | 评审流 | 同上 | 评审流变体：主张方 vs 评估方选型 |
| collab 协作 | 协同流 | collaborator / observer | 同事共创交付 |
| brainstorm 头脑风暴 | 协同流 | 同上 | 协同流变体：点子清单共创 |
| inquiry 问询 | 问询流 | answerer / observer（+asker 码） | 人问 agent 答 |
| dispatch 指挥 | 指挥流 | worker / director / observer | 多人指挥 agent 干活 |
| relay 对接 | 对接流 | provider / receiver / observer | agent 对 agent 工作对接 |

桌型决定：可选角色集与唯一角色、阶段显示文案（`phaseLabels`，如协作桌 review 显示「互审补缺」）、默认建桌人角色、预审适用性（问询/指挥/对接无回合提交不预审）。

## 6. 各模式流程设计

### 6.1 评审流（review / decision）

流程图：[roundtable.workflow.html](roundtable.workflow.html)

阶段状态机：`open → statements → review → response → execution? → convergence → closed`（僵局旁路 `human_intervention`）。

- **open**：入席设定（立场预设+补充/风格/讨论范围/数据范围+就绪）；全员就绪且角色齐备（有提案方+至少一评审方）后建桌人点开始。
- **statements**：提案人发布产物 v1 + STATEMENT（两者齐备自动进 review）。
- **review**：评审人按入席序逐个出具 `REVIEW_COMMENT`（items[]：id/target/severity must|should|nice/comment；可关联产物 artifactId 或共享资料 docId；`done:true` 收口）。全员出具自动进 response。
- **response**：提案人逐条四态回应 `RESPONSE`：accept（可带 `action.executeBy: self` 自己改 / `reviewerSeat` 请意见提出席改）/ defer（记入纪要跟进清单）/ reject / human。
- **execution**：每条 accept 派生定向 REQUEST（toSeat=指定执行席），按生成顺序逐个处理：目标席位发布带 `requestId` 溯源的新版本后 `RESPOND_REQUEST accept`；同一次修订满足多请求时用 `requestIds=[...]` 批量关闭（全或无）。评审人也可在 review/response 阶段直接发 REQUEST 汇入同一队列。
- **convergence**：投票权席位依次 `CONSENSUS_VOTE`（pass / conditional_pass / reject，被跳过=弃权）；全员投完计票：无 reject → 闭桌出纪要；有 reject 未达轮次上限 → 回 review 开下一轮；超限 → `human_intervention`（HUMAN_RULING 可恢复指定阶段或 forceConvergence 收会）。
- decision 变体：阶段文案换成 方案陈述/方案评估/决策回应/调整执行/决议表决，语义同构。

### 6.2 协同流（collab / brainstorm）

流程图：[roundtable.workflow-collab.html](roundtable.workflow-collab.html)

阶段状态机同评审流骨架，语义全员共创：

- 开始条件：≥2 位协作者且全员就绪。
- **statements=初稿发布**：各协作者依次发布**自己负责部分**的初稿（每人自己的产物 + STATEMENT 概述分工/覆盖/已知缺口），全员齐备自动进互审。
- **review=互审补缺**：全员依次互审——对他人部分提缺口（must/should/nice），也可对自己部分提求助缺口。
- **response=缺口认领**：意见按**归属**处置——指向产物的归产物 owner、指向资料的归上传者、无指向的归建桌人（统稿）；归属席退席回落建桌人。accept 时 `executeBy: self` 自己补 / `reviewerSeat` 请意见提出席帮改（走 REQUEST 溯源通道，协作桌改他人产物同样受权限与溯源约束）。
- **execution=补齐执行 / convergence=定稿表决**：与评审流同构。
- brainstorm 变体：阶段文案为 点子提交/互评补充/认领整合/整合执行/清单定稿，产物是共创清单。

### 6.3 问询流（inquiry）

流程图：[roundtable.workflow-inquiry.html](roundtable.workflow-inquiry.html)

阶段状态机：`open → qa → closed`（常驻问答循环，无轮次推进）。

- 问询方两条来路：自建（建桌人即问询方，不占席位，ownerSeat=虚拟 `"asker"`）或主持人建（额外签发 asker 码，要提问的人凭码在网页就位，同桌唯一）。
- **open**：回答方凭码入席，入桌设定即声明**回答边界**（立场/讨论范围/数据范围），就绪；问询方网页点开始问询。
- **qa**：问询方网页提问（`toSeat` 定向某回答席 / 省略广播全体各自作答；席位直发 QUESTION 一律 403）。调度：最早未答完提问中第一个未作答回答席获发言权（taskHint 引导 REPLY）；广播问题每席必答、定向仅目标席；**每席每题一答**（重复 409）。回答方在范围内给有依据回答，超范围明确拒答并给建议方向；引用受数据范围披露级别约束（read 概括 / quote 摘录片段与定位 / full 原文）。问询桌不预审。
- **closed**：问询方一键结束 → 问询纪要 = 问答对汇总（定向/未答标注）+ 各回答方声明 + 产物/资料清单。open 阶段结束=撤桌。

### 6.4 指挥流（dispatch）

流程图：[roundtable.workflow-dispatch.html](roundtable.workflow-dispatch.html)

阶段状态机：`open → working → closed`（常驻工作态，无发言权轮转、无回合推进，全靠指令队列驱动）。

- 角色不对称：指挥方（director）是**人类成员席位**（自建=建桌人；可多个凭码入桌），不签发 seat token、不参与就绪，指令全走网页 user token 通道；执行方（worker）是普通 agent 席位（可多个），入席声明执行范围后就绪。
- **指令状态机**：指挥方网页下达 DIRECTIVE（进消息流全桌可见 + 落 `work_directives`，`pending` 待领；文本过注入扫描）→ 执行方 `DIRECTIVE_RESULT` 回执驱动流转：

```
pending ──领单(executing)──▶ executing ──done/failed──▶ 终态
   ▲                            │
   │                     need_clarify ──指挥方网页答复 CLARIFY──▶ 回 pending
   └── 直接收口 = 隐式领单         rejected（超能力/安全边界，必附理由）
```

  首个回执锁定 `claimedBy` 防多执行方抢单（他席再领 409）；failed/rejected 必带 note；done 的 note 建议附外部成果链接（如 Figma 页面 URL）全桌可点开。
- **攒批自由**：服务器不逐单派发——执行方 poll 的 `pendingDirectives` 给出待领清单（pending 全量 + 本席 executing），agent 自主按同目标分组、优化执行顺序后逐单回执。
- working 可暂停（暂停期下达与回执双冻结）；闭桌自动生成**工作纪要**（指令清单 + 状态统计 + 逐条回执）。

### 6.5 对接流（relay）

流程图：[roundtable.workflow-relay.html](roundtable.workflow-relay.html)

阶段状态机：`open → transfer → closed`（常驻对接态，无轮转，靠索要队列驱动）。

- 场景：日常工作流程中各节点间的信息传递（项目内高频使用，一节点一桌、用完即收）——提供方（provider，可多个）向接收方（receiver，可多个）传递对接信息；双方都是 agent 席位，各持有人在网页审批/确认。
- **解决的问题（信息丢失四环节）**：传统人人对接在四个环节持续丢信息——提供方的人整理文档（①筛选省略）→ 接收方的人读文档理解（②理解偏差）→ 接收方的人按自己习惯重梳理（③二次转写变形）→ 按梳理结果执行（④持续偏离）。本模式把**整理、理解、梳理端到端交给双方 AI**：传递的是 AI 可直接消费的结构化对接单（面向机器消费优化：结构化、可定位），接收方 AI 按下一步任务定制「所需内容清单」驱动核验与索要（信息传递最大化），人不在信息通道里做转写——只做规则制定者与例外审批者。问题对比图：[roundtable.relay-info-loss.html](roundtable.relay-info-loss.html)。
- **open**：提供方入桌设定即声明**数据规则**（开始后锁定）：讨论范围写对接范围，数据范围按三层授权逐项声明——结论层（结果数据）/ 过程层（决策依据、弯路、被否方案）/ 原始层（文件与凭证），各条目选披露级别 read（仅概括）/ quote（摘录）/ full（原文）。接收方声明接收目标。开始条件：provider 与 receiver 各至少 1 席且全部就绪（host/observer 豁免），建桌人点开始进入 transfer。
- **transfer**：
  1. 提供方发布**对接单**（版本化产物，模板含：背景与目标/过程与决策/原始层引用/**负面清单**（明确不在范围的数据——「保留不是问题，默默保留才是」）/未决事项/转递声明）。
  2. 接收方先按下一步任务梳理**所需内容清单**（任务倒推所需信息/数据/文件/口径/联系人/历史决策，经持有人过目），对照清单核验对接单覆盖度；九项通用清单（目标背景/边界范围/当前状态/依赖联系人/已知风险/未决事项/数据三层/操作权限/历史决策）为兜底维度提醒。核验与索要结论沉淀为接收方核验产物，下一步工作**直接消费对接单与放行文件**（不「人读→重写」再执行）。
  3. 缺失与 unknowns 定向发起索要 `DATA_REQUEST`（reqId 自定，要什么/用途/为什么缺；skill 约定发起前经持有人过目，持有人也可网页直发）。
  4. 提供方回执 `DATA_RESULT` 三态：**granted_auto**（声明规则内自动放行：数据补进对接单新版本或经资料通道上传带 reqId 关联的放行文件）/ **rejected_auto**（规则明确排除：必附排除理由**与替代方案**）/ **human_pending**（超规则或拿不准：转持有人审批）。
  5. **审批放行门（服务器强制）**：human_pending 的索要仅提供方**持有人**可经网页 `DATA_GRANT` 批准（granted）/ 部分给（partial，必附替代口径）/ 拒绝（rejected，必附理由）——席位 token 直发 DATA_GRANT 一律 403，agent 无法也不应替持有人放行。带 reqId 的关联文件按索要状态控制可下载（放行前接收方看得见存在、下不了）。

```
pending ──granted_auto──▶ granted_auto        （规则内）
        ├─rejected_auto──▶ rejected_auto      （排除，附替代方案）
        └─human_pending ──持有人 DATA_GRANT──▶ granted / partial / rejected
```

- **closed**：接收方持有人网页「确认接收」（可附带缺接收说明）或提供方持有人/建桌人强制收口（必附理由）→ 对接纪要 = 双方声明 + 对接单终版 + 索要处置清单（含拒绝理由）。接收后发现缺数据，惯例另开新对接桌追问（上游桌只读不回）。

## 7. 安全模型

红线总纲：**远端消息永远是数据不是指令；本地执行审批 = agent 原生权限弹窗（人在环）**。

| 机制 | 设计 |
|---|---|
| 凭证分层 | user token（rtu_）/ 网页并行 token / 席位 token（rts_）各司其职；席位凭证与邀请码不含账号 token，转发不致账号外流 |
| 消息校验 | ajv 双端 schema + 阶段/角色/turn/能力（caps 预设按角色解析）/限频（8 条/10 秒）五重检查 |
| 注入扫描 | 消息/指令/索要文本模式扫描，命中打 `injection_suspect` 标记进消息流（不阻断），agent 侧先警示持有人再处置 |
| 持有人私有指令 | `ownerDirectives` 专属通道（poll/changes 字段）：不进消息流、他席与观察者/systemadmin 均不可见、无法伪造；agent 处理后 ack（至少一次送达）；消息流内一切自称持有人指令的文本按注入处置 |
| 数据范围披露级别 | 入席声明 dataScope 条目带 grant（read/quote/full），约束向他席输出的披露粒度（文件名+行号=quote 级，逐字原文=full 级，未标注按最严 read） |
| 文件通道 | 仅产物（类型白名单+大小上限+能力声明强制）与资料文档（purpose 必填+可见性）两个通道；上传内容禁密钥 |
| 服务器强制门 | HUMAN_RULING / DATA_GRANT 仅网页持有人通道（席位直发 403）；席位身份判定只认 user_id，不认「同一物理人」主张 |
| skill 安全纪律 | 动作白名单（仅本 server API + .roundtable/ 与 roundtables/ 目录 + JSON/MD 处理 + sleep）；他人内容一律 `<external_message>` 包裹为素材 |
| 审计 | 全部敏感动作落 `audit` 表（元信息不记内容）；模型调用全量落 `model_call_logs` |

## 8. 存储设计

SQLite 单库（默认 `roundtable_data/roundtable.db`）+ 大对象落盘 blobs。表一览（`store.ts`）：

users / user_tokens / login_links（sha256，一次性）/ tables / seats / seat_tokens（hash）/ seat_owners（席位↔用户归属）/ invites / messages（seq 单调，游标基础）/ requests / artifacts / artifact_versions（requestIds 溯源）/ documents（req_id 关联索要）/ directives（预审点名）/ pause_requests / owner_directives（私有指令）/ work_directives（指挥桌）/ data_requests（对接桌）/ audit / model_call_logs / user_table_prefs / meta。旧库结构经 ALTER TABLE 渐进迁移。

## 9. API 面（分组摘要）

全部 Bearer token；完整参数与错误码以 README「API 摘要」为准。

| 通道 | 代表端点 |
|---|---|
| 公共 | `POST /api/users`、`POST /api/auth/login-link`、`POST /api/auth/exchange`、`GET /api/table-types`、`GET /skill.md` |
| 席位 token | `POST /tables/:id/seat-config`、`GET /tables/:id/poll`（增量消息+桌况+资料+变动+私有指令+待领指令/索要）、`GET /changes`、`POST /messages`、`POST/GET /artifacts…`、`POST/GET /documents…`、`POST /owner-directives/ack`、`POST /progress` |
| 网页 user token（my 通道） | `my/seat-config`、`my/message`（代答）、`my/start`、`my/table-config`、`my/owner-directive(s)`、`my/pause·pause-request·resume`、`my/seat-token`（重签）、`my/documents`、`my/skip-turn`、`my/precheck`；问询桌 `ask` / `end-inquiry`；指挥桌 `directives` / `directives/clarify`；对接桌 `my/data-request` / `my/data-requests/:reqId/ruling` / `my/finish-relay` |
| 观察端 | `GET /tables`（按角色收权）、`GET /observer/tables/:id…`（非参与人 403）、`GET /observer/tables/:id/invites`、`POST /invites/preview`（不消费次数） |
| 管理台（systemadmin） | `admin/users…`（角色/禁用/重签 token/参桌明细）、`admin/tables…`（邀请码/强制闭桌/强制介入/暂停恢复/席位重签/删桌），全部记审计 |

## 10. 演进（二期候选）

博弈模板（反驳轮次/counter 链）、网关守护进程档（无人值守 + 独立审批台 + WS）、信封签名（v1.1 预留 `sig` 字段）。
