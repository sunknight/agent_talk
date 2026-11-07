/* 外壳段：顶栏渲染/身份与帐号菜单/登录注册 — <script> 第三段。 */
export const OBSERVER_JS_SHELL = String.raw`function refreshWho(){
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
  la.innerHTML=(admin?'<button id="adminBtn" class="hbtn">管理台</button>':'')
    +'<button id="acctBtn" class="hbtn" title="复制含用户 token 的账号凭证，交给自己的 agent 保持同一身份">复制账号凭证</button>'
    +'<button id="acctSwBtn" class="hbtn" title="本浏览器记录的帐号间切换；也可在这里登录其他帐号">帐号</button>'
    +'<button id="logoutBtn" class="hbtn">退出</button>';
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
`;
