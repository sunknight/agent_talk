/** 管理台验收（任务 0006）：systemadmin 用户管理（列表/参桌/角色/禁用）与圆桌管理（邀请码/强制闭桌/强制介入/删桌）。
 *  admin 身份用 hub.store.setUserRole 直接授予（等价 bootstrap 手工标记后的内存态）。 */
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

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
async function reg(name: string) {
  const r = await call("POST", "/api/users", { body: { name } });
  return r.data.token as string;
}
async function userIdOf(token: string) {
  return (await call("GET", "/api/me", { token })).data.userId as string;
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-admin-"));
  ({ http, hub } = await start({ port: 0, dataDir: dir, host: "127.0.0.1" }));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => { http.closeIdleConnections?.(); http.close(() => r()); }));

describe("管理台（systemadmin）", () => {
  let admin = "", owner = "", revUser = "", victim = "";
  let tableId = "", ownerSeatToken = "", revSeatToken = "";

  it("前置：注册 + 授予 admin + 建桌入席开局", async () => {
    admin = await reg("管理-甲");
    owner = await reg("管理-建桌人");
    revUser = await reg("管理-评审");
    victim = await reg("管理-待禁用");
    hub.store.setUserRole(await userIdOf(admin), "systemadmin"); // 等价 bootstrap 手工标记

    const created = await call("POST", "/api/tables", {
      token: owner, body: { topic: "管理台测试桌", owner: { seatName: "建桌人A", agentLabel: "zcode" } },
    });
    tableId = created.data.tableId;
    ownerSeatToken = created.data.ownerSeatToken;
    const rc = created.data.inviteCodes.find((c: { role: string }) => c.role === "reviewer").code;
    const j = await call("POST", `/api/tables/${tableId}/seats`, {
      token: revUser, body: { inviteCode: rc, seatName: "评审B", role: "reviewer", agentLabel: "claude" },
    });
    revSeatToken = j.data.token;
    await call("POST", `/api/tables/${tableId}/seat-config`, { token: ownerSeatToken, body: { stance: "提案方", ready: true } });
    await call("POST", `/api/tables/${tableId}/seat-config`, { token: revSeatToken, body: { stance: "评审方", ready: true } });
    await call("POST", `/api/tables/${tableId}/start`, { token: ownerSeatToken });
  });

  it("非 systemadmin 调 /api/admin/* 全部 403 not_admin", async () => {
    const checks = await Promise.all([
      call("GET", "/api/admin/users", { token: owner }),
      call("GET", `/api/admin/users/${await userIdOf(owner)}/tables`, { token: owner }),
      call("POST", `/api/admin/users/${await userIdOf(owner)}/role`, { token: owner, body: { role: "systemadmin" } }),
      call("POST", `/api/admin/users/${await userIdOf(owner)}/disabled`, { token: owner, body: { disabled: true } }),
      call("GET", `/api/admin/tables/${tableId}/invites`, { token: owner }),
      call("POST", `/api/admin/tables/${tableId}/close`, { token: owner, body: { reason: "x" } }),
      call("POST", `/api/admin/tables/${tableId}/human`, { token: owner, body: { reason: "x" } }),
      call("DELETE", `/api/admin/tables/${tableId}`, { token: owner }),
    ]);
    for (const c of checks) {
      expect(c.status).toBe(403);
      expect(c.error.code).toBe("not_admin");
    }
  });

  it("用户列表：含角色/状态/参桌数；普通用户仍不可见", async () => {
    const deny = await call("GET", "/api/admin/users");
    expect(deny.status).toBe(401);
    const adminUid = await userIdOf(admin), ownerUid = await userIdOf(owner);
    const r = await call("GET", "/api/admin/users", { token: admin });
    expect(r.ok).toBe(true);
    const me = r.data.users.find((u: { userId: string }) => u.userId === adminUid);
    expect(me.role).toBe("systemadmin");
    const own = r.data.users.find((u: { userId: string }) => u.userId === ownerUid);
    expect(own.seatCount).toBe(1);
    expect(own.role).toBe("user");
  });

  it("参桌明细：建桌人映射到提案席，路人空", async () => {
    const own = await call("GET", `/api/admin/users/${await userIdOf(owner)}/tables`, { token: admin });
    expect(own.data.tables.length).toBe(1);
    expect(own.data.tables[0].tableId).toBe(tableId);
    expect(own.data.tables[0].role).toBe("proposer");
    expect(own.data.tables[0].phase).toBe("statements");
    const none = await call("GET", `/api/admin/users/${await userIdOf(victim)}/tables`, { token: admin });
    expect(none.data.tables).toEqual([]);
    const bad = await call("GET", "/api/admin/users/u_nope/tables", { token: admin });
    expect(bad.status).toBe(404);
  });

  it("授予/撤销管理员：界面通道生效并持久到用户记录", async () => {
    const vid = await userIdOf(victim);
    const grant = await call("POST", `/api/admin/users/${vid}/role`, { token: admin, body: { role: "systemadmin" } });
    expect(grant.data.role).toBe("systemadmin");
    // victim 现在能调管理接口
    const asAdmin = await call("GET", "/api/admin/users", { token: victim });
    expect(asAdmin.ok).toBe(true);
    const revoke = await call("POST", `/api/admin/users/${vid}/role`, { token: admin, body: { role: "user" } });
    expect(revoke.data.role).toBe("user");
    const denied = await call("GET", "/api/admin/users", { token: victim });
    expect(denied.status).toBe(403);
    const badRole = await call("POST", `/api/admin/users/${vid}/role`, { token: admin, body: { role: "superuser" } });
    expect(badRole.data.role).toBe("user"); // 非法值按 user 处理
  });

  it("禁用/启用：token 即时 403 user_disabled，席位流程不受影响，不能禁自己", async () => {
    const vid = await userIdOf(victim);
    const self = await call("POST", `/api/admin/users/${await userIdOf(admin)}/disabled`, { token: admin, body: { disabled: true } });
    expect(self.status).toBe(409);
    expect(self.error.code).toBe("self_disable");

    await call("POST", `/api/admin/users/${vid}/disabled`, { token: admin, body: { disabled: true } });
    const blocked = await call("GET", "/api/observer/tables", { token: victim });
    expect(blocked.status).toBe(403);
    expect(blocked.error.code).toBe("user_disabled");
    // 恢复
    await call("POST", `/api/admin/users/${vid}/disabled`, { token: admin, body: { disabled: false } });
    const back = await call("GET", "/api/observer/tables", { token: victim });
    expect(back.ok).toBe(true);
  });

  it("重签用户登录 token：新 token 可登录、旧 token 立即失效、仅 admin 可操作", async () => {
    const vid = await userIdOf(victim);
    const byUser = await call("POST", `/api/admin/users/${vid}/token`, { token: victim });
    expect(byUser.status).toBe(403);
    const r = await call("POST", `/api/admin/users/${vid}/token`, { token: admin });
    expect(r.ok).toBe(true);
    expect(r.data.token).toMatch(/^rtu_/);
    expect(r.data.name).toBe("管理-待禁用");
    // 旧 token 立即失效
    const old = await call("GET", "/api/me", { token: victim });
    expect(old.status).toBe(401);
    // 新 token 可用于登录（浏览器 token 登录即用此值）
    const me = await call("GET", "/api/me", { token: r.data.token });
    expect(me.ok).toBe(true);
    expect(me.data.userId).toBe(vid);
    victim = r.data.token; // 后续用例沿用新 token
    const noUser = await call("POST", "/api/admin/users/u_nobody/token", { token: admin });
    expect(noUser.status).toBe(404);
  });

  it("邀请码：admin 可看任意桌；观察端路由同样放行 admin", async () => {
    const viaAdmin = await call("GET", `/api/admin/tables/${tableId}/invites`, { token: admin });
    expect(viaAdmin.data.invites.length).toBe(2);
    const viaObserver = await call("GET", `/api/observer/tables/${tableId}/invites`, { token: admin });
    expect(viaObserver.data.invites.length).toBe(2);
    // 普通用户仍是仅建桌人
    const deny = await call("GET", `/api/observer/tables/${tableId}/invites`, { token: revUser });
    expect(deny.status).toBe(403);
  });

  it("强制人工介入：active 桌可转 human_intervention，重复介入 409", async () => {
    const r = await call("POST", `/api/admin/tables/${tableId}/human`, { token: admin, body: { reason: "检测到争议" } });
    expect(r.ok).toBe(true);
    const detail = await call("GET", `/api/tables/${tableId}`, { token: ownerSeatToken });
    expect(detail.data.phase).toBe("human_intervention");
    const again = await call("POST", `/api/admin/tables/${tableId}/human`, { token: admin, body: { reason: "x" } });
    expect(again.status).toBe(409);
    expect(again.error.code).toBe("already_human");
  });

  it("强制闭桌：生成纪要并 closed；closed 桌再闭 409", async () => {
    const r = await call("POST", `/api/admin/tables/${tableId}/close`, { token: admin, body: { reason: "议题完成" } });
    expect(r.ok).toBe(true);
    const detail = await call("GET", `/api/tables/${tableId}`, { token: ownerSeatToken });
    expect(detail.data.phase).toBe("closed");
    const minutes = await call("GET", `/api/observer/tables/${tableId}`, { token: admin });
    expect(minutes.data.minutes).toBeTruthy();
    expect(String(minutes.data.minutes.markdown)).toContain("系统观察员强制闭桌");
    const again = await call("POST", `/api/admin/tables/${tableId}/close`, { token: admin, body: { reason: "x" } });
    expect(again.status).toBe(409);
    expect(again.error.code).toBe("table_closed");
  });

  it("删除圆桌：列表消失、详情 404、席位 token 失效、数据连带清理", async () => {
    const before = await call("GET", "/api/observer/tables", { token: admin });
    expect(before.data.tables.some((t: { tableId: string }) => t.tableId === tableId)).toBe(true);
    const del = await call("DELETE", `/api/admin/tables/${tableId}`, { token: admin });
    expect(del.ok).toBe(true);
    const after = await call("GET", "/api/observer/tables", { token: admin });
    expect(after.data.tables.some((t: { tableId: string }) => t.tableId === tableId)).toBe(false);
    const gone = await call("GET", `/api/observer/tables/${tableId}`, { token: admin });
    expect(gone.status).toBe(404);
    const seatGone = await call("GET", `/api/tables/${tableId}`, { token: ownerSeatToken });
    expect(seatGone.status).toBe(401); // 席位 token 已随桌清理
    const pollGone = await call("GET", `/api/tables/${tableId}/poll?since=0&timeout=0`, { token: revSeatToken });
    expect(pollGone.status).toBe(401);
    // 删桌连带清理席位归属：参桌明细归空
    const seats = await call("GET", `/api/admin/users/${await userIdOf(owner)}/tables`, { token: admin });
    expect(seats.data.tables).toEqual([]);
    const delAgain = await call("DELETE", `/api/admin/tables/${tableId}`, { token: admin });
    expect(delAgain.status).toBe(404);
  });
});
