/** 观察页 UX 改进验收（任务 0005）：身份角色（/api/me role、手工标记 systemadmin round-trip）、
 *  列表 mySeatRole、my/start 网页开始会议、页面新 UX 元素。 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start } from "../src";
import { Store } from "../src/store";
import { sha256 } from "@rt/shared";

let base = "";
let http: import("node:http").Server;

async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const j = (await res.json()) as { ok: boolean; data?: any; error?: { code: string; message: string } };
  return { status: res.status, ...j };
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-ux-"));
  ({ http } = await start({ port: 0, dataDir: dir, host: "127.0.0.1" }));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => { http.closeIdleConnections?.(); http.close(() => r()); }));

describe("观察页 UX：身份角色与 my 通道", () => {
  let ownerUser = "", revUser = "", stranger = "";
  let tableId = "";

  it("页面含新 UX 元素：身份体系/全局观察/开始会议/chips/进度条/消息筛选", async () => {
    const html = await (await fetch(base + "/")).text();
    expect(html).toContain("系统观察员");
    expect(html).toContain("全局观察模式");
    expect(html).toContain("开始会议");
    expect(html).toContain("my/start"); // 网页开始会议通道
    expect(html).toContain("dsIn"); // 数据范围 chips 输入器
    expect(html).toContain("chatFilter"); // 会话筛选（chatbox 全部/发言/指令/系统）
    expect(html).toContain("class=\"steps\""); // 阶段进度条
    expect(html).toContain("注册并连接"); // 注册内联表单
    expect(html).toContain("替我回答本轮"); // 代答（仅会议开始后出现）
  });

  it("页面含圆桌示意图：环形布局/最后交付摘要/思考中标记/>8 席折叠", async () => {
    const html = await (await fetch(base + "/")).text();
    expect(html).toContain("rt-stage"); // 环形舞台
    expect(html).toContain("roundDiagramHtml"); // 渲染函数
    expect(html).toContain("lastDelivInfo"); // 最后交付摘要
    expect(html).toContain("思考中"); // 发言权思考中标记
    expect(html).toContain("rtpulse"); // 脉冲动效
    expect(html).toContain("rtMore"); // 「+N」折叠节点
    expect(html).toContain("rtExpanded"); // 展开态（抗轮询重渲染）
    expect(html).toContain("RING_MAX=8"); // 超 8 席折叠阈值
  });

  it("页面含执行时序图：纵向 DAG/agent 分列/并行汇聚/进行中跳动/节点详情弹窗（任务 0046）", async () => {
    const html = await (await fetch(base + "/")).text();
    expect(html).toContain("执行时序"); // 卡片标题（左栏会话上方）
    expect(html).toContain("deriveTimeline"); // 消息流 → 时序模型推导
    expect(html).toContain("timelineCardHtml"); // 渲染函数
    expect(html).toContain("时间从上到下"); // 纵向时序（时间向下流动）
    expect(html).toContain("tl-colhead"); // agent 固定列头（sticky）
    expect(html).toContain("TL_COL_MAX"); // ≤8 每 agent 固定一列、>8 按角色分组阈值
    expect(html).toContain("TL_ROLE_GROUP_ORDER"); // 按角色分组
    expect(html).toContain("tl-node"); // 可点击节点卡片（详情弹窗）
    expect(html).toContain("批次汇聚"); // 并行批次虚拟汇总节点（◇）
    expect(html).toContain("已执行 "); // 进行中节点已执行时长
    expect(html).toContain("tlTick"); // 1s 跳动 ticker
    expect(html).toContain("openTlNodeModal"); // 节点详情弹窗
    expect(html).toContain("tlPulse"); // 进行中卡脉冲动效
    expect(html).toContain("tlArrow"); // 节点间箭头（hand-off/fan-out/fan-in）
  });

  it("页面含完整邀请复制：邀请码/席位 token 复制带服务器/桌号/skill 指引", async () => {
    const html = await (await fetch(base + "/")).text();
    expect(html).toContain("inviteText"); // 完整邀请文本构造器
    expect(html).toContain("seatTokenText"); // 席位凭证完整文本构造器
    expect(html).toContain("复制完整邀请"); // 邀请码按钮文案
    expect(html).toContain("credTokCopy"); // 凭证卡复制按钮
    expect(html).toContain("/skill.md"); // 邀请内含技能自装地址
    expect(html).toContain("【圆桌邀请】");
    expect(html).toContain("【我的席位凭证】");
  });

  it("页面含帮助体系：右上角帮助按钮/帮助弹窗/未登录 agent 接入指引/列表页脚帮助速览", async () => {
    const html = await (await fetch(base + "/")).text();
    expect(html).toContain("helpBtn"); // 右上角帮助按钮
    expect(html).toContain("helpModal"); // 帮助弹窗（body 级）
    expect(html).toContain("系统帮助"); // 弹窗标题 / 按钮 title
    expect(html).toContain("agentAccessText"); // agent 接入指令构造器（安装+注册）
    expect(html).toContain("复制 agent 接入指令"); // 未登录页/页脚/弹窗共用复制按钮文案
    expect(html).toContain("让 agent 接入本系统"); // 未登录页接入卡
    expect(html).toContain("/api/users"); // 指令含注册端点
    expect(html).toContain("帮助速览"); // 已登录列表页底部帮助卡
    expect(html).not.toContain("不开放注册"); // systemadmin 不开放注册信息已移除
  });

  it("页面含详情页 hash 路由：#/table/<id> 直达/刷新保持/前进后退/复制链接", async () => {
    const html = await (await fetch(base + "/")).text();
    expect(html).toContain("routeTableId"); // hash 解析
    expect(html).toContain("#/table/"); // 详情页 URL 形态
    expect(html).toContain("syncRoute"); // hashchange/popstate 双事件同步
    expect(html).toContain("addEventListener('hashchange'"); // 监听 hash 变更
    expect(html).toContain("addEventListener('popstate'"); // 监听前进/后退
    expect(html).toContain("dCopyLink"); // 复制本页链接按钮
    expect(html).toContain("复制本页链接");
    expect(html).toContain("document.title"); // 详情页标题随桌主题
  });

  it("页面含执行请求弹窗：中文状态/意图标签、卡片可点击、弹窗要素", async () => {
    const html = await (await fetch(base + "/")).text();
    expect(html).toContain("openRequestModal"); // 弹窗函数
    expect(html).toContain("reqModal"); // body 级弹窗节点
    expect(html).toContain("REQ_ST_LABEL"); // 状态中文标签映射
    expect(html).toContain("REQ_INTENT_LABEL"); // 意图中文标签映射
    expect(html).toContain("待处置"); // pending
    expect(html).toContain("已执行"); // executed
    expect(html).toContain("已反提案"); // countered
    expect(html).toContain("修改产物"); // modify_artifact
    expect(html).toContain("澄清说明"); // clarify
    expect(html).toContain("点击查看请求详情"); // 卡片 title 提示
    expect(html).toContain("data-ri"); // 卡片索引绑定
    expect(html).toContain("处置结果"); // 弹窗处置区标题
    expect(html).toContain("认领自办"); // 同席请求（executeBy=self）显示认领自办
    expect(html).toContain("委托他席"); // 区头说明：同席/跨席两种形态
    expect(html).toContain("closeRequestModal"); // Esc/背景关闭
  });

  it("页面含评审项面板：全生命周期状态/回应轨迹、卡片可点击、弹窗要素（任务 0036）", async () => {
    const html = await (await fetch(base + "/")).text();
    expect(html).toContain("reviewItemStatus"); // 状态分类函数
    expect(html).toContain("openReviewItemModal"); // 详情弹窗函数
    expect(html).toContain("riModal"); // body 级弹窗节点
    expect(html).toContain("closeReviewItemModal"); // 背景/按钮关闭
    expect(html).toContain("data-vi"); // 卡片索引绑定
    expect(html).toContain("点击查看评审项详情"); // 卡片 title 提示
    expect(html).toContain("d.reviewItems"); // 面板数据来源（详情接口的评审项挂接）
    expect(html).toContain("直接通过"); // 一轮接纳即执行完成
    expect(html).toContain("交互后通过"); // 多轮回应/反提案/转人工后通过
    expect(html).toContain("待回应"); // 尚无回应
    expect(html).toContain("已接纳·执行中"); // accept 后请求待执行
    expect(html).toContain("反提案待回应"); // 请求被 counter
    expect(html).toContain("回应轨迹"); // 弹窗回应区标题
    expect(html).toContain("派生执行请求"); // 弹窗执行区标题
    expect(html).toContain("满足版本"); // 满足请求的产物版本溯源
    expect(html).toContain("RESP_LABEL"); // 回应决定中文标签映射
  });

  it("页面含问询桌问答区：问答通栏列表（截断）+ 全文弹窗（任务 0029）", async () => {
    const html = await (await fetch(base + "/")).text();
    expect(html).toContain("openQaModal"); // 全文弹窗函数
    expect(html).toContain("qaModal"); // body 级弹窗节点
    expect(html).toContain("closeQaModal"); // 背景/按钮关闭
    expect(html).toContain("qa-item"); // 可点击问答卡样式
    expect(html).toContain("data-qa"); // 卡片索引绑定
    expect(html).toContain("点击查看完整问答"); // 卡片 title 提示
    expect(html).toContain("问题与各方回答汇总"); // 区头说明
    expect(html).toContain("待回答"); // 无回答的问题显示待回答
    expect(html).toContain("flow==='inquiry'"); // 仅问询桌渲染
  });

  it("内嵌 script 语法可解析（模板字符串手写 JS 防回归）", async () => {
    const html = await (await fetch(base + "/")).text();
    const m = /<script>([\s\S]*)<\/script>/.exec(html);
    expect(m).not.toBeNull();
    expect(() => new Function(m![1])).not.toThrow(); // 仅解析不执行
  });

  it("/api/me 返回 role（默认 user）", async () => {
    const t = (await call("POST", "/api/users", { body: { name: "ux-甲" } })).data.token;
    const me = await call("GET", "/api/me", { token: t });
    expect(me.ok).toBe(true);
    expect(me.data.role).toBe("user");
    expect(typeof me.data.userId).toBe("string");
  });

  it("标记 systemadmin：写入 SQLite → 重启（新 Store）读到角色（替代旧手改 state.json，新引导方式见 BOOTSTRAP_ADMIN_TOKEN）", () => {
    const dir = mkdtempSync(join(tmpdir(), "rt-role-"));
    const token = "rtu_manualmark";
    const s1 = new Store(dir);
    const uid = s1.addUser("管理员候选", sha256(token));
    s1.flushSync();
    // 未标记 → user
    expect(s1.findUserByToken(token)?.role).toBe("user");
    // 停服提权（原手改 state.json；现走 Store API，由 BOOTSTRAP_ADMIN_TOKEN/管理台触发）
    s1.setUserRole(uid, "systemadmin");
    s1.close();
    // 重启后加载（SQLite 持久化）
    const s2 = new Store(dir);
    const u = s2.findUserByToken(token);
    expect(u?.name).toBe("管理员候选");
    expect(u?.role).toBe("systemadmin");
  });

  it("前置：建桌 + 评审入席（均未就绪）", async () => {
    ownerUser = (await call("POST", "/api/users", { body: { name: "ux-建桌人" } })).data.token;
    revUser = (await call("POST", "/api/users", { body: { name: "ux-评审" } })).data.token;
    stranger = (await call("POST", "/api/users", { body: { name: "ux-路人" } })).data.token;
    const created = await call("POST", "/api/tables", {
      token: ownerUser,
      body: { topic: "UX 测试桌", owner: { seatName: "建桌人A", agentLabel: "zcode" } },
    });
    tableId = created.data.tableId;
    const rc = created.data.inviteCodes.find((c: { role: string }) => c.role === "reviewer").code;
    await call("POST", `/api/tables/${tableId}/seats`, {
      token: revUser, body: { inviteCode: rc, seatName: "评审B", role: "reviewer", agentLabel: "claude" },
    });
  });

  it("列表 mySeatRole：持席位用户标到角色；未参与路人列表即不可见（收权）", async () => {
    const own = await call("GET", "/api/observer/tables", { token: ownerUser });
    const mine = own.data.tables.find((t: { tableId: string }) => t.tableId === tableId);
    expect(mine.mySeatRole).toBe("proposer");
    expect(mine.mySeatName).toBe("建桌人A");
    const st = await call("GET", "/api/observer/tables", { token: stranger });
    const other = st.data.tables.find((t: { tableId: string }) => t.tableId === tableId);
    expect(other).toBeUndefined(); // 路人不再看到他人桌
    const stDetail = await call("GET", `/api/observer/tables/${tableId}`, { token: stranger });
    expect(stDetail.status).toBe(403);
    expect(stDetail.error.code).toBe("not_participant");
  });

  it("my/start：路人 403；未全员就绪 409；非建桌人 403；就绪后建桌人成功开局", async () => {
    const noSeat = await call("POST", `/api/tables/${tableId}/my/start`, { token: stranger, body: {} });
    expect(noSeat.status).toBe(403);
    expect(noSeat.error.code).toBe("no_seat");

    const notReady = await call("POST", `/api/tables/${tableId}/my/start`, { token: ownerUser, body: {} });
    expect(notReady.status).toBe(409);
    expect(notReady.error.code).toBe("not_ready");

    await call("POST", `/api/tables/${tableId}/my/seat-config`, { token: ownerUser, body: { stance: "提案方", ready: true } });
    await call("POST", `/api/tables/${tableId}/my/seat-config`, { token: revUser, body: { stance: "评审方", ready: true } });

    const notOwner = await call("POST", `/api/tables/${tableId}/my/start`, { token: revUser, body: {} });
    expect(notOwner.status).toBe(403);
    expect(notOwner.error.code).toBe("not_owner");

    const go = await call("POST", `/api/tables/${tableId}/my/start`, { token: ownerUser, body: {} });
    expect(go.ok).toBe(true);
    expect(go.data.started).toBe(true);
    const detail = await call("GET", `/api/observer/tables/${tableId}`, { token: ownerUser });
    expect(detail.data.table.phase).toBe("statements");

    // 已开局后再 start → already_started
    const again = await call("POST", `/api/tables/${tableId}/my/start`, { token: ownerUser, body: {} });
    expect(again.status).toBe(409);
    expect(again.error.code).toBe("already_started");
  });
});
