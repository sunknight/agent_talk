/** 参与引导 + 我的席位通道验收：poll myTask 分阶段提示、网页入桌设定（my/seat-config）、人工代答（my/message human_proxied） */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start } from "../src";

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

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

/** 无等待 poll：since 取大值避开存量消息，timeout=0 立即返回 */
function poll(token: string, tableId: string) {
  return call("GET", `/api/tables/${tableId}/poll?since=99999&timeout=0`, { token });
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-guide-"));
  ({ http } = await start({ port: 0, dataDir: dir, host: "127.0.0.1" }));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => { http.closeIdleConnections?.(); http.close(() => r()); }));

describe("参与引导（poll myTask）与我的席位通道", () => {
  let ownerUser = "", revUser = "", stranger = "";
  let tableId = "", ownerSeatToken = "", revSeatToken = "", revSeatId = "", ownerSeatId = "";

  it("前置：建桌 + 评审入席", async () => {
    ownerUser = (await call("POST", "/api/users", { body: { name: "引导-建桌人" } })).data.token;
    revUser = (await call("POST", "/api/users", { body: { name: "引导-评审" } })).data.token;
    stranger = (await call("POST", "/api/users", { body: { name: "引导-路人" } })).data.token;
    const created = await call("POST", "/api/tables", {
      token: ownerUser,
      body: { topic: "引导测试桌", owner: { seatName: "建桌人A", agentLabel: "zcode" } },
    });
    tableId = created.data.tableId;
    ownerSeatToken = created.data.ownerSeatToken;
    ownerSeatId = created.data.ownerSeatId;
    const rc = created.data.inviteCodes.find((c: { role: string }) => c.role === "reviewer").code;
    const j = await call("POST", `/api/tables/${tableId}/seats`, {
      token: revUser, body: { inviteCode: rc, seatName: "评审B", role: "reviewer", agentLabel: "claude" },
    });
    revSeatToken = j.data.token;
    revSeatId = j.data.seatId;
  });

  it("open 阶段 myTask：未就绪席位拿到入桌设定指引", async () => {
    const r = await poll(revSeatToken, tableId);
    expect(r.ok).toBe(true);
    expect(r.data.myTask).toContain("入桌设定");
    expect(r.data.myTask).toContain("ready:true");
    expect(r.data.yourTurn).toBeNull(); // open 阶段普通席位无发言权，待办与发言权解耦
  });

  it("open 阶段 myTask：建桌人未设定时同样拿到入桌设定指引", async () => {
    const r = await poll(ownerSeatToken, tableId);
    expect(r.ok).toBe(true);
    expect(r.data.myTask).toContain("入桌设定"); // 建桌人也是席位，同样要先完成自身设定
  });

  it("open 阶段 myTask：建桌人就绪后看到未就绪名单", async () => {
    await call("POST", `/api/tables/${tableId}/seat-config`, { token: ownerSeatToken, body: { stance: "提案方", ready: true } });
    const r = await poll(ownerSeatToken, tableId);
    expect(r.data.myTask).toContain("等待席位完成设定");
    expect(r.data.myTask).toContain("评审B");
  });

  it("my/seat-config：路人 403；评审持有人网页完成设定后 myTask 变为等待开始", async () => {
    const deny = await call("POST", `/api/tables/${tableId}/my/seat-config`, {
      token: stranger, body: { stance: "x", ready: true },
    });
    expect(deny.status).toBe(403);
    expect(deny.error.code).toBe("no_seat");

    const set = await call("POST", `/api/tables/${tableId}/my/seat-config`, {
      token: revUser,
      body: { stancePreset: "req-reviewer", stance: "评审方：逐条严格审", scope: "全文", dataScope: ["d.md"], ready: true },
    });
    expect(set.ok).toBe(true);
    expect(set.data.seat.config.ready).toBe(true);

    const rRev = await poll(revSeatToken, tableId);
    expect(rRev.data.myTask).toContain("已就绪，等待建桌人");
    const rOwner = await poll(ownerSeatToken, tableId);
    expect(rOwner.data.myTask).toContain("全员已就绪");
    expect(rOwner.data.myTask).toContain("start");
  });

  it("开局后 myTask：轮到者拿到 taskHint，未轮到者为空", async () => {
    await call("POST", `/api/tables/${tableId}/start`, { token: ownerSeatToken });
    const rOwner = await poll(ownerSeatToken, tableId);
    expect(rOwner.data.myTask).toContain("陈述");
    const rRev = await poll(revSeatToken, tableId);
    expect(rRev.data.myTask).toBeNull();
  });

  it("my/message 代答：路人 403；阶段白名单照常生效", async () => {
    const deny = await call("POST", `/api/tables/${tableId}/my/message`, {
      token: stranger, body: { type: "QUESTION", payload: { text: "x" } },
    });
    expect(deny.status).toBe(403);
    expect(deny.error.code).toBe("no_seat");

    // statements 阶段替发 REVIEW_COMMENT → 阶段校验拒绝（白名单先于角色校验）
    const phaseDeny = await call("POST", `/api/tables/${tableId}/my/message`, {
      token: revUser, body: { type: "REVIEW_COMMENT", payload: { items: [{ id: "a", target: "t", severity: "must", comment: "x" }] } },
    });
    expect(phaseDeny.status).toBe(409);
    expect(phaseDeny.error.code).toBe("wrong_phase");

    // statements 阶段评审人替发 STATEMENT → 阶段允许该类型但角色拒绝（仅提案人可陈述）
    const roleDeny2 = await call("POST", `/api/tables/${tableId}/my/message`, {
      token: revUser, body: { type: "STATEMENT", payload: { text: "替答" } },
    });
    expect(roleDeny2.status).toBe(403);
    expect(roleDeny2.error.code).toBe("role");
  });

  it("my/message 代答成功：消息进历史且 flags 标 human_proxied；角色校验照常", async () => {
    await call("POST", `/api/tables/${tableId}/artifacts`, { token: ownerSeatToken, body: { name: "d.md", format: "md", contentBase64: b64("v1"), changeNote: "初稿" } });
    await call("POST", `/api/tables/${tableId}/messages`, { token: ownerSeatToken, body: { type: "STATEMENT", payload: { text: "提案陈述" } } });

    // review 阶段建桌人（proposer）替发 REVIEW_COMMENT → 角色校验拒绝（人工不能替他人角色发言）
    const roleDeny = await call("POST", `/api/tables/${tableId}/my/message`, {
      token: ownerUser, body: { type: "REVIEW_COMMENT", payload: { items: [{ id: "a", target: "t", severity: "must", comment: "x" }] } },
    });
    expect(roleDeny.status).toBe(403);
    expect(roleDeny.error.code).toBe("role");

    const ans = await call("POST", `/api/tables/${tableId}/my/message`, {
      token: revUser,
      body: { type: "REVIEW_COMMENT", payload: { items: [{ id: "r1", target: "第1节", severity: "must", comment: "网页代答意见" }], summary: "代答", done: true } },
    });
    expect(ans.ok).toBe(true);
    expect(ans.data.message.flags).toContain("human_proxied");

    // 代答消费了 turn：phase 推进到 response，评审人再发 → wrong_phase
    const again = await call("POST", `/api/tables/${tableId}/my/message`, {
      token: revUser, body: { type: "REVIEW_COMMENT", payload: { items: [{ id: "r2", target: "t", severity: "nice", comment: "x" }] } },
    });
    expect(again.status).toBe(409);
  });

  it("closed 阶段 myTask：提示会议已结束", async () => {
    await call("POST", `/api/tables/${tableId}/messages`, {
      token: ownerSeatToken,
      body: { type: "HUMAN_RULING", payload: { instruction: "测试直接收会", forceConvergence: true } },
    });
    const r = await poll(ownerSeatToken, tableId);
    expect(r.data.table.phase).toBe("closed");
    expect(r.data.myTask).toContain("会议已结束");
    // closed 后代答被拒
    const deny = await call("POST", `/api/tables/${tableId}/my/message`, {
      token: ownerUser, body: { type: "QUESTION", payload: { text: "x" } },
    });
    expect(deny.status).toBe(409);
  });

  it("observerDetail.mySeatId：席位持有人映射到己席，路人为空", async () => {
    const own = await call("GET", `/api/observer/tables/${tableId}`, { token: ownerUser });
    expect(own.data.mySeatId).toBe(ownerSeatId);
    const rev = await call("GET", `/api/observer/tables/${tableId}`, { token: revUser });
    expect(rev.data.mySeatId).toBe(revSeatId);
    const st = await call("GET", `/api/observer/tables/${tableId}`, { token: stranger });
    expect(st.data.mySeatId).toBeNull();
  });
});
