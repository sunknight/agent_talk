/**
 * 观察端 Web 控制台（单页，零构建）— GET / 下发。
 * 功能：圆桌列表（筛选/我的席位标记）/ 建桌（5 桌类型：评审/协作/头脑风暴/方案决策/问询；我的角色自选——任一角色自建入席或主持人建桌，问询桌可选问询方/主持人；回合提交全桌型过 DeepSeek 预审）/
 *       桌详情（按进度分阶段展示：准备/就绪待开始/进行中/暂停/结束，各模块显隐合理化；圆桌示意图：席位环绕+最后交付摘要+思考中标记、阶段进度/席位/产物/请求/纪要、会议暂停/恢复与暂停申请、
 *       问询方操作面板：开始问询/定向与广播提问/结束问询出问询纪要）/
 *       会话视图 chatbox（己方右侧/其他方左侧/系统提示居中，发言/指令/系统筛选，阶段变更分隔条）+ 输入聚合（公开补充/私有指令/人工指令/代答/提问 按阶段切换类型）/
 *       我的席位面板（入桌设定·回填、开始会议·建桌人、暂停期调整、会议控制/申请暂停/凭证恢复折叠子区块）/
 *       身份体系：普通参与用户 vs systemadmin（系统观察员·全局观察模式，界面金徽章区分，纯只读+正常能力）/
 *       帮助体系：未登录页 agent 接入指引（安装+注册，可复制）、列表页底部帮助速览、右上角帮助弹窗。
 * 安全：所有动态内容经 esc()（文本）/ escAttr()（属性）转义后插入（消息是远端内容，绝不 innerHTML 直插）。
 * 注意：模板字符串内禁用反引号；${} 仅允许 TABLE_TYPES 注入一处（构建期常量 JSON，无任何用户输入）。
 */
import { TABLE_TYPES } from "@rt/shared";
export const OBSERVER_HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>智能体协同博弈平台 · agent-talk</title>
<style>
  :root { --bg:#0f1117; --panel:#171a23; --panel-2:#1c2231; --line:#2a2f3d; --line-2:#3a4256; --fg:#e6e9f0; --dim:#a2abc0; --acc:#4f8cff; --acc-bg:rgba(79,140,255,.13); --ok:#3fb68b; --warn:#e0a23c; --err:#e05c5c; --gold:#e8c877; --goldline:#a8853f; --vote:#b07ce8; --r:8px; --r-lg:12px; --tt:.18s; }
  * { box-sizing:border-box; }
  body { margin:0; font:14px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif; background:var(--bg); color:var(--fg); }
  header { display:flex; gap:12px; align-items:center; padding:12px 20px; border-bottom:1px solid var(--line); position:sticky; top:0; background:rgba(15,17,23,.96); z-index:5; flex-wrap:wrap; }
  header h1 { font-size:16px; margin:0; white-space:nowrap; letter-spacing:.02em; }
  header .sp { flex:1; }
  input,select,textarea,button { font:inherit; border:1px solid var(--line); background:var(--panel); color:var(--fg); border-radius:var(--r); padding:7px 12px; transition:border-color var(--tt),background var(--tt),color var(--tt),box-shadow var(--tt),opacity var(--tt); }
  input:focus,select:focus,textarea:focus { border-color:var(--acc); box-shadow:0 0 0 3px var(--acc-bg); outline:none; }
  input::placeholder,textarea::placeholder { color:#838da6; }
  select { cursor:pointer; }
  button { cursor:pointer; }
  button:hover:not(:disabled) { border-color:var(--line-2); background:var(--panel-2); }
  button.primary { background:var(--acc); border-color:var(--acc); color:#fff; }
  button.primary:hover:not(:disabled) { background:#3e7bef; border-color:#3e7bef; }
  button.danger { color:var(--err); border-color:rgba(224,92,92,.5); background:transparent; }
  button.danger:hover:not(:disabled) { color:#ff7a7a; border-color:var(--err); background:rgba(224,92,92,.1); }
  button:disabled { opacity:.45; cursor:not-allowed; }
  :focus-visible { outline:2px solid var(--acc); outline-offset:2px; }
  main { padding:20px; max-width:1560px; margin:0 auto; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:var(--r-lg); padding:16px 18px; margin-bottom:14px; }
  .tables { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:12px; }
  .tcard { cursor:pointer; transition:border-color var(--tt),background var(--tt); }
  .tcard:hover { border-color:var(--acc); background:var(--panel-2); }
  .tcard .t-title { font-size:15px; font-weight:600; line-height:1.45; }
  .badge { display:inline-flex; align-items:center; gap:4px; padding:1px 9px; border-radius:99px; font-size:12px; border:1px solid var(--line); color:var(--dim); white-space:nowrap; }
  .badge.phase { color:var(--acc); border-color:var(--acc); }
  .badge.ok { color:var(--ok); border-color:var(--ok); }
  .badge.err { color:var(--err); border-color:var(--err); }
  .badge.warn { color:var(--warn); border-color:var(--warn); }
  .row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  .dim { color:var(--dim); font-size:12px; }
  .turn { border-left:3px solid var(--acc); padding-left:12px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th,td { text-align:left; padding:7px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--dim); font-weight:500; font-size:12px; white-space:nowrap; }
  table tr:last-child td { border-bottom:none; }
  table tr:hover td { background:rgba(255,255,255,.02); }
  .mine { border-color:var(--acc); box-shadow:0 0 0 1px var(--acc) inset; }
  .frm h4 { margin:18px 0 8px; font-size:13px; border-bottom:1px solid var(--line); padding-bottom:5px; }
  .frm h4:first-child { margin-top:0; }
  .frm .frow { margin:12px 0; }
  .frm .frow label.t, .frow label.t { display:block; font-size:12px; color:var(--dim); margin-bottom:5px; font-weight:500; }
  .frm .frow label.t b, .frow label.t b { color:var(--err); font-weight:600; }
  .frow > input, .frow > textarea, .frow > select { width:100%; }
  .invite { font-family:ui-monospace,Menlo,monospace; letter-spacing:1px; }
  #toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%); background:var(--acc); color:#fff; padding:9px 20px; border-radius:99px; display:none; z-index:30; box-shadow:0 8px 24px rgba(0,0,0,.4); font-size:13px; animation:toastIn .22s ease; }
  @keyframes toastIn { from { opacity:0; transform:translate(-50%,10px); } to { opacity:1; transform:translate(-50%,0); } }
  .section { margin-top:10px; }
  .section h3 { font-size:13px; color:var(--dim); margin:14px 0 6px; font-weight:600; }
  textarea { width:100%; min-height:72px; }
  .back { color:var(--acc); cursor:pointer; user-select:none; }
  .back:hover { text-decoration:underline; }
  /* 分区卡头（详情页各区统一：标题 + dim 说明 + 右侧操作） */
  .shead { display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; margin:0 0 10px; }
  .shead > b { font-size:14px; }
  .shead .sp { flex:1; }
  /* 表单错误/说明：错误行非空时呈警示条 */
  .ferr { color:var(--err); font-size:12px; min-height:16px; margin-top:6px; }
  .ferr:not(:empty) { background:rgba(224,92,92,.08); border-left:2px solid var(--err); padding:6px 10px; border-radius:4px; }
  .hint { color:var(--dim); font-size:12px; margin-top:3px; line-height:1.55; }
  /* 卡片式单选（桌类型/我的角色）与胶囊多选（开放角色） */
  .rchoice { display:grid; gap:8px; }
  .rchoice.two { grid-template-columns:1fr 1fr; }
  .rchoice label { display:flex; gap:10px; align-items:flex-start; padding:10px 12px; border:1px solid var(--line); border-radius:var(--r); background:var(--panel); cursor:pointer; transition:border-color var(--tt),background var(--tt); }
  .rchoice label:hover { border-color:var(--line-2); background:var(--panel-2); }
  .rchoice label:has(input:checked) { border-color:var(--acc); background:var(--acc-bg); }
  .rchoice input { margin-top:3px; accent-color:var(--acc); flex:none; }
  .cchoice { display:flex; flex-wrap:wrap; gap:8px; }
  .cchoice label { display:inline-flex; gap:6px; align-items:center; padding:5px 12px; border:1px solid var(--line); border-radius:99px; cursor:pointer; font-size:13px; transition:border-color var(--tt),background var(--tt),color var(--tt); }
  .cchoice label:hover { border-color:var(--line-2); background:var(--panel-2); }
  .cchoice label:has(input:checked) { border-color:var(--acc); color:var(--acc); background:var(--acc-bg); }
  .cchoice input { accent-color:var(--acc); }
  /* 身份徽章：全局 systemadmin（金） vs 普通参与用户 */
  .wbadge { display:inline-flex; align-items:center; gap:4px; padding:1px 9px; border-radius:99px; font-size:12px; white-space:nowrap; }
  .wbadge.admin { color:var(--gold); border:1px solid var(--goldline); background:rgba(212,169,78,.12); }
  .wbadge.user { color:var(--dim); border:1px solid var(--line); }
  /* 多帐号切换浮层：列出本浏览器记录的帐号，点击切换（整页重载） */
  .acctmenu { position:fixed; z-index:60; background:var(--panel); border:1px solid var(--line-2); border-radius:var(--r-lg); box-shadow:0 10px 34px rgba(0,0,0,.5); padding:6px; min-width:250px; }
  .acctmenu .ai { display:flex; align-items:center; gap:8px; padding:8px 11px; border-radius:var(--r); cursor:pointer; font-size:13px; }
  .acctmenu .ai:hover { background:var(--panel-2); }
  .acctmenu .ai.cur { cursor:default; }
  .acctmenu .ai .sub { color:var(--dim); font-size:11px; }
  .acctmenu .ai .sp { flex:1; }
  .acctmenu .ah { padding:7px 11px 4px; color:var(--dim); font-size:11px; }
  .banner { padding:9px 14px; border-radius:var(--r-lg); margin-bottom:12px; font-size:13px; line-height:1.6; }
  .banner.admin { color:var(--gold); background:rgba(212,169,78,.10); border:1px solid var(--goldline); }
  .banner.obs { color:var(--dim); background:var(--panel); border:1px dashed var(--line); }
  /* 桌内角色徽章 */
  .rb { display:inline-flex; align-items:center; gap:4px; padding:1px 9px; border-radius:99px; font-size:12px; white-space:nowrap; border:1px solid var(--line); }
  .rb.proposer { color:var(--acc); border-color:var(--acc); }
  .rb.reviewer { color:var(--ok); border-color:var(--ok); }
  .rb.observer { color:var(--dim); border-color:var(--line); }
  .rb.host { color:#d9b23a; border-color:#c9a227; }
  .rb.collaborator { color:var(--vote); border-color:var(--vote); }
  .rb.answerer { color:var(--ok); border-color:var(--ok); }
  .rb.asker { color:var(--acc); border-color:var(--acc); border-style:dashed; }
  .rb.ttype { color:var(--warn); border-color:var(--warn); border-style:dashed; }
  /* chips 输入器（数据范围） */
  .chips { display:flex; flex-wrap:wrap; gap:6px; padding:6px 8px; border:1px solid var(--line); border-radius:var(--r); background:var(--panel); min-height:38px; align-items:center; transition:border-color var(--tt),box-shadow var(--tt); }
  .chips:focus-within { border-color:var(--acc); box-shadow:0 0 0 3px var(--acc-bg); }
  .chips input { border:none; background:transparent; padding:2px 4px; flex:1; min-width:130px; box-shadow:none; }
  .chips input:focus { outline:none; box-shadow:none; }
  .chip { display:inline-flex; align-items:center; gap:4px; padding:1px 6px 1px 8px; border-radius:99px; border:1px solid var(--acc); color:var(--acc); font-size:12px; font-family:ui-monospace,Menlo,monospace; background:var(--acc-bg); }
  .chip b { cursor:pointer; color:var(--dim); font-weight:400; padding:0 3px; }
  .chip b:hover { color:var(--err); }
  .preset { font-size:12px; padding:3px 11px; border-radius:99px; color:var(--dim); border:1px dashed var(--line); background:transparent; cursor:pointer; transition:color var(--tt),border-color var(--tt); }
  .preset:hover { color:var(--acc); border-color:var(--acc); }
  /* 列表筛选 */
  .fbtn { font-size:12px; padding:3px 11px; border-radius:99px; border:1px solid var(--line); color:var(--dim); background:transparent; cursor:pointer; transition:color var(--tt),border-color var(--tt),background var(--tt); }
  .fbtn:hover { color:var(--acc); border-color:var(--acc); }
  .fbtn.on { color:var(--acc); border-color:var(--acc); background:var(--acc-bg); }
  /* 阶段进度条 */
  .steps { display:flex; gap:4px; margin:12px 0 4px; }
  .step { flex:1; text-align:center; font-size:12px; color:var(--dim); }
  .step .bar { height:4px; border-radius:2px; background:var(--line); margin-bottom:6px; transition:background var(--tt); }
  .step.done .bar { background:var(--ok); }
  .step.cur .bar { background:var(--acc); }
  .step.cur { color:var(--acc); font-weight:600; }
  .kv { margin:5px 0; font-size:13px; line-height:1.6; }
  .kv .k { display:inline-block; min-width:3.2em; color:var(--dim); margin-right:8px; }
  /* 带标签的 kv 行：标签固定左栏、内容悬挂对齐（长文换行不回行首） */
  .kv:has(.k) { position:relative; padding-left:4.4em; }
  .kv:has(.k) .k { position:absolute; left:0; top:0; min-width:0; margin-right:0; }
  .sumcard { background:#141722; border:1px solid var(--line); border-radius:var(--r); padding:10px 12px; margin:8px 0; }
  /* 消息类型徽章 */
  .mt { display:inline-flex; align-items:center; font-size:11px; padding:0 7px; border-radius:4px; border:1px solid var(--line); color:var(--dim); font-weight:500; margin-right:4px; white-space:nowrap; }
  .mt-phase { color:var(--acc); border-color:var(--acc); }
  .mt-st { color:var(--acc); border-color:var(--acc); }
  .mt-rev { color:var(--ok); border-color:var(--ok); }
  .mt-human { color:var(--gold); border-color:var(--goldline); }
  .mt-req { color:var(--warn); border-color:var(--warn); }
  .mt-vote { color:var(--vote); border-color:var(--vote); }
  .mt-min { color:var(--acc); border-color:var(--acc); }
  #regBox { position:fixed; top:54px; right:20px; width:300px; z-index:8; margin:0; box-shadow:0 12px 32px rgba(0,0,0,.45); }
  /* 资料文档预览弹层（body 级，不受轮询重渲染影响） */
  .dmodal { position:fixed; inset:0; background:rgba(6,8,12,.74); z-index:20; display:flex; align-items:center; justify-content:center; }
  .dmodal .dbox { background:var(--panel); border:1px solid var(--line); border-radius:var(--r-lg); width:min(940px,94vw); max-height:86vh; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.5); }
  .dmodal .dhead { display:flex; gap:10px; align-items:center; padding:10px 14px; border-bottom:1px solid var(--line); flex-wrap:wrap; }
  .dmodal .dbody { padding:16px; overflow:auto; min-height:120px; }
  .dmodal pre { white-space:pre-wrap; word-break:break-word; font:12.5px/1.7 ui-monospace,Menlo,monospace; }
  .dmodal img { max-width:100%; border-radius:6px; }
  .dmodal iframe { width:100%; height:70vh; border:none; border-radius:6px; background:#fff; }
  .mdv { font-size:14px; line-height:1.75; }
  .mdv p { margin:6px 0; }
  .mdv ul { margin:4px 0; padding-left:20px; }
  .mdv li { margin:3px 0; }
  .mdv h2,.mdv h3,.mdv h4,.mdv h5 { margin:14px 0 6px; }
  .mdv pre { background:#141722; border:1px solid var(--line); border-radius:8px; padding:10px 12px; }
  .mdv code { background:#141722; border-radius:4px; padding:0 5px; font:12.5px ui-monospace,Menlo,monospace; }
  .mdv a { color:var(--acc); }
  /* 圆桌示意图（桌详情顶部：席位卡片环绕 + 最后交付摘要 + 发言权思考中标记，>8 席折叠） */
  .rt-wrap { overflow-x:auto; padding-bottom:4px; }
  .rt-stage { position:relative; width:560px; height:360px; margin:0 auto; }
  .rt-ell { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:280px; height:140px; border:2px dashed var(--line); border-radius:50%; background:radial-gradient(closest-side,#1c2130,#141722); }
  .rt-center { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:260px; text-align:center; }
  .rt-topic { font-weight:600; font-size:14px; }
  .rt-turn { color:var(--acc); font-weight:600; margin-top:2px; }
  .rt-node { position:absolute; width:128px; transform:translate(-50%,-50%); z-index:1; }
  .rt-card { background:#1b2030; border:1px solid var(--line); border-top:2px solid var(--line); border-radius:var(--r); padding:5px 8px 6px; text-align:left; transition:border-color var(--tt),background var(--tt); }
  .rt-card.proposer { border-top-color:var(--acc); }
  .rt-card.reviewer { border-top-color:var(--ok); }
  .rt-card.collaborator { border-top-color:var(--vote); }
  .rt-card.host { border-top-color:#c9a227; }
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
  #helpBtn { font-size:12px; padding:3px 12px; border-radius:99px; color:var(--dim); border:1px solid var(--line); background:transparent; transition:color var(--tt),border-color var(--tt); }
  #helpBtn:hover { color:var(--acc); border-color:var(--acc); }
  .helpbox { background:#141722; border:1px solid var(--line); border-radius:var(--r); padding:10px 12px; white-space:pre-wrap; word-break:break-word; font:12.5px/1.7 ui-monospace,Menlo,monospace; margin:8px 0; }
  #helpModal .dbody h4 { margin:18px 0 6px; font-size:14px; color:var(--acc); }
  #helpModal .dbody h4:first-child { margin-top:0; }
  #helpModal .dbody ul { margin:4px 0; padding-left:20px; }
  #helpModal .dbody li { margin:3px 0; }
  /* 列表筛选 segmented 组 */
  .fbar { display:inline-flex; gap:6px; flex-wrap:wrap; }
  /* 问答类消息徽章（次级描边） */
  .mt-q { color:var(--dim); border-color:var(--line-2); }
  /* 凭证卡分区标题（与 .frm h4 同节奏） */
  .csec { font-size:13px; font-weight:600; margin:16px 0 8px; padding-bottom:5px; border-bottom:1px solid var(--line); }
  /* 一次性凭证大字（可断行） */
  .invite.big { word-break:break-all; font-size:15px; }
  /* 卡片语义描边：金=管理员专属，红=警示 */
  .card.gold { border-color:var(--goldline); }
  .card.alert { border-color:var(--err); }
  /* 警示横幅（人工介入等） */
  .banner.err { color:var(--err); background:rgba(224,92,92,.08); border:1px solid rgba(224,92,92,.5); }
  /* 小号控件（表格行内按钮 / 紧凑下拉）与超小号说明字 */
  .sm { font-size:12px; padding:2px 8px; }
  .xs { font-size:11px; }
  /* 复选行（label 内嵌 checkbox） */
  .chk { display:inline-flex; gap:6px; align-items:center; font-size:13px; cursor:pointer; }
  .chk input { accent-color:var(--acc); }
  /* 就绪对勾 */
  .tick { color:var(--ok); }
  /* 正文内联警示字 */
  .hi-err { color:var(--err); }
  /* 示意图图例色点（与 rt-card 顶边色一致） */
  .lgd { display:inline-flex; gap:10px; align-items:center; white-space:nowrap; }
  .lgd i { font-style:normal; }
  .lgd .proposer { color:var(--acc); }
  .lgd .reviewer { color:var(--ok); }
  .lgd .collaborator { color:var(--vote); }
  .lgd .host { color:#c9a227; }
  .lgd .observer { color:var(--dim); }
  /* 详情页左右分栏：左右等宽 1:1（左=会话与席位档案，右=示意图+我的操作与交付）；窄屏退单列 */
  .dcols { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:0 14px; align-items:start; }
  .dcol { min-width:0; }
  @media (max-width:980px) { .dcols { grid-template-columns:1fr; } }
  /* 合并流类型筛选条（平铺胶囊多选 + 全选） */
  .tbar { display:flex; flex-wrap:wrap; gap:6px; margin:0 0 10px; }
  /* 详情页子卡（观点/交付/资料/请求）与卡网格 */
  .cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:10px; }
  .vcards { display:grid; gap:10px; }
  .vcard,.acard,.dcard,.rcard { background:var(--panel-2); border:1px solid var(--line); border-radius:var(--r); padding:10px 12px; transition:border-color var(--tt),background var(--tt); }
  .vcard { border-top:2px solid var(--line); }
  .vcard.proposer { border-top-color:var(--acc); }
  .vcard.reviewer { border-top-color:var(--ok); }
  .vcard.collaborator { border-top-color:var(--vote); }
  .vcard.host { border-top-color:#c9a227; }
  .vcard .kv { margin:4px 0 0; }
  .rcard { border-left:3px solid var(--line); }
  .rcard.ok { border-left-color:var(--ok); }
  .rcard.err { border-left-color:var(--err); }
  .rcard.warn { border-left-color:var(--warn); }
  /* 执行请求卡可点击（弹详情）；悬停描边高亮 */
  .rcard { cursor:pointer; }
  .rcard:hover { border-color:var(--acc); background:#20263a; }
  /* 问答卡（问询桌详情页通栏）：点击弹完整问答，交互样式与请求卡一致 */
  .qa-item { cursor:pointer; }
  .qa-item:hover { border-color:var(--acc); background:#20263a; }
  /* chatbox 会话视图：己方右侧蓝气泡 / 其他方左侧（角色色左边条）/ 系统提示居中灰胶囊 */
  .cb-list { max-height:460px; overflow:auto; display:flex; flex-direction:column; gap:8px; padding:2px 2px 4px; }
  .cb-row { display:flex; gap:8px; align-items:flex-start; }
  /* 行容器不继承全局 .mine（旧历史面板"给我的指令"高亮）的 inset 蓝描边——我方样式只落在气泡上 */
  .cb-row.mine { flex-direction:row-reverse; border:none; box-shadow:none; }
  .cb-bubble { max-width:80%; border:1px solid var(--line); border-radius:10px; padding:7px 11px; background:var(--panel-2); overflow-wrap:anywhere; }
  .cb-row.other .cb-bubble { border-left:3px solid var(--line); border-top-left-radius:3px; }
  .cb-bubble.role-proposer { border-left-color:var(--acc); }
  .cb-bubble.role-reviewer { border-left-color:var(--ok); }
  .cb-bubble.role-collaborator { border-left-color:var(--vote); }
  .cb-bubble.role-host { border-left-color:#c9a227; }
  .cb-bubble.role-answerer { border-left-color:var(--ok); }
  .cb-bubble.role-asker { border-left-color:var(--acc); }
  .cb-row.mine .cb-bubble { background:#1d2b49; border-top-right-radius:3px; }
  .cb-who { display:flex; gap:6px; align-items:center; font-size:12px; color:var(--dim); margin-bottom:3px; flex-wrap:wrap; }
  .cb-who .rb { font-size:11px; padding:0 6px; }
  .cb-meta { display:flex; gap:6px; align-items:center; flex-wrap:wrap; font-size:11px; color:var(--dim); margin-top:4px; }
  .cb-sys { align-self:center; max-width:94%; text-align:center; font-size:12px; color:var(--dim); background:var(--panel); border:none; border-radius:99px; padding:3px 14px; overflow-wrap:anywhere; }
  .cb-empty { align-self:center; color:var(--dim); font-size:12px; padding:18px 0; }
  /* 折叠子区块（我的席位：会议控制/申请暂停/凭证恢复；状态抗轮询重渲染由 view.seatOpen 承载） */
  details.sec { border:1px solid var(--line); border-radius:var(--r); background:var(--panel-2); margin:10px 0 0; }
  details.sec summary { cursor:pointer; padding:8px 12px; font-size:13px; font-weight:600; display:flex; gap:8px; align-items:center; list-style:none; user-select:none; }
  details.sec summary::-webkit-details-marker { display:none; }
  details.sec summary::before { content:'▸'; color:var(--dim); font-size:11px; transition:transform var(--tt); }
  details.sec[open] summary::before { transform:rotate(90deg); }
  details.sec summary .dim { font-weight:400; }
  details.sec .sec-body { padding:2px 12px 12px; }
  /* composer 输入聚合：类型芯片 + 互斥类型组（切换只改 display，草稿不丢） */
  .cmp-grp { margin-top:10px; }
  .cmp-grp h3 { margin:0 0 6px; }
  /* 时间线阶段分隔条（回合过程轴：阶段变更不再是普通消息条） */
  .phasediv { display:flex; align-items:center; gap:10px; margin:12px 0 8px; font-size:12px; }
  .phasediv::before,.phasediv::after { content:''; flex:1; height:1px; background:var(--line); }
  /* 深色主题滚动条 */
  * { scrollbar-width:thin; scrollbar-color:#333a4d transparent; }
  ::-webkit-scrollbar { width:10px; height:10px; }
  ::-webkit-scrollbar-track { background:transparent; }
  ::-webkit-scrollbar-thumb { background:#333a4d; border-radius:6px; border:2px solid transparent; background-clip:padding-box; }
  ::-webkit-scrollbar-thumb:hover { background:#434d66; background-clip:padding-box; }
  /* 动效偏好：尊重系统减少动态设置 */
  @media (prefers-reduced-motion:reduce) {
    * { animation:none !important; transition:none !important; }
  }
</style>
</head>
<body>
<header>
  <h1>⬡ 智能体协同博弈平台</h1>
  <span id="whoArea"></span>
  <span class="sp"></span>
  <button id="helpBtn" title="系统帮助">？ 帮助</button>
  <span id="loginArea"></span>
</header>
<div id="regBox" class="card" style="display:none">
  <div class="shead"><b>注册新用户</b></div>
  <div class="hint" style="margin:4px 0 8px">注册即创建参与用户（可建桌、凭邀请码入席）。注册并连接后，点右上角「复制账号凭证」交给你的 agent，它建桌/入席即与你同一账号。</div>
  <input id="regName" placeholder="用户名" style="width:100%">
  <div class="row" style="margin-top:8px"><span class="sp"></span><button id="regCancel">取消</button><button id="regGo" class="primary">注册并连接</button></div>
</div>
<main id="app"></main>
<div id="toast"></div>
<script>
'use strict';
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
  chatFilter:'all', cmpType:'', seatOpen:{}, chatAtBottom:true, cbPrevTop:0 };

/* ---------- 常量映射 ---------- */
var PHASE_LABEL = { open:'设定中', qa:'问答', statements:'提案陈述', review:'评审', response:'回应评审', execution:'执行修改', convergence:'共识表决', human_intervention:'人工介入', closed:'已结束' };
var PHASE_CLS = { open:'', statements:'phase', review:'phase', response:'phase', execution:'phase', convergence:'phase', human_intervention:'err', closed:'ok' };
var ROLE_LABEL = { proposer:'提案方', reviewer:'评审方', observer:'观察方', host:'主持人', collaborator:'协作者', answerer:'回答方', asker:'问询方' };
/* 桌类型注册表（构建期自服务端 TABLE_TYPES 注入，与 GET /api/table-types 同源）：id/label/description/flow/roles/uniqueRoles/phaseLabels */
var TABLE_TYPES = ${JSON.stringify(TABLE_TYPES)};
var TT_BY_ID = {}; TABLE_TYPES.forEach(function(t){ TT_BY_ID[t.id] = t; });
function ttOf(id){ return TT_BY_ID[id] || TT_BY_ID.review; }
function typeBadge(tt){ return '<span class="rb ttype" title="'+escAttr(ttOf(tt).description||'')+'">'+esc(ttOf(tt).label)+'</span>'; }
function phaseLabel(tt, ph){ var d = ttOf(tt); return (d.phaseLabels && d.phaseLabels[ph]) || PHASE_LABEL[ph] || ph; }
var STEP_DEFS = [['open','设定'],['statements','陈述'],['review','评审'],['response','回应'],['execution','执行'],['convergence','表决'],['closed','结束']];
var MT_LABEL = { PHASE_CHANGE:'阶段变更', SEAT_JOINED:'入席/设定', SEAT_LEFT:'退席', ARTIFACT_PUBLISHED:'产物发布', DOC_UPLOADED:'资料上传', MINUTES:'会议纪要', CONSENSUS_RESULT:'表决结果', STATEMENT:'提案陈述', REVIEW_COMMENT:'评审意见', RESPONSE:'回应评审', REQUEST:'执行请求', RESPOND_REQUEST:'请求处置', CONSENSUS_VOTE:'表决', QUESTION:'提问', REPLY:'回答', HUMAN_INPUT:'人工指令', HUMAN_RULING:'人工裁决', ESCALATE:'申请介入', INFO:'系统通知', HOST_PREREVIEW:'预审结果', SUPPLEMENT:'补充提交', MEETING_PAUSED:'会议暂停', MEETING_RESUMED:'继续会议', PAUSE_REQUESTED:'暂停申请' };
var MT_CLS = { PHASE_CHANGE:'mt-phase', SEAT_JOINED:'mt-sys', SEAT_LEFT:'mt-sys', ARTIFACT_PUBLISHED:'mt-sys', DOC_UPLOADED:'mt-sys', INFO:'mt-sys', MINUTES:'mt-min', CONSENSUS_RESULT:'mt-min', STATEMENT:'mt-st', REVIEW_COMMENT:'mt-rev', RESPONSE:'mt-rev', REQUEST:'mt-req', RESPOND_REQUEST:'mt-req', CONSENSUS_VOTE:'mt-vote', QUESTION:'mt-q', REPLY:'mt-q', HUMAN_INPUT:'mt-human', HUMAN_RULING:'mt-human', ESCALATE:'mt-human', HOST_PREREVIEW:'mt-phase', SUPPLEMENT:'mt-st', MEETING_PAUSED:'mt-req', MEETING_RESUMED:'mt-phase', PAUSE_REQUESTED:'mt-human' };
var CHAT_SPEECH={STATEMENT:1,REVIEW_COMMENT:1,RESPONSE:1,SUPPLEMENT:1,CONSENSUS_VOTE:1,ARTIFACT_PUBLISHED:1,REQUEST:1,RESPOND_REQUEST:1,QUESTION:1,REPLY:1};
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
    var need,rolesOk;
    if(ttOf(t.tableType).flow==='inquiry'){
      need=seats.filter(function(s){ return s.role==='answerer'; });
      rolesOk=need.length>0;
    }else{
      need=seats.filter(function(s){ return s.role!=='host'; });
      rolesOk=seats.some(function(s){ return s.role==='proposer'; })&&seats.some(function(s){ return s.role==='reviewer'; });
    }
    return (rolesOk&&need.length>0&&need.every(function(s){ return s.config&&s.config.ready; }))?'ready':'prep';
  }
  if(t.pause) return 'paused';
  return 'running';
}
var PRV_LABEL = { pass:'通过', redirect:'点名补充', skipped:'跳过（放行）' };
var SEV_LABEL = { must:'必须', should:'建议', nice:'可选' };
/** 消息 → 展示正文（chatbox 气泡渲染用；HOST_PREREVIEW 点名带席位名） */
function msgBodyText(m,seats){
  var p=m.payload||{}, body='';
  if(typeof p.text==='string') body=p.text;
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
  else if(m.type==='MEETING_PAUSED') body='会议暂停 by '+(p.byName||'')+'（'+(ROLE_LABEL[p.byRole]||p.byRole||'')+'）'+(p.via==='request'&&p.requestedByName?('，经 '+p.requestedByName+' 申请'):'')+(p.reason?('：'+p.reason):'')+'；'+(p.note||'');
  else if(m.type==='MEETING_RESUMED') body='继续会议 by '+(p.byName||'')+'，恢复到「'+(PHASE_LABEL[p.phase]||p.phase||'')+'」'+(p.forced?'［强制 · 跳过就绪检查］':'');
  else if(m.type==='PAUSE_REQUESTED') body=(p.byName||'')+'（'+(ROLE_LABEL[p.byRole]||p.byRole||'')+'）申请暂停'+(p.reason?('：'+p.reason):'')+' — 等待 主持人/建桌人/系统管理员 同意';
  else if(m.type==='MINUTES') body='纪要已生成（全文见「会议纪要」区）';
  else { try{ body=JSON.stringify(p).slice(0,200); }catch(e){} }
  return body;
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
  return head
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
    +'<ul><li><b>① 创建圆桌</b>：列表页「创建圆桌」，先选<b>桌类型</b>（评审 / 协作 / 头脑风暴 / 方案决策 / 问询，决定流程与可选角色），再选<b>我的角色</b>（自建桌 = 你以所选角色直接入席参会，角色任选——评审桌也能当评审方；选「主持人」= 主持人建桌，只定规则、传资料、邀请调度与开局；问询桌可选「问询方」= 你提问，或「主持人」= 由别人凭问询方邀请码来提问），按类型勾选开放邀请的角色，填写主题 / 目标 / 规则等；创建后凭证卡一次性展示席位 token 与各角色邀请码（自建问询桌你即问询方、不占席位，无席位 token）。</li>'
    +'<li><b>② 邀请参与方</b>：把「完整邀请」整体发给参与方，交给其 agent 即可凭邀请码自动入席（角色由邀请码定死，席位不能自封）；主持人建的问询桌另发「问询方」码，由要提问的人在本页凭码就位。</li>'
    +'<li><b>③ 设定并开始</b>：各席位在桌详情完成入桌设定（立场 / 讨论范围 / 数据范围 / 就绪），全员就绪后建桌人（主持人桌为主持人）点「▶ 开始会议」；问询桌由问询方点「▶ 开始问询」。</li></ul>'
    +'<h4>会议阶段</h4>'
    +'<p>阶段按桌类型走不同流程：<b>评审 / 方案决策</b>：设定 → 陈述 → 评审 → 回应 → 执行 → 表决 → 结束；<b>协作 / 头脑风暴</b>：设定 → 初稿发布 → 互审补缺 → 缺口认领 → 补齐执行 → 定稿表决 → 结束；<b>问询</b>：设定 → 问答 → 结束。结束自动生成纪要（问询桌为问答对汇总的问询纪要）；僵局时转人工介入，人工裁决可收会或恢复指定阶段；评审/协作类桌的各方回合提交会先经系统预审，需要补充时会被点名。</p>'
    +'<h4>席位角色</h4>'
    +'<ul><li><b>提案方</b>（proposer）：发布产物、提案陈述、逐条回应评审意见；</li>'
    +'<li><b>评审方</b>（reviewer）：must / should / nice 结构化评审，可被请求协助修改；</li>'
    +'<li><b>协作者</b>（collaborator，协作/头脑风暴桌）：发布自己负责部分初稿、互审补缺、认领处置指向自己产物的意见、支援他人补缺；</li>'
    +'<li><b>主持人</b>（host，主持人建桌模式）：只定规则、传共享资料、邀请各方与调度开局，不参与评审协作；无需入桌设定，豁免就绪；</li>'
    +'<li><b>回答方</b>（answerer，问询桌）：凭邀请码入席并声明回答范围，范围内给出有依据的作答，超范围明确说明并拒答；</li>'
    +'<li><b>问询方</b>（asker，问询桌）：不占席位——自建问询桌即建桌人，主持人建的问询桌凭「问询方」邀请码经网页就位；在网页提问（可定向某回答席或广播全体各自作答）与结束问询；</li>'
    +'<li><b>观察方</b>（observer）：只读旁听，无表决权。</li></ul>'
    +'<h4>暂停与继续</h4>'
    +'<ul><li>进行中的会议可暂停：主持人 / 建桌人 / 系统管理员在桌详情「会议控制」直接暂停；其他席位可「申请暂停」，待其同意后生效（问询桌由问询方控制）；</li>'
    +'<li>暂停期发言与阶段推进冻结：各方在「会话」输入框补充信息、在「我的席位」调整立场后勾选「重新就绪」（无需补充的席位保持就绪即可）；全员就绪后控制人点「▶ 继续会议」恢复到原阶段，系统管理员可强制继续。</li></ul>'
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
  var CX=280, RX=210, RY=110;
  /* 九宫格方位（1左上 2正上 3右上 4左中 6右中 7左下 8正下 9右下；5=桌面）：
     左右列成对展开——每列 1 席=中、2 席=上下角、3 席=角+中、4 席再补正上（左）/正下（右）；正上/正下最后启用 */
  var GRID={ '1':[-0.707,-0.707], '2':[0,-1], '3':[0.707,-0.707], '4':[-1,0], '6':[1,0], '7':[-0.707,0.707], '8':[0,1], '9':[0.707,0.707] };
  function gridSlots(n){
    var L=Math.floor(n/2), R=n-L;
    var left={ '1':[4], '2':[1,7], '3':[1,4,7], '4':[1,2,4,7] };
    var right={ '1':[6], '2':[3,9], '3':[3,6,9], '4':[3,6,8,9] };
    return (left[L]||[]).concat(right[R]||[]);
  }
  var gslots=gridSlots(slots);
  /* 高度按实际占用行分档（席位少时压缩上下空白）：仅中行 180 / 含上下角 290 / 含正上正下 360；CY 随档位垂直居中 */
  var gys=gslots.map(function(k){ return GRID[k][1]; });
  var gspan=Math.max.apply(null,gys)-Math.min.apply(null,gys);
  var STAGE_H=gspan>=1.9?360:(gspan>=0.5?290:180);
  var CY=STAGE_H/2;
  var h='<div class="card"><div class="shead"><b>圆桌示意图</b>'
    +'<span class="dim">'+(folded
      ?('共 '+seats.length+' 席 · 九宫格方位优先显示发言权/建桌人/最近发言的前 '+(RING_MAX-1)+' 席')
      :(seats.length+' 席全员就座'))
    +'</span><span class="sp"></span>'
    +'<span class="dim lgd"><i class="proposer">●</i>提案方<i class="reviewer">●</i>评审方<i class="collaborator">●</i>协作者<i class="host">●</i>主持人<i class="observer">●</i>观察方<span>· 思考进度 = 当前发言权</span></span></div>'
    +'<div class="rt-wrap"><div class="rt-stage" style="height:'+STAGE_H+'px">'
    +'<div class="rt-ell"></div>'
    +'<div class="rt-center"><div class="rt-topic">'+esc(clipStr(t.topic,18))+'</div>'
    +'<div style="margin:4px 0">'+phaseBadge(t.phase,t.roundNo,t.tableType)+'</div>';
  if(turn){
    h+='<div class="rt-turn">'+esc(seatName(seats,turn.seatId))+' '+turnStageLabel(t.turnProgress)+'</div>'
      +'<div class="dim xs">'+esc(clipStr(turn.taskHint,26))+'</div>';
  }
  else if(t.phase==='closed'){ h+='<div class="dim">会议已结束</div>'; }
  else if(t.pause){ h+='<div style="color:var(--warn)">⏸ 会议已暂停</div>'; }
  else if(t.phase==='human_intervention'){ h+='<div style="color:var(--err)">等待人工介入</div>'; }
  else { h+='<div class="dim">等待推进</div>'; }
  h+='</div>';
  ringSeats.forEach(function(s,idx){
    var g=GRID[gslots[idx]]||[0,0];
    var x=CX+g[0]*RX, y=CY+g[1]*RY;
    var lm=lastOf[s.seatId], di=lastDelivInfo(lm);
    var dl=lm?di.label:(t.phase==='open'?(((s.config&&s.config.ready)?'已就绪':'未就绪')):'尚未发言');
    var think=s.seatId===turnId;
    h+='<div class="rt-node'+(think?' think':'')+'" style="left:'+Math.round(x)+'px;top:'+Math.round(y)+'px"'
      +' title="'+escAttr(s.name+'（'+(ROLE_LABEL[s.role]||s.role)+' · agent: '+s.agentLabel+'）'+(lm?('｜最后交付：'+di.full+'（'+fmtTs(lm.ts)+'）'):'（尚未发言）'))+'">'
      +'<div class="rt-card '+esc(s.role)+'">'
      +'<div class="rt-nm">'+esc(s.name)+(s.seatId===t.ownerSeat?' <span class="rt-owner" title="建桌人">★</span>':'')+'</div>'
      +'<div class="rt-tags">'+roleBadge(s.role)+(think?'<span class="rt-think">● '+turnStageLabel(t.turnProgress)+'</span>':'')+'</div>'
      +'<div class="rt-dl">'+esc(dl)+'</div>'
      +'</div></div>';
  });
  if(folded){
    var gm=GRID[gslots[slots-1]]||[0,0];
    h+='<div class="rt-node rt-more" id="rtMore" style="left:'+Math.round(CX+gm[0]*RX)+'px;top:'+Math.round(CY+gm[1]*RY)+'px"'
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
  closeAcctMenu();
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
    +(admin?' <span class="wbadge admin">系统观察员 · 全局观察模式</span>':' <span class="wbadge user">参与用户</span>');
  la.innerHTML=(admin?'<button id="adminBtn">管理台</button>':'')
    +'<button id="acctBtn" title="复制含用户 token 的账号凭证，交给自己的 agent 保持同一身份">复制账号凭证</button>'
    +'<button id="acctSwBtn" title="本浏览器记录的帐号间切换；也可在这里登录其他帐号">帐号</button>'
    +'<button id="logoutBtn">退出</button>';
  if(admin) document.getElementById('adminBtn').onclick=openAdmin;
  document.getElementById('acctBtn').onclick=function(){
    copyText(accountCredentialText());
    toast('账号凭证已复制（含登录 token，只交给自己的 agent）');
  };
  document.getElementById('acctSwBtn').onclick=toggleAcctMenu;
  document.getElementById('logoutBtn').onclick=doLogout;
}
/* 多帐号切换浮层：点选即改活跃帐号并整页重载（切换后无旧帐号视图态残留）；
   底部「登录其他帐号」= 已登录状态下补登（填 token 连接并切换，已有登录态全保留） */
function toggleAcctMenu(){
  var old=document.getElementById('acctMenu');
  if(old){ old.remove(); return; }
  var btn=document.getElementById('acctSwBtn');
  var rc=btn.getBoundingClientRect();
  var m=document.createElement('div');
  m.className='acctmenu'; m.id='acctMenu';
  m.style.top=(rc.bottom+6)+'px';
  m.style.right=Math.max(8,window.innerWidth-rc.right)+'px'; m.style.left='auto';
  var h='<div class="ah">切换帐号（页面将重新载入）</div>';
  ACCOUNTS.forEach(function(a){
    var cur=a.token===TOKEN;
    h+='<div class="ai'+(cur?' cur':'')+'" data-tk="'+escAttr(a.token)+'">'
      +(cur?'<span class="badge ok">当前</span>':'<span style="width:40px"></span>')
      +'<span><b>'+esc(a.name||'未命名')+'</b>'
      +'<div class="sub">'+(a.role==='systemadmin'?'系统观察员':'参与用户')+'</div></span>'
      +'</div>';
  });
  h+='<div class="ai" id="acctAddRow" style="border-top:1px solid var(--line);margin-top:4px;padding-top:8px">'
    +'<span style="width:40px;text-align:center;color:var(--acc)">＋</span>'
    +'<span><b style="color:var(--acc)">登录其他帐号</b>'
    +'<div class="sub">粘贴该帐号的用户 token 连接；登录后切换过去，当前与已记录帐号都保留，可随时切回</div></span>'
    +'</div>';
  m.innerHTML=h;
  m.addEventListener('click',function(e){
    var addRow=e.target.closest?e.target.closest('#acctAddRow'):null;
    if(addRow){ m.remove(); toggleAddAcctMenu(); return; }
    var it=e.target.closest?e.target.closest('.ai'):null;
    if(!it) return;
    var tk=it.getAttribute('data-tk');
    if(!tk||tk===TOKEN) { m.remove(); return; }
    var a=ACCOUNTS.filter(function(x){ return x.token===tk; })[0];
    if(a&&a.userId) localStorage.setItem('rt_active_uid',a.userId);
    location.reload(); // 切换帐号：重载页面，以新登录态重新初始化
  });
  document.body.appendChild(m);
  setTimeout(function(){
    document.addEventListener('click',function close(ev){
      if(!m.contains(ev.target)&&ev.target!==btn){ m.remove(); document.removeEventListener('click',close); }
    });
  },0);
}
/* 已登录状态下补登其他帐号（填 rtu_ token）：验证→记录→切换，不动已有帐号 */
function toggleAddAcctMenu(){
  var old=document.getElementById('acctAdd');
  if(old){ old.remove(); return; }
  var btn=document.getElementById('acctSwBtn');
  var rc=btn.getBoundingClientRect();
  var m=document.createElement('div');
  m.className='acctmenu'; m.id='acctAdd';
  m.style.top=(rc.bottom+6)+'px';
  m.style.right=Math.max(8,window.innerWidth-rc.right)+'px'; m.style.left='auto';
  m.innerHTML='<div class="ah">登录其他帐号</div>'
    +'<div style="padding:4px 11px 10px">'
    +'<input id="addAcctTk" placeholder="用户 token（rtu_…）" style="width:100%">'
    +'<div class="sub" style="margin:6px 0 8px">连接后切换到该帐号；当前与已记录帐号都保留，可随时切回（agent 给的登录链接同样适用）</div>'
    +'<div class="row" style="justify-content:flex-end"><button id="addAcctCancel">取消</button><button id="addAcctGo" class="primary">连接并切换</button></div>'
    +'</div>';
  document.body.appendChild(m);
  var close=function(){ m.remove(); };
  document.getElementById('addAcctCancel').onclick=close;
  document.getElementById('addAcctGo').onclick=doAddAccount;
  var inp=document.getElementById('addAcctTk');
  inp.focus();
  inp.addEventListener('keydown',function(e){ if(e.key==='Enter') doAddAccount(); });
  setTimeout(function(){
    document.addEventListener('click',function closer(ev){
      if(!m.contains(ev.target)&&ev.target!==btn){ m.remove(); document.removeEventListener('click',closer); }
    });
  },0);
}
function doAddAccount(){
  var tk=(document.getElementById('addAcctTk').value||'').trim();
  if(!tk){ toast('请输入 token'); return; }
  fetch('/api/me',{ headers:{ authorization:'Bearer '+tk } })
    .then(function(r){ return r.json().then(function(j){ if(!r.ok) throw new Error((j.error&&j.error.message)||('HTTP '+r.status)); return j.data; }); })
    .then(function(me){
      var m=document.getElementById('acctAdd'); if(m) m.remove();
      TOKEN=tk; // 先换 token 再 upsert（活跃指针以新帐号为准）
      accountUpsert({ token:tk, userId:me.userId||'', name:me.name||'', role:me.role||'user' });
      view.userName=me.name||''; view.userId=me.userId||''; view.role=me.role||'user';
      refreshWho(); toast('已登录并切换：'+(me.name||''));
      var tid=routeTableId();
      if(tid) openTable(tid); else openList();
    })
    .catch(function(e){ toast('连接失败：'+e.message); });
}
function closeAcctMenu(){ ['acctMenu','acctAdd'].forEach(function(id){ var m=document.getElementById(id); if(m) m.remove(); }); }
function fetchMe(){
  return api('GET','/api/me').then(function(me){
    view.userName=me.name||''; view.userId=me.userId||''; view.role=me.role||'user';
    /* 回写帐号记录（名称/角色可能已被管理员调整） */
    var a=ACCOUNTS.filter(function(x){ return x.token===TOKEN; })[0];
    if(a){ a.name=view.userName; a.userId=view.userId; a.role=view.role; saveAccounts(); if(view.userId) localStorage.setItem('rt_active_uid',view.userId); }
    refreshWho();
  }).catch(function(){});
}
function doLogin(){
  TOKEN=document.getElementById('token').value.trim();
  if(!TOKEN){ toast('请输入 token'); return; }
  api('GET','/api/me').then(function(me){
    accountUpsert({ token:TOKEN, userId:me.userId||'', name:me.name||'', role:me.role||'user' });
    view.userName=me.name||''; view.userId=me.userId||''; view.role=me.role||'user';
    refreshWho();
    var tid=routeTableId(); // 打开的是分享链时，连接后直达该桌详情
    if(tid) openTable(tid); else openList();
  }).catch(function(e){ toast('连接失败：'+e.message); TOKEN=activeAcct?activeAcct.token:''; });
}
function doLogout(){
  var rest=ACCOUNTS.filter(function(a){ return a.token!==TOKEN; });
  if(rest.length){ // 还有其他帐号：移除当前，自动切到第一个并重载
    ACCOUNTS=rest; saveAccounts();
    localStorage.setItem('rt_active_uid',rest[0].userId||rest[0].token);
    location.reload();
    return;
  }
  ACCOUNTS=[]; saveAccounts();
  localStorage.removeItem('rt_active_uid');
  TOKEN=''; view.userName=''; view.userId=''; view.role='user';
  ['rt_token','rt_user_name','rt_user_id','rt_role'].forEach(function(k){ localStorage.removeItem(k); });
  clearInterval(view.timer); view.mode='intro';
  if((location.hash||'')!=='') history.replaceState(null,'',location.pathname+location.search); // 登出清路由，避免残留详情 hash
  refreshWho(); renderIntro();
  document.getElementById('regBox').style.display='none';
}
document.getElementById('regCancel').onclick=function(){ document.getElementById('regBox').style.display='none'; };
document.getElementById('regGo').onclick=function(){
  var name=document.getElementById('regName').value.trim();
  if(!name){ toast('请输入用户名'); return; }
  api('POST','/api/users',{name:name}).then(function(d){
    TOKEN=d.token;
    accountUpsert({ token:d.token, userId:d.userId||'', name:d.name||name, role:d.role||'user' });
    view.userName=d.name||name;
    document.getElementById('regBox').style.display='none';
    fetchMe(); toast('已注册并连接');
    var tid=routeTableId();
    if(tid) openTable(tid); else openList();
  }).catch(function(e){ toast('注册失败：'+e.message); });
};

/* ---------- 视图：未连接引导 ---------- */
function renderIntro(){
  var app=document.getElementById('app');
  app.innerHTML='<div class="card">'
    +'<b>欢迎使用智能体协同博弈平台</b>'
    +'<div class="kv" style="margin-top:8px"><span class="k">①</span>有 agent 的账号：让你的 agent「连接圆桌」，它会给你一条网页登录链接（10 分钟内一次有效），点开即自动登录</div>'
    +'<div class="kv"><span class="k">②</span>已有 token：点右上角输入用户 token 连接（多账号会一并记录，右上角可随时切换）</div>'
    +'<div class="kv"><span class="k">③</span>新用户：点「注册新用户」，注册即创建参与用户（可建桌、凭邀请码入席）</div>'
    +'</div>'
    +'<div class="card"><div class="row"><b>让 agent 接入本系统</b><span class="sp"></span><button id="introHelpMore">查看完整帮助</button></div>'
    +'<div class="hint" style="margin:6px 0">把下面的指令整体复制给你的 agent（zcode / claude / codex…），它会自动完成技能安装与账号准备（已注册则复用你的账号），之后即可建桌或凭邀请码入席参会：</div>'
    +'<pre class="helpbox">'+esc(agentAccessText())+'</pre>'
    +'<div class="row"><button id="introAgentCopy" class="primary">复制 agent 接入指令</button>'
    +'<span class="dim">agent 连接圆桌后会给你一条网页登录链接，点开即与它同一账号（也可用 token：注册返回的 rtu_… 即本页登录凭证，粘贴到右上角连接；已注册用户登录后用右上角「复制账号凭证」发给 agent，两边即同一账号）</span></div></div>';
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
  if(admin) h+='<div class="banner admin"><b>全局观察模式</b> — 你正以系统观察员身份查看全部圆桌（非桌参与方视角；在本桌无席位时为只读观察）。</div>';
  var fb=function(id,lbl){ return '<button class="fbtn'+(view.listFilter===id?' on':'')+'" data-f="'+id+'">'+lbl+'</button>'; };
  h+='<div class="row" style="margin-bottom:14px"><b style="font-size:16px">圆桌列表</b><span class="dim">'+(admin?'全部 ':'我参与的 ')+view.listTables.length+' 桌</span>'
    +'<span class="fbar">'+fb('all','全部')+fb('active','进行中')+fb('closed','已结束')+(admin?fb('mine','我的桌'):'')+'</span>'
    +'<span class="sp"></span><button id="refreshList">刷新</button><button id="joinByCode">凭邀请码入桌</button><button id="createTable" class="primary">创建圆桌</button></div>';

  if(!view.listTables.length){
    h+='<div class="card dim">'+(admin
      ?'全服务器还没有圆桌。点右上「创建圆桌」建一张。'
      :'你还没有参与的圆桌。点右上「创建圆桌」建一张；收到邀请码可点「凭邀请码入桌」直接入席，或把「完整邀请」交给你的 agent 参会。')+'</div>';
  } else if(!list.length){
    h+='<div class="card dim">'+((view.listFilter==='mine'&&admin)?'筛选「我的桌」无结果：你还没有在任何圆桌持有席位（可创建圆桌或凭邀请码入席）。':'该筛选下暂无圆桌。')+'</div>';
  }
  h+='<div class="tables">';
  list.forEach(function(t){
    h+='<div class="card tcard" data-tid="'+esc(t.tableId)+'">'
      +'<div class="row" style="align-items:flex-start"><b class="t-title">'+esc(t.topic)+'</b><span class="sp"></span>'+phaseBadge(t.phase,0,t.tableType)+(t.paused?'<span class="badge warn">⏸</span>':'')+'</div>'
      +'<div class="row" style="margin-top:8px">'+typeBadge(t.tableType)
      +(t.mySeatRole?roleBadge(t.mySeatRole)+' <span class="dim">我的席位'+(t.mySeatName?'：'+esc(t.mySeatName):'')+'</span>':'')+'</div>'
      +'<div class="dim" style="margin-top:8px">'+esc(t.tableId)+' · '+t.seatCount+' 席 · 创建于 '+fmtTs(t.createdAt)+'</div>'
      +'</div>';
  });
  h+='</div>';
  /* 帮助速览（列表页底部）：主帮助信息 + 完整帮助/复制接入指令入口 */
  h+='<div class="card"><div class="row"><b>帮助速览</b><span class="sp"></span>'
    +'<button id="footAgentCopy">复制 agent 接入指令</button><button id="footHelpMore">查看完整帮助</button></div>'
    +'<div class="kv" style="margin-top:6px"><span class="k">开桌</span>创建圆桌（先选桌类型：评审/协作/头脑风暴/方案决策/问询；再选我的角色：以任一角色自建入席，或选主持人只管规则与调度；问询桌可选问询方或主持人）→ 复制「完整邀请」发给参与方（对方 agent 凭邀请码自动入席）→ 各席完成入桌设定，全员就绪后建桌人/主持人点「开始会议」（问询桌由问询方开始问询）。</div>'
    +'<div class="kv"><span class="k">接入</span>agent 先装圆桌技能（读取 '+esc(location.origin)+'/skill.md 自装），再做账号准备：已注册的持有人直接把「账号凭证」（右上角可复制）发给 agent；未注册的由 agent 注册。agent 每次连接圆桌后会给持有人一条网页登录链接（10 分钟内一次有效，点开即登录同一账号）；多个帐号登录后可在右上角切换。</div>'
    +'<div class="kv"><span class="k">介入</span>桌详情「会话」区看各方发言（我方右侧/其他方左侧/系统居中），其下输入框可切换 公开补充（可定向）/ 私有指令（仅本席 agent 可见）/ 人工指令，轮到本席时可代答；另可上传投屏资料（共享=全桌可读）、恢复 / 替代 agent 凭证。</div>'
    +'<div class="kv"><span class="k">暂停</span>进行中的会议可暂停（主持人/建桌人/系统管理员直接暂停，其他席位申请待同意；问询桌由问询方控制）；暂停期各方调整立场/补充信息并重新就绪，全员就绪后继续，恢复到原阶段。</div></div>';
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
  var h='<div class="row" style="margin-bottom:12px"><span class="back" id="admBack">← 返回列表</span><span class="sp"></span><b>管理台 · 用户</b><span class="dim">'+users.length+' 个用户</span><button id="admRefresh">刷新</button></div>';
  h+='<div class="hint" style="margin-bottom:10px">授予/撤销管理员与禁用/启用均即时生效并写入审计；禁用 = 该用户 token 立即失效（agent 席位不受影响），可随时恢复。服务端只存 token 哈希、原始 token 不可取回：要把某用户接入浏览器登录，用「重签token」生成新登录 token（旧的立即失效，新 token 只显示这一次）。</div>';
  if(adminIssuedToken){
    h+='<div class="card alert" style="margin-bottom:10px">'
      +'<b>新登录 token · '+esc(adminIssuedToken.name)+'</b>（只显示这一次，刷新后不可再查）'
      +'<div class="row" style="margin:8px 0"><input id="admNewToken" readonly value="'+escAttr(adminIssuedToken.token)+'" style="flex:1;min-width:260px">'
      +'<button class="primary" id="admCopyToken">复制 token</button></div>'
      +'<div class="hint">已复制即可粘贴到右上角登录框连接（浏览器 token 登录用它，不是 userId）；旧 token 已失效。</div></div>';
    adminIssuedToken=null;
  }
  h+='<div class="card" style="overflow:auto"><table><tr><th>用户名</th><th>userId</th><th>角色</th><th>状态</th><th>注册</th><th>参桌</th><th>操作</th></tr>';
  users.forEach(function(u){
    var isSelf=u.userId===view.userId;
    h+='<tr><td><b>'+esc(u.name)+'</b>'+(isSelf?' <span class="badge">我</span>':'')+'</td>'
      +'<td class="dim">'+esc(u.userId)+' <button class="admCopyId sm" data-uid="'+escAttr(u.userId)+'">复制</button></td>'
      +'<td>'+(u.role==='systemadmin'?'<span class="wbadge admin">系统观察员</span>':'<span class="wbadge user">参与用户</span>')+'</td>'
      +'<td><span class="badge '+(u.disabled?'err':'ok')+'">'+(u.disabled?'已禁用':'正常')+'</span></td>'
      +'<td class="dim">'+fmtTs(u.createdAt)+'</td>'
      +'<td>'+u.seatCount+' <span class="dim">桌</span></td>'
      +'<td><button class="admSeats sm" data-uid="'+escAttr(u.userId)+'" data-name="'+escAttr(u.name)+'">参桌</button> '
      +'<button class="admRole sm" data-uid="'+escAttr(u.userId)+'" data-name="'+escAttr(u.name)+'" data-to="'+(u.role==='systemadmin'?'user':'systemadmin')+'">'+(u.role==='systemadmin'?'撤销管理员':'设为管理员')+'</button> '
      +'<button class="admDis sm'+(u.disabled?'':' danger')+'" data-uid="'+escAttr(u.userId)+'" data-name="'+escAttr(u.name)+'" data-to="'+(u.disabled?'enable':'disable')+'">'+(u.disabled?'启用':'禁用')+'</button> '
      +'<button class="admToken sm danger" data-uid="'+escAttr(u.userId)+'" data-name="'+escAttr(u.name)+'">重签token</button></td></tr>';
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
        +'<td>'+phaseBadge(r.phase,0,r.tableType)+'</td>'
        +'<td>'+esc(r.seatName)+'</td>'
        +'<td>'+roleBadge(r.role)+'</td>'
        +'<td><span class="badge '+(r.status==='active'?'ok':'warn')+'">'+esc(r.status)+'</span></td>'
        +'<td>'+(r.ready?'<span class="tick">✓</span>':'—')+'</td>'
        +'<td><button class="autGo sm" data-tid="'+escAttr(r.tableId)+'">进入圆桌</button></td></tr>';
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
  var h='<div class="row" style="margin-bottom:12px"><span class="back" id="ctBackList">← 返回列表</span><span class="sp"></span><b>创建圆桌</b><span class="dim" id="ctModeHint"></span></div>';
  h+='<div class="card frm">'
    +'<h4>基本信息</h4>'
    +'<div class="frow"><label class="t">桌类型 <b>*</b></label><div id="ctTypeRow" class="rchoice two">'
    +TABLE_TYPES.map(function(tt){
      return '<label><input type="radio" name="ctType" value="'+esc(tt.id)+'"'+(tt.id==='review'?' checked':'')+'><span><b>'+esc(tt.label)+'</b><br><span class="hint" style="margin:0">'+esc(tt.description||'')+'</span></span></label>';
    }).join('')
    +'</div><div class="hint">类型决定流程语义与可选角色；开桌后不可更改</div></div>'
    +'<div class="frow"><label class="t">我的角色</label><div id="ctRoleRow" class="rchoice two"></div>'
    +'<div class="hint">自建桌＝你以所选角色入席直接参会；选「主持人」＝主持人建桌（只管规则/资料/邀请与调度，不参与评审协作）。问询桌选「问询方」＝你就是要提问的人</div></div>'
    +'<div class="frow"><label class="t">开放邀请的角色</label><div class="cchoice" id="ctRoles"></div><div class="hint" id="ctRolesHint"></div></div>'
    +'<div class="frow"><label class="t" for="ctTopic">主题 <b>*</b></label><input id="ctTopic" placeholder="如「v2 接口文档评审」「产品白皮书协作撰写」"><div class="hint">一句话说清这桌评什么/协作什么</div></div>'
    +'<div class="frow"><label class="t" for="ctGoals">目标共识</label><input id="ctGoals" placeholder="本次要达成什么（可选）"><div class="hint">会议结束时希望各方同意的结论</div></div>'
    +'<div class="frow"><label class="t" for="ctDeliverables">期望交付物</label><input id="ctDeliverables" placeholder="如「修订后的 api.md」（可选）"></div>'
    +'<h4>桌规则与角色安排</h4>'
    +'<div class="frow"><label class="t" for="ctRules">桌规则</label><textarea id="ctRules" placeholder="供各方 agent 阅读遵守，如「逐条审阅」「互审补缺、认领必达」（可选）"></textarea></div>'
    +'<div class="frow"><label class="t" for="ctRolePlan">角色安排说明</label><textarea id="ctRolePlan" placeholder="对各参与方职责的补充描述，随邀请码发给各方（可选）"></textarea></div>'
    +'<h4 id="ctSeatTitle">我的席位</h4>'
    +'<div class="frow"><label class="t" for="ctSeatName">席位名 <b>*</b></label><input id="ctSeatName"'+(view.userName?' value="'+escAttr(view.userName)+'"':' placeholder="你的显示名"')+'></div>'
    +'<div class="frow"><label class="t" for="ctAgent">agent 标识（选填）</label><input id="ctAgent" placeholder="如 zcode / claude；留空 = human-only（先由人工参与，agent 后续接入）"></div>'
    +'<h4>高级参数（留空用默认）</h4>'
    +'<div class="row"><div class="frow" style="flex:1"><label class="t" for="ctRounds">评审轮次上限（默认 2）</label><input id="ctRounds" type="number" min="1" max="10"></div>'
    +'<div class="frow" style="flex:1"><label class="t" for="ctTurnSec">发言超时秒（默认 300）</label><input id="ctTurnSec" type="number" min="30"></div></div>'
    +'<div class="ferr" id="ctErr"></div>'
    +'<div class="row" style="margin-top:10px"><button id="ctCancel">取消</button><span class="sp"></span><button id="ctSubmit" class="primary">创建</button></div>'
    +'</div>';
  app.innerHTML=h;
  var lastRole=null; /* 类型切换时尽量保留已选角色（不在新类型角色集时回落默认） */
  function ctType(){ var r=document.querySelector('input[name="ctType"]:checked'); return r?r.value:'review'; }
  function ctRole(){ var r=document.querySelector('input[name="ctRole"]:checked'); return r?r.value:''; }
  function ctHosted(){ return ctRole()==='host'; }
  function dfltRole(tt){ return tt.flow==='inquiry'?'asker':(tt.flow==='collab'?'collaborator':'proposer'); }
  function roleOptions(tt){
    if(tt.flow==='inquiry'){
      return [
        {v:'asker',t:'问询方',d:'我就是提问的人：不占席位，在本页开始问询、提问与结束'},
        {v:'host',t:'主持人',d:'主持人建桌：问询方凭「问询方」邀请码由人经网页就位'}
      ];
    }
    var d=dfltRole(tt);
    var opts=tt.roles.map(function(r){ return {v:r,t:(ROLE_LABEL[r]||r),d:'自建：我以'+(ROLE_LABEL[r]||r)+'身份入席直接参会'+(r===d?'（常用）':'')}; });
    opts.push({v:'host',t:'主持人',d:'主持人建桌：我只管规则/资料/邀请与调度，不参与评审协作'});
    return opts;
  }
  function ctInvitable(){
    var tt=ttOf(ctType()), role=ctRole(), hosted=ctHosted();
    /* 问询桌：自建=问询方（不占席位）全部参与角色可邀；主持人建=加发「问询方」码（由人凭码就位） */
    if(tt.flow==='inquiry') return hosted?['asker'].concat(tt.roles.slice()):tt.roles.slice();
    /* self 模式去掉建桌人已占的唯一角色（协作流 collaborator 可多席，保留） */
    return tt.roles.filter(function(r){ return !(hosted===false && tt.uniqueRoles.indexOf(r)>=0 && r===role); });
  }
  function ctRolesSel(){
    var sel=[];
    document.querySelectorAll('input[name="ctInvRole"]:checked').forEach(function(c){ sel.push(c.value); });
    return sel;
  }
  function syncType(){
    var tt=ttOf(ctType());
    var opts=roleOptions(tt);
    var vals=opts.map(function(o){ return o.v; });
    var keep=(lastRole&&vals.indexOf(lastRole)>=0)?lastRole:dfltRole(tt);
    document.getElementById('ctRoleRow').innerHTML=opts.map(function(o){
      return '<label><input type="radio" name="ctRole" value="'+esc(o.v)+'"'+(o.v===keep?' checked':'')+'><span><b>'+esc(o.t)+'</b><br><span class="hint" style="margin:0">'+esc(o.d)+'</span></span></label>';
    }).join('');
    document.querySelectorAll('input[name="ctRole"]').forEach(function(r){ r.onchange=syncRole; });
    lastRole=keep;
    syncRole();
  }
  function syncRole(){
    var tt=ttOf(ctType()), role=ctRole(), hosted=ctHosted(), inq=tt.flow==='inquiry';
    var invitable=ctInvitable();
    document.getElementById('ctRoles').innerHTML=invitable.map(function(r){
      return '<label><input type="checkbox" name="ctInvRole" value="'+esc(r)+'" checked> '+(ROLE_LABEL[r]||r)+'</label>';
    }).join('');
    document.getElementById('ctRolesHint').textContent =
      (inq
        ?(hosted
          ?'主持人建问询桌：把「问询方」邀请码发给要提问的人（其在本页凭码就位、开始与结束问询），「回答方」码发给各 agent；'
          :'问询桌：把「回答方」邀请码发给各 agent（凭码入席后各自声明回答范围），你是问询方、在详情页网页提问；')
        :(tt.flow==='collab'&&!hosted?'协作类桌需至少 2 位协作者（含你），保留「协作者」勾选即可继续邀请；':''))
      +'每个勾选角色发 1 张邀请码（各 10 次 / 7 天），角色由码定死';
    document.getElementById('ctModeHint').textContent = inq&&!hosted
      ?'你将成为问询方（不占席位）：回答方就绪后你在本页开始问询、随时提问、结束时自动出问询纪要'
      :hosted
      ?(inq?'你将成为主持人（host）：只管规则/资料/邀请，问询方凭码就位后开始问询'
           :'你将成为主持人（host）：只管建桌/规则/资料/邀请与调度，不参与评审协作')
      :'你将以'+(ROLE_LABEL[role]||role)+'席位入席参会';
    document.getElementById('ctSeatTitle').textContent = inq&&!hosted
      ?'问询方信息（不占席位，仅作显示名）'
      :hosted
      ?'我的席位（主持人）'
      :'我的席位（角色：'+(ROLE_LABEL[role]||role)+'）';
  }
  document.querySelectorAll('input[name="ctType"]').forEach(function(r){ r.onchange=syncType; });
  syncType();
  document.getElementById('ctBackList').onclick=loadList;
  document.getElementById('ctCancel').onclick=loadList;
  document.getElementById('ctSubmit').onclick=function(){
    var topic=document.getElementById('ctTopic').value.trim();
    var seatName0=document.getElementById('ctSeatName').value.trim();
    var err=document.getElementById('ctErr'); err.textContent='';
    if(!topic){ err.textContent='主题必填'; return; }
    if(!seatName0){ err.textContent='席位名必填'; return; }
    var roles=ctRolesSel();
    if(!roles.length){ err.textContent='至少开放一个邀请角色（否则无人能入桌）'; return; }
    var tt=ttOf(ctType()), role=ctRole();
    var body={ topic:topic, tableType:ctType(), inviteRoles:roles, owner:{ seatName:seatName0, agentLabel:document.getElementById('ctAgent').value.trim()||'human-only' } };
    if(role==='host') body.mode='hosted';
    else if(tt.flow!=='inquiry') body.ownerRole=role; /* 问询桌自建=问询方，服务端不接受 ownerRole */
    var goals=document.getElementById('ctGoals').value.trim(); if(goals) body.goals=goals;
    var del=document.getElementById('ctDeliverables').value.trim(); if(del) body.deliverables=del;
    var rules=document.getElementById('ctRules').value.trim(); if(rules) body.rules=rules;
    var rp=document.getElementById('ctRolePlan').value.trim(); if(rp) body.rolePlan=rp;
    var rounds=parseInt(document.getElementById('ctRounds').value,10); if(rounds>=1&&rounds<=10) body.maxReviewRounds=rounds;
    var turnSec=parseInt(document.getElementById('ctTurnSec').value,10); if(turnSec>=30) body.turnTimeoutMs=turnSec*1000;
    var btn=document.getElementById('ctSubmit'); btn.disabled=true; btn.textContent='创建中…';
    api('POST','/api/tables',body).then(function(r){ renderCreateResult(r,topic); })
      .catch(function(e){ btn.disabled=false; btn.textContent='创建'; err.textContent='创建失败：'+e.message; });
  };
}

function renderCreateResult(d,topic){
  var app=document.getElementById('app');
  var inq=d.tableType==='inquiry';
  var hosted=d.mode==='hosted';
  var h='<div class="row" style="margin-bottom:12px"><b>圆桌已创建</b><span class="badge phase">设定中 · 等待入席与设定</span>'+typeBadge(d.tableType)+(hosted?'<span class="rb host">主持人模式</span>':'')+'</div>';
  h+='<div class="card"><b>'+esc(d.tableId)+'</b>';
  if(inq&&!hosted){
    h+='<h3 class="csec">你是问询方（不占席位）</h3>'
      +'<div class="dim" style="margin-top:4px">无需席位凭证：直接在圆桌详情页开始问询、提问与结束。把下方「回答方」邀请码发给各 agent，其凭码入席并声明回答范围后就绪。</div>';
  }else{
    h+='<h3 class="csec">席位 token（只显示这一次，请立即复制）</h3>'
      +'<div class="row"><span class="invite big">'+esc(d.ownerSeatToken)+'</span><span class="sp"></span><button id="credTokCopy">复制凭证（含入桌信息）</button></div>'
      +'<div class="dim" style="margin-top:4px">点「复制凭证」带走完整入桌信息（服务器地址 / 圆桌 ID / token 与 .roundtable 配置写法）'+(hosted?'。主持人一般在网页端操作，无需把凭证交给 agent':'，整体发给你的 agent 即可参会')+'。关闭本页后无法再查看。</div>';
  }
  h+='<h3 class="csec">邀请码（发给各参与方，角色由码定死）</h3>';
  var RL={proposer:'提案方',reviewer:'评审方',observer:'观察方',collaborator:'协作者',answerer:'回答方',asker:'问询方'};
  d.inviteCodes.forEach(function(c){
    h+='<div class="row" style="margin:4px 0"><span class="rb '+esc(c.role)+'">'+esc(RL[c.role]||c.role)+'</span>'
    +'<span class="invite">'+esc(c.code)+'</span><button class="cpInv" data-code="'+esc(c.code)+'" data-role="'+esc(c.role)+'">复制完整邀请</button>'
    +(c.role==='asker'?'<span class="dim">问询方：发给要提问的人，其在本页凭码就位（不占席位）后开始问询</span>'
      :(c.role==='observer'?'<span class="dim">观察方：只读旁听无表决权</span>':(c.role==='answerer'?'<span class="dim">回答方 agent：凭码入席，声明回答范围后作答</span>':'<span class="dim">复制内容含服务器/圆桌 ID/邀请码，整体转发即可参会</span>')))+'</div>';
  });
  h+='<h3 class="csec">下一步</h3><div class="dim">'
    +(inq
      ?(hosted
        ?'主持人问询流程：定规则（详情页「桌设定」可随时改）→ 把「问询方」邀请码发给要提问的人（其凭码就位）、「回答方」码发给各 agent → 回答方入席设定并就绪 → 问询方在详情页点「开始问询」→ 提问 → 问完「结束问询」出问询纪要。'
        :'问询流程：把「回答方」完整邀请发给各 agent → 其入席并完成入桌设定（立场=回答范围、数据范围，就绪）→ 你在详情页点「开始问询」→ 随时提问（可定向某回答席或广播全员作答）→ 问完点「结束问询」自动生成问询纪要（问答对汇总）。')
      :hosted
      ?'主持人流程：定规则（详情页「桌设定」可随时改）→ 传资料（详情页上传共享文档，全桌可见）→ 把邀请码发给各参与方（角色见上方码标签）→ 各方完成入桌设定 → 你在详情页点「开始会议」。开始后各方回合提交先经系统预审，需要补充时会被点名。'
      :'进入圆桌详情完成你的入桌设定（立场/范围/数据范围/就绪），参与方凭完整邀请入席设定后，全员就绪即可在详情页一键开始会议。回合提交先经系统预审，需要补充时会被点名。')
    +'</div>'
    +'<div class="row" style="margin-top:8px"><button id="ctBack">返回列表</button><span class="sp"></span><button id="ctEnter" class="primary">进入圆桌</button></div>'
    +'</div>';
  app.innerHTML=h;
  var tokCopy=document.getElementById('credTokCopy');
  if(tokCopy) tokCopy.onclick=function(){
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
  var h='<div class="row" style="margin-bottom:12px"><span class="back" id="jbBackList">← 返回列表</span><span class="sp"></span><b>凭邀请码入桌</b><span class="dim">角色由邀请码定死（提案方/评审方/协作者/回答方/观察方），席位不能自封</span></div>';
  h+='<div class="card frm">'
    +'<div class="frow"><label class="t" for="jbCode">邀请码 <b>*</b></label><textarea id="jbCode" placeholder="粘贴 10 位邀请码，或整段粘贴收到的「完整邀请」文本"></textarea><div class="hint">先查码确认所属圆桌，再确认入席；查询不消耗码次数</div></div>'
    +'<div class="frow"><label class="t" for="jbSeatName">席位名 <b>*</b></label><input id="jbSeatName"'+(view.userName?' value="'+escAttr(view.userName)+'"':' placeholder="你的显示名"')+'></div>'
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
/* 查询结果分支：已持有席位/已是问询方 → 引导进桌；会议已开始 → 拒入提示；正常 → 确认入席（asker=就位为问询方） */
function renderJoinPreview(p){
  var box=document.getElementById('jbPreview');
  var h='<div class="card" style="margin-top:10px;border:1px dashed var(--line)">'
    +'<div class="row"><b>'+esc(p.topic)+'</b>'+phaseBadge(p.phase,0,p.tableType)+roleBadge(p.role)+'</div>'
    +'<div class="dim" style="margin-top:6px">'+esc(p.tableId)+' · '+p.seatCount+' 席 · 码剩余 '+p.usesLeft+' 次 · 有效期至 '+fmtTs(p.expiresAt)+'</div>';
  if(p.mySeat){
    h+='<div class="hint" style="margin-top:8px">你已在本桌持有席位「'+esc(p.mySeat.name)+'」，无需重复入席。</div>'
      +'<div class="row" style="margin-top:8px"><button id="jbGo" class="primary">进入圆桌</button></div>';
  } else if(p.myAsker){
    h+='<div class="hint" style="margin-top:8px">你已是本桌问询方（不占席位），直接进入圆桌提问即可。</div>'
      +'<div class="row" style="margin-top:8px"><button id="jbGo" class="primary">进入圆桌</button></div>';
  } else if(p.phase!=='open'){
    h+='<div class="hint" style="margin-top:8px">本桌会议已开始，不再接受凭码入席。</div>';
  } else if(p.role==='asker'){
    h+='<div class="hint" style="margin-top:8px">这是<b>问询方</b>邀请码：确认后就位为本桌问询方（不占席位、无席位凭证），回答方就绪后你在本页开始问询、随时提问与结束问询。</div>'
      +'<div class="row" style="margin-top:8px"><button id="jbJoin" class="primary">就位为问询方</button></div>';
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
    jb.disabled=true; jb.textContent=p.role==='asker'?'就位中…':'入席中…';
    api('POST','/api/tables/'+encodeURIComponent(p.tableId)+'/seats',{
      inviteCode:p.code, seatName:name, role:p.role,
      agentLabel:document.getElementById('jbAgent').value.trim()||'human-only'
    }).then(function(r){ renderJoinResult(p,r); })
    .catch(function(e){ jb.disabled=false; jb.textContent=p.role==='asker'?'就位为问询方':'确认入席'; err.textContent='就位/入席失败：'+e.message; });
  };
}
function renderJoinResult(p,r){
  var app=document.getElementById('app');
  if(r.asker){
    var ah='<div class="row" style="margin-bottom:12px"><b>已就位</b><span class="rb asker">问询方</span><span class="badge phase">等待回答方就绪</span></div>';
    ah+='<div class="card"><b>'+esc(p.topic)+'</b>'
      +'<h3 class="csec">你已成为本桌问询方（不占席位）</h3>'
      +'<div class="dim" style="margin-top:4px">无需席位凭证：等待回答方凭邀请码入席并声明回答范围，全部就绪后你在详情页点「开始问询」，即可随时提问（可定向/广播）并结束问询出纪要。</div>'
      +'<div class="row" style="margin-top:8px"><button id="jrBack">返回列表</button><span class="sp"></span><button id="jrEnter" class="primary">进入圆桌</button></div>'
      +'</div>';
    app.innerHTML=ah;
    document.getElementById('jrBack').onclick=loadList;
    document.getElementById('jrEnter').onclick=function(){ openTable(p.tableId); };
    return;
  }
  var h='<div class="row" style="margin-bottom:12px"><b>已入席</b>'+roleBadge(r.seat.role)+'<span class="badge phase">入桌设定待完成</span></div>';
  h+='<div class="card"><b>'+esc(p.topic)+'</b>'
    +'<h3 class="csec">席位 token（只显示这一次，请立即复制）</h3>'
    +'<div class="row"><span class="invite big">'+esc(r.token)+'</span><span class="sp"></span><button id="jrTokCopy">复制凭证（含入桌信息）</button></div>'
    +'<div class="dim" style="margin-top:4px">点「复制凭证」带走完整入桌信息（服务器地址 / 圆桌 ID / token 与 .roundtable 配置写法），交给你的 agent 即可代你参会。关闭本页后无法再查看；之后可在桌详情页随时「重签凭证」。</div>'
    +'<h3 class="csec">下一步</h3><div class="dim">进入圆桌详情完成入桌设定（立场/范围/数据范围/就绪）；全员就绪后建桌人即可开始会议。回合提交先经系统预审，需要补充时会被点名。</div>'
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
function stepsHtml(phase, tt, pause){
  if(phase==='human_intervention'){
    return '<div class="banner err">人工介入模式：会议暂停，等待 HUMAN_INPUT / HUMAN_RULING 推进或裁决</div>';
  }
  var defs=(ttOf(tt).flow==='inquiry')?[['open','设定'],['qa','问答'],['closed','结束']]:STEP_DEFS;
  var idx=-1;
  for(var i=0;i<defs.length;i++){ if(defs[i][0]===phase) idx=i; }
  var h='';
  if(pause){
    var viaReq=(pause.via==='request'&&pause.requestedByName)?('（经 '+esc(pause.requestedByName)+' 申请）'):'';
    h+='<div class="banner warn" style="margin:10px 0 6px"><b>⏸ 会议已暂停</b> — 由 '+esc(pause.byName)+'（'+esc(ROLE_LABEL[pause.byRole]||pause.byRole)+'）于 '+fmtTs(pause.pausedAt)+' 暂停'+viaReq
      +(pause.reason?('：'+esc(pause.reason)):'')
      +'<div class="dim" style="margin-top:3px">各方持有人：在「我的席位」调整立场（保存时勾选「重新就绪」）、在「会话」输入框给本席 agent 发指令补充信息；无需补充的席位保持就绪即可。全员就绪后，由 主持人 / 建桌人 / 系统管理员 在网页继续会议。</div></div>';
  }
  h+='<div class="steps">';
  defs.forEach(function(s,i){
    var cls=(i<idx)?'done':(i===idx?'cur':'');
    h+='<div class="step '+cls+'"><div class="bar"></div><div>'+esc(phaseLabel(tt,s[0]))+'</div></div>';
  });
  return h+'</div>';
}
/* 入桌设定表单（open 设定阶段与会议暂停期共用；pausedMode=true 时标题与就绪文案切到「暂停期调整/重新就绪」）
   表单元素 id 与原 open 分支一致（cfgPreset/cfgSup/cfgStance/cfgScope/dsWrap/dsChips/dsIn/cfgReady/cfgErr/cfgSave），绑定见 renderDetail */
function seatCfgFormHtml(cfg, pausedMode){
  cfg=cfg||{};
  var title=pausedMode?'暂停期调整（立场 / 范围）':(cfg.ready?'修改入桌设定':'入桌设定');
  var readyLabel=pausedMode
    ?'重新就绪 — 补充/调整完成后声明本席可以继续（不动设定的席位无需任何操作，保持就绪）'
    :'就绪 — 声明本席设定完成（全员就绪后建桌人可开始会议）';
  return '<div class="section"><h3>'+esc(title)+'</h3>'
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
    +'<div class="frow"><label class="chk"><input type="checkbox" id="cfgReady"'+(cfg.ready?' checked':'')+'> '+esc(readyLabel)+'</label></div>'
    +'<div class="ferr" id="cfgErr"></div>'
    +'<div class="row"><button id="cfgSave" class="primary">保存设定</button>'
    +((!pausedMode&&cfg.ready)?'<button id="cfgCollapse">收起（保留现设定）</button>':'')
    +(pausedMode?'<span class="dim">暂停期保存：未勾选「重新就绪」将被视为补充中（未就绪）</span>':'<span class="dim">保存后可再修改，开始会议后设定锁定</span>')
    +'</div></div>';
}

/* ---------- 我的席位折叠子区块（会议控制 / 申请暂停 / 凭证恢复）----------
   内容与元素 id 和旧版长面板一致（绑定不动），仅收纳为可折叠子区块；开合状态存 view.seatOpen 抗轮询重渲染 */
function ctlBodyHtml(t,seats){
  if(t.pause){
    var ctlSeats=seats.filter(function(s){ return s.role!=='host'; });
    var ctlReady=ctlSeats.filter(function(s){ return s.config&&s.config.ready; });
    var ctlAll=ctlSeats.length>0&&ctlReady.length===ctlSeats.length;
    var h='';
    ctlSeats.forEach(function(s){
      h+='<div class="kv">'+esc(s.name)+' '+roleBadge(s.role)+' <span class="badge '+((s.config&&s.config.ready)?'ok':'warn')+'">'+((s.config&&s.config.ready)?'已就绪':'未就绪')+'</span></div>';
    });
    h+='<div class="row" style="margin-top:8px"><button id="ctlResume" class="primary"'+(ctlAll?'':' disabled')+'>▶ 继续会议</button>'
      +'<span class="dim">恢复到「'+esc(phaseLabel(t.tableType,t.phase))+'」继续；需全员就绪（系统管理员可强制继续）</span></div>'
      +'<div class="ferr" id="ctlErr"></div>';
    return h;
  }
  return '<div class="row"><input id="ctlPauseReason" placeholder="暂停原因（进入会议记录，可空）" style="flex:1;min-width:180px">'
    +'<button id="ctlPause">⏸ 暂停会议</button></div>'
    +'<div class="hint" style="margin-top:4px">暂停后各方可在「会话」输入框补充信息、在上方调整立场并重新就绪；全员就绪后在这里继续会议。</div>'
    +'<div class="ferr" id="ctlErr"></div>';
}
function prBodyHtml(){
  return '<div class="row"><input id="prReason" placeholder="申请原因（给主持人/建桌人/系统管理员看，可空）" style="flex:1;min-width:180px">'
    +'<button id="prApply">申请暂停会议</button></div>'
    +'<div class="hint" style="margin-top:4px">申请将通知 主持人/建桌人/系统管理员，其在网页同意后会议暂停；届时各席（含本席）可补充信息/调整立场后重新就绪。</div>'
    +'<div class="ferr" id="prErr"></div>';
}
function credBodyHtml(){
  return '<div class="hint" style="margin-bottom:6px">agent 被关闭或要换新 agent？「恢复」复制参会配置（原凭证保留），粘贴到新 agent 会话即以原席位身份继续；「替代」同时禁用原 agent 的全部凭证（即使它仍在运行，下次请求即失效）。</div>'
    +'<div class="row"><button id="stRecover">复制参会配置（恢复）</button>'
    +'<input id="stNewLabel" placeholder="新 agent 标识（替代时选填）" style="width:200px">'
    +'<button id="stReplace" class="danger">替代 agent（禁用原凭证）</button></div>'
    +'<div class="ferr" id="stErr"></div>';
}
function secDetailsHtml(id,title,sub,body,open){
  return '<details class="sec" id="'+id+'"'+(open?' open':'')+'><summary>'+esc(title)+(sub?('<span class="dim">'+esc(sub)+'</span>'):'')+'</summary><div class="sec-body">'+body+'</div></details>';
}
/* 纯视图重渲染（筛选芯片/示意图折叠）前后的输入值采集回填：防止这类重渲染丢输入草稿 */
function harvestInputs(sel){
  var o={}, root=document.querySelector(sel);
  if(!root) return o;
  root.querySelectorAll('input[id],select[id],textarea[id]').forEach(function(el){ o[el.id]=(el.type==='checkbox')?el.checked:el.value; });
  return o;
}
function restoreInputs(o){
  if(!o) return;
  Object.keys(o).forEach(function(id){
    var el=document.getElementById(id);
    if(!el) return;
    if(el.type==='checkbox') el.checked=o[id]; else el.value=o[id];
  });
}
function rerenderDetail(){
  var keep=harvestInputs('#app');
  renderDetail(view.lastDetailData);
  restoreInputs(keep);
}

/* ---------- 会话视图（chatbox）+ 输入聚合（composer） ----------
   气泡归属：fromSeat=本席（或 isAsker 的 asker）→ 右侧；server → 居中系统；其余 → 左侧带席位名/角色色。
   composer：按身份与阶段提供 代答/提问/公开补充/私有指令/人工指令 类型组，芯片切换只改 display（不重渲染，草稿保留）。 */
function chatboxCardHtml(d,seats,mySeat,isAsker){
  var t=d.table, stage=stageOf(t,seats), turn=t.activeTurn;
  var chips='';
  CHAT_VIEWS.forEach(function(v){
    chips+='<button class="fbtn'+(((view.chatFilter||'all')===v[0])?' on':'')+'" data-cf="'+v[0]+'">'+v[1]+'</button>';
  });
  var h='<div class="card" id="chatCard"><div class="shead"><b>会话</b><span class="dim">各方发言与系统提示 · 我方右侧 / 其他方左侧 / 系统居中</span><span class="sp"></span>'
    +'<div class="tbar" style="margin:0">'+chips+'</div></div><div class="cb-list" id="cbList">';
  var shown=0;
  (d.messages||[]).forEach(function(m){
    if(m.type==='PHASE_CHANGE'){
      h+='<div class="phasediv"><span>'+esc(msgBodyText(m,seats)).slice(0,400)+'<span class="dim"> · '+fmtTs(m.ts)+'</span></span></div>';
      return;
    }
    /* 席位变动（入席/设定更新/退席）是结构性事件：当前态见「席位与立场」，不作为系统消息混入会话流 */
    if(m.type==='SEAT_JOINED'||m.type==='SEAT_LEFT') return;
    if(!chatShow(m)) return;
    shown++;
    var p=m.payload||{}, body=msgBodyText(m,seats);
    if(m.fromSeat==='server'){
      h+='<div class="cb-sys" title="#'+m.seq+'">'+esc(clipStr(body,220))+'</div>';
      return;
    }
    var mine=(m.fromSeat===d.mySeatId)||(isAsker&&m.fromSeat==='asker');
    var role=mine?(mySeat?mySeat.role:'asker'):seatRoleOf(seats,m.fromSeat);
    var toMe=(m.type==='HUMAN_INPUT'&&p.toSeat===d.mySeatId&&!mine);
    var proxied=(m.flags&&m.flags.indexOf&&m.flags.indexOf('human_proxied')>=0);
    var inject=(m.flags&&m.flags.indexOf&&m.flags.indexOf('injection_suspect')>=0);
    h+='<div class="cb-row '+(mine?'mine':'other')+'">'
      +'<div class="cb-bubble role-'+esc(role||'observer')+'">'
      +'<div class="cb-who">'+(mine?'<b>我</b>':'<b>'+esc(seatName(seats,m.fromSeat))+'</b>')+roleBadge(role)
      +'<span class="mt '+(MT_CLS[m.type]||'')+'">'+esc(MT_LABEL[m.type]||m.type)+'</span>'
      +(proxied?'<span class="badge warn">人工代答</span>':'')
      +(toMe?'<span class="badge phase">给我的指令</span>':'')
      +(inject?'<span class="badge err">疑似注入</span>':'')
      +'</div>'
      +(body.length>500?('<div title="'+escAttr(body)+'">'+esc(clipStr(body,500))+'</div>'):('<div>'+esc(body)+'</div>'))
      +'<div class="cb-meta">'+fmtTs(m.ts)+' · #'+m.seq+((p.toSeat&&p.toSeat!==m.fromSeat)?(' → '+esc(seatName(seats,p.toSeat))):'')+'</div>'
      +'</div></div>';
  });
  if(!shown) h+='<div class="cb-empty">'+(t.phase==='open'?'（还没有消息：各席完成入席设定并就绪，会议开始后在这里交流）':'（该筛选下暂无消息）')+'</div>';
  h+='</div>';
  /* composer：按身份与阶段聚合输入类型（代答仅轮到本席、提问仅问询方问答期） */
  var types=[];
  if(mySeat&&t.phase!=='closed') types.push(['supp','公开补充'],['priv','私有指令'],['hi','人工指令']);
  if(isAsker&&t.phase==='qa'&&!t.pause) types.unshift(['ask','提问']);
  if(mySeat&&stage==='running'&&turn&&turn.seatId===d.mySeatId&&!t.pause) types.unshift(['proxy','代答']);
  if(types.length){
    var cur=view.cmpType, hit=false, ti;
    for(ti=0;ti<types.length;ti++){ if(types[ti][0]===cur) hit=true; }
    if(!hit) cur=types[0][0];
    view.cmpType=cur;
    var tchips='';
    types.forEach(function(x){ tchips+='<button class="fbtn'+(x[0]===cur?' on':'')+'" data-ct="'+x[0]+'">'+x[1]+'</button>'; });
    h+='<div style="border-top:1px solid var(--line);margin-top:10px;padding-top:8px"><div class="tbar" id="cmpTabs">'+tchips+'</div>';
    types.forEach(function(x){
      var g=x[0];
      h+='<div class="cmp-grp" data-grp="'+g+'"'+(g===cur?'':' style="display:none"')+'>';
      if(g==='proxy'){
        h+='<h3>替我回答本轮（人工代答）</h3><div class="dim">'+esc(turn.taskHint||'')+'</div>'
          +'<div class="row" style="margin-top:6px"><select id="pxType"></select>'
          +'<select id="pxDecision" style="display:none"></select>'
          +'<select id="pxSeverity" style="display:none"><option>must</option><option selected>should</option><option>nice</option></select>'
          +'<input id="pxTarget" placeholder="位置（如 第3节）" style="display:none;width:140px">'
          +'<label class="chk"><input type="checkbox" id="pxJson"> JSON 模式</label></div>'
          +'<textarea id="pxText" placeholder="回答内容（按所选类型自动组装 payload）"></textarea>'
          +'<textarea id="pxJsonBox" placeholder="JSON 模式：整包提交，如 {&quot;type&quot;:&quot;RESPONSE&quot;,&quot;payload&quot;:{&quot;items&quot;:[…]}}" style="display:none;font-family:ui-monospace,Menlo,monospace;min-height:80px"></textarea>'
          +'<div class="ferr" id="pxErr"></div>'
          +'<div class="row"><span class="dim">发送后本轮发言权即被消费，agent 不会再重复作答</span>'
          +'<span class="sp"></span><button id="pxSend" class="primary">代答发送</button></div>';
      }else if(g==='supp'){
        h+='<h3>公开补充信息（进入会议记录）</h3>'
          +'<textarea id="myInstr" placeholder="以 HUMAN_INPUT 发给本席 agent，全桌可见（需要全桌知晓的补充说明，如：接口定义已更新，见第 3 节）"></textarea>'
          +'<div class="row"><input id="myInstrBy" placeholder="署名（默认用户名）" style="width:160px">'
          +'<button id="myInstrSend">发送公开补充</button></div>';
      }else if(g==='priv'){
        h+='<h3>私有指令（仅本席 agent 可见）</h3>'
          +'<textarea id="podText" placeholder="高可信持有人指令：不进会议记录，观察者与系统管理员均不可见；agent 作为你的指令执行，可传策略立场或调整信息（如：本轮采取保守立场；重点核对性能章节）"></textarea>'
          +'<div class="ferr" id="podErr"></div>'
          +'<div class="row"><button id="podSend" class="primary">发送私有指令</button>'
          +'<span class="dim">未确认前 agent 每次 poll 都会收到，处理确认后不再重复下发；待送达上限 20 条</span></div>';
      }else if(g==='hi'){
        var opts='<option value="">全员（广播）</option>';
        seats.forEach(function(s){ opts+='<option value="'+esc(s.seatId)+'">→ '+esc(s.name)+'</option>'; });
        h+='<h3>发送人工指令（以你在本桌的席位身份）</h3><div class="row">'
          +'<select id="hTarget">'+opts+'</select>'
          +'<input id="hBy" placeholder="署名（默认你的用户名）" style="width:150px">'
          +'<span class="sp"></span><button id="hSend" class="primary">发送</button></div>'
          +'<textarea id="hText" placeholder="人工意见 / 指令 / 裁决说明（将以 HUMAN_INPUT 进入会议记录，agent 在 poll 时可见）" style="margin-top:8px"></textarea>';
      }else if(g==='ask'){
        var aopts='<option value="">广播 · 全体回答方各自作答</option>';
        seats.forEach(function(s){ if(s.role==='answerer') aopts+='<option value="'+esc(s.seatId)+'">定向 · '+esc(s.name)+'</option>'; });
        h+='<h3>提问（问询方）</h3>'
          +'<textarea id="askText" placeholder="向回答方提问…（回答方只在各自声明的范围内作答，超范围会明确说明并拒答）"></textarea>'
          +'<div class="row" style="margin-top:6px"><select id="askTo">'+aopts+'</select><span class="sp"></span><button id="askSend" class="primary">提问</button></div>'
          +'<div class="ferr" id="askErr"></div>';
      }
      h+='</div>';
    });
    h+='</div>';
  }
  h+='</div>';
  return h;
}

function renderDetail(d){
  var t=d.table, seats=(t.seats||[]).filter(function(s){ return s.status!=='left'; });
  var mySeat=null, i;
  if(d.mySeatId){ for(i=0;i<seats.length;i++){ if(seats[i].seatId===d.mySeatId) mySeat=seats[i]; } }
  var admin=view.role==='systemadmin';
  var isAsker=!!d.isAsker; /* 问询方（建桌人/凭码就位者；可与席位并存——同号用户 web 提问 + 自己的 agent 作答 */
  var turn=t.activeTurn;
  var inqFlow=ttOf(t.tableType).flow==='inquiry';
  var stage=stageOf(t,seats); /* prep/ready/running/paused/ended：驱动模块显隐 */
  /* 就绪度（open 期面板与就绪进度共用）：问询桌看回答方，其余看非主持人席 + 角色齐备 */
  var needSeats=inqFlow?seats.filter(function(s){ return s.role==='answerer'; }):seats.filter(function(s){ return s.role!=='host'; });
  var rolesOk=inqFlow?needSeats.length>0:(seats.some(function(s){ return s.role==='proposer'; })&&seats.some(function(s){ return s.role==='reviewer'; }));
  var allReady=rolesOk&&needSeats.length>0&&needSeats.every(function(s){ return s.config&&s.config.ready; });
  /* 会话滚动状态采集（重渲染前拿旧容器位置，渲染后回位/贴底）+ composer 草稿采集（重渲染后回填，防发送/轮询丢未发送内容） */
  var prevCb=document.getElementById('cbList');
  if(prevCb){ view.cbPrevTop=prevCb.scrollTop; view.chatAtBottom=(prevCb.scrollTop+prevCb.clientHeight>=prevCb.scrollHeight-24); }
  view.cmpKeep=harvestInputs('#chatCard');

  var h='<div class="row"><span class="back" id="back">← 返回列表</span><span class="sp"></span><button id="dCopyLink" class="sm" title="复制可分享的详情页链接">复制本页链接</button><span class="dim">自动刷新中</span></div>';

  /* 身份视角条：systemadmin 无席位只读观察（普通用户无席位已被服务端 403 拦在列表外） */
  if(!mySeat && admin){
    h+='<div class="banner admin">系统观察员 · 只读观察 — 你在本桌没有席位，仅查看（详情/历史/纪要），不能发指令或代答。</div>';
  }
  if(isAsker){
    h+='<div class="banner">问询方视角 — '+(mySeat?'你在本桌同时持有席位「'+esc(mySeat.name)+'」（下方有席位面板）':'你不占席位')
      +'：回答方就绪后开始问询，在本页提问（可定向/广播）与结束问询。</div>';
  }

  h+='<div class="card"><div class="shead"><b style="font-size:16px">'+esc(t.topic)+'</b>'
    +typeBadge(t.tableType)
    +phaseBadge(t.phase,t.roundNo,t.tableType)
    +(t.phase==='open'?'<span class="badge '+(stage==='ready'?'ok':'warn')+'">'+STAGE_LABEL[stage]+'</span>':'')
    +(t.pause?'<span class="badge warn">⏸ 已暂停</span>':'')
    +(t.mode==='hosted'?'<span class="rb host">主持人模式</span>':'')
    +(t.deadlockCount>0?'<span class="badge err">僵局 '+t.deadlockCount+'</span>':'')
    +'</div>';
  if(d.meta.goals) h+='<div class="kv"><span class="k">目标</span>'+esc(d.meta.goals)+'</div>';
  if(d.meta.deliverables) h+='<div class="kv"><span class="k">交付物</span>'+esc(d.meta.deliverables)+'</div>';
  if(d.meta.rules) h+='<div class="kv"><span class="k">规则</span>'+esc(d.meta.rules)+'</div>';
  h+=stepsHtml(t.phase,t.tableType,t.pause);
  h+='</div>';

  h+='<div class="dcols">';
  /* ==== 左栏（与右栏等宽）：会话与席位档案 ==== */
  h+='<div class="dcol dmain">';
  h+='<div class="card"><div class="section turn" style="margin-top:0"><b>下一步动作</b><div style="margin-top:4px">';
  if(t.precheck){
    if(t.precheck.state==='reviewing') h+='<div class="badge warn">预审中</div> <span class="dim">系统正在预审刚提交的回合结果，预审完成前暂不轮转发言权</span>';
    else if(t.precheck.state==='directive') h+='<div class="badge warn">预审点名</div> <span class="dim">等待 <b>'+esc(seatName(seats,t.precheck.toSeat))+'</b> 按预审意见补充并以 SUPPLEMENT 提交</span><br>';
  }
  if(t.pause){
    /* 暂停叠加态：阶段保留、无发言权；展示就绪进度与继续条件 */
    var pseats=seats.filter(function(s){ return s.role!=='host'; });
    var pReady=pseats.filter(function(s){ return s.config&&s.config.ready; }).length;
    h+='<span class="badge warn">⏸ 会议已暂停</span> <span class="dim">阶段保留在「'+esc(phaseLabel(t.tableType,t.phase))+'」，继续后从原处推进</span>';
    h+='<div class="dim" style="margin-top:4px">就绪进度：'+pReady+' / '+pseats.length
      +(pseats.length&&pReady===pseats.length
        ?' — 全员已就绪，可继续会议'
        :' — 未就绪：'+pseats.filter(function(s){ return !(s.config&&s.config.ready); }).map(function(s){ return esc(s.name); }).join('、'));
  } else if(turn){
    h+='发言权：<b>'+esc(seatName(seats,turn.seatId))+'</b> —— '+esc(turn.taskHint||'');
    if(turn.pendingRequest) h+='<div class="dim">待处理请求：'+esc(turn.pendingRequest.title)+'</div>';
  } else if(t.phase==='closed'){ h+='<span class="badge ok">会议已结束</span>'+(d.minutes?' <span class="dim">纪要已生成（见下方纪要区）</span>':''); }
  else if(t.phase==='human_intervention'){ h+='<span class="dim">等待人工介入（可在「会话」输入框以席位身份发送人工指令）</span>'; }
  else if(t.phase==='open'){
    if(stage==='ready') h+='<span class="badge ok">全员就绪</span> <span class="dim">等待'+(inqFlow?'问询方':'建桌人')+'在右侧面板点「▶ '+(inqFlow?'开始问询':'开始会议')+'」</span>';
    else{
      h+='<span class="badge warn">准备中</span> <span class="dim">设定阶段：各席完成入桌设定并就绪'+(rolesOk?'':'（角色不齐备：还需提案方/评审方凭邀请码入席）')+'</span>';
      h+='<div class="dim" style="margin-top:4px">就绪进度：'+needSeats.filter(function(s){ return s.config&&s.config.ready; }).length+' / '+needSeats.length
        +(needSeats.length?(' — 未就绪：'+needSeats.filter(function(s){ return !(s.config&&s.config.ready); }).map(function(s){ return esc(s.name); }).join('、')):'')+'</div>';
    }
  }
  else { h+='<span class="dim">当前无发言权持有者（等待事件推进或人工介入）</span>'; }
  h+='</div></div></div>';

  /* 会话视图 chatbox（气泡流 + 输入聚合 composer）：置于席位与立场上方 */
  h+=chatboxCardHtml(d,seats,mySeat,isAsker);

  /* 席位与立场（原「各方观点」精简：最后交付交给会话视图与圆桌示意图，保留立场/就绪/管理员席位操作） */
  h+='<div class="card"><div class="shead"><b>席位与立场</b><span class="dim">每席立场声明与就绪状态</span><span class="sp"></span>'
    +(inqFlow?'<span class="rb asker">问询方 · '+esc(view.userName||'')+'</span>':'')
    +'<span class="dim">'+seats.length+' 席就座</span></div><div class="vcards">';
  seats.forEach(function(s){
    var cfg=s.config||{};
    h+='<div class="vcard '+esc(s.role)+'">'
      +'<div class="row">'+roleBadge(s.role)+'<b>'+esc(s.name)+'</b>'
      +(s.seatId===t.ownerSeat?'<span class="badge">建桌人</span>':'')
      +'<span class="sp"></span>'
      +'<span class="badge '+(s.status==='active'?'ok':'warn')+'">'+esc(s.status)+'</span>'
      +(s.role==='host'?'<span class="badge">豁免就绪</span>':'<span class="badge '+(cfg.ready?'ok':'warn')+'">'+(cfg.ready?'已就绪':'未就绪')+'</span>')
      +'</div>'
      +'<div class="dim">agent: '+esc(s.agentLabel)+'</div>'
      +'<div class="kv"><span class="k">立场</span><span title="'+escAttr(cfg.stance||'')+'">'+esc((cfg.stance||'').slice(0,60)||'（未填写）')+'</span></div>'
      +(admin?'<div class="row" style="margin-top:8px"><button class="admCred sm" data-sid="'+escAttr(s.seatId)+'" data-name="'+escAttr(s.name)+'" data-role="'+escAttr(s.role)+'">复制配置</button> '
        +'<button class="admRepl sm danger" data-sid="'+escAttr(s.seatId)+'" data-name="'+escAttr(s.name)+'" data-role="'+escAttr(s.role)+'">替代 agent</button></div>':'')
      +'</div>';
  });
  h+='</div></div>';

  /* 邀请码（建桌人 or 系统观察员；结束后不再展示——闭桌无法再入席） */
  if(stage!=='ended'&&(admin||(mySeat&&mySeat.seatId===t.ownerSeat))){
    h+='<div class="card" id="inviteBox"><div class="shead"><b>邀请码</b><span class="dim">仅建桌人与系统观察员可见 · 复制的是完整邀请（服务器/圆桌 ID/邀请码/参会步骤），整体转发即可参会</span></div><div id="invites" class="dim" style="margin-top:8px">加载中…</div></div>';
  }

  h+='</div>';
  /* ==== 右栏（与左栏等宽）：圆桌示意图 + 我的操作与交付 ==== */
  h+='<div class="dcol dside">';
  /* 圆桌示意图（右栏顶部）：席位环绕 + 最后交付摘要 + 发言权思考中标记（>8 席折叠） */
  h+=roundDiagramHtml(d,seats,turn);

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

    if(stage==='ended'){
      h+='<div class="section dim" style="margin-top:10px">会议已结束：纪要在下方「会议纪要」区，会话全文见上方「会话」区（只读）。</div>';
      /* 结束阶段仅剩凭证恢复一个子块，平铺展示 */
      h+='<div class="section"><h3>凭证恢复 · 更换 agent</h3>'+credBodyHtml()+'</div>';
    } else if(t.phase==='open'){
      /* 设定阶段：设定表单 / 摘要 + 建桌人开始按钮（无代答环节——代答自会议开始起才有） */
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
        h+=seatCfgFormHtml(cfg,false);
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
          +'<span class="dim">开始后进入提案陈述阶段，席位设定锁定</span></div><div class="ferr" id="stErr"></div></div>';
      } else if(cfg.ready){
        h+='<div class="section dim">已就绪，等待建桌人开始会议。</div>';
      }
      h+=secDetailsHtml('seatDetPod','私有指令记录','我发出的 · 仅自己可见（发送在「会话」输入框）','<div id="podList" style="margin-top:2px"></div>',false);
      h+=secDetailsHtml('seatDetCred','凭证恢复 · 更换 agent','复制配置给新 agent / 替代换新',credBodyHtml(),false);
    } else {
      /* 会议进行中 / 暂停 / 人工介入：状态行 + 折叠子区块（代答与指令输入在左侧「会话」输入框） */
      if(t.pause){
        /* 暂停期：人工补充或调整主张（保存时勾选「重新就绪」）；主持人无设定，只看控制区 */
        if(isHost){
          h+='<div class="section dim" style="margin-top:10px">会议已暂停：主持人无需设定立场，等待各方补充并重新就绪后，在「会议控制」继续会议。</div>';
        } else {
          h+=seatCfgFormHtml(cfg,true);
        }
      } else if(turn&&turn.seatId===d.mySeatId){
        h+='<div class="section dim" style="margin-top:10px">发言权在本席 —— 可在左侧「会话」输入框选「代答」替 agent 回答本轮（'+esc(turn.taskHint||'')+'）。</div>';
      } else {
        h+='<div class="section dim" style="margin-top:10px">'+(turn?('当前发言权：'+esc(seatName(seats,turn.seatId))+'。轮到本席时，「会话」输入框会出现「代答」。'):'等待会议推进。')+'</div>';
      }

      /* 会议控制（建桌人/主持人，会议中）：暂停 / 就绪名单 + 继续（暂停中默认展开） */
      if(isOwner||isHost){
        h+=secDetailsHtml('seatDetCtl',t.pause?'会议控制（暂停中）':'会议控制','暂停 / 就绪名单 + 继续',ctlBodyHtml(t,seats),!!t.pause);
      }
      /* 申请暂停（未暂停时，非控制人席位；控制人直接用「会议控制」的暂停按钮） */
      if(!t.pause&&!(isOwner||isHost)){
        h+=secDetailsHtml('seatDetPr','申请暂停','通知控制人，同意后生效',prBodyHtml(),false);
      }
      /* 凭证恢复 · agent 替代（任何阶段可用——闭桌后也可恢复身份拉纪要） */
      h+=secDetailsHtml('seatDetPod','私有指令记录','我发出的 · 仅自己可见（发送在「会话」输入框）','<div id="podList" style="margin-top:2px"></div>',false);
      h+=secDetailsHtml('seatDetCred','凭证恢复 · 更换 agent','复制配置给新 agent / 替代换新',credBodyHtml(),false);
    }
    h+='</div>';
  }
  /* ---- 问询方面板：open=就绪名单+开始问询；qa=提问+结束问询+会议控制。
     与席位面板并存（同号双身份），开始按钮用独立 id inqStart/inqStartErr 防与席位面板同页冲突 ---- */
  if(isAsker){
    var ansSeats=seats.filter(function(s){ return s.role==='answerer'; });
    var ansReady=ansSeats.filter(function(s){ return s.config&&s.config.ready; });
    var inqAll=ansSeats.length>0&&ansReady.length===ansSeats.length;
    h+='<div class="card mine"><div class="row"><b>问询方</b><b>'+esc(view.userName||'')+'</b>'
      +'<span class="rb asker">问询方</span><span class="dim">不占席位 · 网页提问</span></div>';
    if(t.phase==='open'){
      h+='<div class="section sumcard"><h3 style="margin-top:0">开局状态（问询方）</h3>';
      if(!ansSeats.length) h+='<div class="ferr">还没有回答方入席：把「回答方」邀请码发给各 agent。</div>';
      ansSeats.forEach(function(s){
        h+='<div class="kv">'+esc(s.name)+' '+roleBadge(s.role)+' <span class="badge '+((s.config&&s.config.ready)?'ok':'warn')+'">'+((s.config&&s.config.ready)?'已就绪':'未就绪')+'</span>'
          +((s.config&&s.config.scope)?' <span class="dim" title="'+escAttr(s.config.scope)+'">范围：'+esc(s.config.scope.slice(0,40))+'</span>':'')+'</div>';
      });
      h+='<div class="row" style="margin-top:8px"><button id="inqStart" class="primary"'+(inqAll?'':' disabled')+'>▶ 开始问询</button>'
        +'<span class="dim">全部回答方就绪后可开始；开始后进入问答阶段，随时提问</span></div><div class="ferr" id="inqStartErr"></div></div>';
    } else if(t.phase==='qa'){
      if(t.pause){
        h+='<div class="banner warn" style="margin-top:8px">问询已暂停：提问与作答冻结；回答方调整/补充并重新就绪后，在下方「会议控制」继续。</div>';
      } else {
        h+='<div class="section dim" style="margin-top:10px">提问：在左侧「会话」输入框选「提问」——可广播全体回答方各自作答，或定向某席。</div>';
      }
      h+='<div class="section sumcard"><h3 style="margin-top:0">结束问询</h3>'
        +'<div class="dim">结束后自动生成问询纪要（问答对汇总 + 各回答方范围声明），本桌转为只读。</div>'
        +'<div class="row" style="margin-top:6px"><button id="inqEnd" class="danger">■ 结束问询并生成纪要</button></div><div class="ferr" id="inqErr"></div></div>';
    } else if(t.phase==='closed'){
      h+='<div class="section dim">问询已结束：纪要在下方「会议纪要」区。</div>';
    }
    /* 会议控制（问询方=控制人）：暂停 / 继续 */
    if(t.phase==='qa'){
      if(t.pause){
        var ctlSeats2=ansSeats;
        var ctlAll2=ctlSeats2.length>0&&ctlSeats2.every(function(s){ return s.config&&s.config.ready; });
        h+='<div class="section sumcard"><h3 style="margin-top:0">会议控制（暂停中）</h3>';
        ctlSeats2.forEach(function(s){
          h+='<div class="kv">'+esc(s.name)+' '+roleBadge(s.role)+' <span class="badge '+((s.config&&s.config.ready)?'ok':'warn')+'">'+((s.config&&s.config.ready)?'已就绪':'未就绪')+'</span></div>';
        });
        h+='<div class="row" style="margin-top:8px"><button id="ctlResume" class="primary"'+(ctlAll2?'':' disabled')+'>▶ 继续问询</button>'
          +'<span class="dim">恢复到「问答」继续；需全部回答方就绪（系统管理员可强制继续）</span></div><div class="ferr" id="ctlErr"></div></div>';
      } else {
        h+='<div class="section sumcard"><h3 style="margin-top:0">会议控制</h3>'
          +'<div class="row"><input id="ctlPauseReason" placeholder="暂停原因（进入会议记录，可空）" style="flex:1;min-width:180px">'
          +'<button id="ctlPause">⏸ 暂停问询</button></div>'
          +'<div class="hint" style="margin-top:4px">暂停后提问与作答都冻结；回答方可调整立场/补充信息并重新就绪，全就绪后在这里继续。</div>'
          +'<div class="ferr" id="ctlErr"></div></div>';
      }
    }
    h+='</div>';
  }

  /* 暂停申请（主持人/建桌人/系统管理员可见 pending：同意后会议暂停；申请方与理由进会议记录与审计） */
  var isController=(mySeat&&(mySeat.seatId===t.ownerSeat||mySeat.role==='host'))||admin;
  if(isController&&(d.pauseRequests||[]).length&&t.phase!=='closed'){
    h+='<div class="card"><div class="shead"><b>暂停申请</b><span class="dim">参与方申请暂停会议 · 同意后进入暂停（记录申请方）</span></div>';
    (d.pauseRequests||[]).forEach(function(pr){
      h+='<div class="row sumcard" style="align-items:flex-start"><div style="flex:1;min-width:0">'
        +'<div class="row">'+roleBadge(pr.byRole)+'<b>'+esc(pr.byName)+'</b><span class="dim">'+fmtTs(pr.createdAt)+'</span></div>'
        +(pr.reason?'<div class="dim" style="margin-top:2px">理由：'+esc(pr.reason)+'</div>':'')
        +'</div><button class="prOk primary sm" data-rid="'+escAttr(pr.requestId)+'">同意暂停</button></div>';
    });
    h+='</div>';
  }

  /* 管理员操作卡（systemadmin 专属：强制介入/暂停/继续/闭桌/删桌，动作审计留痕） */
  if(admin){
    var active=t.phase!=='closed';
    h+='<div class="card gold"><div class="shead"><b>管理员操作</b><span class="dim">系统观察员专属 · 全部动作写入审计</span></div>'
      +'<div class="row"><input id="admReason" placeholder="原因（进入会议记录 / 审计）" style="flex:1;min-width:200px">'
      +(active&&!t.pause&&t.phase!=='human_intervention'?'<button id="admPause">暂停会议</button>':'')
      +(t.pause?'<button id="admResume">继续会议</button><button id="admForce" class="danger">强制继续（跳过就绪）</button>':'')
      +(active&&t.phase!=='human_intervention'?'<button id="admHuman">强制人工介入</button>':'')
      +(active?'<button id="admClose">强制闭桌</button>':'')
      +'<button id="admDel" class="danger">删除圆桌</button></div>'
      +'<div class="hint" style="margin-top:6px">暂停/继续与参与方网页操作同源（记入会议记录与审计）；强制闭桌 = 立即生成纪要并结束（不可恢复）；删除 = 连同消息/产物/席位全部清除（轮询中的 agent 将收到 404）。</div></div>';
  }

  /* 产物（交付卡）：设定阶段尚无产物，开始后才展示（结束后保留作记录）；问询桌流程上不产生产物，恒不渲染 */
  if(t.phase!=='open'&&ttOf(t.tableType).flow!=='inquiry'){
    h+='<div class="card"><div class="shead"><b>产物</b><span class="dim">交付物版本</span><span class="sp"></span><span class="dim">'+(t.artifacts||[]).length+' 项</span></div><div class="cards">';
    (t.artifacts||[]).forEach(function(a){
      h+='<div class="acard"><div class="row"><b>'+esc(a.name)+'</b><span class="badge phase">v'+a.latestVersion+'</span><span class="sp"></span><span class="dim">'+esc(seatName(seats,a.ownerSeat))+'</span></div>'
        +(a.lockedBy?'<div class="dim">锁：'+esc(seatName(seats,a.lockedBy))+'</div>':'')+'</div>';
    });
    if(!(t.artifacts||[]).length) h+='<div class="dim">暂无产物</div>';
    h+='</div></div>';
  }

  /* 资料文档（上传阅资料 / 投屏）：共享=全桌可下载；私有=仅上传席位（他席可见存在但不可下载） */
  h+='<div class="card"><div class="shead"><b>资料文档</b><span class="dim">上传阅资料 · 共享=全桌可下载（投屏评审依据），私有=仅上传席位</span><span class="sp"></span><span class="dim">'+(d.documents||[]).length+' 份</span></div><div class="cards">';
  (d.documents||[]).forEach(function(doc){
    var mine=doc.uploadedBy===d.mySeatId;
    var canDl=doc.visibility==='shared'||mine;
    h+='<div class="dcard"><div class="row"><b>'+esc(doc.name)+'</b>'
      +(doc.visibility==='shared'?'<span class="badge phase">共享</span>':'<span class="badge warn">私有</span>')
      +'<span class="sp"></span><span class="dim">'+fmtSize(doc.size)+'</span></div>'
      +'<div class="dim">'+esc(doc.purpose)+'</div>'
      +'<div class="dim">'+esc(seatName(seats,doc.uploadedBy))+(mine?'（本席）':'')+' · '+fmtTs(doc.uploadedAt)+'</div>'
      +'<div class="row" style="margin-top:6px">'+((canDl&&docPreviewKind(doc.name))?'<button class="docPv sm" data-doc="'+escAttr(doc.docId)+'" data-name="'+escAttr(doc.name)+'" data-size="'+doc.size+'" data-purpose="'+escAttr(doc.purpose)+'">预览</button> ':'')
      +(canDl?'<button class="docDl sm" data-doc="'+escAttr(doc.docId)+'" data-name="'+escAttr(doc.name)+'">下载</button>':'<span class="dim">不可下载</span>')+'</div></div>';
  });
  if(!(d.documents||[]).length) h+='<div class="dim">暂无资料</div>';
  h+='</div>';
  if(mySeat&&t.phase!=='closed'&&mySeat.role!=='observer'){
    h+='<div class="row" style="margin-top:10px;align-items:flex-start">'
      +'<input type="file" id="docFile" style="max-width:240px">'
      +'<input id="docPurpose" placeholder="文档作用声明（必填），如：待评审需求文档 / 调研原始资料（各方可参考）" style="flex:1;min-width:220px">'
      +'<select id="docVis"><option value="shared">共享 · 全桌可读（投屏）</option><option value="private">私有 · 仅本席</option></select>'
      +'<button id="docUpload" class="primary">上传</button></div>'
      +'<div class="hint">共享文档相当于投屏，全桌 agent 收到 DOC_UPLOADED 通知后可下载阅读；私有文档只有本席可下载。单个文件 ≤5MB。</div>'
      +'<div class="ferr" id="docErr"></div>';
  }
  h+='</div>';

  /* 发送人工指令已并入左侧「会话」输入框（类型「人工指令」，按身份与阶段出现） */
  h+='</div></div>';

  /* 问答（问询桌专属通栏）：QUESTION+REPLY 按 toMsgId 配对；列表截断显示，点击卡片弹完整问答。
     设定阶段隐藏（尚无提问），问答阶段起展示 */
  if(ttOf(t.tableType).flow==='inquiry'&&t.phase!=='open'){
    var qaPairs=[], qaByMsg={};
    (d.messages||[]).forEach(function(m){
      if(m.type==='QUESTION'){ qaByMsg[m.msgId]={msg:m,replies:[]}; qaPairs.push(qaByMsg[m.msgId]); }
      else if(m.type==='REPLY'&&m.payload&&qaByMsg[m.payload.toMsgId]){ qaByMsg[m.payload.toMsgId].replies.push(m); }
    });
    view.qaPairs=qaPairs; /* 点击绑定取的快照（renderDetail 局部闭包亦可，存 view 与 lastDetailData 同生命周期） */
    var ansCount=seats.filter(function(s){ return s.role==='answerer'; }).length;
    h+='<div class="card"><div class="shead"><b>问答</b><span class="dim">问题与各方回答汇总 · 点击卡片查看完整问答</span><span class="sp"></span><span class="dim">'+qaPairs.length+' 问 · '+ansCount+' 个回答方</span></div>';
    qaPairs.forEach(function(qa,qi){
      var qp=qa.msg.payload||{};
      h+='<div class="rcard qa-item" data-qa="'+qi+'" title="点击查看完整问答" style="margin:8px 0">'
        +'<div class="row"><span class="mt mt-q">Q'+(qi+1)+'</span>'
        +(qp.toSeat?('<span class="badge">定向 · '+esc(seatName(seats,qp.toSeat))+'</span>'):'<span class="badge phase">广播</span>')
        +'<span class="sp"></span><span class="dim">'+fmtTs(qa.msg.ts)+'</span></div>'
        +'<div style="margin-top:4px">'+esc(clipStr(qp.text||'',120))+'</div>';
      if(qa.replies.length){
        qa.replies.forEach(function(rm){
          h+='<div class="dim" style="margin-top:4px"><b>'+esc(seatName(seats,rm.fromSeat))+'</b>：'+esc(clipStr((rm.payload&&rm.payload.text)||'',100))+'</div>';
        });
      } else {
        h+='<div style="margin-top:4px"><span class="badge warn">待回答</span></div>';
      }
      h+='</div>';
    });
    if(!qaPairs.length) h+='<div class="dim">'+(t.phase==='open'?'问询尚未开始，暂无提问':'暂无提问')+'</div>';
    h+='</div>';
  }

  /* 执行请求（全宽通栏，会议纪要上方；同席=认领自办，跨席=委托他席，点击弹详情）。
     设定阶段隐藏（尚无请求）；问询桌流程上不产生执行请求，恒不渲染 */
  if(ttOf(t.tableType).flow!=='inquiry'&&t.phase!=='open'){
    h+='<div class="card"><div class="shead"><b>执行请求</b><span class="dim">回应评审派生的修改/澄清委托：同席 = 认领自办，跨席 = 委托他席 · 点击卡片看详情</span><span class="sp"></span><span class="dim">'+(d.requests||[]).length+' 项</span></div><div class="cards">';
    (d.requests||[]).forEach(function(r,ri){
      var st=r.status, cls=st==='executed'?'ok':(st==='rejected'?'err':((st==='pending'||st==='human')?'warn':''));
      var art=''; (t.artifacts||[]).forEach(function(a){ if(a.artifactId===r.req.artifactId) art=a.name; });
      var selfExe=r.createdBy===r.req.toSeat;
      var who=selfExe
        ?(esc(seatName(seats,r.createdBy))+' · 认领自办（接受意见自行修改）')
        :(esc(seatName(seats,r.createdBy))+' 委托 '+esc(seatName(seats,r.req.toSeat)));
      h+='<div class="rcard '+cls+'" data-ri="'+ri+'" title="点击查看请求详情">'
        +'<div class="row"><b>'+esc(clipStr(r.req.title,40))+'</b><span class="sp"></span>'+(selfExe?'<span class="badge">认领自办</span>':'')+'<span class="badge '+cls+'">'+esc(REQ_ST_LABEL[st]||st)+'</span></div>'
        +'<div class="dim">'+who+' · '+fmtTs(r.createdAt)+'</div>'
        +'<div class="dim">'+esc(REQ_INTENT_LABEL[r.req.intent]||r.req.intent||'')+(art?(' · 产物：'+esc(clipStr(art,20))):'')+'</div>'
        +((r.response&&(r.response.reason||r.response.counterDetail))?'<div class="dim">'+esc(clipStr(r.response.reason||r.response.counterDetail,80))+'</div>':'')
        +'</div>';
    });
    if(!(d.requests||[]).length) h+='<div class="dim">暂无请求</div>';
    h+='</div></div>';
  }

  /* 纪要（总-分栏-总的底部通栏全宽；md 格式经 miniMd 安全渲染） */
  if(d.minutes){
    h+='<div class="card"><div class="shead"><b>会议纪要</b></div><div class="mdv">'+miniMd(d.minutes.markdown||'')+'</div></div>';
  }

  /* 旧的合并流历史面板已移除：消息流由左栏「会话」承载（筛选 + 阶段分隔条 + 全量徽章），
     产物/资料/席位变动分别见 产物卡、资料文档卡、席位与立场卡；私有指令记录见会话输入框「私有指令」组 */

  var app=document.getElementById('app');
  app.innerHTML=h;
  document.title=t.topic+' · 圆桌详情'; // 分享/历史记录可辨识
  document.getElementById('back').onclick=function(){ openList(); };
  document.getElementById('dCopyLink').onclick=function(){ copyText(location.origin+'/#/table/'+view.tableId); toast('详情页链接已复制，可发给他人直达本桌'); };

  /* ---- 绑定：圆桌示意图 >8 席折叠展开（纯视图操作；rerenderDetail 附带输入草稿采集回填） ---- */
  var rtMore=document.getElementById('rtMore');
  if(rtMore) rtMore.onclick=function(){ view.rtExpanded=!view.rtExpanded; rerenderDetail(); };
  var rtFold=document.getElementById('rtFold');
  if(rtFold) rtFold.onclick=function(){ view.rtExpanded=false; rerenderDetail(); };
  /* ---- 绑定：会话视图筛选芯片（纯视图操作） ---- */
  app.querySelectorAll('button[data-cf]').forEach(function(b){
    b.onclick=function(){ view.chatFilter=b.getAttribute('data-cf')||'all'; rerenderDetail(); };
  });
  /* ---- 绑定：会话滚动位置（贴底自动跟随新消息；上翻阅读则保持原位） ---- */
  var cbList=document.getElementById('cbList');
  if(cbList){
    cbList.scrollTop=(view.chatAtBottom!==false)?cbList.scrollHeight:view.cbPrevTop;
    cbList.addEventListener('scroll',function(){
      view.chatAtBottom=(cbList.scrollTop+cbList.clientHeight>=cbList.scrollHeight-24);
      view.cbPrevTop=cbList.scrollTop;
    });
  }
  /* ---- 绑定：我的席位折叠子区块开合（view.seatOpen 抗轮询重渲染） ---- */
  ['seatDetCtl','seatDetPr','seatDetPod','seatDetCred'].forEach(function(id){
    var det=document.getElementById(id);
    if(!det) return;
    if(view.seatOpen&&Object.prototype.hasOwnProperty.call(view.seatOpen,id)) det.open=!!view.seatOpen[id];
    det.addEventListener('toggle',function(){
      if(!view.seatOpen) view.seatOpen={};
      view.seatOpen[id]=det.open;
    });
  });
  /* ---- 绑定：输入类型芯片切换（只改 display，不重渲染——各类型组草稿原地保留） ---- */
  app.querySelectorAll('button[data-ct]').forEach(function(b){
    b.onclick=function(){
      view.cmpType=b.getAttribute('data-ct')||'';
      app.querySelectorAll('.cmp-grp').forEach(function(g){ g.style.display=(g.getAttribute('data-grp')===view.cmpType)?'':'none'; });
      app.querySelectorAll('button[data-ct]').forEach(function(x){ x.className='fbtn'+((x.getAttribute('data-ct')===view.cmpType)?' on':''); });
    };
  });
  /* ---- 绑定：执行请求卡片 → 详情弹窗（纯查看，不触发草稿保护） ---- */
  app.querySelectorAll('.rcard[data-ri]').forEach(function(el){
    el.onclick=function(){
      var ri=parseInt(el.getAttribute('data-ri'),10);
      var reqs=(view.lastDetailData&&view.lastDetailData.requests)||[];
      if(reqs[ri]) openRequestModal(reqs[ri],seats,(t.artifacts||[]));
    };
  });
  /* ---- 绑定：问答卡 → 完整问答弹窗（纯查看，不触发草稿保护） ---- */
  app.querySelectorAll('.qa-item[data-qa]').forEach(function(el){
    el.onclick=function(){
      var qi=parseInt(el.getAttribute('data-qa'),10);
      var pairs=view.qaPairs||[];
      if(pairs[qi]) openQaModal(pairs[qi],seats);
    };
  });

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
    }).then(function(){ toast('已发送'); document.getElementById('hText').value=''; view.dirtyPanel=false; loadDetail(); })
      .catch(function(e){ toast('发送失败：'+e.message); });
  };

  /* ---- 绑定：我的席位面板（open 设定阶段与会议暂停期共用同一套设定表单 id） ---- */
  if(mySeat&&(t.phase==='open'||t.pause)){
    var cfgPreset=document.getElementById('cfgPreset');
    if(cfgPreset){
      /* 立场预设 + 回填（按本桌类型 forTypes 与本席角色过滤） */
      var stances=[], myType=t.tableType;
      api('GET','/api/stances').then(function(sd){
        stances=(sd.stances||[]).filter(function(s){
          if(s.forTypes && s.forTypes.length && s.forTypes.indexOf(myType)<0) return false;
          return s.forRole==='any' || s.forRole===mySeat.role;
        });
        var o='<option value="">（选择立场预设…）</option>';
        stances.forEach(function(s){ o+='<option value="'+esc(s.id)+'"'+((mySeat.config&&mySeat.config.stancePreset===s.id)?' selected':'')+'>'+esc(s.label)+'（'+esc(ROLE_LABEL[s.forRole]||s.forRole)+'）</option>'; });
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

  /* ---- 绑定：开始会议/问询（建桌人席位 stStart 或问询方 inqStart，统一 my/start 按桌类型分流；
     双身份同页时两个按钮各自绑定、错误各回各的提示区） ---- */
  var inqOfTable=t.tableType==='inquiry';
  function bindStartBtn(btnId, errId){
    var btn=document.getElementById(btnId);
    if(!btn) return;
    btn.onclick=function(){
      if(btn.disabled) return;
      api('POST','/api/tables/'+view.tableId+'/my/start',{}).then(function(){
        toast(inqOfTable?'问询已开始，可以提问了':'会议已开始，进入提案陈述阶段'); view.dirtyPanel=false; loadDetail();
      }).catch(function(e){ document.getElementById(errId).textContent='开始失败：'+e.message; });
    };
  }
  bindStartBtn('stStart','stErr');
  bindStartBtn('inqStart','inqStartErr');

  /* ---- 绑定：问询方提问 / 结束问询（无席位通道） ---- */
  var askSend=document.getElementById('askSend');
  if(askSend) askSend.onclick=function(){
    var text=document.getElementById('askText').value.trim();
    var errEl=document.getElementById('askErr'); errEl.textContent='';
    if(!text){ errEl.textContent='请输入问题'; return; }
    var to=document.getElementById('askTo').value;
    askSend.disabled=true;
    api('POST','/api/tables/'+view.tableId+'/ask',{text:text,toSeat:to||undefined})
      .then(function(){ toast('已提问'); document.getElementById('askText').value=''; view.dirtyPanel=false; loadDetail(); })
      .catch(function(e){ askSend.disabled=false; errEl.textContent='提问失败：'+e.message; });
  };
  var inqEnd=document.getElementById('inqEnd');
  if(inqEnd) inqEnd.onclick=function(){
    if(!window.confirm('结束问询？将生成问询纪要并关闭本桌（不可恢复）。')) return;
    api('POST','/api/tables/'+view.tableId+'/end-inquiry',{})
      .then(function(){ toast('问询已结束，纪要已生成'); view.dirtyPanel=false; loadDetail(); })
      .catch(function(e){ document.getElementById('inqErr').textContent='结束失败：'+e.message; });
  };

  /* ---- 绑定：代答（会议中持发言权） ---- */
  var pxType=document.getElementById('pxType');
  if(pxType){
    var PHASE_TYPES={statements:['STATEMENT'],'review':['REVIEW_COMMENT'],'response':['RESPONSE'],'execution':['RESPOND_REQUEST'],'convergence':['CONSENSUS_VOTE'],qa:['REPLY']};
    var types=(PHASE_TYPES[t.phase]||[]).concat(['QUESTION']);
    /* hosted 点名期：被点名席（含本人代答）可提交 SUPPLEMENT */
    if(t.precheck&&t.precheck.state==='directive'&&turn&&turn.seatId===d.mySeatId) types=types.concat(['SUPPLEMENT']);
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
        else if(type==='REPLY'){ var qm=/\"toMsgId\":\"(msg_[^\"]+)\"/.exec(turn.taskHint||''); payload={toMsgId:qm?qm[1]:'',text:text}; }
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
        .then(function(){ toast('已代答发送'); document.getElementById('pxText').value=''; document.getElementById('pxJsonBox').value=''; view.dirtyPanel=false; loadDetail(); })
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

  /* ---- 绑定：公开补充（HUMAN_INPUT） ---- */
  var myInstrSend=document.getElementById('myInstrSend');
  if(myInstrSend) myInstrSend.onclick=function(){
    var txt=document.getElementById('myInstr').value.trim();
    if(!txt){ toast('请输入内容'); return; }
    api('POST','/api/tables/'+view.tableId+'/human-input',{
      text:txt, toSeat:d.mySeatId, byHuman:document.getElementById('myInstrBy').value.trim()
    }).then(function(){ toast('公开补充已发送（进入会议记录）'); document.getElementById('myInstr').value=''; view.dirtyPanel=false; loadDetail(); })
      .catch(function(e){ toast('发送失败：'+e.message); });
  };

  /* ---- 绑定：私有指令（仅本席 agent 可见） ---- */
  var podSend=document.getElementById('podSend');
  if(podSend) podSend.onclick=function(){
    var txt=document.getElementById('podText').value.trim();
    if(!txt){ toast('请输入指令'); return; }
    api('POST','/api/tables/'+view.tableId+'/my/owner-directive',{text:txt}).then(function(){
      toast('私有指令已提交（本席 agent 下次 poll 即见）'); document.getElementById('podText').value=''; view.dirtyPanel=false; loadDetail();
    }).catch(function(e){ document.getElementById('podErr').textContent='发送失败：'+e.message; });
  };
  var podList=document.getElementById('podList');
  if(podList){
    api('GET','/api/tables/'+view.tableId+'/my/owner-directives').then(function(r){
      var list=(r.directives||[]).slice(-20).reverse();
      if(!list.length){ podList.innerHTML='<div class="dim">还没有发过私有指令。</div>'; return; }
      podList.innerHTML='<div class="dim" style="margin-bottom:4px">我发出的私有指令（仅自己可见）</div>'
        +list.map(function(x){
          return '<div class="sumcard"><div class="row"><span class="badge '+(x.deliveredAt?'ok':'warn')+'">'+(x.deliveredAt?'agent 已确认':'待送达')+'</span>'
            +'<span class="dim">'+fmtTs(x.createdAt)+(x.deliveredAt?(' · 确认于 '+fmtTs(x.deliveredAt)):'')+'</span></div>'
            +'<div style="margin-top:4px;white-space:pre-wrap">'+esc(x.text)+'</div></div>';
        }).join('');
    }).catch(function(){ podList.innerHTML=''; });
  }

  /* ---- 绑定：会议控制（暂停/继续，建桌人/主持人） ---- */
  var ctlPause=document.getElementById('ctlPause');
  if(ctlPause) ctlPause.onclick=function(){
    api('POST','/api/tables/'+view.tableId+'/my/pause',{reason:document.getElementById('ctlPauseReason').value.trim()})
      .then(function(){ toast('会议已暂停，各方已收到通知'); view.dirtyPanel=false; loadDetail(); })
      .catch(function(e){ document.getElementById('ctlErr').textContent='暂停失败：'+e.message; });
  };
  var ctlResume=document.getElementById('ctlResume');
  if(ctlResume) ctlResume.onclick=function(){
    if(ctlResume.disabled) return;
    api('POST','/api/tables/'+view.tableId+'/my/resume',{})
      .then(function(){ toast('会议已继续'); view.dirtyPanel=false; loadDetail(); })
      .catch(function(e){ document.getElementById('ctlErr').textContent='继续失败：'+e.message; });
  };

  /* ---- 绑定：申请暂停（普通席位，会议中未暂停时） ---- */
  var prApply=document.getElementById('prApply');
  if(prApply) prApply.onclick=function(){
    api('POST','/api/tables/'+view.tableId+'/my/pause-request',{reason:document.getElementById('prReason').value.trim()})
      .then(function(){ toast('暂停申请已提交，等待主持人/建桌人/系统管理员同意'); view.dirtyPanel=false; loadDetail(); })
      .catch(function(e){ document.getElementById('prErr').textContent='申请失败：'+e.message; });
  };

  /* ---- 绑定：同意暂停申请（主持人/建桌人走 my 通道；无席位的管理员走 admin 通道） ---- */
  app.querySelectorAll('button.prOk').forEach(function(b){
    b.onclick=function(){
      var rid=encodeURIComponent(b.getAttribute('data-rid')||'');
      var asAdmin=admin&&!(mySeat&&(mySeat.seatId===t.ownerSeat||mySeat.role==='host'));
      var url=asAdmin
        ?('/api/admin/tables/'+view.tableId+'/pause-request/'+rid+'/approve')
        :('/api/tables/'+view.tableId+'/my/pause-request/'+rid+'/approve');
      api('POST',url,{}).then(function(){ toast('已同意暂停申请，会议已暂停'); view.dirtyPanel=false; loadDetail(); })
        .catch(function(e){ toast('同意失败：'+e.message); });
    };
  });

  /* ---- 绑定：管理员操作（暂停/继续/强制继续） ---- */
  var admPause=document.getElementById('admPause');
  if(admPause) admPause.onclick=function(){
    api('POST','/api/admin/tables/'+view.tableId+'/pause',{reason:document.getElementById('admReason').value.trim()})
      .then(function(){ toast('会议已暂停'); view.dirtyPanel=false; loadDetail(); })
      .catch(function(e){ toast('失败：'+e.message); });
  };
  var admResume=document.getElementById('admResume');
  if(admResume) admResume.onclick=function(){
    api('POST','/api/admin/tables/'+view.tableId+'/resume',{})
      .then(function(){ toast('会议已继续'); view.dirtyPanel=false; loadDetail(); })
      .catch(function(e){ toast('失败：'+e.message); });
  };
  var admForce=document.getElementById('admForce');
  if(admForce) admForce.onclick=function(){
    if(!confirm('强制继续将跳过「全员就绪」检查立即恢复会议（写入审计）。确定？')) return;
    api('POST','/api/admin/tables/'+view.tableId+'/resume',{force:true})
      .then(function(){ toast('已强制继续会议（跳过就绪检查，已记审计）'); view.dirtyPanel=false; loadDetail(); })
      .catch(function(e){ toast('失败：'+e.message); });
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

  /* composer 草稿回填：发送/轮询触发重渲染后保留未发送类型的内容（已发送的由各发送回调清空自身输入框）；
     代答表单恢复后重算联动显隐（pxSync 在 pxType 存在时由绑定块赋值） */
  restoreInputs(view.cmpKeep||{});
  if(typeof pxSync==='function') pxSync();
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
  view.dirtyPanel=false; view.cfgEditing=false; view.rtExpanded=false;
  view.chatFilter='all'; view.cmpType=''; view.seatOpen={}; view.chatAtBottom=true; view.cbPrevTop=0;
  clearInterval(view.timer);
  var want='#/table/'+id;
  if(location.hash!==want) location.hash=want; // 详情页 URL（刷新/分享/后退可用）；先定好 view 再写 hash，hashchange→syncRoute 幂等不重入
  document.getElementById('app').innerHTML='<div class="card dim">加载圆桌 '+esc(id)+'…</div>';
  loadDetail();
  view.timer=setInterval(function(){ if(view.mode==='detail') loadDetail(); },5000);
}
function openList(){
  view.mode='list'; view.tableId=null; view.dirtyPanel=false;
  clearInterval(view.timer);
  if((location.hash||'')!=='') history.pushState(null,'',location.pathname+location.search); // 清掉详情 hash（入历史栈，后退可回详情）
  document.title='智能体协同博弈平台 · agent-talk';
  loadList();
}

/* ---------- hash 路由：详情页 URL 直达（#/table/<id>）----------
   刷新/分享/前进后退均保持视图；未登录打开分享链时 hash 原样保留，登录成功后凭 hash 直达 */
function routeTableId(){ var m=/^#\/table\/([A-Za-z0-9_-]+)/.exec(location.hash||''); return m?m[1]:null; }
/* 一次性网页登录链接（#/login/<token>）：agent 生成、10 分钟内一次有效；
   兑换成功即记录帐号并设为活跃（多帐号并存，可随时切回），失败给出明确提示 */
function routeLoginToken(){ var m=/^#\/login\/([A-Za-z0-9_-]+)/.exec(location.hash||''); return m?m[1]:null; }
function tryExchangeLogin(lt){
  fetch('/api/auth/exchange',{ method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({token:lt}) })
    .then(function(r){ return r.json().then(function(j){ if(!r.ok) throw new Error((j.error&&j.error.message)||('HTTP '+r.status)); return j.data; }); })
    .then(function(d){
      TOKEN=d.token;
      accountUpsert({ token:d.token, userId:d.userId||'', name:d.name||'', role:d.role||'user' });
      view.userName=d.name||''; view.userId=d.userId||''; view.role=d.role||'user';
      refreshWho(); toast('已登录：'+(d.name||''));
      var tid=routeTableId();
      if(tid) openTable(tid); else openList();
    })
    .catch(function(e){
      toast('登录链接无效：'+e.message);
      if(!view.userName){ TOKEN=''; refreshWho(); renderIntro(); }
    });
}
function syncRoute(){
  var lt=routeLoginToken();
  if(lt){ // 已打开页面里点到登录链接（hash 变化不重载页面）：同样走兑换，先清 URL 防重复消费
    history.replaceState(null,'',location.pathname+location.search);
    tryExchangeLogin(lt);
    return;
  }
  var id=routeTableId();
  if(id){ if(!(view.mode==='detail'&&view.tableId===id)) openTable(id); }
  else if(view.mode==='detail') openList();
}
window.addEventListener('hashchange',syncRoute);
window.addEventListener('popstate',syncRoute);

/* ---------- 草稿保护：面板内任何编辑都冻结轮询重渲染 ---------- */
(function(){
  document.addEventListener('keydown',function(e){ if(e.key==='Escape'){ closeDocPreview(); closeHelp(); closeRequestModal(); closeAcctMenu(); } });
  var app=document.getElementById('app');
  var mark=function(e){
    if(view.mode!=='detail') return;
    view.dirtyPanel=true;
  };
  app.addEventListener('input',mark,true);
  app.addEventListener('change',function(e){
    mark(e);
  },true);
})();

/* ---------- 启动 ---------- */
document.getElementById('helpBtn').onclick=openHelp;
refreshWho();
var loginLt=routeLoginToken();
if(loginLt){ // 一次性登录链接：先清 URL（防刷新/分享重复消费），再异步兑换
  history.replaceState(null,'',location.pathname+location.search);
  document.getElementById('app').innerHTML='<div class="card dim">正在通过登录链接连接…</div>';
  tryExchangeLogin(loginLt);
}
else if(TOKEN){
  renderIntro();
  api('GET','/api/observer/tables').then(function(){
    fetchMe();
    var tid=routeTableId();
    if(tid) openTable(tid); else openList(); // 刷新/分享链直达详情
  })
    .catch(function(){ toast('已保存的 token 失效，请重新连接'); });
}
else { renderIntro(); }
</script>
</body>
</html>`;
