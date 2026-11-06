/* 观察端全量样式 — 原单文件 <style> 段原样拆出，由 observer-html.ts 组装。
   模板内禁用反引号约束不变。 */
export const OBSERVER_CSS = String.raw`  :root { --bg:#0f1117; --panel:#171a23; --panel-2:#1c2231; --line:#2a2f3d; --line-2:#3a4256; --fg:#e6e9f0; --dim:#a2abc0; --acc:#4f8cff; --acc-bg:rgba(79,140,255,.13); --ok:#3fb68b; --warn:#e0a23c; --err:#e05c5c; --gold:#e8c877; --goldline:#a8853f; --vote:#b07ce8; --r:8px; --r-lg:12px; --tt:.18s; }
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
  .rb.worker { color:var(--ok); border-color:var(--ok); }
  .rb.director { color:var(--acc); border-color:var(--acc); border-style:dashed; }
  .rb.provider { color:var(--vote); border-color:var(--vote); }
  .rb.receiver { color:var(--warn); border-color:var(--warn); }
  .rb.ttype { color:var(--warn); border-color:var(--warn); border-style:dashed; }
  /* chips 输入器（数据范围） */
  .chips { display:flex; flex-wrap:wrap; gap:6px; padding:6px 8px; border:1px solid var(--line); border-radius:var(--r); background:var(--panel); min-height:38px; align-items:center; transition:border-color var(--tt),box-shadow var(--tt); }
  .chips:focus-within { border-color:var(--acc); box-shadow:0 0 0 3px var(--acc-bg); }
  .chips input { border:none; background:transparent; padding:2px 4px; flex:1; min-width:130px; box-shadow:none; }
  .chips input:focus { outline:none; box-shadow:none; }
  .chip { display:inline-flex; align-items:center; gap:4px; padding:1px 6px 1px 8px; border-radius:99px; border:1px solid var(--acc); color:var(--acc); font-size:12px; font-family:ui-monospace,Menlo,monospace; background:var(--acc-bg); }
  .chip b { cursor:pointer; color:var(--dim); font-weight:400; padding:0 3px; }
  .chip b:hover { color:var(--err); }
  .chip select.dsg { font-size:11px; font-family:inherit; background:transparent; color:var(--dim); border:none; padding:0; cursor:pointer; }
  .chip i.dgl { font-style:normal; font-size:10px; color:var(--dim); border-left:1px solid var(--line); padding-left:4px; }
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
  /* 已断开席位：灰调虚线卡片（优先于思考中高亮——不再脉冲） */
  .rt-node.off .rt-card { border-color:var(--line-2); border-style:dashed; background:var(--panel); opacity:.72; }
  .rt-node.off .rt-nm { color:var(--dim); }
  .rt-off { font-size:11px; color:var(--err); white-space:nowrap; }
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
  /* 模式帮助弹窗（建桌表单桌类型卡片「?」） */
  #modeHelpModal .dbody h4 { margin:18px 0 6px; font-size:14px; color:var(--acc); }
  #modeHelpModal .dbody h4:first-child { margin-top:0; }
  #modeHelpModal .dbody p { margin:4px 0; }
  #modeHelpModal .dbody ol.mhelp, #modeHelpModal .dbody ul.mhelp { margin:4px 0; padding-left:20px; }
  #modeHelpModal .dbody li { margin:4px 0; }
  .mh-q { display:inline-flex; align-items:center; justify-content:center; width:17px; height:17px; padding:0; border:1px solid var(--line-2); border-radius:50%; background:var(--panel-2); color:var(--dim); font-size:11px; line-height:1; cursor:pointer; vertical-align:2px; transition:border-color var(--tt),color var(--tt),background var(--tt); }
  .mh-q:hover { border-color:var(--acc); color:var(--acc); background:var(--acc-bg); }
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
  .lgd .off { color:var(--err); }
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
  /* 左右侧切换按钮（席位与立场 / 圆桌示意图节点）：个人会话视图偏好，右侧高亮 */
  .sideT { cursor:pointer; }
  .sideT.on { color:var(--acc); border-color:var(--acc); }
  .rt-tags .sideT { font-size:11px; padding:0 6px; }
  /* 参与方卡片顶边色补全：回答方（问询桌）/ 问询方 */
  .vcard.answerer { border-top-color:var(--ok); }
  .vcard.asker { border-top-color:var(--acc); }
  .vcard.worker { border-top-color:var(--ok); }
  .vcard.director { border-top-color:var(--acc); }
  .rt-card.answerer { border-top-color:var(--ok); }
  .rt-card.asker { border-top-color:var(--acc); }
  .lgd .answerer { color:var(--ok); }
  .lgd .asker { color:var(--acc); }
  .cb-who { display:flex; gap:6px; align-items:center; font-size:12px; color:var(--dim); margin-bottom:3px; flex-wrap:wrap; }
  .cb-who .rb { font-size:11px; padding:0 6px; }
  .cb-meta { display:flex; gap:6px; align-items:center; flex-wrap:wrap; font-size:11px; color:var(--dim); margin-top:4px; }
  .cb-sys { align-self:center; max-width:94%; text-align:center; font-size:12px; color:var(--dim); background:var(--panel); border:none; border-radius:99px; padding:3px 14px; overflow-wrap:anywhere; }
  .cb-empty { align-self:center; color:var(--dim); font-size:12px; padding:18px 0; }
  /* 执行时序图（左栏会话上方）：纵向时序 DAG——时间从上到下，agent 各占一列（列头 sticky，>8 按角色分组） */
  .tl-scroll { overflow:auto; max-height:420px; border:1px solid var(--line); border-radius:var(--r); background:#141722; }
  .tl-inner { position:relative; }
  .tl-grow { position:sticky; top:0; z-index:3; display:flex; align-items:center; height:20px; background:var(--panel); border-bottom:1px solid var(--line); }
  .tl-gcell { font-size:11px; color:var(--dim); text-align:center; border-right:1px dashed var(--line); overflow:hidden; white-space:nowrap; }
  .tl-gsp { flex:0 0 24px; background:var(--panel); }
  .tl-hrow { position:sticky; top:0; z-index:3; display:flex; align-items:center; height:26px; background:var(--panel); border-bottom:1px solid var(--line); }
  .tl-colhead { display:flex; align-items:center; justify-content:center; gap:5px; font-size:12px; padding:0 4px; overflow:hidden; white-space:nowrap; }
  .tl-colhead .dot { width:8px; height:8px; border-radius:50%; flex:0 0 8px; }
  .tl-colhead b { overflow:hidden; text-overflow:ellipsis; }
  .tl-svg { display:block; }
  .tl-svg text { font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; }
  .tl-node { cursor:pointer; }
  .tl-node:hover rect.tl-box { stroke:var(--acc); }
  .tl-run rect.tl-box { animation:tlPulse 1.6s ease-in-out infinite; }
  @keyframes tlPulse { 0%,100% { opacity:1; } 50% { opacity:.4; } }
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
`;
