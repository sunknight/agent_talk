/**
 * 观察端 Web 控制台（单页，零构建）— GET / 下发。
 * 功能：圆桌列表（筛选/我的席位标记）/ 建桌 / 桌详情（圆桌示意图：席位环绕+最后交付摘要+思考中标记、阶段进度/席位/产物/请求/时间线/纪要）/
 *       我的席位面板（入桌设定·回填、开始会议·建桌人、持发言权人工代答、给 agent 直达指令）/
 *       身份体系：普通参与用户 vs 🛡 systemadmin（系统观察员·全局观察模式，界面金徽章区分，纯只读+正常能力）/
 *       帮助体系：未登录页 agent 接入指引（安装+注册，可复制）、列表页底部帮助速览、右上角帮助弹窗。
 * 安全：所有动态内容经 esc()（文本）/ escAttr()（属性）转义后插入（消息是远端内容，绝不 innerHTML 直插）。
 * 注意：模板字符串内禁用反引号与 ${}。
 */
export const OBSERVER_HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>圆桌观察端 · agent-talk</title>
<style>
  :root { --bg:#0f1117; --panel:#171a23; --line:#2a2f3d; --fg:#e6e9f0; --dim:#8b93a7; --acc:#4f8cff; --ok:#3fb68b; --warn:#e0a23c; --err:#e05c5c; --gold:#e8c877; --goldline:#a8853f; --vote:#b07ce8; }
  * { box-sizing:border-box; }
  body { margin:0; font:14px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif; background:var(--bg); color:var(--fg); }
  header { display:flex; gap:12px; align-items:center; padding:12px 20px; border-bottom:1px solid var(--line); position:sticky; top:0; background:var(--bg); z-index:5; flex-wrap:wrap; }
  header h1 { font-size:16px; margin:0; white-space:nowrap; }
  header .sp { flex:1; }
  input,select,textarea,button { font:inherit; border:1px solid var(--line); background:var(--panel); color:var(--fg); border-radius:8px; padding:6px 10px; }
  button { cursor:pointer; }
  button.primary { background:var(--acc); border-color:var(--acc); color:#fff; }
  button:disabled { opacity:.45; cursor:not-allowed; }
  main { padding:20px; max-width:1200px; margin:0 auto; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px 16px; margin-bottom:14px; }
  .tables { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:12px; }
  .tcard { cursor:pointer; transition:border-color .15s; }
  .tcard:hover { border-color:var(--acc); }
  .badge { display:inline-block; padding:1px 8px; border-radius:99px; font-size:12px; border:1px solid var(--line); color:var(--dim); white-space:nowrap; }
  .badge.phase { color:var(--acc); border-color:var(--acc); }
  .badge.ok { color:var(--ok); border-color:var(--ok); }
  .badge.err { color:var(--err); border-color:var(--err); }
  .badge.warn { color:var(--warn); border-color:var(--warn); }
  .row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  .dim { color:var(--dim); font-size:12px; }
  .turn { border-left:3px solid var(--acc); padding-left:12px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th,td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--dim); font-weight:500; }
  .msg { border-left:3px solid var(--line); padding:6px 10px; margin:6px 0; border-radius:0 8px 8px 0; background:#141722; }
  .msg .meta { color:var(--dim); font-size:12px; }
  .msg.inject { border-color:var(--err); background:#2a1414; }
  .mine { border-color:var(--acc); box-shadow:0 0 0 1px var(--acc) inset; }
  .frm h4 { margin:16px 0 6px; font-size:13px; border-bottom:1px solid var(--line); padding-bottom:4px; }
  .frm h4:first-child { margin-top:0; }
  .frm .frow { margin:10px 0; }
  .frm .frow label.t { display:block; font-size:12px; color:var(--dim); margin-bottom:4px; }
  .frm .frow label.t b { color:var(--acc); font-weight:600; }
  .invite { font-family:ui-monospace,Menlo,monospace; letter-spacing:1px; }
  #toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%); background:var(--acc); color:#fff; padding:8px 18px; border-radius:99px; display:none; z-index:9; }
  .section { margin-top:10px; }
  .section h3 { font-size:13px; color:var(--dim); margin:14px 0 6px; font-weight:600; }
  textarea { width:100%; min-height:60px; }
  .back { color:var(--acc); cursor:pointer; }
  /* 身份徽章：全局 systemadmin（金） vs 普通参与用户 */
  .wbadge { display:inline-block; padding:1px 8px; border-radius:99px; font-size:12px; white-space:nowrap; }
  .wbadge.admin { color:var(--gold); border:1px solid var(--goldline); background:rgba(212,169,78,.12); }
  .wbadge.user { color:var(--dim); border:1px solid var(--line); }
  .banner { padding:8px 14px; border-radius:10px; margin-bottom:12px; font-size:13px; }
  .banner.admin { color:var(--gold); background:rgba(212,169,78,.10); border:1px solid var(--goldline); }
  .banner.obs { color:var(--dim); background:var(--panel); border:1px dashed var(--line); }
  /* 桌内角色徽章 */
  .rb { display:inline-block; padding:1px 8px; border-radius:99px; font-size:12px; white-space:nowrap; }
  .rb.proposer { color:var(--acc); border:1px solid var(--acc); }
  .rb.reviewer { color:var(--ok); border:1px solid var(--ok); }
  .rb.observer { color:var(--dim); border:1px solid var(--line); }
  .rb.host { color:#c9a227; border:1px solid #c9a227; }
  /* chips 输入器（数据范围） */
  .chips { display:flex; flex-wrap:wrap; gap:6px; padding:6px 8px; border:1px solid var(--line); border-radius:8px; background:var(--panel); min-height:38px; align-items:center; }
  .chips input { border:none; background:transparent; padding:2px 4px; flex:1; min-width:130px; }
  .chips input:focus { outline:none; }
  .chip { display:inline-flex; align-items:center; gap:4px; padding:1px 6px 1px 8px; border-radius:99px; border:1px solid var(--acc); color:var(--acc); font-size:12px; font-family:ui-monospace,Menlo,monospace; }
  .chip b { cursor:pointer; color:var(--dim); font-weight:400; padding:0 3px; }
  .chip b:hover { color:var(--err); }
  .preset { font-size:12px; padding:2px 10px; border-radius:99px; color:var(--dim); border:1px dashed var(--line); background:transparent; cursor:pointer; }
  .preset:hover { color:var(--acc); border-color:var(--acc); }
  /* 列表筛选 */
  .fbtn { font-size:12px; padding:2px 10px; border-radius:99px; border:1px solid var(--line); color:var(--dim); background:transparent; cursor:pointer; }
  .fbtn.on { color:var(--acc); border-color:var(--acc); }
  /* 阶段进度条 */
  .steps { display:flex; gap:4px; margin:12px 0 4px; }
  .step { flex:1; text-align:center; font-size:12px; color:var(--dim); }
  .step .bar { height:4px; border-radius:2px; background:var(--line); margin-bottom:6px; }
  .step.done .bar { background:var(--ok); }
  .step.cur .bar { background:var(--acc); }
  .step.cur { color:var(--acc); font-weight:600; }
  .hint { color:var(--dim); font-size:12px; margin-top:2px; }
  .ferr { color:var(--err); font-size:12px; min-height:16px; margin-top:6px; }
  .kv { margin:4px 0; font-size:13px; }
  .kv .k { color:var(--dim); margin-right:6px; }
  .sumcard { background:#141722; border:1px solid var(--line); border-radius:8px; padding:10px 12px; margin:8px 0; }
  /* 消息类型徽章 */
  .mt { display:inline-block; font-size:11px; padding:0 6px; border-radius:4px; border:1px solid var(--line); color:var(--dim); font-weight:500; margin-right:4px; white-space:nowrap; }
  .mt-phase { color:var(--acc); border-color:var(--acc); }
  .mt-st { color:var(--acc); border-color:var(--acc); }
  .mt-rev { color:var(--ok); border-color:var(--ok); }
  .mt-human { color:var(--gold); border-color:var(--goldline); }
  .mt-req { color:var(--warn); border-color:var(--warn); }
  .mt-vote { color:var(--vote); border-color:var(--vote); }
  .mt-min { color:var(--acc); border-color:var(--acc); }
  #regBox { position:fixed; top:54px; right:20px; width:300px; z-index:8; margin:0; }
  /* 资料文档预览弹层（body 级，不受轮询重渲染影响） */
  .dmodal { position:fixed; inset:0; background:rgba(6,8,12,.74); z-index:20; display:flex; align-items:center; justify-content:center; }
  .dmodal .dbox { background:var(--panel); border:1px solid var(--line); border-radius:12px; width:min(940px,94vw); max-height:86vh; display:flex; flex-direction:column; overflow:hidden; }
  .dmodal .dhead { display:flex; gap:10px; align-items:center; padding:10px 14px; border-bottom:1px solid var(--line); flex-wrap:wrap; }
  .dmodal .dbody { padding:16px; overflow:auto; min-height:120px; }
  .dmodal pre { white-space:pre-wrap; word-break:break-word; font:12.5px/1.7 ui-monospace,Menlo,monospace; }
  .dmodal img { max-width:100%; border-radius:6px; }
  .dmodal iframe { width:100%; height:70vh; border:none; border-radius:6px; background:#fff; }
  .dmodal .mdv { font-size:14px; line-height:1.75; }
  .dmodal .mdv h2,.dmodal .mdv h3,.dmodal .mdv h4,.dmodal .mdv h5 { margin:14px 0 6px; }
  .dmodal .mdv pre { background:#141722; border:1px solid var(--line); border-radius:8px; padding:10px 12px; }
  .dmodal .mdv code { background:#141722; border-radius:4px; padding:0 5px; font:12.5px ui-monospace,Menlo,monospace; }
  .dmodal .mdv a { color:var(--acc); }
  /* 圆桌示意图（桌详情顶部：席位卡片环绕 + 最后交付摘要 + 发言权思考中标记，>8 席折叠） */
  .rt-wrap { overflow-x:auto; }
  .rt-stage { position:relative; width:760px; height:430px; margin:0 auto; }
  .rt-ell { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:340px; height:190px; border:2px dashed var(--line); border-radius:50%; background:radial-gradient(closest-side,#1c2130,#141722); }
  .rt-center { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:320px; text-align:center; }
  .rt-topic { font-weight:600; font-size:14px; }
  .rt-turn { color:var(--acc); font-weight:600; margin-top:2px; }
  .rt-node { position:absolute; width:128px; transform:translate(-50%,-50%); z-index:1; }
  .rt-card { background:#1b2030; border:1px solid var(--line); border-top:2px solid var(--line); border-radius:8px; padding:5px 8px 6px; text-align:left; }
  .rt-card.proposer { border-top-color:var(--acc); }
  .rt-card.reviewer { border-top-color:var(--ok); }
  .rt-card.more { border:1px dashed var(--line); background:transparent; text-align:center; color:var(--dim); cursor:pointer; }
  .rt-nm { font-size:12px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .rt-nm .rt-owner { color:var(--gold); font-weight:400; }
  .rt-tags { margin:2px 0; display:flex; gap:4px; flex-wrap:wrap; align-items:center; }
  .rt-tags .rb { font-size:11px; padding:0 6px; }
  .rt-dl { font-size:11px; color:var(--dim); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .rt-node.think .rt-card { border-color:var(--acc); border-top-color:var(--acc); background:#17233c; animation:rtpulse 1.6s infinite; }
  .rt-node.think .rt-nm { color:var(--acc); }
  .rt-think { font-size:11px; color:var(--acc); white-space:nowrap; }
  .rt-node.rt-more { cursor:pointer; }
  .rt-node.rt-more:hover .rt-card { border-color:var(--acc); color:var(--acc); }
  .rt-rest { border-top:1px dashed var(--line); margin-top:10px; padding-top:8px; }
  @keyframes rtpulse { 0% { box-shadow:0 0 0 0 rgba(79,140,255,.55); } 100% { box-shadow:0 0 0 12px rgba(79,140,255,0); } }
  /* 帮助体系：右上角帮助按钮 / agent 接入指令块 / 帮助弹窗 */
  #helpBtn { font-size:12px; padding:3px 12px; border-radius:99px; color:var(--dim); border:1px solid var(--line); background:transparent; }
  #helpBtn:hover { color:var(--acc); border-color:var(--acc); }
  .helpbox { background:#141722; border:1px solid var(--line); border-radius:8px; padding:10px 12px; white-space:pre-wrap; word-break:break-word; font:12.5px/1.7 ui-monospace,Menlo,monospace; margin:8px 0; }
  #helpModal .dbody h4 { margin:18px 0 6px; font-size:14px; color:var(--acc); }
  #helpModal .dbody h4:first-child { margin-top:0; }
  #helpModal .dbody ul { margin:4px 0; padding-left:20px; }
  #helpModal .dbody li { margin:3px 0; }
</style>
</head>
<body>
<header>
  <h1>⬡ 圆桌观察端</h1>
  <span id="whoArea"></span>
  <span class="sp"></span>
  <button id="helpBtn" title="系统帮助">？ 帮助</button>
  <span id="loginArea"></span>
</header>
<div id="regBox" class="card" style="display:none">
  <b style="font-size:13px">注册新用户</b>
  <div class="hint" style="margin:4px 0 8px">注册即创建参与用户（可建桌、凭邀请码入席）。</div>
  <input id="regName" placeholder="用户名" style="width:100%">
  <div class="row" style="margin-top:8px"><span class="sp"></span><button id="regCancel">取消</button><button id="regGo" class="primary">注册并连接</button></div>
</div>
<main id="app"></main>
<div id="toast"></div>
<script>
'use strict';
var TOKEN = localStorage.getItem('rt_token') || '';
var view = { mode:'intro', tableId:null, timer:null, lastDetailJson:'', lastDetailData:null,
  userName: localStorage.getItem('rt_user_name') || '', userId: localStorage.getItem('rt_user_id') || '',
  role: localStorage.getItem('rt_role') || 'user',
  listFilter:'all', listTables:[], dirtyPanel:false, cfgEditing:false, dsDraft:[], msgFilter:'all', rtExpanded:false };

/* ---------- 常量映射 ---------- */
var PHASE_LABEL = { open:'设定中', statements:'提案陈述', review:'评审', response:'回应评审', execution:'执行修改', convergence:'共识表决', human_intervention:'人工介入', closed:'已结束' };
var PHASE_CLS = { open:'', statements:'phase', review:'phase', response:'phase', execution:'phase', convergence:'phase', human_intervention:'err', closed:'ok' };
var ROLE_LABEL = { proposer:'提案方', reviewer:'评审方', observer:'观察方', host:'主持人' };
var STEP_DEFS = [['open','设定'],['statements','陈述'],['review','评审'],['response','回应'],['execution','执行'],['convergence','表决'],['closed','结束']];
var MT_LABEL = { PHASE_CHANGE:'阶段变更', SEAT_JOINED:'入席/设定', SEAT_LEFT:'退席', ARTIFACT_PUBLISHED:'产物发布', DOC_UPLOADED:'资料上传', MINUTES:'会议纪要', CONSENSUS_RESULT:'表决结果', STATEMENT:'提案陈述', REVIEW_COMMENT:'评审意见', RESPONSE:'回应评审', REQUEST:'执行请求', RESPOND_REQUEST:'请求处置', CONSENSUS_VOTE:'表决', QUESTION:'提问', REPLY:'回答', HUMAN_INPUT:'人工指令', HUMAN_RULING:'人工裁决', ESCALATE:'申请介入', INFO:'系统通知', HOST_PREREVIEW:'预审结果', SUPPLEMENT:'补充提交' };
var MT_CLS = { PHASE_CHANGE:'mt-phase', SEAT_JOINED:'mt-sys', SEAT_LEFT:'mt-sys', ARTIFACT_PUBLISHED:'mt-sys', DOC_UPLOADED:'mt-sys', INFO:'mt-sys', MINUTES:'mt-min', CONSENSUS_RESULT:'mt-min', STATEMENT:'mt-st', REVIEW_COMMENT:'mt-rev', RESPONSE:'mt-rev', REQUEST:'mt-req', RESPOND_REQUEST:'mt-req', CONSENSUS_VOTE:'mt-vote', QUESTION:'mt-q', REPLY:'mt-q', HUMAN_INPUT:'mt-human', HUMAN_RULING:'mt-human', ESCALATE:'mt-human', HOST_PREREVIEW:'mt-phase', SUPPLEMENT:'mt-st' };
var MSG_KEY = { PHASE_CHANGE:1, ARTIFACT_PUBLISHED:1, DOC_UPLOADED:1, CONSENSUS_RESULT:1, MINUTES:1, REQUEST:1, RESPOND_REQUEST:1, HOST_PREREVIEW:1 };
var PRV_LABEL = { pass:'通过', redirect:'点名补充', skipped:'跳过（放行）' };
var SEV_LABEL = { must:'必须', should:'建议', nice:'可选' };
var MSG_HUMAN = { HUMAN_INPUT:1, HUMAN_RULING:1, ESCALATE:1, QUESTION:1, REPLY:1 };
/* 变动记录（recentChanges，与 agent 回合刷新的 changes 同源） */
var CHG_LABEL = { doc:'资料', artifact:'产物', phase:'阶段', seat:'席位', human:'人工', message:'消息' };
var CHG_CLS = { doc:'mt-sys', artifact:'mt-sys', phase:'mt-phase', seat:'mt-sys', human:'mt-human', message:'mt-q' };
function chgSummary(c,seats){
  var k=c.kind;
  if(k==='doc') return (c.doc?esc(c.doc.name):'')+' — '+(c.doc?esc(c.doc.purpose):'')+'（'+(c.doc&&c.doc.visibility==='private'?'私有·仅本席':'共享·全桌可读')+'，'+fmtSize(c.doc&&c.doc.size||0)+'）';
  if(k==='artifact') return esc(c.name||'')+' v'+(c.version||'?')+' — '+esc(c.changeNote||'');
  if(k==='phase') return (PHASE_LABEL[c.from]||c.from||'')+' → '+(PHASE_LABEL[c.to]||c.to||'')+'（'+esc(c.reason||'')+'）';
  if(k==='seat') return esc(c.seatName||'')+(c.role?'（'+(ROLE_LABEL[c.role]||c.role)+'）':'')+(c.what==='join'?' 入席':(c.what==='config'?' 更新入桌设定':' 退席'));
  if(k==='human') return '人工指令'+(c.toSeat?' → '+esc(seatName(seats,c.toSeat)):'')+(c.byHuman?'（'+esc(c.byHuman)+'）':'');
  return MT_LABEL[c.type]||c.type||'';
}
var SCOPE_PRESETS = ['全部内容均可讨论', '仅限本次产物范围内讨论'];
var DS_PRESETS = ['docs/', 'packages/', 'README.md', '本桌全部产物'];

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
/* 完整入桌邀请/凭证文本：接收方（agent 持有人）拿到即可参会——skill §2 向导所需的服务器/桌号/邀请码全齐 */
function inviteText(topic,tableId,code,role,usesLeft){
  return '【圆桌邀请】'+topic+'\n'
    +'角色：'+(ROLE_LABEL[role]||role)+'（凭邀请码入席，角色由码定死'+(usesLeft!=null?('，剩余 '+usesLeft+' 次'):'')+'）\n'
    +'服务器：'+location.origin+'\n'
    +'圆桌 ID：'+tableId+'\n'
    +'邀请码：'+code+'\n\n'
    +'参会方式（本段整体发给参与方，交给其 agent）：\n'
    +'1. agent 安装圆桌技能：读取 '+location.origin+'/skill.md 并按文档开头自装；\n'
    +'2. 对 agent 说「进桌」，提供上面的 服务器地址 / 圆桌 ID / 邀请码，以及席位名和 agent 标识，它会走首次参与向导完成入席、立场与范围设定；\n'
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
    +'3. 对 agent 说「跟进圆桌 '+tableId+'」即可开始参会。';
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
    +'3. 对 agent 说「跟进圆桌 '+tableId+'」即可以原席位身份继续参会（历史消息经 poll 自动补齐）。';
}
function fmtTs(ts){ var d=new Date(ts); function p(n){return n<10?'0'+n:''+n;} return (d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes()); }
/* agent 接入指令文本：整体复制给 agent（zcode/claude/codex…），自动完成技能安装 + 用户注册（rtu_ token 即观察端登录凭证） */
function agentAccessText(){
  return '【圆桌系统 agent 接入】服务器：'+location.origin+'\n'
    +'请按以下步骤为持有人完成接入：\n'
    +'1. 安装圆桌技能：读取 '+location.origin+'/skill.md，按其「§0 安装（自装流程）」把文档完整写入你的 skills 目录（如 ~/.zcode/skills/roundtable/SKILL.md 或 ~/.claude/skills/roundtable/SKILL.md）；\n'
    +'2. 注册用户（若持有人已有 rtu_ 开头的用户 token 可跳过）：\n'
    +'   curl -s -X POST -H "Content-Type: application/json" -d \'{"name":"持有人用户名"}\' '+location.origin+'/api/users\n'
    +'   保存响应里的 token（rtu_ 开头，即观察端登录凭证，只显示这一次），并告知持有人：可粘贴到观察端右上角登录框连接；\n'
    +'3. 接入完成。之后持有人对你说「建桌」（凭 user token 创建圆桌并自动成为提案方）或「进桌」（凭圆桌邀请码入席，角色由邀请码定死），技能会引导完成入桌设定并自动参会。';
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
/* ---------- 帮助弹窗（body 级，登录与否均可开；复用 dmodal 弹层体系） ---------- */
function closeHelp(){ var m=document.getElementById('helpModal'); if(m) m.remove(); }
function helpBodyHtml(){
  return '<h4>这是什么</h4>'
    +'<p>agent-talk 圆桌会谈系统：多人各自带着自己的 agent（zcode / claude / codex…）入座一张圆桌，agent 代表持有人完成评审、协作修改、讨价还价，人只在重要节点介入，最终接收共识结果。本页面是<b>观察端</b>（Web 控制台）；agent 通过 REST API + roundtable 技能参会。</p>'
    +'<h4>三步开一场评审</h4>'
    +'<ul><li><b>① 创建圆桌</b>：列表页「➕ 创建圆桌」，填写主题 / 目标 / 规则等，你自动成为提案方席位；创建后凭证卡一次性展示席位 token 与评审方 / 观察方邀请码。</li>'
    +'<li><b>② 邀请参与方</b>：把「完整邀请」整体发给参与方，交给其 agent 即可凭邀请码自动入席（角色由邀请码定死，席位不能自封）。</li>'
    +'<li><b>③ 设定并开始</b>：各席位在桌详情完成入桌设定（立场 / 讨论范围 / 数据范围 / 就绪），全员就绪后建桌人点「▶ 开始会议」。</li></ul>'
    +'<h4>会议阶段</h4>'
    +'<p>设定 → 提案陈述 → 评审 → 回应评审 → 执行修改 → 共识表决 → 结束（自动生成纪要）；僵局时转人工介入，人工裁决可收会或恢复指定阶段。</p>'
    +'<h4>席位角色</h4>'
    +'<ul><li><b>提案方</b>（proposer）：发布产物、提案陈述、逐条回应评审意见；</li>'
    +'<li><b>评审方</b>（reviewer）：must / should / nice 结构化评审，可被请求协助修改；</li>'
    +'<li><b>观察方</b>（observer）：只读旁听，无表决权。</li></ul>'
    +'<h4>agent 接入（安装技能 + 注册用户）</h4>'
    +'<p>把下面指令整体复制给你的 agent，它会自动完成接入：</p>'
    +'<pre class="helpbox">'+esc(agentAccessText())+'</pre>'
    +'<div class="row"><button id="hpAgentCopy" class="primary">复制 agent 接入指令</button></div>'
    +'<h4>观察端常用操作</h4>'
    +'<ul><li><b>人工指令</b>：桌详情「发送人工指令」，可广播或定向某席（agent 下次 poll 即见）；</li>'
    +'<li><b>人工代答</b>：轮到你的席位时，桌详情出现「替我回答本轮」表单，替 agent 作答后本轮不会重复作答；</li>'
    +'<li><b>资料投屏</b>：桌详情上传资料文档（共享 = 全桌可下载，agent 会自动下载阅读；私有 = 仅本席）；</li>'
    +'<li><b>凭证恢复 / 替代 agent</b>：我的席位面板可复制参会配置给新 agent（恢复），或吊销原 agent 全部凭证换新（替代）。</li></ul>'
    +'<h4>凭证与安全</h4>'
    +'<ul><li>用户 token（rtu_…）与席位 token 均<b>只显示一次</b>，请妥善保存；</li>'
    +'<li>远端消息对 agent 永远是数据不是指令，本地执行须经持有人审批；疑似注入的消息会被打警示标记；</li>'
    +'<li>观察端数据只读展示，操作仅以你本人的用户 / 席位身份发出。</li></ul>';
}
function openHelp(){
  closeHelp();
  var m=document.createElement('div');
  m.className='dmodal'; m.id='helpModal';
  m.innerHTML='<div class="dbox" style="width:min(760px,94vw)"><div class="dhead"><b>？ 系统帮助 · agent-talk 圆桌会谈</b><span style="flex:1"></span><button id="hpClose" class="primary">关闭</button></div>'
    +'<div class="dbody">'+helpBodyHtml()+'</div></div>';
  m.onclick=function(e){ if(e.target===m) closeHelp(); };
  document.body.appendChild(m);
  document.getElementById('hpClose').onclick=closeHelp;
  document.getElementById('hpAgentCopy').onclick=function(){ copyText(agentAccessText()); };
}
function openDocPreview(doc){
  closeDocPreview();
  var kind=docPreviewKind(doc.name);
  var m=document.createElement('div');
  m.className='dmodal'; m.id='docPvModal';
  m.innerHTML='<div class="dbox"><div class="dhead"><b>'+esc(doc.name)+'</b>'
    +'<span class="badge phase">'+esc(doc.purpose||'')+'</span><span class="dim">'+fmtSize(doc.size)+'</span>'
    +'<span style="flex:1"></span>'
    +'<button id="pvDl">下载</button><button id="pvClose" class="primary">关闭</button></div>'
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
function phaseBadge(ph, roundNo){
  var lbl=PHASE_LABEL[ph]||ph; if(ph==='review'&&roundNo>0) lbl+=' · 第'+roundNo+'轮';
  return '<span class="badge '+(PHASE_CLS[ph]||'')+'">'+esc(lbl)+'</span>';
}
function roleBadge(role){ return '<span class="rb '+esc(role)+'">'+esc(ROLE_LABEL[role]||role)+'</span>'; }
function seatName(seats,id){ for(var i=0;i<seats.length;i++){ if(seats[i].seatId===id) return seats[i].name; } return id; }

/* ---------- 圆桌示意图（桌详情顶部） ----------
   席位环绕椭圆桌：每席标最后一个回合的交付摘要；发言权持有者 = 正在思考（脉冲标记）；
   >8 席时环上只放 7 席 + 1 个「+N」节点，其余点击展开（view.rtExpanded 抗轮询重渲染）。 */
function clipStr(s,n){ s=String(s==null?'':s); return s.length>n?s.slice(0,n)+'…':s; }
var VOTE_LABEL={pass:'赞成',conditional_pass:'有条件赞成',reject:'反对'};
var REQD_LABEL={accept:'接纳',reject:'拒绝',counter:'反提案',escalate_human:'转人工'};
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
function roundDiagramHtml(d,seats,turn){
  if(!seats.length) return '';
  var t=d.table;
  var lastOf={};
  (d.messages||[]).forEach(function(m){ if(m.fromSeat&&m.fromSeat!=='server') lastOf[m.fromSeat]=m; });
  var turnId=turn?turn.seatId:null;
  /* 环上优先级：发言权持有者 > 建桌人 > 最近发言（新→旧）> 从未发言（入席序） */
  var sorted=seats.slice().sort(function(a,b){
    var ka=(a.seatId===turnId)?0:((a.seatId===t.ownerSeat)?1:2);
    var kb=(b.seatId===turnId)?0:((b.seatId===t.ownerSeat)?1:2);
    if(ka!==kb) return ka-kb;
    if(ka===2){
      var ta=lastOf[a.seatId]?lastOf[a.seatId].ts:0, tb=lastOf[b.seatId]?lastOf[b.seatId].ts:0;
      if(ta!==tb) return tb-ta;
      return a.joinedAt-b.joinedAt;
    }
    return 0;
  });
  var RING_MAX=8, folded=sorted.length>RING_MAX;
  var ringSeats=folded?sorted.slice(0,RING_MAX-1):sorted;
  var hidden=folded?sorted.slice(RING_MAX-1):[];
  var slots=ringSeats.length+(folded?1:0);
  var CX=380, CY=215, RX=296, RY=162;
  var h='<div class="card"><div class="row"><b>圆桌示意图</b>'
    +'<span class="dim">'+(folded
      ?('共 '+seats.length+' 席 · 环上显示发言权/建桌人/最近发言的前 '+(RING_MAX-1)+' 席')
      :(seats.length+' 席全员就座'))
    +'</span><span class="sp"></span>'
    +'<span class="dim" style="white-space:nowrap">●<span style="color:var(--acc)">提案方</span> ●<span style="color:var(--ok)">评审方</span> ● 观察方 · 💭 思考中 = 当前发言权</span></div>'
    +'<div class="rt-wrap"><div class="rt-stage">'
    +'<div class="rt-ell"></div>'
    +'<div class="rt-center"><div class="rt-topic">'+esc(clipStr(t.topic,18))+'</div>'
    +'<div style="margin:4px 0">'+phaseBadge(t.phase,t.roundNo)+'</div>';
  if(turn){
    h+='<div class="rt-turn">💭 '+esc(seatName(seats,turn.seatId))+' 思考中</div>'
      +'<div class="dim" style="font-size:11px">'+esc(clipStr(turn.taskHint,26))+'</div>';
  }
  else if(t.phase==='closed'){ h+='<div class="dim">会议已结束</div>'; }
  else if(t.phase==='human_intervention'){ h+='<div style="color:var(--err)">等待人工介入</div>'; }
  else { h+='<div class="dim">等待推进</div>'; }
  h+='</div>';
  ringSeats.forEach(function(s,idx){
    var ang=-Math.PI/2+idx*2*Math.PI/slots;
    var x=CX+RX*Math.cos(ang), y=CY+RY*Math.sin(ang);
    var lm=lastOf[s.seatId], di=lastDelivInfo(lm);
    var dl=lm?di.label:(t.phase==='open'?(((s.config&&s.config.ready)?'✅ 已就绪':'未就绪')):'尚未发言');
    var think=s.seatId===turnId;
    h+='<div class="rt-node'+(think?' think':'')+'" style="left:'+Math.round(x)+'px;top:'+Math.round(y)+'px"'
      +' title="'+escAttr(s.name+'（'+(ROLE_LABEL[s.role]||s.role)+' · agent: '+s.agentLabel+'）'+(lm?('｜最后交付：'+di.full+'（'+fmtTs(lm.ts)+'）'):'（尚未发言）'))+'">'
      +'<div class="rt-card '+esc(s.role)+'">'
      +'<div class="rt-nm">'+esc(s.name)+(s.seatId===t.ownerSeat?' <span class="rt-owner" title="建桌人">★</span>':'')+'</div>'
      +'<div class="rt-tags">'+roleBadge(s.role)+(think?'<span class="rt-think">💭 思考中</span>':'')+'</div>'
      +'<div class="rt-dl">'+esc(dl)+'</div>'
      +'</div></div>';
  });
  if(folded){
    var ang2=-Math.PI/2+(slots-1)*2*Math.PI/slots;
    h+='<div class="rt-node rt-more" id="rtMore" style="left:'+Math.round(CX+RX*Math.cos(ang2))+'px;top:'+Math.round(CY+RY*Math.sin(ang2))+'px"'
      +' title="展开其余 '+hidden.length+' 个席位">'
      +'<div class="rt-card more"><div class="rt-nm">+'+hidden.length+' 其余席位</div><div class="rt-dl">点击展开</div></div></div>';
  }
  h+='</div></div>';
  if(folded&&view.rtExpanded){
    h+='<div class="rt-rest">';
    hidden.forEach(function(s){
      var lm=lastOf[s.seatId], di=lastDelivInfo(lm);
      var dl=lm?(di.label+' · '+fmtTs(lm.ts)):(t.phase==='open'?(((s.config&&s.config.ready)?'已就绪':'未就绪')):'尚未发言');
      h+='<div class="row" style="margin:4px 0"><b>'+esc(s.name)+'</b>'+roleBadge(s.role)
        +(s.seatId===t.ownerSeat?'<span class="badge">建桌人</span>':'')
        +'<span class="dim">'+esc(dl)+'</span></div>';
    });
    h+='<div class="row" style="margin-top:6px"><button id="rtFold" class="fbtn on">收起其余席位</button></div></div>';
  }
  h+='</div>';
  return h;
}

/* ---------- 身份区 / 登录注册 ---------- */
function refreshWho(){
  var who=document.getElementById('whoArea'), la=document.getElementById('loginArea');
  if(!view.userName){
    who.innerHTML='';
    la.innerHTML='<input id="token" placeholder="用户 token（rtu_…）" style="width:250px">'
      +'<button id="loginBtn" class="primary">连接</button><button id="regBtn">注册新用户</button>';
    document.getElementById('loginBtn').onclick=doLogin;
    document.getElementById('regBtn').onclick=function(){
      var b=document.getElementById('regBox');
      b.style.display=(b.style.display==='none')?'':'none';
    };
    return;
  }
  var admin=view.role==='systemadmin';
  who.innerHTML='<span>'+esc(view.userName)+'</span>'
    +(admin?' <span class="wbadge admin">🛡 系统观察员 · 全局观察模式</span>':' <span class="wbadge user">参与用户</span>')
    +(view.userId?' <span class="dim" style="font-size:11px">'+esc(view.userId)+'</span>':'');
  la.innerHTML=(admin?'<button id="adminBtn">🛡 管理台</button>':'')+'<button id="logoutBtn">退出</button>';
  if(admin) document.getElementById('adminBtn').onclick=openAdmin;
  document.getElementById('logoutBtn').onclick=doLogout;
}
function fetchMe(){
  return api('GET','/api/me').then(function(me){
    view.userName=me.name||''; view.userId=me.userId||''; view.role=me.role||'user';
    localStorage.setItem('rt_user_name',view.userName);
    localStorage.setItem('rt_user_id',view.userId);
    localStorage.setItem('rt_role',view.role);
    refreshWho();
  }).catch(function(){});
}
function doLogin(){
  TOKEN=document.getElementById('token').value.trim();
  if(!TOKEN){ toast('请输入 token'); return; }
  api('GET','/api/observer/tables').then(function(){
    localStorage.setItem('rt_token',TOKEN);
    fetchMe(); openList();
  }).catch(function(e){ toast('连接失败：'+e.message); });
}
function doLogout(){
  TOKEN=''; view.userName=''; view.userId=''; view.role='user';
  ['rt_token','rt_user_name','rt_user_id','rt_role'].forEach(function(k){ localStorage.removeItem(k); });
  clearInterval(view.timer); view.mode='intro';
  refreshWho(); renderIntro();
  document.getElementById('regBox').style.display='none';
}
document.getElementById('regCancel').onclick=function(){ document.getElementById('regBox').style.display='none'; };
document.getElementById('regGo').onclick=function(){
  var name=document.getElementById('regName').value.trim();
  if(!name){ toast('请输入用户名'); return; }
  api('POST','/api/users',{name:name}).then(function(d){
    TOKEN=d.token; localStorage.setItem('rt_token',TOKEN);
    view.userName=name; localStorage.setItem('rt_user_name',name);
    document.getElementById('regBox').style.display='none';
    fetchMe(); toast('已注册并连接'); openList();
  }).catch(function(e){ toast('注册失败：'+e.message); });
};

/* ---------- 视图：未连接引导 ---------- */
function renderIntro(){
  var app=document.getElementById('app');
  app.innerHTML='<div class="card">'
    +'<b>欢迎使用圆桌观察端</b>'
    +'<div class="kv" style="margin-top:8px"><span class="k">①</span>已有账号：点右上角输入用户 token 连接</div>'
    +'<div class="kv"><span class="k">②</span>新用户：点「注册新用户」，注册即创建参与用户（可建桌、凭邀请码入席）</div>'
    +'</div>'
    +'<div class="card"><div class="row"><b>让 agent 接入本系统</b><span class="sp"></span><button id="introHelpMore">查看完整帮助</button></div>'
    +'<div class="hint" style="margin:6px 0">把下面的指令整体复制给你的 agent（zcode / claude / codex…），它会自动完成技能安装与用户注册，之后即可建桌或凭邀请码入席参会：</div>'
    +'<pre class="helpbox">'+esc(agentAccessText())+'</pre>'
    +'<div class="row"><button id="introAgentCopy" class="primary">复制 agent 接入指令</button>'
    +'<span class="dim">注册返回的 token（rtu_…）即本页登录凭证，让 agent 交给你后，粘贴到右上角即可连接</span></div></div>';
  document.getElementById('introAgentCopy').onclick=function(){ copyText(agentAccessText()); };
  document.getElementById('introHelpMore').onclick=openHelp;
}

/* ---------- 视图：桌列表 ---------- */
function loadList(){
  return api('GET','/api/observer/tables').then(function(d){ view.listTables=d.tables||[]; renderList(); })
    .catch(function(e){ toast(e.message); view.mode='intro'; renderIntro(); });
}
function renderList(){
  var app=document.getElementById('app');
  var admin=view.role==='systemadmin';
  var list=view.listTables.slice();
  if(view.listFilter==='active') list=list.filter(function(t){ return t.phase!=='closed'; });
  else if(view.listFilter==='closed') list=list.filter(function(t){ return t.phase==='closed'; });
  else if(view.listFilter==='mine') list=list.filter(function(t){ return !!t.mySeatRole; });

  var h='';
  if(admin) h+='<div class="banner admin">🛡 <b>全局观察模式</b> — 你正以系统观察员身份查看全部圆桌（非桌参与方视角；在本桌无席位时为只读观察）。</div>';
  var fb=function(id,lbl){ return '<button class="fbtn'+(view.listFilter===id?' on':'')+'" data-f="'+id+'">'+lbl+'</button>'; };
  h+='<div class="row" style="margin-bottom:12px"><b>圆桌列表</b><span class="dim">'+(admin?'全部 ':'我参与的 ')+view.listTables.length+' 桌</span>'
    +'<span class="fbar">'+fb('all','全部')+fb('active','进行中')+fb('closed','已结束')+(admin?fb('mine','我的桌'):'')+'</span>'
    +'<span class="sp"></span><button id="joinByCode">🎫 凭邀请码入桌</button><button id="createTable" class="primary">➕ 创建圆桌</button><button id="refreshList">刷新</button></div>';

  if(!view.listTables.length){
    h+='<div class="card dim">'+(admin
      ?'全服务器还没有圆桌。点右上「➕ 创建圆桌」建一张。'
      :'你还没有参与的圆桌。点右上「➕ 创建圆桌」建一张；收到邀请码可点「🎫 凭邀请码入桌」直接入席，或把「完整邀请」交给你的 agent 参会。')+'</div>';
  } else if(!list.length){
    h+='<div class="card dim">'+((view.listFilter==='mine'&&admin)?'筛选「我的桌」无结果：你还没有在任何圆桌持有席位（可创建圆桌或凭邀请码入席）。':'该筛选下暂无圆桌。')+'</div>';
  }
  h+='<div class="tables">';
  list.forEach(function(t){
    h+='<div class="card tcard" data-tid="'+esc(t.tableId)+'">'
      +'<div class="row"><b>'+esc(t.topic)+'</b>'+phaseBadge(t.phase,0)+'</div>'
      +(t.mySeatRole?'<div style="margin-top:6px">'+roleBadge(t.mySeatRole)+' <span class="dim">我的席位'+(t.mySeatName?'：'+esc(t.mySeatName):'')+'</span></div>':'')
      +'<div class="dim" style="margin-top:6px">'+esc(t.tableId)+' · '+t.seatCount+' 席 · 创建于 '+fmtTs(t.createdAt)+'</div>'
      +'</div>';
  });
  h+='</div>';
  /* 帮助速览（列表页底部）：主帮助信息 + 完整帮助/复制接入指令入口 */
  h+='<div class="card"><div class="row"><b>帮助速览</b><span class="sp"></span>'
    +'<button id="footAgentCopy">复制 agent 接入指令</button><button id="footHelpMore">查看完整帮助</button></div>'
    +'<div class="kv" style="margin-top:6px"><span class="k">开桌</span>创建圆桌（自动成为提案方）→ 复制「完整邀请」发给参与方（对方 agent 凭邀请码自动入席）→ 各席完成入桌设定，全员就绪后建桌人点「开始会议」。</div>'
    +'<div class="kv"><span class="k">接入</span>agent 先装圆桌技能（读取 '+esc(location.origin)+'/skill.md 自装），再注册用户（POST /api/users，返回 rtu_ token 即登录凭证）。</div>'
    +'<div class="kv"><span class="k">介入</span>桌详情可发人工指令（可定向某席）、轮到本席时可人工代答、可上传投屏资料（共享=全桌可读）、可恢复 / 替代 agent 凭证。</div></div>';
  app.innerHTML=h;
  app.querySelectorAll('.tcard').forEach(function(el){ el.onclick=function(){ openTable(el.getAttribute('data-tid')); }; });
  app.querySelectorAll('.fbtn').forEach(function(b){ b.onclick=function(){ view.listFilter=b.getAttribute('data-f'); renderList(); }; });
  document.getElementById('joinByCode').onclick=renderJoinForm;
  document.getElementById('createTable').onclick=renderCreateForm;
  document.getElementById('refreshList').onclick=loadList;
  document.getElementById('footAgentCopy').onclick=function(){ copyText(agentAccessText()); };
  document.getElementById('footHelpMore').onclick=openHelp;
}

/* ---------- 视图：管理台（systemadmin） ---------- */
var adminIssuedToken=null; // 重签结果的一次性展示区（刷新即隐藏）
function openAdmin(){
  view.mode='admin'; view.tableId=null; view.dirtyPanel=false;
  clearInterval(view.timer);
  var app=document.getElementById('app');
  app.innerHTML='<div class="card dim">加载用户…</div>';
  api('GET','/api/admin/users').then(renderAdminUsers)
    .catch(function(e){ toast(e.message); openList(); });
}
function renderAdminUsers(d){
  var app=document.getElementById('app');
  var users=d.users||[];
  var h='<div class="row" style="margin-bottom:12px"><span class="back" id="admBack">← 返回列表</span><span class="sp"></span><b>🛡 管理台 · 用户</b><span class="dim">'+users.length+' 个用户</span><button id="admRefresh">刷新</button></div>';
  h+='<div class="hint" style="margin-bottom:10px">授予/撤销管理员与禁用/启用均即时生效并写入审计；禁用 = 该用户 token 立即失效（agent 席位不受影响），可随时恢复。服务端只存 token 哈希、原始 token 不可取回：要把某用户接入浏览器登录，用「重签token」生成新登录 token（旧的立即失效，新 token 只显示这一次）。</div>';
  if(adminIssuedToken){
    h+='<div class="card" style="margin-bottom:10px;border:1px solid #d90429">'
      +'<b>🔑 新登录 token · '+esc(adminIssuedToken.name)+'</b>（只显示这一次，刷新后不可再查）'
      +'<div class="row" style="margin:8px 0"><input id="admNewToken" readonly value="'+escAttr(adminIssuedToken.token)+'" style="flex:1;min-width:260px">'
      +'<button class="primary" id="admCopyToken">复制 token</button></div>'
      +'<div class="hint">已复制即可粘贴到右上角登录框连接（浏览器 token 登录用它，不是 userId）；旧 token 已失效。</div></div>';
    adminIssuedToken=null;
  }
  h+='<div class="card" style="overflow:auto"><table><tr><th>用户名</th><th>userId</th><th>角色</th><th>状态</th><th>注册</th><th>参桌</th><th>操作</th></tr>';
  users.forEach(function(u){
    var isSelf=u.userId===view.userId;
    h+='<tr><td><b>'+esc(u.name)+'</b>'+(isSelf?' <span class="badge">我</span>':'')+'</td>'
      +'<td class="dim">'+esc(u.userId)+' <button class="admCopyId" data-uid="'+escAttr(u.userId)+'">复制</button></td>'
      +'<td>'+(u.role==='systemadmin'?'<span class="wbadge admin">🛡 系统观察员</span>':'<span class="wbadge user">参与用户</span>')+'</td>'
      +'<td><span class="badge '+(u.disabled?'err':'ok')+'">'+(u.disabled?'已禁用':'正常')+'</span></td>'
      +'<td class="dim">'+fmtTs(u.createdAt)+'</td>'
      +'<td>'+u.seatCount+' <span class="dim">桌</span></td>'
      +'<td><button class="admSeats" data-uid="'+escAttr(u.userId)+'" data-name="'+escAttr(u.name)+'">参桌</button> '
      +'<button class="admRole" data-uid="'+escAttr(u.userId)+'" data-name="'+escAttr(u.name)+'" data-to="'+(u.role==='systemadmin'?'user':'systemadmin')+'">'+(u.role==='systemadmin'?'撤销管理员':'设为管理员')+'</button> '
      +'<button class="admDis" data-uid="'+escAttr(u.userId)+'" data-name="'+escAttr(u.name)+'" data-to="'+(u.disabled?'enable':'disable')+'">'+(u.disabled?'启用':'禁用')+'</button> '
      +'<button class="admToken" data-uid="'+escAttr(u.userId)+'" data-name="'+escAttr(u.name)+'">重签token</button></td></tr>';
  });
  h+='</table></div>';
  app.innerHTML=h;
  document.getElementById('admBack').onclick=openList;
  document.getElementById('admRefresh').onclick=openAdmin;
  var ct=document.getElementById('admCopyToken');
  if(ct){ ct.onclick=function(){ var inp=document.getElementById('admNewToken'); inp.select(); copyText(inp.value); }; }
  app.querySelectorAll('button.admCopyId').forEach(function(b){
    b.onclick=function(){ copyText(b.getAttribute('data-uid')); };
  });
  app.querySelectorAll('button.admToken').forEach(function(b){
    b.onclick=function(){
      var uid=b.getAttribute('data-uid'), name=b.getAttribute('data-name');
      if(!confirm('为「'+name+'」重签登录 token？\n原 token 立即失效（其浏览器已登录会话不受影响，agent 席位 token 不受影响），新 token 只显示一次。')) return;
      api('POST','/api/admin/users/'+encodeURIComponent(uid)+'/token').then(function(r){
        adminIssuedToken=r;
        api('GET','/api/admin/users').then(renderAdminUsers);
      })
      .catch(function(e){ toast('失败：'+e.message); });
    };
  });
  app.querySelectorAll('button.admSeats').forEach(function(b){
    b.onclick=function(){ openAdminUserTables(b.getAttribute('data-uid'),b.getAttribute('data-name')); };
  });
  app.querySelectorAll('button.admRole').forEach(function(b){
    b.onclick=function(){
      var uid=b.getAttribute('data-uid'), name=b.getAttribute('data-name'), to=b.getAttribute('data-to');
      var msg=to==='systemadmin'
        ?('授予「'+name+'」系统观察员身份？授予后可看所有圆桌并使用管理台。')
        :(uid===view.userId
          ?'你正在撤销【自己的】管理员身份，撤销后失去管理台入口（需其他管理员恢复）。确定？'
          :'撤销「'+name+'」的系统观察员身份？');
      if(!confirm(msg)) return;
      api('POST','/api/admin/users/'+uid+'/role',{role:to}).then(openAdmin)
        .catch(function(e){ toast('失败：'+e.message); });
    };
  });
  app.querySelectorAll('button.admDis').forEach(function(b){
    b.onclick=function(){
      var uid=b.getAttribute('data-uid'), name=b.getAttribute('data-name'), to=b.getAttribute('data-to');
      if(to==='disable'&&!confirm('禁用「'+name+'」？其 token 立即失效（agent 席位不受影响），可随时启用恢复。')) return;
      api('POST','/api/admin/users/'+uid+'/disabled',{disabled:to==='disable'}).then(openAdmin)
        .catch(function(e){ toast('失败：'+e.message); });
    };
  });
}
function openAdminUserTables(uid,name){
  var app=document.getElementById('app');
  app.innerHTML='<div class="card dim">加载「'+esc(name)+'」的参桌…</div>';
  api('GET','/api/admin/users/'+encodeURIComponent(uid)+'/tables').then(function(d){
    var list=d.tables||[];
    var h='<div class="row" style="margin-bottom:12px"><span class="back" id="autBack">← 返回用户管理</span><span class="sp"></span><b>参桌明细 · '+esc(name)+'</b><span class="dim">'+list.length+' 席</span></div>';
    if(!list.length) h+='<div class="card dim">该用户没有任何席位（未建桌也未入席）。</div>';
    h+='<div class="card" style="overflow:auto"><table><tr><th>圆桌</th><th>阶段</th><th>席位名</th><th>角色</th><th>席位状态</th><th>就绪</th><th></th></tr>';
    list.forEach(function(r){
      h+='<tr><td>'+esc(r.topic)+'<div class="dim">'+esc(r.tableId)+'</div></td>'
        +'<td>'+phaseBadge(r.phase,0)+'</td>'
        +'<td>'+esc(r.seatName)+'</td>'
        +'<td>'+roleBadge(r.role)+'</td>'
        +'<td><span class="badge '+(r.status==='active'?'ok':'warn')+'">'+esc(r.status)+'</span></td>'
        +'<td>'+(r.ready?'✅':'—')+'</td>'
        +'<td><button class="autGo" data-tid="'+escAttr(r.tableId)+'">进入圆桌</button></td></tr>';
    });
    h+='</table></div>';
    app.innerHTML=h;
    document.getElementById('autBack').onclick=openAdmin;
    app.querySelectorAll('button.autGo').forEach(function(b){ b.onclick=function(){ openTable(b.getAttribute('data-tid')); }; });
  })
  .catch(function(e){ toast(e.message); openAdmin(); });
}

/* ---------- 视图：创建圆桌 ---------- */
function renderCreateForm(){
  var app=document.getElementById('app');
  var h='<div class="row" style="margin-bottom:12px"><span class="back" id="ctBackList">← 返回列表</span><span class="sp"></span><b>创建圆桌</b><span class="dim" id="ctModeHint">你将自动成为提案方（proposer）席位</span></div>';
  h+='<div class="card frm">'
    +'<h4>基本信息</h4>'
    +'<div class="frow"><label class="t">建桌模式</label><div class="row">'
    +'<label style="font-size:13px"><input type="radio" name="ctMode" value="self" checked> 各方自行建桌 — 我自动成为提案方，直接参会</label>'
    +'<label style="font-size:13px"><input type="radio" name="ctMode" value="hosted"> 主持人建桌 — 我只负责建桌/定规则/传文档/邀请与调度，不参与评审协作；各方提交过 DeepSeek 预审</label></div>'
    +'<div class="hint" id="ctModeTip">主持人模式需服务器配置 DEEPSEEK_API_KEY（未配置时预审自动跳过放行）</div></div>'
    +'<div class="frow"><label class="t" for="ctTopic">主题 <b>*</b></label><input id="ctTopic" placeholder="如「v2 接口文档评审」"><div class="hint">一句话说清这桌评什么/协作什么</div></div>'
    +'<div class="frow"><label class="t" for="ctGoals">目标共识</label><input id="ctGoals" placeholder="本次要达成什么（可选）"><div class="hint">会议结束时希望各方同意的结论</div></div>'
    +'<div class="frow"><label class="t" for="ctDeliverables">期望交付物</label><input id="ctDeliverables" placeholder="如「修订后的 api.md」（可选）"></div>'
    +'<h4>桌规则与角色安排</h4>'
    +'<div class="frow"><label class="t" for="ctRules">桌规则</label><textarea id="ctRules" placeholder="供各方 agent 阅读遵守，如「逐条审阅」「意见须给出理由」（可选）"></textarea></div>'
    +'<div class="frow"><label class="t" for="ctRolePlan">角色安排说明</label><textarea id="ctRolePlan" placeholder="对各参与方职责的补充描述，随邀请码发给各方（可选）"></textarea></div>'
    +'<h4 id="ctSeatTitle">我的席位（自动成为提案方）</h4>'
    +'<div class="frow"><label class="t" for="ctSeatName">席位名 <b>*</b></label><input id="ctSeatName"'+(view.userName?' value="'+esc(view.userName)+'"':' placeholder="你的显示名"')+'></div>'
    +'<div class="frow"><label class="t" for="ctAgent">agent 标识（选填）</label><input id="ctAgent" placeholder="如 zcode / claude；留空 = human-only（先由人工参与，agent 后续接入）"></div>'
    +'<h4>高级参数（留空用默认）</h4>'
    +'<div class="row"><div class="frow" style="flex:1"><label class="t" for="ctRounds">评审轮次上限（默认 2）</label><input id="ctRounds" type="number" min="1" max="10"></div>'
    +'<div class="frow" style="flex:1"><label class="t" for="ctTurnSec">发言超时秒（默认 300）</label><input id="ctTurnSec" type="number" min="30"></div></div>'
    +'<div class="ferr" id="ctErr"></div>'
    +'<div class="row" style="margin-top:10px"><button id="ctCancel">取消</button><span class="sp"></span><button id="ctSubmit" class="primary">创建</button></div>'
    +'</div>';
  app.innerHTML=h;
  function ctMode(){ var r=document.querySelector('input[name="ctMode"]:checked'); return r?r.value:'self'; }
  function syncMode(){
    var hosted=ctMode()==='hosted';
    document.getElementById('ctModeHint').textContent=hosted?'你将成为主持人（host）：只管建桌/规则/资料/邀请与调度，不参与评审协作':'你将自动成为提案方（proposer）席位';
    document.getElementById('ctSeatTitle').textContent=hosted?'我的席位（自动成为主持人）':'我的席位（自动成为提案方）';
    document.getElementById('ctModeTip').style.display=hosted?'':'none';
  }
  document.querySelectorAll('input[name="ctMode"]').forEach(function(r){ r.onchange=syncMode; });
  syncMode();
  document.getElementById('ctBackList').onclick=loadList;
  document.getElementById('ctCancel').onclick=loadList;
  document.getElementById('ctSubmit').onclick=function(){
    var topic=document.getElementById('ctTopic').value.trim();
    var seatName0=document.getElementById('ctSeatName').value.trim();
    var err=document.getElementById('ctErr'); err.textContent='';
    if(!topic){ err.textContent='主题必填'; return; }
    if(!seatName0){ err.textContent='席位名必填'; return; }
    var body={ topic:topic, owner:{ seatName:seatName0, agentLabel:document.getElementById('ctAgent').value.trim()||'human-only' } };
    if(ctMode()==='hosted') body.mode='hosted';
    var goals=document.getElementById('ctGoals').value.trim(); if(goals) body.goals=goals;
    var del=document.getElementById('ctDeliverables').value.trim(); if(del) body.deliverables=del;
    var rules=document.getElementById('ctRules').value.trim(); if(rules) body.rules=rules;
    var rp=document.getElementById('ctRolePlan').value.trim(); if(rp) body.rolePlan=rp;
    var rounds=parseInt(document.getElementById('ctRounds').value,10); if(rounds>=1&&rounds<=10) body.maxReviewRounds=rounds;
    var turnSec=parseInt(document.getElementById('ctTurnSec').value,10); if(turnSec>=30) body.turnTimeoutMs=turnSec*1000;
    var btn=document.getElementById('ctSubmit'); btn.disabled=true; btn.textContent='创建中…';
    api('POST','/api/tables',body).then(function(r){ renderCreateResult(r,topic,ctMode()==='hosted'); })
      .catch(function(e){ btn.disabled=false; btn.textContent='创建'; err.textContent='创建失败：'+e.message; });
  };
}

function renderCreateResult(d,topic,hosted){
  var app=document.getElementById('app');
  var h='<div class="row" style="margin-bottom:12px"><b>圆桌已创建</b><span class="badge phase">设定中 · 等待入席与设定</span>'+(hosted?'<span class="rb host">主持人模式</span>':'')+'</div>';
  h+='<div class="card"><b>'+esc(d.tableId)+'</b>'
    +'<h3>席位 token（只显示这一次，请立即复制）</h3>'
    +'<div class="row"><span class="invite" style="word-break:break-all;font-size:15px">'+esc(d.ownerSeatToken)+'</span><span class="sp"></span><button id="credTokCopy">复制凭证（含入桌信息）</button></div>'
    +'<div class="dim" style="margin-top:4px">点「复制凭证」带走完整入桌信息（服务器地址 / 圆桌 ID / token 与 .roundtable 配置写法）'+(hosted?'。主持人一般在网页端操作，无需把凭证交给 agent':'，整体发给你的 agent 即可参会')+'。关闭本页后无法再查看。</div>'
    +'<h3>邀请码（发给各参与方，角色由码定死）</h3>';
  var RL={proposer:'提案方',reviewer:'评审方',observer:'观察方'};
  d.inviteCodes.forEach(function(c){
    h+='<div class="row" style="margin:4px 0"><span class="rb '+esc(c.role)+'">'+esc(RL[c.role]||c.role)+'</span>'
      +'<span class="invite">'+esc(c.code)+'</span><button class="cpInv" data-code="'+esc(c.code)+'" data-role="'+esc(c.role)+'">复制完整邀请</button>'
      +(c.role==='observer'?'<span class="dim">观察方：只读旁听无表决权</span>':'<span class="dim">复制内容含服务器/圆桌 ID/邀请码，整体转发即可参会</span>')+'</div>';
  });
  h+='<h3>下一步</h3><div class="dim">'
    +(hosted
      ?'主持人流程：定规则（详情页「桌设定」可随时改）→ 传资料（详情页上传共享文档，全桌可见）→ 把邀请码发给提案方/评审方/观察方 → 各方完成入桌设定 → 你在详情页点「开始会议」。开始后各方每回合提交由 DeepSeek 预审，需要补充时会被点名。'
      :'进入圆桌详情完成你的入桌设定（立场/范围/数据范围/就绪），参与方凭完整邀请入席设定后，全员就绪即可在详情页一键开始会议。')
    +'</div>'
    +'<div class="row" style="margin-top:8px"><button id="ctBack">返回列表</button><span class="sp"></span><button id="ctEnter" class="primary">进入圆桌</button></div>'
    +'</div>';
  app.innerHTML=h;
  document.getElementById('credTokCopy').onclick=function(){
    copyText(seatTokenText(topic||'',d.tableId,d.ownerSeatToken)); toast('完整凭证已复制（含服务器/圆桌ID/token）');
  };
  app.querySelectorAll('button.cpInv').forEach(function(b){
    b.onclick=function(){
      copyText(inviteText(topic||'',d.tableId,b.getAttribute('data-code'),b.getAttribute('data-role'),null));
      toast('完整邀请已复制（含服务器/圆桌ID/邀请码）');
    };
  });
  document.getElementById('ctBack').onclick=loadList;
  document.getElementById('ctEnter').onclick=function(){ openTable(d.tableId); };
}

/* ---------- 视图：凭邀请码入桌 ---------- */
function renderJoinForm(){
  var app=document.getElementById('app');
  var h='<div class="row" style="margin-bottom:12px"><span class="back" id="jbBackList">← 返回列表</span><span class="sp"></span><b>凭邀请码入桌</b><span class="dim">角色由邀请码定死（评审方/观察方），席位不能自封</span></div>';
  h+='<div class="card frm">'
    +'<div class="frow"><label class="t" for="jbCode">邀请码 <b>*</b></label><textarea id="jbCode" placeholder="粘贴 10 位邀请码，或整段粘贴收到的「完整邀请」文本"></textarea><div class="hint">先查码确认所属圆桌，再确认入席；查询不消耗码次数</div></div>'
    +'<div class="frow"><label class="t" for="jbSeatName">席位名 <b>*</b></label><input id="jbSeatName"'+(view.userName?' value="'+esc(view.userName)+'"':' placeholder="你的显示名"')+'></div>'
    +'<div class="frow"><label class="t" for="jbAgent">agent 标识（选填）</label><input id="jbAgent" placeholder="如 zcode / claude；留空 = human-only（先由人工参与，agent 后续接入）"></div>'
    +'<div class="ferr" id="jbErr"></div>'
    +'<div id="jbPreview"></div>'
    +'<div class="row" style="margin-top:10px"><button id="jbCancel">取消</button><span class="sp"></span><button id="jbCheck" class="primary">查询邀请码</button></div>'
    +'</div>';
  app.innerHTML=h;
  document.getElementById('jbBackList').onclick=loadList;
  document.getElementById('jbCancel').onclick=loadList;
  document.getElementById('jbCheck').onclick=function(){
    var err=document.getElementById('jbErr'); err.textContent='';
    document.getElementById('jbPreview').innerHTML='';
    var raw=document.getElementById('jbCode').value.trim();
    if(!raw){ err.textContent='请输入邀请码（或整段粘贴完整邀请文本）'; return; }
    var btn=document.getElementById('jbCheck'); btn.disabled=true; btn.textContent='查询中…';
    api('POST','/api/invites/preview',{code:raw}).then(function(p){
      btn.disabled=false; btn.textContent='查询邀请码';
      renderJoinPreview(p);
    }).catch(function(e){ btn.disabled=false; btn.textContent='查询邀请码'; err.textContent='查询失败：'+e.message; });
  };
}
/* 查询结果三分支：已持有席位 → 引导进桌；会议已开始 → 拒入提示；正常 → 确认入席 */
function renderJoinPreview(p){
  var box=document.getElementById('jbPreview');
  var h='<div class="card" style="margin-top:10px;border:1px dashed var(--line)">'
    +'<div class="row"><b>'+esc(p.topic)+'</b>'+phaseBadge(p.phase,0)+roleBadge(p.role)+'</div>'
    +'<div class="dim" style="margin-top:6px">'+esc(p.tableId)+' · '+p.seatCount+' 席 · 码剩余 '+p.usesLeft+' 次 · 有效期至 '+fmtTs(p.expiresAt)+'</div>';
  if(p.mySeat){
    h+='<div class="hint" style="margin-top:8px">你已在本桌持有席位「'+esc(p.mySeat.name)+'」，无需重复入席。</div>'
      +'<div class="row" style="margin-top:8px"><button id="jbGo" class="primary">进入圆桌</button></div>';
  } else if(p.phase!=='open'){
    h+='<div class="hint" style="margin-top:8px">本桌会议已开始，不再接受凭码入席。</div>';
  } else {
    h+='<div class="hint" style="margin-top:8px">确认入席后，将以「上方席位名」加入本桌，角色为'+esc(ROLE_LABEL[p.role]||p.role)+'（由邀请码定死）。</div>'
      +'<div class="row" style="margin-top:8px"><button id="jbJoin" class="primary">确认入席</button></div>';
  }
  h+='</div>';
  box.innerHTML=h;
  var go=document.getElementById('jbGo'); if(go) go.onclick=function(){ openTable(p.tableId); };
  var jb=document.getElementById('jbJoin');
  if(jb) jb.onclick=function(){
    var err=document.getElementById('jbErr'); err.textContent='';
    var name=document.getElementById('jbSeatName').value.trim();
    if(!name){ err.textContent='席位名必填'; return; }
    jb.disabled=true; jb.textContent='入席中…';
    api('POST','/api/tables/'+encodeURIComponent(p.tableId)+'/seats',{
      inviteCode:p.code, seatName:name, role:p.role,
      agentLabel:document.getElementById('jbAgent').value.trim()||'human-only'
    }).then(function(r){ renderJoinResult(p,r); })
    .catch(function(e){ jb.disabled=false; jb.textContent='确认入席'; err.textContent='入席失败：'+e.message; });
  };
}
function renderJoinResult(p,r){
  var app=document.getElementById('app');
  var h='<div class="row" style="margin-bottom:12px"><b>已入席</b>'+roleBadge(r.seat.role)+'<span class="badge phase">入桌设定待完成</span></div>';
  h+='<div class="card"><b>'+esc(p.topic)+'</b>'
    +'<h3>席位 token（只显示这一次，请立即复制）</h3>'
    +'<div class="row"><span class="invite" style="word-break:break-all;font-size:15px">'+esc(r.token)+'</span><span class="sp"></span><button id="jrTokCopy">复制凭证（含入桌信息）</button></div>'
    +'<div class="dim" style="margin-top:4px">点「复制凭证」带走完整入桌信息（服务器地址 / 圆桌 ID / token 与 .roundtable 配置写法），交给你的 agent 即可代你参会。关闭本页后无法再查看；之后可在桌详情页随时「重签凭证」。</div>'
    +'<h3>下一步</h3><div class="dim">进入圆桌详情完成入桌设定（立场/范围/数据范围/就绪）；全员就绪后建桌人即可开始会议。</div>'
    +'<div class="row" style="margin-top:8px"><button id="jrBack">返回列表</button><span class="sp"></span><button id="jrEnter" class="primary">进入圆桌</button></div>'
    +'</div>';
  app.innerHTML=h;
  document.getElementById('jrTokCopy').onclick=function(){
    copyText(seatTokenText(p.topic,p.tableId,r.token,r.seat.role)); toast('完整凭证已复制（含服务器/圆桌ID/token）');
  };
  document.getElementById('jrBack').onclick=loadList;
  document.getElementById('jrEnter').onclick=function(){ openTable(p.tableId); };
}

/* ---------- 视图：桌详情 ---------- */
function stepsHtml(phase){
  if(phase==='human_intervention'){
    return '<div class="banner admin" style="border-color:var(--err);color:var(--err);background:rgba(224,92,92,.08)">⚠ 人工介入模式：会议暂停，等待 HUMAN_INPUT / HUMAN_RULING 推进或裁决</div>';
  }
  var idx=-1;
  for(var i=0;i<STEP_DEFS.length;i++){ if(STEP_DEFS[i][0]===phase) idx=i; }
  var h='<div class="steps">';
  STEP_DEFS.forEach(function(s,i){
    var cls=(i<idx)?'done':(i===idx?'cur':'');
    h+='<div class="step '+cls+'"><div class="bar"></div><div>'+s[1]+'</div></div>';
  });
  return h+'</div>';
}

function renderDetail(d){
  var t=d.table, seats=(t.seats||[]).filter(function(s){ return s.status!=='left'; });
  var mySeat=null, i;
  if(d.mySeatId){ for(i=0;i<seats.length;i++){ if(seats[i].seatId===d.mySeatId) mySeat=seats[i]; } }
  var admin=view.role==='systemadmin';

  var h='<div class="row"><span class="back" id="back">← 返回列表</span><span class="sp"></span><span class="dim">自动刷新中</span></div>';

  /* 身份视角条：systemadmin 无席位只读观察（普通用户无席位已被服务端 403 拦在列表外） */
  if(!mySeat && admin){
    h+='<div class="banner admin">🛡 系统观察员 · 只读观察 — 你在本桌没有席位，仅查看（详情/历史/纪要），不能发指令或代答。</div>';
  }

  h+='<div class="card"><div class="row"><b style="font-size:16px">'+esc(t.topic)+'</b>'
    +phaseBadge(t.phase,t.roundNo)
    +(t.mode==='hosted'?'<span class="rb host">主持人模式 · 预审调度</span>':'')
    +(t.deadlockCount>0?'<span class="badge err">僵局 '+t.deadlockCount+'</span>':'')
    +'</div>';
  if(d.meta.goals) h+='<div class="dim" style="margin-top:4px">目标：'+esc(d.meta.goals)+'</div>';
  if(d.meta.deliverables) h+='<div class="dim">交付物：'+esc(d.meta.deliverables)+'</div>';
  if(d.meta.rules) h+='<div class="dim">规则：'+esc(d.meta.rules)+'</div>';
  h+=stepsHtml(t.phase);
  h+='</div>';

  var turn=t.activeTurn;
  /* 圆桌示意图：席位环绕 + 最后交付摘要 + 发言权思考中标记（>8 席折叠） */
  h+=roundDiagramHtml(d,seats,turn);

  /* 管理员操作卡（systemadmin 专属：强制介入/闭桌/删桌，动作审计留痕） */
  if(admin){
    var active=t.phase!=='closed';
    h+='<div class="card" style="border-color:var(--goldline)"><div class="row"><b>🛡 管理员操作</b><span class="dim">系统观察员专属 · 全部动作写入审计</span></div>'
      +'<div class="row" style="margin-top:8px"><input id="admReason" placeholder="原因（进入会议记录 / 审计）" style="flex:1;min-width:200px">'
      +(active&&t.phase!=='human_intervention'?'<button id="admHuman">⏸ 强制人工介入</button>':'')
      +(active?'<button id="admClose">⛔ 强制闭桌</button>':'')
      +'<button id="admDel" style="color:var(--err);border-color:var(--err)">🗑 删除圆桌</button></div>'
      +'<div class="hint" style="margin-top:6px">强制闭桌 = 立即生成纪要并结束（不可恢复）；删除 = 连同消息/产物/席位全部清除（轮询中的 agent 将收到 404）。</div></div>';
  }

  h+='<div class="card"><div class="section turn" style="margin-top:0"><b>下一步动作</b><div>';
  if(t.mode==='hosted'&&t.precheck){
    if(t.precheck.state==='reviewing') h+='<div class="badge warn">🔍 预审中</div> <span class="dim">DeepSeek 正在预审刚提交的回合结果，预审落地前不授出发言权</span>';
    else if(t.precheck.state==='directive') h+='<div class="badge warn">🎯 预审点名</div> <span class="dim">等待 <b>'+esc(seatName(seats,t.precheck.toSeat))+'</b> 按预审意见补充并以 SUPPLEMENT 提交</span><br>';
  }
  if(turn){
    h+='发言权：<b>'+esc(seatName(seats,turn.seatId))+'</b> —— '+esc(turn.taskHint||'');
    if(turn.pendingRequest) h+='<div class="dim">待处理请求：'+esc(turn.pendingRequest.title)+'</div>';
  } else if(t.phase==='closed'){ h+='<span class="badge ok">会议已结束</span>'+(d.minutes?'<span class="dim">纪要已生成（见下方纪要区）</span>':''); }
  else if(t.phase==='human_intervention'){ h+='<span class="dim">等待人工介入（可在下方以席位身份发送 HUMAN_INPUT / HUMAN_RULING）</span>'; }
  else { h+='<span class="dim">当前无发言权持有者（等待事件推进或人工介入）</span>'; }
  h+='</div></div></div>';

  /* ---- 我的席位面板：按阶段/状态条件渲染 ---- */
  if(mySeat){
    var cfg=mySeat.config||{};
    var isOwner=t.ownerSeat===mySeat.seatId;
    var isHost=mySeat.role==='host';
    h+='<div class="card mine"><div class="row"><b>我的席位</b><b>'+esc(mySeat.name)+'</b>'
      +roleBadge(mySeat.role)
      +(isOwner?'<span class="badge">建桌人</span>':'')
      +(isHost?'':'<span class="badge '+(cfg.ready?'ok':'warn')+'">'+(cfg.ready?'已就绪':'未就绪')+'</span>')
      +'<span class="dim">agent: '+esc(mySeat.agentLabel)+'</span></div>';

    if(t.phase==='open'){
      /* 设定阶段：设定表单 / 摘要 + 建桌人开始按钮（无代答环节——代答自会议开始起才有） */
      var allReady=seats.filter(function(s){ return s.role!=='host'; }).every(function(s){ return s.config&&s.config.ready; });
      var rolesOk=seats.some(function(s){ return s.role==='proposer'; })&&seats.some(function(s){ return s.role==='reviewer'; });

      if(isHost){
        /* 主持人：不做入桌设定，管桌设定（定规则）+ 就绪名单 + 开始 */
        h+='<div class="section"><h3>桌设定（主持人 · 定规则）</h3>'
          +'<div class="frow"><label class="t">主题</label><input id="tcTopic" value="'+escAttr(t.topic||'')+'"></div>'
          +'<div class="frow"><label class="t">目标共识</label><input id="tcGoals" value="'+escAttr(t.goals||'')+'"></div>'
          +'<div class="frow"><label class="t">期望交付物</label><input id="tcDeliverables" value="'+escAttr(t.deliverables||'')+'"></div>'
          +'<div class="frow"><label class="t">桌规则</label><textarea id="tcRules" placeholder="供各方 agent 阅读遵守，如「逐条审阅」「意见须给出理由」">'+esc(t.rules||'')+'</textarea></div>'
          +'<div class="frow"><label class="t">角色安排说明</label><textarea id="tcRolePlan">'+esc((d.meta&&d.meta.rolePlan)||'')+'</textarea></div>'
          +'<div class="ferr" id="tcErr"></div>'
          +'<div class="row"><button id="tcSave" class="primary">保存桌设定</button><span class="dim">仅设定阶段可改；资料文档在下方「资料文档」区上传（选共享，全桌可见）</span></div></div>';
      } else if(!cfg.ready||view.cfgEditing){
        h+='<div class="section"><h3>'+(cfg.ready?'修改入桌设定':'入桌设定')+'</h3>'
          +'<div class="frow"><label class="t">立场</label>'
          +'<div class="row"><select id="cfgPreset"><option value="">（选择立场预设…）</option></select>'
          +'<input id="cfgSup" placeholder="立场补充说明（附加在预设文本后，可选）" style="flex:1"></div>'
          +'<textarea id="cfgStance" placeholder="立场声明全文（选预设自动填入可再改；保存必填）">'+esc(cfg.stance||'')+'</textarea></div>'
          +'<div class="frow"><label class="t">讨论范围</label>'
          +'<input id="cfgScope" value="'+escAttr(cfg.scope||'')+'" placeholder="只讨论…／不讨论…（一句话）">'
          +'<div class="row" style="margin-top:4px">'+SCOPE_PRESETS.map(function(p){ return '<button class="preset" data-scope="'+escAttr(p)+'">'+esc(p)+'</button>'; }).join('')+'</div></div>'
          +'<div class="frow"><label class="t">数据范围（目录/文档/产物，逐条添加）</label>'
          +'<div class="chips" id="dsWrap"><span id="dsChips"></span><input id="dsIn" placeholder="输入路径后回车添加，如 docs/api/"></div>'
          +'<div class="row" style="margin-top:4px">'+DS_PRESETS.map(function(p){ return '<button class="preset" data-ds="'+escAttr(p)+'">'+esc(p)+'</button>'; }).join('')+'<span class="dim">这些路径以外的内容默认不在本次讨论的数据范围内</span></div></div>'
          +'<div class="frow"><label style="font-size:13px"><input type="checkbox" id="cfgReady"'+(cfg.ready?' checked':'')+'> 就绪 — 声明本席设定完成（全员就绪后建桌人可开始会议）</label></div>'
          +'<div class="ferr" id="cfgErr"></div>'
          +'<div class="row"><button id="cfgSave" class="primary">保存设定</button>'
          +(cfg.ready?'<button id="cfgCollapse">收起（保留现设定）</button>':'')
          +'<span class="dim">保存后可再修改，开始会议后设定锁定</span></div></div>';
      } else {
        h+='<div class="section"><h3>当前设定 <span class="dim">（已就绪，开始会议前可修改）</span></h3><div class="sumcard">'
          +'<div class="kv"><span class="k">立场</span>'+esc(cfg.stance||'')+'</div>'
          +'<div class="kv"><span class="k">讨论范围</span>'+esc(cfg.scope||'（未填写）')+'</div>'
          +'<div class="kv"><span class="k">数据范围</span>'+((cfg.dataScope||[]).length?cfg.dataScope.map(function(x){ return '<span class="chip">'+esc(x)+'</span>'; }).join(' '):'<span class="dim">（未填写）</span>')+'</div>'
          +'</div><button id="cfgEdit">修改设定</button></div>';
      }

      /* 建桌人：就绪名单 + 开始会议 */
      if(isOwner){
        h+='<div class="section sumcard"><h3 style="margin-top:0">开局状态（建桌人）</h3>';
        seats.forEach(function(s){
          if(s.role==='host'){ h+='<div class="kv">'+esc(s.name)+' '+roleBadge(s.role)+' <span class="badge">主持人 · 豁免就绪</span></div>'; }
          else h+='<div class="kv">'+esc(s.name)+' '+roleBadge(s.role)+' <span class="badge '+((s.config&&s.config.ready)?'ok':'warn')+'">'+((s.config&&s.config.ready)?'已就绪':'未就绪')+'</span></div>';
        });
        if(!rolesOk) h+='<div class="ferr">角色不齐备：还需提案方/评审方席位凭邀请码入席。</div>';
        else if(!allReady) h+='<div class="ferr">尚有席位未就绪，各方就绪后才能开始。</div>';
        h+='<div class="row" style="margin-top:8px"><button id="stStart" class="primary"'+((allReady&&rolesOk)?'':' disabled')+'>▶ 开始会议</button>'
          +'<span class="dim">开始后进入提案陈述阶段'+(t.mode==='hosted'?'，各方每回合提交将由 DeepSeek 预审':'')+'，席位设定锁定</span></div><div class="ferr" id="stErr"></div></div>';
      } else if(cfg.ready){
        h+='<div class="section dim">已就绪，等待建桌人开始会议。</div>';
      }
    } else if(t.phase==='closed'){
      h+='<div class="section dim">会议已结束：纪要在下方「会议纪要」区。</div>';
    } else {
      /* 会议进行中：仅持发言权时出现代答表单（设定阶段不出现代答） */
      if(turn&&turn.seatId===d.mySeatId){
        h+='<div class="section"><h3>替我回答本轮（人工代答）</h3><div class="dim">'+esc(turn.taskHint||'')+'</div>'
          +'<div class="row" style="margin-top:6px"><select id="pxType"></select>'
          +'<select id="pxDecision" style="display:none"></select>'
          +'<select id="pxSeverity" style="display:none"><option>must</option><option selected>should</option><option>nice</option></select>'
          +'<input id="pxTarget" placeholder="位置（如 第3节）" style="display:none;width:140px">'
          +'<label style="font-size:12px"><input type="checkbox" id="pxJson"> JSON 模式</label></div>'
          +'<textarea id="pxText" placeholder="回答内容（按所选类型自动组装 payload）"></textarea>'
          +'<textarea id="pxJsonBox" placeholder="JSON 模式：整包提交，如 {&quot;type&quot;:&quot;RESPONSE&quot;,&quot;payload&quot;:{&quot;items&quot;:[…]}}" style="display:none;font-family:ui-monospace,Menlo,monospace;min-height:80px"></textarea>'
          +'<div class="ferr" id="pxErr"></div>'
          +'<div class="row"><span class="dim">发送后本轮发言权即被消费，agent 不会再重复作答</span>'
          +'<span class="sp"></span><button id="pxSend" class="primary">代答发送</button></div></div>';
      } else {
        h+='<div class="section dim">'+(turn?('当前发言权：'+esc(seatName(seats,turn.seatId))+'。轮到本席时，这里会出现人工代答表单。'):'等待会议推进。')+'</div>';
      }
    }

    /* 给己方 agent 的直达指令（closed 前始终可用） */
    if(t.phase!=='closed'){
      h+='<div class="section"><h3>给我的 agent 的指令（直达·高权限）</h3>'
        +'<textarea id="myInstr" placeholder="指令将以 HUMAN_INPUT 定向发给本席 agent，其优先级最高、收到即执行（如：重点核对第 3 节；本轮暂缓表态）"></textarea>'
        +'<div class="row"><input id="myInstrBy" placeholder="署名（默认用户名）" style="width:160px">'
        +'<button id="myInstrSend" class="primary">发送指令</button></div></div>';
    }

    /* 凭证恢复 · agent 替代（任何阶段可用——闭桌后也可恢复身份拉纪要） */
    h+='<div class="section"><h3>凭证恢复 · 更换 agent</h3>'
      +'<div class="hint" style="margin-bottom:6px">agent 被关闭或要换新 agent？「恢复」复制参会配置（原凭证保留），粘贴到新 agent 会话即可以原席位身份继续；「替代」同时禁用原 agent 的全部凭证（即使它仍在运行，下次请求即失效）。</div>'
      +'<div class="row"><button id="stRecover">📋 复制参会配置（恢复）</button>'
      +'<input id="stNewLabel" placeholder="新 agent 标识（替代时选填）" style="width:200px">'
      +'<button id="stReplace" style="color:var(--warn);border-color:var(--warn)">🔄 替代 agent（禁用原凭证）</button></div>'
      +'<div class="ferr" id="stErr"></div></div>';
    h+='</div>';
  }

  /* 席位（systemadmin 附操作列：为任意席位复制参会配置 / 替代 agent） */
  h+='<h3>席位</h3><table><tr><th>席位</th><th>角色</th><th>agent</th><th>状态</th><th>就绪</th><th>立场</th>'+(admin?'<th>操作（🛡）</th>':'')+'</tr>';
  seats.forEach(function(s){
    h+='<tr><td>'+esc(s.name)+(s.seatId===t.ownerSeat?' <span class="badge">建桌人</span>':'')+'</td>'
      +'<td>'+roleBadge(s.role)+'</td><td>'+esc(s.agentLabel)+'</td>'
      +'<td><span class="badge '+(s.status==='active'?'ok':'warn')+'">'+esc(s.status)+'</span></td>'
      +'<td>'+((s.config&&s.config.ready)?'✅':'—')+'</td>'
      +'<td class="dim" title="'+escAttr((s.config&&s.config.stance)||'')+'">'+esc(((s.config&&s.config.stance)||'').slice(0,60))+'</td>'
      +(admin?'<td><button class="admCred" data-sid="'+escAttr(s.seatId)+'" data-name="'+escAttr(s.name)+'" data-role="'+escAttr(s.role)+'">📋 配置</button> '
        +'<button class="admRepl" data-sid="'+escAttr(s.seatId)+'" data-name="'+escAttr(s.name)+'" data-role="'+escAttr(s.role)+'">🔄 替代</button></td>':'')
      +'</tr>';
  });
  h+='</table>';

  /* 产物 */
  h+='<h3>产物</h3><table><tr><th>名称</th><th>所有者</th><th>最新版本</th><th>锁</th></tr>';
  (t.artifacts||[]).forEach(function(a){
    h+='<tr><td>'+esc(a.name)+'</td><td>'+esc(seatName(seats,a.ownerSeat))+'</td><td>v'+a.latestVersion+'</td><td>'+(a.lockedBy?esc(seatName(seats,a.lockedBy)):'—')+'</td></tr>';
  });
  if(!(t.artifacts||[]).length) h+='<tr><td colspan="4" class="dim">无</td></tr>';
  h+='</table>';

  /* 资料文档（上传阅资料 / 投屏）：共享=全桌可下载；私有=仅上传席位（他席可见存在但不可下载） */
  h+='<h3>资料文档 <span class="dim">上传阅资料 · 共享=全桌可下载（投屏评审依据），私有=仅上传席位</span></h3><table><tr><th>文件</th><th>作用声明</th><th>可见性</th><th>上传者</th><th>大小</th><th>时间</th><th></th></tr>';
  (d.documents||[]).forEach(function(doc){
    var mine=doc.uploadedBy===d.mySeatId;
    var canDl=doc.visibility==='shared'||mine;
    h+='<tr><td><b>'+esc(doc.name)+'</b><div class="dim">'+esc(doc.docId)+'</div></td>'
      +'<td>'+esc(doc.purpose)+'</td>'
      +'<td>'+(doc.visibility==='shared'?'<span class="badge phase">共享</span>':'<span class="badge warn">🔒 私有</span>')+'</td>'
      +'<td>'+esc(seatName(seats,doc.uploadedBy))+(mine?'（本席）':'')+'</td>'
      +'<td class="dim">'+fmtSize(doc.size)+'</td>'
      +'<td class="dim">'+fmtTs(doc.uploadedAt)+'</td>'
      +'<td>'+((canDl&&docPreviewKind(doc.name))?'<button class="docPv" data-doc="'+escAttr(doc.docId)+'" data-name="'+escAttr(doc.name)+'" data-size="'+doc.size+'" data-purpose="'+escAttr(doc.purpose)+'">👁 预览</button> ':'')
      +(canDl?'<button class="docDl" data-doc="'+escAttr(doc.docId)+'" data-name="'+escAttr(doc.name)+'">下载</button>':'<span class="dim">不可下载</span>')+'</td></tr>';
  });
  if(!(d.documents||[]).length) h+='<tr><td colspan="7" class="dim">无</td></tr>';
  h+='</table>';
  if(mySeat&&t.phase!=='closed'&&mySeat.role!=='observer'){
    h+='<div class="row" style="margin-top:8px;align-items:flex-start">'
      +'<input type="file" id="docFile" style="max-width:240px">'
      +'<input id="docPurpose" placeholder="文档作用声明（必填），如：待评审需求文档 / 调研原始资料（各方可参考）" style="flex:1;min-width:220px">'
      +'<select id="docVis"><option value="shared">共享 · 全桌可读（投屏）</option><option value="private">私有 · 仅本席</option></select>'
      +'<button id="docUpload" class="primary">上传</button></div>'
      +'<div class="hint">共享文档相当于投屏，全桌 agent 收到 DOC_UPLOADED 通知后可下载阅读；私有文档只有本席可下载。单个文件 ≤5MB。</div>'
      +'<div class="ferr" id="docErr"></div>';
  }

  /* 请求 */
  h+='<h3>执行请求</h3><table><tr><th>标题</th><th>发起 → 执行</th><th>状态</th><th>说明</th></tr>';
  (d.requests||[]).forEach(function(r){
    var st=r.status, cls=st==='executed'?'ok':(st==='rejected'?'err':(st==='human'?'warn':''));
    h+='<tr><td>'+esc(r.req.title)+'</td><td>'+esc(seatName(seats,r.createdBy))+' → '+esc(seatName(seats,r.req.toSeat))+'</td>'
      +'<td><span class="badge '+cls+'">'+esc(st)+'</span></td>'
      +'<td class="dim">'+esc((r.response&&(r.response.reason||r.response.counterDetail))||'')+'</td></tr>';
  });
  if(!(d.requests||[]).length) h+='<tr><td colspan="4" class="dim">无</td></tr>';
  h+='</table>';

  /* 人工指令（仅本桌有席位时渲染——无席位用户点了必被拒，不再展示） */
  if(mySeat&&t.phase!=='closed'){
    h+='<h3>发送人工指令（以你在本桌的席位身份）</h3><div class="row">'
      +'<select id="hTarget"><option value="">全员（广播）</option>';
    seats.forEach(function(s){ h+='<option value="'+esc(s.seatId)+'">→ '+esc(s.name)+'</option>'; });
    h+='</select><input id="hBy" placeholder="署名（默认你的用户名）" style="width:120px">'
      +'<button id="hSend" class="primary">发送</button></div>'
      +'<textarea id="hText" placeholder="人工意见 / 指令 / 裁决说明（将以 HUMAN_INPUT 进入会议记录，agent 在 poll 时可见）"></textarea>';
  }

  /* 邀请码（建桌人 or 系统观察员） */
  if(admin||(mySeat&&mySeat.seatId===t.ownerSeat)){
    h+='<div class="card" id="inviteBox"><b>邀请码</b> <span class="dim">仅建桌人与系统观察员可见 · 复制的是完整邀请（服务器/圆桌 ID/邀请码/参会步骤），整体转发即可参会</span><div id="invites" class="dim" style="margin-top:8px">加载中…</div></div>';
  }

  /* 变动记录（与 agent 回合开始刷新的 changes 同源；最近 50 条，最新在前） */
  h+='<div class="card"><div class="row"><b>变动记录</b> <span class="dim">最近 50 条（资料/产物/阶段/席位/人工）· 与 agent 每回合刷新的 changes 同源</span></div><div style="max-height:260px;overflow:auto;margin-top:8px">';
  var chgs=(d.recentChanges||[]).slice().reverse();
  chgs.forEach(function(c){
    h+='<div class="msg"><span class="mt '+(CHG_CLS[c.kind]||'')+'">'+esc(CHG_LABEL[c.kind]||c.kind)+'</span>'
      +'<span class="meta">'+esc(c.fromSeat==='server'?'服务器':seatName(seats,c.fromSeat))+' · '+fmtTs(c.ts)+'</span>'
      +'<div>'+chgSummary(c,seats)+'</div></div>';
  });
  if(!chgs.length) h+='<div class="dim">（暂无变动）</div>';
  h+='</div></div>';

  /* 消息时间线 */
  h+='<div class="card"><div class="row"><b>会议历史</b> <span class="dim">'+(d.messages||[]).length+' 条</span>'
    +'<span class="sp"></span><select id="msgFilter" style="font-size:12px;padding:2px 8px">'
    +'<option value="all"'+(view.msgFilter==='all'?' selected':'')+'>全部消息</option>'
    +'<option value="key"'+(view.msgFilter==='key'?' selected':'')+'>关键节点</option>'
    +'<option value="human"'+(view.msgFilter==='human'?' selected':'')+'>人工相关</option>'
    +'</select></div><div style="max-height:520px;overflow:auto;margin-top:8px">';
  var shown=(d.messages||[]).filter(function(m){
    if(view.msgFilter==='key') return !!MSG_KEY[m.type];
    if(view.msgFilter==='human') return !!MSG_HUMAN[m.type];
    return true;
  });
  shown.slice().reverse().forEach(function(m){
    var inject=(m.flags&&m.flags.indexOf&&m.flags.indexOf('injection_suspect')>=0);
    var proxied=(m.flags&&m.flags.indexOf&&m.flags.indexOf('human_proxied')>=0);
    var body='';
    var p=m.payload||{};
    var toMe=(m.type==='HUMAN_INPUT'&&p.toSeat===d.mySeatId);
    if(typeof p.text==='string') body=p.text;
    else if(p.items){ try{ body=p.items.map(function(it){return (it.target||'')+'：'+(it.comment||it.decision||'');}).join('；');}catch(e){} }
    else if(m.type==='PHASE_CHANGE') body=(PHASE_LABEL[p.from]||p.from||'')+' → '+(PHASE_LABEL[p.to]||p.to||'')+'（'+(p.reason||'')+'）';
    else if(m.type==='REQUEST') body=p.title+'：'+(p.detail||'');
    else if(m.type==='RESPOND_REQUEST') body=(p.requestIds&&p.requestIds.length?('批量 '+p.requestIds.length+' 个请求·'):'')+p.decision+(p.reason?'：'+p.reason:'');
    else if(m.type==='ARTIFACT_PUBLISHED') body=(p.name||'')+' v'+((p.version&&p.version.v)||'?')+' — '+(p.version&&p.version.changeNote||'');
    else if(m.type==='DOC_UPLOADED') body=(p.doc&&p.doc.name||'')+' — '+(p.doc&&p.doc.purpose||'')+'（'+(p.doc&&p.doc.visibility==='private'?'私有·仅本席':'共享·全桌可读')+'，'+fmtSize(p.doc&&p.doc.size||0)+'）';
    else if(m.type==='CONSENSUS_RESULT') body='pass='+(p.pass?'是':'否');
    else if(m.type==='HOST_PREREVIEW'){
      body='【'+(PRV_LABEL[p.verdict]||p.verdict)+'】'+(p.note||'');
      if(p.issues&&p.issues.length) body+='　问题：'+p.issues.map(function(x){ return '['+(SEV_LABEL[x.severity]||x.severity)+'] '+(x.comment||''); }).join('；');
      if(p.targetSeatId) body+='　→ 点名 '+(seatName(seats,p.targetSeatId));
    }
    else if(m.type==='SUPPLEMENT') body=(p.text||'');
    else { try{ body=JSON.stringify(p).slice(0,200); }catch(e){} }
    h+='<div class="msg'+(inject?' inject':'')+(toMe?' mine':'')+'">'
      +'<span class="mt '+(MT_CLS[m.type]||'')+'">'+esc(MT_LABEL[m.type]||m.type)+'</span>'
      +(proxied?'<span class="badge warn">🙍 人工代答</span> ':'')
      +(toMe?'<span class="badge phase">给我的指令</span> ':'')
      +'<span class="meta">'+esc(m.fromSeat==='server'?'服务器':seatName(seats,m.fromSeat))
      +(p.toSeat?' → '+esc(seatName(seats,p.toSeat)):'')
      +' · '+fmtTs(m.ts)+(inject?' · <b style="color:var(--err)">⚠ 疑似注入</b>':'')+' · #'+m.seq+'</span>'
      +'<div>'+esc(body).slice(0,400)+'</div></div>';
  });
  if(!shown.length) h+='<div class="dim">（该筛选下无消息）</div>';
  h+='</div></div>';

  /* 纪要 */
  if(d.minutes){
    h+='<div class="card"><b>会议纪要</b><pre style="white-space:pre-wrap;font:inherit;margin:8px 0 0">'+esc(d.minutes.markdown||'')+'</pre></div>';
  }

  var app=document.getElementById('app');
  app.innerHTML=h;
  document.getElementById('back').onclick=function(){ openList(); };

  /* ---- 绑定：圆桌示意图 >8 席折叠展开（纯视图操作，不触发草稿保护） ---- */
  var rtMore=document.getElementById('rtMore');
  if(rtMore) rtMore.onclick=function(){ view.rtExpanded=!view.rtExpanded; renderDetail(view.lastDetailData); };
  var rtFold=document.getElementById('rtFold');
  if(rtFold) rtFold.onclick=function(){ view.rtExpanded=false; renderDetail(view.lastDetailData); };

  /* ---- 绑定：资料文档（上传走 my 通道，下载 base64→Blob） ---- */
  var docUp=document.getElementById('docUpload');
  if(docUp) docUp.onclick=function(){
    var errEl=document.getElementById('docErr'); errEl.textContent='';
    var fi=document.getElementById('docFile');
    var f=fi&&fi.files&&fi.files[0];
    if(!f){ errEl.textContent='请选择文件'; return; }
    var purpose=document.getElementById('docPurpose').value.trim();
    if(!purpose){ errEl.textContent='文档作用声明必填（如：待评审需求文档）'; return; }
    if(f.size>5*1024*1024){ errEl.textContent='文件超过 5MB 上限'; return; }
    var reader=new FileReader();
    reader.onload=function(){
      api('POST','/api/tables/'+view.tableId+'/my/documents',{
        name:f.name, purpose:purpose,
        visibility:document.getElementById('docVis').value,
        contentBase64:String(reader.result).split(',')[1]||''
      }).then(function(){ toast('资料已上传，全桌已收到通知'); view.dirtyPanel=false; loadDetail(); })
        .catch(function(e){ errEl.textContent='上传失败：'+e.message; });
    };
    reader.onerror=function(){ errEl.textContent='读取文件失败'; };
    reader.readAsDataURL(f);
  };
  app.querySelectorAll('button.docDl').forEach(function(b){
    b.onclick=function(){ downloadDoc(b.getAttribute('data-doc'), b.getAttribute('data-name')); };
  });
  app.querySelectorAll('button.docPv').forEach(function(b){
    b.onclick=function(){
      openDocPreview({
        docId:b.getAttribute('data-doc'), name:b.getAttribute('data-name'),
        size:parseInt(b.getAttribute('data-size'),10)||0, purpose:b.getAttribute('data-purpose')||''
      });
    };
  });

  /* ---- 绑定：人工指令 ---- */
  var hSend=document.getElementById('hSend');
  if(hSend) hSend.onclick=function(){
    var txt=document.getElementById('hText').value.trim();
    if(!txt){ toast('请输入内容'); return; }
    api('POST','/api/tables/'+view.tableId+'/human-input',{
      text:txt,
      toSeat:document.getElementById('hTarget').value||undefined,
      byHuman:document.getElementById('hBy').value.trim()
    }).then(function(){ toast('已发送'); view.dirtyPanel=false; loadDetail(); })
      .catch(function(e){ toast('发送失败：'+e.message); });
  };

  /* ---- 绑定：我的席位面板 ---- */
  if(mySeat&&t.phase==='open'){
    var cfgPreset=document.getElementById('cfgPreset');
    if(cfgPreset){
      /* 立场预设 + 回填 */
      var stances=[];
      api('GET','/api/stances').then(function(sd){
        stances=sd.stances||[];
        var o='<option value="">（选择立场预设…）</option>';
        stances.forEach(function(s){ o+='<option value="'+esc(s.id)+'"'+((mySeat.config&&mySeat.config.stancePreset===s.id)?' selected':'')+'>'+esc(s.label)+'（'+esc(s.forRole)+'）</option>'; });
        cfgPreset.innerHTML=o;
      }).catch(function(){});
      var presetText=function(){ for(var si=0;si<stances.length;si++){ if(stances[si].id===cfgPreset.value) return stances[si].text; } return ''; };
      var rebuildStance=function(){
        var sup=document.getElementById('cfgSup').value.trim();
        document.getElementById('cfgStance').value=presetText()+(sup?('；补充：'+sup):'');
      };
      cfgPreset.onchange=function(){ rebuildStance(); view.dirtyPanel=true; };
      var supEl=document.getElementById('cfgSup'); supEl.oninput=rebuildStance;

      /* 讨论范围快捷模板（点击即设定） */
      app.querySelectorAll('button[data-scope]').forEach(function(b){
        b.onclick=function(){ document.getElementById('cfgScope').value=b.getAttribute('data-scope'); view.dirtyPanel=true; };
      });

      /* 数据范围 chips 输入器（回填现值） */
      view.dsDraft=((mySeat.config&&mySeat.config.dataScope)||[]).slice();
      var redrawDs=function(){
        var box=document.getElementById('dsChips');
        if(!box) return;
        var o='';
        view.dsDraft.forEach(function(x,xi){
          o+='<span class="chip">'+esc(x)+'<b data-di="'+xi+'">×</b></span>';
        });
        box.innerHTML=o||'';
        box.querySelectorAll('b[data-di]').forEach(function(bx){
          bx.onclick=function(){ view.dsDraft.splice(parseInt(bx.getAttribute('data-di'),10),1); view.dirtyPanel=true; redrawDs(); };
        });
      };
      redrawDs();
      var dsIn=document.getElementById('dsIn');
      var addDs=function(v){
        v=(v||'').trim(); if(!v) return;
        if(view.dsDraft.indexOf(v)<0){ view.dsDraft.push(v); view.dirtyPanel=true; redrawDs(); }
      };
      dsIn.onkeydown=function(e){
        if(e.key==='Enter'||e.key===','||e.key==='；'||e.key===';'){ e.preventDefault(); addDs(dsIn.value); dsIn.value=''; }
      };
      dsIn.onblur=function(){ addDs(dsIn.value); dsIn.value=''; };
      app.querySelectorAll('button[data-ds]').forEach(function(b){
        b.onclick=function(){ addDs(b.getAttribute('data-ds')); };
      });

      /* 保存 / 收起 / 修改 */
      document.getElementById('cfgSave').onclick=function(){
        var stance=document.getElementById('cfgStance').value.trim();
        var errEl=document.getElementById('cfgErr');
        if(!stance){ errEl.textContent='立场声明必填'; return; }
        errEl.textContent='';
        api('POST','/api/tables/'+view.tableId+'/my/seat-config',{
          stancePreset:cfgPreset.value||undefined,
          stance:stance,
          scope:document.getElementById('cfgScope').value.trim(),
          dataScope:view.dsDraft,
          ready:document.getElementById('cfgReady').checked
        }).then(function(){ toast('设定已保存'); view.dirtyPanel=false; view.cfgEditing=false; loadDetail(); })
          .catch(function(e){ document.getElementById('cfgErr').textContent='保存失败：'+e.message; });
      };
      var col=document.getElementById('cfgCollapse');
      if(col) col.onclick=function(){ view.dirtyPanel=false; view.cfgEditing=false; loadDetail(); };
    }
    var cfgEdit=document.getElementById('cfgEdit');
    if(cfgEdit) cfgEdit.onclick=function(){ view.cfgEditing=true; view.dirtyPanel=true; renderDetail(view.lastDetailData); };

    /* 开始会议（建桌人） */
    var stStart=document.getElementById('stStart');
    if(stStart) stStart.onclick=function(){
      if(stStart.disabled) return;
      api('POST','/api/tables/'+view.tableId+'/my/start',{}).then(function(){
        toast('会议已开始，进入提案陈述阶段'); view.dirtyPanel=false; loadDetail();
      }).catch(function(e){ document.getElementById('stErr').textContent='开始失败：'+e.message; });
    };

    /* 主持人桌设定保存（定规则，网页 user token 通道） */
    var tcSave=document.getElementById('tcSave');
    if(tcSave) tcSave.onclick=function(){
      var body={};
      var tp=document.getElementById('tcTopic').value.trim(); if(tp) body.topic=tp;
      body.goals=document.getElementById('tcGoals').value.trim();
      body.deliverables=document.getElementById('tcDeliverables').value.trim();
      body.rules=document.getElementById('tcRules').value.trim();
      body.rolePlan=document.getElementById('tcRolePlan').value.trim();
      api('POST','/api/tables/'+view.tableId+'/my/table-config',body)
        .then(function(){ toast('桌设定已保存'); view.dirtyPanel=false; loadDetail(); })
        .catch(function(e){ document.getElementById('tcErr').textContent='保存失败：'+e.message; });
    };
  }

  /* ---- 绑定：代答（会议中持发言权） ---- */
  var pxType=document.getElementById('pxType');
  if(pxType){
    var PHASE_TYPES={statements:['STATEMENT'],'review':['REVIEW_COMMENT'],'response':['RESPONSE'],'execution':['RESPOND_REQUEST'],'convergence':['CONSENSUS_VOTE']};
    var types=(PHASE_TYPES[t.phase]||[]).concat(['QUESTION']);
    /* hosted 点名期：被点名席（含本人代答）可提交 SUPPLEMENT */
    if(t.mode==='hosted'&&t.precheck&&t.precheck.state==='directive'&&turn&&turn.seatId===d.mySeatId) types=types.concat(['SUPPLEMENT']);
    pxType.innerHTML=types.map(function(x){return '<option>'+esc(x)+'</option>';}).join('');
    var PX_DECISIONS={'CONSENSUS_VOTE':['pass','conditional_pass','reject'],'RESPOND_REQUEST':['reject','counter','escalate_human']};
    var pxSync=function(){
      var ty=pxType.value;
      document.getElementById('pxSeverity').style.display=(ty==='REVIEW_COMMENT')?'':'none';
      document.getElementById('pxTarget').style.display=(ty==='REVIEW_COMMENT')?'':'none';
      var dd=document.getElementById('pxDecision');
      var opts=PX_DECISIONS[ty];
      dd.style.display=opts?'':'none';
      if(opts) dd.innerHTML=opts.map(function(x){return '<option>'+esc(x)+'</option>';}).join('');
      document.getElementById('pxText').placeholder=(ty==='RESPOND_REQUEST')?'reason / counterDetail 说明':'回答内容';
      if(ty==='RESPOND_REQUEST'&&!turn.pendingRequest) document.getElementById('pxText').placeholder='（未取得 pendingRequest，请用 JSON 模式带 requestId）';
    };
    pxType.onchange=pxSync; pxSync();
    document.getElementById('pxJson').onchange=function(){
      var on=this.checked;
      document.getElementById('pxJsonBox').style.display=on?'':'none';
      document.getElementById('pxText').style.display=on?'none':'';
      pxType.style.display=on?'none':'';
      ['pxDecision','pxSeverity','pxTarget'].forEach(function(id){ var el=document.getElementById(id); el.style.display=on?'none':''; });
    };
    document.getElementById('pxSend').onclick=function(){
      var type, payload, errEl=document.getElementById('pxErr'); errEl.textContent='';
      if(document.getElementById('pxJson').checked){
        var whole;
        try{ whole=JSON.parse(document.getElementById('pxJsonBox').value); }
        catch(e){ errEl.textContent='JSON 不合法'; return; }
        type=whole.type; payload=whole.payload;
        if(!type){ errEl.textContent='JSON 里缺 type'; return; }
      }else{
        type=pxType.value;
        var text=document.getElementById('pxText').value.trim();
        if(!text){ errEl.textContent='请输入内容'; return; }
        if(type==='STATEMENT'||type==='QUESTION'){ payload={text:text}; }
        else if(type==='SUPPLEMENT'){ payload={directiveId:(t.precheck&&t.precheck.refId)||'',text:text}; }
        else if(type==='REVIEW_COMMENT'){
          payload={items:[{id:'web-'+Date.now(),target:document.getElementById('pxTarget').value.trim()||'（未指明位置）',severity:document.getElementById('pxSeverity').value,comment:text}],summary:'观察页人工代答',done:true};
        }
        else if(type==='CONSENSUS_VOTE'){ payload={decision:document.getElementById('pxDecision').value,note:text}; }
        else if(type==='RESPOND_REQUEST'){
          if(!turn.pendingRequest){ errEl.textContent='缺 requestId，请用 JSON 模式'; return; }
          payload={requestId:turn.pendingRequest.requestId,decision:document.getElementById('pxDecision').value,reason:text};
        }
        else { errEl.textContent='该类型请用 JSON 模式'; return; }
      }
      api('POST','/api/tables/'+view.tableId+'/my/message',{type:type,payload:payload})
        .then(function(){ toast('已代答发送'); view.dirtyPanel=false; loadDetail(); })
        .catch(function(e){ document.getElementById('pxErr').textContent='发送失败：'+e.message; });
    };
  }

  /* ---- 绑定：凭证恢复 / agent 替代（我的席位，任何阶段） ---- */
  var stRecover=document.getElementById('stRecover');
  if(stRecover){
    stRecover.onclick=function(){
      api('POST','/api/tables/'+view.tableId+'/my/seat-token',{mode:'recover'}).then(function(r){
        copyText(recoveryText(t.topic,view.tableId,r.token,mySeat.name,mySeat.role,false));
        toast('参会配置已复制（原凭证保留）——整体粘贴给新 agent 会话即可');
      }).catch(function(e){ document.getElementById('stErr').textContent='失败：'+e.message; });
    };
    document.getElementById('stReplace').onclick=function(){
      if(!confirm('确认替代 agent？本席位全部现有凭证将立即禁用（原 agent 即使仍在运行，下次请求即失效），并签发新凭证复制到剪贴板。')) return;
      var label=document.getElementById('stNewLabel').value.trim();
      api('POST','/api/tables/'+view.tableId+'/my/seat-token',{mode:'replace',agentLabel:label||undefined}).then(function(r){
        copyText(recoveryText(t.topic,view.tableId,r.token,mySeat.name,mySeat.role,true));
        toast('新凭证已签发并复制；原 agent 已禁用');
        view.dirtyPanel=false; loadDetail();
      }).catch(function(e){ document.getElementById('stErr').textContent='失败：'+e.message; });
    };
  }

  /* ---- 绑定：admin 席位操作（任意席位复制配置 / 替代 agent） ---- */
  app.querySelectorAll('button.admCred').forEach(function(b){
    b.onclick=function(){
      api('POST','/api/admin/tables/'+view.tableId+'/seats/'+b.getAttribute('data-sid')+'/token',{mode:'recover'}).then(function(r){
        copyText(recoveryText(t.topic,view.tableId,r.token,b.getAttribute('data-name'),b.getAttribute('data-role'),false));
        toast('参会配置已复制（原凭证保留）——发给该席位的新 agent 会话即可');
      }).catch(function(e){ toast('失败：'+e.message); });
    };
  });
  app.querySelectorAll('button.admRepl').forEach(function(b){
    b.onclick=function(){
      var name=b.getAttribute('data-name');
      var label=prompt('为「'+name+'」指定新 agent 标识（留空保留原值）：');
      if(label===null) return;
      if(!confirm('确认替代「'+name+'」的 agent？其全部现有凭证将立即禁用，并签发新凭证复制到剪贴板。')) return;
      api('POST','/api/admin/tables/'+view.tableId+'/seats/'+b.getAttribute('data-sid')+'/token',{mode:'replace',agentLabel:label.trim()||undefined}).then(function(r){
        copyText(recoveryText(t.topic,view.tableId,r.token,name,b.getAttribute('data-role'),true));
        toast('新凭证已签发并复制；该席位原 agent 已禁用');
        view.dirtyPanel=false; loadDetail();
      }).catch(function(e){ toast('失败：'+e.message); });
    };
  });

  /* ---- 绑定：直达指令 ---- */
  var myInstrSend=document.getElementById('myInstrSend');
  if(myInstrSend) myInstrSend.onclick=function(){
    var txt=document.getElementById('myInstr').value.trim();
    if(!txt){ toast('请输入指令'); return; }
    api('POST','/api/tables/'+view.tableId+'/human-input',{
      text:txt, toSeat:d.mySeatId, byHuman:document.getElementById('myInstrBy').value.trim()
    }).then(function(){ toast('指令已发送（agent 下次 poll 即见）'); view.dirtyPanel=false; loadDetail(); })
      .catch(function(e){ toast('发送失败：'+e.message); });
  };

  /* ---- 绑定：管理员操作 ---- */
  var admHuman=document.getElementById('admHuman');
  if(admHuman) admHuman.onclick=function(){
    if(!confirm('将本桌转入人工介入模式？会议暂停，等待人工处理。')) return;
    api('POST','/api/admin/tables/'+view.tableId+'/human',{reason:document.getElementById('admReason').value.trim()})
      .then(function(){ toast('已转入人工介入'); view.dirtyPanel=false; loadDetail(); })
      .catch(function(e){ toast('失败：'+e.message); });
  };
  var admClose=document.getElementById('admClose');
  if(admClose) admClose.onclick=function(){
    if(!confirm('强制闭桌将立即生成纪要并结束会议，不可恢复。确定？')) return;
    api('POST','/api/admin/tables/'+view.tableId+'/close',{reason:document.getElementById('admReason').value.trim()})
      .then(function(){ toast('已强制闭桌（纪要已生成）'); view.dirtyPanel=false; loadDetail(); })
      .catch(function(e){ toast('失败：'+e.message); });
  };
  var admDel=document.getElementById('admDel');
  if(admDel) admDel.onclick=function(){
    if(!confirm('删除圆桌将连同全部消息/产物/席位数据一并清除，完全不可恢复（轮询中的 agent 将收到 404）。确定删除 '+view.tableId+' ？')) return;
    api('DELETE','/api/admin/tables/'+view.tableId)
      .then(function(){ toast('圆桌已删除'); openList(); })
      .catch(function(e){ toast('失败：'+e.message); });
  };

  /* ---- 邀请码（建桌人或系统观察员渲染了容器） ---- */
  var invBox=document.getElementById('inviteBox');
  if(invBox){
    api('GET','/api/observer/tables/'+view.tableId+'/invites')
      .then(function(inv){
        var el=document.getElementById('invites');
        var hh='';
        inv.invites.forEach(function(it){
          hh+='<div class="row" style="margin:4px 0"><span class="rb '+(it.role==='reviewer'?'reviewer':'observer')+'">'+esc(it.role==='reviewer'?'评审方':'观察方')+'</span>'
            +'<span class="invite">'+esc(it.code)+'</span><span class="dim">剩 '+it.usesLeft+' 次</span>'
            +'<button class="cpInv" data-code="'+esc(it.code)+'" data-role="'+esc(it.role)+'" data-uses="'+it.usesLeft+'">复制完整邀请</button></div>';
        });
        el.innerHTML=hh||'<span class="dim">无可用邀请码</span>';
        el.querySelectorAll('button.cpInv').forEach(function(b){
          b.onclick=function(){
            copyText(inviteText(t.topic,view.tableId,b.getAttribute('data-code'),b.getAttribute('data-role'),parseInt(b.getAttribute('data-uses'),10)));
            toast('完整邀请已复制（含服务器/圆桌ID/邀请码）');
          };
        });
      })
      .catch(function(e){ document.getElementById('invites').innerHTML='<span class="dim">'+esc(e.message)+'</span>'; });
  }
}

function loadDetail(){
  return api('GET','/api/observer/tables/'+view.tableId).then(function(d){
    // activeTurn.deadline 随时间恒变，比较时归零
    var j=JSON.stringify(d,function(k,v){ return k==='deadline'?0:v; });
    view.lastDetailData=d;
    if(j===view.lastDetailJson) return; // 数据无变化不重建 DOM
    view.lastDetailJson=j;
    // 草稿保护：面板内编辑过（dirtyPanel）就暂缓重渲染（否则 5s 轮询会清掉半填的表单/chips），
    // 最新数据已缓存进 lastDetailData，保存/收起后自然恢复
    if(view.dirtyPanel) return;
    renderDetail(d);
  })
    .catch(function(e){ toast(e.message); openList(); });
}
function openTable(id){
  view.mode='detail'; view.tableId=id; view.lastDetailJson=''; view.lastDetailData=null;
  view.dirtyPanel=false; view.cfgEditing=false; view.msgFilter='all'; view.rtExpanded=false;
  clearInterval(view.timer);
  loadDetail();
  view.timer=setInterval(function(){ if(view.mode==='detail') loadDetail(); },5000);
}
function openList(){
  view.mode='list'; view.tableId=null; view.dirtyPanel=false;
  clearInterval(view.timer);
  loadList();
}

/* ---------- 草稿保护：面板内任何编辑都冻结轮询重渲染 ---------- */
(function(){
  document.addEventListener('keydown',function(e){ if(e.key==='Escape'){ closeDocPreview(); closeHelp(); } });
  var app=document.getElementById('app');
  var mark=function(e){
    if(view.mode!=='detail') return;
    if(e&&e.target&&e.target.id==='msgFilter') return; // 消息筛选是纯视图操作，交给自身处理
    view.dirtyPanel=true;
  };
  app.addEventListener('input',mark,true);
  app.addEventListener('change',function(e){
    if(e&&e.target&&e.target.id==='msgFilter'){ view.msgFilter=e.target.value; renderDetail(view.lastDetailData); return; }
    mark(e);
  },true);
})();

/* ---------- 启动 ---------- */
document.getElementById('helpBtn').onclick=openHelp;
refreshWho();
if(TOKEN){
  renderIntro();
  api('GET','/api/observer/tables').then(function(){ fetchMe(); openList(); })
    .catch(function(){ toast('已保存的 token 失效，请重新连接'); });
}
else { renderIntro(); }
</script>
</body>
</html>`;
