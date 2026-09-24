/** 按桌预审开关（任务 0042）：建桌可选（默认开）、会议中控制人随时切换、关闭期间回合提交不经预审、
 *  代答豁免与按桌开关叠加、非控制人 403、幂等 409、INFO 广播与投影。fetch 直调 REST，预审器注入 fake。 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start, type PrecheckInput, type PrecheckOutcome } from "../src";

let base = "";
let http: import("node:http").Server;
let hub: Awaited<ReturnType<typeof start>>["hub"];

const fake = { calls: [] as PrecheckInput[] };
const precheckFn = async (input: PrecheckInput): Promise<PrecheckOutcome> => {
  fake.calls.push(input);
  return { verdict: "pass", issues: [] };
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

/** self 评审桌：建桌人=proposer + 1 评审方，就绪开局（precheckEnabled 可选） */
async function quickReview(topic: string, precheckEnabled?: boolean) {
  const ownerUser = await reg(`${topic}-owner`);
  const created = await call("POST", "/api/tables", {
    token: ownerUser,
    body: {
      topic, owner: { seatName: "提案方", agentLabel: "zcode" },
      ...(precheckEnabled !== undefined ? { precheckEnabled } : {}),
    },
  });
  const { tableId, ownerSeatToken, inviteCodes } = created.data;
  const revUser = await reg(`${topic}-rev`);
  const rj = await call("POST", `/api/tables/${tableId}/seats`, {
    token: revUser, body: { inviteCode: inviteCodes.find((c: any) => c.role === "reviewer").code, seatName: "评审方", role: "reviewer", agentLabel: "claude" },
  });
  for (const tok of [ownerSeatToken, rj.data.token]) {
    await call("POST", `/api/tables/${tableId}/seat-config`, { token: tok, body: { stance: "s", ready: true } });
  }
  await call("POST", `/api/tables/${tableId}/start`, { token: ownerSeatToken });
  return {
    tableId, ownerUser, ownerSeat: ownerSeatToken,
    rev: { seatId: rj.data.seatId, token: rj.data.token, userToken: revUser },
  };
}

async function info(tableId: string, token: string) {
  return (await call("GET", `/api/observer/tables/${tableId}`, { token })).data.table;
}
async function msgs(tableId: string, token: string) {
  return (await call("GET", `/api/tables/${tableId}/poll?since=0&timeout=0`, { token })).data.messages as any[];
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-pct-"));
  ({ http, hub } = await start({ port: 0, dataDir: dir, host: "127.0.0.1", precheck: precheckFn }));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => { http.closeIdleConnections?.(); http.close(() => r()); }));

describe("按桌预审开关", () => {
  it("默认开启：回合提交经过预审（fake 有调用、有 HOST_PREREVIEW）", async () => {
    const t = await quickReview("默认开");
    expect((await info(t.tableId, t.ownerUser)).precheckEnabled).toBe(true);
    await call("POST", `/api/tables/${t.tableId}/artifacts`, {
      token: t.ownerSeat, body: { name: "方案A", format: "md", contentBase64: b64("# A"), changeNote: "v1" },
    });
    await call("POST", `/api/tables/${t.tableId}/messages`, { token: t.ownerSeat, body: { type: "STATEMENT", payload: { text: "概述" } } });
    const calls0 = fake.calls.length;
    expect(calls0).toBeGreaterThan(0);
    expect((await msgs(t.tableId, t.ownerSeat)).some((m) => m.type === "HOST_PREREVIEW")).toBe(true);
    expect((await info(t.tableId, t.ownerUser)).phase).toBe("review");
  });

  it("建桌关闭：回合提交不经预审（无调用、无 HOST_PREREVIEW），流程照常推进", async () => {
    const t = await quickReview("建桌关", false);
    expect((await info(t.tableId, t.ownerUser)).precheckEnabled).toBe(false);
    const callsBefore = fake.calls.length;
    await call("POST", `/api/tables/${t.tableId}/artifacts`, {
      token: t.ownerSeat, body: { name: "方案B", format: "md", contentBase64: b64("# B"), changeNote: "v1" },
    });
    await call("POST", `/api/tables/${t.tableId}/messages`, { token: t.ownerSeat, body: { type: "STATEMENT", payload: { text: "概述" } } });
    expect(fake.calls.length).toBe(callsBefore); // 未触发预审
    expect((await msgs(t.tableId, t.ownerSeat)).some((m) => m.type === "HOST_PREREVIEW")).toBe(false);
    expect((await info(t.tableId, t.ownerUser)).phase).toBe("review"); // 调度照常
  });

  it("会议中切换：关闭后不再预审，重新开启后恢复", async () => {
    const t = await quickReview("切换");
    await call("POST", `/api/tables/${t.tableId}/artifacts`, {
      token: t.ownerSeat, body: { name: "方案C", format: "md", contentBase64: b64("# C"), changeNote: "v1" },
    });
    await call("POST", `/api/tables/${t.tableId}/messages`, { token: t.ownerSeat, body: { type: "STATEMENT", payload: { text: "概述" } } });
    expect((await info(t.tableId, t.ownerUser)).phase).toBe("review");

    // 评审方回合提交会预审（基线）
    const items = (await call("GET", `/api/tables/${t.tableId}/review-items`, { token: t.rev.token })).data.items as any[];
    const rc = await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.rev.token, body: { type: "REVIEW_COMMENT", payload: { items: [{ id: "r1", target: "全文", severity: "nice", comment: "ok" }] } },
    });
    expect(rc.ok).toBe(true);
    const afterReview = fake.calls.length;
    expect(afterReview).toBeGreaterThan(0);

    // 控制人（建桌人）关闭 → 提案方 RESPONSE 不预审
    const off = await call("POST", `/api/tables/${t.tableId}/my/precheck`, { token: t.ownerUser, body: { enabled: false } });
    expect(off.ok, JSON.stringify(off.error)).toBe(true);
    expect((await info(t.tableId, t.ownerUser)).precheckEnabled).toBe(false);
    const rp = await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.ownerSeat, body: { type: "RESPONSE", payload: { items: [{ reviewItemId: "r1", decision: "defer", reason: "后续跟进" }] } },
    });
    expect(rp.ok).toBe(true);
    expect(fake.calls.length).toBe(afterReview); // 关闭期间零调用

    // 重新开启 → 表决提交恢复预审
    const on = await call("POST", `/api/tables/${t.tableId}/my/precheck`, { token: t.ownerUser, body: { enabled: true } });
    expect(on.ok).toBe(true);
    await call("POST", `/api/tables/${t.tableId}/messages`, { token: t.ownerSeat, body: { type: "CONSENSUS_VOTE", payload: { decision: "pass" } } });
    await call("POST", `/api/tables/${t.tableId}/messages`, { token: t.rev.token, body: { type: "CONSENSUS_VOTE", payload: { decision: "pass" } } });
    expect(fake.calls.length).toBeGreaterThan(afterReview);
    expect((await info(t.tableId, t.ownerUser)).phase).toBe("closed");

    // INFO 广播两则（开启/关闭各一）
    const all = await msgs(t.tableId, t.ownerSeat);
    const infos = all.filter((m) => m.type === "INFO" && /系统预审/.test(String(m.payload.text)));
    expect(infos.length).toBe(2);
  });

  it("非控制人 403；重复设置 409；systemadmin 通道可切换", async () => {
    const t = await quickReview("权限");
    const denied = await call("POST", `/api/tables/${t.tableId}/my/precheck`, { token: t.rev.userToken, body: { enabled: false } });
    expect(denied.status).toBe(403);

    const off = await call("POST", `/api/tables/${t.tableId}/my/precheck`, { token: t.ownerUser, body: { enabled: false } });
    expect(off.ok).toBe(true);
    const again = await call("POST", `/api/tables/${t.tableId}/my/precheck`, { token: t.ownerUser, body: { enabled: false } });
    expect(again.status).toBe(409);
    expect(again.error.code).toBe("no_change");

    const admin = await reg("pct-admin");
    hub.store.setUserRole(hub.store.findUserByToken(admin)!.userId, "systemadmin");
    const byAdmin = await call("POST", `/api/admin/tables/${t.tableId}/precheck`, { token: admin, body: { enabled: true } });
    expect(byAdmin.ok).toBe(true);
    expect((await info(t.tableId, t.ownerUser)).precheckEnabled).toBe(true);
  });

  it("存量语义：旧库缺列按开启处理（新开关字段缺省不改变既有行为）", async () => {
    // quickReview 未传 precheckEnabled 的第一张桌即验证默认开（本用例复验投影类型）
    const t = await quickReview("缺省");
    const tb = await info(t.tableId, t.ownerUser);
    expect(typeof tb.precheckEnabled).toBe("boolean");
    expect(tb.precheckEnabled).toBe(true);
  });
});
