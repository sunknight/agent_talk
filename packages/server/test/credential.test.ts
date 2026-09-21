/**
 * 参会凭证恢复与 agent 替代：
 * recover（新凭证可用、旧凭证保留）/ replace（旧 token 401 吊销、agentLabel 更新、INFO 广播）、
 * my 通道无越权面 / 非 admin 403 / systemadmin 任意席位 / 非法 mode 422 /
 * closed 桌可恢复 / left 席位 409。fetch 直调 REST，零 mock。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start, type Hub } from "../src";

let base = "";
let http: import("node:http").Server;
let hub: Hub;

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
  const dir = mkdtempSync(join(tmpdir(), "rt-cred-test-"));
  ({ http, hub } = await start({ port: 0, dataDir: dir, host: "127.0.0.1" }));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => {
  http.closeIdleConnections?.();
  http.close(() => r());
}));

describe("参会凭证恢复与 agent 替代", () => {
  let tableId = "";
  let ownerUserId = "", ownerUser = "", ownerSeatId = "", ownerSeatToken = "";
  let reviewerSeatId = "", reviewerToken = "";

  it("建桌与评审入席", async () => {
    const reg = await call("POST", "/api/users", { body: { name: "凭证-建桌人" } });
    ownerUserId = reg.data.userId; ownerUser = reg.data.token;
    const created = await call("POST", "/api/tables", {
      token: ownerUser,
      body: { topic: "凭证恢复验证桌", owner: { seatName: "建桌人", agentLabel: "zcode" } },
    });
    tableId = created.data.tableId;
    ownerSeatId = created.data.ownerSeatId;
    ownerSeatToken = created.data.ownerSeatToken;
    const rc = created.data.inviteCodes.find((c: { role: string }) => c.role === "reviewer").code;
    const ru = (await call("POST", "/api/users", { body: { name: "凭证-评审人" } })).data.token;
    const rj = await call("POST", `/api/tables/${tableId}/seats`, {
      token: ru, body: { inviteCode: rc, seatName: "评审人", role: "reviewer", agentLabel: "claude" },
    });
    expect(rj.ok).toBe(true);
    reviewerSeatId = rj.data.seatId; reviewerToken = rj.data.token;
  });

  it("recover：签发新凭证、旧凭证保留有效（多凭证并存）", async () => {
    const r = await call("POST", `/api/tables/${tableId}/my/seat-token`, {
      token: ownerUser, body: { mode: "recover" },
    });
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect(r.data.token).toMatch(/^rts_/);
    expect(r.data.seat.seatId).toBe(ownerSeatId);

    const byNew = await call("GET", `/api/tables/${tableId}/poll?since=0&timeout=0`, { token: r.data.token });
    expect(byNew.ok).toBe(true);
    const byOld = await call("GET", `/api/tables/${tableId}/poll?since=0&timeout=0`, { token: ownerSeatToken });
    expect(byOld.ok).toBe(true);
  });

  it("replace：旧凭证立即 401 吊销、agentLabel 更新、全桌收到轮换通知", async () => {
    const r = await call("POST", `/api/tables/${tableId}/my/seat-token`, {
      token: ownerUser, body: { mode: "replace", agentLabel: "newbot" },
    });
    expect(r.ok).toBe(true);
    const newToken = r.data.token;

    const old = await call("GET", `/api/tables/${tableId}/poll?since=0&timeout=0`, { token: ownerSeatToken });
    expect(old.status).toBe(401);
    expect(old.error?.code).toBe("unauthorized");

    const byNew = await call("GET", `/api/tables/${tableId}`, { token: newToken });
    expect(byNew.ok).toBe(true);
    expect(byNew.data.seats.find((s: any) => s.seatId === ownerSeatId).agentLabel).toBe("newbot");

    const seen = await call("GET", `/api/tables/${tableId}/poll?since=0&timeout=0`, { token: newToken });
    const info = seen.data.messages.filter((m: any) => m.type === "INFO").at(-1);
    expect(info?.payload?.text).toContain("凭证已轮换");
    ownerSeatToken = newToken; // 后续用新凭证
  });

  it("非法 mode 422；无席位用户 403", async () => {
    const bad = await call("POST", `/api/tables/${tableId}/my/seat-token`, {
      token: ownerUser, body: { mode: "hack" },
    });
    expect(bad.status).toBe(422);

    const stranger = (await call("POST", "/api/users", { body: { name: "无席位者" } })).data.token;
    const noSeat = await call("POST", `/api/tables/${tableId}/my/seat-token`, {
      token: stranger, body: { mode: "recover" },
    });
    expect(noSeat.status).toBe(403);
    expect(noSeat.error?.code).toBe("no_seat");
  });

  it("非 systemadmin 调 admin 路由 403；admin 可为任意席位替代（原 agent 禁用）", async () => {
    const denied = await call("POST", `/api/admin/tables/${tableId}/seats/${reviewerSeatId}/token`, {
      token: ownerUser, body: { mode: "replace" },
    });
    expect(denied.status).toBe(403);
    expect(denied.error?.code).toBe("not_admin");

    hub.store.setUserRole(ownerUserId, "systemadmin");
    const r = await call("POST", `/api/admin/tables/${tableId}/seats/${reviewerSeatId}/token`, {
      token: ownerUser, body: { mode: "replace", agentLabel: "claude2" },
    });
    expect(r.ok, JSON.stringify(r.error)).toBe(true);

    const old = await call("GET", `/api/tables/${tableId}/poll?since=0&timeout=0`, { token: reviewerToken });
    expect(old.status).toBe(401);
    const byNew = await call("GET", `/api/tables/${tableId}`, { token: r.data.token });
    expect(byNew.data.seats.find((s: any) => s.seatId === reviewerSeatId).agentLabel).toBe("claude2");
  });

  it("left 席位不能恢复（409）；closed 桌仍可恢复凭证（拉纪要身份）", async () => {
    const rc2 = (await call("GET", `/api/observer/tables/${tableId}/invites`, { token: ownerUser }))
      .data.invites.find((i: any) => i.role === "reviewer").code;
    const u2 = (await call("POST", "/api/users", { body: { name: "退席者" } })).data;
    const j2 = await call("POST", `/api/tables/${tableId}/seats`, {
      token: u2.token, body: { inviteCode: rc2, seatName: "退席者", role: "reviewer", agentLabel: "x" },
    });
    expect(j2.ok).toBe(true);
    await call("POST", `/api/tables/${tableId}/leave`, { token: j2.data.token });
    const left = await call("POST", `/api/tables/${tableId}/my/seat-token`, {
      token: u2.token, body: { mode: "recover" },
    });
    expect(left.status).toBe(409);
    expect(left.error?.code).toBe("seat_left");

    hub.adminCloseTable(ownerUser, tableId, "凭证测试闭桌");
    const r = await call("POST", `/api/tables/${tableId}/my/seat-token`, {
      token: ownerUser, body: { mode: "recover" },
    });
    expect(r.ok).toBe(true);
  });
});
