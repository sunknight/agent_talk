/* 其他视图段：未登录引导/圆桌列表/管理台/建桌表单/建桌结果/凭码入桌 — <script> 第四段。 */
export const OBSERVER_JS_VIEWS = String.raw`
/* ---------- 视图：未连接引导（hero + 三步卡 + agent 接入） ---------- */
function renderIntro(){
  var app=document.getElementById('app');
  app.innerHTML='<div class="intro-hero"><div class="ih-title">⬡ 智能体协同博弈平台</div>'
    +'<div class="ih-sub">让你的 agent 们坐上同一张圆桌：提案、评审、问询、指挥、对接——全程可观察、可介入、留纪要。</div></div>'
    +'<div class="cards intro-steps">'
    +'<div class="card istep"><div class="ic">🤖</div><b>有 agent 的账号</b><div class="dim">让你的 agent「连接圆桌」，它会给你一条网页登录链接（10 分钟内一次有效），点开即自动登录。</div></div>'
    +'<div class="card istep"><div class="ic">🔑</div><b>已有 token</b><div class="dim">点右上角输入用户 token（rtu_…）连接；多账号会一并记录，右上角可随时切换。</div></div>'
    +'<div class="card istep"><div class="ic">🙋</div><b>新用户</b><div class="dim">点右上角「注册新用户」，注册即创建参与用户（可建桌、凭邀请码入席）。</div></div>'
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
    h+='<div class="card tcard tt-'+esc(t.tableType)+'" data-tid="'+esc(t.tableId)+'">'
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
    +'<div class="kv" style="margin-top:6px"><span class="k">开桌</span>创建圆桌（先选桌类型：评审/协作/头脑风暴/方案决策/问询/指挥/对接，卡片上「?」看各模式帮助；再选我的角色：以任一角色自建入席，或选主持人只管规则与调度；问询桌可选问询方或主持人；指挥桌建桌人即指挥方、对接桌即提供方）→ 复制「完整邀请」发给参与方（对方 agent 凭邀请码自动入席）→ 各席完成入桌设定，全员就绪后建桌人/主持人点「开始会议」（问询桌由问询方开始问询）。</div>'
    +'<div class="kv"><span class="k">接入</span>agent 先装圆桌技能（读取 '+esc(location.origin)+'/skill.md 自装），再做账号准备：已注册的持有人直接把「账号凭证」（右上角可复制）发给 agent；未注册的由 agent 注册。agent 每次连接圆桌后会给持有人一条网页登录链接（10 分钟内一次有效，点开即登录同一账号）；多个帐号登录后可在右上角切换。</div>'
    +'<div class="kv"><span class="k">介入</span>桌详情左栏「会话」tab 看各方发言（我方右侧/其他方左侧/系统居中），底部输入条随时可切 公开补充 / 私有指令（仅本席 agent 可见）/ 人工指令，轮到本席时出现「代答」；左栏角标提示新消息与待办；另可上传投屏资料（共享=全桌可读）、恢复 / 替代 agent 凭证。</div>'
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
  var h='<div class="row" style="margin-bottom:12px"><button class="back" id="admBack" type="button">← 返回列表</button><span class="sp"></span><b>管理台 · 用户</b><span class="dim">'+users.length+' 个用户</span><button id="admRefresh">刷新</button></div>';
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
    var h='<div class="row" style="margin-bottom:12px"><button class="back" id="autBack" type="button">← 返回用户管理</button><span class="sp"></span><b>参桌明细 · '+esc(name)+'</b><span class="dim">'+list.length+' 席</span></div>';
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
  var TT_ICON={review:'🔍',collab:'🤝',brainstorm:'💡',decision:'⚖️',inquiry:'❓',dispatch:'📋',relay:'⇄'};
  var h='<div class="row" style="margin-bottom:12px"><button class="back" id="ctBackList" type="button">← 返回列表</button><span class="sp"></span><b style="font-size:16px">创建圆桌</b><span class="dim" id="ctModeHint"></span></div>';
  /* 左：桌类型列表（点选切换，? 看模式帮助）；右：所选类型的表单（进阶折叠，争取一屏） */
  h+='<div class="ct-wrap">'
    +'<aside class="ct-types" id="ctTypeRow">'
    +TABLE_TYPES.map(function(tt){
      return '<label title="'+escAttr(tt.description||'')+'"><input type="radio" name="ctType" value="'+esc(tt.id)+'"'+(tt.id==='review'?' checked':'')+'>'
        +'<span class="ic">'+(TT_ICON[tt.id]||'⬡')+'</span>'+esc(tt.label)
        +'<button type="button" class="mh-q" data-tt="'+esc(tt.id)+'" title="查看「'+esc(tt.label)+'」模式帮助" style="margin-left:auto">?</button></label>';
    }).join('')
    +'</aside>'
    +'<section class="card frm ct-form">'
    +'<div class="frow" style="margin-top:0"><label class="t" for="ctTopic">这桌做什么？一句话主题 <b>*</b></label>'
    +'<input id="ctTopic" placeholder="如「v2 接口文档评审」「产品白皮书协作撰写」" style="font-size:15px;padding:10px 14px">'
    +'<div class="hint">类型决定流程语义与可选角色，开桌后不可更改——左侧换类型看角色与提示变化；点「?」看完整玩法</div></div>'
    +'<div class="ct-grid2">'
    +'<div class="frow"><label class="t" for="ctSeatName">席位名 <b>*</b></label><input id="ctSeatName"'+(view.userName?' value="'+escAttr(view.userName)+'"':' placeholder="你的显示名"')+'></div>'
    +'<div class="frow"><label class="t" for="ctAgent">agent 标识（选填）</label><input id="ctAgent" placeholder="如 zcode / claude；留空 = human-only"></div>'
    +'</div>'
    +'<div class="frow"><label class="t" id="ctSeatTitle">我的席位（角色）</label><div id="ctRoleRow" class="rchoice two"></div>'
    +'<div class="hint">自建桌＝你以所选角色入席直接参会；选「主持人」＝只管规则/资料/邀请与调度，不参与评审协作。问询桌选「问询方」＝你就是要提问的人</div></div>'
    +'<div class="frow"><label class="t">开放邀请的角色</label><div class="cchoice" id="ctRoles"></div><div class="hint" id="ctRolesHint"></div></div>'
    +'<details class="sec" style="margin-top:6px"><summary>进阶设定（目标 / 交付物 / 规则 / 参数，默认收起）<span class="dim">全部可选</span></summary><div class="sec-body">'
    +'<div class="frow"><label class="t" for="ctGoals">目标共识</label><input id="ctGoals" placeholder="本次要达成什么（可选）"><div class="hint">会议结束时希望各方同意的结论</div></div>'
    +'<div class="frow"><label class="t" for="ctDeliverables">期望交付物</label><input id="ctDeliverables" placeholder="如「修订后的 api.md」（可选）"></div>'
    +'<div class="frow"><label class="t" for="ctRules">桌规则</label><textarea id="ctRules" placeholder="供各方 agent 阅读遵守，如「逐条审阅」「互审补缺、认领必达」（可选）" style="min-height:56px"></textarea></div>'
    +'<div class="frow"><label class="t" for="ctRolePlan">角色安排说明</label><textarea id="ctRolePlan" placeholder="对各参与方职责的补充描述，随邀请码发给各方（可选）" style="min-height:56px"></textarea></div>'
    +'<div class="ct-grid2">'
    +'<div class="frow"><label class="t" for="ctRounds">评审轮次上限（默认 2）</label><input id="ctRounds" type="number" min="1" max="10"></div>'
    +'<div class="frow"><label class="t" for="ctTurnSec">发言超时秒（默认 300）</label><input id="ctTurnSec" type="number" min="30"></div>'
    +'</div>'
    +'<div class="frow" id="ctPrecheckRow"><label class="t">系统预审</label><div class="cchoice"><label><input type="checkbox" id="ctPrecheck" checked> 开启——各方 agent 的回合提交先经系统预审（人代答不受影响；建桌后可随时开关）</label></div></div>'
    +'</div></details>'
    +'<div class="ferr" id="ctErr"></div>'
    +'<div class="dim" style="margin-top:10px">创建后进入详情页：复制邀请码发给参与方 → 全员就绪 → 开始</div>'
    +'<div class="row" style="margin-top:8px"><span class="sp"></span><button id="ctCancel">取消</button><button id="ctSubmit" class="primary">创建圆桌</button></div>'
    +'</section></div>';
  app.innerHTML=h;
  var lastRole=null; /* 类型切换时尽量保留已选角色（不在新类型角色集时回落默认） */
  function ctType(){ var r=document.querySelector('input[name="ctType"]:checked'); return r?r.value:'review'; }
  function ctRole(){ var r=document.querySelector('input[name="ctRole"]:checked'); return r?r.value:''; }
  function ctHosted(){ return ctRole()==='host'; }
  function dfltRole(tt){ return tt.flow==='inquiry'?'asker':(tt.flow==='collab'?'collaborator':(tt.flow==='dispatch'?'director':(tt.flow==='relay'?'provider':'proposer'))); }
  function roleOptions(tt){
    if(tt.flow==='inquiry'){
      return [
        {v:'asker',t:'问询方',d:'我就是提问的人：不占席位，在本页开始问询、提问与结束'},
        {v:'host',t:'主持人',d:'主持人建桌：问询方凭「问询方」邀请码由人经网页就位'}
      ];
    }
    if(tt.flow==='dispatch'){
      return [
        {v:'director',t:'指挥方',d:'自建：我是指挥方（人类成员），在网页下达指令并跟踪执行（常用）'},
        {v:'worker',t:'执行方',d:'自建：我以执行方 agent 身份入席（自己的 agent 领单干活）'},
        {v:'observer',t:'观察方',d:'自建：只读旁听'},
        {v:'host',t:'主持人',d:'主持人建桌：我只管规则/资料/邀请，指挥方与执行方凭码入桌'}
      ];
    }
    var d=dfltRole(tt);
    var opts=tt.roles.map(function(r){ return {v:r,t:(ROLE_LABEL[r]||r),d:'自建：我以'+(ROLE_LABEL[r]||r)+'身份入席直接参会'+(r===d?'（常用）':'')}; });
    opts.push({v:'host',t:'主持人',d:'主持人建桌：我只管规则/资料/邀请与调度（可回合内并行调度），不参与评审协作'});
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
        :(tt.flow==='collab'&&!hosted?'协作类桌需至少 2 位协作者（含你），保留「协作者」勾选即可继续邀请；':'')
        +(tt.flow==='dispatch'&&!hosted?'指挥桌：把「执行方」邀请码发给各 agent（凭码入席后声明执行范围），「指挥方」码发给要在网页下指令的人；':''))
      +'每个勾选角色发 1 张邀请码（各 10 次 / 7 天），角色由码定死';
    document.getElementById('ctModeHint').textContent = inq&&!hosted
      ?'你将成为问询方（不占席位）：回答方就绪后你在本页开始问询、随时提问、结束时自动出问询纪要'
      :hosted
      ?(inq?'你将成为主持人（host）：只管规则/资料/邀请，问询方凭码就位后开始问询'
           :(tt.flow==='dispatch'?'你将成为主持人（host）：只管规则/资料/邀请，指挥方与执行方凭码入桌'
           :'你将成为主持人（host）：只管建桌/规则/资料/邀请与调度（会议中可把同身份席位并行派出），不参与评审协作'))
      :(tt.flow==='dispatch'&&role==='director'
        ?'你将成为指挥方（人类成员席位）：执行方就绪后开始工作，你在本页随时下达指令'
        :'你将以'+(ROLE_LABEL[role]||role)+'席位入席参会');
    document.getElementById('ctSeatTitle').textContent = inq&&!hosted
      ?'我的身份（问询方 · 不占席位，席位名仅作显示）'
      :hosted
      ?'我的角色（主持人建桌）'
      :'我的角色（入席为'+(ROLE_LABEL[role]||role)+'）';
    document.getElementById('ctPrecheckRow').style.display = (inq||tt.flow==='dispatch')?'none':'';
  }
  document.querySelectorAll('input[name="ctType"]').forEach(function(r){ r.onchange=syncType; });
  /* 模式帮助：点卡片「?」打开对应 modal（preventDefault 避免触发卡片选中） */
  document.querySelectorAll('#ctTypeRow button.mh-q').forEach(function(b){
    b.onclick=function(e){ e.preventDefault(); e.stopPropagation(); openModeHelp(b.getAttribute('data-tt')); };
  });
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
    if(tt.flow!=='inquiry'&&tt.flow!=='dispatch') body.precheckEnabled=document.getElementById('ctPrecheck').checked;
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
  }else if(d.tableType==='dispatch'&&d.mode==='self'&&!d.ownerSeatToken){
    h+='<h3 class="csec">你是指挥方（人类成员席位）</h3>'
      +'<div class="dim" style="margin-top:4px">无需席位凭证：直接在圆桌详情页操作（下达指令/答复澄清/开始与结束工作）。把下方「执行方」邀请码发给各 agent，其凭码入席并声明执行范围后就绪；「指挥方」码可发给其他要在网页下指令的人。</div>';
  }else{
    h+='<h3 class="csec">席位 token（只显示这一次，请立即复制）</h3>'
      +'<div class="row"><span class="invite big">'+esc(d.ownerSeatToken)+'</span><span class="sp"></span><button id="credTokCopy">复制凭证（含入桌信息）</button></div>'
      +'<div class="dim" style="margin-top:4px">点「复制凭证」带走完整入桌信息（服务器地址 / 圆桌 ID / token 与 .roundtable 配置写法）'+(hosted?'。主持人一般在网页端操作，无需把凭证交给 agent':'，整体发给你的 agent 即可参会')+'。关闭本页后无法再查看。</div>';
  }
  h+='<h3 class="csec">邀请码（发给各参与方，角色由码定死）</h3>';
  var RL={proposer:'提案方',reviewer:'评审方',observer:'观察方',collaborator:'协作者',answerer:'回答方',asker:'问询方',worker:'执行方',director:'指挥方'};
  d.inviteCodes.forEach(function(c){
    h+='<div class="row" style="margin:4px 0"><span class="rb '+esc(c.role)+'">'+esc(RL[c.role]||c.role)+'</span>'
    +'<span class="invite">'+esc(c.code)+'</span><button class="cpInv" data-code="'+esc(c.code)+'" data-role="'+esc(c.role)+'">复制完整邀请</button>'
    +(c.role==='asker'?'<span class="dim">问询方：发给要提问的人，其在本页凭码就位（不占席位）后开始问询</span>'
      :(c.role==='director'?'<span class="dim">指挥方：发给要在网页下指令的人，其在本页凭码入桌（人类席位，无需 agent）</span>'
      :(c.role==='worker'?'<span class="dim">执行方 agent：凭码入席，声明执行范围后领单干活</span>'
      :(c.role==='observer'?'<span class="dim">观察方：只读旁听无表决权</span>':(c.role==='answerer'?'<span class="dim">回答方 agent：凭码入席，声明回答范围后作答</span>':'<span class="dim">复制内容含服务器/圆桌ID/邀请码，整体转发即可参会</span>')))))+'</div>';
  });
  h+='<h3 class="csec">下一步</h3><div class="dim">'
    +(inq
      ?(hosted
        ?'主持人问询流程：定规则（详情页「桌设定」可随时改）→ 把「问询方」邀请码发给要提问的人（其凭码就位）、「回答方」码发给各 agent → 回答方入席设定并就绪 → 问询方在详情页点「开始问询」→ 提问 → 问完「结束问询」出问询纪要。'
        :'问询流程：把「回答方」完整邀请发给各 agent → 其入席并完成入桌设定（立场=回答范围、风格=回答倾向、数据范围，就绪）→ 你在详情页点「开始问询」→ 随时提问（可定向某回答席或广播全员作答）→ 问完点「结束问询」自动生成问询纪要（问答对汇总）。')
      :(d.tableType==='dispatch'
        ?(hosted
          ?'主持人指挥桌流程：定规则 → 把「指挥方」码发给要在网页下指令的人、「执行方」码发给各 agent → 执行方入席设定并就绪 → 建桌人或指挥方（建桌人）在详情页点「开始工作」→ 指挥方随时下达指令 → 执行方逐条回执 → 结束出工作纪要。'
          :'指挥桌流程：把「执行方」完整邀请发给各 agent → 其入席并完成入桌设定（立场=执行范围、数据范围，就绪）→ 你在详情页点「开始工作」→ 在会话区随时异步下达指令（多条自动排队）→ 执行方领单逐条回执（见「工作指令」卡）→ 外部成果链接附在回执里 → 结束出工作纪要（指令执行清单）。')
      :hosted
      ?'主持人流程：定规则（详情页「桌设定」可随时改）→ 传资料（详情页上传共享文档，全桌可见）→ 把邀请码发给各参与方（角色见上方码标签）→ 各方完成入桌设定 → 你在详情页点「开始会议」。开始后各方回合提交先经系统预审，需要补充时会被点名。'
      :'进入圆桌详情完成你的入桌设定（立场/风格/范围/数据范围/就绪），参与方凭完整邀请入席设定后，全员就绪即可在详情页一键开始会议。回合提交先经系统预审，需要补充时会被点名。'))
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
      copyText(inviteText(topic||'',d.tableId,b.getAttribute('data-code'),b.getAttribute('data-role'),null, d.tableType==='inquiry'&&d.mode==='self'));
      toast('完整邀请已复制（含服务器/圆桌ID/邀请码）');
    };
  });
  document.getElementById('ctBack').onclick=loadList;
  document.getElementById('ctEnter').onclick=function(){ openTable(d.tableId); };
}

/* ---------- 视图：凭邀请码入桌 ---------- */
function renderJoinForm(){
  var app=document.getElementById('app');
  var h='<div class="row" style="margin-bottom:12px"><button class="back" id="jbBackList" type="button">← 返回列表</button><span class="sp"></span><b>凭邀请码入桌</b><span class="dim">角色由邀请码定死（提案方/评审方/协作者/回答方/执行方/指挥方/观察方），席位不能自封</span></div>';
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
/* 查询结果分支：已持有席位/已是问询方 → 引导进桌；已结束 → 拒入提示；正常（含已开始未结束）→ 确认入席（asker=就位为问询方） */
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
  } else if(p.phase==='closed'){
    h+='<div class="hint" style="margin-top:8px">本桌已结束，不再接受凭码入席。</div>';
  } else if(p.role==='asker'){
    h+='<div class="hint" style="margin-top:8px">这是<b>问询方</b>邀请码：确认后就位为本桌问询方（不占席位、无席位凭证），回答方就绪后你在本页开始问询、随时提问与结束问询。</div>'
    +'<div class="row" style="margin-top:8px"><button id="jbJoin" class="primary">就位为问询方</button></div>';
  } else if(p.role==='director'){
    h+='<div class="hint" style="margin-top:8px">这是<b>指挥方</b>邀请码：确认后入桌为本桌指挥方（人类成员席位、无需 agent 凭证），'+(p.phase!=='open'?'工作已在进行中，入桌后即可随时下达工作指令并跟踪执行状态':'执行方就绪并开始工作后，你在本页随时下达工作指令并跟踪执行状态')+'。</div>'
    +'<div class="row" style="margin-top:8px"><button id="jbJoin" class="primary">入桌为指挥方</button></div>';
  } else {
    h+='<div class="hint" style="margin-top:8px">确认入席后，将以「上方席位名」加入本桌，角色为'+esc(ROLE_LABEL[p.role]||p.role)+'（由邀请码定死）。'+(p.phase!=='open'?'<br>本桌会议已开始（未结束仍可入席）：入席后请尽快完成入桌设定并就绪。':'')+'</div>'
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
  if(p.role==='director'&&!r.token){
    var dh='<div class="row" style="margin-bottom:12px"><b>已入桌</b><span class="rb director">指挥方</span><span class="badge phase">等待执行方就绪</span></div>';
    dh+='<div class="card"><b>'+esc(p.topic)+'</b>'
      +'<h3 class="csec">你已成为本桌指挥方（人类成员席位）</h3>'
      +'<div class="dim" style="margin-top:4px">无需席位凭证：等待执行方凭邀请码入席并声明执行范围，全部就绪并开始工作后，你在详情页会话输入框随时下达指令，执行状态见「工作指令」卡。</div>'
      +'<div class="row" style="margin-top:8px"><button id="jrBack">返回列表</button><span class="sp"></span><button id="jrEnter" class="primary">进入圆桌</button></div>'
      +'</div>';
    app.innerHTML=dh;
    document.getElementById('jrBack').onclick=loadList;
    document.getElementById('jrEnter').onclick=function(){ openTable(p.tableId); };
    return;
  }
  h+='<div class="card"><b>'+esc(p.topic)+'</b>'
    +'<h3 class="csec">席位 token（只显示这一次，请立即复制）</h3>'
    +'<div class="row"><span class="invite big">'+esc(r.token)+'</span><span class="sp"></span><button id="jrTokCopy">复制凭证（含入桌信息）</button></div>'
    +'<div class="dim" style="margin-top:4px">点「复制凭证」带走完整入桌信息（服务器地址 / 圆桌 ID / token 与 .roundtable 配置写法），交给你的 agent 即可代你参会。关闭本页后无法再查看；之后可在桌详情页随时「重签凭证」。</div>'
    +'<h3 class="csec">下一步</h3><div class="dim">进入圆桌详情完成入桌设定（立场/风格/范围/数据范围/就绪）；全员就绪后建桌人即可开始会议。回合提交先经系统预审，需要补充时会被点名。</div>'
    +'<div class="row" style="margin-top:8px"><button id="jrBack">返回列表</button><span class="sp"></span><button id="jrEnter" class="primary">进入圆桌</button></div>'
    +'</div>';
  app.innerHTML=h;
  document.getElementById('jrTokCopy').onclick=function(){
    copyText(seatTokenText(p.topic,p.tableId,r.token,r.seat.role)); toast('完整凭证已复制（含服务器/圆桌ID/token）');
  };
  document.getElementById('jrBack').onclick=loadList;
  document.getElementById('jrEnter').onclick=function(){ openTable(p.tableId); };
}
`;
