/** 立场/风格可见性（任务 0040）：config 的 stance/stancePreset/style/stylePreset 仅本席与系统观察员可见，
 *  参会他方（含建桌人/主持人视角）在 REST 桌况（GET /tables/:id、poll、changes）、观察端详情与 SEAT_JOINED 广播中均不可见；
 *  scope/dataScope/ready 为分工与就绪语义，保留全桌互见。fetch 直调 REST，零 mock。 */
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

async function newUser(name: string) {
  return (await call("POST", "/api/users", { body: { name } })).data.token as string;
}
async function userIdOf(token: string) {
  return hub.store.findUserByToken(token)!.userId;
}

/** 断言席位 config 的隐私边界：hidden=true 时期待立场/风格四字段不存在（undefined），分工/就绪字段保留 */
function expectPrivacy(cfg: any, hidden: boolean) {
  if (hidden) {
    expect(cfg).not.toHaveProperty("stance");
    expect(cfg).not.toHaveProperty("stancePreset");
    expect(cfg).not.toHaveProperty("style");
    expect(cfg).not.toHaveProperty("stylePreset");
  } else {
    expect(cfg.stance).toBe("我方立场：严谨评审，逐条给出理由");
    expect(cfg.style).toContain("直率");
  }
  // 分工与就绪语义全桌互见
  expect(cfg.scope).toBe("评审全部章节");
  expect(cfg.ready).toBe(true);
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-priv-"));
  ({ http, hub } = await start({ port: 0, dataDir: dir, host: "127.0.0.1" }));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => { http.closeIdleConnections?.(); http.close(() => r()); }));

describe("立场/风格仅己方可见", () => {
  let admin = "", ownerUser = "", revUser = "";
  let tableId = "", ownerSeatToken = "", ownerSeatId = "", revSeatToken = "", revSeatId = "";

  it("前置：评审桌双人各自保存带立场与风格的设定", async () => {
    admin = await newUser("可见性-admin");
    hub.store.setUserRole(await userIdOf(admin), "systemadmin");
    ownerUser = await newUser("可见性-建桌人");
    const created = await call("POST", "/api/tables", {
      token: ownerUser,
      body: { topic: "可见性测试桌", owner: { seatName: "提案方A", agentLabel: "zcode" } },
    });
    tableId = created.data.tableId;
    ownerSeatToken = created.data.ownerSeatToken;
    ownerSeatId = created.data.ownerSeatId;
    const rc = created.data.inviteCodes.find((c: { role: string }) => c.role === "reviewer").code;
    revUser = await newUser("可见性-评审");
    const j = await call("POST", `/api/tables/${tableId}/seats`, {
      token: revUser, body: { inviteCode: rc, seatName: "评审B", role: "reviewer", agentLabel: "claude" },
    });
    revSeatToken = j.data.token;
    revSeatId = j.data.seatId;

    // 双方都写入立场+风格+范围，全部就绪（风格快照 = 预设合成文本）
    for (const [token] of [[ownerSeatToken], [revSeatToken]] as [string][]) {
      const r = await call("POST", `/api/tables/${tableId}/seat-config`, {
        token,
        body: {
          stance: token === ownerSeatToken ? "我方立场：如实陈述方案取舍" : "我方立场：严谨评审，逐条给出理由",
          style: "风格：直率、聚焦事实", scope: "评审全部章节", dataScope: [{ text: "设计文档 v2", grant: "quote" }], ready: true,
        },
      });
      expect(r.ok).toBe(true);
      // 本席保存响应（seat 全量）含自己的立场
      expect(r.data.seat.config.stance).toBeTruthy();
    }
  });

  it("GET /api/tables/:id：本席可见自己，看不到他席立场/风格", async () => {
    const ownerView = (await call("GET", `/api/tables/${tableId}`, { token: ownerSeatToken })).data;
    const own = ownerView.seats.find((s: any) => s.seatId === ownerSeatId);
    const other = ownerView.seats.find((s: any) => s.seatId === revSeatId);
    expect(own.config.stance).toBe("我方立场：如实陈述方案取舍");
    expectPrivacy(other.config, true);

    const revView = (await call("GET", `/api/tables/${tableId}`, { token: revSeatToken })).data;
    expectPrivacy(revView.seats.find((s: any) => s.seatId === ownerSeatId).config, true);
    expect(revView.seats.find((s: any) => s.seatId === revSeatId).config.style).toContain("直率");
  });

  it("poll 与 changes：table 投影同款隔离", async () => {
    const poll = (await call("GET", `/api/tables/${tableId}/poll?since=0&timeout=0`, { token: revSeatToken })).data;
    expectPrivacy(poll.table.seats.find((s: any) => s.seatId === ownerSeatId).config, true);
    expect(poll.table.seats.find((s: any) => s.seatId === revSeatId).config.stance).toBeTruthy();
    const ch = (await call("GET", `/api/tables/${tableId}/changes?since=0`, { token: ownerSeatToken })).data;
    expectPrivacy(ch.table.seats.find((s: any) => s.seatId === revSeatId).config, true);
  });

  it("观察端详情：席位主人视角隔离，systemadmin 全可见", async () => {
    const revDetail = (await call("GET", `/api/observer/tables/${tableId}`, { token: revUser })).data;
    expectPrivacy(revDetail.table.seats.find((s: any) => s.seatId === ownerSeatId).config, true);
    expect(revDetail.table.seats.find((s: any) => s.seatId === revSeatId).config.stance).toBeTruthy();

    const adminDetail = (await call("GET", `/api/observer/tables/${tableId}`, { token: admin })).data;
    for (const s of adminDetail.table.seats) expect(s.config.stance, `admin 应见 ${s.seatId} 立场`).toBeTruthy();
  });

  it("SEAT_JOINED 广播（含设定保存）：payload.seat 不带立场/风格", async () => {
    const msgs = (await call("GET", `/api/tables/${tableId}/poll?since=0&timeout=0`, { token: ownerSeatToken })).data.messages as any[];
    const joins = msgs.filter((m) => m.type === "SEAT_JOINED");
    expect(joins.length).toBeGreaterThanOrEqual(3); // 建桌入席 + 凭码入席 + 两次设定保存
    for (const m of joins) {
      const cfg = m.payload?.seat?.config ?? {};
      expect(cfg).not.toHaveProperty("stance");
      expect(cfg).not.toHaveProperty("style");
      // 公开字段保留（设定保存变体带 ready/scope）
      if (m.payload.configUpdate) { expect(cfg.ready).toBe(true); expect(cfg.scope).toBe("评审全部章节"); }
    }
  });
});
