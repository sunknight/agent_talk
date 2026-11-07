/** 观察页 v2 工作台重构验收（任务 0052）：左栏 tab 工作台 + 底部常驻操作条 + 纯浅色主题 + tab 深链。
 *  结构断言基于 OBSERVER_HTML 源码包含（与既有 observer 系列测试同一手法）。 */
import { describe, expect, it } from "vitest";
import { OBSERVER_HTML } from "../src/observer-html";

describe("观察页 v2：浅色主题", () => {
  it("浅色 tokens 生效，深色主题移除", () => {
    expect(OBSERVER_HTML).toContain("--bg:#edf0f5");
    expect(OBSERVER_HTML).toContain("--panel:#ffffff");
    expect(OBSERVER_HTML).toContain("--acc:#2e6be6");
    expect(OBSERVER_HTML).not.toContain("--bg:#0f1117");
  });
  it("时序图 SVG 颜色 token 化（无深色硬编码）", () => {
    expect(OBSERVER_HTML).not.toContain("TL_ROLE_COLOR={proposer:'#4f8cff'");
    expect(OBSERVER_HTML).toContain("TL_ROLE_COLOR={proposer:'var(--acc)'");
  });
});

describe("观察页 v2：左栏 tab 工作台", () => {
  it("工作台结构：壳/左栏导航/摘要卡/内容区", () => {
    expect(OBSERVER_HTML).toContain('class="dt-shell"');
    expect(OBSERVER_HTML).toContain('class="dt-side"');
    expect(OBSERVER_HTML).toContain('class="dtabs"');
    expect(OBSERVER_HTML).toContain('class="dt-main"');
    expect(OBSERVER_HTML).toContain('class="dt-me"');
    expect(OBSERVER_HTML).toContain('button[data-dt]');
  });
  it("六个 tab 定义与角标（会话=未读，专属=待处理，管理=待审批）", () => {
    expect(OBSERVER_HTML).toContain("['ov','⌂','总览',0]");
    expect(OBSERVER_HTML).toContain("['chat','💬','会话',chatNew]");
    expect(OBSERVER_HTML).toContain("['proc','⏱','过程',0]");
    expect(OBSERVER_HTML).toContain("['files','📁','资料·纪要',0]");
    expect(OBSERVER_HTML).toContain("['mng','⚙','管理',mngCnt]");
    expect(OBSERVER_HTML).toContain("view.maxSeenSeq");
  });
  it("桌型专属 tab 按 flow 定名", () => {
    expect(OBSERVER_HTML).toContain("['问答','❓']");
    expect(OBSERVER_HTML).toContain("['工作指令','📋']");
    expect(OBSERVER_HTML).toContain("['数据对接','⇄']");
    expect(OBSERVER_HTML).toContain("['评审·执行','✓']");
  });
  it("tab 切换：switchDtTab + sessionStorage 按桌记忆 + rerenderDetail 保草稿", () => {
    expect(OBSERVER_HTML).toContain("function switchDtTab");
    expect(OBSERVER_HTML).toContain("sessionStorage.setItem('rt_dtab_'");
  });
  it("tab 深链：#/table/<id>/<tab> 解析并接入路由", () => {
    expect(OBSERVER_HTML).toContain("function routeTableTab()");
    expect(OBSERVER_HTML).toContain("/(ov|chat|proc|work|files|mng)/");
    expect(OBSERVER_HTML).toContain("openTable(id,routeTableTab())");
  });
  it("常驻动作条 + 深链按钮", () => {
    expect(OBSERVER_HTML).toContain('class="dt-action');
    expect(OBSERVER_HTML).toContain('button[data-goto]');
    expect(OBSERVER_HTML).toContain("去完成入桌设定 →");
  });
  it("详情页宽版与底部条留白（main.detail）", () => {
    expect(OBSERVER_HTML).toContain("main.detail { max-width:1800px");
    expect(OBSERVER_HTML).toContain("app.className='detail'");
    expect(OBSERVER_HTML).toContain(".className='';");
  });
  it("旧左右双栏布局不再渲染", () => {
    expect(OBSERVER_HTML).not.toContain('"<div class="dcols">');
  });
});

describe("观察页 v2：底部常驻操作条", () => {
  it("barComposerHtml 承载全部输入类型（id 与旧版一致）", () => {
    expect(OBSERVER_HTML).toContain("function barComposerHtml");
    for (const id of ["pxText", "pxJsonBox", "myInstr", "podText", "hText", "askText", "dirText", "drText"]) {
      expect(OBSERVER_HTML).toContain(`id="${id}"`);
    }
  });
  it("会话卡不再内嵌 composer，草稿采集指向底部条", () => {
    expect(OBSERVER_HTML).toContain("harvestInputs('#dtBar')");
  });
  it("快捷控制按钮与绑定（阶段×角色显隐）", () => {
    for (const id of ["bbStart", "bbInqStart", "bbPause", "bbResume", "bbInqEnd"]) {
      expect(OBSERVER_HTML).toContain(`id="${id}"`);
      expect(OBSERVER_HTML).toContain(`'${id}'`);
    }
    expect(OBSERVER_HTML).toContain("bindStartBtn('bbStart','bbErr')");
    expect(OBSERVER_HTML).toContain("bindStartBtn('bbInqStart','bbErr')");
  });
  it("只读形态：管理员/闭桌提示条", () => {
    expect(OBSERVER_HTML).toContain("dtbar-ro");
    expect(OBSERVER_HTML).toContain("系统观察员 · 只读观察，无输入权限");
    expect(OBSERVER_HTML).toContain("会议已结束 · 内容只读");
  });
  it("模块分区切分机制存在（@@T: 标记总装）", () => {
    for (const k of ["act", "proc", "chat", "ov", "mng", "work", "files"]) {
      expect(OBSERVER_HTML).toContain(`'\\n@@T:${k}@@\\n'`);
    }
  });
});

describe("观察页 v2 二轮：三栏工作台与建桌重排", () => {
  it("返回按钮有背景（button.back，含详情/建桌/入桌/管理台）", () => {
    expect(OBSERVER_HTML).toContain('<button class="back" id="back"');
    expect(OBSERVER_HTML).toContain('<button class="back" id="ctBackList"');
    expect(OBSERVER_HTML).toContain('<button class="back" id="jbBackList"');
    expect(OBSERVER_HTML).toContain('<button class="back" id="admBack"');
    expect(OBSERVER_HTML).toContain('.back { display:inline-flex');
  });
  it("三栏布局：窄左 tab / 宽中 / 窄右动态栏", () => {
    expect(OBSERVER_HTML).toContain("grid-template-columns:232px minmax(0,1fr) 300px");
    expect(OBSERVER_HTML).toContain('class="dt-rail"');
    expect(OBSERVER_HTML).toContain('rail-card');
    expect(OBSERVER_HTML).toContain('id="inviteBox"'); // 邀请码移至右栏
  });
  it("右栏内容：阶段提示/事件流跳会话/本桌玩法/就绪名单", () => {
    expect(OBSERVER_HTML).toContain("当前状态");
    expect(OBSERVER_HTML).toContain("本桌怎么玩");
    expect(OBSERVER_HTML).toContain("app.querySelectorAll('.ev')");
    expect(OBSERVER_HTML).toContain("switchDtTab('chat')");
    expect(OBSERVER_HTML).toContain("已就绪':'未就绪'"); // 暂停期就绪名单
  });
  it("详情头按桌型着色（tt-* 渐变与顶条）", () => {
    expect(OBSERVER_HTML).toContain("dt-head tt-'+esc(t.tableType)");
    for (const tt of ["review", "collab", "brainstorm", "decision", "inquiry", "dispatch", "relay"]) {
      expect(OBSERVER_HTML).toContain(`.dt-head.tt-${tt} {`);
      expect(OBSERVER_HTML).toContain(`.tcard.tt-${tt} {`);
    }
  });
  it("输入区 zcode 化：中列底部 sticky 圆角外框，不再全宽 fixed", () => {
    expect(OBSERVER_HTML).toContain(".dtbar { position:sticky; bottom:12px;");
    expect(OBSERVER_HTML).not.toContain(".dtbar { position:fixed");
    expect(OBSERVER_HTML).toContain("margin-top:auto");
  });
  it("建桌表单：左类型列表 + 右表单 + 进阶折叠", () => {
    expect(OBSERVER_HTML).toContain("ct-wrap");
    expect(OBSERVER_HTML).toContain('class="ct-types" id="ctTypeRow"');
    expect(OBSERVER_HTML).toContain("进阶设定");
    expect(OBSERVER_HTML).toContain("创建圆桌</button>");
  });
});

describe("观察页 v2：模块归属不变量", () => {
  it("管理 tab 元素仍在（席位卡/折叠区/管理员卡）", () => {
    for (const id of ["stStart", "inqStart", "ctlPause", "ctlResume", "prApply", "stRecover", "stLeave", "admPause", "admDel", "tcSave"]) {
      expect(OBSERVER_HTML).toContain(`id="${id}"`);
    }
    expect(OBSERVER_HTML).toContain("seatDetCtl");
    expect(OBSERVER_HTML).toContain("seatDetLeave");
  });
  it("各桌型专属模块仍在（问答/指令/索要/评审/请求）", () => {
    expect(OBSERVER_HTML).toContain("openQaModal");
    expect(OBSERVER_HTML).toContain("openWdModal");
    expect(OBSERVER_HTML).toContain("drRuleGo");
    expect(OBSERVER_HTML).toContain("openReviewItemModal");
    expect(OBSERVER_HTML).toContain("openRequestModal");
  });
  it("抗轮询机制保留（脏面板/贴底/草稿回填）", () => {
    expect(OBSERVER_HTML).toContain("view.dirtyPanel");
    expect(OBSERVER_HTML).toContain("view.chatAtBottom");
    expect(OBSERVER_HTML).toContain("restoreInputs(view.cmpKeep||{})");
  });
  it("intro 重排：hero + 三步卡", () => {
    expect(OBSERVER_HTML).toContain("intro-hero");
    expect(OBSERVER_HTML).toContain("intro-steps");
    expect(OBSERVER_HTML).toContain("istep");
  });
});
