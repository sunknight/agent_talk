/**
 * 安全与鲁棒性回归：
 * - 观察端 HTML：miniMd 内部转义 / mammoth SRI / CSP 头
 * - poll NaN 超时：引擎层立即返回（不忙循环）
 * - HUMAN_RULING 收权：open 阶段席位 token 直发 403
 * - REST 字段长度/枚举上限：注册/建桌/入席设定/产物
 * - 注册按 IP 限频：窗口内超量 429
 * - 退席重入：my 通道命中 active 席位而非 left 旧席
 * - 限频审计去重：每席位每窗口仅一条 rate_limit 审计
 * - 已完结执行请求不再授予产物写权
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start } from "../src";

let base = "";
let http: import("node:http").Server;
let hub: import("../src").Hub;

async function call(method: string, path: string, opts: { token?: string; body?: unknown; raw?: boolean } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  if (opts.raw) return res;
  const j = (await res.json()) as { ok: boolean; data?: any; error?: { code: string; message: string } };
  return { status: res.status, ...j };
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

/** 建一张桌：owner（user+seat token）+ 一个评审席（user+seat token），全部就绪；start=true 时再点开始 */
async function quickTable(topic: string, opts: { start?: boolean } = {}) {
  const ownerUser = (await call("POST", "/api/users", { body: { name: `${topic}-owner` } })).data.token;
  const created = (await call("POST", "/api/tables", {
    token: ownerUser,
    body: { topic, owner: { seatName: `${topic}-owner`, agentLabel: "zcode" } },
  })).data;
  const reviewerCode = created.inviteCodes.find((c: { role: string }) => c.role === "reviewer").code;
  const revUser = (await call("POST", "/api/users", { body: { name: `${topic}-rev` } })).data.token;
  const joined = (await call("POST", `/api/tables/${created.tableId}/seats`, {
    token: revUser, body: { inviteCode: reviewerCode, seatName: `${topic}-rev`, role: "reviewer", agentLabel: "claude" },
  })).data;
  for (const [token, stance] of [[created.ownerSeatToken, "需求提出方"], [joined.token, "评审方"]] as const) {
    await call("POST", `/api/tables/${created.tableId}/seat-config`, { token, body: { stance, ready: true } });
  }
  if (opts.start) await call("POST", `/api/tables/${created.tableId}/start`, { token: created.ownerSeatToken });
  return { tableId: created.tableId, ownerUser, ownerSeat: created.ownerSeatToken, revUser, revSeat: joined.token };
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-sec-"));
  ({ http, hub } = await start({ port: 0, dataDir: dir, host: "127.0.0.1" }));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => {
  http.closeIdleConnections?.();
  http.close(() => r());
}));

describe("观察端 HTML 安全", () => {
  it("miniMd 对非代码行先 esc() 再匹配（防 md 预览 XSS）", async () => {
    const html = await (await fetch(base + "/")).text();
    expect(html).toContain("t=esc(ln).trim()");
    // 链接 URL 字符类排除引号，防 href 属性注入
    expect(html).toContain('[^\\s)"\']+');
    expect(html).toContain("(https?:");
  });
  it("mammoth CDN 脚本带 SRI integrity + crossorigin", async () => {
    const html = await (await fetch(base + "/")).text();
    expect(html).toContain("s.integrity='sha384-");
    expect(html).toContain("s.crossOrigin='anonymous'");
  });
  it("HTML 带 CSP，API JSON 带 no-store/nosniff 安全头", async () => {
    const htmlRes = await fetch(base + "/");
    expect(htmlRes.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(htmlRes.headers.get("x-content-type-options")).toBe("nosniff");
    const jsonRes = await fetch(base + "/healthz");
    expect(jsonRes.headers.get("cache-control")).toBe("no-store");
    expect(jsonRes.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("poll NaN 超时防忙循环", () => {
  it("引擎层 NaN waitMs 立即返回（不进入永久等待/空转）", async () => {
    const t = await quickTable("nan-poll");
    const st = hub.store.findSeatByToken(t.ownerSeat);
    expect(st).toBeTruthy();
    const seat = hub.requireSeat(t.tableId, st!.seatId);
    const result = await Promise.race([
      hub.poll(t.tableId, seat, 999_999, NaN),
      new Promise<string>((r) => setTimeout(() => r("__TIMEOUT__"), 2_000)),
    ]);
    expect(result).not.toBe("__TIMEOUT__");
    expect((result as { table: { tableId: string } }).table.tableId).toBe(t.tableId);
  });
  it("API 层非法 timeout 参数不致挂起（有消息时正常返回）", async () => {
    const t = await quickTable("nan-api");
    const r = await Promise.race([
      call("GET", `/api/tables/${t.tableId}/poll?since=0&timeout=abc`, { token: t.ownerSeat }),
      new Promise<{ status: number }>((r2) => setTimeout(() => r2({ status: 0 }), 3_000)),
    ]);
    expect(r.status).toBe(200);
  });
});

describe("HUMAN_RULING 收权", () => {
  it("open 阶段席位 token 直发 → 403 human_only", async () => {
    const t = await quickTable("ruling-guard");
    const r = await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.revSeat,
      body: { type: "HUMAN_RULING", payload: { instruction: "越权闭桌", forceConvergence: true } },
    });
    expect(r.status).toBe(403);
    expect(r.error!.code).toBe("human_only");
    const info = (await call("GET", `/api/tables/${t.tableId}`, { token: t.ownerSeat })).data;
    expect(info.phase).toBe("open"); // 桌未被毙
  });
});

describe("REST 字段长度/枚举上限", () => {
  it("注册：超长用户名 422", async () => {
    const r = await call("POST", "/api/users", { body: { name: "A".repeat(1_000_000) } });
    expect(r.status).toBe(422);
  });
  it("建桌：超长 topic / seatName 422；maxReviewRounds 越界 422", async () => {
    const u = (await call("POST", "/api/users", { body: { name: "cap-user" } })).data.token;
    const bad1 = await call("POST", "/api/tables", { token: u, body: { topic: "T".repeat(2_000_000), owner: { seatName: "S", agentLabel: "x" } } });
    expect(bad1.status).toBe(422);
    const bad2 = await call("POST", "/api/tables", { token: u, body: { topic: "ok", owner: { seatName: "S".repeat(1_000_000), agentLabel: "x" } } });
    expect(bad2.status).toBe(422);
    const bad3 = await call("POST", "/api/tables", { token: u, body: { topic: "ok", owner: { seatName: "S", agentLabel: "x" }, maxReviewRounds: 99 } });
    expect(bad3.status).toBe(422);
    const bad4 = await call("POST", "/api/tables", { token: u, body: { topic: "ok", owner: { seatName: "S", agentLabel: "x" }, turnTimeoutMs: 1 } });
    expect(bad4.status).toBe(422);
  });
  it("入桌设定：超长 stance / dataScope 条目 422", async () => {
    const t = await quickTable("cap-config");
    const bad1 = await call("POST", `/api/tables/${t.tableId}/seat-config`, { token: t.ownerSeat, body: { stance: "B".repeat(3_000_000), ready: true } });
    expect(bad1.status).toBe(422);
    const bad2 = await call("POST", `/api/tables/${t.tableId}/seat-config`, { token: t.ownerSeat, body: { stance: "立场", dataScope: ["X".repeat(501)] } });
    expect(bad2.status).toBe(422);
    const ok = await call("POST", `/api/tables/${t.tableId}/seat-config`, { token: t.ownerSeat, body: { stance: "立场", scope: "范围", ready: true } });
    expect(ok.status).toBe(200);
  });
  it("产物：超长 name / 非法 format 422", async () => {
    const t = await quickTable("cap-artifact");
    const bad1 = await call("POST", `/api/tables/${t.tableId}/artifacts`, {
      token: t.ownerSeat, body: { name: "N".repeat(300), format: "md", contentBase64: b64("x"), changeNote: "n" },
    });
    expect(bad1.status).toBe(422);
    const bad2 = await call("POST", `/api/tables/${t.tableId}/artifacts`, {
      token: t.ownerSeat, body: { name: "ok.md", format: "exe", contentBase64: b64("x"), changeNote: "n" },
    });
    expect(bad2.status).toBe(422);
  });
});

describe("退席重入：my 通道命中 active 席位", () => {
  it("leave 后重新凭码入席，my/seat-config 正常（不再 409 seat_left）", async () => {
    const ownerUser = (await call("POST", "/api/users", { body: { name: "rejoin-owner" } })).data.token;
    const created = (await call("POST", "/api/tables", {
      token: ownerUser, body: { topic: "rejoin-table", owner: { seatName: "P", agentLabel: "zcode" } },
    })).data;
    const code = created.inviteCodes.find((c: { role: string }) => c.role === "reviewer").code;
    const u = (await call("POST", "/api/users", { body: { name: "rejoin-user" } })).data.token;
    const j1 = (await call("POST", `/api/tables/${created.tableId}/seats`, {
      token: u, body: { inviteCode: code, seatName: "R1", role: "reviewer", agentLabel: "claude" },
    })).data;
    expect(j1.seatId).toBeTruthy();
    await call("POST", `/api/tables/${created.tableId}/leave`, { token: j1.token });
    const j2 = (await call("POST", `/api/tables/${created.tableId}/seats`, {
      token: u, body: { inviteCode: code, seatName: "R2", role: "reviewer", agentLabel: "claude" },
    })).data;
    expect(j2.seatId).not.toBe(j1.seatId);
    const cfg = await call("POST", `/api/tables/${created.tableId}/my/seat-config`, {
      token: u, body: { stance: "重入后的立场", ready: false },
    });
    expect(cfg.status).toBe(200);
    expect(cfg.data.seat.seatId).toBe(j2.seatId);
    // 预检与桌列表也按 active 席位判定
    const pv = await call("POST", "/api/invites/preview", { token: u, body: { code } });
    expect(pv.data.mySeat.seatId).toBe(j2.seatId);
    const tables = (await call("GET", "/api/observer/tables", { token: u })).data.tables;
    expect(tables.some((x: { tableId: string }) => x.tableId === created.tableId)).toBe(true);
  });
});

describe("已完结请求不再授予产物写权", () => {
  it("请求 executed 后，凭同一 requestId 再发版 → 403", async () => {
    const t = await quickTable("closed-req", { start: true });
    await call("POST", `/api/tables/${t.tableId}/messages`, { token: t.ownerSeat, body: { type: "STATEMENT", payload: { text: "提案" } } });
    const art = (await call("POST", `/api/tables/${t.tableId}/artifacts`, {
      token: t.ownerSeat, body: { name: "a.md", format: "md", contentBase64: b64("v1"), changeNote: "v1" },
    })).data;
    await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.revSeat,
      body: { type: "REVIEW_COMMENT", payload: { items: [{ id: "c1", target: "全文", severity: "must", comment: "改", }] } },
    });
    await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.ownerSeat,
      body: { type: "RESPONSE", payload: { items: [{ reviewItemId: "c1", decision: "accept", action: { executeBy: "reviewerSeat" } }] } },
    });
    const reqs = (await call("GET", `/api/tables/${t.tableId}/requests`, { token: t.revSeat })).data.requests;
    const req = reqs.find((r: { status: string }) => r.status === "pending");
    expect(req).toBeTruthy();
    // 待执行期：评审席凭 requestId 发版放行
    const v2 = await call("POST", `/api/tables/${t.tableId}/artifacts`, {
      token: t.revSeat, body: { artifactId: art.artifactId, name: "a.md", format: "md", contentBase64: b64("v2"), changeNote: "按请求修订", requestId: req.req.requestId },
    });
    expect(v2.status).toBe(200);
    await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.revSeat, body: { type: "RESPOND_REQUEST", payload: { requestId: req.req.requestId, decision: "accept" } },
    });
    // 已完结：同一 requestId 不再授予写权
    const v3 = await call("POST", `/api/tables/${t.tableId}/artifacts`, {
      token: t.revSeat, body: { artifactId: art.artifactId, name: "a.md", format: "md", contentBase64: b64("v3"), changeNote: "再改", requestId: req.req.requestId },
    });
    expect(v3.status).toBe(403);
  });
});

describe("限频审计去重与注册限频", () => {
  it("连发消息触发 429：rate_limit 审计每窗口仅一条", async () => {
    const t = await quickTable("rate-audit");
    for (let i = 0; i < 12; i++) {
      await call("POST", `/api/tables/${t.tableId}/messages`, {
        token: t.ownerSeat, body: { type: "QUESTION", payload: { text: `spam ${i}` } },
      });
    }
    const audits = hub.store.listAudit(500).filter((a) => a.event === "policy_reject"
      && (a.detail as { reason?: string }).reason === "rate_limit"
      && a.tableId === t.tableId);
    expect(audits.length).toBe(1);
  });
  it("注册同 IP 超量 → 429（置于此文件末尾：消耗完本实例的注册窗口额度）", async () => {
    let first429 = -1, okCount = 0;
    for (let i = 0; i < 45; i++) {
      const r = await call("POST", "/api/users", { body: { name: `flood-${i}` } });
      if (r.status === 429) { first429 = i; break; }
      okCount++;
    }
    expect(first429).toBeGreaterThan(0); // 窗口内被拒（额度已含此前各用例的注册）
    expect(first429).toBeLessThan(45);
    const again = await call("POST", "/api/users", { body: { name: "flood-again" } });
    expect(again.status).toBe(429);
    expect(again.error!.code).toBe("rate_limited");
  });
});
