/** 观察端验收：列表/详情/进展与下一步动作、邀请码权限（仅建桌人）、人工指令定向发送 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start } from "../src";

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

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-obs-"));
  ({ http } = await start({ port: 0, dataDir: dir, host: "127.0.0.1" }));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => { http.closeIdleConnections?.(); http.close(() => r()); }));

describe("观察端 Web 控制台", () => {
  let ownerUser = "", otherUser = "";
  let tableId = "", ownerSeatToken = "", reviewerSeatToken = "", reviewerSeatId = "";

  it("GET / 下发观察端页面", async () => {
    const res = await fetch(base + "/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("圆桌观察端");
    expect(html).toContain("human-input");
    expect(html).toContain("my/message"); // 我的席位面板：人工代答
    expect(html).toContain("my/seat-config"); // 我的席位面板：网页入桌设定
    expect(html).toContain("human_proxied"); // 代答徽标
    expect(html).toContain("创建圆桌"); // 列表页建桌入口
    expect(html).toContain("ctSubmit"); // 建桌表单
    expect(html).toContain("只显示这一次"); // ownerSeatToken 凭证警示
    expect(html).toContain('label class="t"'); // 表单字段标签
    expect(html).toContain("human-only"); // agent 标识选填默认
  });

  it("GET /api/me：返回会话身份（建桌表单默认席位名来源）", async () => {
    const bad = await call("GET", "/api/me");
    expect(bad.status).toBe(401);
    const t = (await call("POST", "/api/users", { body: { name: "观察-me测试" } })).data.token;
    const r = await call("GET", "/api/me", { token: t });
    expect(r.ok).toBe(true);
    expect(r.data.name).toBe("观察-me测试");
    expect(typeof r.data.userId).toBe("string");
  });

  it("建桌入席就绪开局（前置数据）", async () => {
    ownerUser = (await call("POST", "/api/users", { body: { name: "观察-建桌人" } })).data.token;
    otherUser = (await call("POST", "/api/users", { body: { name: "观察-路人" } })).data.token;
    const created = await call("POST", "/api/tables", {
      token: ownerUser,
      body: { topic: "观察端测试桌", goals: "验证观察端", owner: { seatName: "建桌人A", agentLabel: "zcode" } },
    });
    tableId = created.data.tableId;
    ownerSeatToken = created.data.ownerSeatToken;
    const rc = created.data.inviteCodes.find((c: { role: string }) => c.role === "reviewer").code;
    const ru = (await call("POST", "/api/users", { body: { name: "观察-评审" } })).data.token;
    const j = await call("POST", `/api/tables/${tableId}/seats`, {
      token: ru, body: { inviteCode: rc, seatName: "评审B", role: "reviewer", agentLabel: "claude" },
    });
    reviewerSeatToken = j.data.token;
    reviewerSeatId = j.data.seatId;
    await call("POST", `/api/tables/${tableId}/seat-config`, { token: ownerSeatToken, body: { stance: "提案方", ready: true } });
    await call("POST", `/api/tables/${tableId}/seat-config`, { token: reviewerSeatToken, body: { stance: "评审方", ready: true } });
    await call("POST", `/api/tables/${tableId}/start`, { token: ownerSeatToken });
    await call("POST", `/api/tables/${tableId}/artifacts`, { token: ownerSeatToken, body: { name: "d.md", format: "md", contentBase64: b64("v1"), changeNote: "初稿" } });
    await call("POST", `/api/tables/${tableId}/messages`, { token: ownerSeatToken, body: { type: "STATEMENT", payload: { text: "提案陈述" } } });
  });

  it("桌列表：任何 user token 可见全桌", async () => {
    const r = await call("GET", "/api/observer/tables", { token: otherUser });
    expect(r.ok).toBe(true);
    expect(r.data.tables.some((t: { tableId: string }) => t.tableId === tableId)).toBe(true);
    const noAuth = await call("GET", "/api/observer/tables");
    expect(noAuth.status).toBe(401);
  });

  it("桌详情：进展 + 下一步动作（taskHint 指向轮到的评审席）", async () => {
    const r = await call("GET", `/api/observer/tables/${tableId}`, { token: otherUser });
    expect(r.ok).toBe(true);
    expect(r.data.table.phase).toBe("review");
    expect(r.data.table.activeTurn.seatId).toBe(reviewerSeatId);
    expect(r.data.table.activeTurn.taskHint).toContain("评审");
    expect(r.data.messages.length).toBeGreaterThan(3); // 建桌/入席/开始/发布/陈述…
    expect(r.data.meta.goals).toBe("验证观察端");
  });

  it("邀请码：仅建桌人可查，路人 403", async () => {
    const deny = await call("GET", `/api/observer/tables/${tableId}/invites`, { token: otherUser });
    expect(deny.status).toBe(403);
    expect(deny.error.code).toBe("not_owner");
    const allow = await call("GET", `/api/observer/tables/${tableId}/invites`, { token: ownerUser });
    expect(allow.ok).toBe(true);
    expect(allow.data.invites.length).toBe(2);
    expect(allow.data.invites.some((i: { role: string }) => i.role === "reviewer")).toBe(true);
  });

  it("人工指令：无席位路人被拒；席位持有人可定向发送，进入历史可查", async () => {
    const deny = await call("POST", `/api/tables/${tableId}/human-input`, {
      token: otherUser, body: { text: "插话" },
    });
    expect(deny.status).toBe(403);

    const send = await call("POST", `/api/tables/${tableId}/human-input`, {
      token: ownerUser, body: { text: "评审B 请重点看错误码章节", toSeat: reviewerSeatId },
    });
    expect(send.ok).toBe(true);

    const detail = await call("GET", `/api/observer/tables/${tableId}`, { token: otherUser });
    const hi = detail.data.messages.filter((m: { type: string }) => m.type === "HUMAN_INPUT").pop();
    expect(hi.payload.text).toContain("错误码");
    expect(hi.payload.toSeat).toBe(reviewerSeatId);
    expect(hi.payload.byHuman).toBe("观察-建桌人");
  });

  it("定向目标不存在 → 404；署名默认用户名", async () => {
    const bad = await call("POST", `/api/tables/${tableId}/human-input`, {
      token: ownerUser, body: { text: "x", toSeat: "seat_nope" },
    });
    expect(bad.status).toBe(404);
  });
});
