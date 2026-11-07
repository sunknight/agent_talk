/* 详情页部件段（一）：圆桌示意图/并行调度/执行时序图及其节点弹窗与跳动 — <script> 第二段。 */
export const OBSERVER_JS_DETAIL_WIDGETS = String.raw`function roundDiagramHtml(d,seats,turn,isAsker){
  /* 问询桌：问询方以伪席位入环（不占席位；自建问询桌 ownerSeat='asker' 会自然带上建桌人★） */
  var parts=seats.slice();
  if(d.asker) parts.unshift({seatId:'asker',name:d.asker.name,role:'asker',config:null,agentLabel:'',joinedAt:0});
  if(!parts.length) return '';
  var t=d.table;
  var lastOf={};
  (d.messages||[]).forEach(function(m){ if(m.fromSeat&&m.fromSeat!=='server') lastOf[m.fromSeat]=m; });
  var turnId=turn?turn.seatId:null;
  /* 并行执行期：本轮全部未交付执行方同时持权（多节点高亮 + 各自思考进度） */
  var parTurns=(t.parallelDispatch&&t.activeTurns)||[];
  var parTurnMap={}; parTurns.forEach(function(x){ parTurnMap[x.seatId]=x; });
  function wpStageOf(sid){ var w=(t.workerProgress||[]).filter(function(x){ return x.seatId===sid; })[0]; return turnStageLabel(w?{stage:w.stage}:null); }
  var hasTurn=function(sid){ return sid===turnId||!!parTurnMap[sid]; };
  /* 环上优先级：发言权持有者 > 建桌人 > 最近发言（新→旧）> 从未发言（入席序） */
  var sorted=parts.slice().sort(function(a,b){
    var ka=hasTurn(a.seatId)?0:((a.seatId===t.ownerSeat)?1:2);
    var kb=hasTurn(b.seatId)?0:((b.seatId===t.ownerSeat)?1:2);
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
      ?('共 '+parts.length+' 方 · 九宫格方位优先显示发言权/建桌人/最近发言的前 '+(RING_MAX-1)+' 方')
      :(parts.length+' 方全员就座'))
    +'</span><span class="sp"></span>'
    +'<span class="dim lgd"><i class="proposer">●</i>提案方<i class="reviewer">●</i>评审方<i class="collaborator">●</i>协作者<i class="host">●</i>主持人<i class="observer">●</i>观察方'
    +(ttOf(t.tableType).flow==='inquiry'?'<i class="answerer">●</i>回答方<i class="asker">●</i>问询方':'')
    +'<i class="off">◌</i>已断开'
    +'<span>· 思考进度 = 当前发言权 · ◌已断开 = 超过5分钟无访问 · 节点「左/右」= 会话区归属</span></span></div>'
    +'<div class="rt-wrap"><div class="rt-stage" style="height:'+STAGE_H+'px">'
    +'<div class="rt-ell"></div>'
    +'<div class="rt-center"><div class="rt-topic">'+esc(clipStr(t.topic,18))+'</div>'
    +'<div style="margin:4px 0">'+phaseBadge(t.phase,t.roundNo,t.tableType)+'</div>';
  if(turn){
    var tSeat=null; for(var k=0;k<seats.length;k++){ if(seats[k].seatId===turn.seatId) tSeat=seats[k]; }
    h+='<div class="rt-turn">'+esc(seatName(seats,turn.seatId))+' '+((tSeat&&seatOff(tSeat,t))?'<span class="rt-off">已断开</span>':turnStageLabel(t.turnProgress))+'</div>'
      +'<div class="dim xs">'+esc(clipStr(turn.taskHint,26))+'</div>';
  }
  else if(parTurns.length){
    h+='<div class="rt-turn">并行执行 '+parTurns.length+' 方</div>'
      +'<div class="dim xs">'+esc(clipStr(parTurns[0].taskHint||'',26))+'</div>';
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
    var dl=lm?di.label:(s.role==='asker'?'尚未提问':(t.phase==='open'?(((s.config&&s.config.ready)?'已就绪':'未就绪')):'尚未发言'));
    var off=seatOff(s,t);
    var think=hasTurn(s.seatId)&&!off;
    var stageLbl=parTurnMap[s.seatId]?wpStageOf(s.seatId):turnStageLabel(t.turnProgress);
    var byline=s.role==='asker'?'网页提问':('agent: '+s.agentLabel);
    h+='<div class="rt-node'+(off?' off':'')+(think?' think':'')+'" style="left:'+Math.round(x)+'px;top:'+Math.round(y)+'px"'
      +' title="'+escAttr(s.name+'（'+(ROLE_LABEL[s.role]||s.role)+' · '+byline+'）'+(lm?('｜最后交付：'+di.full+'（'+fmtTs(lm.ts)+'）'):(s.role==='asker'?'（尚未提问）':'（尚未发言）'))+(off?('｜已断开（最后在线 '+fmtTs(s.lastSeenAt||s.joinedAt)+'）'):''))+'">'
      +'<div class="rt-card '+esc(s.role)+'">'
      +'<div class="rt-nm">'+esc(s.name)+(s.seatId===t.ownerSeat?' <span class="rt-owner" title="建桌人">★</span>':'')+'</div>'
      +'<div class="rt-tags">'+roleBadge(s.role)+(off?'<span class="rt-off">◌ 已断开</span>':(think?'<span class="rt-think">● '+stageLbl+'</span>':''))+sideToggleHtml(s.seatId,d,isAsker)+'</div>'
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
      var dl=lm?(di.label+' · '+fmtTs(lm.ts)):(s.role==='asker'?'尚未提问':(t.phase==='open'?(((s.config&&s.config.ready)?'已就绪':'未就绪')):'尚未发言'));
      h+='<div class="row" style="margin:4px 0"><b>'+esc(s.name)+'</b>'+roleBadge(s.role)
        +(s.seatId===t.ownerSeat?'<span class="badge">建桌人</span>':'')
        +(seatOff(s,t)?'<span class="rt-off">◌ 已断开</span>':'')
        +'<span class="dim">'+esc(dl)+'</span>'+sideToggleHtml(s.seatId,d,isAsker)+'</div>';
    });
    h+='<div class="row" style="margin-top:6px"><button id="rtFold" class="fbtn on">收起其余席位</button></div></div>';
  }
  h+='</div>';
  return h;
}

/* ---------- 回合内并行调度面板（主持人 host 专用：总-分-总） ----------
   调度期（无活跃批次）：勾选当前阶段可轮换的未发言席位（服务端 t.pendingSpeakers），发起并行批次或点名单个；
   执行期（活跃批次 t.parallelDispatch）：批次看板（每席 已交付/进行中+思考进度/已跳过 + 逐席跳过），
   批次全员交付/跳过即汇聚（服务端广播 INFO），回默认顺序轮转。 */
var PD_PHASES={statements:1,review:1,response:1,convergence:1};
function parallelCtlHtml(d,seats,t){
  var h='<div class="card" id="parCtl"><div class="shead"><b>并行调度</b><span class="dim">主持人 · 回合内并行（总-分-总）</span></div>';
  if(t.pause){ h+='<div class="banner warn" style="margin:8px 0">会议已暂停：并行调度 / 跳过 / 汇聚在继续会议后可用。</div></div>'; return h; }
  if(!PD_PHASES[t.phase]){ h+='<div class="dim" style="margin:8px 0">当前阶段（'+esc(phaseLabel(t.tableType,t.phase))+'）不支持并行调度：仅陈述/评审/回应/表决等轮换阶段可用。</div></div>'; return h; }
  var batch=t.parallelDispatch;
  if(!batch){
    var cands=(t.pendingSpeakers||[]).map(function(sid){
      for(var i=0;i<seats.length;i++){ if(seats[i].seatId===sid) return seats[i]; }
      return null;
    }).filter(function(s){ return s; });
    if(!cands.length){ h+='<div class="dim" style="margin:8px 0">本阶段已无可调度的未发言席位（或已轮空）。</div></div>'; return h; }
    h+='<div class="section"><h3>发起并行批次</h3>'
      +'<div class="dim" style="margin-bottom:6px">勾选的席位将<b>同时</b>获得发言权各自独立执行本阶段任务（勾 1 个=点名单个），全员交付（或跳过）后汇聚回顺序轮转。</div>'
      +'<div class="frow"><label class="t">执行方 <b>*</b></label><div class="cchoice">'
      +cands.map(function(s){
        return '<label><input type="checkbox" class="pdW" value="'+escAttr(s.seatId)+'"'+(cands.length===1?' checked':'')+'> '+esc(s.name)+' '+roleBadge(s.role)+'</label>';
      }).join('')
      +'</div></div>'
      +'<div class="frow"><label class="t">调度任务（选填）</label><textarea id="pdTask" placeholder="叠加在本阶段任务之上的额外指引（如统一评审口径/各自负责的题目），随发言权下发"></textarea></div>'
      +'<div class="frow"><label class="t">结果互见</label><div class="cchoice">'
      +'<label><input type="radio" name="pdVis" value="open" checked> 公开——交付即广播（收集/头脑风暴场景）</label>'
      +'<label><input type="radio" name="pdVis" value="blind"> 盲评——批次成员互不可见，汇聚后放开（独立评审/考试防干扰）</label>'
      +'</div></div>'
      +'<div class="frow"><label class="t">调度备注（选填）</label><input id="pdNote" placeholder="验收口径 / 补充说明，随任务广播"></div>'
      +'<div class="ferr" id="pdErr"></div>'
      +'<div class="row"><button id="pdSend" class="primary">▶ 发起并行批次</button>'
      +'<span class="dim">批次汇聚后可再调度剩余席位或让流程按原顺序轮转推进</span></div></div>';
  } else {
    var wp={}; (t.workerProgress||[]).forEach(function(x){ wp[x.seatId]=x.stage; });
    var skipMap={};
    (d.messages||[]).forEach(function(m){
      if(m.type==='TURN_SKIPPED'&&m.payload&&m.payload.phase===batch.phase&&m.payload.roundNo===batch.roundNo) skipMap[m.payload.seatId]=1;
    });
    h+='<div class="section"><h3>第 '+batch.roundNo+' 轮 · '+esc(phaseLabel(t.tableType,batch.phase))+' · 批次看板</h3>'
      +'<div class="dim" style="margin-bottom:6px">'+(batch.task?('任务：'+esc(batch.task.slice(0,120))+'｜'):'')+'可见性：'+(batch.visibility==='blind'?'盲评（批次内互不可见，汇聚后放开）':'公开')+'</div>';
    batch.workers.forEach(function(sid){
      var nm=seatName(seats,sid);
      var st,skipBtn='';
      if(batch.submitted.indexOf(sid)>=0) st='<span class="badge ok">已交付</span>';
      else if(skipMap[sid]) st='<span class="badge">已跳过</span>';
      else { st='<span class="badge warn">进行中'+(wp[sid]?(' · '+({preparing:'准备中',working:'处理中',finalizing:'即将提交'}[wp[sid]]||wp[sid])):'')+'）</span>';
        skipBtn=' <button class="pdSkip sm" data-sid="'+escAttr(sid)+'" data-name="'+escAttr(nm)+'">跳过</button>'; }
      h+='<div class="kv"><span class="k">'+esc(nm)+'</span>'+st+skipBtn+'</div>';
    });
    h+='<div class="dim" style="margin-top:6px">全员交付（或跳过）后批次汇聚、结果汇总为整体，回默认顺序轮转；滞留席位可逐个跳过。</div></div>';
  }
  h+='</div>';
  return h;
}

/* ---------- 执行时序图（左栏会话上方）：纵向时序 DAG——时间从上到下 ----------
   布局：每 agent 一列（固定 x 坐标，列头 sticky；>8 个 agent 按角色分组加组头条），节点=列上的卡片
   （任务+时长+简要结果，点击弹详情），卡片间画箭头链（串行 hand-off）；并行批次=分派卡 fan-out 到
   多列并列成员卡、全员交付/跳过后 fan-in 到「批次汇聚 ◇」虚拟汇总卡；进行中卡脉冲+已执行时长每秒跳动。
   数据：纯客户端从消息流推导（发言权不落库，先例 deriveTimeline 自身）——
   已完成节点 start=同阶段上一推进事件时刻（上一交付/预审/跳过/阶段变更），并行批次成员 start=分派时刻，
   批次全员交付/跳过即汇聚（回合内并行扩展：总-分-总，无独立收束消息）。 */
var TL_SPEECH={STATEMENT:1,REVIEW_COMMENT:1,RESPONSE:1,SUPPLEMENT:1,CONSENSUS_VOTE:1,QUESTION:1,REPLY:1,REQUEST:1,RESPOND_REQUEST:1,HUMAN_INPUT:1,ESCALATE:1,DIRECTIVE:1,DIRECTIVE_RESULT:1,DIRECTIVE_CLARIFY:1,DATA_REQUEST:1,DATA_RESULT:1,DATA_GRANT:1};
var TL_TASK={statements:'交付陈述',review:'评审意见',response:'回应评审',execution:'处置请求',convergence:'共识表决',qa:'回答',working:'执行指令',human_intervention:'人工介入'};
var TL_COL_MAX=8, TL_MIN_COL_W=126, TL_CARD_H=56, TL_VGAP=14, TL_SEP_H=26, TL_MS_H=32, TL_RAIL_W=24, TL_HEAD_H=26, TL_GROUP_H=20;
var TL_ROLE_COLOR={proposer:'var(--acc)',reviewer:'var(--ok)',collaborator:'var(--vote)',host:'var(--goldline)',observer:'var(--dim)',answerer:'var(--ok)',asker:'var(--acc)'};
var TL_ROLE_GROUP_ORDER=['proposer','reviewer','collaborator','answerer','asker','host','observer'];
function fmtDur(ms){
  if(!(ms>=0)) ms=0;
  var s=Math.floor(ms/1000);
  if(s<60) return s+' 秒';
  var m=Math.floor(s/60);
  if(m<60) return (s%60?(m+' 分 '+s%60+' 秒'):(m+' 分钟'));
  return Math.floor(m/60)+' 小时 '+((m%60)?((m%60)+' 分'):'');
}
function fmtClock(ts){ var d=new Date(ts); function p(n){return n<10?'0'+n:''+n;} return p(d.getHours())+':'+p(d.getMinutes()); }
/** 消息流 → 时序模型：节点（已完成/跳过/进行中）/ 轴标记（预审/暂停/纪要）/ 阶段带（纵向渲染的分行依据） */
function deriveTimeline(d,seats,t){
  var msgs=(d.messages||[]);
  var lanes=seats.map(function(s){ return {seatId:s.seatId,name:s.name,role:s.role}; });
  if(d.asker) lanes.unshift({seatId:'asker',name:d.asker.name,role:'asker'});
  var nodes=[],marks=[],bands=[];
  var started=false,phase='open',floor=0,grp=null,batchNo=0;
  function closeGrp(atTs){
    if(!grp) return;
    if(grp.done+grp.skip>0) marks.push({ts:(grp.endTs||atTs),kind:'milestone',label:'批次汇聚 · '+grp.done+' 方交付'+(grp.skip?(' · '+grp.skip+' 跳过'):''),grp:grp});
    grp=null;
  }
  msgs.forEach(function(m){
    var p=m.payload||{};
    if(m.type==='PHASE_CHANGE'){
      closeGrp(m.ts); /* 批次未走完即换阶段（跳过收尾）：按已交付部分汇聚 */
      if(!started&&p.to!=='open') started=true;
      if(p.to!=='open') bands.push({phase:p.to,ts:m.ts});
      if(started) marks.push({ts:m.ts,kind:'phase',label:phaseLabel(t.tableType,p.to)});
      phase=p.to; floor=m.ts; return;
    }
    if(!started) return; /* 设定期不入图 */
    if(m.type==='HOST_PREREVIEW'){ marks.push({ts:m.ts,kind:'precheck',label:(PRV_LABEL[p.verdict]||'预审')}); floor=m.ts; return; }
    if(m.type==='TURN_SKIPPED'){
      var skipGrp=(grp&&grp.workers.indexOf(p.seatId)>=0)?grp:null;
      if(skipGrp){ skipGrp.delivered[p.seatId]=1; skipGrp.skip++; skipGrp.endTs=Math.max(skipGrp.endTs||0,m.ts); }
      nodes.push({kind:'skip',seatId:p.seatId,start:(skipGrp?skipGrp.dispatchTs:floor),end:m.ts,type:m.type,msg:m,phase:(p.phase||phase),grp:skipGrp});
      floor=m.ts;
      if(grp&&grp.done+grp.skip>=grp.workers.length) closeGrp(m.ts);
      return;
    }
    if(m.type==='MEETING_PAUSED'||m.type==='MEETING_RESUMED'||m.type==='PAUSE_REQUESTED'){
      marks.push({ts:m.ts,kind:'pause',label:(m.type==='MEETING_PAUSED'?'暂停':(m.type==='MEETING_RESUMED'?'继续':'申请暂停'))});
      floor=m.ts; return;
    }
    if(m.type==='MINUTES'||m.type==='CONSENSUS_RESULT'){ marks.push({ts:m.ts,kind:'note',label:(m.type==='MINUTES'?'纪要':'表决结果')}); return; }
    if(m.type==='PARALLEL_DISPATCH'){
      batchNo++;
      nodes.push({kind:'done',seatId:m.fromSeat,start:floor,end:m.ts,type:m.type,msg:m,phase:phase});
      grp={ord:batchNo,dispatchTs:m.ts,workers:(p.workers||[]).slice(),delivered:{},endTs:null,done:0,skip:0,task:(p.task||''),blind:(p.visibility==='blind')};
      floor=m.ts; return;
    }
    if(TL_SPEECH[m.type]&&m.fromSeat&&m.fromSeat!=='server'){
      var inGrp=(grp&&grp.workers.indexOf(m.fromSeat)>=0&&!grp.delivered[m.fromSeat])?grp:null;
      nodes.push({kind:'done',seatId:m.fromSeat,start:(inGrp?inGrp.dispatchTs:floor),end:m.ts,type:m.type,msg:m,phase:phase,grp:inGrp});
      if(inGrp){ inGrp.delivered[m.fromSeat]=1; inGrp.done++; inGrp.endTs=Math.max(inGrp.endTs||0,m.ts); }
      floor=m.ts;
      if(grp&&grp.done+grp.skip>=grp.workers.length) closeGrp(m.ts);
    }
    /* 其余系统回显（入席/产物/资料等）不占泳道也不推进 floor */
  });
  var now=Date.now();
  /* 进行中节点：活跃并行批次=未交付成员各自一条（start=分派时刻，grp 关联供 fan-out 连线）；否则单发言权 */
  if(t.phase!=='closed'&&!t.pause){
    var pd=t.parallelDispatch;
    if(pd&&(t.activeTurns||[]).length){
      var pdTs=null;
      msgs.forEach(function(m){ if(m.type==='PARALLEL_DISPATCH'&&m.msgId===pd.msgId) pdTs=m.ts; });
      var pdGrp=(grp&&pdTs&&grp.dispatchTs===pdTs)?grp:null;
      (t.activeTurns||[]).forEach(function(g){
        var wp=(t.workerProgress||[]).filter(function(x){ return x.seatId===g.seatId; })[0];
        nodes.push({kind:'run',seatId:g.seatId,start:(pdTs||floor),end:null,type:'STATEMENT',phase:t.phase,batch:true,grp:pdGrp,stage:(wp?wp.stage:null)});
      });
    } else if(t.activeTurn){
      nodes.push({kind:'run',seatId:t.activeTurn.seatId,start:floor,end:null,type:'STATEMENT',phase:t.phase,stage:(t.turnProgress&&t.turnProgress.stage)});
    }
  }
  /* 纵向渲染不做时间比例尺：节点按完成顺序分行堆叠，时长写在卡片内（参考用户给的 DAG 截图形态） */
  return { lanes:lanes,nodes:nodes,marks:marks,bands:bands,started:started,now:now };
}
function timelineCardHtml(d,seats,t){
  /* 可用画布宽：从已渲染的 tab 内容区测（首轮渲染前无 DOM 用 640 兜底，后续轮询自然校正） */
  var avail=640, dm=document.querySelector('.dt-main');
  if(dm&&dm.clientWidth) avail=Math.max(320,dm.clientWidth-36);
  var m=deriveTimeline(d,seats,t);
  if(!m.started) return '';
  view.tlModel=m;
  view.tlRun=[];
  var lanes=m.lanes, n=lanes.length;
  var grouped=n>TL_COL_MAX; /* agent 多时按角色分组列（组内连续 + 组头条） */
  var laneIdx={}; lanes.forEach(function(l,i){ laneIdx[l.seatId]=i; });
  var groups=[];
  if(grouped){
    var seen={},rest=[];
    TL_ROLE_GROUP_ORDER.forEach(function(r){
      var idxs=[]; lanes.forEach(function(l,i){ if(l.role===r) idxs.push(i); });
      if(idxs.length){ groups.push({role:r,idxs:idxs}); seen[r]=1; }
    });
    lanes.forEach(function(l,i){ if(!seen[l.role]) rest.push(i); });
    if(rest.length) groups.push({role:'',idxs:rest});
  } else groups.push({role:'',idxs:lanes.map(function(l,i){ return i; })});
  var colW=Math.max(TL_MIN_COL_W,Math.floor((avail-TL_RAIL_W)/n));
  var W=TL_RAIL_W+n*colW, cardW=colW-14;
  function colX(i){ return TL_RAIL_W+i*colW; }
  function colCx(i){ return TL_RAIL_W+i*colW+colW/2; }
  var runN=m.nodes.filter(function(nd){ return nd.kind==='run'; }).length;
  var h='<div class="card" id="tlCard"><div class="shead"><b>执行时序</b><span class="dim">时间从上到下 · 点击节点看详情</span><span class="sp"></span>'
    +'<span class="dim xs">◇ 批次汇聚 · ◉ 预审 · ⏸ 暂停</span>'
    +'<button id="tlFold" class="fbtn'+(view.tlOpen===false?'':' on')+'">'+(view.tlOpen===false?'展开':'收起')+'</button></div>';
  if(view.tlOpen===false){
    var lastDone=m.nodes.filter(function(nd){ return nd.kind!=='run'; }).pop();
    h+='<div class="dim" style="margin-top:8px">'
      +(lastDone?('已完成 '+m.nodes.filter(function(nd){ return nd.kind==='done'; }).length+' 步 · 最近：'+esc(seatName(seats,lastDone.seatId))+' '+esc(MT_LABEL[lastDone.type]||lastDone.type)+'（'+fmtTs(lastDone.end)+'）'):'尚无执行记录')
      +(runN?(' · 进行中 '+runN+' 方'):'')+' · 点「展开」查看时序图</div></div>';
    return h;
  }
  /* 渲染序列：节点按事件序分行；阶段变更插通栏分隔行；批次闭合插「批次汇聚」虚拟汇总卡 */
  var items=[],curPhase=null,emitted={},openG=null,bandIdx=0;
  function pushMs(g){ if(!g||emitted[g.ord]) return; emitted[g.ord]=1; items.push({kind:'ms',grp:g}); openG=null; }
  m.nodes.forEach(function(nd,ni){
    var ph=nd.phase||'review';
    if(ph!==curPhase){
      pushMs(openG); /* 批次未走完即换阶段：按已交付部分先汇聚 */
      var bb=null;
      for(var bi=bandIdx;bi<m.bands.length;bi++){ if(m.bands[bi].phase===ph){ bb=m.bands[bi]; bandIdx=bi+1; break; } }
      items.push({kind:'ph',phase:ph,ts:bb?bb.ts:null});
      curPhase=ph;
    }
    items.push({kind:nd.kind,nd:nd,ni:ni});
    if(nd.grp){ openG=nd.grp;
      if(nd.grp.done+nd.grp.skip>=nd.grp.workers.length) pushMs(nd.grp);
    }
  });
  pushMs(openG);
  if(!items.length){
    h+='<div class="dim" style="margin-top:8px">会议已开始，尚无执行记录。</div></div>';
    return h;
  }
  /* 逐项分行（y 堆叠） */
  var y=8, ii;
  for(ii=0;ii<items.length;ii++){
    items[ii].y=y;
    y+=(items[ii].kind==='ph')?TL_SEP_H:((items[ii].kind==='ms')?(TL_MS_H+TL_VGAP):(TL_CARD_H+TL_VGAP));
  }
  var H=y+2;
  /* 表头（HTML，sticky 抗纵向滚动；组头条 + agent 列头）+ SVG 画布 */
  h+='<div class="tl-scroll" id="tlScroll"><div class="tl-inner" style="width:'+W+'px">';
  if(grouped){
    h+='<div class="tl-grow"><div class="tl-gsp"></div>';
    groups.forEach(function(g){
      h+='<div class="tl-gcell" style="width:'+(g.idxs.length*colW)+'px">'+esc((ROLE_LABEL[g.role]||g.role||'其他')+' · '+g.idxs.length)+'</div>';
    });
    h+='</div>';
  }
  h+='<div class="tl-hrow"'+(grouped?(' style="top:'+TL_GROUP_H+'px"'):'')+'><div class="tl-gsp" style="flex:0 0 '+TL_RAIL_W+'px"></div>';
  lanes.forEach(function(l){
    h+='<div class="tl-colhead" style="width:'+colW+'px" title="'+escAttr(l.name+'（'+(ROLE_LABEL[l.role]||l.role)+'）')+'">'
      +'<span class="dot" style="background:'+(TL_ROLE_COLOR[l.role]||'var(--dim)')+'"></span><b>'+esc(clipStr(l.name,9))+'</b></div>';
  });
  h+='</div><svg class="tl-svg" width="'+W+'" height="'+H+'" font-size="11" xmlns="http://www.w3.org/2000/svg">'
    +'<defs><marker id="tlArrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--faint)"/></marker></defs>';
  /* 列生命线（细虚线竖线：agent 固定 x 坐标的纵向轨道） */
  for(var li=0;li<n;li++){
    h+='<line x1="'+colCx(li)+'" y1="0" x2="'+colCx(li)+'" y2="'+H+'" stroke="var(--line)" stroke-dasharray="2 4"/>';
  }
  /* 阶段分隔行：通栏虚线 + 居中标签 */
  items.forEach(function(it){
    if(it.kind!=='ph') return;
    var ly=it.y+TL_SEP_H-9;
    h+='<line x1="'+TL_RAIL_W+'" y1="'+ly+'" x2="'+W+'" y2="'+ly+'" stroke="var(--line)" stroke-dasharray="3 4"/>'
      +'<text x="'+((W+TL_RAIL_W)/2)+'" y="'+(ly-4)+'" text-anchor="middle" fill="var(--dim)">'+esc('— '+phaseLabel(t.tableType,it.phase)+(it.ts?(' · '+fmtClock(it.ts)):'')+' —')+'</text>';
  });
  /* 箭头链（画在卡片下层）：串行 hand-off 相邻相连；并行=分派 fan-out / 成员 fan-in 汇聚卡 / 汇聚卡续链。
     目标锚点按连线方向适配：同列→顶部中心；目标在源右侧→左缘垂直中心；在左侧→右缘垂直中心（跨列时垂直间隔小，接侧缘更清晰） */
  function msMid(it){
    var g=it.grp,mn=1e9,mx=-1e9;
    g.workers.forEach(function(sid){ var ix=laneIdx[sid]; if(ix!=null){ mn=Math.min(mn,colCx(ix)); mx=Math.max(mx,colCx(ix)); } });
    if(mx<0) mn=mx=TL_RAIL_W;
    return { x:(mn+mx)/2, y:it.y+TL_MS_H/2 };
  }
  /** 普通卡目标锚点（列 ix、顶 y）：fromX=源锚点 x（前节点下部中心） */
  function dstAnchor(ix,ty,fromX){
    var tcx=colCx(ix), l=colX(ix)+7;
    if(Math.abs(fromX-tcx)<0.6) return {x:tcx,y:ty};
    return (fromX<tcx)?{x:l,y:ty+TL_CARD_H/2}:{x:l+cardW,y:ty+TL_CARD_H/2};
  }
  /** 汇聚卡（虚拟汇总卡，宽 cw 居中 mid.x）同规则 */
  function msAnchor(mid,cw0,ty,fromX){
    if(Math.abs(fromX-mid.x)<0.6) return {x:mid.x,y:ty};
    return (fromX<mid.x)?{x:mid.x-cw0/2,y:ty+TL_MS_H/2}:{x:mid.x+cw0/2,y:ty+TL_MS_H/2};
  }
  function arrow(x1,y1,x2,y2){
    h+='<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" stroke="var(--faint)" stroke-width="1.2" opacity=".65" marker-end="url(#tlArrow)"/>';
  }
  var src=null;
  items.forEach(function(it,ix){
    if(it.kind==='ph'){ src=null; return; }
    if(it.kind==='ms'){
      var mid=msMid(it), cw0=Math.min(230,W-TL_RAIL_W-8);
      for(var k=ix-1;k>=0;k--){
        var pk=items[k];
        if(pk.kind!=='done'&&pk.kind!=='skip') continue;
        if(pk.nd&&pk.nd.grp===it.grp&&laneIdx[pk.nd.seatId]!=null){
          var fx=colCx(laneIdx[pk.nd.seatId]), fa=msAnchor(mid,cw0,it.y,fx);
          arrow(fx,pk.y+TL_CARD_H,fa.x,fa.y);
        }
      }
      src={x:mid.x,y:it.y+TL_MS_H};
      return;
    }
    var nd=it.nd, cx=(laneIdx[nd.seatId]!=null)?colCx(laneIdx[nd.seatId]):null;
    if(cx==null) return;
    if(nd.type==='PARALLEL_DISPATCH'){
      if(src){ var da=dstAnchor(laneIdx[nd.seatId],it.y,src.x); arrow(src.x,src.y,da.x,da.y); }
      for(var j2=ix+1;j2<items.length;j2++){
        var pj=items[j2];
        if(pj.kind==='ph'||pj.kind==='ms') continue;
        if(pj.nd&&pj.nd.grp&&pj.nd.grp.dispatchTs===nd.end&&laneIdx[pj.nd.seatId]!=null){
          var fo=dstAnchor(laneIdx[pj.nd.seatId],pj.y,cx);
          arrow(cx,it.y+TL_CARD_H,fo.x,fo.y);
        }
      }
      src=null;
      return;
    }
    if(nd.grp){ src=null; return; } /* 批次成员：入箭头来自分派、出箭头去汇聚，不接常规链 */
    if(src){ var ta=dstAnchor(laneIdx[nd.seatId],it.y,src.x); arrow(src.x,src.y,ta.x,ta.y); }
    src={x:cx,y:it.y+TL_CARD_H};
  });
  /* 节点卡片（agent 名在列头，卡内=任务+时长+简要结果+时刻） */
  items.forEach(function(it){
    if(it.kind==='ph') return;
    if(it.kind==='ms'){
      var g=it.grp, mid=msMid(it), cw=Math.min(230,W-TL_RAIL_W-8);
      var dur=(g.endTs&&g.dispatchTs)?fmtDur(g.endTs-g.dispatchTs):'';
      var lab='◇ 第 '+g.ord+' 批汇聚 · '+g.done+' 方交付'+(g.skip?(' · '+g.skip+' 跳过'):'')+(dur?(' · 总时长 '+dur):'');
      h+='<g class="tl-ms"><rect x="'+(mid.x-cw/2)+'" y="'+it.y+'" width="'+cw+'" height="'+TL_MS_H+'" rx="6" fill="var(--gold-bg)" stroke="var(--gold)" stroke-dasharray="5 3" opacity=".95"/>'
        +'<title>'+esc('并行批次虚拟汇总节点：'+lab+(g.task?('\n批次任务：'+clipStr(g.task,120)):''))+'</title>'
        +'<text x="'+mid.x+'" y="'+(it.y+TL_MS_H/2+4)+'" text-anchor="middle" fill="var(--gold)">'+esc(clipStr(lab,Math.floor(cw/11)))+'</text></g>';
      return;
    }
    var nd=it.nd, ni=it.ni;
    var ix2=laneIdx[nd.seatId];
    if(ix2==null) return;
    var cx0=colX(ix2)+7, cy=it.y;
    var col=TL_ROLE_COLOR[seatRoleOf(seats,nd.seatId)]||'var(--acc)';
    if(it.kind==='run'){
      var rid=view.tlRun.length;
      var runTask=nd.batch?'并行交付':(TL_TASK[nd.phase]||'执行中');
      view.tlRun.push({txtId:'tlrt'+rid,start:nd.start,task:runTask,stage:(nd.stage?turnStageLabel({stage:nd.stage}):'')});
      h+='<g class="tl-run"><rect class="tl-box" x="'+cx0+'" y="'+cy+'" width="'+cardW+'" height="'+TL_CARD_H+'" rx="6" fill="var(--acc-bg)" stroke="var(--acc)" stroke-dasharray="5 3"/>'
        +'<rect x="'+cx0+'" y="'+cy+'" width="3" height="'+TL_CARD_H+'" fill="'+col+'"/>'
        +'<title>'+esc(seatName(seats,nd.seatId)+' 正在'+runTask+' · 思考进度 '+(nd.stage?turnStageLabel({stage:nd.stage}):'思考中'))+'</title>'
        +'<text id="tlrt'+rid+'" x="'+(cx0+10)+'" y="'+(cy+20)+'" fill="var(--acc)" font-weight="600">'+esc(runTask+' · 已执行 '+fmtDur(m.now-nd.start)+(nd.stage?(' · '+turnStageLabel({stage:nd.stage})):''))+'</text>'
        +'<text x="'+(cx0+10)+'" y="'+(cy+39)+'" fill="var(--dim)">尚未交付 · 已执行时长每秒跳动</text></g>';
    } else {
      var brief=(nd.msg?msgBodyText(nd.msg,seats):'');
      var task=(it.kind==='skip'?'跳过发言':(MT_LABEL[nd.type]||TL_TASK[nd.phase]||'执行'));
      var dur2=(nd.end!=null&&nd.start!=null)?fmtDur(nd.end-nd.start):'';
      var clipN=Math.max(8,Math.floor((cardW-16)/11.5));
      h+='<g class="tl-node" data-tln="'+ni+'">'
        +'<rect class="tl-box" x="'+cx0+'" y="'+cy+'" width="'+cardW+'" height="'+TL_CARD_H+'" rx="6" fill="var(--panel-2)" stroke="'+(it.kind==='skip'?'var(--line-2)':'var(--line)')+'"'+(it.kind==='skip'?' stroke-dasharray="4 3"':'')+'/>'
        +'<rect x="'+cx0+'" y="'+cy+'" width="3" height="'+TL_CARD_H+'" fill="'+col+'"/>'
        +'<title>'+esc(seatName(seats,nd.seatId)+' · '+task+(brief?('\n'+clipStr(brief,200)):''))+'</title>'
        +'<text x="'+(cx0+10)+'" y="'+(cy+20)+'" font-weight="600" fill="'+(it.kind==='skip'?'var(--dim)':'var(--fg)')+'">'+esc(task)+'</text>'
        +'<text x="'+(cx0+cardW-8)+'" y="'+(cy+20)+'" text-anchor="end" fill="'+col+'">'+esc(dur2)+'</text>'
        +'<text x="'+(cx0+10)+'" y="'+(cy+38)+'" fill="var(--dim)">'+esc(clipStr(brief,clipN))+'</text>'
        +'<text x="'+(cx0+10)+'" y="'+(cy+50)+'" font-size="9.5" fill="var(--faint)">'+esc((nd.end!=null?fmtTs(nd.end):'')+(nd.msg?(' · #'+nd.msg.seq):''))+'</text>'
        +'</g>';
    }
  });
  /* 左缘轨道小标记：预审 ◉ / 暂停 ⏸ / 纪要·表决 ▤（按时间插入对应行侧） */
  m.marks.forEach(function(mk){
    if(mk.kind==='milestone'||mk.kind==='phase') return;
    var ry=null;
    for(var k=0;k<items.length;k++){
      var pk=items[k];
      if((pk.kind==='done'||pk.kind==='skip')&&pk.nd&&pk.nd.end!=null&&pk.nd.end>=mk.ts){ ry=pk.y; break; }
    }
    if(ry==null){ var lastIt=items[items.length-1]; ry=lastIt?lastIt.y:(H-10); }
    var glyph=mk.kind==='precheck'?'◉':(mk.kind==='pause'?'⏸':'▤');
    var fill=mk.kind==='pause'?'var(--warn)':'var(--faint)';
    h+='<text x="'+(TL_RAIL_W/2)+'" y="'+(ry+15)+'" text-anchor="middle" fill="'+fill+'" font-size="10"><title>'+esc(mk.label+' · '+fmtClock(mk.ts))+'</title>'+glyph+'</text>';
  });
  h+='</svg></div></div>';
  h+='<div class="dim xs" style="margin-top:6px">时间从上到下 · agent 各占一列'+(grouped?'（'+n+' 席 · 已按角色分组）':'')+' · 点击节点看详情 · ◇=批次汇聚</div></div>';
  return h;
}
function closeTlModal(){ var mm=document.getElementById('tlModal'); if(mm) mm.remove(); }
function openTlNodeModal(nd,seats){
  closeTlModal();
  var dd=view.lastDetailData||{}; var t=dd.table||{};
  var lab=(nd.kind==='skip'?'跳过发言':(MT_LABEL[nd.type]||TL_TASK[nd.phase]||'执行'));
  var dur=(nd.end!=null&&nd.start!=null)?fmtDur(nd.end-nd.start):'—';
  var body='<div class="row">'+roleBadge(seatRoleOf(seats,nd.seatId))+'<b>'+esc(seatName(seats,nd.seatId))+'</b>'
    +'<span class="badge phase">'+esc(phaseLabel(t.tableType,nd.phase||'review'))+'</span>'
    +(nd.grp?('<span class="badge">第 '+nd.grp.ord+' 批并行</span>'):'')
    +'<span class="dim">'+(nd.start!=null?fmtTs(nd.start):'')+(nd.end!=null?(' → '+fmtTs(nd.end)):'')+' · 用时 '+dur+'</span></div>';
  if(nd.grp&&nd.grp.task) body+='<div class="kv"><span class="k">批次任务</span>'+esc(clipStr(nd.grp.task,160))+(nd.grp.blind?'（盲评：成员互不可见）':'')+'</div>';
  if(nd.msg){
    body+='<div class="sumcard" style="white-space:pre-wrap;margin-top:8px;max-height:46vh;overflow:auto">'+esc(msgBodyText(nd.msg,seats))+'</div>'
      +'<div class="dim xs" style="margin-top:6px">会议记录 #'+nd.msg.seq+' · '+fmtTs(nd.msg.ts)+'</div>';
  } else body+='<div class="sumcard dim" style="margin-top:8px">进行中节点尚无交付内容。</div>';
  var mm=document.createElement('div');
  mm.className='dmodal'; mm.id='tlModal';
  mm.innerHTML='<div class="dbox" style="width:min(720px,94vw)">'
    +'<div class="dhead"><b>'+esc(lab)+'</b><span style="flex:1"></span><button id="tlClose">关闭</button></div>'
    +'<div class="dbody">'+body+'</div></div>';
  mm.onclick=function(e){ if(e.target===mm) closeTlModal(); };
  document.body.appendChild(mm);
  document.getElementById('tlClose').onclick=closeTlModal;
}
/** 进行中节点 1s 跳动：只改运行卡的文字（按 id 定位），不重建 DOM；轮询重渲染后 id 重建自然接管 */
function tlTick(){
  if(view.mode!=='detail') return;
  (view.tlRun||[]).forEach(function(r){
    var txt=document.getElementById(r.txtId);
    if(txt) txt.textContent=r.task+' · 已执行 '+fmtDur(Date.now()-r.start)+(r.stage?(' · '+r.stage):'');
  });
}
`;
