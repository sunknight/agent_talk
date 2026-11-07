/* 观察端 JS 核心段：多帐号存储/登录与工具函数/常量映射与徽章/弹窗体系/帮助文案/消息摘要 — <script> 首段。
   含全模板唯一 ${} 插值：TABLE_TYPES 构建期注入。 */
import { TABLE_TYPES } from '@rt/shared';
export const OBSERVER_JS_CORE = String.raw`'use strict';
/* ---------- 多帐号存储 ----------
   rt_accounts：本浏览器登录过的帐号数组 [{token,userId,name,role}]；rt_active_uid：当前活跃帐号。
   旧单帐号键（rt_token 等）首次加载时自动并入；切换帐号 = 改活跃指针后整页重载（无视图态残留）。 */
function loadAccounts(){
  var arr;
  try { arr=JSON.parse(localStorage.getItem('rt_accounts')||'[]'); } catch(e){ arr=[]; }
  if(!Array.isArray(arr)) arr=[];
  arr=arr.filter(function(a){ return a&&a.token; });
  var legacy=localStorage.getItem('rt_token');
  if(legacy && !arr.some(function(a){ return a.token===legacy; })){
    arr.unshift({ token:legacy, userId:localStorage.getItem('rt_user_id')||'', name:localStorage.getItem('rt_user_name')||'', role:localStorage.getItem('rt_role')||'user' });
    localStorage.setItem('rt_accounts',JSON.stringify(arr));
  }
  return arr;
}
function saveAccounts(){ localStorage.setItem('rt_accounts',JSON.stringify(ACCOUNTS)); }
/** 登录成功后记录帐号（userId 去重、重复登录覆盖旧 token）并设为活跃 */
function accountUpsert(a){
  var i=ACCOUNTS.findIndex(function(x){ return (a.userId&&x.userId===a.userId)||(x.token===a.token); });
  if(i>=0) ACCOUNTS.splice(i,1);
  ACCOUNTS.unshift({ token:a.token, userId:a.userId||'', name:a.name||'', role:a.role||'user' });
  saveAccounts();
  localStorage.setItem('rt_active_uid',a.userId||a.token);
}
var ACCOUNTS=loadAccounts();
var ACTIVE_UID=localStorage.getItem('rt_active_uid')||'';
var activeAcct=ACCOUNTS.filter(function(a){ return a.userId&&a.userId===ACTIVE_UID; })[0]||ACCOUNTS[0]||null;
if(activeAcct&&activeAcct.userId) localStorage.setItem('rt_active_uid',activeAcct.userId);
var TOKEN = activeAcct?activeAcct.token:'';
var view = { mode:'intro', tableId:null, timer:null, lastDetailJson:'', lastDetailData:null,
  userName: activeAcct?(activeAcct.name||''):'', userId: activeAcct?(activeAcct.userId||''):'',
  role: activeAcct?(activeAcct.role||'user'):'user',
  listFilter:'all', listTables:[], dirtyPanel:false, cfgEditing:false, dsDraft:[], rtExpanded:false, qaPairs:[],
  /* 会话视图与输入聚合：chatFilter 气泡筛选 / cmpType 当前输入类型 / seatOpen 折叠子区块开合（抗轮询重渲染）/
     chatAtBottom+cbPrevTop 会话滚动贴底与回位 */
  chatFilter:'all', cmpType:'', seatOpen:{}, chatAtBottom:true, cbPrevTop:0,
  /* 执行时序图：tlOpen 展开 / tlStick 纵向贴底跟随（同 chatAtBottom 模式，上翻即停）/ tlModel+tlRun 渲染期数据（节点弹窗与 1s ticker 取用） */
  tlOpen:true, tlStick:true, tlModel:null, tlRun:[], tlTimer:null,
  /* chatbox 左右侧个人偏好（服务端按用户×圆桌持久化；渲染唯一来源，轮询仅在无保存在途时同步）
     sidesSaving：保存在途计数（乐观更新后防轮询用旧服务端值回滚） */
  chatSides:{}, sidesSaving:0 };

/* ---------- 常量映射 ---------- */
var PHASE_LABEL = { open:'设定中', qa:'问答', working:'工作中', statements:'提案陈述', review:'评审', response:'回应评审', execution:'执行修改', convergence:'共识表决', human_intervention:'人工介入', closed:'已结束' };
var PHASE_CLS = { open:'', statements:'phase', review:'phase', response:'phase', execution:'phase', convergence:'phase', working:'phase', human_intervention:'err', closed:'ok' };
var ROLE_LABEL = { proposer:'提案方', reviewer:'评审方', observer:'观察方', host:'主持人', collaborator:'协作者', answerer:'回答方', asker:'问询方', worker:'执行方', director:'指挥方', provider:'提供方', receiver:'接收方' };
/* 桌类型注册表（构建期自服务端 TABLE_TYPES 注入，与 GET /api/table-types 同源）：id/label/description/flow/roles/uniqueRoles/phaseLabels */
var TABLE_TYPES = ${JSON.stringify(TABLE_TYPES)};
var TT_BY_ID = {}; TABLE_TYPES.forEach(function(t){ TT_BY_ID[t.id] = t; });
function ttOf(id){ return TT_BY_ID[id] || TT_BY_ID.review; }
/* 各桌模式帮助（建桌表单「?」按钮弹窗内容；面向使用者，不写实现细节） */
var MODE_HELP = {
  review: {
    brief: '提案方与评审方的博弈流：提案方发布产物并陈述，评审方逐条出具 must/should/nice 意见，提案方四态回应（接纳/暂缓/拒绝/交人工），接纳项落实修订后全员表决收敛。',
    fit: '方案 / 文档 / 代码评审等需要「一方提案、多方挑刺」对峙结构的场景。',
    roles: '提案方（唯一）· 评审方（可多个）· 观察方（只读）；可选主持人建桌。',
    flow: '设定 → 陈述 → 评审 → 回应 → 执行 → 表决 → 结束（自动纪要）',
    usage: [
      '建桌选「评审」，我的角色默认提案方（也可选评审方/观察方，或主持人建桌只管规则与调度）',
      '把评审对象作为共享资料上传（全桌 agent 自动阅读），或由提案方 agent 以产物形式发布',
      '各方凭邀请码入席，完成入桌设定（立场/范围/数据范围）并就绪',
      '开始会议：提案方发布产物并陈述 → 评审方逐条意见 → 提案方逐条回应',
      '接纳项进入执行（自己改或请意见提出席帮改），完成后全员表决，通过即出纪要'
    ],
    best: [
      '桌规则写硬约束，如「must 意见必须处置」',
      '评审对象用共享资料投屏，agent 每回合开始会自动读取，不会错过',
      '「请意见提出席帮改」适合评审方更懂那块内容的场景',
      '僵局别硬耗：人工裁决可恢复到指定阶段重来，或强制收会出纪要'
    ]
  },
  decision: {
    brief: '评审流的选型变体：多方主张不同方案，评估方对垒打分，走同一套 陈述→评估→回应→执行→表决 收敛到决议。',
    fit: '多方案选型决策（技术选型、路线取舍），需要结构化对照与明确决议的场景。',
    roles: '主张方（唯一）· 评估方（可多个）· 观察方；可选主持人建桌。',
    flow: '设定 → 方案陈述 → 方案评估 → 决策回应 → 调整执行 → 决议表决 → 结束',
    usage: [
      '建桌选「方案决策」，主张方席位（或其 agent）把各候选方案整理为产物发布',
      '评估方按统一维度出具 must/should/nice 意见（成本/风险/迁移代价等）',
      '主张方逐条回应并调整方案，流程与评审桌一致',
      '决议表决通过后闭桌，纪要含最终决议与各方案对照记录'
    ],
    best: [
      '每个候选方案各建一个产物版本，便于逐版本对照评估',
      '评估维度在建桌「桌规则」里约定，避免各评估方口径不一',
      '评估意见落到具体方案条目上，方便主张方逐条回应'
    ]
  },
  collab: {
    brief: '同事共创交付的协同流：各协作者发布自己负责部分的初稿，全员互审补缺，缺口按归属认领处置，补齐后定稿表决——要的是互相补缺，不是对抗。',
    fit: '多人分工合写一份交付物（文档、方案、白皮书），需要互相审阅查缺补漏的场景。',
    roles: '协作者（至少 2 位，含建桌人）· 观察方；可选主持人建桌。',
    flow: '设定 → 初稿发布 → 互审补缺 → 缺口认领 → 补齐执行 → 定稿表决 → 结束',
    usage: [
      '建桌选「协作」（你就是首位协作者），在「角色安排说明」写清各人负责的部分',
      '把「协作者」邀请码发给各参与方的 agent，各自入席设定并就绪（至少 2 位协作者才能开始）',
      '开始会议：各协作者依次发布自己负责部分的初稿并概述分工',
      '全员互审：对他人部分提缺口意见，也可对自己的部分发「求助」缺口',
      '缺口按归属派给处置人（指向谁的产物谁认领；没指向的归建桌人统稿），补齐执行后定稿表决'
    ],
    best: [
      '分工提前在「角色安排说明」写死，避免初稿重叠或漏块',
      '桌规则常写「互审补缺、认领必达」',
      '开始前把参考资料作为共享资料上传，全桌共创基于同一底料',
      '认领时可用「请提出意见的那位帮改」——协作桌改他人产物同样有权限与溯源约束'
    ]
  },
  brainstorm: {
    brief: '协作流的变体：共创一份点子清单，点子提交 → 互评补充 → 认领整合 → 整合执行 → 清单定稿，流程与协作桌完全一致。',
    fit: '头脑风暴、方案征集、创意清单共创——先发散收集，再收敛整合。',
    roles: '协作者（至少 2 位）· 观察方；可选主持人建桌。',
    flow: '设定 → 点子提交 → 互评补充 → 认领整合 → 整合执行 → 清单定稿 → 结束',
    usage: [
      '建桌选「头脑风暴」，各协作者入席就绪后开始',
      '点子提交：每人发布自己的点子初稿（产物）并陈述',
      '互评补充：对他人点子提延伸/组合/反例，也可为自己的点子征集帮助',
      '认领整合与清单定稿：按协作桌同一套认领-补齐-表决流程收敛出终版清单'
    ],
    best: [
      '互评阶段只补不批：意见以延伸、组合、反例为主，收敛阶段再砍',
      '点子粒度小而具体，一份产物聚焦一组相关点子',
      '终版前用定稿表决让全员对「砍掉了什么」达成共识'
    ]
  },
  inquiry: {
    brief: '人问 agent 答：你在网页提问，各回答方 agent 在自己声明的范围内给出有依据的回答；超范围的问题会明确拒答并给建议方向。问完一键出问询纪要。',
    fit: '向一个或多个专家 agent 快速答疑、获取受限范围的结论（技术选型、制度咨询、数据口径…）。',
    roles: '问询方（人，不占席位——自建即建桌人，或凭「问询方」邀请码就位）· 回答方（可多个）· 观察方。',
    flow: '设定 → 问答（可暂停，无轮次）→ 结束（问询纪要）',
    usage: [
      '建桌选「问询」，我的角色选「问询方」——你就是提问的人，不占席位',
      '把「回答方」邀请码发给各 agent：其入席时各自声明回答范围（能答什么、可用哪些资料）并就绪',
      '桌详情点「▶ 开始问询」进入问答',
      '会话输入框选「提问」：可广播（每个回答方都要答）或定向某回答席；回答实时出现在会话区',
      '问完点「结束问询」自动生成问询纪要（问答对汇总 + 各方声明范围）'
    ],
    best: [
      '广播提问可获得多方对照答案，定向追问特定专家',
      '一次问透一个点，比打包大问题得到的答案质量更高',
      '敏感内容让回答方在数据范围里从严声明披露级别（仅概括/可摘录/可原文）',
      '主持建桌模式可让代理提问人凭「问询方」码就位，适合替别人收集答疑'
    ]
  },
  dispatch: {
    brief: '多人指挥 agent 干活：指挥方（人类席位）在网页随时异步下达工作指令，执行方 agent 领单执行、逐单回执（完成/失败/反问/拒单），全靠指令队列驱动。',
    fit: '多人对着一两个 agent 派活——典型如各自微调同一份设计稿、批量执行运营操作。',
    roles: '指挥方（人类成员席位，可多个——自建即建桌人，或凭码入桌）· 执行方 agent（可多个）· 观察方。',
    flow: '设定 → 工作中（常驻，指令队列驱动）→ 结束（工作纪要）',
    usage: [
      '建桌选「指挥」，你自动成为指挥方（人类席位，无需 agent 凭证）',
      '把「执行方」邀请码发给干活的 agent（可多个，入席声明执行范围）；「指挥方」码发给其他要下指令的人',
      '执行方就绪后点「▶ 开始工作」',
      '会话输入框选「下指令」随时异步下达（多条自动排队）；「工作指令」卡实时显示每条状态',
      'agent 逐单回执：完成附结果说明（外部成果给链接，点开即看）、不明确会反问（你在卡上内联答复，指令重新可领）、超界拒单附理由；干完闭桌出工作纪要'
    ],
    best: [
      '一条指令一个明确目标，别把五件事塞一条',
      '涉及外部系统（如设计稿）让 agent 把成果链接写进回执，全桌可点开实时查看',
      '执行方有攒批自由：同目标的几条指令可能被合并处理，属正常优化不是丢失',
      '工作可暂停（暂停期下达与回执都冻结），适合中途调整方向'
    ]
  },
  relay: {
    brief: '日常工作流程中各节点间的信息传递：提供方 agent 按声明的数据规则打包对接单，接收方 agent 核验完整性并对缺失项定向索要；超出提供方规则的数据必须由提供方持有人亲自在网页审批放行（agent 不能自批）。',
    fit: '项目内高频的节点对接——要控数据范围、要留痕、要防「默默保留」；一节点一桌、用完即收。',
    roles: '提供方（agent 席位，可多个）· 接收方（agent 席位，可多个）· 观察方；双方持有人在网页审批/确认。',
    flow: '设定 → 对接中（常驻，索要队列驱动）→ 结束（对接纪要）',
    usage: [
      '发起对接的一方建桌选「对接」（默认提供方），双方 agent 凭码入席',
      '提供方入席声明数据规则（结论层=结果 / 过程层=决策依据 / 原始层=文件凭证，每项从严选披露级别），开始后锁定；接收方声明接收目标',
      '双方就绪后，建桌人在桌详情点开始进入对接；提供方发布「对接单」（日常轻量对接给结论+负面清单+未决三段即可，数据敏感时才展开三层）',
      '接收方核验缺失项后定向发起数据索要；提供方按规则回执：规则内自动放行 / 明确排除拒绝并给替代方案 / 超规则转审批',
      '待审批索要出现在「数据索要」卡：提供方持有人批准 / 部分给 / 拒绝；全部处置完由接收方持有人「确认接收」结束（可附缺接收说明）'
    ],
    best: [
      '提供方负面清单务必写全——「没拿到什么」本身就是关键对接信息',
      '接收方发起索要前先把清单给持有人过目再发（也可由持有人在网页直接发）',
      '接收后发现还缺数据，别在旧桌纠缠：另开新对接桌，把旧纪要当背景',
      '提供方强制收口必附理由，纪要会留痕；关联文件放行前接收方看得见下不了，放行后自动可下载'
    ]
  }
};
var MODE_HELP_FOOT = '「我的角色」任选该类型的任一角色或主持人（只管规则/资料/邀请与调度）；「开放邀请的角色」每个勾选角色发一张邀请码（10 次 / 7 天），角色由码定死。';
function typeBadge(tt){ return '<span class="rb ttype" title="'+escAttr(ttOf(tt).description||'')+'">'+esc(ttOf(tt).label)+'</span>'; }
function phaseLabel(tt, ph){ var d = ttOf(tt); return (d.phaseLabels && d.phaseLabels[ph]) || PHASE_LABEL[ph] || ph; }
var STEP_DEFS = [['open','设定'],['statements','陈述'],['review','评审'],['response','回应'],['execution','执行'],['convergence','表决'],['closed','结束']];
var MT_LABEL = { PHASE_CHANGE:'阶段变更', SEAT_JOINED:'入席/设定', SEAT_LEFT:'退席', ARTIFACT_PUBLISHED:'产物发布', DOC_UPLOADED:'资料上传', MINUTES:'会议纪要', CONSENSUS_RESULT:'表决结果', STATEMENT:'提案陈述', REVIEW_COMMENT:'评审意见', RESPONSE:'回应评审', REQUEST:'执行请求', RESPOND_REQUEST:'请求处置', CONSENSUS_VOTE:'表决', QUESTION:'提问', REPLY:'回答', HUMAN_INPUT:'人工指令', HUMAN_RULING:'人工裁决', ESCALATE:'申请介入', INFO:'系统通知', HOST_PREREVIEW:'预审结果', SUPPLEMENT:'补充提交', MEETING_PAUSED:'会议暂停', MEETING_RESUMED:'继续会议', PAUSE_REQUESTED:'暂停申请', TURN_SKIPPED:'跳过发言', PARALLEL_DISPATCH:'并行调度', DIRECTIVE:'工作指令', DIRECTIVE_RESULT:'指令回执', DIRECTIVE_CLARIFY:'澄清答复', DATA_REQUEST:'数据索要', DATA_RESULT:'索要回执', DATA_GRANT:'审批放行' };
var MT_CLS = { PHASE_CHANGE:'mt-phase', SEAT_JOINED:'mt-sys', SEAT_LEFT:'mt-sys', ARTIFACT_PUBLISHED:'mt-sys', DOC_UPLOADED:'mt-sys', INFO:'mt-sys', MINUTES:'mt-min', CONSENSUS_RESULT:'mt-min', STATEMENT:'mt-st', REVIEW_COMMENT:'mt-rev', RESPONSE:'mt-rev', REQUEST:'mt-req', RESPOND_REQUEST:'mt-req', CONSENSUS_VOTE:'mt-vote', QUESTION:'mt-q', REPLY:'mt-q', HUMAN_INPUT:'mt-human', HUMAN_RULING:'mt-human', ESCALATE:'mt-human', HOST_PREREVIEW:'mt-phase', SUPPLEMENT:'mt-st', MEETING_PAUSED:'mt-req', MEETING_RESUMED:'mt-phase', PAUSE_REQUESTED:'mt-human', TURN_SKIPPED:'mt-human', PARALLEL_DISPATCH:'mt-phase', DIRECTIVE:'mt-q', DIRECTIVE_RESULT:'mt-st', DIRECTIVE_CLARIFY:'mt-q', DATA_REQUEST:'mt-q', DATA_RESULT:'mt-st', DATA_GRANT:'mt-human' };
var CHAT_SPEECH={STATEMENT:1,REVIEW_COMMENT:1,RESPONSE:1,SUPPLEMENT:1,CONSENSUS_VOTE:1,ARTIFACT_PUBLISHED:1,REQUEST:1,RESPOND_REQUEST:1,QUESTION:1,REPLY:1,DIRECTIVE:1,DIRECTIVE_RESULT:1,DIRECTIVE_CLARIFY:1,DATA_REQUEST:1,DATA_RESULT:1,DATA_GRANT:1};
var CHAT_HUMAN_MSG={HUMAN_INPUT:1,HUMAN_RULING:1,ESCALATE:1};
var CHAT_VIEWS=[['all','全部'],['speech','发言'],['human','指令'],['sys','系统']];
function chatShow(m){
  var v=view.chatFilter||'all';
  if(v==='all') return true;
  if(v==='speech') return !!CHAT_SPEECH[m.type];
  if(v==='human') return !!CHAT_HUMAN_MSG[m.type];
  return !CHAT_SPEECH[m.type]&&!CHAT_HUMAN_MSG[m.type];
}
/* 详情页阶段（prep 准备 / ready 就绪待开始 / running 进行中 / paused 暂停 / ended 结束）：
   派生自 phase + 就绪度，驱动模块显隐与主题卡阶段徽章 */
var STAGE_LABEL={prep:'准备中',ready:'全员就绪 · 待开始',running:'进行中',paused:'已暂停',ended:'已结束'};
function stageOf(t,seats){
  if(t.phase==='closed') return 'ended';
  if(t.phase==='open'){
    var need,rolesOk,flow=ttOf(t.tableType).flow;
    if(flow==='inquiry'){
      need=seats.filter(function(s){ return s.role==='answerer'; });
      rolesOk=need.length>0;
    }else if(flow==='dispatch'){
      /* 指挥桌：指挥方（人类席位）不参与就绪，只看执行方（对齐服务端 startTable） */
      need=seats.filter(function(s){ return s.role==='worker'; });
      rolesOk=need.length>0;
    }else{
      need=seats.filter(function(s){ return s.role!=='host'; });
      /* 角色齐备按流程（对齐服务端 startTable）：协作流协作者≥2，评审流才需提案方+评审方 */
      rolesOk=flow==='collab'
        ?seats.filter(function(s){ return s.role==='collaborator'; }).length>=2
        :seats.some(function(s){ return s.role==='proposer'; })&&seats.some(function(s){ return s.role==='reviewer'; });
    }
    return (rolesOk&&need.length>0&&need.every(function(s){ return s.config&&s.config.ready; }))?'ready':'prep';
  }
  if(t.pause) return 'paused';
  return 'running';
}
var PRV_LABEL = { pass:'通过', redirect:'点名补充', skipped:'跳过（放行）' };
var SEV_LABEL = { must:'必须', should:'建议', nice:'可选' };
/* 工作指令状态/回执结论中文（指挥桌） */
var WD_STATUS = { pending:'待处理', executing:'执行中', done:'已完成', failed:'执行失败', need_clarify:'待澄清', rejected:'已拒单' };
var WD_OUTCOME = { executing:'领单执行中', done:'已完成', failed:'执行失败', need_clarify:'需要澄清', rejected:'拒单' };
/* 数据索要状态/回执/审批中文（对接桌） */
var DR_STATUS = { pending:'待处置', granted_auto:'已放行·规则内', rejected_auto:'已拒绝·规则排除', human_pending:'待持有人审批', granted:'已放行·批准', partial:'部分给·替代', rejected:'已拒绝' };
var DR_OUTCOME = { granted_auto:'放行（规则内）', rejected_auto:'拒绝（规则排除）', human_pending:'转持有人审批' };
var DR_GRANT = { granted:'批准放行', partial:'部分给（替代方案）', rejected:'拒绝' };
/** 消息 → 展示正文（chatbox 气泡渲染用；HOST_PREREVIEW 点名带席位名） */
function msgBodyText(m,seats){
  var p=m.payload||{}, body='';
  if(m.type==='DIRECTIVE') body=(p.title?('【'+p.title+'】'):'')+(p.text||'');
  else if(m.type==='DIRECTIVE_RESULT') body='【'+(WD_OUTCOME[p.outcome]||p.outcome||'')+'】'+(p.outcome==='need_clarify'?(p.clarify||''):(p.note||''));
  else if(m.type==='DIRECTIVE_CLARIFY') body='澄清答复：'+(p.answer||'');
  else if(m.type==='DATA_REQUEST') body=(p.title?('【'+p.title+'】'):'')+(p.text||'')+(p.toSeat?(' → '+seatName(seats,p.toSeat)):'');
  else if(m.type==='DATA_RESULT') body='【'+(DR_OUTCOME[p.outcome]||p.outcome||'')+'】'+(p.note||'')+((p.docIds&&p.docIds.length)?('　文件：'+p.docIds.join('、')):'');
  else if(m.type==='DATA_GRANT') body='【'+(DR_GRANT[p.decision]||p.decision||'')+'】'+(p.note||'');
  else if(typeof p.text==='string') body=p.text;
  else if(p.items){ try{ body=p.items.map(function(it){ return (it.target||'')+'：'+(it.comment||it.decision||''); }).join('；'); }catch(e){} }
  else if(m.type==='PHASE_CHANGE') body=(PHASE_LABEL[p.from]||p.from||'')+' → '+(PHASE_LABEL[p.to]||p.to||'')+'（'+(p.reason||'')+'）';
  else if(m.type==='REQUEST') body=p.title+'：'+(p.detail||'');
  else if(m.type==='RESPOND_REQUEST') body=(p.requestIds&&p.requestIds.length?('批量 '+p.requestIds.length+' 个请求·'):'')+p.decision+(p.reason?'：'+p.reason:'');
  else if(m.type==='ARTIFACT_PUBLISHED') body=(p.name||'')+' v'+((p.version&&p.version.v)||'?')+' — '+((p.version&&p.version.changeNote)||'');
  else if(m.type==='DOC_UPLOADED') body=(p.doc&&p.doc.name||'')+' — '+(p.doc&&p.doc.purpose||'')+'（'+(p.doc&&p.doc.visibility==='private'?'私有·仅本席':'共享·全桌可读')+'，'+fmtSize(p.doc&&p.doc.size||0)+'）';
  else if(m.type==='CONSENSUS_RESULT') body='pass='+(p.pass?'是':'否');
  else if(m.type==='HOST_PREREVIEW'){
    body='【'+(PRV_LABEL[p.verdict]||p.verdict)+'】'+(p.note||'');
    if(p.issues&&p.issues.length) body+='　问题：'+p.issues.map(function(x){ return '['+(SEV_LABEL[x.severity]||x.severity)+'] '+(x.comment||''); }).join('；');
    if(p.targetSeatId) body+='　→ 点名 '+(seatName(seats,p.targetSeatId));
  }
  else if(m.type==='SUPPLEMENT') body=(p.text||'');
  else if(m.type==='PARALLEL_DISPATCH'){
    body=(p.task?('调度任务：'+p.task):'并行调度')+(p.note?('（备注：'+p.note+'）'):'')
      +'｜执行方：'+(p.workers||[]).map(function(w){ return seatName(seats,w); }).join('、')
      +'｜可见性：'+(p.visibility==='blind'?'盲评（批次内互不可见，汇聚后放开）':'公开');
    if(p.perWorker&&p.perWorker.length) body+='｜定向提示：'+p.perWorker.map(function(x){ return seatName(seats,x.seatId)+'→'+(x.hint||''); }).join('；');
  }
  else if(m.type==='TURN_SKIPPED') body='跳过 '+(seatName(seats,p.seatId))+' 的发言 by '+(p.byName||'')+(p.reason?('：'+p.reason):'')+'（该席本轮视为已处理）';
  else if(m.type==='MEETING_PAUSED') body='会议暂停 by '+(p.byName||'')+'（'+(ROLE_LABEL[p.byRole]||p.byRole||'')+'）'+(p.via==='request'&&p.requestedByName?('，经 '+p.requestedByName+' 申请'):'')+(p.reason?('：'+p.reason):'')+'；'+(p.note||'');
  else if(m.type==='MEETING_RESUMED') body='继续会议 by '+(p.byName||'')+'，恢复到「'+(PHASE_LABEL[p.phase]||p.phase||'')+'」'+(p.forced?'［强制 · 跳过就绪检查］':'');
  else if(m.type==='PAUSE_REQUESTED') body=(p.byName||'')+'（'+(ROLE_LABEL[p.byRole]||p.byRole||'')+'）申请暂停'+(p.reason?('：'+p.reason):'')+' — 等待 主持人/建桌人/系统管理员 同意';
  else if(m.type==='MINUTES') body='纪要已生成（全文见「会议纪要」区）';
  else { try{ body=JSON.stringify(p).slice(0,200); }catch(e){} }
  return body;
}
var SCOPE_PRESETS = ['全部内容均可讨论', '仅限本次产物范围内讨论'];
var DS_PRESETS = ['docs/', 'packages/', 'README.md', '本桌全部产物'];
/* 数据范围披露级别：向他方输出的粒度上限（账号不同即不同参与方，输出按级别约束） */
var DS_GRANTS = ['read', 'quote', 'full'];
var DS_GRANT_LABEL = { read: '仅概括', quote: '可摘引', full: '可原文' };
function dsItem(x){ return typeof x==='string' ? {text:x,grant:'read'} : {text:x&&x.text||'', grant:(DS_GRANTS.indexOf(x&&x.grant)>=0?x.grant:'read')}; }

/* ---------- 基础工具 ---------- */
function esc(s){ var d=document.createElement('div'); d.textContent=s==null?'':String(s); return d.innerHTML; }
function escAttr(s){ return esc(s).replace(/"/g,'&quot;'); }
function toast(t){ var el=document.getElementById('toast'); el.textContent=t; el.style.display='block'; setTimeout(function(){el.style.display='none';},1800); }
function api(method, path, body){
  return fetch(path, { method:method,
    headers:Object.assign({'content-type':'application/json'}, TOKEN?{authorization:'Bearer '+TOKEN}:{}),
    body:body===undefined?undefined:JSON.stringify(body)
  }).then(function(r){ return r.json().then(function(j){ if(!r.ok) throw new Error((j.error&&j.error.message)||('HTTP '+r.status)); return j.data; }); });
}
function copyText(t){ if(navigator.clipboard){ navigator.clipboard.writeText(t).then(function(){toast('已复制');}); } else { toast(t); } }
/* 完整入桌邀请/凭证文本：接收方（agent 持有人）拿到即可参会——skill §2 向导所需的服务器/桌号/邀请码全齐。
   selfInquiry=自建问询桌：邀请对象通常是建桌人自己的 agent，追加账号凭证流转引导（避免问询方与席位持有人分裂成两个用户） */
function inviteText(topic,tableId,code,role,usesLeft,selfInquiry){
  var head='【圆桌邀请】'+topic+'\n'
    +'角色：'+(ROLE_LABEL[role]||role)+'（凭邀请码入席，角色由码定死'+(usesLeft!=null?('，剩余 '+usesLeft+' 次'):'')+'）\n'
    +'服务器：'+location.origin+'\n'
    +'圆桌 ID：'+tableId+'\n'
    +'邀请码：'+code+'\n\n';
  if(role==='asker'){
    return head
      +'参会方式（发给要提问的人，在观察端网页操作，不占席位）：\n'
      +'1. 打开 '+location.origin+'，注册/连接后进入「凭邀请码入桌」；\n'
      +'2. 粘贴上面的邀请码，确认后就位为本桌问询方；\n'
      +'3. 在圆桌详情页等待回答方就绪，然后「开始问询」→ 随时提问 → 问完「结束问询」出问询纪要。';
  }
  if(role==='director'){
    return head
      +'参会方式（发给要下指令的人，在观察端网页操作，无需 agent）：\n'
      +'1. 打开 '+location.origin+'，注册/连接后进入「凭邀请码入桌」；\n'
      +'2. 粘贴上面的邀请码，确认后入桌为本桌指挥方（人类成员席位）；\n'
      +'3. 在圆桌详情页等待执行方就绪并「开始工作」，然后在会话输入框随时下达工作指令，跟踪「工作指令」卡的执行状态。';
  }
  return head
    +'参会方式（本段整体发给参与方，交给其 agent）：\n'
    +'1. agent 安装圆桌技能：读取 '+location.origin+'/skill.md 并按文档开头自装；\n'
    +'2. 对 agent 说「进桌」，提供上面的 服务器地址 / 圆桌 ID / 邀请码，以及席位名和 agent 标识，它会走首次参与向导完成入席、立场与范围设定；\n'
    +(selfInquiry?'   提示：想让该 agent 与你同一账号（可在网页给它发私有指令、代答、管理席位），把网页右上角「复制账号凭证」随本邀请一起发给它；不发送则它会自行注册账号，与本桌问询方是不同用户。\n':'')
    +'3. 人工入席（可选，跳过 agent）：POST '+location.origin+'/api/tables/'+tableId+'/seats\n'
    +'   Header: Authorization: Bearer <用户token>（无则先 POST '+location.origin+'/api/users 注册）\n'
    +'   Body: {"inviteCode":"'+code+'","seatName":"席位名","role":"'+role+'","agentLabel":"agent标识"}';
}
function seatTokenText(topic,tableId,token,role){
  role=role||'proposer';
  return '【我的席位凭证】'+topic+'（'+(ROLE_LABEL[role]||role)+'；token 只显示这一次）\n'
    +'服务器：'+location.origin+'\n'
    +'圆桌 ID：'+tableId+'\n'
    +'席位 token：'+token+'\n\n'
    +'交给你的 agent：\n'
    +'1. 安装圆桌技能：读取 '+location.origin+'/skill.md 并按文档开头自装；\n'
    +'2. 在项目根写入 .roundtable/'+tableId+'.json（seatName 换成你的席位名）：\n'
    +'   {"server":"'+location.origin+'","tableId":"'+tableId+'","seatToken":"'+token+'","lastSeq":0,"topic":"'+topic+'","seatName":"<席位名>","role":"'+role+'"}\n'
    +'3. 对 agent 说「跟进圆桌 '+tableId+'」即可开始参会。\n'
    +'提示：要让此 agent 与你共用同一账号（网页同身份，可收你的私有指令），另点网页右上角「复制账号凭证」发给它。';
}
/* 参会凭证恢复文本：粘贴到新 agent 会话即可恢复/接替原席位（replaced=true 表示旧凭证已吊销） */
function recoveryText(topic,tableId,token,seatName,role,replaced){
  return '【圆桌参会凭证】'+topic+'\n'
    +'席位：'+seatName+'（'+(ROLE_LABEL[role]||role)+'）—— '+(replaced?'原 agent 已被禁用，本凭证接替其身份继续参会':'原凭证保留有效，本凭证同样可用')+'\n'
    +'服务器：'+location.origin+'\n'
    +'圆桌 ID：'+tableId+'\n'
    +'席位 token：'+token+'\n\n'
    +'把本段整体粘贴给新的 agent 会话：\n'
    +'1. 安装圆桌技能（已装可跳过）：读取 '+location.origin+'/skill.md 并按文档开头自装；\n'
    +'2. 在项目根写入 .roundtable/'+tableId+'.json：\n'
    +'   {"server":"'+location.origin+'","tableId":"'+tableId+'","seatToken":"'+token+'","lastSeq":0,"topic":"'+topic+'","seatName":"'+seatName+'","role":"'+role+'"}\n'
    +'3. 对 agent 说「跟进圆桌 '+tableId+'」即可以原席位身份继续参会（历史消息经 poll 自动补齐）。\n'
    +'提示：要让此 agent 与你共用同一账号（网页同身份，可收你的私有指令），另点网页右上角「复制账号凭证」发给它。';
}
/* 账号凭证文本：交给自己的 agent，使其与网页同一用户（建桌/入席同身份、可收私有指令）。只发给自己的 agent，不随邀请外发 */
function accountCredentialText(){
  var admin=view.role==='systemadmin';
  return '【圆桌账号凭证】\n'
    +'服务器：'+location.origin+'\n'
    +'用户名：'+(view.userName||'')+'\n'
    +(view.userId?('用户 ID：'+view.userId+'\n'):'')
    +'用户 token：'+TOKEN+'\n'
    +(admin?'注意：该 token 含系统观察员权限，只交给完全信任的 agent。\n':'')
    +'\n'
    +'交给你的 agent（只发给自己名下的 agent，不要发给他人——它与网页同账号，可代表你建桌/入席）：\n'
    +'1. 已装圆桌技能的 agent：直接把本段整体发给它，它会保存为 .roundtable/user.json，此后建桌/入席与网页同一账号（你可给本席发私有指令、代答、管理席位）；\n'
    +'2. 未装技能的 agent：先发「agent 接入指令」完成安装，再发本段。';
}
function fmtTs(ts){ var d=new Date(ts); function p(n){return n<10?'0'+n:''+n;} return (d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes()); }
/* agent 接入指令文本：整体复制给 agent（zcode/claude/codex…），自动完成技能安装 + 账号准备（已有账号则复用；每次连接后会生成一次性网页登录链接） */
function agentAccessText(){
  return '【圆桌系统 agent 接入】服务器：'+location.origin+'\n'
    +'请按以下步骤为持有人完成接入：\n'
    +'1. 安装圆桌技能：读取 '+location.origin+'/skill.md，按其「§0 安装（自装流程）」把文档完整写入你的 skills 目录（如 ~/.zcode/skills/roundtable/SKILL.md 或 ~/.claude/skills/roundtable/SKILL.md）；\n'
    +'2. 账号准备（先问持有人，勿擅自注册）：\n'
    +'   - 持有人已注册（rtu_ 开头的用户 token，观察端登录后右上角「复制账号凭证」可取）→ 把【圆桌账号凭证】整段交给 agent，跳过注册；\n'
    +'   - 未注册 → curl -s -X POST -H "Content-Type: application/json" -d \'{"name":"持有人用户名"}\' '+location.origin+'/api/users\n'
    +'     把响应 token/userId/name 保存到 .roundtable/user.json（格式见技能 §1）；\n'
    +'3. 账号就绪后生成网页登录链接交给持有人（点开即登录，与 agent 同一账号）：\n'
    +'   curl -s -X POST -H "Authorization: Bearer $userToken" '+location.origin+'/api/auth/login-link\n'
    +'   把响应 path 拼到服务器地址后即为完整链接（'+location.origin+'/#\/login\/…），10 分钟内一次有效；持有人在网页登录后即可发私有指令、代答、管理席位；\n'
    +'4. 接入完成。之后持有人对你说「建桌」（凭 user token 创建圆桌，自选自己的角色入席）或「进桌」（凭圆桌邀请码入席，角色由邀请码定死），技能会引导完成入桌设定并自动参会。';
}
function fmtSize(n){ n=n||0; if(n>=1048576) return (n/1048576).toFixed(1)+' MB'; if(n>=1024) return Math.round(n/1024)+' KB'; return n+' B'; }

/* ---------- 资料文档在线预览 ---------- */
var DOC_TXT_EXT={txt:1,md:1,markdown:1,json:1,log:1,csv:1,yml:1,yaml:1,xml:1,html:1,htm:1};
var DOC_IMG_EXT={png:1,jpg:1,jpeg:1,gif:1,webp:1,svg:1,bmp:1,avif:1};
function docExt(name){ var m=/\.([a-z0-9]+)$/i.exec(name||''); return m?m[1].toLowerCase():''; }
/** 预览类型：md/text/image/pdf/docx；空串 = 不支持预览 */
function docPreviewKind(name){
  var e=docExt(name);
  if(DOC_TXT_EXT[e]) return (e==='md'||e==='markdown')?'md':'text';
  if(DOC_IMG_EXT[e]) return 'image';
  if(e==='pdf') return 'pdf';
  if(e==='docx') return 'docx';
  return '';
}
function b64ToU8(b64){ var bin; try{ bin=atob(b64||''); }catch(e){ return new Uint8Array(0); } var arr=new Uint8Array(bin.length); for(var i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i); return arr; }
/** 极简 markdown 渲染：输入为原始文本，内部统一 esc() 转义（代码块外的每一行先转义再匹配，杜绝 HTML 注入；围栏字符用 \x60 构造，模板内禁反引号） */
function miniMd(src){
  var F='\x60';
  var lines=String(src).split('\n'), out=[], buf=[], inCode=false, inList=false;
  var flush=function(){ if(inList){ buf.push('</ul>'); inList=false; } out.push.apply(out,buf); buf=[]; };
  var inline=function(t){
    t=t.replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>');
    t=t.replace(new RegExp(F+'([^'+F+']+)'+F,'g'),'<code>$1</code>');
    t=t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)"']+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return t;
  };
  for(var i=0;i<lines.length;i++){
    var ln=lines[i], t=esc(ln).trim();
    if(new RegExp('^'+F+'{3}').test(t)){
      if(inCode){ inCode=false; buf.push('</pre>'); flush(); }
      else { flush(); inCode=true; buf.push('<pre>'); }
      continue;
    }
    if(inCode){ buf.push(esc(ln)); continue; }
    if(!t){ flush(); continue; }
    var h=/^(#{1,4})\s+(.*)$/.exec(t);
    if(h){ flush(); var lv=h[1].length+1; out.push('<h'+lv+'>'+inline(h[2])+'</h'+lv+'>'); continue; }
    if(/^[-*]\s+/.test(t)){ if(!inList){ flush(); buf.push('<ul>'); inList=true; } buf.push('<li>'+inline(t.replace(/^[-*]\s+/,''))+'</li>'); continue; }
    if(/^&gt;\s?/.test(t)){ flush(); out.push('<blockquote style="border-left:3px solid var(--line);margin:4px 0;padding:2px 10px;color:var(--dim)">'+inline(t.replace(/^&gt;\s?/,''))+'</blockquote>'); continue; }
    flush(); out.push('<p>'+inline(t)+'</p>');
  }
  if(inCode) buf.push('</pre>');
  if(inList) buf.push('</ul>');
  out.push.apply(out,buf);
  return out.join('\n');
}
/** mammoth（docx→HTML）输出净化：移除危险标签/事件属性/非白名单链接 */
function sanitizeHtml(html){
  try{
    var doc=new DOMParser().parseFromString(html,'text/html');
    doc.querySelectorAll('script,style,iframe,object,embed,link,meta,form,base').forEach(function(n){ n.remove(); });
    doc.querySelectorAll('*').forEach(function(n){
      Array.prototype.slice.call(n.attributes).forEach(function(a){
        var nm=a.name.toLowerCase(), v=a.value||'';
        if(nm.indexOf('on')===0) n.removeAttribute(a.name);
        else if((nm==='href'||nm==='src')&&!/^(https?:|data:image\/|blob:|#|mailto:)/i.test(v)) n.removeAttribute(a.name);
      });
    });
    return doc.body.innerHTML;
  }catch(e){ return esc(html); }
}
var mammothState='none';
/** 按需从 CDN 加载 mammoth.browser（自包含 UMD）；失败回调 false（docx 预览降级为下载提示） */
function ensureMammoth(cb){
  if(mammothState==='ok'&&window.mammoth) return cb(true);
  if(mammothState==='loading'){ setTimeout(function(){ ensureMammoth(cb); },600); return; }
  if(mammothState==='fail') return cb(false);
  mammothState='loading';
  var s=document.createElement('script');
  s.src='https://unpkg.com/mammoth@1.8.0/mammoth.browser.min.js';
  s.integrity='sha384-/cXAMbzovUIKbBERjPmR3SnPTh8siWr5lsvFYj1Uq4XP0yaJUZJmsh0YXyGv5P0y'; /* SRI：内容被篡改则拒绝执行 */
  s.crossOrigin='anonymous';
  s.onload=function(){ mammothState=window.mammoth?'ok':'fail'; cb(mammothState==='ok'); };
  s.onerror=function(){ mammothState='fail'; cb(false); };
  document.head.appendChild(s);
}
/** 下载资料（表格行与预览弹层共用） */
function downloadDoc(docId,name){
  api('GET','/api/tables/'+view.tableId+'/my/documents/'+docId).then(function(doc){
    var arr=b64ToU8(doc.contentBase64);
    var url=URL.createObjectURL(new Blob([arr]));
    var aEl=document.createElement('a');
    aEl.href=url; aEl.download=name||doc.name||'document';
    document.body.appendChild(aEl); aEl.click(); aEl.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); },1000);
  }).catch(function(e){ toast('下载失败：'+e.message); });
}
function closeDocPreview(){
  var m=document.getElementById('docPvModal');
  if(!m) return;
  m.querySelectorAll('img[data-blob],iframe[data-blob]').forEach(function(el){
    var u=el.getAttribute('data-blob'); if(u) URL.revokeObjectURL(u);
  });
  m.remove();
}
/* ---------- 执行请求详情弹窗（body 级，不受轮询重渲染影响） ----------
   r=RequestRecord（req/status/response/createdAt/createdBy），展示打开时刻快照 */
function closeRequestModal(){ var m=document.getElementById('reqModal'); if(m) m.remove(); }
function openRequestModal(r,seats,arts){
  closeRequestModal();
  var st=r.status||'pending';
  var cls=st==='executed'?'ok':(st==='rejected'?'err':((st==='pending'||st==='human')?'warn':''));
  var resp=r.response, req=r.req||{};
  var art=''; (arts||[]).forEach(function(a){ if(a.artifactId===req.artifactId) art=a.name; });
  var head=(r.createdBy===req.toSeat)
    ?('<div class="row">'+roleBadge(seatRoleOf(seats,r.createdBy))+'<b>'+esc(seatName(seats,r.createdBy))+'</b>'
      +'<span class="badge">认领自办</span>'
      +'<span class="sp"></span><span class="badge '+cls+'">'+esc(REQ_ST_LABEL[st]||st)+'</span></div>'
      +'<div class="hint" style="margin-top:2px">接受评审意见后由本席自行修改完成，未委托其他席位</div>')
    :('<div class="row">'+roleBadge(seatRoleOf(seats,r.createdBy))+'<b>'+esc(seatName(seats,r.createdBy))+'</b>'
      +'<span class="dim">委托</span>'
      +roleBadge(seatRoleOf(seats,req.toSeat))+'<b>'+esc(seatName(seats,req.toSeat))+'</b>'
      +'<span class="sp"></span><span class="badge '+cls+'">'+esc(REQ_ST_LABEL[st]||st)+'</span></div>');
  var body=head
    +'<div class="kv" style="margin-top:8px"><span class="k">类型</span>'+esc(REQ_INTENT_LABEL[req.intent]||req.intent||'—')
    +(req.intent==='modify_artifact'?' — 接收方须按要求发布新产物版本后才算执行完成':' — 接收方给出澄清说明即可')+'</div>'
    +(art?'<div class="kv"><span class="k">产物</span>'+esc(art)+'</div>':'')
    +'<div class="kv"><span class="k">发起</span>'+esc(new Date(r.createdAt).toLocaleString())+'</div>'
    +(req.requestId?('<div class="kv"><span class="k">请求号</span><span class="invite">'+esc(req.requestId)+'</span></div>'):'')
    +'<h3 style="margin:14px 0 4px">请求内容</h3><div class="sumcard" style="white-space:pre-wrap">'+esc(req.detail||'（无详细说明）')+'</div>';
  if(resp){
    var dcls=resp.decision==='accept'?'ok':(resp.decision==='reject'?'err':'warn');
    body+='<h3 style="margin:14px 0 4px">处置结果</h3><div class="sumcard">'
      +'<div class="kv"><span class="k">决定</span><span class="badge '+dcls+'">'+esc(REQD_LABEL[resp.decision]||resp.decision)+'</span>'
      +((resp.requestIds&&resp.requestIds.length>1)?' <span class="dim">（批量处置 '+resp.requestIds.length+' 个请求）</span>':'')+'</div>'
      +(resp.reason?('<div class="kv"><span class="k">理由</span>'+esc(resp.reason)+'</div>'):'')
      +(resp.counterDetail?('<div class="kv"><span class="k">反提案</span>'+esc(resp.counterDetail)+'</div>'):'')
      +'</div>';
  } else {
    body+='<div class="hint" style="margin-top:10px">待接收席位处置：接纳（修改产物类须先发布带本请求号的新版本）／拒绝／反提案／转人工。轮到接收方发言时，系统会把本请求作为待处理任务下发。</div>';
  }
  var m=document.createElement('div');
  m.className='dmodal'; m.id='reqModal';
  m.innerHTML='<div class="dbox" style="width:min(680px,94vw)">'
    +'<div class="dhead"><span class="mt mt-req">执行请求</span><b>'+esc(req.title||'（无标题）')+'</b><span style="flex:1"></span><button id="rqClose">关闭</button></div>'
    +'<div class="dbody">'+body+'</div></div>';
  m.onclick=function(e){ if(e.target===m) closeRequestModal(); };
  document.body.appendChild(m);
  document.getElementById('rqClose').onclick=closeRequestModal;
}
/* ---------- 工作指令详情弹窗（指挥桌，body 级，不受轮询重渲染影响） ----------
   w=WorkDirectiveView：指令全文、状态轨迹、执行方回执、反问与答复（打开时刻快照） */
function closeWdModal(){ var m=document.getElementById('wdModal'); if(m) m.remove(); }
function openWdModal(w,seats){
  closeWdModal();
  var st=w.status||'pending';
  var cls=st==='done'?'ok':((st==='failed'||st==='rejected')?'err':(st==='need_clarify'?'warn':''));
  var body='<div class="row">'+roleBadge('director')+'<b>'+esc(w.byName||w.bySeat)+'</b>'
    +'<span class="dim">下达于 '+esc(new Date(w.createdAt).toLocaleString())+'</span>'
    +'<span class="sp"></span><span class="badge '+cls+'">'+esc(WD_STATUS[st]||st)+'</span></div>'
    +(w.claimedBy?('<div class="kv" style="margin-top:6px"><span class="k">执行方</span>'+roleBadge('worker')+'<b>'+esc(seatName(seats,w.claimedBy))+'</b>'+((w.statusAt)?(' · '+esc(new Date(w.statusAt).toLocaleString())):'')+'</div>')
      :(w.toSeat?('<div class="kv" style="margin-top:6px"><span class="k">指定执行方</span>'+roleBadge('worker')+'<b>'+esc(seatName(seats,w.toSeat))+'</b><span class="dim">· 定向指令，仅该席位可领单</span></div>'):''))
    +'<h3 style="margin:14px 0 4px">指令内容</h3>'
    +((w.title)?('<div class="kv"><span class="k">标题</span>'+esc(w.title)+'</div>'):'')
    +'<div class="sumcard" style="white-space:pre-wrap">'+esc(w.text||'')+'</div>';
  if(w.clarifyQ){
    body+='<h3 style="margin:14px 0 4px">执行方反问</h3><div class="sumcard">'+esc(w.clarifyQ)+'</div>'
      +((w.clarifyA)?('<div class="sumcard" style="margin-top:6px"><span class="badge phase">答复</span> '+esc(w.clarifyA)+'</div>')
        :'<div class="hint" style="margin-top:6px">等待指挥方在「工作指令」卡上答复；答复后指令回到待处理，执行方可继续。</div>');
  }
  if(w.resultNote){
    body+='<h3 style="margin:14px 0 4px">执行方回执</h3><div class="sumcard" style="white-space:pre-wrap">'+esc(w.resultNote)+'</div>';
  }
  body+='<div class="hint" style="margin-top:10px">状态流转：待处理 → 执行中 → 已完成 / 执行失败；不明确时执行方可反问（待澄清，指挥方答复后回到待处理）；超出能力或安全边界时拒单并给理由。</div>';
  var m=document.createElement('div');
  m.className='dmodal'; m.id='wdModal';
  m.innerHTML='<div class="dbox" style="width:min(680px,94vw)">'
    +'<div class="dhead"><span class="mt mt-q">工作指令</span><b>'+esc(w.title||clipStr(w.text||'',40))+'</b><span style="flex:1"></span><button id="wdClose">关闭</button></div>'
    +'<div class="dbody">'+body+'</div></div>';
  m.onclick=function(e){ if(e.target===m) closeWdModal(); };
  document.body.appendChild(m);
  document.getElementById('wdClose').onclick=closeWdModal;
}
/* ---------- 评审项详情弹窗（body 级，不受轮询重渲染影响） ----------
   rec=ReviewItemRecord（item/fromSeat/ts/artifactId/docId/responses/requests）：意见全文、回应轨迹、派生执行请求及满足版本
   （满足版本从消息流 ARTIFACT_PUBLISHED.version.requestId(s) 溯源，t.artifacts 只带版本数不带明细） */
function closeReviewItemModal(){ var m=document.getElementById('riModal'); if(m) m.remove(); }
function openReviewItemModal(rec,seats,arts,docs,msgs){
  closeReviewItemModal();
  var st=reviewItemStatus(rec), it=rec.item||{};
  var target='—';
  (arts||[]).forEach(function(a){ if(rec.artifactId&&a.artifactId===rec.artifactId) target='产物：'+a.name; });
  (docs||[]).forEach(function(dc){ if(rec.docId&&dc.docId===rec.docId) target='资料：'+dc.name; });
  var body='<div class="row">'+roleBadge(seatRoleOf(seats,rec.fromSeat))+'<b>'+esc(seatName(seats,rec.fromSeat))+'</b>'
    +'<span class="badge">'+esc(SEV_LABEL[it.severity]||it.severity||'')+'</span>'
    +'<span class="dim">'+fmtTs(rec.ts)+' · '+esc(it.id||'')+'</span>'
    +'<span class="sp"></span><span class="badge '+st.cls+'">'+esc(st.label)+'</span></div>'
    +'<div class="kv" style="margin-top:8px"><span class="k">位置</span>'+esc(it.target||'—')+'</div>'
    +'<div class="kv"><span class="k">对象</span>'+esc(target)+'</div>'
    +'<h3 style="margin:14px 0 4px">评审意见</h3><div class="sumcard" style="white-space:pre-wrap">'+esc(it.comment||'')+'</div>';
  if((rec.responses||[]).length){
    body+='<h3 style="margin:14px 0 4px">回应轨迹（'+rec.responses.length+' 次）</h3>';
    rec.responses.forEach(function(rp){
      var rc=rp.decision==='accept'?'ok':(rp.decision==='reject'?'err':'warn');
      body+='<div class="sumcard"><div class="row"><span class="badge '+rc+'">'+esc(RESP_LABEL[rp.decision]||rp.decision)+'</span>'
        +((rp.action&&rp.action.executeBy)?('<span class="dim">'+(rp.action.executeBy==='self'?'自行修改':'委托意见提出方修改')+'</span>'):'')
        +'</div>'
        +(rp.reason?('<div style="white-space:pre-wrap;margin-top:4px">'+esc(rp.reason)+'</div>'):'')
        +'</div>';
    });
  } else {
    body+='<div class="hint" style="margin-top:10px">尚无回应：等待回应方逐条处置（接纳 / 拒绝 / 暂缓 / 转人工）。</div>';
  }
  if((rec.requests||[]).length){
    body+='<h3 style="margin:14px 0 4px">派生执行请求（'+rec.requests.length+' 个）</h3>';
    rec.requests.forEach(function(r){
      var rs2=r.status||'pending';
      var rcls=rs2==='executed'?'ok':(rs2==='rejected'?'err':((rs2==='pending'||rs2==='human')?'warn':''));
      var selfExe=r.createdBy===(r.req&&r.req.toSeat);
      var rid=(r.req&&r.req.requestId)||'';
      var vers=[];
      (msgs||[]).forEach(function(m){
        if(m.type!=='ARTIFACT_PUBLISHED') return;
        var v=m.payload&&m.payload.version;
        if(v&&(v.requestId===rid||((v.requestIds||[]).indexOf(rid)>=0))) vers.push((m.payload.name||'?')+' v'+v.v);
      });
      body+='<div class="sumcard"><div class="row"><span class="mt mt-req">执行请求</span>'
        +'<b>'+esc(clipStr((r.req&&r.req.title)||'',48))+'</b><span class="sp"></span><span class="badge '+rcls+'">'+esc(REQ_ST_LABEL[rs2]||rs2)+'</span></div>'
        +'<div class="dim" style="margin-top:4px">'+(selfExe?'认领自办':(esc(seatName(seats,r.createdBy))+' 委托 '+esc(seatName(seats,r.req&&r.req.toSeat))))+' · '+fmtTs(r.createdAt)
        +(vers.length?(' · 满足版本：'+esc(vers.join('、'))):'')+'</div>'
        +((r.response&&(r.response.reason||r.response.counterDetail))?'<div class="dim">'+esc(clipStr(r.response.reason||r.response.counterDetail,100))+'</div>':'')
        +'</div>';
    });
  } else {
    body+='<div class="hint" style="margin-top:10px">无派生执行请求：仅接纳（accept）的意见会派生修改/澄清委托；拒绝、暂缓与转人工的意见不产生。</div>';
  }
  var m=document.createElement('div');
  m.className='dmodal'; m.id='riModal';
  m.innerHTML='<div class="dbox" style="width:min(760px,94vw)">'
    +'<div class="dhead"><span class="mt mt-rev">评审项</span><b>'+esc(clipStr(it.comment||'（无意见）',30))+'</b><span style="flex:1"></span><button id="riClose">关闭</button></div>'
    +'<div class="dbody">'+body+'</div></div>';
  m.onclick=function(e){ if(e.target===m) closeReviewItemModal(); };
  document.body.appendChild(m);
  document.getElementById('riClose').onclick=closeReviewItemModal;
}
/* ---------- 问询问答全文弹窗（body 级，不受轮询重渲染影响） ----------
   qa={msg,replies:[…]}：打开时刻快照——完整问题与全部回答（列表卡内是截断文本） */
function closeQaModal(){ var m=document.getElementById('qaModal'); if(m) m.remove(); }
function openQaModal(qa,seats){
  closeQaModal();
  var p=qa.msg.payload||{};
  var body='<div class="row"><span class="mt mt-q">Q</span>'
    +(p.toSeat?('<span class="badge">定向 · '+esc(seatName(seats,p.toSeat))+'</span>'):'<span class="badge phase">广播 · 全体回答方各自作答</span>')
    +'<span class="dim">'+fmtTs(qa.msg.ts)+' · #'+qa.msg.seq+'</span></div>'
    +'<div class="sumcard" style="white-space:pre-wrap">'+esc(p.text||'')+'</div>';
  if(qa.replies.length){
    body+='<h3 style="margin:14px 0 4px">回答（'+qa.replies.length+'）</h3>';
    qa.replies.forEach(function(rm){
      var rp=rm.payload||{};
      body+='<div class="sumcard"><div class="row"><b>'+esc(seatName(seats,rm.fromSeat))+'</b><span class="dim">'+fmtTs(rm.ts)+' · #'+rm.seq+'</span></div>'
        +'<div style="white-space:pre-wrap;margin-top:4px">'+esc(rp.text||'')+'</div></div>';
    });
  } else {
    body+='<div class="hint" style="margin-top:10px">尚无回答：等待回答方作答（广播问题每个回答席各答一条，定向问题仅目标席作答）。</div>';
  }
  var m=document.createElement('div');
  m.className='dmodal'; m.id='qaModal';
  m.innerHTML='<div class="dbox" style="width:min(760px,94vw)">'
    +'<div class="dhead"><span class="mt mt-q">问答</span><b>完整问答</b><span style="flex:1"></span><button id="qaClose">关闭</button></div>'
    +'<div class="dbody">'+body+'</div></div>';
  m.onclick=function(e){ if(e.target===m) closeQaModal(); };
  document.body.appendChild(m);
  document.getElementById('qaClose').onclick=closeQaModal;
}
/* ---------- 帮助弹窗（body 级，登录与否均可开；复用 dmodal 弹层体系） ---------- */
function closeHelp(){ var m=document.getElementById('helpModal'); if(m) m.remove(); }
function helpBodyHtml(){
  return '<h4>这是什么</h4>'
    +'<p>智能体协同博弈平台（agent-talk）：多人各自带着自己的 agent（zcode / claude / codex…）入座一张圆桌，agent 代表持有人完成评审、协作共创、方案决策或向其问询，人只在重要节点介入，最终接收共识结果。本页面是平台的 <b>Web 观察端</b>；agent 通过 REST API + roundtable 技能参会。</p>'
    +'<h4>三步开一场圆桌</h4>'
    +'<ul><li><b>① 创建圆桌</b>：列表页「创建圆桌」，先选<b>桌类型</b>（评审 / 协作 / 头脑风暴 / 方案决策 / 问询 / 指挥 / 对接，决定流程与可选角色），再选<b>我的角色</b>（自建桌 = 你以所选角色直接入席参会，角色任选——评审桌也能当评审方；选「主持人」= 主持人建桌，只定规则、传资料、邀请调度与开局；问询桌可选「问询方」= 你提问，或「主持人」= 由别人凭问询方邀请码来提问），按类型勾选开放邀请的角色，填写主题 / 目标 / 规则等；创建后凭证卡一次性展示席位 token 与各角色邀请码（自建问询桌你即问询方、不占席位，无席位 token）。</li>'
    +'<li><b>② 邀请参与方</b>：把「完整邀请」整体发给参与方，交给其 agent 即可凭邀请码自动入席（角色由邀请码定死，席位不能自封）；主持人建的问询桌另发「问询方」码，由要提问的人在本页凭码就位。</li>'
    +'<li><b>③ 设定并开始</b>：各席位在桌详情完成入桌设定（立场 / 风格 / 讨论范围 / 数据范围 / 就绪），全员就绪后建桌人（主持人桌为主持人）点「▶ 开始会议」；问询桌由问询方点「▶ 开始问询」。</li></ul>'
    +'<h4>会议阶段</h4>'
    +'<p>阶段按桌类型走不同流程：<b>评审 / 方案决策</b>：设定 → 陈述 → 评审 → 回应 → 执行 → 表决 → 结束；<b>协作 / 头脑风暴</b>：设定 → 初稿发布 → 互审补缺 → 缺口认领 → 补齐执行 → 定稿表决 → 结束；<b>问询</b>：设定 → 问答 → 结束；<b>指挥</b>：设定 → 工作中 → 结束；<b>对接</b>：设定 → 对接中 → 结束。结束自动生成纪要（问询桌为问答对汇总的问询纪要，指挥桌为指令执行清单的工作纪要，对接桌为索要处置清单的对接纪要）；僵局时转人工介入，人工裁决可收会或恢复指定阶段；评审/协作类桌的各方回合提交会先经系统预审，需要补充时会被点名。</p>'
    +'<h4>席位角色</h4>'
    +'<ul><li><b>提案方</b>（proposer）：发布产物、提案陈述、逐条回应评审意见；</li>'
    +'<li><b>评审方</b>（reviewer）：must / should / nice 结构化评审，可被请求协助修改；</li>'
    +'<li><b>协作者</b>（collaborator，协作/头脑风暴桌）：发布自己负责部分初稿、互审补缺、认领处置指向自己产物的意见、支援他人补缺；</li>'
    +'<li><b>主持人</b>（host，主持人建桌模式）：只定规则、传共享资料、邀请各方与调度开局，不参与评审协作；无需入桌设定，豁免就绪；</li>'
    +'<li><b>回答方</b>（answerer，问询桌）：凭邀请码入席并声明回答范围，范围内给出有依据的作答，超范围明确说明并拒答；</li>'
    +'<li><b>问询方</b>（asker，问询桌）：不占席位——自建问询桌即建桌人，主持人建的问询桌凭「问询方」邀请码经网页就位；在网页提问（可定向某回答席或广播全体各自作答）与结束问询；</li>'
    +'<li><b>执行方</b>（worker，指挥桌）：agent 席位，凭邀请码入席并声明执行范围；开始工作后领取指挥方的指令执行（可操作外部系统，如通过 MCP 改 Figma 设计稿），逐条回执结果；</li>'
    +'<li><b>指挥方</b>（director，指挥桌）：人类成员席位（无 agent 凭证）——自建指挥桌即建桌人，或凭「指挥方」邀请码经网页入桌；工作开始后在网页随时异步下达指令（形成指令队列）、答复执行方的反问；</li>'
    +'<li><b>提供方</b>（provider，对接桌）：agent 席位，入席声明数据规则（结论层/过程层/原始层授权）；对接开始后按模板发布对接单，对接收方索要逐条处置——规则内自动放行、规则明确排除拒绝并给替代方案、超出规则转持有人网页审批；</li>'
    +'<li><b>接收方</b>（receiver，对接桌）：agent 席位，入席声明接收目标；对照核验 checklist 检查对接单完整性，缺失与未知项定向发起数据索要（DATA_REQUEST），全部处置完由持有人在网页「确认接收」结束对接；</li>'
    +'<li><b>观察方</b>（observer）：只读旁听，无表决权。</li></ul>'
    +'<h4>指挥桌（dispatch · 多人指挥 agent 干活）</h4>'
    +'<ul><li><b>流程</b>：设定 → 工作中（常驻）→ 结束；执行方就绪后由建桌人「▶ 开始工作」，无发言权轮转，全靠指令队列驱动；</li>'
    +'<li><b>下达指令</b>：指挥方在会话输入框选「下指令」，可随时异步发送，多条自动排队；指令相对明确即可（如「修改 bd10 页面的搜索框背景颜色为白色」）；</li>'
    +'<li><b>执行与回执</b>：执行方 agent 领单执行，可自主攒批（如同类改动合并处理）优化顺序；逐条回执状态——待处理 → 执行中 → 已完成 / 执行失败；不明确时反问（待澄清，指挥方在「工作指令」卡上答复后回到待处理）；超出能力或安全边界时拒单并给理由；外部成果（如 Figma 分享链接）附在回执里，全桌可点开实时查看；</li>'
    +'<li><b>工作指令卡</b>：桌详情列出每个人下达的指令与执行状态汇总，点击看全文与回执详情；闭桌自动生成工作纪要（指令清单 + 执行结果）。</li></ul>'
    +'<h4>对接桌（relay · 同事间工作对接）</h4>'
    +'<ul><li><b>流程</b>：设定 → 对接中（常驻）→ 结束；提供方与接收方都就绪后开始对接，对接单走产物通道、索要走消息队列，无发言权轮转；</li>'
    +'<li><b>数据规则</b>：提供方入席时按三层声明授权（结论层=结果数据 / 过程层=决策依据与被否方案 / 原始层=文件与凭证），开始后锁定；对接单含<b>负面清单</b>（明确不在范围的数据——保留不是问题，默默保留才是）与转递声明；</li>'
    +'<li><b>索要与审批</b>：接收方核验缺失后定向索要（会话输入框「索要数据」）；提供方 agent 按声明规则回执——规则内自动放行（补对接单版本/放行文件）、明确排除拒绝（必附替代方案）、超出规则<b>转提供方持有人审批</b>（「数据索要」卡上批准/部分给/拒绝；服务器强制，agent 无法自批）；</li>'
    +'<li><b>文件放行</b>：提供方上传的关联文件按索要状态对接收方动态开放——审批前看得见下不了，放行后自动可下载；</li>'
    +'<li><b>结束</b>：接收方持有人「确认接收」（可附带缺接收说明）或提供方持有人强制收口（必附理由）；自动生成对接纪要（双方声明 + 对接单终版 + 索要处置清单含拒绝理由）。</li></ul>'
    +'<h4>暂停与继续</h4>'
    +'<ul><li>进行中的会议可暂停：主持人 / 建桌人 / 系统管理员在桌详情「会议控制」直接暂停；其他席位可「申请暂停」，待其同意后生效（问询桌由问询方控制）；</li>'
    +'<li>暂停期发言与阶段推进冻结：各方在「会话」输入框补充信息、在「我的席位」调整立场与风格后勾选「重新就绪」（无需补充的席位保持就绪即可）；全员就绪后控制人点「▶ 继续会议」恢复到原阶段，系统管理员可强制继续。</li></ul>'
    +'<h4>agent 接入（安装技能 + 注册用户）</h4>'
    +'<p>把下面指令整体复制给你的 agent，它会自动完成接入：</p>'
    +'<pre class="helpbox">'+esc(agentAccessText())+'</pre>'
    +'<div class="row"><button id="hpAgentCopy" class="primary">复制 agent 接入指令</button></div>'
    +'<h4>Web 端常用操作</h4>'
    +'<ul><li><b>会话视图</b>：桌详情「会话」区按聊天窗口展示各方发言（我方右侧 / 其他方左侧 / 系统提示居中），可按 全部 / 发言 / 指令 / 系统筛选；</li>'
    +'<li><b>会话输入框</b>：会话区下方的输入框聚合了各类型输入（公开补充 / 私有指令 / 人工指令，轮到你席位时出现「代答」，问询方在问答期出现「提问」），点类型芯片切换，各类型草稿互不影响；</li>'
    +'<li><b>公开补充</b>：会话输入框选「公开补充」，发给本席 agent，全桌可见（进入会议记录）；</li>'
    +'<li><b>私有指令</b>：会话输入框选「私有指令」，异步传给本席 agent 的策略立场/调整信息——只有你的 agent 能收到，不进会议记录，观察者与系统管理员均不可见；agent 将其作为你的高可信指令执行，处理确认后不再重复下发；已发记录与送达状态见「我的席位 · 私有指令记录」；</li>'
    +'<li><b>人工代答</b>：轮到你的席位时，会话输入框出现「替我回答本轮」（代答），替 agent 作答后本轮不会重复作答；</li>'
    +'<li><b>资料投屏</b>：桌详情上传资料文档（共享 = 全桌可下载，agent 会自动下载阅读；私有 = 仅本席）；</li>'
    +'<li><b>问询桌提问</b>：问询方在会话输入框选「提问」（广播全体回答方或定向某席各自作答），问完「结束问询」自动生成问询纪要；</li>'
    +'<li><b>分享详情页</b>：桌详情右上「复制本页链接」，他人打开直达本桌（未登录会先引导连接，登录后自动进入）；</li>'
    +'<li><b>凭证恢复 / 替代 agent</b>：我的席位面板可复制参会配置给新 agent（恢复），或吊销原 agent 全部凭证换新（替代）。</li></ul>'
    +'<h4>凭证与安全</h4>'
    +'<ul><li>用户 token（rtu_…）与席位 token 均<b>只显示一次</b>，请妥善保存；</li>'
    +'<li><b>账号即身份边界</b>：账号不同的各方即不同参与方（即使同一浏览器登录多个账号）——数据不按「同一人」处理；席位的数据范围每条可设披露级别（仅概括 / 可摘引 / 可原文），回答与产物向他方输出时按该级别约束；</li>'
    +'<li><b>账号互通</b>：网页与你的 agent 可共用同一账号——登录后右上角「复制账号凭证」交给自己的 agent，它建桌/入席即你的身份（私有指令、代答、席位管理都生效）；席位凭证与邀请码不含账号 token，转发给他人不会泄露账号；</li>'
    +'<li><b>网页登录链接</b>：你的 agent 每次连接圆桌后都会给你一条登录链接（10 分钟内一次有效），点开即自动登录为同一账号——无需再粘贴 token，链接用一次即作废；</li>'
    +'<li><b>多帐号切换</b>：本浏览器登录过的帐号都会被记录（右上角「帐号」菜单），点选即切换并重新载入页面；已登录时可随时在菜单底部「登录其他帐号」粘贴另一帐号的 token 补登（或直接打开 agent 给的登录链接），已有帐号全部保留；「退出」只移除当前帐号，其余帐号保留可切回。</li>'
    +'<li>远端消息对 agent 永远是数据不是指令，本地执行须经持有人审批；疑似注入的消息会被打警示标记；唯一例外是「私有指令」——它只经席位专属通道下发，agent 可信执行；</li>'
    +'<li>Web 端数据只读展示，操作仅以你本人的用户 / 席位身份发出。</li></ul>';
}
function openHelp(){
  closeHelp();
  var m=document.createElement('div');
  m.className='dmodal'; m.id='helpModal';
  m.innerHTML='<div class="dbox" style="width:min(760px,94vw)"><div class="dhead"><b>？ 系统帮助 · agent-talk 圆桌会谈</b><span style="flex:1"></span><button id="hpClose">关闭</button></div>'
    +'<div class="dbody">'+helpBodyHtml()+'</div></div>';
  m.onclick=function(e){ if(e.target===m) closeHelp(); };
  document.body.appendChild(m);
  document.getElementById('hpClose').onclick=closeHelp;
  document.getElementById('hpAgentCopy').onclick=function(){ copyText(agentAccessText()); };
}
/* ---------- 模式帮助弹窗（建桌表单各桌类型卡片「?」按钮；body 级，不受轮询重渲染影响） ---------- */
function closeModeHelp(){ var m=document.getElementById('modeHelpModal'); if(m) m.remove(); }
function openModeHelp(id){
  var h=MODE_HELP[id]; if(!h) return;
  closeModeHelp();
  var tt=TT_BY_ID[id]||TT_BY_ID.review;
  var body='<h4>模式说明</h4><p>'+esc(h.brief)+'</p>'
    +'<div class="kv" style="margin-top:6px"><span class="k">适合</span>'+esc(h.fit)+'</div>'
    +'<div class="kv"><span class="k">角色</span>'+esc(h.roles)+'</div>'
    +'<div class="kv"><span class="k">流程</span>'+esc(h.flow)+'</div>'
    +'<h4>使用方式</h4><ol class="mhelp">'+h.usage.map(function(s){ return '<li>'+esc(s)+'</li>'; }).join('')+'</ol>'
    +'<h4>最佳实践</h4><ul class="mhelp">'+h.best.map(function(s){ return '<li>'+esc(s)+'</li>'; }).join('')+'</ul>'
    +'<div class="hint" style="margin-top:10px">'+esc(MODE_HELP_FOOT)+'</div>';
  var m=document.createElement('div');
  m.className='dmodal'; m.id='modeHelpModal';
  m.innerHTML='<div class="dbox" style="width:min(720px,94vw)">'
    +'<div class="dhead">'+typeBadge(id)+'<b>'+esc(tt.label)+' · 模式帮助</b><span style="flex:1"></span><button id="mhClose">关闭</button></div>'
    +'<div class="dbody">'+body+'</div></div>';
  m.onclick=function(e){ if(e.target===m) closeModeHelp(); };
  document.body.appendChild(m);
  document.getElementById('mhClose').onclick=closeModeHelp;
}
function openDocPreview(doc){
  closeDocPreview();
  var kind=docPreviewKind(doc.name);
  var m=document.createElement('div');
  m.className='dmodal'; m.id='docPvModal';
  m.innerHTML='<div class="dbox"><div class="dhead"><b>'+esc(doc.name)+'</b>'
    +'<span class="badge phase">'+esc(doc.purpose||'')+'</span><span class="dim">'+fmtSize(doc.size)+'</span>'
    +'<span style="flex:1"></span>'
    +'<button id="pvDl">下载</button><button id="pvClose">关闭</button></div>'
    +'<div class="dbody" id="pvBody"><span class="dim">加载中…</span></div></div>';
  m.onclick=function(e){ if(e.target===m) closeDocPreview(); };
  document.body.appendChild(m);
  document.getElementById('pvClose').onclick=closeDocPreview;
  document.getElementById('pvDl').onclick=function(){ downloadDoc(doc.docId,doc.name); };
  api('GET','/api/tables/'+view.tableId+'/my/documents/'+doc.docId).then(function(d){
    var body=document.getElementById('pvBody');
    if(!body) return;
    var u8=b64ToU8(d.contentBase64);
    if(kind==='image'||kind==='pdf'){
      var e0=docExt(doc.name);
      var mime=kind==='pdf'?'application/pdf':('image/'+(e0==='jpg'?'jpeg':(e0==='svg'?'svg+xml':e0)));
      var url=URL.createObjectURL(new Blob([u8],{type:mime}));
      if(kind==='image') body.innerHTML='<img alt="" data-blob="'+url+'" src="'+url+'">';
      else body.innerHTML='<iframe data-blob="'+url+'" src="'+url+'" title="pdf-preview"></iframe>';
      return;
    }
    if(kind==='docx'){
      body.innerHTML='<span class="dim">正在加载 docx 转换库…（首次从 CDN 加载，需外网）</span>';
      ensureMammoth(function(ok){
        var b2=document.getElementById('pvBody'); if(!b2) return;
        if(!ok){ b2.innerHTML='<div class="dim">docx 在线预览需从 CDN 加载转换库，当前不可用——请点右上「下载」后本地打开。</div>'; return; }
        window.mammoth.convertToHtml({arrayBuffer:u8.buffer.slice(u8.byteOffset,u8.byteOffset+u8.byteLength)}).then(function(r){
          var b3=document.getElementById('pvBody'); if(!b3) return;
          b3.innerHTML='<div class="mdv">'+sanitizeHtml(r&&r.value||'')+'</div>';
        }).catch(function(){ var b3=document.getElementById('pvBody'); if(b3) b3.innerHTML='<div class="dim">docx 解析失败，请下载后本地打开。</div>'; });
      });
      return;
    }
    var txt=new TextDecoder('utf-8',{fatal:false}).decode(u8);
    if(txt.length>1000000){ body.innerHTML='<div class="dim">文本超过 1MB，在线预览已省略——请下载后查看。</div>'; return; }
    body.innerHTML=(kind==='md')?('<div class="mdv">'+miniMd(txt)+'</div>'):('<pre>'+esc(txt)+'</pre>');
  }).catch(function(e){
    var b=document.getElementById('pvBody'); if(b) b.innerHTML='<span class="dim">加载失败：'+esc(e.message)+'</span>';
  });
}
function phaseBadge(ph, roundNo, tt){
  var lbl=phaseLabel(tt,ph)||PHASE_LABEL[ph]||ph; if(ph==='review'&&roundNo>0) lbl+=' · 第'+roundNo+'轮';
  return '<span class="badge '+(PHASE_CLS[ph]||'')+'">'+esc(lbl)+'</span>';
}
function roleBadge(role){ return '<span class="rb '+esc(role)+'">'+esc(ROLE_LABEL[role]||role)+'</span>'; }
function seatName(seats,id){ if(id==='asker') return '问询方'; for(var i=0;i<seats.length;i++){ if(seats[i].seatId===id) return seats[i].name; } return id; }
/* 发言权思考进度文案：agent 旁路上报（turnProgress）有值按阶段显示，无上报/旧 skill 回落「思考中」 */
function turnStageLabel(p){ if(!p) return '思考中'; return p.stage==='preparing'?'准备中':(p.stage==='working'?'处理中':(p.stage==='finalizing'?'即将结束':'思考中')); }
/* 席位断开判定（服务端派生 online===false 才显示；undefined=旧数据按在线）；闭桌不显示（历史桌全员离线属正常） */
function seatOff(s,t){ return t.phase!=='closed' && s.online===false; }
function seatRoleOf(seats,id){ for(var i=0;i<seats.length;i++){ if(seats[i].seatId===id) return seats[i].role; } return ''; }

/* ---------- 圆桌示意图（桌详情顶部） ----------
   席位按九宫格方位左右优先布置（节约上下高度）：每席标最后一个回合的交付摘要；发言权持有者 = 正在思考（脉冲标记）；
   >8 席时只放 7 席 + 1 个「+N」节点，其余点击展开（view.rtExpanded 抗轮询重渲染）。 */
function clipStr(s,n){ s=String(s==null?'':s); return s.length>n?s.slice(0,n)+'…':s; }
var VOTE_LABEL={pass:'赞成',conditional_pass:'有条件赞成',reject:'反对'};
var REQD_LABEL={accept:'接纳',reject:'拒绝',counter:'反提案',escalate_human:'转人工'};
/* 执行请求：状态（RequestStatus）与意图（RequestIntent）中文标签 */
var REQ_ST_LABEL={pending:'待处置',accepted:'已接纳',executed:'已执行',rejected:'已拒绝',countered:'已反提案',human:'转人工'};
var REQ_INTENT_LABEL={modify_artifact:'修改产物',clarify:'澄清说明'};
/* 评审项：回应决定（ResponseItem.decision）中文标签 */
var RESP_LABEL={accept:'接纳',reject:'拒绝',defer:'暂缓跟进',human:'转人工'};
/** 评审项全生命周期状态：{cls 徽章色, label 中文}。
 *  待回应=无回应；最后回应 reject（或最后派生请求 rejected）=已拒绝；defer=暂缓；human=待人工；
 *  accept 后看派生请求：pending=已接纳·执行中、countered=反提案待回应、executed=通过——
 *  恰一次回应+至多一个请求且无反提案/转人工史=直接通过，否则=交互后通过（多方交互的判定依据） */
function reviewItemStatus(rec){
  var rs=rec.responses||[], reqs=rec.requests||[];
  var last=rs[rs.length-1];
  if(!last) return {cls:'warn',label:'待回应'};
  if(last.decision==='reject') return {cls:'err',label:'已拒绝'};
  if(last.decision==='defer') return {cls:'',label:'暂缓跟进'};
  if(last.decision==='human') return {cls:'warn',label:'待人工'};
  if(!reqs.length) return {cls:'ok',label:'直接通过'};
  var lastReq=reqs[reqs.length-1];
  if(lastReq.status==='rejected') return {cls:'err',label:'已拒绝'};
  if(lastReq.status==='human') return {cls:'warn',label:'待人工'};
  if(lastReq.status==='countered') return {cls:'warn',label:'反提案待回应'};
  if(lastReq.status==='pending'||lastReq.status==='accepted') return {cls:'warn',label:'已接纳·执行中'};
  var interacted=rs.length>1||reqs.length>1||reqs.some(function(r){ return r.status==='countered'||r.status==='human'; });
  return {cls:'ok',label:interacted?'交互后通过':'直接通过'};
}
/** 席位最后一条消息 → 摘要：label 短版（环上节点用），full 长版（title/展开清单用） */
function lastDelivInfo(m){
  if(!m) return {label:'',full:''};
  var p=m.payload||{}, n=0;
  if(m.type==='STATEMENT') return {label:'陈述：'+clipStr(p.text,8), full:'提案陈述：'+(p.text||'')};
  if(m.type==='REVIEW_COMMENT'){ n=(p.items&&p.items.length)||0; return {label:'评审 '+n+' 条', full:(p.summary||('结构化评审意见 '+n+' 条'))}; }
  if(m.type==='RESPONSE'){ n=(p.items&&p.items.length)||0; return {label:'回应 '+n+' 条', full:'逐条回应评审 '+n+' 条'}; }
  if(m.type==='RESPOND_REQUEST') return {label:'处置：'+(REQD_LABEL[p.decision]||p.decision||''), full:'处置执行请求：'+(REQD_LABEL[p.decision]||p.decision||'')+(p.reason?(' — '+p.reason):'')};
  if(m.type==='CONSENSUS_VOTE') return {label:'表决：'+(VOTE_LABEL[p.decision]||p.decision||''), full:'共识表决：'+(VOTE_LABEL[p.decision]||p.decision||'')+(p.note?(' — '+p.note):'')};
  if(m.type==='ARTIFACT_PUBLISHED') return {label:'产物 '+clipStr(p.name,8)+' v'+((p.version&&p.version.v)||'?'), full:'发布产物 '+(p.name||'')+' v'+((p.version&&p.version.v)||'?')+' — '+((p.version&&p.version.changeNote)||'')};
  if(m.type==='DOC_UPLOADED') return {label:'资料 '+clipStr(p.doc&&p.doc.name,8), full:'上传资料 '+(p.doc&&p.doc.name||'')+' — '+(p.doc&&p.doc.purpose||'')};
  if(m.type==='QUESTION') return {label:'问：'+clipStr(p.text,8), full:'提问：'+(p.text||'')};
  if(m.type==='REPLY') return {label:'答：'+clipStr(p.text,8), full:'回答：'+(p.text||'')};
  if(m.type==='REQUEST') return {label:'请求：'+clipStr(p.title,8), full:'执行请求 '+(p.title||'')+'：'+(p.detail||'')};
  if(m.type==='HUMAN_INPUT') return {label:'人工指令', full:'人工指令：'+(p.text||'')};
  if(m.type==='SUPPLEMENT') return {label:'补充：'+clipStr(p.text,8), full:'预审点名补充：'+(p.text||'')};
  return {label:MT_LABEL[m.type]||m.type, full:MT_LABEL[m.type]||m.type};
}
`;
