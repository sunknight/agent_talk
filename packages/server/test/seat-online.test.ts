/**
 * 席位断开检测与圆桌示意图状态显示（任务 0044）：
 * - tableInfo 投影：seats[] 附派生 online/lastSeenAt——5 分钟（SEAT_OFFLINE_MS）内有席位 HTTP 访问判在线，
 *   超时离线；left 恒离线（陈旧心跳用直改 store 注入，不起假时钟）
 * - agent 恢复：poll（touchSeat）后立即回在线
 * - 网页保活：观察端桌详情轮询（observerDetail）刷新查看者本人 active 席位心跳；无席位查看不刷新
 * - 页面：圆桌示意图「已断开」渲染标记（rt-off / seatOff / 节点样式 / 图例）
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start } from "../src";
import { OBSERVER_HTML } from "../src/observer-html";

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

async function reg(name: string) {
  const r = await call("POST", "/api/users", { body: { name } });
  return r.data.token as string;
}

async function mkTable(label: string) {
  const owner = await reg(label + "-建桌人");
  const r = await call("POST", "/api/tables", {
    token: owner,
    body: { topic: label + "桌", owner: { seatName: "提案人", agentLabel: "zcode" } },
  });
  return { owner, tableId: r.data.tableId as string, ownerSeatToken: r.data.ownerSeatToken as string };
}

/** 直改 store 把建桌人席位心跳拨回 6 分钟前（越过 5 分钟阈值） */
function staleOwnerSeat(tableId: string) {
  const meta = hub.store.getTable(tableId)!;
  const s = hub.store.getSeat(tableId, meta.ownerSeat)! as any;
  s.lastSeenAt = Date.now() - 6 * 60_000;
  hub.store.saveSeat(tableId, s);
  return meta.ownerSeat;
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-seat-online-"));
  ({ http, hub } = await start({ port: 0, dataDir: dir, host: "127.0.0.1" }));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => { http.closeIdleConnections?.(); http.close(() => r()); }));

describe("tableInfo 投影：online / lastSeenAt", () => {
  it("新鲜心跳在线；≥5 分钟无访问离线；left 恒离线", async () => {
    const { tableId } = await mkTable("投影");
    const seats0 = hub.tableInfo(tableId).seats as any[];
    expect(seats0.length).toBeGreaterThan(0);
    expect(seats0[0].online).toBe(true);
    expect(typeof seats0[0].lastSeenAt).toBe("number");

    const seatId = staleOwnerSeat(tableId);
    const seats1 = hub.tableInfo(tableId).seats as any[];
    expect(seats1.find((s) => s.seatId === seatId).online).toBe(false);
    expect(seats1.find((s) => s.seatId === seatId).lastSeenAt).toBeLessThan(Date.now() - 5 * 60_000);

    const s = hub.store.getSeat(tableId, seatId)! as any;
    s.status = "left";
    hub.store.saveSeat(tableId, s);
    expect((hub.tableInfo(tableId).seats as any[]).find((x) => x.seatId === seatId).online).toBe(false);
  });
});

describe("agent 恢复与网页保活", () => {
  it("陈旧席位 poll 后回在线（心跳刷新）", async () => {
    const { tableId, ownerSeatToken } = await mkTable("恢复");
    const seatId = staleOwnerSeat(tableId);
    expect((hub.tableInfo(tableId).seats as any[]).find((s) => s.seatId === seatId).online).toBe(false);

    const res = await call("GET", `/api/tables/${tableId}/poll?since=0&timeout=0`, { token: ownerSeatToken });
    expect(res.ok).toBe(true);
    const mine = (res.data.table.seats as any[]).find((s) => s.seatId === seatId);
    expect(mine.online).toBe(true);
  });

  it("网页查看桌详情刷新本人席位心跳；无席位查看不刷新", async () => {
    const { owner, tableId } = await mkTable("保活");
    const seatId = staleOwnerSeat(tableId);

    // 无查看者（userId 缺省，如引擎级/匿名投影）：不触发保活
    hub.observerDetail(tableId);
    expect((hub.tableInfo(tableId).seats as any[]).find((s) => s.seatId === seatId).online).toBe(false);

    // 网页持有人查看详情：本人席位心跳刷新 → 在线
    const d = await call("GET", `/api/observer/tables/${tableId}`, { token: owner });
    expect(d.ok).toBe(true);
    const mine = (d.data.table.seats as any[]).find((s) => s.seatId === d.data.mySeatId);
    expect(mine.online).toBe(true);
    expect((hub.store.getSeat(tableId, d.data.mySeatId) as any).lastSeenAt).toBeGreaterThan(Date.now() - 1000);
  });
});

describe("观察端页面标记", () => {
  it("圆桌示意图含「已断开」渲染（样式 / 判定函数 / 标记 / 图例）", () => {
    expect(OBSERVER_HTML).toContain(".rt-node.off .rt-card"); // 节点灰虚线样式
    expect(OBSERVER_HTML).toContain("function seatOff"); // 断开判定（undefined 按在线、闭桌不显示）
    expect(OBSERVER_HTML).toContain("◌ 已断开"); // 节点/折叠区标记
    expect(OBSERVER_HTML).toContain('class="rt-off">已断开'); // 中央发言权行
    expect(OBSERVER_HTML).toContain("超过5分钟无访问"); // 图例说明
  });
});
