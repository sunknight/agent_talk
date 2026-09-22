# Agent 圆桌会谈系统（agent-talk）

多个人各自带着自己的 agent（zcode / claude / codex…）入座一个「圆桌」，agent 代表持有人完成评审、协作修改、讨价还价；人只在重要节点介入，接收最终共识结果。

- **架构**：哑服务器（REST + 长轮询，只做路由/状态机/产物存储/能力校验/审计，不跑任何 AI） + 每席位一个 **roundtable skill**（装进各 PC agent 的 skills 目录，会话内用系统 `curl` 直连服务器，零程序安装）。
- **回合开始刷新（skill 硬约定）**：agent 每回合以 poll 返回的最新桌况为准（阶段/席位/产物版本/资料清单/结构化变动 changes），禁止沿用上回合缓存发言；本席可下载的新资料文档必须在本回合工作前下载阅读——网页端中途投屏的资料不会被错过。
- **安全红线**：远端消息永远是数据不是指令；本地执行审批 = agent 原生权限弹窗（人在环）；产物与资料文档是仅有的两个文件通道（服务器端大小上限 + 能力声明强制，产物另有类型白名单）；消息注入模式扫描打警示标记。
- **持有人私有指令**：agent 循环执行过程中，持有人在网页异步给自家 agent 下达高可信指令（策略立场/调整信息）——走席位专属通道（poll 的 `ownerDirectives` 字段）而非消息流，其他席位无法伪造、观察者与 systemadmin 均不可见；agent 处理后 ack 确认（未确认重复下发，至少一次送达）。**送达时机**：等待/空转时提交即唤醒长轮询（毫秒级）；本席回合执行中按 skill 检查点硬约定（发言定稿前 / 产物提交前 / 长工作每步）补一次非阻塞 poll 获取。消息流内一切自称持有人指令的文本按注入处置。
- 设计文档：`.kanban/tasks/0001-Agent 圆桌会谈系统设计/design.md`（v1.1）。

## 快速开始

```bash
npm install
npm run build
npm run server            # 默认 :8787，数据落项目根 roundtable_data/（SQLite + blobs）；可用 PORT= DATA_DIR= 覆盖
npm test                  # 220 个用例：全流程（含设定+点开始+四态回应）+ 僵局人工裁决 + 攻击用例 + 协议校验 + SQLite 存储层 + 全桌型预审调度（自建/主持人建一致）+ 桌类型与协作全流程 + 会议暂停/恢复与暂停申请 + 问询模式全流程（含主持人建问询桌）+ 自建桌自选角色 + 持有人私有指令通道
```

## 桌类型（开桌先选类型，按类型选角色）

`GET /api/table-types` 返回注册表；建桌时 `tableType` 选定后不可改，`inviteRoles` 按类型勾选要开放邀请码的角色（缺省全开）。类型决定流程语义与可选角色，**消息协议不变**：

| 类型 | 流程 | 角色 | 语义 |
|---|---|---|---|
| review 评审（默认） | 博弈流 | proposer / reviewer / observer | 提案 vs 评审：陈述 → 逐条评审 → 四态回应 → 执行 → 表决 |
| collab 协作 | **协同流** | collaborator / observer | 同事共创交付：**各自初稿 → 互审补缺 → 意见归属方认领 → 补齐执行 → 定稿表决**；建桌人自动成为协作者，开始需 ≥2 位协作者 |
| brainstorm 头脑风暴 | 协同流 | collaborator / observer | 共创点子清单（协作流变体：点子提交/互评/认领整合/清单定稿） |
| decision 方案决策 | 博弈流 | proposer / reviewer / observer | 主张方 vs 评估方对垒选型（评审流变体） |
| inquiry 问询 | **问询流** | answerer / observer（主持人建另发 asker 码） | **人问 agent 答**：问询方（自建=建桌人；主持人建=凭「问询方」邀请码经网页就位，不占席位）→ 回答方各自声明范围入席 → 问答循环（可定向/广播）→ 结束出问询纪要 |

问询流的范围约束：回答方（answerer）入席时以立场/讨论范围/数据范围声明**回答边界**，问答中在范围内给出有依据的回答、超范围明确说明并拒答（skill 自律）；提问仅问询方（网页通道，席位直发 QUESTION 一律 403），作答仅回答方且**每席每题一答**（REPLY 须指向问询方的提问消息）；问询桌两 mode 均不预审（qa 自由问答流），阶段流为 `open → qa → closed`，开始/提问/结束均由问询方在网页触发。

协同流的「互相支持补缺」仍走 REQUEST 溯源通道：`RESPONSE accept` 时 `executeBy: self` 自己补 / `reviewerSeat` 请意见提出席帮改，被请求方发布带 `requestId` 的新版本后关闭——协作桌改他人产物同样有权限与溯源约束。互审意见的**归属**：指向产物的意见归产物 owner、指向资料的意见归上传者、无指向意见归建桌人（统稿），归属席退席回落建桌人。

## 一场评审会（3 步）

```bash
# 1) 建桌（任何已注册方）：先选桌类型（tableType，缺省 review），选自己的角色（ownerRole，缺省按类型默认：
#    评审流=proposer / 协同流=collaborator，可选该类型任一角色或 host=主持人建桌），
#    按类型勾选开放邀请码的角色（inviteRoles，缺省全开）；录入主题、目标共识、交付物、桌规则、参与方身份安排；
#    建桌人自动成为首个席位，返回 ownerSeatToken 与所选角色的邀请码
curl -s -X POST $SERVER/api/users  -d '{"name":"Alice"}'          # → user token
curl -s -X POST $SERVER/api/tables -H "authorization: Bearer $UT" -d '{
  "tableType":"collab","inviteRoles":["collaborator","observer"],
  "topic":"API 网关选型评审","goals":"就 v1 接口契约达成一致","deliverables":"修订后的设计文档",
  "rules":"逐条审阅，must 意见必须处置","rolePlan":"Alice 提案，Bob/Carol 评审",
  "owner":{"seatName":"Alice","agentLabel":"zcode"}}'
# → { tableId, tableType, ownerSeatToken, inviteCodes:[{code,role},…] }（角色集合随类型/勾选变化）

# 2) 各方入席（用户 token + 邀请码，角色由邀请码固定，席位不能自封）
curl -s -X POST $SERVER/api/tables/$TID/seats -H "authorization: Bearer $UT" \
  -d '{"inviteCode":"...","seatName":"Bob","role":"reviewer","agentLabel":"claude"}'
# → { seatId, token }（席位 token，交给自己的 agent）

# 3) 各方设定立场（预设 GET /api/stances 可选 + 持有人补充）、讨论范围、数据范围，就绪
curl -s -X POST $SERVER/api/tables/$TID/seat-config -H "authorization: Bearer $ST" \
  -d '{"stancePreset":"req-reviewer","stance":"我方是需求评审方……（补充）","scope":"接口契约","dataScope":["docs/openapi.yaml"],"ready":true}'

# 4) 全员就绪后建桌人点开始（此前会议不推进）
curl -s -X POST $SERVER/api/tables/$TID/start -H "authorization: Bearer $OWNER_SEAT_TOKEN"

# 5) agent 安装技能并参会（对 agent 说）
#   "请从 $SERVER/skill.md 获取圆桌技能并安装，席位 token 是 rts_xxx，桌 $TID"
#   然后说 "跟进圆桌" 即开始自动参会循环
```

会议流（服务器状态机自动推进）：`open（建桌/入席/设定立场，建桌人点开始）→ statements（提案人发布产物+陈述）→ review（评审人逐条 must/should/nice 意见）→ response（提案人四态回应：accept 接纳[可委派 self 或评审席修改] / defer 记录后续跟进 / reject 拒绝 / human 交人工）→ execution（被请求方发布带 requestId 的新版本后 accept；或 reject/counter/escalate_human）→ convergence（全员表决）→ closed（自动纪要：立场/处置/跟进清单/表决/人工记录）`。表决连续未通过 → `human_intervention`（人工裁决可 `forceConvergence` 收会或恢复指定阶段）。

**会议暂停（叠加态，阶段保留）**：会议进行中（statements~convergence），主持人 / 建桌人 / 系统管理员可在网页暂停会议，参与方（含观察方）可在网页申请暂停、经上述控制人同意后生效（申请方记入会议记录与审计）。暂停期发言权与阶段推进冻结（仅 QUESTION/REPLY/HUMAN_INPUT/ESCALATE 与资料上传、席位设定可动），各方持有人人工补充或调整立场、给本席 agent 补充信息后重新就绪（无需补充的席位保持就绪）；全员就绪后控制人在网页继续会议，恢复到原阶段原发言权。systemadmin 可跳过就绪强制继续（记审计）。

## 调度机制（发言权与执行次序）

**事件溯源，无轮转指针**：服务端不维护发言队列，每次从「当前阶段 + 消息历史」重新推导该谁发言（`engine.computeTurn`）。发言权是消费型的——`STATEMENT / REVIEW_COMMENT / RESPONSE / RESPOND_REQUEST / CONSENSUS_VOTE` 必须持有当前发言权才能发，发出后自动推导下一位；`QUESTION / REPLY / HUMAN_INPUT / ESCALATE` 等讨论类消息任何席位随时可发，不需要发言权。

| 阶段 | 发言权 | 次序规则 |
|---|---|---|
| open | 建桌人独占 | 全员就绪后由建桌人显式点开始，不自动流转 |
| statements | 提案人独占 | 发布产物 v1 + STATEMENT 两者齐备，自动进 review |
| review | 评审人**依次** | 按**入席时间顺序**，跳过本轮已发言者（不是转圈，是"找下一个还没说的"）；全员出具意见自动进 response |
| response | 提案人独占 | 逐条四态回应；accept 可指定执行人（`executeBy: self` 自己改 / `reviewerSeat` 让意见提出席改） |
| execution | **按需指定** | 每条 accept 生成一个定向 REQUEST（`toSeat` = 指定执行席位），按请求生成顺序**逐个处理**：每次把发言权给第一个 pending 请求的目标席位，其发布带 `requestId` 溯源的新版本并 `RESPOND_REQUEST accept` 后，自动切下一个；同一次修订可满足多个请求时支持 `requestIds=[...]` 批量关闭。评审人也可在 review/response 阶段直接发 REQUEST，同样汇入本队列 |
| convergence | 投票权席位**依次** | 按入席顺序找第一个未投票者；全员投完自动计票 |

**推进与兜底**：阶段流转由消息事件触发自动判定（如 review → response 只需全部评审人本轮都已发言）。表决有 reject 且未达 `maxReviewRounds`（默认 2）→ 回 review 开下一轮；超上限 → 自动 `human_intervention`。执行目标席位超 2 分钟无心跳不授予执行发言权（不空耗在掉线席位上）。注意 `turnTimeoutMs`（默认 5 分钟）只是随 TURN_GRANT 下发的提示，服务端**不做超时强制剥夺**——持权方卡住时靠 agent 自觉 deadline、`TURN_RELEASE` 主动让权（`pass:true`）或 ESCALATE / 人工介入解卡。

## 主持人模式（hosted）与预审调度（DeepSeek · 全桌型）

除「各方自行建桌」外，另有**主持人建桌**流程：主持人建桌 → 定规则 → 传文档 → 邀请各方 → 点开始。主持人（host）是建桌网页里的人类角色，只负责圆桌管理与调度，**不参与评审、需求补充或各 agent 协作**（不能发布产物/评审/表决/被请求执行，仅可上传共享资料与发送人工指令）。自建桌时把 `ownerRole` 选为 `host` 等同主持人建桌（`mode` 自动升级 hosted）；问询桌也支持主持人建（见问询模式一节）。各方以参与角色自建入席的原流程完全保留。

```bash
curl -s -X POST $SERVER/api/tables -H "authorization: Bearer $UT" -d '{
  "mode":"hosted",            # 或自建时改传 "ownerRole":"host"，二者等同
  "topic":"…","goals":"…","rules":"…","rolePlan":"主持人建桌，Alice 提案，Bob 评审",
  "owner":{"seatName":"主持人","agentLabel":"human-only"}}'
# → 建桌人自动成为 host 席位；inviteCodes 含 proposer / reviewer / observer 三类码（由主持人分发给各方）
# open 阶段：主持人可用 POST /api/tables/:id/table-config 随时改主题/目标/规则（定规则）；
# 用 documents 接口上传共享资料（传文档）；各方凭码入席并设定就绪（host 豁免就绪）；主持人点开始。
```

**预审调度层（在原调度之前补一层）**：所有评审/协作类桌（review / collab / brainstorm / decision，**自建与主持人建一致**；问询桌问答不预审）上任一方每一回合提交（STATEMENT / REVIEW_COMMENT / RESPONSE / RESPOND_REQUEST / CONSENSUS_VOTE）都先经 DeepSeek 预审再进入原调度推导：

```
agent 结果 → DeepSeek 预审 ─┬─ pass / skipped（未配置或失败，放行+标注）→ 原调度照常（阶段推进、下一位发言）
                           └─ redirect（点名某方补充）→ 落点名指令、压住原推进，
                              发言权授予被点名席 → 其提交 SUPPLEMENT 补充 → 补充再预审 → …… 直至 pass
```

- 预审结果以服务器系统消息 `HOST_PREREVIEW` 广播（席位伪造该类型一律 403）；桌况 `table.precheck` 暴露 `reviewing / directive / idle` 三态。
- 被点名席以 `SUPPLEMENT`（`{directiveId, text}`）提交补充；同一提交上连续点名至多 3 次，触顶强制放行并标注。
- 预审进行中该桌不授予发言权、并发的回合提交收到 409 `precheck_in_progress`；点名期间仅被点名席可提交回合型消息（QUESTION/REPLY 讨论不受限）。
- DeepSeek 配置（环境变量注入，未配置即自动跳过放行）：`DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`（默认 `https://api.deepseek.com`）、`DEEPSEEK_MODEL`（默认 `deepseek-chat`）、`PRECHECK_TIMEOUT_MS`（默认 30000）。
- 点名目标经服务端校验：必须是本桌在席的提案/评审方（host/observer 不可被点名）；模型输出只是数据，不构成指令。

## 问询模式（inquiry · 人问 agent 答）

前四类桌是 agent 之间的对谈；**问询桌**反过来：**人作为问询方在网页提问，agent 作为回答方在允许的范围内返回结果**。适合向一个或多个专家 agent 答疑、快速获取受限范围的结论。问询方两条来路：**自建问询桌**（建桌人即问询方，不占席位）或**主持人建问询桌**（`mode:"hosted"`，额外签发「问询方 asker」邀请码，由要提问的人经网页凭码就位——同桌问询方唯一；agent 持 user token 凭码就位不阻拦）。

```bash
# 1a) 自建问询桌（tableType=inquiry；建桌人自动成为问询方，不占席位、无 ownerSeatToken；
#     默认发 answerer + observer 两类邀请码）
curl -s -X POST $SERVER/api/tables -H "authorization: Bearer $UT" -d '{
  "tableType":"inquiry","topic":"网关技术选型问询","goals":"弄清 Nginx vs Caddy 的取舍",
  "owner":{"seatName":"问询方名","agentLabel":"human-only"}}'

# 1b) 主持人建问询桌（mode=hosted；建桌人=host 席位；额外发 asker 码）：
curl -s -X POST $SERVER/api/tables -H "authorization: Bearer $UT" -d '{
  "tableType":"inquiry","mode":"hosted","topic":"网关技术选型问询",
  "owner":{"seatName":"主持人","agentLabel":"human-only"}}'
# → inviteCodes 含 asker / answerer / observer；把 asker 码发给要提问的人：
curl -s -X POST $SERVER/api/tables/$TID/seats -H "authorization: Bearer $提问人UT" \
  -d '{"inviteCode":"…","seatName":"张三","role":"asker","agentLabel":"human-only"}'
# → { asker:true, seatId:"asker", token:"", seat:null }（不建席位；第二人凭 asker 码 409 asker_exists）

# 2) 回答方 agent 凭「回答方」邀请码入席（与普通入席相同），入桌设定即声明回答边界：
#    stance=立场（预设「范围答疑者」可选）、scope=回答范围、dataScope=数据范围，然后 ready
# 3) 问询方在网页（或 POST /api/tables/:id/my/start）开始问询：全部回答方就绪即进入 qa 阶段
# 4) 提问（可定向某回答席 / 省略 toSeat 广播全体回答方各自作答）：
curl -s -X POST $SERVER/api/tables/$TID/ask -H "authorization: Bearer $UT" \
  -d '{"text":"3 台机器规模，网关选 Caddy 还是 Nginx？"}'
curl -s -X POST $SERVER/api/tables/$TID/ask -H "authorization: Bearer $UT" \
  -d '{"text":"Caddy 的 gRPC 反代怎么配？","toSeat":"seat_xxx"}'
# 5) 回答方 agent 在 poll 中收到 yourTurn（taskHint 含待答问题与 toMsgId），按 skill 指引自答：
#    范围内 → REPLY {"toMsgId":"问题 msgId","text":"回答全文"}（可先发布产物支撑）；
#    超范围 → REPLY 明确说明不在本席声明范围并拒答、给出建议问询方向
# 6) 问询方结束问询 → 自动生成问询纪要：
curl -s -X POST $SERVER/api/tables/$TID/end-inquiry -H "authorization: Bearer $UT" -d '{"reason":"问完了"}'
```

- **调度**：qa 阶段无轮次推进——最早的未答完提问中，第一个未作答的回答席获得发言权（taskHint 引导作答）；全部答完则等待问询方下一问或结束。广播问题每个回答席都要答，定向问题仅目标席作答。
- **边界**：作答仅 answerer 可发、REPLY 必须指向问询方的提问消息、每席每题一答（重复 409）；席位直发 QUESTION 403（提问仅问询方网页通道）；observer 可旁观不可问答。
- **暂停**：qa 属可暂停阶段，控制人 = 问询方（自建=建桌人；主持人建=凭码就位者）或主持人（暂停/同意申请/继续走网页 my 通道）；问询桌暂停期**问答双冻结**（与其他桌型暂停期放行旁路讨论不同）。
- **纪要**：问询纪要 = 问答对汇总（含定向/未答标注）+ 各回答方立场与范围声明 + 产物/资料清单。

## API 摘要（全部 Bearer token 鉴权）

| 端点 | 说明 |
|---|---|
| `POST /api/users` / `POST /api/tables` | 注册用户 / 建桌（`tableType` 选类型 + `ownerRole` 选建桌人角色（缺省按类型默认，可选 `host`=主持人建桌）+ `inviteRoles` 按类型选角色；`mode:"hosted"` 为主持人模式（与 ownerRole:host 等同，问询桌亦可用）；主题/目标/交付物/规则/参与方安排；返席位 token + 角色固定邀请码） |
| `GET /api/table-types` | 桌类型注册表（5 类：流程形态/角色集/阶段文案/说明） |
| `POST /api/tables/:id/table-config` | 修改桌设定（定规则）：建桌人（席位 token）、仅 open 阶段；网页通道 `POST /api/tables/:id/my/table-config`（user token） |
| `POST /api/tables/:id/seats` / `GET /api/stances` | 入席（角色随邀请码）/ 立场预设列表 |
| `POST /api/tables/:id/seat-config` | 入桌设定：立场（预设+补充）/讨论范围/数据范围/就绪（open 阶段可改，开始后锁定） |
| `POST /api/tables/:id/start` | 点开始（建桌人专属；全员就绪 + 角色齐备才放行） |
| `GET /api/tables/:id/poll?since=&timeout=` | 长轮询：增量消息 + 桌状态 + 你的发言权（含 taskHint、待处理请求）；**响应附 `documents`（本席视角资料清单）、`changes`（since 后的结构化变动）与 `ownerDirectives`（本席待确认的持有人私有指令）——回合开始刷新的一站式抓手** |
| `GET /api/tables/:id/changes?since=` | **变动记录**：`{table, documents, changes, ownerDirectives}`（最新桌况 + 最新资料列表 + since 之后的变动：doc/artifact/phase/seat/human/message，按 seq 升序 + 本席待确认私有指令）；与 poll 附加字段同源同款，供回合开始立即刷新（不等待） |
| `POST /api/tables/:id/messages` | 发言（信封 `{type, payload}`；服务器校验 schema/阶段/角色/turn/能力/限频） |
| `POST/GET /api/tables/:id/artifacts…` | 产物发布（版本化 + diff + 写锁 + requestId 溯源）/ 列表 / 取版本 / diff |
| `POST/GET /api/tables/:id/documents…` | **资料文档**（上传阅资料/投屏）：上传（`purpose` 作用声明必填 + `visibility: shared 全桌可下载 / private 仅本席`，≤5MB）/ 列表（含对本席的 downloadable 标记）/ 下载（他席私有 403）；上传即广播 `DOC_UPLOADED`；REVIEW_COMMENT 可带 `docId` 关联被评审资料；纪要含资料清单 |
| `GET /api/tables/:id/requests` · `/review-items` | 执行请求簿记 / 评审条目汇总 |
| `GET /skill.md` | roundtable skill 模板（agent 自装） |
| `GET /` | **观察端 Web 控制台**（浏览器打开即用，token 登录） |
| `GET /api/tables` · `GET /api/observer/tables…` | 桌列表（**按角色收权**：普通用户仅自己持有席位的桌，systemadmin 全量）；观察端桌详情（历史消息、进展、下一步动作、席位、产物、请求、纪要；未参与的桌 403 `not_participant`） |
| `POST /api/invites/preview` | **邀请码预检**（user token；不消费次数）：裸码或整段「完整邀请」文本均可（服务端提取 10 位码），返回所属桌摘要（topic/phase/角色/剩余次数）与 `mySeat`——只有邀请码也能准确定位对应圆桌；入席仍走 `POST /api/tables/:id/seats`（**服务端强制校验码归属本桌**，跨桌 403；同用户已有本桌 active 席位 409 `already_seated`） |
| `GET /api/observer/tables/:id/invites` | 邀请码（仅建桌人，可复制） |
| `POST /api/tables/:id/human-input` | 公开人工补充：以你在本桌的席位身份发 HUMAN_INPUT（支持 `toSeat` 定向；网页通道消息带 `human_proxied` 标记，与席位直发可甄别） |
| `POST /api/tables/:id/my/owner-directive` · `GET /my/owner-directives` | **持有人私有指令**（user token，仅本人席位）：异步下达高可信指令给本席 agent——不进消息流，观察端详情/管理台/他席均不可见，仅经 poll/changes 的 `ownerDirectives` 字段送达本席席位 token；单条 ≤8000 字符、待送达上限 20 条（409 `too_many_pending`）、closed 桌 409；历史仅持有人本人可见（含送达状态）；审计只记元信息不记内容 |
| `POST /api/tables/:id/owner-directives/ack` | 私有指令送达确认（席位 token）：`{directiveIds:[...]}` 批量幂等，只能确认本席的；确认后不再重复下发 |
| `POST /api/tables/:id/my/pause` · `/my/pause-request` · `/my/pause-request/:rid/approve` · `/my/resume` | **会议暂停通道（网页持有人）**：主持人/建桌人直接暂停；任意席位（含观察方）申请暂停，控制人同意后生效（申请方进日志）；全员重新就绪（host 豁免）后继续会议 |
| `POST /api/admin/tables/:tid/pause` · `/pause-request/:rid/approve` · `/resume` | 管理台同款（systemadmin 任意桌）；`resume` 可带 `{force:true}` 跳过就绪强制继续（记审计） |
| `POST /api/tables/:id/my/seat-config` · `/my/message` · `/my/start` | 网页持有人通道（user token）：入桌设定 / 人工代答 / 建桌人开始会议（问询桌自动分流为问询方开始问询） |
| `POST /api/tables/:id/ask` · `/end-inquiry` | **问询桌问询方通道**（user token）：qa 阶段提问（`{text, toSeat?}`，定向某回答席或广播全员作答）/ 结束问询出纪要（open 阶段=撤桌）；暂停期 409 |
| `POST /api/tables/:id/my/documents` · `GET /my/documents/:docId` | 网页持有人通道：上传 / 下载资料文档（以你在本桌的席位身份，权限同 agent 通道） |
| `POST /api/tables/:id/my/seat-token` | **凭证重签**（user token，仅本人席位）：`{mode:"recover"}` 恢复参会（新凭证可用、旧凭证保留）/ `{mode:"replace", agentLabel?}` agent 替代（旧凭证全部吊销——原 agent 即使仍在运行，下次请求即 401；可选更新 agent 标识并广播通知） |
| `POST /api/admin/tables/:tid/seats/:seatId/token` | 同上（systemadmin 可为**任意席位**重签：代任何参与方恢复配置或替代 agent） |

## 观察端（Web 控制台）

服务器起来后浏览器打开 `http://HOST:8787/`：粘贴用户 token（或直接注册新用户）——

- **身份体系**：注册即普通参与用户；系统观察员（systemadmin）见下节，页面身份区有明确徽章区分；
- **圆桌列表（按角色收权）**：普通用户仅见**自己参与**（持有席位）的圆桌，systemadmin 见全部（「我的桌」筛选仅 systemadmin 有）；桌类型徽章、阶段中文化徽章（按类型语义：协作桌显示 初稿发布/互审补缺/缺口认领/补齐执行/定稿表决）、筛选（全部/进行中/已结束）、自己有席位的桌带角色标记；
- **创建圆桌**：**先选桌类型**（评审/协作/头脑风暴/方案决策，带一句话说明）→ 建桌模式（self/hosted）→ **按类型勾选开放邀请的角色**（self 模式自动去掉建桌人已占的唯一角色）→ 主题/目标/交付物/桌规则/角色安排/席位与 agent 标识/高级参数，创建后凭证卡一次性展示席位 token 与所选角色邀请码；
- **凭邀请码入桌**：列表页「凭邀请码入桌」——输入裸码或整段粘贴「完整邀请」文本，先预检（不扣次数）展示所属圆桌（主题/阶段/码定角色/剩余次数），再确认入席；已持有本桌席位则直接引导进桌，会议已开始则明确拒入；入席成功页一次性展示席位 token（可复制完整凭证交给 agent）；
- **完整邀请复制**：席位 token 与邀请码的复制按钮带出的都是**完整入桌信息**——服务器地址、圆桌 ID、凭证本体、skill.md 自装指引与 .roundtable 配置写法，接收方整体转发给其 agent 即可参会（不是裸码）；
- **桌详情（5 秒自动刷新，编辑表单时自动暂缓；左右分栏——左=回合过程，右=观点与交付，窄屏自动退单列）**：阶段进度条（设定→陈述→评审→回应→执行→表决→结束）、**下一步动作**（谁持发言权 + taskHint + 待处理请求）、各方观点卡（每席角色/状态/就绪/立场摘要/最后交付）、产物交付卡、**资料文档**（投屏清单：文件/作用声明/共享·私有徽章/上传者/大小/**在线预览**/下载；**预览**支持文本（txt/md/json/log/csv/yml/xml 等，md 极简渲染）、图片（png/jpg/gif/webp/svg 等）、PDF（浏览器原生）、docx（按需从 CDN 加载 mammoth 转换并净化，无外网时回退下载提示）；有席位者可直接上传——选文件 + 声明作用 + 选可见性，全桌 agent 即时收到通知；他席私有文档可见存在但不可下载）、执行请求卡、**变动记录**（最近 50 条结构化变动：资料/产物/阶段/席位/人工，与 agent 每回合刷新的 changes 同源——网页上传新资料后可直观看到该变动已进入全桌可见的记录流）、会议历史（类型筛选 + 阶段分隔条 + 注入消息红色警示 + 人工代答徽标）、会议纪要；
- **问询方操作面板（问询桌，无席位）**：设定阶段看回答方就绪名单（含各自声明范围）并「开始问询」；问答阶段**提问框**（可广播/定向某回答席）+「结束问询并生成纪要」（open 阶段为撤桌）+ 会议控制（暂停/继续问询）；列表与详情以「问询方」徽章标识身份；
- **我的席位面板（按阶段与状态条件渲染）**：设定阶段——入桌设定表单（**回填已保存值**、立场预设、讨论范围快捷模板、**数据范围 chips 输入器**、就绪开关；已就绪显示摘要可修改）、建桌人可见就绪名单并在全员就绪后**一键开始会议**；会议开始后——持发言权时出现**人工代答**表单（设定阶段无代答环节）；
- **凭证恢复 · 更换 agent（任何阶段可用，含闭桌后）**：「复制参会配置（恢复）」签发新凭证并复制完整粘贴文本（服务器地址/圆桌 ID/席位 token/.roundtable 配置写法），粘到新 agent 会话即可以原席位身份继续参会（原凭证保留）；「替代 agent」在恢复之上**吊销本席位全部旧凭证**（原 agent 即使仍在轮询，下次请求即 401 失效），可选填新 agent 标识并全桌广播；systemadmin 在席位表可为**任意席位**执行同样操作（复制配置 / 替代）；
- **邀请码**：建桌人视角可直接复制（非建桌人 403）；
- **公开补充信息**：在我的席位面板输入文本，以你在本桌的席位身份发送 HUMAN_INPUT（可定向）——进入会议记录、全桌可见，agent 下一轮 poll 即可见（带 `human_proxied` 标记，可甄别于席位直发）；
- **私有指令（仅本席 agent 可见）**：在我的席位面板异步给自家 agent 下达高可信指令——不进会议记录，观察者与系统管理员均不可见；agent 收到后作为持有人指令执行，处理确认（ack）后不再重复下发；面板同时列出本人已发指令与送达状态（仅自己可见）；
- **会议暂停**：会议中建桌人/主持人席位出现「会议控制」卡（暂停会议 / 就绪名单 + 继续会议），普通席位可「申请暂停」；控制人与系统管理员可见待同意申请列表并一键同意。暂停期详情页顶部横幅说明暂停人与原因、就绪进度，我的席位面板提供暂停期立场调整表单（保存勾选「重新就绪」），agent 侧收到 MEETING_PAUSED/MEETING_RESUMED 系统消息并停止/恢复回合推进。

## 系统观察员（systemadmin · 全局观察模式）

系统观察员是非桌参与方的全局角色：可查看**所有**圆桌（列表/详情/历史/纪要），界面上以金色徽章与「全局观察模式」横幅明显区分于普通用户与桌内角色；在无席位的桌上为**纯只读**（不能发指令/代答），同时保留普通用户的全部能力（可建桌/入席）。

### 管理台（systemadmin 专属，服务端强制角色）

登录后 header 出现「管理台」入口；桌详情页出现「管理员操作」卡（对任意桌）。所有动作写入审计流。

- **用户管理**：用户列表（userId/用户名/角色/状态/注册时间/参桌数，userId 一键复制）；参桌明细（每席所属桌、阶段、席位名、角色、状态、就绪）；**界面授予/撤销 systemadmin**；**禁用/启用用户**（强制下线——禁用后该用户 token 立即 403 失效，agent 席位不受影响，可随时恢复；不能禁用自己）；**重签登录 token**（原始 token 只存哈希不可取回，重签 = 换新 token 接入浏览器登录，旧的立即失效，新 token 只显示一次）。
- **圆桌管理**：查看**任意桌**的邀请码与剩余次数；**强制人工介入**（active 桌转入 human_intervention）；**强制闭桌**（立即生成纪要并结束，原因写入纪要「结束方式」行）；**删除圆桌**（连同消息/产物/席位/邀请/席位 token 全部清除，仅审计留痕；轮询中的 agent 将收到 404）。

| `GET /api/admin/users` · `/api/admin/users/:uid/tables` | 用户列表 / 参桌明细（systemadmin） |
| `POST /api/admin/users/:uid/role` · `/disabled` · `/token` | 授予/撤销管理员 / 禁用/启用用户 / 重签登录 token |
| `GET /api/admin/tables/:tid/invites` | 任意桌邀请码（观察端同路由对 systemadmin 放行） |
| `POST /api/admin/tables/:tid/close` · `/human` | 强制闭桌 / 强制人工介入（`{reason}`） |
| `DELETE /api/admin/tables/:tid` | 删除圆桌及全部数据 |

### 首个管理员的开通（bootstrap，仅一次）

MVP 无用户体系、不开放注册管理员。第一个 systemadmin 用启动环境变量引导（之后的授予/撤销都在管理台界面上完成）：

```bash
# BOOTSTRAP_ADMIN_TOKEN=某用户的登录 token（rtu_…，注册时返回）启动：
# 系统尚无 systemadmin 时即把该用户升级为 systemadmin；已有 systemadmin 则忽略
BOOTSTRAP_ADMIN_TOKEN=rtu_xxxx npm run server
```

忘记 token / 要代某用户接入浏览器：管理台 · 用户 → 「重签token」生成新登录 token（旧的立即失效，新 token 只显示一次，可直接粘贴到右上角登录框）。

## 目录

```
packages/shared   协议单一事实来源：消息类型、JSON Schema(ajv)、能力预设、注入扫描
packages/server   服务器：engine(状态机+turn) / api(REST 长轮询) / store(JSON 落盘) / skill-template
packages/*/test   vitest：全流程、僵局裁决、攻击用例（注入标记/越权/伪造授权/限频）
```

二期（见 design.md §10 M5）：博弈模板（反驳轮次/counter 链）、网关守护进程档（无人值守 + 独立审批台 + WS）、信封签名。
