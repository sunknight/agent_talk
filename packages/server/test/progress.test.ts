/**
 * 思考进度旁路上报验收：
 * 上报（持发言权席 recorded / 非发言权席忽略 / 未认证 401 / 非法枚举 422 / 同轮 1s 节流）、
 * 投影（GET table 与观察端详情的 turnProgress；发言消费换轮后回落 null，旧记录不串新轮）、
 * 观察端阶段文案与 skill 模板上报说明。
 * fetch 直调 REST，零 mock。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start } from "../src";
import { SKILL_MD } from "../src/skill-template";
import { OBSERVER_HTML } from "../src/observer-html";

let base = "";
let http: import("node:http").Server;

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
  return (await call("POST", "/api/users", { body: { name } })).data.token as string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-progress-test-"));
  ({ http } = await start({ port: 0, dataDir: dir, host: "127.0.0.1" }));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => { http.closeIdleConnections?.(); http.close(() => r()); }));

describe("思考进度旁路上报", () => {
  let ownerUser = "", revUser = "";
  let tableId = "", ownerSeatToken = "", revSeatToken = "";

  it("前置：建桌（owner + reviewer 就绪）→ 开始 → 提案方持发言权，初始无进度", async () => {
    ownerUser = await reg("进度-建桌人");
    revUser = await reg("进度-评审");
    const created = await call("POST", "/api/tables", {
      token: ownerUser, body: { topic: "思考进度验收桌", owner: { seatName: "建桌人A", agentLabel: "zcode" } },
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

    const t = await call("GET", `/api/tables/${tableId}`, { token: ownerSeatToken });
    expect(t.data.phase).toBe("statements");
    expect(t.data.activeTurn.seatId).toBe(t.data.seats.find((s: any) => s.name === "建桌人A").seatId);
    expect(t.data.turnProgress).toBeNull();
  });

  it("上报：持发言权席 recorded 并投影；同轮 1s 节流；非发言权席忽略；401/422", async () => {
    expect((await call("POST", `/api/tables/${tableId}/progress`, { body: { stage: "working" } })).status).toBe(401);
    expect((await call("POST", `/api/tables/${tableId}/progress`, { token: ownerSeatToken, body: { stage: "thinking-hard" } })).error?.code).toBe("bad_payload");
    expect((await call("POST", `/api/tables/${tableId}/progress`, { token: ownerSeatToken, body: {} })).error?.code).toBe("bad_payload");

    const p1 = await call("POST", `/api/tables/${tableId}/progress`, { token: ownerSeatToken, body: { stage: "preparing" } });
    expect(p1.data).toEqual({ recorded: true });

    // 同轮 1 秒内重复上报：静默忽略，投影不变
    const p2 = await call("POST", `/api/tables/${tableId}/progress`, { token: ownerSeatToken, body: { stage: "working" } });
    expect(p2.data).toEqual({ recorded: false });
    let t = await call("GET", `/api/tables/${tableId}`, { token: ownerSeatToken });
    expect(t.data.turnProgress).toMatchObject({ stage: "preparing" });
    expect(typeof t.data.turnProgress.updatedAt).toBe("number");

    // 非发言权席（评审B）上报：recorded:false，不覆盖既有投影
    expect((await call("POST", `/api/tables/${tableId}/progress`, { token: revSeatToken, body: { stage: "finalizing" } })).data).toEqual({ recorded: false });
    t = await call("GET", `/api/tables/${tableId}`, { token: ownerSeatToken });
    expect(t.data.turnProgress.stage).toBe("preparing");

    await sleep(1_100);
    expect((await call("POST", `/api/tables/${tableId}/progress`, { token: ownerSeatToken, body: { stage: "working" } })).data).toEqual({ recorded: true });

    // 观察端详情（用户视角）同款投影
    const obs = await call("GET", `/api/observer/tables/${tableId}`, { token: ownerUser });
    expect(obs.data.table.turnProgress).toMatchObject({ stage: "working" });
  });

  it("轮转回落：发言消费换轮后 turnProgress=null，旧轮上报不串新轮", async () => {
    // 发布产物 v1 + 定稿上报 + STATEMENT → 进入 review、发言权归评审方
    await sleep(1_100);
    const art = await call("POST", `/api/tables/${tableId}/artifacts`, {
      token: ownerSeatToken,
      body: { name: "提案.md", format: "md", contentBase64: Buffer.from("# 提案\n内容").toString("base64"), changeNote: "v1" },
    });
    expect(art.ok).toBe(true);
    expect((await call("POST", `/api/tables/${tableId}/progress`, { token: ownerSeatToken, body: { stage: "finalizing" } })).data).toEqual({ recorded: true });
    const st = await call("POST", `/api/tables/${tableId}/messages`, { token: ownerSeatToken, body: { type: "STATEMENT", payload: { text: "提案陈述" } } });
    expect(st.ok).toBe(true);

    const t = await call("GET", `/api/tables/${tableId}`, { token: ownerSeatToken });
    expect(t.data.phase).toBe("review");
    expect(t.data.activeTurn.seatId).toBe(t.data.seats.find((s: any) => s.name === "评审B").seatId);
    expect(t.data.turnProgress).toBeNull();

    // 原提案方（已不持发言权）的迟到上报被忽略
    expect((await call("POST", `/api/tables/${tableId}/progress`, { token: ownerSeatToken, body: { stage: "working" } })).data).toEqual({ recorded: false });
  });

  it("文案与协议：观察端含阶段文案与回落文案；skill 模板含上报说明", () => {
    expect(OBSERVER_HTML).toContain("turnStageLabel");
    for (const label of ["准备中", "处理中", "即将结束", "思考中"]) expect(OBSERVER_HTML).toContain(label);
    expect(OBSERVER_HTML).not.toContain("思考中 = 当前发言权"); // 图例已升级为思考进度
    expect(SKILL_MD).toContain("/api/tables/$tableId/progress");
    expect(SKILL_MD).toContain("preparing|working|finalizing");
  });
});
