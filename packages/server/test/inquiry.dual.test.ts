/**
 * 问询桌同号双身份验收：同一注册用户既是问询方（网页提问）又持回答席位（自己的 agent 同账号入席）。
 * 修复点：① joinTable 问询方码分支先于 already_seated（持席位者可兼任问询方，入席先后不再限制）；
 * ② observerTables 问询方身份优先标记（不再被席位遮蔽）；③ 详情页 isAsker 不再被 mySeat 屏蔽，
 * 问询面板与席位面板共存（开始按钮独立 id inqStart/inqStartErr 防同页冲突）。
 * fetch 直调 REST，零 mock。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start } from "../src";
import { OBSERVER_HTML } from "../src/observer-html";

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
  const dir = mkdtempSync(join(tmpdir(), "rt-inq-dual-test-"));
  ({ http } = await start({ port: 0, dataDir: dir, host: "127.0.0.1" }));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => { http.closeIdleConnections?.(); http.close(() => r()); }));

describe("自建问询桌：同号用户 web 提问 + 自己的 agent 作答", () => {
  const holderName = "双身份-持有人";
  let holderToken = "";
  let tableId = "";
  let seatToken = "";
  let seatId = "";
  let qMsgId = "";

  it("建桌（即问询方）→ agent 同账号凭码入回答席 → 就绪", async () => {
    holderToken = (await call("POST", "/api/users", { body: { name: holderName } })).data.token;
    const created = await call("POST", "/api/tables", {
      token: holderToken,
      body: { tableType: "inquiry", topic: "同号双身份验收", owner: { seatName: holderName, agentLabel: "web" } },
    });
    tableId = created.data.tableId;
    expect(created.data.ownerSeatId).toBe("asker");
    const ansCode = created.data.inviteCodes.find((c: { role: string }) => c.role === "answerer").code;
    const joined = await call("POST", `/api/tables/${tableId}/seats`, {
      token: holderToken, body: { inviteCode: ansCode, seatName: "双身份agent", role: "answerer", agentLabel: "zcode" },
    });
    expect(joined.ok).toBe(true); // 问询方绑定不算席位，不触发 already_seated
    seatToken = joined.data.token;
    seatId = joined.data.seatId;
    const cfg = await call("POST", `/api/tables/${tableId}/seat-config`, {
      token: seatToken, body: { stance: "本席范围内作答", scope: "任意", ready: true },
    });
    expect(cfg.ok).toBe(true);
  });

  it("网页视角：列表问询方优先标记；详情 isAsker 与 mySeatId 并存", async () => {
    const list = await call("GET", "/api/observer/tables", { token: holderToken });
    const mine = list.data.tables.find((t: { tableId: string }) => t.tableId === tableId);
    expect(mine.mySeatRole).toBe("asker"); // 修复前：被席位遮蔽为 answerer
    const detail = await call("GET", `/api/observer/tables/${tableId}`, { token: holderToken });
    expect(detail.data.isAsker).toBe(true);
    expect(detail.data.mySeatId).toBe(seatId); // 双身份并存：席位面板数据仍在
  });

  it("web 开始问询/提问 → agent 收问题作答 → 闭环", async () => {
    expect((await call("POST", `/api/tables/${tableId}/my/start`, { token: holderToken })).ok).toBe(true);
    expect((await call("POST", `/api/tables/${tableId}/ask`, { token: holderToken, body: { text: "你能干什么？" } })).ok).toBe(true);
    const poll = await call("GET", `/api/tables/${tableId}/poll?since=0&timeout=0`, { token: seatToken });
    const q = (poll.data.messages ?? []).find((m: { type: string }) => m.type === "QUESTION");
    expect(q?.payload?.text).toBe("你能干什么？");
    qMsgId = q.msgId;
    const reply = await call("POST", `/api/tables/${tableId}/messages`, {
      token: seatToken, body: { type: "REPLY", payload: { toMsgId: qMsgId, text: "范围内作答" } },
    });
    expect(reply.ok).toBe(true);
  });
});

describe("主持人问询桌：反序就位（先 agent 入回答席，用户再凭问询方码就位）", () => {
  it("反序就位成功（修复前 already_seated），随后开始提问正常", async () => {
    const host = (await call("POST", "/api/users", { body: { name: "双身份-主持人" } })).data.token;
    const created = await call("POST", "/api/tables", {
      token: host,
      body: { tableType: "inquiry", mode: "hosted", topic: "反序就位验收", owner: { seatName: "主持人", agentLabel: "web" } },
    });
    const tableId = created.data.tableId;
    const askerCode = created.data.inviteCodes.find((c: { role: string }) => c.role === "asker").code;
    const ansCode = created.data.inviteCodes.find((c: { role: string }) => c.role === "answerer").code;
    const u = (await call("POST", "/api/users", { body: { name: "双身份-反序用户" } })).data.token;

    // 先 agent 凭码入回答席（同账号）
    const joined = await call("POST", `/api/tables/${tableId}/seats`, {
      token: u, body: { inviteCode: ansCode, seatName: "反序agent", role: "answerer", agentLabel: "zcode" },
    });
    expect(joined.ok).toBe(true);
    // 再凭问询方码就位：修复前 409 already_seated，现应成功
    const seated = await call("POST", `/api/tables/${tableId}/seats`, {
      token: u, body: { inviteCode: askerCode, seatName: "反序用户", role: "asker", agentLabel: "web" },
    });
    expect(seated.ok).toBe(true);
    expect(seated.data.asker).toBe(true);

    // 就位后功能完整：就绪 → 开始 → 提问
    await call("POST", `/api/tables/${tableId}/seat-config`, {
      token: joined.data.token, body: { stance: "答", scope: "任意", ready: true },
    });
    expect((await call("POST", `/api/tables/${tableId}/my/start`, { token: u })).ok).toBe(true);
    expect((await call("POST", `/api/tables/${tableId}/ask`, { token: u, body: { text: "反序就位后提问" } })).ok).toBe(true);
    // 列表/详情双身份标记
    const mine = (await call("GET", "/api/observer/tables", { token: u })).data.tables
      .find((t: { tableId: string }) => t.tableId === tableId);
    expect(mine.mySeatRole).toBe("asker");
    const detail = await call("GET", `/api/observer/tables/${tableId}`, { token: u });
    expect(detail.data.isAsker).toBe(true);
    expect(detail.data.mySeatId).toBe(joined.data.seatId);
  });

  it("边界保持：问询方唯一；非问询方码的重复入席仍被拦", async () => {
    const host = (await call("POST", "/api/users", { body: { name: "双身份-主持人2" } })).data.token;
    const created = await call("POST", "/api/tables", {
      token: host,
      body: { tableType: "inquiry", mode: "hosted", topic: "边界验收", owner: { seatName: "主持人", agentLabel: "web" } },
    });
    const tableId = created.data.tableId;
    const askerCode = created.data.inviteCodes.find((c: { role: string }) => c.role === "asker").code;
    const ansCodes = created.data.inviteCodes.filter((c: { role: string }) => c.role === "answerer");
    const u = (await call("POST", "/api/users", { body: { name: "双身份-边界用户" } })).data.token;
    const v = (await call("POST", "/api/users", { body: { name: "双身份-第二用户" } })).data.token;

    // u 就位问询方后，v 再凭同一码 → asker_exists（唯一性保持）
    expect((await call("POST", `/api/tables/${tableId}/seats`, {
      token: u, body: { inviteCode: askerCode, seatName: "u", role: "asker", agentLabel: "web" },
    })).ok).toBe(true);
    expect((await call("POST", `/api/tables/${tableId}/seats`, {
      token: v, body: { inviteCode: askerCode, seatName: "v", role: "asker", agentLabel: "web" },
    })).error?.code).toBe("asker_exists");

    // u 的 agent 入 answerer 席后，u 再凭第二个 answerer 码入第二席 → already_seated（重复入席限制对普通码保持）
    expect((await call("POST", `/api/tables/${tableId}/seats`, {
      token: u, body: { inviteCode: ansCodes[0].code, seatName: "u-agent", role: "answerer", agentLabel: "zcode" },
    })).ok).toBe(true);
    expect((await call("POST", `/api/tables/${tableId}/seats`, {
      token: u, body: { inviteCode: ansCodes.length > 1 ? ansCodes[1].code : ansCodes[0].code, seatName: "u-第二席", role: "answerer", agentLabel: "zcode" },
    })).error?.code).toBe("already_seated");
  });
});

describe("观察端 UI：问询面板与席位面板共存", () => {
  it("isAsker 不再被 mySeat 屏蔽；两面板独立渲染", () => {
    expect(OBSERVER_HTML).toContain("var isAsker=!!d.isAsker;");
    expect(OBSERVER_HTML).not.toContain("!!d.isAsker&&!mySeat");
    expect(OBSERVER_HTML).not.toContain("} else if(isAsker){"); // 改为独立 if，与席位面板并存
  });
  it("问询面板开始按钮独立 id，绑定两套互不串扰", () => {
    expect(OBSERVER_HTML).toContain('id="inqStart"');
    expect(OBSERVER_HTML).toContain('id="inqStartErr"');
    expect(OBSERVER_HTML).toContain("bindStartBtn('stStart','stErr')");
    expect(OBSERVER_HTML).toContain("bindStartBtn('inqStart','inqStartErr')");
  });
  it("双身份横幅区分提示", () => {
    expect(OBSERVER_HTML).toContain("你在本桌同时持有席位");
  });
});
