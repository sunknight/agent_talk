/**
 * 变动记录（回合开始刷新）验收：
 * GET /api/tables/:id/changes（table+documents+changes 三合一）、poll 响应附加
 * documents/changes、private downloadable 视角差异、since 游标过滤与空增量、
 * 观察端 recentChanges、skill 模板回合刷新约定文案、观察页变动记录面板。
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

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

/** 建桌（不开始）：建桌人 proposer + 一名 reviewer，全部就绪 */
async function tableWithSeats(topic: string) {
  const ownerUser = (await call("POST", "/api/users", { body: { name: `${topic}-owner` } })).data.token;
  const created = await call("POST", "/api/tables", {
    token: ownerUser,
    body: { topic, owner: { seatName: `${topic}-owner`, agentLabel: "zcode" } },
  });
  const { tableId, ownerSeatToken, ownerSeatId, inviteCodes } = created.data;
  const reviewerCode = inviteCodes.find((c: { role: string }) => c.role === "reviewer").code;
  await call("POST", `/api/tables/${tableId}/seat-config`, {
    token: ownerSeatToken, body: { stance: "需求提出方", ready: true },
  });
  const ru = (await call("POST", "/api/users", { body: { name: `${topic}-rev` } })).data.token;
  const rj = await call("POST", `/api/tables/${tableId}/seats`, {
    token: ru, body: { inviteCode: reviewerCode, seatName: `${topic}-rev`, role: "reviewer", agentLabel: "claude" },
  });
  expect(rj.ok).toBe(true);
  await call("POST", `/api/tables/${tableId}/seat-config`, {
    token: rj.data.token, body: { stance: "评审方", ready: true },
  });
  return {
    tableId,
    ownerUser,
    reviewerUser: ru,
    owner: { seatId: ownerSeatId, token: ownerSeatToken },
    reviewer: { seatId: rj.data.seatId, token: rj.data.token },
  };
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-chg-test-"));
  ({ http } = await start({ port: 0, dataDir: dir, host: "127.0.0.1" }));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => {
  http.closeIdleConnections?.();
  http.close(() => r());
}));

describe("变动记录：changes 接口与 poll 增强", () => {
  let t: Awaited<ReturnType<typeof tableWithSeats>>;
  let privateDocId = "";

  it("上传资料后：poll 响应附 documents 与 changes（kind=doc）", async () => {
    t = await tableWithSeats("回合刷新验收");
    await call("POST", `/api/tables/${t.tableId}/documents`, {
      token: t.owner.token,
      body: { name: "req.docx", purpose: "待评审需求文档", visibility: "shared", contentBase64: b64("# 需求") },
    });

    const poll = await call("GET", `/api/tables/${t.tableId}/poll?since=0&timeout=0`, { token: t.reviewer.token });
    expect(poll.ok, JSON.stringify(poll.error)).toBe(true);
    expect(Array.isArray(poll.data.documents)).toBe(true);
    expect(poll.data.documents.some((d: any) => d.name === "req.docx" && d.downloadable === true)).toBe(true);
    const docChg = poll.data.changes.find((c: any) => c.kind === "doc");
    expect(docChg).toBeTruthy();
    expect(docChg.doc.name).toBe("req.docx");
    expect(docChg.doc).not.toHaveProperty("contentBase64"); // 变动只带元数据
    // changes 与 messages 同源：条目数一致
    expect(poll.data.changes.length).toBe(poll.data.messages.length);
  });

  it("GET changes：table+documents+changes 三合一；私有文档 downloadable 按席位区分", async () => {
    const priv = await call("POST", `/api/tables/${t.tableId}/documents`, {
      token: t.owner.token,
      body: { name: "draft.md", purpose: "提案方内部底稿", visibility: "private", contentBase64: b64("内部") },
    });
    expect(priv.ok).toBe(true);
    privateDocId = priv.data.doc.docId;

    const chg = await call("GET", `/api/tables/${t.tableId}/changes?since=0`, { token: t.reviewer.token });
    expect(chg.ok, JSON.stringify(chg.error)).toBe(true);
    expect(chg.data.table.tableId).toBe(t.tableId);
    expect(chg.data.table.phase).toBe("open");
    const byId = new Map<string, any>(chg.data.documents.map((d: any) => [d.docId, d]));
    expect(byId.get(privateDocId).downloadable).toBe(false); // 他席 private
    expect(chg.data.documents.find((d: any) => d.name === "req.docx").downloadable).toBe(true);

    const own = await call("GET", `/api/tables/${t.tableId}/changes?since=0`, { token: t.owner.token });
    expect(new Map<string, any>(own.data.documents.map((d: any) => [d.docId, d])).get(privateDocId).downloadable).toBe(true);

    // 变动分类：入席（join/config）与资料上传都在
    const kinds = chg.data.changes.map((c: any) => c.kind);
    expect(kinds).toContain("seat");
    expect(kinds.filter((k: string) => k === "doc").length).toBe(2);
    const seatJoin = chg.data.changes.find((c: any) => c.kind === "seat" && c.what === "join");
    expect(seatJoin.seatName).toBeTruthy();
    const seatCfg = chg.data.changes.find((c: any) => c.kind === "seat" && c.what === "config");
    expect(seatCfg).toBeTruthy();
  });

  it("网页人工指令 → kind=human（带 byHuman）；since 游标过滤与空增量", async () => {
    const before = await call("GET", `/api/tables/${t.tableId}/changes?since=0`, { token: t.reviewer.token });
    const lastSeq = before.data.changes.length
      ? Math.max(...(await call("GET", `/api/tables/${t.tableId}/poll?since=0&timeout=0`, { token: t.reviewer.token })).data.messages.map((m: any) => m.seq))
      : 0;

    await call("POST", `/api/tables/${t.tableId}/human-input`, {
      token: t.ownerUser, body: { text: "请各方以最新上传的 req.docx 为评审对象", byHuman: "sunknight" },
    });

    const after = await call("GET", `/api/tables/${t.tableId}/changes?since=${lastSeq}`, { token: t.reviewer.token });
    expect(after.data.changes.length).toBe(1);
    const human = after.data.changes[0];
    expect(human.kind).toBe("human");
    expect(human.byHuman).toBe("sunknight");

    const newestSeq = Math.max(...(await call("GET", `/api/tables/${t.tableId}/poll?since=0&timeout=0`, { token: t.reviewer.token })).data.messages.map((m: any) => m.seq));
    const empty = await call("GET", `/api/tables/${t.tableId}/changes?since=${newestSeq}`, { token: t.reviewer.token });
    expect(empty.data.changes).toEqual([]);
    expect(empty.data.documents.length).toBe(2); // 最新清单仍随行返回
  });

  it("会议推进：phase / artifact 变动条目；发言权桌子仍可刷新", async () => {
    await call("POST", `/api/tables/${t.tableId}/start`, { token: t.owner.token });
    await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.owner.token, body: { type: "STATEMENT", payload: { text: "按 req.docx 陈述提案" } },
    });
    await call("POST", `/api/tables/${t.tableId}/artifacts`, {
      token: t.owner.token,
      body: { name: "方案.md", format: "md", contentBase64: b64("# 方案"), changeNote: "v1" },
    });

    const chg = await call("GET", `/api/tables/${t.tableId}/changes?since=0`, { token: t.reviewer.token });
    const kinds = chg.data.changes.map((c: any) => c.kind);
    expect(kinds).toContain("phase");
    expect(kinds).toContain("artifact");
    const art = chg.data.changes.find((c: any) => c.kind === "artifact");
    expect(art.version).toBe(1);
    expect(art.changeNote).toBe("v1");
    const ph = chg.data.changes.filter((c: any) => c.kind === "phase").map((c: any) => c.to);
    expect(ph).toContain("statements");
    expect(ph).toContain("review");
    // 普通讨论消息归类为 message（只带 type 定位）
    const st = chg.data.changes.find((c: any) => c.kind === "message" && c.type === "STATEMENT");
    expect(st).toBeTruthy();
  });

  it("观察端 recentChanges（与 agent changes 同源，最近 50 条）", async () => {
    const det = await call("GET", `/api/observer/tables/${t.tableId}`, { token: t.reviewerUser });
    expect(det.ok, JSON.stringify(det.error)).toBe(true);
    const rc = det.data.recentChanges;
    expect(Array.isArray(rc)).toBe(true);
    expect(rc.length).toBeLessThanOrEqual(50);
    expect(rc.some((c: any) => c.kind === "doc")).toBe(true);
    expect(rc.some((c: any) => c.kind === "artifact")).toBe(true);
    expect(rc.at(-1).kind).toBe("phase"); // 产物发布触发自动推进：最后一条变动 = 进入评审
  });

  it("鉴权：无席位 token 拒绝", async () => {
    const anon = await call("GET", `/api/tables/${t.tableId}/changes?since=0`);
    expect(anon.status).toBe(401);
    const stranger = (await call("POST", "/api/users", { body: { name: "陌生席位" } })).data.token;
    const wrong = await call("GET", `/api/tables/${t.tableId}/changes?since=0`, { token: stranger });
    expect(wrong.status).toBe(401); // user token 非席位 token
  });
});

describe("skill 模板与观察页文案（字符串级断言）", () => {
  it("skill.md 含回合开始刷新硬约定与强制读取措辞", () => {
    expect(SKILL_MD).toContain("回合开始刷新（硬约定）");
    expect(SKILL_MD).toContain("禁止沿用上一回合缓存的桌况发言或工作");
    expect(SKILL_MD).toContain("必须在本回合发言/工作前按 §5.2 下载到 ./roundtables/$tableId/docs/ 并阅读");
    expect(SKILL_MD).toContain("changes?since=$lastSeq");
    expect(SKILL_MD).toContain("资料文档：共 N 份");
    expect(SKILL_MD.indexOf("回合开始刷新（硬约定）")).toBeGreaterThan(SKILL_MD.indexOf("持续循环：")); // 约定位于核心循环内
  });

  it("skill.md 空转等待间隔为约 15 秒（任务 0029：60 秒→15 秒）", () => {
    expect(SKILL_MD).toContain("等待约 15 秒再回到第 1 步");
    expect(SKILL_MD).not.toContain("等待约 60 秒");
  });

  it("观察页消息流由会话视图（chatbox）承载：历史面板已移除（任务 0033 第 4 轮）", () => {
    expect(OBSERVER_HTML).toContain("chatboxCardHtml"); // 会话卡构造器
    expect(OBSERVER_HTML).toContain('id="cbList"'); // 气泡列表容器
    expect(OBSERVER_HTML).toContain("data-cf"); // 全部/发言/指令/系统筛选芯片
    expect(OBSERVER_HTML).toContain("msgBodyText"); // 消息正文提取（气泡渲染用）
    expect(OBSERVER_HTML).not.toContain("会议历史 · 变动记录"); // 旧合并流面板不再渲染
    expect(OBSERVER_HTML).not.toContain("recentChanges"); // 前端不再消费（API 保留给 agent changes 同源接口）
  });
});
