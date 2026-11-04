/** 网页退席（任务 0051 补充）：user token 通道退掉本人在本桌 active 席位——
 *  拿错码换角色（worker 退席后凭 director 码重新入桌）、owner 席位拒退、无席位拒退、
 *  退席后旧席位凭证失效（requireSeat 拒 left）、闭桌拒退、退席留痕（SEAT_LEFT + 审计）；
 *  控制人移出席位（seat-leave）：建桌人 / systemadmin 可移出参与方，建桌人席位与闭桌拒移 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start } from "../src";

let base = "";
let http: import("node:http").Server;
let hub: import("../src").Hub;

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
  const dir = mkdtempSync(join(tmpdir(), "rt-leave-"));
  ({ http, hub } = await start({ port: 0, dataDir: dir, host: "127.0.0.1" }));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => { http.closeIdleConnections?.(); http.close(() => r()); }));

describe("网页退席（我的席位 · user token 通道）", () => {
  let owner = "", joiner = "", outsider = "", admin = "";
  let tableId = "", workerCode = "", directorCode = "";
  let workerSeatToken = "", workerSeatId = "";

  it("页面含退席 UX 元素", async () => {
    const html = await (await fetch(base + "/")).text();
    expect(html).toContain("seatDetLeave"); // 我的席位 · 退席折叠子区块
    expect(html).toContain("stLeave"); // 退席按钮
    expect(html).toContain("/my/leave"); // user token 退席端点
    expect(html).toContain("退席本席（不可撤销）"); // 危险操作明示
    expect(html).toContain("seatKick"); // 席位卡「移出」按钮
    expect(html).toContain("/my/seat-leave"); // 控制人移出端点
  });

  it("前置：建指挥桌，joiner 误用执行方码入席", async () => {
    owner = (await call("POST", "/api/users", { body: { name: "退席-建桌人" } })).data.token;
    joiner = (await call("POST", "/api/users", { body: { name: "退席-换角色者" } })).data.token;
    outsider = (await call("POST", "/api/users", { body: { name: "退席-路人" } })).data.token;
    admin = (await call("POST", "/api/users", { body: { name: "退席-管理员" } })).data.token;
    hub.store.setUserRole((await call("GET", "/api/me", { token: admin })).data.userId, "systemadmin");
    const c = await call("POST", "/api/tables", {
      token: owner,
      body: { tableType: "dispatch", topic: "退席测试指挥桌", owner: { seatName: "指挥长", agentLabel: "human" } },
    });
    tableId = c.data.tableId;
    workerCode = c.data.inviteCodes.find((x: { role: string }) => x.role === "worker").code;
    directorCode = c.data.inviteCodes.find((x: { role: string }) => x.role === "director").code;
    const j = await call("POST", `/api/tables/${tableId}/seats`, {
      token: joiner, body: { inviteCode: workerCode, seatName: "换角色者", role: "worker", agentLabel: "zcode" },
    });
    expect(j.ok).toBe(true);
    workerSeatToken = j.data.token;
    workerSeatId = j.data.seatId;
    expect((await call("GET", `/api/tables/${tableId}`, { token: workerSeatToken })).data.seats.length).toBe(2);
  });

  it("未退席前凭指挥方码入桌被拒（防重复入席）", async () => {
    const r = await call("POST", `/api/tables/${tableId}/seats`, {
      token: joiner, body: { inviteCode: directorCode, seatName: "换角色者", role: "director", agentLabel: "human-only" },
    });
    expect(r.status).toBe(409);
    expect(r.error?.code).toBe("already_seated");
  });

  it("owner 席位与无席位者退席均被拒", async () => {
    const byOwner = await call("POST", `/api/tables/${tableId}/my/leave`, { token: owner, body: {} });
    expect(byOwner.status).toBe(403);
    expect(byOwner.error?.code).toBe("not_allowed");
    const byOutsider = await call("POST", `/api/tables/${tableId}/my/leave`, { token: outsider, body: {} });
    expect(byOutsider.status).toBe(403);
    expect(byOutsider.error?.code).toBe("no_seat");
  });

  it("网页退席成功：席位退场、留 SEAT_LEFT 与审计、退席者失去本桌可见性", async () => {
    const r = await call("POST", `/api/tables/${tableId}/my/leave`, { token: joiner, body: {} });
    expect(r.ok).toBe(true);
    expect(r.data.left).toBe(true);
    const info = (await call("GET", `/api/observer/tables/${tableId}`, { token: owner })).data;
    const seat = info.table.seats.find((s: { seatId: string }) => s.seatId === workerSeatId);
    expect(seat.status).toBe("left"); // 席位仍在投影中但标记 left
    // SEAT_LEFT 留痕（owner 视角系统消息）
    expect(info.messages.some((m: { type: string }) => m.type === "SEAT_LEFT")).toBe(true);
    // 审计留痕
    expect(hub.store.listAudit().some((a) => a.tableId === tableId && a.event === "seat_leave")).toBe(true);
    // 退席者（无 active 席位、非 admin、非问询方）不再可见本桌详情
    const denied = await call("GET", `/api/observer/tables/${tableId}`, { token: joiner });
    expect(denied.status).toBe(403);
    expect(denied.error?.code).toBe("not_participant");
  });

  it("退席后旧席位凭证失效（agent 下次请求即被拒）", async () => {
    const r = await call("GET", `/api/tables/${tableId}/poll?since=0&timeout=0`, { token: workerSeatToken });
    expect(r.status).toBe(409);
    expect(r.error?.code).toBe("seat_left");
  });

  it("退席后凭指挥方码重新入桌成功（拿错码换角色闭环）", async () => {
    const r = await call("POST", `/api/tables/${tableId}/seats`, {
      token: joiner, body: { inviteCode: directorCode, seatName: "换角色者", role: "director", agentLabel: "human-only" },
    });
    expect(r.ok).toBe(true);
    expect(r.data.seat.role).toBe("director");
    expect(r.data.token).toBe(""); // 指挥方人类席位不签发 seat token
    const info = (await call("GET", `/api/observer/tables/${tableId}`, { token: joiner })).data;
    expect(info.mySeatId).toBe(r.data.seatId);
    expect(info.isDirector).toBe(true);
  });

  it("控制人移出席位：owner 可移、非控制人拒、建桌人席位拒、admin 可移", async () => {
    // 非 owner 非 admin 调 seat-leave → 403
    const byOutsider = await call("POST", `/api/tables/${tableId}/my/seat-leave`, { token: outsider, body: { seatId: "whatever" } });
    expect(byOutsider.status).toBe(403);
    expect(byOutsider.error?.code).toBe("not_owner");
    // 移出建桌人席位 → 403
    const ownerInfo = (await call("GET", `/api/observer/tables/${tableId}`, { token: owner })).data;
    const byKickOwner = await call("POST", `/api/tables/${tableId}/my/seat-leave`, { token: owner, body: { seatId: ownerInfo.table.ownerSeat } });
    expect(byKickOwner.status).toBe(403);
    expect(byKickOwner.error?.code).toBe("not_allowed");
    // owner 移出刚重新入桌的 director 席
    const jInfo = (await call("GET", `/api/observer/tables/${tableId}`, { token: joiner })).data;
    const kick = await call("POST", `/api/tables/${tableId}/my/seat-leave`, { token: owner, body: { seatId: jInfo.mySeatId } });
    expect(kick.ok).toBe(true);
    const afterKick = (await call("GET", `/api/observer/tables/${tableId}`, { token: owner })).data;
    expect(afterKick.table.seats.find((s: { seatId: string }) => s.seatId === jInfo.mySeatId).status).toBe("left");
    // joiner 再凭 worker 码入席，admin 移出（systemadmin 通道）
    const again = await call("POST", `/api/tables/${tableId}/seats`, {
      token: joiner, body: { inviteCode: workerCode, seatName: "换角色者", role: "worker", agentLabel: "zcode" },
    });
    expect(again.ok).toBe(true);
    const byAdmin = await call("POST", `/api/tables/${tableId}/my/seat-leave`, { token: admin, body: { seatId: again.data.seatId } });
    expect(byAdmin.ok).toBe(true);
    const afterAdmin = (await call("GET", `/api/observer/tables/${tableId}`, { token: admin })).data;
    expect(afterAdmin.table.seats.find((s: { seatId: string }) => s.seatId === again.data.seatId).status).toBe("left");
  });

  it("闭桌后退席与移出均被拒（席位已定格）", async () => {
    const closed = await call("POST", `/api/admin/tables/${tableId}/close`, { token: admin, body: { reason: "测试闭桌" } });
    expect(closed.ok).toBe(true);
    const leave = await call("POST", `/api/tables/${tableId}/my/leave`, { token: owner, body: {} });
    expect(leave.status).toBe(409);
    expect(leave.error?.code).toBe("table_closed");
    const kick = await call("POST", `/api/tables/${tableId}/my/seat-leave`, { token: admin, body: { seatId: workerSeatId } });
    expect(kick.status).toBe(409);
    expect(kick.error?.code).toBe("table_closed");
  });
});
