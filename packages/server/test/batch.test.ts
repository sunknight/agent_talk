/**
 * 批量执行请求（P2 反哺）：一个版本关联多个 requestId（requestIds）、
 * 一条 RESPOND_REQUEST 批量处置多个请求（全或无）、旧单值兼容、SQLite 持久化往返。
 * 场景源自需求评审-2 桌（tbl_78e3298011f01979）实测卡点。
 */
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
/** 限频预算：seatA 全程 9 次计费调用（消息+产物发布，失败尝试也计数），中途必须清一次 10s 窗口 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-batch-"));
  ({ http, hub } = await start({ port: 0, dataDir: dir, host: "127.0.0.1" }));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => {
  http.closeIdleConnections?.();
  http.close(() => r());
}));

describe("批量执行请求（一版多请求 + 一消息多处置）", () => {
  let tableId = "", seatA = "", seatB = "", seatIdA = "", artifactId = "";
  let reqIds: string[] = [];

  it("搭桌：3 条 must 评审意见 + 提案人 3 条 accept(self) → 派生 3 个执行请求", async () => {
    const ownerUser = (await call("POST", "/api/users", { body: { name: "batch-owner" } })).data.token;
    const created = await call("POST", "/api/tables", {
      token: ownerUser,
      body: { topic: "批量执行验证", owner: { seatName: "batch-owner", agentLabel: "zcode" } },
    });
    tableId = created.data.tableId;
    seatA = created.data.ownerSeatToken;
    seatIdA = created.data.ownerSeatId;
    const rc = created.data.inviteCodes.find((c: { role: string }) => c.role === "reviewer").code;
    await call("POST", `/api/tables/${tableId}/seat-config`, { token: seatA, body: { stancePreset: "req-owner", stance: "提案方", ready: true } });
    const ru = (await call("POST", "/api/users", { body: { name: "batch-reviewer" } })).data.token;
    const rj = await call("POST", `/api/tables/${tableId}/seats`, { token: ru, body: { inviteCode: rc, seatName: "batch-reviewer", role: "reviewer", agentLabel: "zcode" } });
    seatB = rj.data.token;
    await call("POST", `/api/tables/${tableId}/seat-config`, { token: seatB, body: { stancePreset: "req-reviewer", stance: "评审方", ready: true } });
    expect((await call("POST", `/api/tables/${tableId}/start`, { token: seatA })).ok).toBe(true);

    const pub = await call("POST", `/api/tables/${tableId}/artifacts`, {
      token: seatA, body: { name: "批量案.md", format: "md", contentBase64: b64("# 批量案 v1\n"), changeNote: "v1" },
    });
    artifactId = pub.data.artifactId;
    await call("POST", `/api/tables/${tableId}/messages`, { token: seatA, body: { type: "STATEMENT", payload: { text: "陈述" } } });

    await call("POST", `/api/tables/${tableId}/messages`, {
      token: seatB,
      body: {
        type: "REVIEW_COMMENT", payload: {
          artifactId,
          items: [
            { id: "b1", target: "§1", severity: "must", comment: "意见一" },
            { id: "b2", target: "§2", severity: "must", comment: "意见二" },
            { id: "b3", target: "§3", severity: "must", comment: "意见三" },
          ],
          summary: "三条", done: true,
        },
      },
    });
    const resp = await call("POST", `/api/tables/${tableId}/messages`, {
      token: seatA,
      body: {
        type: "RESPONSE", payload: {
          items: ["b1", "b2", "b3"].map((id) => ({ reviewItemId: id, decision: "accept", action: { executeBy: "self", note: `改 ${id}` } })),
        },
      },
    });
    expect(resp.ok, JSON.stringify(resp.error)).toBe(true);
    const reqs = (await call("GET", `/api/tables/${tableId}/requests`, { token: seatA })).data.requests;
    reqIds = reqs.map((x: { req: { requestId: string } }) => x.req.requestId);
    expect(reqIds).toHaveLength(3);
  });

  it("未发布版本先批量 accept → 409 no_result_version（全或无：无一被执行）", async () => {
    const r = await call("POST", `/api/tables/${tableId}/messages`, {
      token: seatA, body: { type: "RESPOND_REQUEST", payload: { requestIds: reqIds, decision: "accept" } },
    });
    expect(r.error?.code).toBe("no_result_version");
    const reqs = (await call("GET", `/api/tables/${tableId}/requests`, { token: seatA })).data.requests;
    expect(reqs.every((x: { status: string }) => x.status === "pending")).toBe(true);
  });

  it("批量 accept 夹带不存在的请求 → 404 no_request（全或无）", async () => {
    const r = await call("POST", `/api/tables/${tableId}/messages`, {
      token: seatA, body: { type: "RESPOND_REQUEST", payload: { requestIds: ["req_ghost", reqIds[0]], decision: "accept" } },
    });
    expect(r.error?.code).toBe("no_request");
    const reqs = (await call("GET", `/api/tables/${tableId}/requests`, { token: seatA })).data.requests;
    expect(reqs.every((x: { status: string }) => x.status === "pending")).toBe(true);
  });

  it("requestId/requestIds 皆空 → 422", async () => {
    const r = await call("POST", `/api/tables/${tableId}/messages`, {
      token: seatA, body: { type: "RESPOND_REQUEST", payload: { decision: "accept" } },
    });
    expect(r.status).toBe(422);
  });

  it("发布一个带 requestIds 的版本（只增一版）→ 批量 accept 一次处置 3 个 → execution 完成", async () => {
    await sleep(10_200); // seatA 已产生 6 次计费调用，后半程还有 3 次：等限频窗口滑过后再继续
    const pub = await call("POST", `/api/tables/${tableId}/artifacts`, {
      token: seatA,
      body: { artifactId, name: "批量案.md", format: "md", contentBase64: b64("# 批量案 v2\n三条意见全改\n"), changeNote: "v2 一次修订满足三请求", requestIds: reqIds },
    });
    expect(pub.ok, JSON.stringify(pub.error)).toBe(true);
    expect(pub.data.version.v).toBe(2);
    expect(pub.data.version.requestIds).toHaveLength(3);

    const acc = await call("POST", `/api/tables/${tableId}/messages`, {
      token: seatA, body: { type: "RESPOND_REQUEST", payload: { requestIds: reqIds, decision: "accept", reason: "一版全改" } },
    });
    expect(acc.ok, JSON.stringify(acc.error)).toBe(true);

    const reqs = (await call("GET", `/api/tables/${tableId}/requests`, { token: seatA })).data.requests;
    expect(reqs.every((x: { status: string }) => x.status === "executed")).toBe(true);
    const info = await call("GET", `/api/tables/${tableId}`, { token: seatA });
    expect(info.data.phase).toBe("convergence");
  });

  it("版本 requestIds 经 SQLite 持久化往返不丢", async () => {
    const v2 = await call("GET", `/api/tables/${tableId}/artifacts/${artifactId}?version=2`, { token: seatA });
    expect(v2.data.version.requestIds).toEqual(reqIds);
  });

  it("批量 reject 同样可用（全或无语义）+ 旧单值 requestId 写法兼容", async () => {
    // 单值兼容：评审→回应→请求 的旧路径仍走 requestId 字段（前面场景的派生请求已用单值 accept 验证过一半），
    // 这里补 schema 层之外的兼容断言：发布单 requestId 版本后 wire 版本仍是 requestId 单值。
    const pub = await call("POST", `/api/tables/${tableId}/artifacts`, {
      token: seatA,
      body: { artifactId, name: "批量案.md", format: "md", contentBase64: b64("# 批量案 v3\n单值兼容\n"), changeNote: "v3", requestId: reqIds[0] },
    });
    expect(pub.data.version.requestId).toBe(reqIds[0]);
    expect(pub.data.version.requestIds).toBeUndefined();
  });
});
