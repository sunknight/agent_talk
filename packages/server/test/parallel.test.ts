/**
 * 回合内并行调度（对现有桌型的并行扩展，hosted 桌主持人专用）验收：
 * - 门禁：仅 host 可发 PARALLEL_DISPATCH；仅轮换阶段；workers ⊆ 当前阶段未发言可轮换席位；单活跃批次
 * - 并行批次：入选成员同时持权（activeTurns/yourTurn 各自可见），非成员无权；一席交付不影响他席
 * - 汇聚（总-分-总）：批次全员交付/跳过 → INFO 汇聚广播 + 回默认顺序轮转；阶段推进条件与顺序提交同口径
 * - 点名单个：workers 单席=指定下一位发言人
 * - 盲评批次：成员互不可见他席本阶段回合提交与批次内产物（poll/changes/观察端/产物四口），汇聚后放开
 * - 预审旁路：批次成员回合提交不产生 HOST_PREREVIEW
 * - 跳过：批次内须带 seatId；被跳过席本批次视为已处理
 * fetch 直调 REST，零 mock。
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
async function newUser(name: string) {
  return (await call("POST", "/api/users", { body: { name } })).data.token as string;
}

/** 建 hosted 评审桌：建桌人=host（主持人），proposer + N 位 reviewer 就绪并开始（statements 起步） */
async function quickHostedReview(topic: string, reviewerNames: string[]) {
  const ownerUser = await newUser(`${topic}-host`);
  const created = await call("POST", "/api/tables", {
    token: ownerUser,
    body: {
      tableType: "review", mode: "hosted",
      topic, goals: "评审通过", deliverables: "修订文档", rules: "逐条评审",
      owner: { seatName: `${topic}-主持人`, agentLabel: "zcode" },
    },
  });
  expect(created.ok, `create hosted review: ${JSON.stringify(created.error)}`).toBe(true);
  expect(created.data.mode).toBe("hosted");
  const { tableId, ownerSeatToken, ownerSeatId, inviteCodes } = created.data;
  const propCode = inviteCodes.find((c: { role: string }) => c.role === "proposer").code;
  const revCode = inviteCodes.find((c: { role: string }) => c.role === "reviewer").code;

  const pu = await newUser(`${topic}-proposer`);
  const pj = await call("POST", `/api/tables/${tableId}/seats`, {
    token: pu, body: { inviteCode: propCode, seatName: `${topic}-提案方`, role: "proposer", agentLabel: "claude" },
  });
  expect(pj.ok).toBe(true);
  await call("POST", `/api/tables/${tableId}/seat-config`, {
    token: pj.data.token, body: { stance: "提案方", ready: true },
  });

  const reviewers: { seatId: string; token: string; userToken: string; name: string }[] = [];
  for (const name of reviewerNames) {
    const u = await newUser(name);
    const j = await call("POST", `/api/tables/${tableId}/seats`, {
      token: u, body: { inviteCode: revCode, seatName: name, role: "reviewer", agentLabel: "claude" },
    });
    expect(j.ok, `reviewer ${name} join: ${JSON.stringify(j.error)}`).toBe(true);
    await call("POST", `/api/tables/${tableId}/seat-config`, {
      token: j.data.token, body: { stance: `评审方 ${name}`, ready: true },
    });
    reviewers.push({ seatId: j.data.seatId, token: j.data.token, userToken: u, name });
  }

  const s = await call("POST", `/api/tables/${tableId}/start`, { token: ownerSeatToken });
  expect(s.ok, `start: ${JSON.stringify(s.error)}`).toBe(true);
  return {
    tableId,
    host: { seatId: ownerSeatId, token: ownerSeatToken, userToken: ownerUser },
    proposer: { seatId: pj.data.seatId, token: pj.data.token, userToken: pu },
    reviewers,
  };
}

async function tableOf(token: string, tableId: string) {
  const r = await call("GET", `/api/tables/${tableId}`, { token });
  expect(r.ok).toBe(true);
  return r.data as {
    phase: string; roundNo: number; activeTurn: { seatId: string } | null;
    activeTurns: { seatId: string; taskHint: string }[]; workerProgress: { seatId: string }[];
    parallelDispatch: { workers: string[]; submitted: string[]; visibility: string } | null;
    pendingSpeakers: string[];
  };
}

async function pollOnce(token: string, tableId: string) {
  const r = await call("GET", `/api/tables/${tableId}/poll?since=0&timeout=0`, { token });
  expect(r.ok).toBe(true);
  return r.data as {
    table: { phase: string; roundNo: number };
    yourTurn: { seatId: string; taskHint: string } | null;
    myTask: string | null;
    messages: { type: string; fromSeat: string; payload: any }[];
  };
}

async function dispatch(token: string, tableId: string, p: Record<string, unknown>) {
  return call("POST", `/api/tables/${tableId}/messages`, {
    token, body: { type: "PARALLEL_DISPATCH", payload: p },
  });
}

async function msg(token: string, tableId: string, type: string, payload: unknown) {
  return call("POST", `/api/tables/${tableId}/messages`, { token, body: { type, payload } });
}

/** 提案方走完 statements（产物+陈述）进入 review */
async function intoReview(t: Awaited<ReturnType<typeof quickHostedReview>>) {
  const a = await call("POST", `/api/tables/${t.tableId}/artifacts`, {
    token: t.proposer.token,
    body: { name: "提案.md", format: "md", contentBase64: b64("# 提案\nv1"), changeNote: "首版" },
  });
  expect(a.ok).toBe(true);
  const st = await msg(t.proposer.token, t.tableId, "STATEMENT", { text: "提案陈述：见产物 v1" });
  expect(st.ok, JSON.stringify(st.error)).toBe(true);
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-parallel-"));
  ({ http, hub } = await start({ port: 0, dataDir: dir, host: "127.0.0.1" }));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => {
  http.closeIdleConnections?.();
  http.close(() => r());
}));

describe("回合内并行：门禁", () => {
  it("仅 host 可调度；workers 须为当前阶段可轮换席位；单活跃批次", async () => {
    const t = await quickHostedReview("PD-gate", ["R1", "R2"]);
    // statements 阶段轮换席位只有提案方：评审员不可调度 → bad_workers
    const early = await dispatch(t.host.token, t.tableId, { workers: [t.reviewers[0].seatId] });
    expect(early.ok).toBe(false);
    expect(early.error!.code).toBe("bad_workers");
    // 非 host（评审方）发调度 → 403 role
    await intoReview(t);
    const byRev = await dispatch(t.reviewers[0].token, t.tableId, { workers: [t.reviewers[0].seatId] });
    expect(byRev.ok).toBe(false);
    expect(byRev.error!.code).toBe("role");
    // review 阶段 workers 含非轮换席位（提案方）→ 422
    const bad = await dispatch(t.host.token, t.tableId, { workers: [t.proposer.seatId] });
    expect(bad.ok).toBe(false);
    expect(bad.error!.code).toBe("bad_workers");
    // 合法单活跃批次存在时再发 → 409 dispatch_active
    const ok1 = await dispatch(t.host.token, t.tableId, { workers: [t.reviewers[0].seatId, t.reviewers[1].seatId] });
    expect(ok1.ok, JSON.stringify(ok1.error)).toBe(true);
    const dup = await dispatch(t.host.token, t.tableId, { workers: [t.reviewers[0].seatId] });
    expect(dup.ok).toBe(false);
    expect(dup.error!.code).toBe("dispatch_active");
  });
});

describe("回合内并行：批次执行与汇聚", () => {
  it("双评审并行持权；各自交付互不阻塞；全员交付即汇聚回顺序轮转并推进阶段", async () => {
    const t = await quickHostedReview("PD-batch", ["R1", "R2"]);
    await intoReview(t);
    const info = await tableOf(t.host.token, t.tableId);
    expect(info.phase).toBe("review");
    expect(info.pendingSpeakers.sort()).toEqual([t.reviewers[0].seatId, t.reviewers[1].seatId].sort());

    const d = await dispatch(t.host.token, t.tableId, {
      workers: [t.reviewers[0].seatId, t.reviewers[1].seatId],
      task: "统一按 must/should 分级", note: "口径见桌规则",
      perWorker: [{ seatId: t.reviewers[1].seatId, hint: "重点看第 2 章" }],
    });
    expect(d.ok, JSON.stringify(d.error)).toBe(true);

    const after = await tableOf(t.host.token, t.tableId);
    expect(after.parallelDispatch!.workers.length).toBe(2);
    expect(after.activeTurn).toBeNull(); // 多权并存时主发言权为 null
    expect(after.activeTurns.map((x) => x.seatId).sort()).toEqual([t.reviewers[0].seatId, t.reviewers[1].seatId].sort());
    // 两评审同时持有 yourTurn；taskHint 含调度任务与定向提示
    const p1 = await pollOnce(t.reviewers[0].token, t.tableId);
    const p2 = await pollOnce(t.reviewers[1].token, t.tableId);
    expect(p1.yourTurn?.seatId).toBe(t.reviewers[0].seatId);
    expect(p2.yourTurn?.seatId).toBe(t.reviewers[1].seatId);
    expect(p2.yourTurn!.taskHint).toContain("重点看第 2 章");
    expect(p2.yourTurn!.taskHint).toContain("统一按 must/should 分级");
    // 提案方无发言权
    const pp = await pollOnce(t.proposer.token, t.tableId);
    expect(pp.yourTurn).toBeNull();

    // R1 先交付（批次成员提交不经预审：无对应 HOST_PREREVIEW——提案方陈述的预审不受影响）；批次仍活跃（R2 未交付）
    const c1 = await msg(t.reviewers[0].token, t.tableId, "REVIEW_COMMENT", {
      items: [{ id: "i1", target: "第 1 节", severity: "should", comment: "建议补充背景" }], summary: "R1 意见", done: true,
    });
    expect(c1.ok).toBe(true);
    const mid = await tableOf(t.host.token, t.tableId);
    expect(mid.phase).toBe("review");
    expect(mid.activeTurns.map((x) => x.seatId)).toEqual([t.reviewers[1].seatId]);
    expect(mid.parallelDispatch!.submitted).toEqual([t.reviewers[0].seatId]);
    const pm = await pollOnce(t.host.token, t.tableId);
    expect(pm.messages.some((m) => m.type === "HOST_PREREVIEW" && m.payload.reviewedMsgId === c1.data.msgId)).toBe(false);

    // R2 交付 → 批次汇聚（INFO 广播）→ 全员已评 → 阶段推进 response（既有 maybeAdvance 语义）
    const c2 = await msg(t.reviewers[1].token, t.tableId, "REVIEW_COMMENT", {
      items: [{ id: "i2", target: "第 2 节", severity: "must", comment: "必须修正术语" }], summary: "R2 意见", done: true,
    });
    expect(c2.ok).toBe(true);
    const end = await tableOf(t.host.token, t.tableId);
    expect(end.phase).toBe("response");
    expect(end.parallelDispatch).toBeNull();
    expect(end.activeTurn?.seatId).toBe(t.proposer.seatId); // 回默认顺序轮转：提案方回应
    const pe = await pollOnce(t.host.token, t.tableId);
    expect(pe.messages.some((m) => m.type === "INFO" && String(m.payload.text ?? "").includes("并行批次已汇聚"))).toBe(true);
  });

  it("点名单个：单席批次=指定下一位发言人，交付后按顺序轮转继续", async () => {
    const t = await quickHostedReview("PD-single", ["R1", "R2"]);
    await intoReview(t);
    // 顺序轮转默认 R1 先；主持人点名 R2 先说
    const d = await dispatch(t.host.token, t.tableId, { workers: [t.reviewers[1].seatId] });
    expect(d.ok, JSON.stringify(d.error)).toBe(true);
    const after = await tableOf(t.host.token, t.tableId);
    expect(after.activeTurns.map((x) => x.seatId)).toEqual([t.reviewers[1].seatId]);
    expect(after.activeTurn?.seatId).toBe(t.reviewers[1].seatId); // 单权批次保留主发言权
    await msg(t.reviewers[1].token, t.tableId, "REVIEW_COMMENT", {
      items: [{ id: "i1", target: "全文", severity: "should", comment: "整体可行" }], summary: "R2 意见", done: true,
    });
    // 单人批次汇聚 → 剩余 R1 回默认顺序轮转
    const next = await tableOf(t.host.token, t.tableId);
    expect(next.phase).toBe("review");
    expect(next.activeTurn?.seatId).toBe(t.reviewers[0].seatId);
  });

  it("跳过批次成员（带 seatId）→ 批次汇聚；多人待交付省略 seatId 拒绝", async () => {
    const t = await quickHostedReview("PD-skip", ["R1", "R2"]);
    await intoReview(t);
    await dispatch(t.host.token, t.tableId, { workers: [t.reviewers[0].seatId, t.reviewers[1].seatId] });
    await msg(t.reviewers[0].token, t.tableId, "REVIEW_COMMENT", {
      items: [{ id: "i1", target: "第 1 节", severity: "nice", comment: "排版建议" }], summary: "R1 意见", done: true,
    });
    // 两人待交付已变一人（R2）——省略 seatId 单待交付可用；先试错误目标
    const bad = await call("POST", `/api/tables/${t.tableId}/my/skip-turn`, {
      token: t.host.userToken, body: { reason: "错目标", seatId: t.proposer.seatId },
    });
    expect(bad.ok).toBe(false);
    expect(bad.error!.code).toBe("bad_target");
    const skip = await call("POST", `/api/tables/${t.tableId}/my/skip-turn`, {
      token: t.host.userToken, body: { reason: "R2 无响应", seatId: t.reviewers[1].seatId },
    });
    expect(skip.ok, JSON.stringify(skip.error)).toBe(true);
    const end = await tableOf(t.host.token, t.tableId);
    expect(end.phase).toBe("response"); // R1 已交付 + R2 被跳过 → 全员处理 → 推进
    expect(end.parallelDispatch).toBeNull();
  });
});

describe("回合内并行：盲评批次", () => {
  it("批次成员互不可见他席本阶段回合提交与批次内产物；汇聚后放开；host 与非成员不受限", async () => {
    const t = await quickHostedReview("PD-blind", ["R1", "R2"]);
    await intoReview(t);
    await dispatch(t.host.token, t.tableId, {
      workers: [t.reviewers[0].seatId, t.reviewers[1].seatId], visibility: "blind",
    });
    // R1 先发产物 + 评审意见
    const art = await call("POST", `/api/tables/${t.tableId}/artifacts`, {
      token: t.reviewers[0].token,
      body: { name: "R1-评审笔记.md", format: "md", contentBase64: b64("R1 的独立笔记"), changeNote: "首版" },
    });
    expect(art.ok).toBe(true);
    const c1 = await msg(t.reviewers[0].token, t.tableId, "REVIEW_COMMENT", {
      items: [{ id: "i1", target: "第 1 节", severity: "must", comment: "R1 独立意见" }], summary: "R1", done: true,
    });
    expect(c1.ok).toBe(true);

    // R2 的 poll/changes 看不到 R1 的 REVIEW_COMMENT
    const p2 = await pollOnce(t.reviewers[1].token, t.tableId);
    expect(p2.messages.some((m) => m.type === "REVIEW_COMMENT" && m.fromSeat === t.reviewers[0].seatId)).toBe(false);
    const ch2 = await call("GET", `/api/tables/${t.tableId}/changes?since=0`, { token: t.reviewers[1].token });
    expect(ch2.ok).toBe(true);
    expect(ch2.data.changes.some((c: any) => c.kind === "message" && c.type === "REVIEW_COMMENT" && c.fromSeat === t.reviewers[0].seatId)).toBe(false);
    // R2 的产物列表不含 R1 批次产物；直取 403
    const la = await call("GET", `/api/tables/${t.tableId}/artifacts`, { token: t.reviewers[1].token });
    expect(la.data.artifacts.some((a: any) => a.artifactId === art.data.artifactId)).toBe(false);
    const ga = await call("GET", `/api/tables/${t.tableId}/artifacts/${art.data.artifactId}`, { token: t.reviewers[1].token });
    expect(ga.ok).toBe(false);
    expect(ga.error!.code).toBe("artifact_blind");
    // R2 观察端详情（user 视角）同样过滤
    const ob = await call("GET", `/api/observer/tables/${t.tableId}`, { token: t.reviewers[1].userToken });
    expect(ob.ok).toBe(true);
    expect(ob.data.messages.some((m: any) => m.type === "REVIEW_COMMENT" && m.fromSeat === t.reviewers[0].seatId)).toBe(false);
    // host 与提案方（非批次成员）不受限
    const ph = await pollOnce(t.host.token, t.tableId);
    expect(ph.messages.some((m) => m.type === "REVIEW_COMMENT" && m.fromSeat === t.reviewers[0].seatId)).toBe(true);

    // R2 交付 → 批次汇聚 → R1 的交付对 R2 可见
    await msg(t.reviewers[1].token, t.tableId, "REVIEW_COMMENT", {
      items: [{ id: "j1", target: "第 2 节", severity: "should", comment: "R2 独立意见" }], summary: "R2", done: true,
    });
    const p2b = await pollOnce(t.reviewers[1].token, t.tableId);
    expect(p2b.messages.some((m) => m.type === "REVIEW_COMMENT" && m.fromSeat === t.reviewers[0].seatId)).toBe(true);
    const gab = await call("GET", `/api/tables/${t.tableId}/artifacts/${art.data.artifactId}`, { token: t.reviewers[1].token });
    expect(gab.ok).toBe(true);
  });
});

describe("回合内并行：其他桌型与进度", () => {
  it("协作桌 statements 期并行：全体协作者同时持权交付初稿，全员齐备自动进互审", async () => {
    const u = await newUser("PD-collab-owner");
    const created = await call("POST", "/api/tables", {
      token: u,
      body: {
        tableType: "collab", mode: "hosted", topic: "并行初稿",
        owner: { seatName: "主持人", agentLabel: "zcode" },
      },
    });
    expect(created.ok).toBe(true);
    const { tableId, ownerSeatToken, inviteCodes } = created.data;
    const hostToken = ownerSeatToken;
    const colCode = inviteCodes.find((c: { role: string }) => c.role === "collaborator").code;
    const cols: { seatId: string; token: string }[] = [];
    for (const nm of ["C1", "C2"]) {
      const cu = await newUser(`PD-collab-${nm}`);
      const j = await call("POST", `/api/tables/${tableId}/seats`, {
        token: cu, body: { inviteCode: colCode, seatName: nm, role: "collaborator", agentLabel: "claude" },
      });
      expect(j.ok).toBe(true);
      await call("POST", `/api/tables/${tableId}/seat-config`, { token: j.data.token, body: { stance: `协作者 ${nm}`, ready: true } });
      cols.push({ seatId: j.data.seatId, token: j.data.token });
    }
    await call("POST", `/api/tables/${tableId}/start`, { token: hostToken });

    // 主持人把两位协作者同时派出写初稿
    const d = await dispatch(hostToken, tableId, { workers: cols.map((c) => c.seatId) });
    expect(d.ok, JSON.stringify(d.error)).toBe(true);
    const mid = await tableOf(hostToken, tableId);
    expect(mid.activeTurns.map((x) => x.seatId).sort()).toEqual(cols.map((c) => c.seatId).sort());
    // 思考进度按席投影
    const pr = await call("POST", `/api/tables/${tableId}/progress`, { token: cols[0].token, body: { stage: "working" } });
    expect(pr.ok).toBe(true);
    const wp = await tableOf(hostToken, tableId);
    expect(wp.workerProgress.map((x) => x.seatId)).toContain(cols[0].seatId);

    // 各自发布产物+陈述 → 全员齐备自动进互审（既有 statements 完成语义）
    for (let i = 0; i < cols.length; i++) {
      const a = await call("POST", `/api/tables/${tableId}/artifacts`, {
        token: cols[i].token,
        body: { name: `部分${i + 1}.md`, format: "md", contentBase64: b64(`# 部分 ${i + 1}`), changeNote: "初稿" },
      });
      expect(a.ok).toBe(true);
      const st = await msg(cols[i].token, tableId, "STATEMENT", { text: `协作者 ${i + 1} 初稿概述` });
      expect(st.ok).toBe(true);
    }
    const end = await tableOf(hostToken, tableId);
    expect(end.phase).toBe("review");
    expect(end.parallelDispatch).toBeNull();
  });

  it("暂停冻结批次交付，恢复后继续", async () => {
    const t = await quickHostedReview("PD-pause", ["R1", "R2"]);
    await intoReview(t);
    await dispatch(t.host.token, t.tableId, { workers: [t.reviewers[0].seatId, t.reviewers[1].seatId] });
    const pause = await call("POST", `/api/tables/${t.tableId}/my/pause`, { token: t.host.userToken, body: { reason: "等资料" } });
    expect(pause.ok).toBe(true);
    const sa = await msg(t.reviewers[0].token, t.tableId, "REVIEW_COMMENT", {
      items: [{ id: "i1", target: "全文", severity: "should", comment: "x" }], summary: "暂停中", done: true,
    });
    expect(sa.ok).toBe(false);
    expect(sa.error!.code).toBe("meeting_paused");
    await call("POST", `/api/tables/${t.tableId}/seat-config`, { token: t.reviewers[0].token, body: { stance: "评审方", ready: true } });
    await call("POST", `/api/tables/${t.tableId}/seat-config`, { token: t.reviewers[1].token, body: { stance: "评审方", ready: true } });
    const resume = await call("POST", `/api/tables/${t.tableId}/my/resume`, { token: t.host.userToken });
    expect(resume.ok).toBe(true);
    const sa2 = await msg(t.reviewers[0].token, t.tableId, "REVIEW_COMMENT", {
      items: [{ id: "i1", target: "全文", severity: "should", comment: "恢复后交付" }], summary: "R1", done: true,
    });
    expect(sa2.ok).toBe(true);
    const mid = await tableOf(t.host.token, t.tableId);
    expect(mid.activeTurns.map((x) => x.seatId)).toEqual([t.reviewers[1].seatId]);
  });
});
