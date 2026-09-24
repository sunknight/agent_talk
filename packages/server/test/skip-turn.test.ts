/** 跳过当前发言人 + 代答豁免预审（任务 0041）：
 *  - 人工代答（human_proxied）回合消息不再过系统预审（被点名后网页代答 SUPPLEMENT 直接闭环）；
 *  - 控制人（建桌人/主持人/系统管理员，问询桌含问询方）可跳过当前回合发言人：
 *    预审点名挂起=解除按原提交放行；review/qa=该席本轮视为已处理；execution=请求按拒绝收口；convergence=弃权计票。
 *  fetch 直调 REST，预审器注入 fake。 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start, type PrecheckInput, type PrecheckOutcome } from "../src";

let base = "";
let http: import("node:http").Server;
let hub: import("../src").Hub;

/** 可编程 fake 预审器：verdict 可切换（默认 pass） */
const fake = {
  calls: [] as PrecheckInput[],
  verdict: "pass" as "pass" | "redirect",
  targetSeatId: undefined as string | undefined,
  reset(verdict: "pass" | "redirect" = "pass") { this.calls = []; this.verdict = verdict; this.targetSeatId = undefined; },
};
const precheckFn = async (input: PrecheckInput): Promise<PrecheckOutcome> => {
  fake.calls.push(input);
  return fake.verdict === "redirect"
    ? { verdict: "redirect", issues: [{ severity: "must", comment: "依据不足" }], targetSeatId: input.participants.find((p) => p.role === "proposer")!.seatId, note: "fake 点名提案方" }
    : { verdict: "pass", issues: [] };
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

/** hosted 桌：主持人 + Alice(proposer) + Bob(reviewer)，就绪开局 */
async function quickHosted(topic: string) {
  const hostUser = await reg(`${topic}-host`);
  const created = await call("POST", "/api/tables", {
    token: hostUser,
    body: { topic, mode: "hosted", owner: { seatName: "主持人", agentLabel: "web" } },
  });
  const { tableId, ownerSeatToken, inviteCodes } = created.data;
  const code = (role: string) => inviteCodes.find((c: { role: string }) => c.role === role).code;
  const aliceUser = await reg(`${topic}-alice`);
  const aj = await call("POST", `/api/tables/${tableId}/seats`, {
    token: aliceUser, body: { inviteCode: code("proposer"), seatName: "Alice", role: "proposer", agentLabel: "zcode" },
  });
  await call("POST", `/api/tables/${tableId}/seat-config`, { token: aj.data.token, body: { stance: "提案方", ready: true } });
  const bobUser = await reg(`${topic}-bob`);
  const bj = await call("POST", `/api/tables/${tableId}/seats`, {
    token: bobUser, body: { inviteCode: code("reviewer"), seatName: "Bob", role: "reviewer", agentLabel: "claude" },
  });
  await call("POST", `/api/tables/${tableId}/seat-config`, { token: bj.data.token, body: { stance: "评审方", ready: true } });
  await call("POST", `/api/tables/${tableId}/start`, { token: ownerSeatToken });
  return {
    tableId,
    hostUser,
    alice: { seatId: aj.data.seatId, token: aj.data.token, userToken: aliceUser },
    bob: { seatId: bj.data.seatId, token: bj.data.token, userToken: bobUser },
  };
}

/** 桌况（观察端接口：host 只有 user token 无席位 token，GET /api/tables/:id 会 401） */
async function info(tableId: string, token: string) {
  return (await call("GET", `/api/observer/tables/${tableId}`, { token })).data.table;
}
async function publishArtifact(tableId: string, seatToken: string, name: string) {
  const r = await call("POST", `/api/tables/${tableId}/artifacts`, {
    token: seatToken,
    body: { name, format: "md", contentBase64: b64(`# ${name}\n初稿内容`), changeNote: "初稿" },
  });
  expect(r.ok, JSON.stringify(r.error)).toBe(true);
  return r.data.artifactId as string;
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-skip-"));
  ({ http, hub } = await start({ port: 0, dataDir: dir, host: "127.0.0.1", precheck: precheckFn }));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => { http.closeIdleConnections?.(); http.close(() => r()); }));

describe("人工代答豁免预审", () => {
  it("被点名后网页代答 SUPPLEMENT 不再触发预审，直接闭环推进", async () => {
    fake.reset("redirect");
    const t = await quickHosted("豁免");
    await publishArtifact(t.tableId, t.alice.token, "豁免-方案");
    const st = await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.alice.token, body: { type: "STATEMENT", payload: { text: "概述" } },
    });
    expect(st.ok, JSON.stringify(st.error)).toBe(true);
    let tb = await info(t.tableId, t.hostUser);
    expect(tb.phase).toBe("statements"); // 被点名压住推进
    expect(tb.precheck.state).toBe("directive");
    const callsBefore = fake.calls.length;

    // Alice 持有人从网页代答 SUPPLEMENT（human_proxied）：不进 fake 预审
    const sup = await call("POST", `/api/tables/${t.tableId}/my/message`, {
      token: t.alice.userToken,
      body: { type: "SUPPLEMENT", payload: { directiveId: tb.precheck.refId, text: "补充说明（人工）" } },
    });
    expect(sup.ok, JSON.stringify(sup.error)).toBe(true);
    expect(fake.calls.length).toBe(callsBefore); // 代答未触发预审
    tb = await info(t.tableId, t.hostUser);
    expect(tb.phase).toBe("review"); // 指令闭合 + 原调度推进
    expect(tb.precheck.state).toBe("idle");
    // 消息 flags 带 human_proxied 标记
    const msgs = (await call("GET", `/api/tables/${t.tableId}/poll?since=0&timeout=0`, { token: t.alice.token })).data.messages as any[];
    const supMsg = msgs.find((m) => m.type === "SUPPLEMENT");
    expect(supMsg.flags).toContain("human_proxied");
  });
});

describe("控制人跳过当前发言人", () => {
  it("预审点名挂起：主持人跳过 → 点名解除、按原提交放行", async () => {
    fake.reset("redirect");
    const t = await quickHosted("点名跳过");
    await publishArtifact(t.tableId, t.alice.token, "点名-方案");
    await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.alice.token, body: { type: "STATEMENT", payload: { text: "概述" } },
    });
    let tb = await info(t.tableId, t.hostUser);
    expect(tb.phase).toBe("statements");
    expect(tb.precheck.state).toBe("directive");

    const sk = await call("POST", `/api/tables/${t.tableId}/my/skip-turn`, { token: t.hostUser, body: { reason: "无响应" } });
    expect(sk.ok, JSON.stringify(sk.error)).toBe(true);
    tb = await info(t.tableId, t.hostUser);
    expect(tb.phase).toBe("review"); // 原提交放行推进
    expect(tb.precheck.state).toBe("idle");
    const msgs = (await call("GET", `/api/tables/${t.tableId}/poll?since=0&timeout=0`, { token: t.bob.token })).data.messages as any[];
    expect(msgs.some((m) => m.type === "TURN_SKIPPED" && m.payload.seatId === t.alice.seatId)).toBe(true);
  });

  it("review 阶段：跳过当前发言的评审方 → 视为已出意见，进 response", async () => {
    fake.reset("pass");
    const t = await quickHosted("评审跳过");
    await publishArtifact(t.tableId, t.alice.token, "评审-方案");
    await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.alice.token, body: { type: "STATEMENT", payload: { text: "概述" } },
    });
    let tb = await info(t.tableId, t.hostUser);
    expect(tb.phase).toBe("review");
    expect(tb.activeTurn.seatId).toBe(t.bob.seatId);

    // 非控制人 403
    const denied = await call("POST", `/api/tables/${t.tableId}/my/skip-turn`, { token: t.alice.userToken, body: {} });
    expect(denied.status).toBe(403);

    const sk = await call("POST", `/api/tables/${t.tableId}/my/skip-turn`, { token: t.hostUser, body: {} });
    expect(sk.ok).toBe(true);
    tb = await info(t.tableId, t.hostUser);
    expect(tb.phase).toBe("response");
    expect(tb.activeTurn.seatId).toBe(t.alice.seatId); // 回应轮到提案方
  });

  it("execution：跳过 → 请求按拒绝收口，进 convergence；convergence 跳过=弃权计票", async () => {
    fake.reset("pass");
    const t = await quickHosted("执行跳过");
    const artifactId = await publishArtifact(t.tableId, t.alice.token, "执行-方案");
    await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.alice.token, body: { type: "STATEMENT", payload: { text: "概述" } },
    });
    // Bob 评审出一条 must 意见（items[].id 由评审方生成）
    const rc = await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.bob.token,
      body: { type: "REVIEW_COMMENT", payload: { items: [{ id: "r1", severity: "must", comment: "补充依据", target: "全文" }] } },
    });
    expect(rc.ok, JSON.stringify(rc.error)).toBe(true);
    // Alice 回应 accept 委托自己改（executeBy:self 派生请求）
    const rp = await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.alice.token,
      body: { type: "RESPONSE", payload: { items: [{ reviewItemId: "r1", decision: "accept", reason: "认领", action: { executeBy: "self" } }] } },
    });
    expect(rp.ok, JSON.stringify(rp.error)).toBe(true);
    let tb = await info(t.tableId, t.hostUser);
    expect(tb.phase).toBe("execution");
    expect(tb.activeTurn.seatId).toBe(t.alice.seatId);

    // 跳过执行：请求置 rejected → convergence
    const sk = await call("POST", `/api/tables/${t.tableId}/my/skip-turn`, { token: t.hostUser, body: { reason: "无响应" } });
    expect(sk.ok).toBe(true);
    tb = await info(t.tableId, t.hostUser);
    expect(tb.phase).toBe("convergence");
    const reqs = (await call("GET", `/api/tables/${t.tableId}/requests`, { token: t.alice.token })).data.requests as any[];
    expect(reqs[0].status).toBe("rejected");

    // convergence：轮到 Alice（先入席）投表决 → 跳过（弃权）→ Bob 投 pass → 弃权不否决，通过闭桌
    expect(tb.activeTurn.seatId).toBe(t.alice.seatId);
    const sk2 = await call("POST", `/api/tables/${t.tableId}/my/skip-turn`, { token: t.hostUser, body: {} });
    expect(sk2.ok).toBe(true);
    const vote = await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.bob.token, body: { type: "CONSENSUS_VOTE", payload: { decision: "pass" } },
    });
    expect(vote.ok, JSON.stringify(vote.error)).toBe(true);
    tb = await info(t.tableId, t.hostUser);
    expect(tb.phase).toBe("closed");
    const result = (await call("GET", `/api/tables/${t.tableId}/poll?since=0&timeout=0`, { token: t.alice.token })).data.messages as any[];
    const cr = result.find((m) => m.type === "CONSENSUS_RESULT");
    expect(cr.payload.pass).toBe(true);
    expect(cr.payload.tally[t.bob.seatId].decision).toBe("pass"); // 弃权席不进 tally
  });

  it("open 阶段无可跳过 409；systemadmin 通道可跳过", async () => {
    fake.reset("pass");
    const hostUser = await reg("管理员跳过-host");
    const created = await call("POST", "/api/tables", {
      token: hostUser, body: { topic: "管理员跳过桌", owner: { seatName: "建桌人", agentLabel: "web" } },
    });
    const { tableId, ownerSeatToken } = created.data;
    const bad = await call("POST", `/api/tables/${tableId}/my/skip-turn`, { token: hostUser, body: {} });
    expect(bad.status).toBe(409);
    expect(bad.error.code).toBe("not_meeting");

    // systemadmin 通道：建到 review 后 admin 跳过评审方
    const bobUser = await reg("管理员跳过-bob");
    const bj = await call("POST", `/api/tables/${tableId}/seats`, {
      token: bobUser, body: { inviteCode: created.data.inviteCodes.find((c: any) => c.role === "reviewer").code, seatName: "Bob", role: "reviewer", agentLabel: "claude" },
    });
    await call("POST", `/api/tables/${tableId}/seat-config`, { token: bj.data.token, body: { stance: "评审", ready: true } });
    await call("POST", `/api/tables/${tableId}/seat-config`, { token: ownerSeatToken, body: { stance: "提案", ready: true } });
    await call("POST", `/api/tables/${tableId}/start`, { token: ownerSeatToken });
    const artifactId = await publishArtifact(tableId, ownerSeatToken, "管理员-方案");
    await call("POST", `/api/tables/${tableId}/messages`, {
      token: ownerSeatToken, body: { type: "STATEMENT", payload: { text: "概述" } },
    });
    const tb = await info(tableId, hostUser);
    expect(tb.phase).toBe("review");

    const admin = await reg("skip-admin");
    hub.store.setUserRole(hub.store.findUserByToken(admin)!.userId, "systemadmin");
    const sk = await call("POST", `/api/admin/tables/${tableId}/skip-turn`, { token: admin, body: { reason: "admin 跳过" } });
    expect(sk.ok, JSON.stringify(sk.error)).toBe(true);
    expect((await info(tableId, hostUser)).phase).toBe("response");
  });
});

describe("问询桌跳过回答方", () => {
  it("广播问题：跳过第一个应答席 → 发言权给下一回答席", async () => {
    const asker = await reg("跳过-asker");
    const created = await call("POST", "/api/tables", {
      token: asker, body: { tableType: "inquiry", topic: "跳过问询桌", owner: { seatName: "问询方", agentLabel: "web" } },
    });
    const { tableId, inviteCodes } = created.data;
    const code = inviteCodes.find((c: any) => c.role === "answerer").code;
    const ansTokens: string[] = [];
    for (const n of ["答1", "答2"]) {
      const u = await reg(`跳过-${n}`);
      const j = await call("POST", `/api/tables/${tableId}/seats`, {
        token: u, body: { inviteCode: code, seatName: n, role: "answerer", agentLabel: "zcode" },
      });
      await call("POST", `/api/tables/${tableId}/seat-config`, { token: j.data.token, body: { stance: "答", scope: "全范围", ready: true } });
      ansTokens.push(j.data.token);
    }
    await call("POST", `/api/tables/${tableId}/my/start`, { token: asker });
    await call("POST", `/api/tables/${tableId}/ask`, { token: asker, body: { text: "什么是跳过机制？" } });
    let tb = await info(tableId, asker);
    const first = tb.activeTurn.seatId;

    const sk = await call("POST", `/api/tables/${tableId}/my/skip-turn`, { token: asker, body: {} });
    expect(sk.ok, JSON.stringify(sk.error)).toBe(true);
    tb = await info(tableId, asker);
    expect(tb.activeTurn.seatId).not.toBe(first); // 轮到第二回答席
    expect(tb.activeTurn.toMsgId).toBeTruthy(); // grant 带待答问题 msgId
    // 被跳过席对该问题弃答：答2 正常作答不受影响
    const ans2 = await call("POST", `/api/tables/${tableId}/messages`, {
      token: ansTokens[1], body: { type: "REPLY", payload: { toMsgId: tb.activeTurn.toMsgId, text: "回答" } },
    });
    expect(ans2.ok, JSON.stringify(ans2.error)).toBe(true);
  });
});
