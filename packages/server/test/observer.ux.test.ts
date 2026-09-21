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
    expect(html).toContain("msgFilter"); // 消息筛选
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

  it("列表 mySeatRole：持席位用户标到角色，路人为 null", async () => {
    const own = await call("GET", "/api/observer/tables", { token: ownerUser });
    const mine = own.data.tables.find((t: { tableId: string }) => t.tableId === tableId);
    expect(mine.mySeatRole).toBe("proposer");
    expect(mine.mySeatName).toBe("建桌人A");
    const st = await call("GET", "/api/observer/tables", { token: stranger });
    const other = st.data.tables.find((t: { tableId: string }) => t.tableId === tableId);
    expect(other.mySeatRole).toBeNull();
    expect(other.mySeatName).toBeNull();
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
