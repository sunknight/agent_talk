/** 凭码入桌（任务 0017）：邀请码预检端点（裸码/完整邀请文本提取/无效码/不消费）、
 *  跨桌码拒绝（消费前校验归属）、重复入席拒绝、会议开始后拒入、成功入席流程 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start } from "../src";

let base = "";
let http: import("node:http").Server;
let hub: Awaited<ReturnType<typeof start>>["hub"];

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
  const dir = mkdtempSync(join(tmpdir(), "rt-join-"));
  ({ http, hub } = await start({ port: 0, dataDir: dir, host: "127.0.0.1" }));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => { http.closeIdleConnections?.(); http.close(() => r()); }));

describe("凭码入桌（Web 端）", () => {
  let owner = "", joiner = "", other = "";
  let tableId = "", otherTableId = "";
  let reviewerCode = "", observerCode = "";

  it("页面含凭码入桌 UX 元素", async () => {
    const html = await (await fetch(base + "/")).text();
    expect(html).toContain("凭邀请码入桌"); // 列表入口
    expect(html).toContain("invites/preview"); // 预检端点
    expect(html).toContain("jbCheck"); // 查询邀请码
    expect(html).toContain("jbJoin"); // 确认入席
    expect(html).toContain("jrTokCopy"); // 成功页复制凭证
    expect(html).toContain("已在本桌持有席位"); // 重复入席引导文案
  });

  it("前置：建两张桌（主桌 open 阶段 + 干扰桌），拿到双码", async () => {
    owner = (await call("POST", "/api/users", { body: { name: "凭码-建桌人" } })).data.token;
    joiner = (await call("POST", "/api/users", { body: { name: "凭码-参桌人" } })).data.token;
    other = (await call("POST", "/api/users", { body: { name: "凭码-他人" } })).data.token;
    const c1 = await call("POST", "/api/tables", {
      token: owner, body: { topic: "凭码入桌主桌", owner: { seatName: "主桌建桌人", agentLabel: "zcode" } },
    });
    tableId = c1.data.tableId;
    reviewerCode = c1.data.inviteCodes.find((c: { role: string }) => c.role === "reviewer").code;
    observerCode = c1.data.inviteCodes.find((c: { role: string }) => c.role === "observer").code;
    const c2 = await call("POST", "/api/tables", {
      token: other, body: { topic: "干扰桌", owner: { seatName: "干扰建桌人", agentLabel: "zcode" } },
    });
    otherTableId = c2.data.tableId;
    expect(reviewerCode).toMatch(/^[0-9A-F]{10}$/);
  });

  it("预检需登录：未带 token 401", async () => {
    const r = await call("POST", "/api/invites/preview", { body: { code: reviewerCode } });
    expect(r.status).toBe(401);
  });

  it("预检裸码：返回所属桌摘要，mySeat=null，不消费次数", async () => {
    const r = await call("POST", "/api/invites/preview", { token: joiner, body: { code: reviewerCode } });
    expect(r.ok).toBe(true);
    expect(r.data.tableId).toBe(tableId);
    expect(r.data.topic).toBe("凭码入桌主桌");
    expect(r.data.phase).toBe("open");
    expect(r.data.role).toBe("reviewer");
    expect(r.data.usesLeft).toBe(10);
    expect(r.data.mySeat).toBeNull();
    // 再查一次：次数未被预检消耗
    const again = await call("POST", "/api/invites/preview", { token: joiner, body: { code: reviewerCode } });
    expect(again.data.usesLeft).toBe(10);
  });

  it("预检支持整段「完整邀请」文本：自动提取码，不误抓 tableId", async () => {
    const text = [
      "【圆桌邀请】凭码入桌主桌",
      "角色：评审方（凭邀请码入席，角色由码定死，剩余 10 次）",
      `服务器：${base}`,
      `圆桌 ID：${tableId}`,
      `邀请码：${reviewerCode}`,
      "",
      "参会方式（本段整体发给参与方，交给其 agent）：",
      `3. 人工入席（可选）：POST ${base}/api/tables/${tableId}/seats`,
    ].join("\n");
    const r = await call("POST", "/api/invites/preview", { token: joiner, body: { code: text } });
    expect(r.ok).toBe(true);
    expect(r.data.code).toBe(reviewerCode);
    expect(r.data.tableId).toBe(tableId);
  });

  it("预检建桌人视角：mySeat 指向自己的 proposer 席位", async () => {
    const r = await call("POST", "/api/invites/preview", { token: owner, body: { code: reviewerCode } });
    expect(r.ok).toBe(true);
    expect(r.data.mySeat).toMatchObject({ name: "主桌建桌人", role: "proposer" });
  });

  it("预检无效：错码 / 无 10 位 hex 词的文本 → 403 bad_invite", async () => {
    const bad1 = await call("POST", "/api/invites/preview", { token: joiner, body: { code: "DEADBEEFXX" } });
    expect(bad1.status).toBe(403);
    expect(bad1.error.code).toBe("bad_invite");
    const bad2 = await call("POST", "/api/invites/preview", { token: joiner, body: { code: "没有任何有效码的普通文本 12345" } });
    expect(bad2.status).toBe(403);
    expect(bad2.error.code).toBe("bad_invite");
  });

  it("跨桌拒绝：A 桌邀请码不能在 B 桌入席，且不扣 A 桌码次数", async () => {
    const r = await call("POST", `/api/tables/${otherTableId}/seats`, {
      token: joiner, body: { inviteCode: reviewerCode, seatName: "跨桌者", role: "reviewer", agentLabel: "zcode" },
    });
    expect(r.status).toBe(403);
    expect(r.error.code).toBe("bad_invite");
    expect(r.error.message).toContain("不属于本圆桌");
    const p = await call("POST", "/api/invites/preview", { token: joiner, body: { code: reviewerCode } });
    expect(p.data.usesLeft).toBe(10); // 拒绝路径未消费
  });

  it("角色不符仍被拒（码定角色不可自封）", async () => {
    const r = await call("POST", `/api/tables/${tableId}/seats`, {
      token: joiner, body: { inviteCode: reviewerCode, seatName: "冒充观察", role: "observer", agentLabel: "zcode" },
    });
    expect(r.status).toBe(403);
    expect(r.error.code).toBe("role_mismatch");
  });

  it("成功入席：席位建立 + 桌进入「我参与的」列表 + 观察详情可访问", async () => {
    const j = await call("POST", `/api/tables/${tableId}/seats`, {
      token: joiner, body: { inviteCode: reviewerCode, seatName: "网页评审C", role: "reviewer", agentLabel: "human-only" },
    });
    expect(j.ok).toBe(true);
    expect(j.data.seat.role).toBe("reviewer");
    expect(typeof j.data.token).toBe("string");
    const list = await call("GET", "/api/observer/tables", { token: joiner });
    const t = list.data.tables.find((x: { tableId: string }) => x.tableId === tableId);
    expect(t).toBeTruthy();
    expect(t.mySeatRole).toBe("reviewer");
    const detail = await call("GET", `/api/observer/tables/${tableId}`, { token: joiner });
    expect(detail.ok).toBe(true);
    expect(detail.data.mySeatId).toBe(j.data.seatId);
    // 入席成功才扣一次
    const p = await call("POST", "/api/invites/preview", { token: owner, body: { code: reviewerCode } });
    expect(p.data.usesLeft).toBe(9);
  });

  it("重复入席拒绝：已持有 active 席位再凭码 → 409 already_seated，不扣次数", async () => {
    const r = await call("POST", `/api/tables/${tableId}/seats`, {
      token: joiner, body: { inviteCode: observerCode, seatName: "第二席位", role: "observer", agentLabel: "zcode" },
    });
    expect(r.status).toBe(409);
    expect(r.error.code).toBe("already_seated");
    expect(r.error.message).toContain("网页评审C"); // 提示既有席位名，引导进桌
    const p = await call("POST", "/api/invites/preview", { token: owner, body: { code: observerCode } });
    expect(p.data.usesLeft).toBe(10);
  });

  it("会议开始后凭码入席 → 409 already_started（文案不再暗示 observer 可中途加入）", async () => {
    const meta = hub.store.getTable(otherTableId)!;
    meta.phase = "statements";
    hub.store.saveTable(meta);
    const c2 = await call("POST", "/api/tables", {
      token: other, body: { topic: "开始后拒入桌", owner: { seatName: "第三人", agentLabel: "zcode" } },
    });
    const startedCode = c2.data.inviteCodes.find((c: { role: string }) => c.role === "observer").code;
    const m2 = hub.store.getTable(c2.data.tableId)!;
    m2.phase = "review";
    hub.store.saveTable(m2);
    const r = await call("POST", `/api/tables/${c2.data.tableId}/seats`, {
      token: joiner, body: { inviteCode: startedCode, seatName: "迟到者", role: "observer", agentLabel: "zcode" },
    });
    expect(r.status).toBe(409);
    expect(r.error.code).toBe("already_started");
    expect(r.error.message).not.toContain("observer 邀请码");
    // 会议开始后预检仍可用（只读），前端据此提示不可入席
    const p = await call("POST", "/api/invites/preview", { token: joiner, body: { code: startedCode } });
    expect(p.ok).toBe(true);
    expect(p.data.phase).toBe("review");
  });
});
