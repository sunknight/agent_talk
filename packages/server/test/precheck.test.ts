/**
 * 主持人模式（hosted）+ DeepSeek 预审调度层验收：
 * 建桌（host 席位/三码/host 豁免就绪）→ 预审 pass/redirect/skipped/链上限/目标降级 →
 * SUPPLEMENT 补充闭环 → 原调度恢复；self 模式零预审；伪造 HOST_PREREVIEW 拒绝；
 * in-flight 并发防护；桌设定修改；持久化重开。
 * fetch 直调 REST，预审器注入 fake（不依赖真实 DeepSeek）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start, Store, deepseekPrecheck, type PrecheckInput, type PrecheckOutcome } from "../src";

let base = "";
let http: import("node:http").Server;
let hub: import("../src").Hub;
let dataDir = "";

/** 可编程 fake 预审器：记录输入，按 next 策略返回 */
const fake = {
  calls: [] as PrecheckInput[],
  next: (_i: PrecheckInput): PrecheckOutcome => ({ verdict: "pass", issues: [] }),
  reset() { this.calls = []; this.next = () => ({ verdict: "pass", issues: [] }); },
};
const precheckFn = async (input: PrecheckInput): Promise<PrecheckOutcome> => {
  fake.calls.push(input);
  return fake.next(input);
};

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

async function reg(name: string) {
  return (await call("POST", "/api/users", { body: { name } })).data.token as string;
}

/** 搭一张 hosted 桌：主持人 + 提案方 + 1 评审方，各方就绪，主持人点开始（host 自身不做设定） */
async function quickHosted(topic: string) {
  const hostUser = await reg(`${topic}-host`);
  const created = await call("POST", "/api/tables", {
    token: hostUser,
    body: {
      topic, mode: "hosted", goals: "达成共识", deliverables: "修订文档", rules: "逐条审阅",
      rolePlan: "主持人建桌，Alice 提案，Bob 评审", owner: { seatName: "主持人", agentLabel: "web" },
    },
  });
  expect(created.ok, JSON.stringify(created.error)).toBe(true);
  const { tableId, ownerSeatId, ownerSeatToken, inviteCodes } = created.data;
  const code = (role: string) => inviteCodes.find((c: { role: string }) => c.role === role).code;

  const aliceUser = await reg(`${topic}-alice`);
  const aj = await call("POST", `/api/tables/${tableId}/seats`, {
    token: aliceUser, body: { inviteCode: code("proposer"), seatName: "Alice", role: "proposer", agentLabel: "zcode" },
  });
  expect(aj.ok, JSON.stringify(aj.error)).toBe(true);
  await call("POST", `/api/tables/${tableId}/seat-config`, {
    token: aj.data.token, body: { stancePreset: "req-owner", stance: "需求提出方", ready: true },
  });

  const bobUser = await reg(`${topic}-bob`);
  const bj = await call("POST", `/api/tables/${tableId}/seats`, {
    token: bobUser, body: { inviteCode: code("reviewer"), seatName: "Bob", role: "reviewer", agentLabel: "claude" },
  });
  expect(bj.ok, JSON.stringify(bj.error)).toBe(true);
  await call("POST", `/api/tables/${tableId}/seat-config`, {
    token: bj.data.token, body: { stancePreset: "req-reviewer", stance: "评审方", ready: true },
  });

  const s = await call("POST", `/api/tables/${tableId}/start`, { token: ownerSeatToken });
  expect(s.ok, `host start: ${JSON.stringify(s.error)}`).toBe(true);
  return {
    tableId,
    host: { seatId: ownerSeatId, token: ownerSeatToken, userToken: hostUser },
    alice: { seatId: aj.data.seatId, token: aj.data.token },
    bob: { seatId: bj.data.seatId, token: bj.data.token },
  };
}

async function info(tableId: string, token: string) {
  return (await call("GET", `/api/tables/${tableId}`, { token })).data;
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "rt-precheck-"));
  ({ http, hub } = await start({ port: 0, dataDir, host: "127.0.0.1", precheck: precheckFn }));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => {
  http.closeIdleConnections?.();
  http.close(() => r());
}));

describe("hosted 建桌（host 席位/三码/豁免就绪/传文档）", () => {
  it("主持人建桌：owner 席位为 host、签发 proposer/reviewer/observer 三码、host 不设定即可开始", async () => {
    const t = await quickHosted("hosted-基础");
    const ti = await info(t.tableId, t.alice.token);
    expect(ti.mode).toBe("hosted");
    const hostSeat = ti.seats.find((s: { seatId: string }) => s.seatId === t.host.seatId);
    expect(hostSeat.role).toBe("host");
    expect(hostSeat.caps).toMatchObject({ canVote: false, canPublish: false, canUploadDocs: true });
    expect(ti.phase).toBe("statements"); // host 未做 seat-config 也已开始
    // 邀请码三类齐备
    const inv = (await call("GET", `/api/observer/tables/${t.tableId}/invites`, { token: t.host.userToken })).data.invites as { role: string }[];
    expect(inv.map((i) => i.role).sort()).toEqual(["observer", "proposer", "reviewer"]);
  });

  it("主持人可传共享资料文档；host 不能做入桌设定", async () => {
    const hostUser = await reg("doc-host");
    const created = await call("POST", "/api/tables", {
      token: hostUser,
      body: { topic: "hosted-传文档", mode: "hosted", owner: { seatName: "主持人", agentLabel: "web" } },
    });
    const { tableId, ownerSeatToken } = created.data;
    const up = await call("POST", `/api/tables/${tableId}/documents`, {
      token: ownerSeatToken,
      body: { name: "背景资料.md", purpose: "评审背景", visibility: "shared", contentBase64: b64("# 背景\n需求背景……") },
    });
    expect(up.ok, JSON.stringify(up.error)).toBe(true);
    const cfg = await call("POST", `/api/tables/${tableId}/seat-config`, {
      token: ownerSeatToken, body: { stance: "主持人立场", ready: true },
    });
    expect(cfg.status).toBe(403);
    expect(cfg.error?.code).toBe("role");
  });

  it("桌设定修改：host open 阶段可改规则，非建桌人 403，开始后 409", async () => {
    const hostUser = await reg("cfg-host");
    const created = await call("POST", "/api/tables", {
      token: hostUser,
      body: { topic: "hosted-定规则", mode: "hosted", owner: { seatName: "主持人", agentLabel: "web" } },
    });
    const { tableId, ownerSeatToken } = created.data;
    const bobUser = await reg("cfg-bob");
    const bj = await call("POST", `/api/tables/${tableId}/seats`, {
      token: bobUser, body: { inviteCode: created.data.inviteCodes.find((c: { role: string }) => c.role === "reviewer").code, seatName: "Bob", role: "reviewer", agentLabel: "claude" },
    });
    const no = await call("POST", `/api/tables/${tableId}/table-config`, { token: bj.data.token, body: { rules: "越权改规则" } });
    expect(no.status).toBe(403);
    const yes = await call("POST", `/api/tables/${tableId}/table-config`, { token: ownerSeatToken, body: { rules: "must 意见必须处置", goals: "就 v2 契约达成一致" } });
    expect(yes.ok, JSON.stringify(yes.error)).toBe(true);
    expect(yes.data.rules).toBe("must 意见必须处置");
    // 网页 user token 通道（主持人「定规则」网页入口）同款生效
    const viaMy = await call("POST", `/api/tables/${tableId}/my/table-config`, { token: hostUser, body: { rules: "逐条审阅且 must 必须处置" } });
    expect(viaMy.ok, JSON.stringify(viaMy.error)).toBe(true);
    expect(viaMy.data.rules).toBe("逐条审阅且 must 必须处置");
  });
});

describe("预审调度层", () => {
  it("pass：回合提交过预审后照常推进（HOST_PREREVIEW 入消息流）", async () => {
    fake.reset();
    const t = await quickHosted("预审-pass");
    const pub = await call("POST", `/api/tables/${t.tableId}/artifacts`, {
      token: t.alice.token,
      body: { name: "方案.md", format: "md", contentBase64: b64("# 方案\n……"), changeNote: "v1" },
    });
    expect(pub.ok).toBe(true);
    const st = await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.alice.token, body: { type: "STATEMENT", payload: { text: "提案陈述：见产物 v1，覆盖三项目标。" } },
    });
    expect(st.ok, JSON.stringify(st.error)).toBe(true);
    const ti = await info(t.tableId, t.alice.token);
    expect(ti.phase).toBe("review"); // 预审 pass → 原调度照常推进
    expect(ti.precheck.state).toBe("idle");
    const msgs = (await call("GET", `/api/observer/tables/${t.tableId}`, { token: t.host.userToken })).data.messages as { type: string; payload: any }[];
    const pre = msgs.filter((m) => m.type === "HOST_PREREVIEW").at(-1);
    expect(pre?.payload.verdict).toBe("pass");
    // 预审输入带桌上下文与席位立场
    const input = fake.calls.at(-1)!;
    expect(input.table.topic).toBe("预审-pass");
    expect(input.seat.role).toBe("proposer");
    expect(input.submission.type).toBe("STATEMENT");
  });

  it("redirect：点名席位补充，发言权改授、压住推进；SUPPLEMENT 闭环后恢复原调度", async () => {
    fake.reset();
    const t = await quickHosted("预审-redirect");
    await call("POST", `/api/tables/${t.tableId}/artifacts`, {
      token: t.alice.token,
      body: { name: "方案.md", format: "md", contentBase64: b64("# 方案\n……"), changeNote: "v1" },
    });
    await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.alice.token, body: { type: "STATEMENT", payload: { text: "陈述。" } },
    });
    expect((await info(t.tableId, t.alice.token)).phase).toBe("review");

    // 评审意见将被预审点名：目标 = 提交方 Bob 自己
    fake.next = (i) => ({
      verdict: "redirect",
      targetSeatId: i.seat.name === "Bob" ? i.participants.find((p) => p.name === "Bob")!.seatId : undefined,
      issues: [{ severity: "must", comment: "意见过于笼统，须给出具体定位与依据" }],
      note: "评审意见需补充",
    } as PrecheckOutcome);
    const rc = await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.bob.token,
      body: { type: "REVIEW_COMMENT", payload: { items: [{ id: "r1", target: "方案 §1", severity: "must", comment: "不合理" }] } },
    });
    expect(rc.ok, JSON.stringify(rc.error)).toBe(true);

    const ti = await info(t.tableId, t.bob.token);
    expect(ti.precheck.state).toBe("directive");
    expect(ti.precheck.toSeat).toBe(t.bob.seatId);
    expect(ti.activeTurn?.seatId).toBe(t.bob.seatId); // 发言权改授被点名席
    expect(ti.phase).toBe("review"); // 原推进被压住（未进 response）

    // 点名期：其他回合型提交被拒；讨论类消息（QUESTION）不受限
    const blocked = await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.alice.token, body: { type: "RESPONSE", payload: { items: [{ reviewItemId: "r1", decision: "accept" }] } },
    });
    expect(blocked.status).toBe(409);
    const q = await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.bob.token, body: { type: "QUESTION", payload: { text: "澄清：需要补充到什么程度？" } },
    });
    expect(q.ok).toBe(true);

    // SUPPLEMENT：directiveId 不匹配被拒 → 正确提交 → 闭环、恢复推进
    const bad = await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.bob.token, body: { type: "SUPPLEMENT", payload: { directiveId: "dir_xxx", text: "补充" } },
    });
    expect(bad.status).toBe(422);
    fake.reset(); // 补充本身预审 pass
    const sup = await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.bob.token,
      body: { type: "SUPPLEMENT", payload: { directiveId: ti.precheck.refId, text: "补充：§1 第 3 行契约与目标 2 冲突，依据背景资料 §2，建议改为……" } },
    });
    expect(sup.ok, JSON.stringify(sup.error)).toBe(true);
    const after = await info(t.tableId, t.bob.token);
    expect(after.precheck.state).toBe("idle");
    expect(after.phase).toBe("response"); // 全部评审人已出具意见 → 恢复原调度推进
    expect(fake.calls.at(-1)!.submission.type).toBe("SUPPLEMENT"); // 补充也被预审
  });

  it("链上限：同一提交上连续点名至多 3 次，超出强制放行", async () => {
    fake.reset();
    const t = await quickHosted("预审-链上限");
    await call("POST", `/api/tables/${t.tableId}/artifacts`, {
      token: t.alice.token,
      body: { name: "方案.md", format: "md", contentBase64: b64("# 方案\n……"), changeNote: "v1" },
    });
    // 永远点名提交方自己（proposer Alice）
    fake.next = (i) => ({ verdict: "redirect", targetSeatId: i.participants.find((p) => p.role === "proposer")!.seatId, issues: [{ severity: "must", comment: "还需补充" }] });
    await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.alice.token, body: { type: "STATEMENT", payload: { text: "陈述 v1" } },
    });
    // 指令循环：前 2 次补充被再次点名，第 3 次补充触达链上限被放行
    let ti = await info(t.tableId, t.alice.token);
    let supplements = 0;
    while (ti.precheck.state === "directive" && supplements < 6) {
      await call("POST", `/api/tables/${t.tableId}/messages`, {
        token: t.alice.token, body: { type: "SUPPLEMENT", payload: { directiveId: ti.precheck.refId, text: `第 ${supplements + 1} 次补充` } },
      });
      supplements += 1;
      ti = await info(t.tableId, t.alice.token);
    }
    expect(supplements).toBe(3); // 恰好 3 次点名（1 次初始 + 2 次链式），第 3 次补充放行
    expect(ti.precheck.state).toBe("idle");
    expect(ti.phase).toBe("review");
    const msgs = (await call("GET", `/api/observer/tables/${t.tableId}`, { token: t.host.userToken })).data.messages as { type: string; payload: any }[];
    const last = msgs.filter((m) => m.type === "HOST_PREREVIEW").at(-1);
    expect(last?.payload.verdict).toBe("pass");
    expect(last?.payload.note).toContain("上限");
  });

  it("目标降级：点名对象非法（host 席）→ 改判 pass 放行并标注", async () => {
    fake.reset();
    const t = await quickHosted("预审-降级");
    await call("POST", `/api/tables/${t.tableId}/artifacts`, {
      token: t.alice.token,
      body: { name: "方案.md", format: "md", contentBase64: b64("# 方案\n……"), changeNote: "v1" },
    });
    fake.next = () => ({ verdict: "redirect", targetSeatId: t.host.seatId, issues: [{ severity: "must", comment: "x" }] });
    await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.alice.token, body: { type: "STATEMENT", payload: { text: "陈述。" } },
    });
    const ti = await info(t.tableId, t.alice.token);
    expect(ti.precheck.state).toBe("idle"); // 降级 pass
    expect(ti.phase).toBe("review");
    const msgs = (await call("GET", `/api/observer/tables/${t.tableId}`, { token: t.host.userToken })).data.messages as { type: string; payload: any }[];
    const last = msgs.filter((m) => m.type === "HOST_PREREVIEW").at(-1);
    expect(last?.payload.verdict).toBe("pass");
    expect(last?.payload.note).toContain("点名对象无效");
  });

  it("skipped 兜底：预审器抛异常 → 放行 + 标注，不阻塞推进", async () => {
    fake.reset();
    const t = await quickHosted("预审-skipped");
    await call("POST", `/api/tables/${t.tableId}/artifacts`, {
      token: t.alice.token,
      body: { name: "方案.md", format: "md", contentBase64: b64("# 方案\n……"), changeNote: "v1" },
    });
    fake.next = () => { throw new Error("boom"); };
    const st = await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.alice.token, body: { type: "STATEMENT", payload: { text: "陈述。" } },
    });
    expect(st.ok, JSON.stringify(st.error)).toBe(true);
    const ti = await info(t.tableId, t.alice.token);
    expect(ti.phase).toBe("review");
    const msgs = (await call("GET", `/api/observer/tables/${t.tableId}`, { token: t.host.userToken })).data.messages as { type: string; payload: any }[];
    const last = msgs.filter((m) => m.type === "HOST_PREREVIEW").at(-1);
    expect(last?.payload.verdict).toBe("skipped");
  });

  it("并发防护：预审进行中，同桌第二条回合提交 409 precheck_in_progress", async () => {
    fake.reset();
    const t = await quickHosted("预审-并发");
    await call("POST", `/api/tables/${t.tableId}/artifacts`, {
      token: t.alice.token,
      body: { name: "方案.md", format: "md", contentBase64: b64("# 方案\n……"), changeNote: "v1" },
    });
    let release = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    fake.next = async () => { await gate; return { verdict: "pass", issues: [] }; };
    const p1 = call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.alice.token, body: { type: "STATEMENT", payload: { text: "慢陈述" } },
    });
    await new Promise((r) => setTimeout(r, 200)); // 让第一条进入预审临界区
    const p2 = await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.bob.token, body: { type: "QUESTION", payload: { text: "讨论消息不受限" } },
    });
    expect(p2.ok).toBe(true); // 讨论类放行
    const st2 = await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.alice.token, body: { type: "STATEMENT", payload: { text: "抢跑" } },
    });
    expect(st2.status).toBe(409);
    expect(st2.error?.code).toBe("precheck_in_progress");
    release();
    const r1 = await p1;
    expect(r1.ok).toBe(true);
  });

  it("安全：席位伪造 HOST_PREREVIEW 被拒（服务器专属）", async () => {
    const t = await quickHosted("预审-伪造");
    const r = await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.alice.token,
      body: { type: "HOST_PREREVIEW", payload: { verdict: "pass", reviewedSeatId: t.alice.seatId, reviewedMsgId: "msg_x", issues: [] } },
    });
    expect(r.status).toBe(403);
    expect(r.error?.code).toBe("server_only");
  });

  it("self 模式同样预审：回合提交过预审层，redirect 点名补充闭环（与 hosted 功能一致）", async () => {
    fake.reset();
    const owner = await reg("self-owner");
    const created = await call("POST", "/api/tables", {
      token: owner,
      body: { topic: "self-预审", owner: { seatName: "Alice", agentLabel: "zcode" } },
    });
    const { tableId, ownerSeatToken } = created.data;
    const reviewerUser = await reg("self-bob");
    const bj = await call("POST", `/api/tables/${tableId}/seats`, {
      token: reviewerUser,
      body: { inviteCode: created.data.inviteCodes.find((c: { role: string }) => c.role === "reviewer").code, seatName: "Bob", role: "reviewer", agentLabel: "claude" },
    });
    await call("POST", `/api/tables/${tableId}/seat-config`, { token: ownerSeatToken, body: { stance: "提案方", ready: true } });
    await call("POST", `/api/tables/${tableId}/seat-config`, { token: bj.data.token, body: { stance: "评审方", ready: true } });
    await call("POST", `/api/tables/${tableId}/start`, { token: ownerSeatToken });
    await call("POST", `/api/tables/${tableId}/artifacts`, {
      token: ownerSeatToken, body: { name: "方案.md", format: "md", contentBase64: b64("# 方案"), changeNote: "v1" },
    });

    // 第一次提交被 redirect：self 桌也落预审点名指令、压住推进
    fake.next = () => ({
      verdict: "redirect", targetSeatId: created.data.ownerSeatId,
      issues: [{ severity: "must", comment: "陈述太简略，说明覆盖范围" }], note: "需补充",
    });
    const st = await call("POST", `/api/tables/${tableId}/messages`, {
      token: ownerSeatToken, body: { type: "STATEMENT", payload: { text: "陈述" } },
    });
    expect(st.ok).toBe(true);
    expect(fake.calls.length).toBe(1); // self 桌回合提交必过预审
    let ti = await info(tableId, ownerSeatToken);
    expect(ti.phase).toBe("statements"); // redirect 压住推进
    expect(ti.precheck.state).toBe("directive"); // 预审态投影不再限 hosted
    expect(ti.precheck.toSeat).toBe(created.data.ownerSeatId);

    // SUPPLEMENT 补充（预审 pass）后照常推进
    fake.next = () => ({ verdict: "pass", issues: [], note: "ok" });
    const sup = await call("POST", `/api/tables/${tableId}/messages`, {
      token: ownerSeatToken,
      body: { type: "SUPPLEMENT", payload: { directiveId: ti.precheck.refId, text: "补充：覆盖 A/B 两模块" } },
    });
    expect(sup.ok, JSON.stringify(sup.error)).toBe(true);
    ti = await info(tableId, ownerSeatToken);
    expect(ti.phase).toBe("review"); // 补充通过后按原调度推进
    expect(ti.precheck.state).toBe("idle");
  });

  it("持久化：mode 与指令落库，重开 Store 可读", async () => {
    const t = await quickHosted("预审-持久化");
    const meta = hub.store.getTable(t.tableId);
    expect(meta?.mode).toBe("hosted");
    const s2 = new Store(dataDir);
    expect(s2.getTable(t.tableId)?.mode).toBe("hosted");
    s2.close();
  });
});

describe("deepseekPrecheck 单元（fail-open）", () => {
  it("未配置 DEEPSEEK_API_KEY → skipped 放行", async () => {
    const had = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    const out = await deepseekPrecheck({
      table: { topic: "t", goals: "", deliverables: "", rules: "", rolePlan: "", sharedDocs: [] },
      seat: { name: "A", role: "proposer", stance: "", scope: "" },
      submission: { msgId: "m", type: "STATEMENT", payload: { text: "x" } },
      history: [],
      participants: [],
    });
    expect(out.verdict).toBe("skipped");
    expect(out.note).toContain("DEEPSEEK_API_KEY");
    if (had !== undefined) process.env.DEEPSEEK_API_KEY = had;
  });
});
