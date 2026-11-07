/* 桌详情段（二）：阶段进度/席位表单/会话 chatbox/renderDetail 与全部绑定/路由与启动 — <script> 末段。 */
export const OBSERVER_JS_DETAIL = String.raw`
/* ---------- 视图：桌详情 ---------- */
function stepsHtml(phase, tt, pause){
  if(phase==='human_intervention'){
    return '<div class="banner err">人工介入模式：会议暂停，等待 HUMAN_INPUT / HUMAN_RULING 推进或裁决</div>';
  }
  var defs=(ttOf(tt).flow==='inquiry')?[['open','设定'],['qa','问答'],['closed','结束']]
    :(ttOf(tt).flow==='dispatch')?[['open','设定'],['working','工作中'],['closed','结束']]:STEP_DEFS;
  var idx=-1;
  for(var i=0;i<defs.length;i++){ if(defs[i][0]===phase) idx=i; }
  var h='';
  if(pause){
    var viaReq=(pause.via==='request'&&pause.requestedByName)?('（经 '+esc(pause.requestedByName)+' 申请）'):'';
    h+='<div class="banner warn" style="margin:10px 0 6px"><b>⏸ 会议已暂停</b> — 由 '+esc(pause.byName)+'（'+esc(ROLE_LABEL[pause.byRole]||pause.byRole)+'）于 '+fmtTs(pause.pausedAt)+' 暂停'+viaReq
      +(pause.reason?('：'+esc(pause.reason)):'')
      +'<div class="dim" style="margin-top:3px">各方持有人：在「管理」tab 的我的席位调整立场（保存时勾选「重新就绪」）、用底部输入条给本席 agent 发指令补充信息；无需补充的席位保持就绪即可。全员就绪后，由 主持人 / 建桌人 / 系统管理员 在底部继续会议。</div></div>';
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
function seatCfgFormHtml(cfg, pausedMode, midflow){
  cfg=cfg||{};
  var title=pausedMode?'暂停期调整（立场 / 风格 / 范围）':(midflow?'入桌设定（会议进行中入席）':(cfg.ready?'修改入桌设定':'入桌设定'));
  var readyLabel=pausedMode
    ?'重新就绪 — 补充/调整完成后声明本席可以继续（不动设定的席位无需任何操作，保持就绪）'
    :midflow
      ?'就绪 — 完成本席设定（会议进行中入席，首次就绪前可修改）'
      :'就绪 — 声明本席设定完成（全员就绪后建桌人可开始会议）';
  return '<div class="section"><h3>'+esc(title)+'</h3>'
    +'<div class="frow"><label class="t">立场</label>'
    +'<div class="row"><select id="cfgPreset"><option value="">（选择立场预设…）</option></select>'
    +'<input id="cfgSup" placeholder="立场补充说明（附加在预设文本后，可选）" style="flex:1"></div>'
    +'<textarea id="cfgStance" placeholder="立场声明全文（选预设自动填入可再改；保存必填）">'+esc(cfg.stance||'')+'</textarea></div>'
    +'<div class="frow"><label class="t">风格（可选）</label>'
    +'<div class="row"><select id="cfgStyle"><option value="">（不设风格 · 按默认）</option></select>'
    +'<input id="cfgStyleSup" placeholder="风格补充说明（附加在预设文本后，可选）" style="flex:1"></div>'
    +'<div class="hint" id="cfgStylePrev" style="margin-top:4px">风格预设决定本席 agent 思考与输出的倾向（苛刻/严谨/宽松、偏安全/偏业务/偏体验等），选择后此处展示该风格的完整说明。</div></div>'
    +'<div class="frow"><label class="t">讨论范围</label>'
    +'<input id="cfgScope" value="'+escAttr(cfg.scope||'')+'" placeholder="只讨论…／不讨论…（一句话）">'
    +'<div class="row" style="margin-top:4px">'+SCOPE_PRESETS.map(function(p){ return '<button class="preset" data-scope="'+escAttr(p)+'">'+esc(p)+'</button>'; }).join('')+'</div></div>'
    +'<div class="frow"><label class="t">数据范围（目录/文档/产物，逐条添加）</label>'
    +'<div class="chips" id="dsWrap"><span id="dsChips"></span><input id="dsIn" placeholder="输入路径后回车添加，如 docs/api/"></div>'
    +'<div class="row" style="margin-top:4px">'+DS_PRESETS.map(function(p){ return '<button class="preset" data-ds="'+escAttr(p)+'">'+esc(p)+'</button>'; }).join('')+'<span class="dim">这些路径以外的内容默认不在本次讨论的数据范围内</span></div>'
    +'<div class="dim" style="margin-top:4px">每条可设披露级别（条目内下拉）：仅概括=只可用其内容组织回答、不向外提供原文；可摘引=可摘录片段与文件定位；可原文=可提供全文。账号不同的各方即不同参与方，向他方输出按此级别约束。</div></div>'
    +'<div class="frow"><label class="chk"><input type="checkbox" id="cfgReady"'+(cfg.ready?' checked':'')+'> '+esc(readyLabel)+'</label></div>'
    +'<div class="ferr" id="cfgErr"></div>'
    +'<div class="row"><button id="cfgSave" class="primary">保存设定</button>'
    +((!pausedMode&&cfg.ready)?'<button id="cfgCollapse">收起（保留现设定）</button>':'')
    +(pausedMode?'<span class="dim">暂停期保存：未勾选「重新就绪」将被视为补充中（未就绪）</span>':(midflow?'<span class="dim">中途入席：首次就绪前可修改；就绪后与各方一致（会议中锁定、暂停期可调）</span>':'<span class="dim">保存后可再修改，开始会议后设定锁定</span>'))
    +'</div></div>';
}

/* ---------- 我的席位折叠子区块（会议控制 / 申请暂停 / 凭证恢复）----------
   内容与元素 id 和旧版长面板一致（绑定不动），仅收纳为可折叠子区块；开合状态存 view.seatOpen 抗轮询重渲染 */
function ctlBodyHtml(t,seats,turn){
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
  var skippable=(t.precheck&&t.precheck.state==='directive')||!!turn||t.phase==='execution';
  var inq=ttOf(t.tableType).flow==='inquiry';
  return '<div class="row"><input id="ctlPauseReason" placeholder="暂停原因（进入会议记录，可空）" style="flex:1;min-width:180px">'
    +'<button id="ctlPause">⏸ 暂停会议</button></div>'
    +(skippable
      ?'<div class="row" style="margin-top:6px"><button id="ctlSkip" class="danger">⏭ 跳过当前发言人</button>'
       +'<span class="dim">'+(t.precheck&&t.precheck.state==='directive'
          ?'解除当前预审点名，按原提交放行'
          :turn?('跳过 '+esc(seatName(seats,turn.seatId))+' 的本轮发言，流程继续（该席本轮视为已处理）')
          :'跳过当前待处理执行请求（按拒绝收口）')+'</span></div>'
      :'')
    +(t.precheckEnabled===false
      ?'<div class="row" style="margin-top:6px"><button id="ctlPre">☑ 开启系统预审</button><span class="dim">本桌预审已关闭：agent 回合提交不经预审直接生效</span></div>'
      :(inq?'':'<div class="row" style="margin-top:6px"><button id="ctlPre">☐ 关闭系统预审</button><span class="dim">关闭后 agent 回合提交不再经系统预审（人代答本就不经预审）</span></div>'))
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
/* 退席子区块：拿错角色码入桌后换角色等场景；建桌人席位与已结束桌不渲染（服务端同规则拒退） */
function leaveBodyHtml(role){
  var hasAgent=role!=='director'; /* director 为人类席位无 token；其余席位退席即吊销 agent 凭证 */
  return '<div class="hint" style="margin-bottom:6px">退席后本席在本桌标记为已退席并留会议记录'+(hasAgent?'，席位凭证立即失效、你的 agent 将无法继续参会':'')+'；如需再次入桌须凭邀请码重新入席（角色由新邀请码决定，适合拿错码换角色的场景）。建桌人席位不可退席。</div>'
    +'<div class="row"><button id="stLeave" class="danger" data-agent="'+(hasAgent?'1':'0')+'">退席本席（不可撤销）</button></div>'
    +'<div class="ferr" id="leaveErr"></div>';
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
   气泡侧别：个人偏好 view.chatSides[fromSeat] 显式覆盖优先；默认 fromSeat=本席（或 isAsker 的 asker）→ 右侧，
   server → 居中系统，其余 → 左侧带席位名/角色色。偏好入口在「席位与立场」「圆桌示意图」的 左/右 切换按钮。
   composer：按身份与阶段提供 代答/提问/公开补充/私有指令/人工指令 类型组，芯片切换只改 display（不重渲染，草稿保留）。 */
function chatSideOf(fromSeat,d,isAsker){
  var s=view.chatSides[fromSeat];
  if(s==='L'||s==='R') return s;
  return (fromSeat===d.mySeatId||(isAsker&&fromSeat==='asker'))?'R':'L';
}
/** 左右侧切换按钮（席位与立场 / 圆桌示意图共用）：显示当前侧，点击切换并保存（个人偏好，服务端持久化） */
function sideToggleHtml(sid,d,isAsker){
  var cur=chatSideOf(sid,d,isAsker);
  return '<button class="sideT sm'+(cur==='R'?' on':'')+'" data-sid="'+escAttr(sid)+'" data-cur="'+cur
    +'" title="该方在会话区的左右侧（个人设置，仅自己可见）：点击切换">'+(cur==='R'?'右侧':'左侧')+'⇄</button>';
}
function chatboxCardHtml(d,seats,mySeat,isAsker){
  var t=d.table, stage=stageOf(t,seats), turn=t.activeTurn;
  var chips='';
  CHAT_VIEWS.forEach(function(v){
    chips+='<button class="fbtn'+(((view.chatFilter||'all')===v[0])?' on':'')+'" data-cf="'+v[0]+'">'+v[1]+'</button>';
  });
  var h='<div class="card" id="chatCard"><div class="shead"><b>会话</b><span class="dim">各方发言与系统提示 · 左右侧可在席位与立场 / 圆桌示意图中调整</span><span class="sp"></span>'
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
    var side=chatSideOf(m.fromSeat,d,isAsker);
    var role=mine?(mySeat?mySeat.role:'asker'):seatRoleOf(seats,m.fromSeat);
    var toMe=(m.type==='HUMAN_INPUT'&&p.toSeat===d.mySeatId&&!mine);
    var proxied=(m.flags&&m.flags.indexOf&&m.flags.indexOf('human_proxied')>=0);
    var inject=(m.flags&&m.flags.indexOf&&m.flags.indexOf('injection_suspect')>=0);
    h+='<div class="cb-row '+(side==='R'?'mine':'other')+'">'
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
  return h;
}

/* 底部常驻操作条 · 输入聚合（自会话卡迁移至全局，任何 tab 可用）：类型出现条件与旧版一致
   （代答仅轮到本席、提问仅问询方问答期、下指令仅指挥方工作期、索要仅接收方对接期）。
   返回 [类型chips, 输入组] 两段 HTML；无可用类型返回 ''。元素 id 与绑定和旧版完全一致。 */
function barComposerHtml(d,seats,mySeat,isAsker,stage,ctl){
  var t=d.table, turn=t.activeTurn;
  var types=[];
  if(mySeat&&t.phase!=='closed'&&mySeat.role!=='director') types.push(['supp','公开补充'],['priv','私有指令'],['hi','人工指令']);
  if(isAsker&&t.phase==='qa'&&!t.pause) types.unshift(['ask','提问']);
  if(d.isDirector&&t.phase==='working'&&!t.pause) types.unshift(['dir','下指令']);
  if(d.isReceiver&&t.phase==='transfer'&&!t.pause) types.unshift(['dr','索要数据']);
  /* 代答：单席位发言权轮到本席，或活跃并行批次含本席（网页直接交付本阶段回合） */
  var parMine=!!(t.parallelDispatch&&t.parallelDispatch.workers.indexOf(d.mySeatId)>=0&&(t.activeTurns||[]).some(function(x){ return x.seatId===d.mySeatId; }));
  if(mySeat&&stage==='running'&&!t.pause&&((turn&&turn.seatId===d.mySeatId)||parMine)) types.unshift(['proxy',parMine?'交付本轮（并行批次）':'代答']);
  if(!types.length) return '';
  var single=types.length===1; /* 单类型（指挥方=下指令、纯问询方=提问）：省略类型 chips 行，快捷控制并入组头行 */
  var cur=view.cmpType, hit=false, ti;
  for(ti=0;ti<types.length;ti++){ if(types[ti][0]===cur) hit=true; }
  if(!hit) cur=types[0][0];
  view.cmpType=cur;
  var tchips='';
  if(!single) types.forEach(function(x){ tchips+='<button class="fbtn'+(x[0]===cur?' on':'')+'" data-ct="'+x[0]+'">'+x[1]+'</button>'; });
  var h='';
  types.forEach(function(x){
    var g=x[0];
    h+='<div class="cmp-grp" data-grp="'+g+'"'+(g===cur?'':' style="display:none"')+'>';
    if(g==='proxy'){
      var pxTurn=turn||((t.activeTurns||[]).filter(function(x){ return x.seatId===d.mySeatId; })[0]||null);
      h+='<h3>'+(parMine?'交付本轮（并行任务）':'替我回答本轮（人工代答）')+'</h3><div class="dim">'+esc((pxTurn&&pxTurn.taskHint)||'')+'</div>'
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
      h+='<div class="bb-head"><h3>提问</h3><span class="dim">广播或定向 · 回答方只在各自声明的范围内作答，超范围会说明并拒答</span>'
        +((single&&ctl)?('<span class="sp"></span><span class="bb-ctl">'+ctl+'</span>'):'')+'</div>'
        +'<div class="bb-mid"><textarea id="askText" rows="2" placeholder="向回答方提问…"></textarea>'
        +'<div class="bb-side"><select id="askTo">'+aopts+'</select><button id="askSend" class="primary bb-send2">提问</button></div></div>'
        +'<div class="ferr" id="askErr"></div>';
    }else if(g==='dir'){
      /* 紧凑三行：标题+帮助+快捷控制（右） / 指令输入（~80%）+发送（右） / 展开更多（标题等可选项） */
      h+='<div class="bb-head"><h3>下达工作指令</h3>'
        +'<span class="dim" title="可随时异步发送，多条指令自动排队；执行方按需攒批（如同类改动合并）后逐单回执">可随时异步发送，多条自动排队 · 执行方可攒批回执</span>'
        +((single&&ctl)?('<span class="sp"></span><span class="bb-ctl">'+ctl+'</span>'):'')+'</div>'
        +'<div class="bb-mid"><textarea id="dirText" rows="2" placeholder="指令内容（相对明确的工作要求，如：修改 bd10 页面的搜索框背景颜色为白色；多个改动点可分多条）。执行方领单执行并逐条回执；外部成果（如设计稿）可在回执给出链接。"></textarea>'
        +'<button id="dirSend" class="primary bb-send2">下达指令</button></div>'
        +'<details class="bb-more"><summary>展开更多（标题等可选项）</summary>'
        +'<div class="row" style="margin-top:6px"><input id="dirTitle" placeholder="标题（可选，一句话概要，如：调整 bd10 搜索框配色）" style="flex:1"></div></details>'
        +'<div class="ferr" id="dirErr"></div>';
    }else if(g==='dr'){
      var drOpts='';
      seats.forEach(function(s){ if(s.role==='provider') drOpts+='<option value="'+esc(s.seatId)+'">定向 · '+esc(s.name)+'</option>'; });
      h+='<h3>索要数据（接收方）</h3>'
        +'<input id="drTitle" placeholder="标题（可选，如：上线前的灰度指标口径）" style="width:100%">'
        +'<textarea id="drText" placeholder="索要内容：要什么数据 / 用途 / 为什么缺（对照核验 checklist 的缺失项，如：对接单缺「被否方案及原因」，需要过程层数据）"></textarea>'
        +'<div class="row" style="margin-top:6px"><select id="drTo">'+drOpts+'</select>'
        +'<span class="dim">定向提供方；规则内的会被其 agent 自动放行，超出规则的转其持有人审批</span>'
        +'<span class="sp"></span><button id="drSend" class="primary">发起索要</button></div>'
        +'<div class="ferr" id="drErr"></div>';
    }
    h+='</div>';
  });
  return [tchips,h,single];
}

/* 左栏 tab 切换：记忆手选（sessionStorage 按桌存），重渲染保持当前 tab；切 tab 走 rerenderDetail 保住底部条草稿 */
function switchDtTab(id){
  view.uiTab=id;
  try{ sessionStorage.setItem('rt_dtab_'+view.tableId,id); }catch(e){}
  rerenderDetail();
}
/* 底部输入区（position:fixed 钉在窗口底）：左缘/宽度对齐中列，并给中列末尾占位防内容被盖；
   每次 renderDetail 重建后调用；resize 时也重算（boot 注册一次） */
function placeDtBar(){
  var bar=document.querySelector('.dtbar');
  var col=document.querySelector('.dt-main');
  if(!bar||!col) return;
  var r=col.getBoundingClientRect();
  bar.style.left=Math.round(r.left)+'px';
  bar.style.width=Math.round(r.width)+'px';
  var ph=document.getElementById('dtBarPh');
  if(ph){ ph.style.height=(bar.offsetHeight+20)+'px'; ph.style.flex='none'; }
}

function renderDetail(d){
  var t=d.table, seats=(t.seats||[]).filter(function(s){ return s.status!=='left'; });
  var mySeat=null, i;
  if(d.mySeatId){ for(i=0;i<seats.length;i++){ if(seats[i].seatId===d.mySeatId) mySeat=seats[i]; } }
  var admin=view.role==='systemadmin';
  var isAsker=!!d.isAsker; /* 问询方（建桌人/凭码就位者；可与席位并存——同号用户 web 提问 + 自己的 agent 作答 */
  var turn=t.activeTurn;
  var flow=ttOf(t.tableType).flow;
  var inqFlow=flow==='inquiry';
  var stage=stageOf(t,seats); /* prep/ready/running/paused/ended：驱动模块显隐 */
  /* 就绪度（open 期面板与就绪进度共用）：问询桌看回答方，指挥桌看执行方（指挥方为人类席位不参与就绪），其余看非主持人席 + 角色齐备（按流程，对齐服务端 startTable） */
  var dspFlow=flow==='dispatch';
  var hoFlow=flow==='relay';
  var needSeats=inqFlow?seats.filter(function(s){ return s.role==='answerer'; })
    :dspFlow?seats.filter(function(s){ return s.role==='worker'; })
    :hoFlow?seats.filter(function(s){ return s.role==='provider'||s.role==='receiver'; })
    :seats.filter(function(s){ return s.role!=='host'; });
  var rolesOk=inqFlow?needSeats.length>0:(flow==='collab'
    ?seats.filter(function(s){ return s.role==='collaborator'; }).length>=2
    :dspFlow?needSeats.length>0
    :hoFlow?(seats.some(function(s){ return s.role==='provider'; })&&seats.some(function(s){ return s.role==='receiver'; }))
    :seats.some(function(s){ return s.role==='proposer'; })&&seats.some(function(s){ return s.role==='reviewer'; }));
  var rolesGap=flow==='inquiry'
    ?'角色不齐备：还需回答方席位凭邀请码入席'
    :flow==='collab'
      ?'角色不齐备：还需协作者席位凭邀请码入席（至少 2 位协作者）'
      :dspFlow
        ?'角色不齐备：还需执行方（agent）席位凭邀请码入席并设定执行范围'
        :hoFlow
          ?'角色不齐备：还需提供方/接收方席位凭邀请码入席（提供方声明数据规则，接收方声明接收目标）'
          :'角色不齐备：还需提案方/评审方席位凭邀请码入席';
  var allReady=rolesOk&&needSeats.length>0&&needSeats.every(function(s){ return s.config&&s.config.ready; });
  /* 会话滚动状态采集（重渲染前拿旧容器位置，渲染后回位/贴底）+ composer 草稿采集（重渲染后回填，防发送/轮询丢未发送内容） */
  var prevCb=document.getElementById('cbList');
  if(prevCb){ view.cbPrevTop=prevCb.scrollTop; view.chatAtBottom=(prevCb.scrollTop+prevCb.clientHeight>=prevCb.scrollHeight-24); }
  view.cmpKeep=harvestInputs('#dtBar');

  /* 详情头（常驻）：返回 | 主题与徽章 | 复制链接 + 目标/交付物/规则 + 阶段进度条 */
  var h='';
  /* 身份视角条：systemadmin 无席位只读观察（普通用户无席位已被服务端 403 拦在列表外） */
  if(!mySeat && admin){
    h+='<div class="banner admin">系统观察员 · 只读观察 — 你在本桌没有席位，仅查看（详情/历史/纪要），不能发指令或代答。</div>';
  }
  if(isAsker){
    h+='<div class="banner">问询方视角 — '+(mySeat?'你在本桌同时持有席位「'+esc(mySeat.name)+'」（管理 tab 有席位面板）':'你不占席位')
      +'：回答方就绪后开始问询，在本页提问（可定向/广播）与结束问询。</div>';
  }
  h+='<div class="dt-head tt-'+esc(t.tableType)+'"><div class="toprow">'
    +'<button class="back" id="back" type="button">← 返回</button>'
    +'<b style="font-size:17px">'+esc(t.topic)+'</b>'
    +typeBadge(t.tableType)
    +phaseBadge(t.phase,t.roundNo,t.tableType)
    +(t.phase==='open'?'<span class="badge '+(stage==='ready'?'ok':'warn')+'">'+STAGE_LABEL[stage]+'</span>':'')
    +(t.pause?'<span class="badge warn">⏸ 已暂停</span>':'')
    +(t.mode==='hosted'?'<span class="rb host">主持人模式</span>':'')
    +(t.deadlockCount>0?'<span class="badge err">僵局 '+t.deadlockCount+'</span>':'')
    +'<span class="sp"></span><span class="dim xs">自动刷新中</span>'
    +'<button id="dCopyLink" class="sm" title="复制可分享的详情页链接">复制本页链接</button>'
    +'</div>';
  if(d.meta.goals) h+='<div class="kv"><span class="k">目标</span>'+esc(d.meta.goals)+'</div>';
  if(d.meta.deliverables) h+='<div class="kv"><span class="k">交付物</span>'+esc(d.meta.deliverables)+'</div>';
  if(d.meta.rules) h+='<div class="kv"><span class="k">规则</span>'+esc(d.meta.rules)+'</div>';
  h+=stepsHtml(t.phase,t.tableType,t.pause);
  h+='</div>';

  /* 下一步动作条（常驻高亮）：内容见各阶段分支；结尾的 @@T:@@ 标记用于把后续模块切分进对应 tab */
  h+='\n@@T:act@@\n';
  if(t.precheck){
    if(t.precheck.state==='reviewing') h+='<div class="badge warn">预审中</div> <span class="dim">系统正在预审刚提交的回合结果，预审完成前暂不轮转发言权</span>';
    else if(t.precheck.state==='directive') h+='<div class="badge warn">预审点名</div> <span class="dim">等待 <b>'+esc(seatName(seats,t.precheck.toSeat))+'</b> 按预审意见补充并以 SUPPLEMENT 提交'
      +((admin||(mySeat&&(mySeat.seatId===t.ownerSeat||mySeat.role==='host')))?'；长期无响应可在「管理」tab 会议控制跳过本次点名':'')+'</span><br>';
  }
  if(t.pause){
    /* 暂停叠加态：阶段保留、无发言权；展示就绪进度与继续条件（指挥桌只看执行方——指挥方人类席位不参与就绪） */
    var pseats=inqFlow?seats.filter(function(s){ return s.role==='answerer'; })
      :dspFlow?seats.filter(function(s){ return s.role==='worker'; })
      :seats.filter(function(s){ return s.role!=='host'; });
    var pReady=pseats.filter(function(s){ return s.config&&s.config.ready; }).length;
    h+='<span class="badge warn">⏸ 会议已暂停</span> <span class="dim">阶段保留在「'+esc(phaseLabel(t.tableType,t.phase))+'」，继续后从原处推进</span>';
    h+='<div class="dim" style="margin-top:4px">就绪进度：'+pReady+' / '+pseats.length
      +(pseats.length&&pReady===pseats.length
        ?' — 全员已就绪，可继续会议'
        :' — 未就绪：'+pseats.filter(function(s){ return !(s.config&&s.config.ready); }).map(function(s){ return esc(s.name); }).join('、'));
  } else if(turn){
    h+='发言权：<b>'+esc(seatName(seats,turn.seatId))+'</b> —— '+esc(turn.taskHint||'');
    if(turn.pendingRequest) h+='<div class="dim">待处理请求：'+esc(turn.pendingRequest.title)+'</div>';
  } else if(t.parallelDispatch&&(t.activeTurns||[]).length){
    h+='并行批次（'+esc(phaseLabel(t.tableType,t.parallelDispatch.phase))+'）：<b>'+esc((t.activeTurns||[]).map(function(x){ return seatName(seats,x.seatId); }).join('、'))+'</b> 同时工作中 —— 各自交付本阶段回合消息，全员交付（或跳过）后汇聚回顺序轮转。';
  } else if(t.phase==='closed'){ h+='<span class="badge ok">会议已结束</span>'+(d.minutes?' <span class="dim">纪要已生成（见「资料·纪要」）</span>':''); }
  else if(t.phase==='human_intervention'){ h+='<span class="dim">等待人工介入（可用底部输入条以席位身份发送人工指令）</span>'; }
  else if(t.phase==='working'){
    var wdAll=(d.directives||[]), wdOpen=wdAll.filter(function(w){ return w.status==='pending'||w.status==='executing'; }).length;
    var wdClar=wdAll.filter(function(w){ return w.status==='need_clarify'; }).length;
    h+='<span class="badge phase">工作中</span> <span class="dim">指令队列驱动 · 无发言权轮转 —— 指挥方随时下达，执行方领单后逐条回执</span>';
    h+='<div class="dim" style="margin-top:4px">指令：共 '+wdAll.length+' 条，未结 '+wdOpen+' 条'+(wdClar?(' · 待澄清 '+wdClar+' 条（需指挥方答复）'):'')+'；明细见「工作指令」tab。</div>';
  }
  else if(t.phase==='transfer'){
    var drAll=(d.dataRequests||[]), drOpen=drAll.filter(function(r){ return r.status==='pending'||r.status==='human_pending'; }).length;
    var drHum=drAll.filter(function(r){ return r.status==='human_pending'; }).length;
    h+='<span class="badge phase">对接中</span> <span class="dim">索要队列驱动 · 无发言权轮转 —— 提供方发对接单并处置索要，接收方核验后定向索要</span>';
    h+='<div class="dim" style="margin-top:4px">数据索要：共 '+drAll.length+' 条，未结 '+drOpen+' 条'+(drHum?(' · 待提供方持有人审批 '+drHum+' 条'):'')+'；明细见「数据对接」tab。</div>';
    if(d.isReceiver&&!t.pause){
      h+='<div class="row" style="margin-top:6px"><span class="dim">对接单读齐且索要全部处置后，确认接收结束对接（可附带缺接收说明）</span>'
        +'<span class="sp"></span><input id="finWaived" placeholder="带缺接收说明（可选，如：灰度口径缺口由我自行补齐）" style="width:280px">'
        +'<button id="finGo" class="sm">✓ 确认接收</button></div><div class="ferr" id="finErr"></div>';
    }
  }
  else if(t.phase==='open'){
    if(stage==='ready') h+='<span class="badge ok">全员就绪</span> <span class="dim">等待'+(inqFlow?'问询方':'建桌人')+'在底部点「▶ '+(inqFlow?'开始问询':(dspFlow?'开始工作':'开始会议'))+'」</span>';
    else{
      h+='<span class="badge warn">准备中</span> <span class="dim">设定阶段：各席完成入桌设定并就绪'+(rolesOk?'':'（'+rolesGap+'）')+'</span>';
      h+='<div class="dim" style="margin-top:4px">就绪进度：'+needSeats.filter(function(s){ return s.config&&s.config.ready; }).length+' / '+needSeats.length
        +(needSeats.length?(' — 未就绪：'+needSeats.filter(function(s){ return !(s.config&&s.config.ready); }).map(function(s){ return esc(s.name); }).join('、')):'')+'</div>';
    }
  }
  else { h+='<span class="dim">当前无发言权持有者（等待事件推进或人工介入）</span>'; }

  /* 执行时序图 → 过程 tab：会议开始后按时间展示各方执行节点（并行并列+收口里程碑+进行中跳动） */
  h+='\n@@T:proc@@\n';
  h+=timelineCardHtml(d,seats,t);

  /* 会话视图 chatbox（气泡流；输入聚合已迁至底部常驻操作条）→ 会话 tab */
  h+='\n@@T:chat@@\n';
  h+=chatboxCardHtml(d,seats,mySeat,isAsker);

  h+='\n@@T:ov@@\n';
  /* 席位与立场（原「各方观点」精简：最后交付交给会话视图与圆桌示意图，保留立场/就绪/管理员席位操作；
     问询桌补问询方卡片（真实姓名，来自服务端），各卡带 左/右 切换 = chatbox 个人左右侧偏好入口） */
  h+='<div class="card"><div class="shead"><b>席位与立场</b><span class="dim">每席立场声明与就绪状态 · 「左/右」切换会话区气泡归属</span><span class="sp"></span>'
    +'<span class="dim">'+seats.length+' 席就座'+(d.asker?'+ 问询方':'')+'</span></div><div class="vcards">';
  if(d.asker){
    h+='<div class="vcard asker">'
      +'<div class="row">'+roleBadge('asker')+'<b>'+esc(d.asker.name)+'</b>'
      +(isAsker?'<span class="badge">我</span>':'')
      +(t.ownerSeat==='asker'?'<span class="badge">建桌人</span>':'')
      +'<span class="sp"></span>'
      +'<span class="badge ok">已就位</span>'
      +sideToggleHtml('asker',d,isAsker)
      +'</div>'
      +'<div class="dim">不占席位 · 在会话区提问（可定向/广播），回答方在各自声明范围内作答</div>'
      +'</div>';
  }
  seats.forEach(function(s){
    var cfg=s.config||{};
    /* 席位控制操作行：systemadmin（复制配置/替代 agent/移出）与建桌人（移出）；建桌人席位自身不可被移出 */
    var canCtl=admin||(mySeat&&mySeat.seatId===t.ownerSeat);
    h+='<div class="vcard '+esc(s.role)+'">'
      +'<div class="row">'+roleBadge(s.role)+'<b>'+esc(s.name)+'</b>'
      +(s.seatId===t.ownerSeat?'<span class="badge">建桌人</span>':'')
      +'<span class="sp"></span>'
      +'<span class="badge '+(s.status==='active'?'ok':'warn')+'">'+esc(s.status)+'</span>'
      +(seatOff(s,t)?'<span class="badge err">已断开</span>':'')
      +(s.role==='host'?'<span class="badge">豁免就绪</span>':(s.role==='director'?'<span class="badge">人类成员</span>':'<span class="badge '+(cfg.ready?'ok':'warn')+'">'+(cfg.ready?'已就绪':'未就绪')+'</span>'))
      +sideToggleHtml(s.seatId,d,isAsker)
      +'</div>'
      +(s.role==='director'
        ?'<div class="dim">人类成员 · 网页下达指令与答复澄清（无 agent 席位凭证）</div>'
        :'<div class="dim">agent: '+esc(s.agentLabel)+'</div>')
      /* 立场/风格仅本席（与系统观察员）可见：服务端已剥字段（cfg.stance===undefined）时显示占位 */
      +(typeof cfg.stance==='undefined'
        ?'<div class="kv"><span class="k">立场</span><span class="dim">仅本席可见</span></div><div class="kv"><span class="k">风格</span><span class="dim">仅本席可见</span></div>'
        :'<div class="kv"><span class="k">立场</span><span title="'+escAttr(cfg.stance||'')+'">'+esc((cfg.stance||'').slice(0,60)||'（未填写）')+'</span></div>'
          +(cfg.style?'<div class="kv"><span class="k">风格</span><span title="'+escAttr(cfg.style)+'">'+esc(cfg.style.slice(0,60))+'</span></div>':''))
      +(canCtl?'<div class="row" style="margin-top:8px">'+(admin?'<button class="admCred sm" data-sid="'+escAttr(s.seatId)+'" data-name="'+escAttr(s.name)+'" data-role="'+escAttr(s.role)+'">复制配置</button> '
        +'<button class="admRepl sm danger" data-sid="'+escAttr(s.seatId)+'" data-name="'+escAttr(s.name)+'" data-role="'+escAttr(s.role)+'">替代 agent</button> ':'')
        +(s.seatId!==t.ownerSeat?'<button class="seatKick sm danger" data-sid="'+escAttr(s.seatId)+'" data-name="'+escAttr(s.name)+'" data-role="'+escAttr(s.role)+'">移出</button>':'')+'</div>':'')
      +'</div>';
  });
  h+='</div></div>';

  /* 邀请码（建桌人 or 系统观察员；结束后不再展示——闭桌无法再入席）→ 已移至右侧动态栏（设定期拉人是核心动作，常驻可见） */

  /* 圆桌示意图（总览 tab）：席位环绕（问询桌含问询方节点）+ 最后交付摘要 + 发言权思考中标记（>8 方折叠） */
  h+=roundDiagramHtml(d,seats,turn,isAsker);

  /* 回合内并行调度面板（主持人 host 专属）→ 过程 tab：轮换阶段发起批次（或点名单个）；活跃批次看板+逐席跳过 */
  if(mySeat&&mySeat.role==='host'&&stage!=='ended'&&PD_PHASES[t.phase]){
    h+='\n@@T:proc@@\n';
    h+=parallelCtlHtml(d,seats,t);
  }

  /* ---- 我的席位面板 → 管理 tab：按阶段/状态条件渲染 ---- */
  h+='\n@@T:mng@@\n';
  if(mySeat){
    var cfg=mySeat.config||{};
    var isOwner=t.ownerSeat===mySeat.seatId;
    var isHost=mySeat.role==='host';
    h+='<div class="card mine"><div class="row"><b>我的席位</b><b>'+esc(mySeat.name)+'</b>'
      +roleBadge(mySeat.role)
      +(isOwner?'<span class="badge">建桌人</span>':'')
      +(isHost?'':(mySeat.role==='director'?'<span class="badge">人类成员</span>':'<span class="badge '+(cfg.ready?'ok':'warn')+'">'+(cfg.ready?'已就绪':'未就绪')+'</span>'))
      +'<span class="dim">'+(mySeat.role==='director'?'人类成员 · 网页下达指令':('agent: '+esc(mySeat.agentLabel)))+'</span></div>';

    if(stage==='ended'){
      h+='<div class="section dim" style="margin-top:10px">会议已结束：纪要在「资料·纪要」tab，会话全文见「会话」tab（只读）。</div>';
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
          +'<div class="row"><button id="tcSave" class="primary">保存桌设定</button><span class="dim">仅设定阶段可改；资料文档在「资料·纪要」tab 上传（选共享，全桌可见）</span></div></div>';
      } else if(mySeat.role==='director'){
        /* 指挥方：人类席位无入桌设定，给出角色说明 */
        h+='<div class="section dim" style="margin-top:10px">你是指挥方（人类成员）：无需入桌设定；工作开始后用底部输入条选「下指令」安排工作，执行方领单后逐条回执（见「工作指令」tab）。</div>';
      } else if(!cfg.ready||view.cfgEditing){
        h+=seatCfgFormHtml(cfg,false);
      } else {
        h+='<div class="section"><h3>当前设定 <span class="dim">（已就绪，开始会议前可修改）</span></h3><div class="sumcard">'
          +'<div class="kv"><span class="k">立场</span>'+esc(cfg.stance||'')+'</div>'
          +(cfg.style?'<div class="kv"><span class="k">风格</span><span style="white-space:pre-line">'+esc(cfg.style)+'</span></div>':'')
          +'<div class="kv"><span class="k">讨论范围</span>'+esc(cfg.scope||'（未填写）')+'</div>'
          +'<div class="kv"><span class="k">数据范围</span>'+((cfg.dataScope||[]).length?cfg.dataScope.map(function(x){ var it=dsItem(x); return '<span class="chip">'+esc(it.text)+'<i class="dgl">'+esc(DS_GRANT_LABEL[it.grant])+'</i></span>'; }).join(' '):'<span class="dim">（未填写）</span>')+'</div>'
          +'</div><button id="cfgEdit">修改设定</button></div>';
      }

      /* 建桌人：就绪名单 + 开始会议 */
      if(isOwner){
        h+='<div class="section sumcard"><h3 style="margin-top:0">开局状态（建桌人）</h3>';
        seats.forEach(function(s){
          if(s.role==='host'){ h+='<div class="kv">'+esc(s.name)+' '+roleBadge(s.role)+' <span class="badge">主持人 · 豁免就绪</span></div>'; }
          else if(s.role==='director'){ h+='<div class="kv">'+esc(s.name)+' '+roleBadge(s.role)+' <span class="badge">人类成员 · 无需就绪</span></div>'; }
          else h+='<div class="kv">'+esc(s.name)+' '+roleBadge(s.role)+' <span class="badge '+((s.config&&s.config.ready)?'ok':'warn')+'">'+((s.config&&s.config.ready)?'已就绪':'未就绪')+'</span></div>';
        });
        if(!rolesOk) h+='<div class="ferr">'+rolesGap+'。</div>';
        else if(!allReady) h+='<div class="ferr">尚有席位未就绪，各方就绪后才能开始。</div>';
        if(flow!=='inquiry'&&flow!=='dispatch'){
          h+='<div class="row" style="margin-top:6px"><button id="stPre">'+(t.precheckEnabled===false?'☑ 开启系统预审':'☐ 关闭系统预审')+'</button>'
            +'<span class="dim">'+(t.precheckEnabled===false?'本桌预审已关闭：agent 回合提交不经预审直接生效':'各方 agent 的回合提交先经系统预审（人代答不受影响；会议中可随时开关）')+'</span></div>';
        }
        h+='<div class="row" style="margin-top:8px"><button id="stStart" class="primary"'+((allReady&&rolesOk)?'':' disabled')+'>'+(dspFlow?'▶ 开始工作':'▶ 开始会议')+'</button>'
          +'<span class="dim">'+(dspFlow?'开始后进入工作中阶段，随时在会话区下达指令':'开始后进入'+esc(phaseLabel(t.tableType,'statements'))+'阶段，席位设定锁定')+'；未结束前仍可凭码入席</span></div><div class="ferr" id="stErr"></div></div>';
      } else if(cfg.ready){
        h+='<div class="section dim">已就绪，等待建桌人开始会议。</div>';
      }
      if(mySeat.role!=='director'){
        h+=secDetailsHtml('seatDetPod','私有指令记录','我发出的 · 仅自己可见（发送在底部输入条）','<div id="podList" style="margin-top:2px"></div>',false);
        h+=secDetailsHtml('seatDetCred','凭证恢复 · 更换 agent','复制配置给新 agent / 替代换新',credBodyHtml(),false);
      }
    } else {
      /* 会议进行中 / 暂停 / 人工介入：状态行 + 折叠子区块（代答与指令输入在左侧「会话」输入框） */
      /* 中途入席者（未完成首次设定：未就绪且立场为空）：会议中仍可完成入桌设定（服务端首次设定窗口放行；暂停期由下方暂停表单覆盖） */
      if(!cfg.ready&&!cfg.stance&&mySeat.role!=='host'&&mySeat.role!=='director'&&!t.pause){
        h+=seatCfgFormHtml(cfg,false,true);
      }
      if(t.pause){
        /* 暂停期：人工补充或调整主张（保存时勾选「重新就绪」）；主持人无设定，只看控制区 */
        if(isHost){
          h+='<div class="section dim" style="margin-top:10px">会议已暂停：主持人无需设定立场，等待各方补充并重新就绪后，在「管理」tab 会议控制继续会议。</div>';
        } else {
          h+=seatCfgFormHtml(cfg,true);
        }
      } else if(turn&&turn.seatId===d.mySeatId){
        h+='<div class="section dim" style="margin-top:10px">发言权在本席 —— 可用底部输入条选「代答」替 agent 回答本轮（'+esc(turn.taskHint||'')+'）。</div>';
      } else if(t.parallelDispatch&&(t.activeTurns||[]).some(function(x){ return x.seatId===d.mySeatId; })){
        h+='<div class="section dim" style="margin-top:10px">本席位在并行批次中 —— 可用底部输入条选「交付本轮（并行批次）」直接交付本阶段回合（agent 也会自行交付，先到先计入）。</div>';
      } else if(t.parallelDispatch){
        var parNames=(t.activeTurns||[]).map(function(x){ return esc(seatName(seats,x.seatId)); }).join('、');
        h+='<div class="section dim" style="margin-top:10px">'+(t.parallelDispatch.workers.indexOf(d.mySeatId)>=0?'本批次已交付：等待其他成员交付与批次汇聚。':'并行批次执行中：'+(parNames||'无')+' 正在工作中。')+'</div>';
      } else if(dspFlow&&mySeat.role==='director'){
        h+='<div class="section dim" style="margin-top:10px">工作进行中：用底部输入条选「下指令」安排工作；指令与执行状态见「工作指令」tab，待澄清的指令可在卡上直接答复。</div>';
      } else {
        h+='<div class="section dim" style="margin-top:10px">'+(turn?('当前发言权：'+esc(seatName(seats,turn.seatId))+'。轮到本席时，底部输入条会出现「代答」。'):'等待会议推进。')+'</div>';
      }

      /* 会议控制（建桌人/主持人，会议中）：暂停 / 就绪名单 + 继续（暂停中默认展开） */
      if(isOwner||isHost){
        h+=secDetailsHtml('seatDetCtl',t.pause?'会议控制（暂停中）':'会议控制','暂停 / 跳过发言人 / 继续',ctlBodyHtml(t,seats,turn),!!t.pause);
      }
      /* 申请暂停（未暂停时，非控制人席位；控制人直接用「会议控制」的暂停按钮） */
      if(!t.pause&&!(isOwner||isHost)){
        h+=secDetailsHtml('seatDetPr','申请暂停','通知控制人，同意后生效',prBodyHtml(),false);
      }
      /* 私有指令/凭证恢复面向 agent 席位：指挥方人类席位两者皆无（不发私有指令、无席位 token） */
      if(mySeat.role!=='director'){
        h+=secDetailsHtml('seatDetPod','私有指令记录','我发出的 · 仅自己可见（发送在底部输入条）','<div id="podList" style="margin-top:2px"></div>',false);
        h+=secDetailsHtml('seatDetCred','凭证恢复 · 更换 agent','复制配置给新 agent / 替代换新',credBodyHtml(),false);
      }
    }
    /* 退席入口（低频危险操作，折叠收纳）：未结束且非建桌人席位才显示 */
    if(stage!=='ended'&&!isOwner){
      h+=secDetailsHtml('seatDetLeave','退席','离开本桌 · 凭证失效 · 可凭码再入',leaveBodyHtml(mySeat.role),false);
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
        h+='<div class="section dim" style="margin-top:10px">提问：用底部输入条选「提问」——可广播全体回答方各自作答，或定向某席。</div>';
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
          +(turn
            ?'<div class="row" style="margin-top:6px"><button id="ctlSkip" class="danger">⏭ 跳过当前发言人</button>'
             +'<span class="dim">跳过 '+esc(seatName(seats,turn.seatId))+' 对当前问题的回答，继续后续问答</span></div>'
            :'')
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
      +(active&&!t.pause&&(t.precheck&&t.precheck.state==='directive'||t.activeTurn||t.phase==='execution')?'<button id="admSkip" class="danger">跳过当前发言人</button>':'')
      +(t.pause?'<button id="admResume">继续会议</button><button id="admForce" class="danger">强制继续（跳过就绪）</button>':'')
      +(active&&t.phase!=='human_intervention'?'<button id="admHuman">强制人工介入</button>':'')
      +(active?'<button id="admClose">强制闭桌</button>':'')
      +'<button id="admDel" class="danger">删除圆桌</button></div>'
      +'<div class="hint" style="margin-top:6px">暂停/继续与参与方网页操作同源（记入会议记录与审计）；强制闭桌 = 立即生成纪要并结束（不可恢复）；删除 = 连同消息/产物/席位全部清除（轮询中的 agent 将收到 404）。</div></div>';
  }

  /* 产物 → 桌型专属 tab：设定阶段尚无产物，开始后才展示（结束后保留作记录）；问询桌流程上不产生产物，恒不渲染 */
  h+='\n@@T:work@@\n';
  if(t.phase!=='open'&&ttOf(t.tableType).flow!=='inquiry'){
    h+='<div class="card"><div class="shead"><b>产物</b><span class="dim">交付物版本</span><span class="sp"></span><span class="dim">'+(t.artifacts||[]).length+' 项</span></div><div class="cards">';
    (t.artifacts||[]).forEach(function(a){
      h+='<div class="acard"><div class="row"><b>'+esc(a.name)+'</b><span class="badge phase">v'+a.latestVersion+'</span><span class="sp"></span><span class="dim">'+esc(seatName(seats,a.ownerSeat))+'</span></div>'
        +(a.lockedBy?'<div class="dim">锁：'+esc(seatName(seats,a.lockedBy))+'</div>':'')+'</div>';
    });
    if(!(t.artifacts||[]).length) h+='<div class="dim">暂无产物</div>';
    h+='</div></div>';
  }

  /* 资料文档 → 资料·纪要 tab（上传阅资料 / 投屏）：共享=全桌可下载；私有=仅上传席位（他席可见存在但不可下载） */
  h+='\n@@T:files@@\n';
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

  /* 问答 → 桌型专属 tab（问询桌）：QUESTION+REPLY 按 toMsgId 配对；列表截断显示，点击卡片弹完整问答。
     设定阶段隐藏（尚无提问），问答阶段起展示 */
  h+='\n@@T:work@@\n';
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

  /* 工作指令（指挥桌专属通栏）：每人下达的指令与执行状态汇总 · 点击卡片弹完整详情；
     待澄清且本人是指挥方时给内联答复输入；设定阶段隐藏（尚未开始工作） */
  if(ttOf(t.tableType).flow==='dispatch'&&t.phase!=='open'){
    var wds=d.directives||[], wdOpen=0;
    wds.forEach(function(w){ if(w.status==='pending'||w.status==='executing'||w.status==='need_clarify') wdOpen++; });
    h+='<div class="card"><div class="shead"><b>工作指令</b><span class="dim">各方下达的指令与执行状态 · 点击卡片看全文与回执 · 待澄清的指令可在卡上直接答复</span><span class="sp"></span><span class="dim">'+wds.length+' 条 · 未结 '+wdOpen+'</span></div><div class="cards">';
    wds.forEach(function(w,wi){
      var st=w.status||'pending';
      var cls=st==='done'?'ok':((st==='failed'||st==='rejected')?'err':(st==='need_clarify'?'warn':''));
      h+='<div class="rcard '+cls+'" data-wd="'+wi+'" title="点击查看指令详情">'
        +'<div class="row"><b>'+esc(clipStr(w.title||w.text||'',44))+'</b><span class="sp"></span><span class="badge '+cls+'">'+esc(WD_STATUS[st]||st)+'</span></div>'
        +'<div class="dim">'+esc(w.byName||w.bySeat)+' 下达 · '+fmtTs(w.createdAt)
        +((w.claimedBy&&st!=='pending')?(' · 执行：'+esc(seatName(seats,w.claimedBy))):'')+'</div>';
      if(st==='need_clarify'){
        h+='<div style="margin-top:4px"><span class="badge warn">反问</span> '+esc(clipStr(w.clarifyQ||'',90))+'</div>';
        if(d.isDirector&&t.phase==='working'&&!t.pause){
          h+='<div class="row" style="margin-top:6px" onclick="event.stopPropagation()">'
            +'<input id="wdAns'+wi+'" placeholder="答复反问（答复后指令回到待处理，执行方可继续）" style="flex:1;min-width:200px">'
            +'<button class="wdAnsGo sm" data-wi="'+wi+'">答复</button></div>'
            +'<div class="ferr" id="wdErr'+wi+'"></div>';
        } else if(!w.clarifyA){
          h+='<div class="dim">等待指挥方答复</div>';
        }
      } else if(w.resultNote){
        h+='<div class="dim" style="margin-top:4px">回执：'+esc(clipStr(w.resultNote,90))+'</div>';
      }
      h+='</div>';
    });
    if(!wds.length) h+='<div class="dim">'+(t.phase==='open'?'工作尚未开始':'暂无指令：指挥方用底部输入条下达')+'</div>';
    h+='</div></div>';
  }

  /* 数据索要（对接桌专属通栏）：接收方索要与处置状态汇总；提供方持有人对 human_pending 的索要内联审批
     （批准 / 部分给 / 拒绝 + 说明——服务器强制：仅提供方持有人网页可批，席位 token 无法放行） */
  if(ttOf(t.tableType).flow==='relay'&&t.phase!=='open'){
    var drs=d.dataRequests||[], drUnres=0;
    drs.forEach(function(r){ if(r.status==='pending'||r.status==='human_pending') drUnres++; });
    h+='<div class="card"><div class="shead"><b>数据索要</b><span class="dim">接收方核验缺失的定向索要与处置：规则内由提供方 agent 自动放行 · 超出规则的须提供方持人在此审批</span><span class="sp"></span><span class="dim">'+drs.length+' 条 · 未结 '+drUnres+'</span></div><div class="cards">';
    drs.forEach(function(r,ri){
      var st=r.status||'pending';
      var cls=(st==='granted'||st==='granted_auto')?'ok':((st==='rejected'||st==='rejected_auto')?'err':(st==='human_pending'?'warn':''));
      h+='<div class="rcard '+cls+'">'
        +'<div class="row"><b>'+esc(clipStr(r.title||r.text||'',44))+'</b><span class="sp"></span><span class="badge '+cls+'">'+esc(DR_STATUS[st]||st)+'</span></div>'
        +'<div class="dim">'+esc(r.fromName)+' 索要 → '+esc(seatName(seats,r.toSeat))+' · '+fmtTs(r.createdAt)+'</div>'
        +'<div style="margin-top:4px">'+esc(clipStr(r.text,160))+'</div>';
      if(r.resultNote) h+='<div class="dim" style="margin-top:4px">提供方回执：'+esc(clipStr(r.resultNote,110))+'</div>';
      if(r.docIds&&r.docIds.length) h+='<div class="dim">放行文件：'+esc(r.docIds.join('、'))+'</div>';
      if(st==='human_pending'){
        if(d.isProvider&&t.phase==='transfer'&&!t.pause){
          h+='<div class="row" style="margin-top:6px"><span class="badge warn">待你审批</span></div>'
            +'<div class="row" style="margin-top:4px"><input id="drNote'+ri+'" placeholder="审批说明（部分给/拒绝必填：替代方案或理由）" style="flex:1;min-width:200px">'
            +'<button class="drRuleGo sm" data-ri="'+ri+'" data-dec="granted">批准</button>'
            +'<button class="drRuleGo sm" data-ri="'+ri+'" data-dec="partial">部分给</button>'
            +'<button class="drRuleGo sm" data-ri="'+ri+'" data-dec="rejected">拒绝</button></div>'
            +'<div class="ferr" id="drRuleErr'+ri+'"></div>';
        } else {
          h+='<div class="dim" style="margin-top:4px">等待提供方持有人审批</div>';
        }
      }
      if(r.grantNote) h+='<div class="dim" style="margin-top:4px">持有人审批：'+esc(clipStr(r.grantNote,110))+(r.grantBy?('（by '+esc(r.grantBy)+'）'):'')+'</div>';
      h+='</div>';
    });
    if(!drs.length) h+='<div class="dim">暂无索要：接收方对照 checklist 核验对接单，缺失项用底部输入条「索要数据」发起</div>';
    h+='</div></div>';
  }

  /* 评审项（全宽通栏，执行请求面板上方：评审项是上游意见单位，执行请求是 accept 派生的下游工单）。
     每条意见 → 回应 → 派生执行 → 最终结局（直接通过/交互后通过/已拒绝…），点击弹详情。
     问询桌无评审流程、open 设定阶段尚无意见，均不渲染 */
  var rits=d.reviewItems||[];
  if(ttOf(t.tableType).flow!=='inquiry'&&t.phase!=='open'&&rits.length){
    var rdone=0;
    rits.forEach(function(rec){ var st=reviewItemStatus(rec); if(st.cls==='ok'||st.cls==='err') rdone++; });
    h+='<div class="card"><div class="shead"><b>评审项</b><span class="dim">全部评审意见及各自结局：直接通过 = 一轮接纳并执行完成；交互后通过 = 经多轮回应/反提案/转人工后通过 · 点击卡片看详情</span><span class="sp"></span><span class="dim">'+rdone+'/'+rits.length+' 已结</span></div><div class="cards">';
    rits.forEach(function(rec,ri){
      var st=reviewItemStatus(rec), it=rec.item||{};
      var target='';
      (t.artifacts||[]).forEach(function(a){ if(rec.artifactId&&a.artifactId===rec.artifactId) target='产物：'+clipStr(a.name,16); });
      (d.documents||[]).forEach(function(dc){ if(rec.docId&&dc.docId===rec.docId) target='资料：'+clipStr(dc.name,16); });
      var rs=rec.responses||[], last=rs[rs.length-1];
      var disp=last
        ?'<div class="dim">处置：'+esc(RESP_LABEL[last.decision]||last.decision)+(last.reason?(' — '+esc(clipStr(last.reason,60))):'')+'</div>'
        :'<div class="dim">处置：待回应</div>';
      var reqs=rec.requests||[], lr=reqs[reqs.length-1];
      var exe=lr
        ?'<div class="dim">执行：'+((lr.createdBy===(lr.req&&lr.req.toSeat))?'认领自办':('委托 '+esc(seatName(seats,lr.req&&lr.req.toSeat))))+' · '+esc(REQ_ST_LABEL[lr.status]||lr.status)+(reqs.length>1?('（第 '+reqs.length+' 次派生）'):'')+'</div>'
        :'';
      h+='<div class="rcard '+st.cls+'" data-vi="'+ri+'" title="点击查看评审项详情">'
        +'<div class="row"><span class="badge">'+esc(SEV_LABEL[it.severity]||it.severity||'')+'</span><b>'+esc(clipStr(it.comment,36))+'</b><span class="sp"></span><span class="badge '+st.cls+'">'+esc(st.label)+'</span></div>'
        +'<div class="dim">'+esc(seatName(seats,rec.fromSeat))+' 提出 · '+fmtTs(rec.ts)+(target?(' · '+esc(target)):'')+'</div>'
        +disp+exe
        +'</div>';
    });
    h+='</div></div>';
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

  /* 纪要 → 资料·纪要 tab（md 格式经 miniMd 安全渲染） */
  h+='\n@@T:files@@\n';
  if(d.minutes){
    h+='<div class="card"><div class="shead"><b>会议纪要</b></div><div class="mdv">'+miniMd(d.minutes.markdown||'')+'</div></div>';
  }

  /* 旧的合并流历史面板已移除（历史沿革）：消息流由「会话」tab 承载（筛选 + 阶段分隔条 + 全量徽章），
     产物/资料/席位变动分别在 桌型专属 tab、资料·纪要 tab、总览 tab；私有指令记录在管理 tab 我的席位 */

  /* ---- 总装：按 @@T:x@@ 标记切分模块 → 常驻头 / 动作条 / 六 tab 视图 / 左栏 / 底部操作条 ---- */
  var segs=h.split('@@T:'), sec={head:'',act:'',ov:'',chat:'',proc:'',work:'',files:'',mng:''};
  segs.forEach(function(s){
    var k=s.indexOf('@@');
    if(k>0&&Object.prototype.hasOwnProperty.call(sec,s.slice(0,k))) sec[s.slice(0,k)]+=s.slice(k+2);
    else sec.head+=s;
  });
  /* 桌型专属 tab 按 flow 定名：评审·执行 / 工作指令 / 数据对接 / 问答 */
  var workDef=inqFlow?['问答','❓']:(dspFlow?['工作指令','📋']:(hoFlow?['数据对接','⇄']:['评审·执行','✓']));
  /* tab 解析：手选（sessionStorage 按桌记忆）→ 默认（open=总览 / ended=资料·纪要 / 其余=会话） */
  var tabIds={ov:1,chat:1,proc:1,work:1,files:1,mng:1};
  var tab=view.uiTab;
  if(!tab||!tabIds[tab]){ try{ tab=sessionStorage.getItem('rt_dtab_'+view.tableId)||''; }catch(e){ tab=''; } }
  if(!tabIds[tab]) tab=(t.phase==='open')?'ov':(stage==='ended'?'files':'chat');
  view.uiTab=tab;
  if(tab==='chat'){ var mx=view.maxSeenSeq||0; (d.messages||[]).forEach(function(m){ if(m.seq>mx) mx=m.seq; }); view.maxSeenSeq=mx; }
  var chatNew=0;
  if(tab!=='chat'){ (d.messages||[]).forEach(function(m){ if(m.seq>(view.maxSeenSeq||0)) chatNew++; }); }
  /* 角标：专属 tab=待处理数；管理 tab=待审批暂停申请（控制人视角） */
  var workCnt=dspFlow
    ?(d.directives||[]).filter(function(w){ return w.status==='need_clarify'; }).length
    :hoFlow
      ?(d.dataRequests||[]).filter(function(r){ return r.status==='human_pending'; }).length
      :inqFlow
        ?(view.qaPairs||[]).filter(function(qa){ return !qa.replies.length; }).length
        :rits.filter(function(rec){ var st=reviewItemStatus(rec); return st.cls!=='ok'&&st.cls!=='err'; }).length;
  var mngCnt=isController?(d.pauseRequests||[]).length:0;
  var tabNav='';
  [['ov','⌂','总览',0],['chat','💬','会话',chatNew],['proc','⏱','过程',0],['work',workDef[1],workDef[0],workCnt],['files','📁','资料·纪要',0],['mng','⚙','管理',mngCnt]].forEach(function(x){
    tabNav+='<button class="dtab'+(x[0]===tab?' on':'')+'" data-dt="'+x[0]+'"><span class="ic">'+x[1]+'</span>'+esc(x[2])
      +((x[3]>0)?('<span class="cnt'+(x[0]==='mng'?' warn':'')+'">'+(x[3]>99?'99+':x[3])+'</span>'):'')+'</button>';
  });
  /* 左栏 · 我的席位摘要（常驻：我是谁/就绪态/入口） */
  var meH='';
  if(mySeat){
    var mcfg=mySeat.config||{};
    meH='<div class="dt-me"><div class="nm">'+roleBadge(mySeat.role)+'<b>'+esc(mySeat.name)+'</b>'
      +(t.ownerSeat===mySeat.seatId?'<span class="badge">建桌人</span>':'')
      +(mySeat.role==='host'?'<span class="badge">主持人 · 豁免就绪</span>':(mySeat.role==='director'?'<span class="badge">人类成员</span>':'<span class="badge '+(mcfg.ready?'ok':'warn')+'">'+(mcfg.ready?'已就绪':'未就绪')+'</span>'))
      +'</div>'
      +'<div class="st">'+(mySeat.role==='director'?'人类成员 · 网页下达指令（无 agent 凭证）':('agent: '+esc(mySeat.agentLabel)))
      +(seatOff(mySeat,t)?'<br><span class="hi-err">◌ 已断开</span>':'')+'</div>'
      +'<div class="row">'+((t.phase==='open'&&mySeat.role!=='host'&&mySeat.role!=='director'&&!(mcfg.ready||view.cfgEditing))
        ?'<button class="sm primary" data-goto="mng">去完成入桌设定 →</button>'
        :'<button class="sm" data-goto="mng">席位与管理 →</button>')+'</div></div>';
  }
  /* 双身份（席位+问询方）时摘要卡给席位，问询方面板在管理 tab——两处互不屏蔽 */
  if(!mySeat&&isAsker){
    meH='<div class="dt-me"><div class="nm"><span class="rb asker">问询方</span><b>'+esc(view.userName||'')+'</b></div>'
      +'<div class="st">不占席位 · 网页提问（可定向/广播）</div><div class="row"><button class="sm" data-goto="mng">问询方面板 →</button></div></div>';
  }
  if(!mySeat&&!isAsker&&admin){
    meH='<div class="dt-me"><div class="nm"><span class="wbadge admin">系统观察员</span></div><div class="st">只读观察 · 管理操作在「管理」tab</div><div class="row"><button class="sm" data-goto="mng">管理操作 →</button></div></div>';
  }
  /* 动作条深链按钮 */
  var gotoH='';
  if(t.phase==='open'){
    if(mySeat&&mySeat.role!=='host'&&mySeat.role!=='director'&&!(mySeat.config&&mySeat.config.ready)&&!view.cfgEditing) gotoH+='<button class="sm primary" data-goto="mng">去完成入桌设定 →</button>';
    if(mySeat&&t.ownerSeat===mySeat.seatId) gotoH+='<button class="sm" data-goto="mng">开局面板 →</button>';
    if(isAsker) gotoH+='<button class="sm" data-goto="ov">就绪与邀请码 →</button>';
  }
  if(t.pause&&stage!=='ended') gotoH+='<button class="sm" data-goto="mng">会议控制 →</button>';
  /* 底部常驻操作条：输入聚合（桌型×身份自适应类型）+ 快捷控制（阶段×角色，只放最主要的） */
  /* 快捷控制（阶段×角色）先构建：多类型时放 chips 行右侧；单类型时并入组头行（少占一行） */
  var ctlBtns='';
  var bbSeats=inqFlow?seats.filter(function(s){ return s.role==='answerer'; })
    :dspFlow?seats.filter(function(s){ return s.role==='worker'; })
    :seats.filter(function(s){ return s.role!=='host'; });
  var bbAll=bbSeats.length>0&&bbSeats.every(function(s){ return s.config&&s.config.ready; });
  if(stage!=='ended'){
    if(t.phase==='open'){
      if(mySeat&&t.ownerSeat===mySeat.seatId) ctlBtns+='<button id="bbStart" class="primary">▶ '+(dspFlow?'开始工作':'开始会议')+'</button>';
      if(isAsker) ctlBtns+='<button id="bbInqStart" class="primary">▶ 开始问询</button>';
    }
    if(t.pause){
      if(isController) ctlBtns+='<button id="bbResume" class="primary"'+((bbAll||admin)?'':' disabled')+'>▶ 继续会议</button>';
    } else if(t.phase!=='open'){
      if(isController&&t.phase!=='human_intervention') ctlBtns+='<button id="bbPause">⏸ 暂停</button>';
      if(isAsker&&t.phase==='qa') ctlBtns+='<button id="bbInqEnd" class="danger">■ 结束问询</button>';
    }
  }
  var composer=barComposerHtml(d,seats,mySeat,isAsker,stage,ctlBtns);
  /* ---- 右侧动态栏（窄右 · 全高）：阶段提示 / 邀请码(设定期·建桌人) / 事件流 / 本桌玩法 ---- */
  var railH='', stLabel=phaseLabel(t.tableType,t.phase), railStageH='';
  if(t.phase==='open'){
    var nsReady=needSeats.filter(function(x){ return x.config&&x.config.ready; }).length;
    railStageH='<div class="row" style="gap:6px"><span class="badge phase">'+STAGE_LABEL[stage]+'</span><span class="dim">'+esc(stLabel)+'</span></div>';
    var meOwner=!!(mySeat&&mySeat.seatId===t.ownerSeat);
    var meHost=!!(mySeat&&mySeat.role==='host'&&!meOwner);
    var meDirector=!!(mySeat&&mySeat.role==='director'&&!meOwner&&!meHost);
    var meSeatPlain=!!(mySeat&&!meOwner&&!meHost&&!meDirector);
    if(meOwner){
      railStageH+='<div class="kv">就绪 '+nsReady+' / '+needSeats.length+(rolesOk?'':'（角色不齐备）')+'</div>'
        +(needSeats.length?('<div class="dim">未就绪：'+needSeats.filter(function(x){ return !(x.config&&x.config.ready); }).map(function(x){ return esc(x.name); }).join('、')+'</div>'):'')
        +'<div class="dim" style="margin-top:4px">全员就绪后底部「▶ 开始」可用；邀请码在下方，发给参与方 agent。</div>';
    }
    if(meHost){
      railStageH+='<div class="dim">在「管理」tab 完成桌设定；用下方邀请码把各方请进来，全员就绪后开始。</div>';
    }
    if(meDirector){
      railStageH+='<div class="dim">指挥方无需设定：等执行方入席就绪，工作开始后用底部输入条下达指令。</div>';
    }
    if(meSeatPlain){
      railStageH+='<div class="dim">到「管理」tab 完成入桌设定（立场/范围/数据范围），勾选<b>就绪</b>并保存；开始后锁定，改动等暂停期。</div>';
    }
    /* 双身份（席位+问询方）时席位提示优先，问询面板仍在管理 tab——互不屏蔽 */
    if(!mySeat&&isAsker){
      railStageH+='<div class="dim">把「回答方」邀请码发给各 agent；全部就绪后底部「▶ 开始问询」。</div>';
    }
    if(!mySeat&&!isAsker){
      railStageH+='<div class="dim">只读观察中。</div>';
    }
  } else if(stage==='ended'){
    railStageH='<div class="row" style="gap:6px"><span class="badge ok">已结束</span></div><div class="dim" style="margin-top:4px">纪要与产物见「资料·纪要」；会话全文只读。</div>';
  } else if(t.pause){
    var prS=inqFlow?seats.filter(function(x){ return x.role==='answerer'; }):dspFlow?seats.filter(function(x){ return x.role==='worker'; }):seats.filter(function(x){ return x.role!=='host'; });
    var prN=prS.filter(function(x){ return x.config&&x.config.ready; }).length;
    railStageH='<div class="row" style="gap:6px"><span class="badge warn">⏸ 已暂停</span><span class="dim">停在「'+esc(stLabel)+'」</span></div><ul style="list-style:none;margin:6px 0 0;padding:0">'
      +prS.map(function(x){ return '<li class="kv" style="margin:3px 0">'+esc(x.name)+' '+roleBadge(x.role)+' <span class="badge '+((x.config&&x.config.ready)?'ok':'warn')+'">'+((x.config&&x.config.ready)?'已就绪':'未就绪')+'</span></li>'; }).join('')
      +'</ul><div class="dim" style="margin-top:6px">'+((prS.length&&prN===prS.length)?'全员已就绪，可继续会议（底部/管理 tab）':'未就绪席位补充/调整并重新就绪后继续')+'</div>';
  } else {
    railStageH='<div class="row" style="gap:6px"><span class="badge phase">'+esc(stLabel)+'</span>'+(t.roundNo>1?('<span class="dim">第 '+t.roundNo+' 轮</span>'):'')+'</div>';
    if(turn){
      var rProg=(t.turnProgress&&t.turnProgress.stage)?turnStageLabel({stage:t.turnProgress.stage}):'';
      railStageH+='<div class="kv" style="margin-top:2px">发言权：<b>'+esc(seatName(seats,turn.seatId))+'</b>'+(rProg?(' · '+esc(rProg)):'')+'</div><div class="dim">'+esc(clipStr(turn.taskHint||'',64))+'</div>';
    } else if(dspFlow){
      railStageH+='<div class="kv">未结指令 '+((d.directives||[]).filter(function(w){ return w.status==='pending'||w.status==='executing'||w.status==='need_clarify'; }).length)+' 条 · 明细见「工作指令」</div>';
    } else if(hoFlow){
      railStageH+='<div class="kv">未结节 '+((d.dataRequests||[]).filter(function(r){ return r.status==='pending'||r.status==='human_pending'; }).length)+' 条 · 明细见「数据对接」</div>';
    } else if(t.parallelDispatch&&(t.activeTurns||[]).length){
      railStageH+='<div class="kv">并行批次：<b>'+esc((t.activeTurns||[]).map(function(x){ return seatName(seats,x.seatId); }).join('、'))+'</b></div>';
    }
  }
  railH+='<div class="rail-card"><h4>当前状态</h4>'+railStageH+'</div>';
  if(stage!=='ended'&&(admin||(mySeat&&mySeat.seatId===t.ownerSeat))){
    railH+='<div class="rail-card" id="inviteBox"><h4>邀请码 · 拉人</h4><div class="dim" style="margin-bottom:6px">仅建桌人与系统观察员可见 · 复制完整邀请发给参与方 agent</div><div id="invites" class="dim">加载中…</div></div>';
  }
  var evs=(d.messages||[]).filter(function(m){ return m.type!=='SEAT_JOINED'&&m.type!=='SEAT_LEFT'; }).slice(-9).reverse();
  var evH='';
  evs.forEach(function(m){
    var evTxt=(m.type==='PHASE_CHANGE')?('阶段 · '+clipStr(msgBodyText(m,seats),36)):((MT_LABEL[m.type]||m.type)+' · '+clipStr(msgBodyText(m,seats),30));
    evH+='<div class="ev" title="点击到「会话」查看全文"><span class="t">'+fmtClock(m.ts)+'</span><span class="txt">'+esc(evTxt)+'</span></div>';
  });
  railH+='<div class="rail-card"><h4>动态</h4>'+(evH||'<div class="dim">还没有动态</div>')+'</div>';
  var mh=(MODE_HELP[t.tableType]||{});
  railH+='<details class="rail-card rail-help"'+((view.railHelpOpen==null?(t.phase==='open'):view.railHelpOpen)?' open':'')+'><summary style="cursor:pointer;font-weight:600;font-size:13px">❔ 本桌怎么玩</summary>'
    +'<div class="dim" style="margin:6px 0 2px">'+esc(mh.flow||'')+'</div>'
    +((mh.usage||[]).length?('<ul>'+mh.usage.slice(0,4).map(function(x){ return '<li>'+esc(x)+'</li>'; }).join('')+'</ul>'):'')
    +'</details>';

  var barH='';
  if(composer||ctlBtns){
    barH='<div class="dtbar" id="dtBar"><div class="dtbar-in">'
      +(composer
        ?(composer[0] /* 多类型：chips 行（右侧快捷控制）+ 组内容 */
           ?'<div class="row" style="align-items:center;flex-wrap:wrap"><div class="tbar" id="cmpTabs" style="margin:0">'+composer[0]+'</div><span class="sp"></span>'
             +(ctlBtns?'<div class="bb-ctrl">'+ctlBtns+'</div>':'')+'</div>'+composer[1]
           :composer[1]) /* 单类型：省 chips 行（快捷控制已并入组头行） */
        :'<div class="row" style="align-items:center"><span class="dim">当前无可发送的消息类型</span><span class="sp"></span><div class="bb-ctrl">'+ctlBtns+'</div></div>')
      +'<div class="ferr" id="bbErr"></div></div></div>';
  } else if(t.phase==='closed'){
    barH='<div class="dtbar"><div class="dtbar-ro">会议已结束 · 内容只读 — 纪要与产物见「资料·纪要」</div></div>';
  } else if(!mySeat){
    barH='<div class="dtbar"><div class="dtbar-ro">'+(admin?'系统观察员 · 只读观察，无输入权限':'当前身份无可发送内容')+'</div></div>';
  }
  /* 空视图占位（过程/专属 tab 在会议开始前） */
  if(!sec.proc.replace(/\s/g,'')) sec.proc='<div class="card"><div class="shead"><b>执行时序图</b></div><div class="dim">会议开始后，这里按时间展示各方执行节点（并行并列、批次汇聚、进行中跳动）'+((mySeat&&mySeat.role==='host')?'；主持人可在此发起并行调度。':'。')+'</div></div>';
  if(!sec.work.replace(/\s/g,'')) sec.work='<div class="card"><div class="shead"><b>'+esc(workDef[0])+'</b></div><div class="dim">'+(t.phase==='open'?('尚未开始：开始后这里展示「'+esc(workDef[0])+'」内容。'):'暂无内容。')+'</div></div>';
  var secMap={ov:sec.ov,chat:sec.chat,proc:sec.proc,work:sec.work,files:sec.files,mng:sec.mng};
  var app=document.getElementById('app');
  app.className='detail';
  var actCard='<div class="dt-action'+((t.pause||t.phase==='human_intervention')?' warn':'')+'"><span class="lbl">★ 下一步</span>'
    +'<div>'+sec.act+'</div>'
    +(gotoH?'<div class="go">'+gotoH+'</div>':'')+'</div>';
  app.innerHTML=sec.head
    +'<div class="dt-shell"><aside class="dt-side"><nav class="dtabs">'+tabNav+'</nav>'+actCard+meH+'</aside>'
    +'<section class="dt-main"><div class="dt-view">'+secMap[tab]+'</div><div id="dtBarPh"></div></section>'
    +'<aside class="dt-rail">'+railH+'</aside></div>'
    +barH;
  document.title=t.topic+' · 圆桌详情'; // 分享/历史记录可辨识
  document.getElementById('back').onclick=function(){ openList(); };
  document.getElementById('dCopyLink').onclick=function(){ copyText(location.origin+'/#/table/'+view.tableId); toast('详情页链接已复制，可发给他人直达本桌'); };
  /* 输入区固定窗口底：对齐中列左缘与宽度（轮询重建/窗口尺寸变化后重算），占位防遮挡 */
  placeDtBar();
  /* tab 切换 / 动作条深链 / 右栏事件流跳会话 / 帮助卡开合 */
  app.querySelectorAll('button[data-dt]').forEach(function(b){ b.onclick=function(){ switchDtTab(b.getAttribute('data-dt')); }; });
  var onTab=app.querySelector('.dtab.on'); /* 窄屏横滚 tab 条：当前项滚入视野 */
  if(onTab&&onTab.scrollIntoView) onTab.scrollIntoView({block:'nearest',inline:'nearest'});
  app.querySelectorAll('.ev').forEach(function(el){ el.onclick=function(){ switchDtTab('chat'); }; });
  var railHelpDet=document.querySelector('.rail-help');
  if(railHelpDet){ railHelpDet.addEventListener('toggle',function(){ view.railHelpOpen=railHelpDet.open; }); }
  app.querySelectorAll('button[data-goto]').forEach(function(b){ b.onclick=function(){ switchDtTab(b.getAttribute('data-goto')); }; });
  /* 底部条快捷控制：开始/继续走 my 通道（管理员无席位走 admin 通道）；暂停原因等完整控制见管理 tab */
  bindStartBtn('bbStart','bbErr');
  bindStartBtn('bbInqStart','bbErr');
  var bbCtlSeat=function(){ return mySeat&&(mySeat.seatId===t.ownerSeat||mySeat.role==='host'); };
  var bbPauseB=document.getElementById('bbPause');
  if(bbPauseB) bbPauseB.onclick=function(){
    api('POST',bbCtlSeat()?('/api/tables/'+view.tableId+'/my/pause'):('/api/admin/tables/'+view.tableId+'/pause'),{reason:''})
      .then(function(){ toast('会议已暂停，各方已收到通知'); view.dirtyPanel=false; loadDetail(); })
      .catch(function(e){ var el=document.getElementById('bbErr'); if(el) el.textContent='暂停失败：'+e.message; });
  };
  var bbResumeB=document.getElementById('bbResume');
  if(bbResumeB) bbResumeB.onclick=function(){
    if(bbResumeB.disabled) return;
    api('POST',bbCtlSeat()?('/api/tables/'+view.tableId+'/my/resume'):('/api/admin/tables/'+view.tableId+'/resume'),{})
      .then(function(){ toast('会议已继续'); view.dirtyPanel=false; loadDetail(); })
      .catch(function(e){ var el=document.getElementById('bbErr'); if(el) el.textContent='继续失败：'+e.message; });
  };
  var bbInqEndB=document.getElementById('bbInqEnd');
  if(bbInqEndB) bbInqEndB.onclick=function(){
    if(!window.confirm('结束问询？将生成问询纪要并关闭本桌（不可恢复）。')) return;
    api('POST','/api/tables/'+view.tableId+'/end-inquiry',{})
      .then(function(){ toast('问询已结束，纪要已生成'); view.dirtyPanel=false; loadDetail(); })
      .catch(function(e){ var el=document.getElementById('bbErr'); if(el) el.textContent='结束失败：'+e.message; });
  };

  /* ---- 绑定：圆桌示意图 >8 席折叠展开（纯视图操作；rerenderDetail 附带输入草稿采集回填） ---- */
  var rtMore=document.getElementById('rtMore');
  if(rtMore) rtMore.onclick=function(){ view.rtExpanded=!view.rtExpanded; rerenderDetail(); };
  var rtFold=document.getElementById('rtFold');
  if(rtFold) rtFold.onclick=function(){ view.rtExpanded=false; rerenderDetail(); };
  /* ---- 绑定：执行时序图（折叠/节点详情弹窗/横向贴右——上翻阅读则保持原位，同会话贴底模式） ---- */
  var tlFoldBtn=document.getElementById('tlFold');
  if(tlFoldBtn) tlFoldBtn.onclick=function(){ view.tlOpen=(view.tlOpen===false); rerenderDetail(); };
  app.querySelectorAll('.tl-node').forEach(function(el){
    el.onclick=function(){
      var ni=parseInt(el.getAttribute('data-tln'),10);
      var nd=(view.tlModel&&view.tlModel.nodes[ni]);
      if(nd) openTlNodeModal(nd,seats);
    };
  });
  var tlScroll=document.getElementById('tlScroll');
  if(tlScroll){
    if(view.tlStick!==false) tlScroll.scrollTop=tlScroll.scrollHeight; /* 纵向时序：贴底跟随最新（上翻即停） */
    tlScroll.addEventListener('scroll',function(){
      view.tlStick=(tlScroll.scrollTop+tlScroll.clientHeight>=tlScroll.scrollHeight-24);
    });
  }
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
  /* ---- 绑定：评审项卡片 → 详情弹窗（纯查看，不触发草稿保护） ---- */
  app.querySelectorAll('.rcard[data-vi]').forEach(function(el){
    el.onclick=function(){
      var vi=parseInt(el.getAttribute('data-vi'),10);
      var dd=view.lastDetailData||{};
      var rits=dd.reviewItems||[];
      if(rits[vi]) openReviewItemModal(rits[vi],seats,(t.artifacts||[]),(dd.documents||[]),(dd.messages||[]));
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

  /* ---- 绑定：工作指令卡 → 详情弹窗；内联答复（指挥方，need_clarify 时） ---- */
  app.querySelectorAll('[data-wd]').forEach(function(el){
    el.onclick=function(){
      var wds=(view.lastDetailData&&view.lastDetailData.directives)||[];
      var w=wds[parseInt(el.getAttribute('data-wd'),10)];
      if(w) openWdModal(w,seats);
    };
  });
  app.querySelectorAll('button.wdAnsGo').forEach(function(b){
    b.onclick=function(ev){
      ev.stopPropagation();
      var wi=parseInt(b.getAttribute('data-wi'),10);
      var wds=(view.lastDetailData&&view.lastDetailData.directives)||[];
      var w=wds[wi]; if(!w) return;
      var ans=(document.getElementById('wdAns'+wi)||{}).value||'';
      var errEl=document.getElementById('wdErr'+wi);
      if(!ans.trim()){ toast('请输入答复内容'); return; }
      b.disabled=true;
      api('POST','/api/tables/'+view.tableId+'/directives/clarify',{directiveId:w.directiveId,answer:ans.trim()})
        .then(function(){ toast('已答复，指令回到待处理'); view.dirtyPanel=false; loadDetail(); })
        .catch(function(e){ b.disabled=false; if(errEl) errEl.textContent='答复失败：'+e.message; });
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
  if(mySeat&&(t.phase==='open'||t.pause||(t.phase!=='closed'&&!(mySeat.config&&mySeat.config.ready)&&!(mySeat.config&&mySeat.config.stance)&&mySeat.role!=='host'&&mySeat.role!=='director'))){
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

      /* 风格预设 + 预览（按本席角色过滤；选中展示该风格完整说明，保存后 agent 按此思考输出。
         未改动风格控件时保存沿用已存 style 快照（补充文本不回填输入框，避免二次编辑丢失） */
      var getStyleState=function(){
        var c=mySeat.config||{};
        return { stylePreset:c.stylePreset||'', style:c.style||'' };
      };
      var cfgStyle=document.getElementById('cfgStyle');
      if(cfgStyle){
        var styles=[], stylesLoaded=false, styleDirty=false;
        var savedStyleCfg=mySeat.config||{};
        var styleOf=function(id){ for(var k=0;k<styles.length;k++){ if(styles[k].id===id) return styles[k]; } return null; };
        var composeStyle=function(){
          var p=styleOf(cfgStyle.value), sup=document.getElementById('cfgStyleSup').value.trim();
          if(!p) return sup;
          return p.text+(sup?('；补充：'+sup):'');
        };
        var stylePrevDraw=function(){
          var prev=document.getElementById('cfgStylePrev'); if(!prev) return;
          if(!styleDirty&&savedStyleCfg.style){ prev.innerHTML='<b>当前风格：</b><span style="white-space:pre-line">'+esc(savedStyleCfg.style)+'</span>'; return; }
          var p=styleOf(cfgStyle.value), sup=document.getElementById('cfgStyleSup').value.trim();
          if(!p&&!sup){ prev.textContent='未设定风格：本席 agent 按立场与默认习惯思考输出（可选苛刻/严谨/宽松、偏安全/偏业务/偏体验等倾向）。'; return; }
          var head=p?('<b>'+esc(p.label)+'</b> '+p.tags.map(function(tg){ return '<span class="badge">'+esc(tg)+'</span>'; }).join(' ')+'<span class="dim"> — '+esc(p.brief)+'</span>')
            :'<b>自定义风格</b>';
          prev.innerHTML=head+'<div class="kv" style="margin-top:4px"><span class="k">预览</span><span style="white-space:pre-line">'+esc(composeStyle())+'</span></div>';
        };
        api('GET','/api/stances').then(function(sd){
          styles=(sd.styles||[]).filter(function(x){ return x.forRole===mySeat.role; });
          stylesLoaded=true;
          var o='<option value="">（不设风格 · 按默认）</option>';
          styles.forEach(function(x){ o+='<option value="'+esc(x.id)+'"'+((savedStyleCfg.stylePreset===x.id)?' selected':'')+'>'+esc(x.label)+'（'+x.tags.map(esc).join('·')+'）</option>'; });
          cfgStyle.innerHTML=o;
          stylePrevDraw();
        }).catch(function(){});
        cfgStyle.onchange=function(){ styleDirty=true; view.dirtyPanel=true; stylePrevDraw(); };
        document.getElementById('cfgStyleSup').oninput=function(){ styleDirty=true; view.dirtyPanel=true; stylePrevDraw(); };
        stylePrevDraw();
        getStyleState=function(){ /* 保存时取风格终值：未动过沿用快照，动了重合成 */
          return {
            stylePreset:(styleDirty||stylesLoaded)?(cfgStyle.value||''):(savedStyleCfg.stylePreset||''),
            style:(styleDirty?composeStyle():(savedStyleCfg.style||''))
          };
        };
      }

      /* 讨论范围快捷模板（点击即设定） */
      app.querySelectorAll('button[data-scope]').forEach(function(b){
        b.onclick=function(){ document.getElementById('cfgScope').value=b.getAttribute('data-scope'); view.dirtyPanel=true; };
      });

      /* 数据范围 chips 输入器（回填现值；条目为 {text, grant}，披露级别可在 chip 内切换） */
      view.dsDraft=((mySeat.config&&mySeat.config.dataScope)||[]).map(dsItem);
      var redrawDs=function(){
        var box=document.getElementById('dsChips');
        if(!box) return;
        var o='';
        view.dsDraft.forEach(function(x,xi){
          o+='<span class="chip">'+esc(x.text)
            +'<select class="dsg" data-dg="'+xi+'">'+DS_GRANTS.map(function(g){ return '<option value="'+g+'"'+(x.grant===g?' selected':'')+'>'+DS_GRANT_LABEL[g]+'</option>'; }).join('')+'</select>'
            +'<b data-di="'+xi+'">×</b></span>';
        });
        box.innerHTML=o||'';
        box.querySelectorAll('b[data-di]').forEach(function(bx){
          bx.onclick=function(){ view.dsDraft.splice(parseInt(bx.getAttribute('data-di'),10),1); view.dirtyPanel=true; redrawDs(); };
        });
        box.querySelectorAll('select.dsg').forEach(function(sl){
          sl.onchange=function(){ view.dsDraft[parseInt(sl.getAttribute('data-dg'),10)].grant=sl.value; view.dirtyPanel=true; };
        });
      };
      redrawDs();
      var dsIn=document.getElementById('dsIn');
      var addDs=function(v){
        v=(v||'').trim(); if(!v) return;
        if(!view.dsDraft.some(function(d){ return d.text===v; })){ view.dsDraft.push({text:v,grant:'read'}); view.dirtyPanel=true; redrawDs(); }
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
        var styleState=getStyleState();
        api('POST','/api/tables/'+view.tableId+'/my/seat-config',{
          stancePreset:cfgPreset.value||undefined,
          stance:stance,
          stylePreset:styleState.stylePreset||undefined,
          style:styleState.style||undefined,
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
  var dspOfTable=t.tableType==='dispatch';
  function bindStartBtn(btnId, errId){
    var btn=document.getElementById(btnId);
    if(!btn) return;
    btn.onclick=function(){
      if(btn.disabled) return;
      api('POST','/api/tables/'+view.tableId+'/my/start',{}).then(function(){
        toast(inqOfTable?'问询已开始，可以提问了':(dspOfTable?'工作已开始，可以下达指令了':'会议已开始，进入提案陈述阶段')); view.dirtyPanel=false; loadDetail();
      }).catch(function(e){ document.getElementById(errId).textContent='开始失败：'+e.message; });
    };
  }
  bindStartBtn('stStart','stErr');
  bindStartBtn('inqStart','inqStartErr');

  /* ---- 绑定：退席（我的席位 · 不可撤销，confirm 双确认提示后果） ---- */
  var stLeave=document.getElementById('stLeave');
  if(stLeave) stLeave.onclick=function(){
    var agentSeat=stLeave.getAttribute('data-agent')==='1';
    if(!window.confirm('确认退席？本席将标记为已退席（不可撤销）：'
      +(agentSeat?'席位凭证立即失效，你的 agent 将无法继续参会；':'')
      +'如需再次入桌，须凭邀请码重新入席（角色由新码决定）。')) return;
    stLeave.disabled=true;
    api('POST','/api/tables/'+view.tableId+'/my/leave',{})
      .then(function(){ toast('已退席；凭邀请码可重新入桌'); loadList(); })
      .catch(function(e){ stLeave.disabled=false; document.getElementById('leaveErr').textContent='退席失败：'+e.message; });
  };

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

  /* ---- 绑定：指挥方下达工作指令（无席位专属通道，user token + director 席位归属） ---- */
  var dirSend=document.getElementById('dirSend');
  if(dirSend) dirSend.onclick=function(){
    var text=document.getElementById('dirText').value.trim();
    var title=document.getElementById('dirTitle').value.trim();
    var errEl=document.getElementById('dirErr'); errEl.textContent='';
    if(!text){ errEl.textContent='请输入指令内容'; return; }
    dirSend.disabled=true;
    api('POST','/api/tables/'+view.tableId+'/directives',{text:text,title:title||undefined})
      .then(function(){ toast('指令已下达，执行方将领单处理'); document.getElementById('dirText').value=''; view.dirtyPanel=false; loadDetail(); })
      .catch(function(e){ dirSend.disabled=false; errEl.textContent='下达失败：'+e.message; });
  };

  /* ---- 绑定：对接桌 接收方索要（user token + receiver 席位归属）/ 提供方持有人审批 / 确认接收 ---- */
  var drSend=document.getElementById('drSend');
  if(drSend) drSend.onclick=function(){
    var text=document.getElementById('drText').value.trim();
    var title=document.getElementById('drTitle').value.trim();
    var to=document.getElementById('drTo').value;
    var errEl=document.getElementById('drErr'); errEl.textContent='';
    if(!text){ errEl.textContent='请输入索要内容'; return; }
    if(!to){ errEl.textContent='请选择定向的提供方席位'; return; }
    drSend.disabled=true;
    api('POST','/api/tables/'+view.tableId+'/my/data-request',{
      reqId:'dr_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),
      text:text, title:title||undefined, toSeat:to
    }).then(function(){ toast('索要已发起，提供方将按其声明规则处置'); document.getElementById('drText').value=''; view.dirtyPanel=false; loadDetail(); })
      .catch(function(e){ drSend.disabled=false; errEl.textContent='发起失败：'+e.message; });
  };
  app.querySelectorAll('button.drRuleGo').forEach(function(b){
    b.onclick=function(){
      var ri=parseInt(b.getAttribute('data-ri'),10), dec=b.getAttribute('data-dec');
      var drs=(view.lastDetailData&&view.lastDetailData.dataRequests)||[];
      var r=drs[ri]; if(!r) return;
      var note=(document.getElementById('drNote'+ri)||{}).value||'';
      var errEl=document.getElementById('drRuleErr'+ri);
      if((dec==='partial'||dec==='rejected')&&!note.trim()){ if(errEl) errEl.textContent='部分给/拒绝必须填写说明（替代方案/理由）'; return; }
      b.disabled=true;
      api('POST','/api/tables/'+view.tableId+'/my/data-requests/'+encodeURIComponent(r.reqId)+'/ruling',{decision:dec,note:note.trim()||undefined})
        .then(function(){ toast('审批已提交：'+(DR_GRANT[dec]||dec)); view.dirtyPanel=false; loadDetail(); })
        .catch(function(e){ b.disabled=false; if(errEl) errEl.textContent='审批失败：'+e.message; });
    };
  });
  var finGo=document.getElementById('finGo');
  if(finGo) finGo.onclick=function(){
    var waived=(document.getElementById('finWaived')||{}).value||'';
    if(!window.confirm('确认接收并结束对接？将生成对接纪要并关闭本桌（不可恢复）。'+(waived.trim()?'将附带缺接收说明：「'+waived.trim()+'」':'')))
      return;
    api('POST','/api/tables/'+view.tableId+'/my/finish-relay',{waived:waived.trim()||undefined})
      .then(function(){ toast('对接已结束，纪要已生成'); view.dirtyPanel=false; loadDetail(); })
      .catch(function(e){ var el=document.getElementById('finErr'); if(el) el.textContent='结束失败：'+e.message; });
  };

  /* ---- 绑定：回合内并行调度面板（主持人 host） ---- */
  var pdSend=document.getElementById('pdSend');
  if(pdSend){
    pdSend.onclick=function(){
      var errEl=document.getElementById('pdErr'); errEl.textContent='';
      var ws=[]; document.querySelectorAll('.pdW:checked').forEach(function(c){ ws.push(c.value); });
      if(!ws.length){ errEl.textContent='至少勾选 1 个席位'; return; }
      var vis=document.querySelector('input[name="pdVis"]:checked');
      var payload={ workers:ws, visibility:(vis?vis.value:'open') };
      var task=document.getElementById('pdTask').value.trim(); if(task) payload.task=task;
      var note=document.getElementById('pdNote').value.trim(); if(note) payload.note=note;
      api('POST','/api/tables/'+view.tableId+'/my/message',{type:'PARALLEL_DISPATCH',payload:payload})
        .then(function(){ toast(ws.length>1?('并行批次已发起：'+ws.length+' 方同时执行'):('已点名 '+ws.length+' 个席位执行')); view.dirtyPanel=false; loadDetail(); })
        .catch(function(e){ errEl.textContent='发起失败：'+e.message; });
    };
  }
  document.querySelectorAll('.pdSkip').forEach(function(b){
    b.onclick=function(){
      var nm=b.getAttribute('data-name')||'该席位';
      if(!window.confirm('跳过 '+nm+' 在本批次的交付？该席本批次视为已处理（不可恢复）。')) return;
      api('POST','/api/tables/'+view.tableId+'/my/skip-turn',{seatId:b.getAttribute('data-sid'),reason:'主持人跳过本批次交付'})
        .then(function(){ toast('已跳过 '+nm+' 的本批次交付'); view.dirtyPanel=false; loadDetail(); })
        .catch(function(e){ toast('跳过失败：'+e.message); });
    };
  });

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

  /* ---- 绑定：移出席位（建桌人 / systemadmin：把参与方席位退席，其凭证立即失效） ---- */
  app.querySelectorAll('button.seatKick').forEach(function(b){
    b.onclick=function(){
      var name=b.getAttribute('data-name');
      if(!window.confirm('确认把「'+name+'」移出本桌？其席位将标记为已退席（不可撤销），席位凭证立即失效、该 agent 将无法继续参会；其持有人如需再次入桌须凭邀请码重新入席。')) return;
      b.disabled=true;
      api('POST','/api/tables/'+view.tableId+'/my/seat-leave',{seatId:b.getAttribute('data-sid')})
        .then(function(){ toast('已移出「'+name+'」'); view.dirtyPanel=false; loadDetail(); })
        .catch(function(e){ b.disabled=false; toast('移出失败：'+e.message); });
    };
  });

  /* ---- 绑定：左右侧切换（席位与立场 / 圆桌示意图 → chatbox 气泡归属；个人偏好，乐观更新 + 服务端保存） ---- */
  app.querySelectorAll('button.sideT').forEach(function(b){
    b.onclick=function(){
      var sid=b.getAttribute('data-sid');
      var next=b.getAttribute('data-cur')==='L'?'R':'L';
      var prev=view.chatSides[sid];
      var tid=view.tableId;
      view.chatSides[sid]=next;
      rerenderDetail();
      view.sidesSaving++;
      api('POST','/api/tables/'+tid+'/my/chat-sides',{chatSides:view.chatSides})
        .then(function(r){
          view.sidesSaving--;
          if(view.tableId!==tid) return; // 已切到别的桌：丢弃响应
          view.chatSides=(r&&r.chatSides)||view.chatSides;
          rerenderDetail();
        })
        .catch(function(e){
          view.sidesSaving--;
          if(view.tableId!==tid) return;
          if(prev===undefined) delete view.chatSides[sid]; else view.chatSides[sid]=prev;
          rerenderDetail();
          toast('左右侧保存失败：'+e.message);
        });
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
  var ctlSkip=document.getElementById('ctlSkip');
  if(ctlSkip) ctlSkip.onclick=function(){
    if(!window.confirm('确定跳过当前发言人？该席本轮发言/预审点名将被视为已处理，流程继续推进。')) return;
    api('POST','/api/tables/'+view.tableId+'/my/skip-turn',{})
      .then(function(){ toast('已跳过当前发言人'); view.dirtyPanel=false; loadDetail(); })
      .catch(function(e){ document.getElementById('ctlErr').textContent='跳过失败：'+e.message; });
  };
  var ctlPre=document.getElementById('ctlPre');
  if(ctlPre) ctlPre.onclick=function(){
    var enable=view.lastDetailData.table.precheckEnabled===false;
    api('POST','/api/tables/'+view.tableId+'/my/precheck',{enabled:enable})
      .then(function(){ toast(enable?'系统预审已开启':'系统预审已关闭'); view.dirtyPanel=false; loadDetail(); })
      .catch(function(e){ document.getElementById('ctlErr').textContent='设置失败：'+e.message; });
  };
  var stPre=document.getElementById('stPre');
  if(stPre) stPre.onclick=function(){
    var enable=view.lastDetailData.table.precheckEnabled===false;
    api('POST','/api/tables/'+view.tableId+'/my/precheck',{enabled:enable})
      .then(function(){ toast(enable?'系统预审已开启':'系统预审已关闭'); view.dirtyPanel=false; loadDetail(); })
      .catch(function(e){ document.getElementById('stErr').textContent='设置失败：'+e.message; });
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
  var admSkip=document.getElementById('admSkip');
  if(admSkip) admSkip.onclick=function(){
    if(!confirm('确定跳过当前发言人？该席本轮发言/预审点名将被视为已处理，流程继续推进。')) return;
    api('POST','/api/admin/tables/'+view.tableId+'/skip-turn',{reason:document.getElementById('admReason').value.trim()})
      .then(function(){ toast('已跳过当前发言人'); view.dirtyPanel=false; loadDetail(); })
      .catch(function(e){ toast('失败：'+e.message); });
  };
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
          hh+='<div class="row" style="margin:4px 0"><span class="rb '+esc(it.role)+'">'+esc(ROLE_LABEL[it.role]||it.role)+'</span>'
            +'<span class="invite">'+esc(it.code)+'</span><span class="dim">剩 '+it.usesLeft+' 次</span>'
            +'<button class="cpInv" data-code="'+esc(it.code)+'" data-role="'+esc(it.role)+'" data-uses="'+it.usesLeft+'">复制完整邀请</button></div>';
        });
        el.innerHTML=hh||'<span class="dim">无可用邀请码</span>';
        el.querySelectorAll('button.cpInv').forEach(function(b){
          b.onclick=function(){
            copyText(inviteText(t.topic,view.tableId,b.getAttribute('data-code'),b.getAttribute('data-role'),parseInt(b.getAttribute('data-uses'),10), t.tableType==='inquiry'&&t.mode==='self'));
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
    // 左右侧偏好：以本地为准的服务端同步——保存在途（乐观更新领先服务端）时不回灌，防轮询回滚
    if(!view.sidesSaving) view.chatSides=(d.chatSides||{});
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
function openTable(id,deepTab){
  view.mode='detail'; view.tableId=id; view.lastDetailJson=''; view.lastDetailData=null;
  view.dirtyPanel=false; view.cfgEditing=false; view.rtExpanded=false;
  view.chatFilter='all'; view.cmpType=''; view.seatOpen={}; view.chatAtBottom=true; view.cbPrevTop=0;
  view.chatSides={}; view.sidesSaving=0;
  view.uiTab=deepTab||null; view.maxSeenSeq=0; /* 左栏 tab：进桌默认（open=总览），#/table/<id>/<tab> 深链直达；新消息角标清零 */
  view.tlOpen=true; view.tlStick=true; view.tlModel=null; view.tlRun=[];
  if(!view.tlTimer) view.tlTimer=setInterval(tlTick,1000); /* 执行时序图：进行中节点每秒跳动（mode 守卫，全局一次） */
  clearInterval(view.timer);
  var want='#/table/'+id+(deepTab?('/'+deepTab):'');
  if(location.hash!==want) location.hash=want; // 详情页 URL（刷新/分享/后退可用）；先定好 view 再写 hash，hashchange→syncRoute 幂等不重入
  document.getElementById('app').innerHTML='<div class="card dim">加载圆桌 '+esc(id)+'…</div>';
  loadDetail();
  view.timer=setInterval(function(){ if(view.mode==='detail') loadDetail(); },5000);
}
function openList(){
  view.mode='list'; view.tableId=null; view.dirtyPanel=false;
  document.getElementById('app').className=''; /* 退出详情工作台：撤掉宽版与底部条预留 */
  clearInterval(view.timer);
  if((location.hash||'')!=='') history.pushState(null,'',location.pathname+location.search); // 清掉详情 hash（入历史栈，后退可回详情）
  document.title='智能体协同博弈平台 · agent-talk';
  loadList();
}

/* ---------- hash 路由：详情页 URL 直达（#/table/<id>）----------
   刷新/分享/前进后退均保持视图；未登录打开分享链时 hash 原样保留，登录成功后凭 hash 直达 */
function routeTableId(){ var m=/^#\/table\/([A-Za-z0-9_-]+)/.exec(location.hash||''); return m?m[1]:null; }
/* tab 深链：#/table/<id>/<tab>（ov/chat/proc/work/files/mgn…见 TAB_IDS）——分享/动作条深链直达指定视图 */
function routeTableTab(){ var m=/^#\/table\/[A-Za-z0-9_-]+\/(ov|chat|proc|work|files|mng)/.exec(location.hash||''); return m?m[1]:null; }
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
      if(tid) openTable(tid,routeTableTab());
      else if((location.hash||'')==='#/create'){ view.mode='create'; renderCreateForm(); }
      else openList();
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
  if((location.hash||'')==='#/create'){
    if(view.mode!=='create'){ view.mode='create'; document.title='创建圆桌 · agent-talk'; renderCreateForm(); }
    return;
  }
  if(view.mode==='create'){ openList(); return; }
  var id=routeTableId();
  if(id){
    if(!(view.mode==='detail'&&view.tableId===id)) openTable(id,routeTableTab());
    else { var ht=routeTableTab(); if(ht&&ht!==view.uiTab) switchDtTab(ht); } /* 同桌 hash 变化 = tab 深链切换 */
  }
  else if(view.mode==='detail') openList();
}
window.addEventListener('hashchange',syncRoute);
window.addEventListener('popstate',syncRoute);
window.addEventListener('resize',function(){ if(view.mode==='detail') placeDtBar(); });

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
    if(tid) openTable(tid,routeTableTab()); // 刷新/分享链直达详情（含 tab 深链）
    else if((location.hash||'')==='#/create'){ view.mode='create'; renderCreateForm(); }
    else openList();
  })
    .catch(function(){ toast('已保存的 token 失效，请重新连接'); });
}
else { renderIntro(); }
`;
