/**
 * 会议暂停/恢复 + 暂停申请（任务 0024）：
 * - 直接暂停（建桌人/主持人 my 通道、systemadmin admin 通道）与暂停期闸门（回合消息/产物 409，讨论类/资料/seat-config 放行）
 * - 就绪语义（动设定才重置；显式 ready:true 重新就绪；不动者保持就绪）
 * - 申请暂停（任意席位含 observer）→ 控制人同意（多申请 superseded、暂停期再申请 409）
 * - 恢复（建桌人/主持人需全员就绪；systemadmin 可 force 跳过）与留痕（消息/changes/审计记录申请方）
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

async function reg(name: string) {
  const r = await call("POST", "/api/users", { body: { name } });
  return r.data.token as string;
}
async function userIdOf(token: string) {
  return (await call("GET", "/api/me", { token })).data.userId as string;
}
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

/** 快速搭一张已开始的桌：建桌人（proposer）+ N 个评审人（全部就绪并点开始） */
async function quickTable(topic: string, reviewerNames: string[]) {
  const ownerUser = (await call("POST", "/api/users", { body: { name: `${topic}-owner` } })).data.token;
  const created = await call("POST", "/api/tables", {
    token: ownerUser,
    body: { topic, goals: "达成共识", owner: { seatName: `${topic}-owner`, agentLabel: "zcode" } },
  });
  const { tableId, ownerSeatToken, ownerSeatId, inviteCodes } = created.data;
  const reviewerCode = inviteCodes.find((c: { role: string }) => c.role === "reviewer").code;
  await call("POST", `/api/tables/${tableId}/seat-config`, {
    token: ownerSeatToken, body: { stance: "需求提出方", ready: true },
  });
  const reviewers: { seatId: string; token: string; userToken: string; name: string }[] = [];
  for (const name of reviewerNames) {
    const u = await reg(name);
    const j = await call("POST", `/api/tables/${tableId}/seats`, {
      token: u, body: { inviteCode: reviewerCode, seatName: name, role: "reviewer", agentLabel: "claude" },
    });
    expect(j.ok, `reviewer ${name} join: ${JSON.stringify(j.error)}`).toBe(true);
    await call("POST", `/api/tables/${tableId}/seat-config`, {
      token: j.data.token, body: { stance: `评审方 ${name}`, ready: true },
    });
    reviewers.push({ seatId: j.data.seatId, token: j.data.token, userToken: u, name });
  }
  const s = await call("POST", `/api/tables/${tableId}/start`, { token: ownerSeatToken });
  expect(s.ok, `start: ${JSON.stringify(s.error)}`).toBe(true);
  return { tableId, owner: { seatId: ownerSeatId, token: ownerSeatToken, userToken: ownerUser }, reviewers };
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-pause-"));
  ({ http, hub } = await start({ port: 0, dataDir: dir, host: "127.0.0.1" }));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => {
  http.closeIdleConnections?.();
  http.close(() => r());
}));

describe("会议暂停/恢复与暂停申请", () => {
  let admin = "", owner = "", rev1 = "", rev2 = "";
  let tableId = "", ownerSeat = "", rev1Seat = "", rev2Seat = "";
  let ownerSeatToken = "", rev1SeatToken = "", rev2SeatToken = "";

  it("前置：注册 + 授予 admin + 建桌入席开局（statements 阶段）", async () => {
    admin = await reg("暂停-管理员");
    hub.store.setUserRole(await userIdOf(admin), "systemadmin"); // 等价 bootstrap 手工标记

    const t = await quickTable("暂停流程测试桌", ["暂停-评审1", "暂停-评审2"]);
    tableId = t.tableId;
    owner = t.owner.userToken; ownerSeat = t.owner.seatId; ownerSeatToken = t.owner.token;
    rev1 = t.reviewers[0].userToken; rev1Seat = t.reviewers[0].seatId; rev1SeatToken = t.reviewers[0].token;
    rev2 = t.reviewers[1].userToken; rev2Seat = t.reviewers[1].seatId; rev2SeatToken = t.reviewers[1].token;

    const info = await call("GET", `/api/tables/${tableId}`, { token: ownerSeatToken });
    expect(info.data.phase).toBe("statements");
    expect(info.data.activeTurn.seatId).toBe(ownerSeat);
  });

  it("权限：普通席位不能直接暂停/同意/继续；open 桌不可暂停", async () => {
    const deny1 = await call("POST", `/api/tables/${tableId}/my/pause`, { token: rev1, body: { reason: "x" } });
    expect(deny1.status).toBe(403);
    expect(deny1.error?.code).toBe("not_controller");
    const deny2 = await call("POST", `/api/tables/${tableId}/my/resume`, { token: rev1 });
    expect(deny2.error?.code).toBe("not_controller");
    const deny3 = await call("POST", `/api/tables/${tableId}/my/pause-request/none/approve`, { token: rev1 });
    expect(deny3.error?.code).toBe("not_controller");

    // open 阶段的桌不可暂停（会议尚未开始）
    const openUser = await reg("暂停-open用户");
    const open = await call("POST", "/api/tables", {
      token: openUser, body: { topic: "暂停-open桌", owner: { seatName: "open-建桌人", agentLabel: "zcode" } },
    });
    const badPhase = await call("POST", `/api/tables/${open.data.tableId}/my/pause`, { token: openUser, body: { reason: "x" } });
    expect(badPhase.status).toBe(409);
    expect(badPhase.error?.code).toBe("not_meeting");
  });

  it("建桌人直接暂停：叠加态生效、无发言权、广播与审计留痕", async () => {
    const r = await call("POST", `/api/tables/${tableId}/my/pause`, { token: owner, body: { reason: "各方需要补充背景资料" } });
    expect(r.ok, JSON.stringify(r.error)).toBe(true);

    const info = await call("GET", `/api/tables/${tableId}`, { token: ownerSeatToken });
    const tb = info.data;
    expect(tb.phase).toBe("statements"); // 阶段保留
    expect(tb.pause).toBeTruthy();
    expect(tb.pause.via).toBe("direct");
    expect(tb.pause.byName).toBe("暂停流程测试桌-owner");
    expect(tb.pause.reason).toBe("各方需要补充背景资料");
    expect(tb.activeTurn).toBeNull(); // 暂停期不授发言权

    // 消息广播
    const msgs = hub.store.getMessages(tableId);
    const paused = msgs.filter((m) => m.type === "MEETING_PAUSED");
    expect(paused).toHaveLength(1);
    expect((paused[0].payload as { byName: string }).byName).toBe("暂停流程测试桌-owner");
    expect((paused[0].payload as { note?: string }).note).toBeTruthy();

    // myTask 提示暂停（席位视角）
    const poll = await call("GET", `/api/tables/${tableId}/poll?since=0&timeout=0`, { token: ownerSeatToken });
    expect(poll.data.myTask).toContain("会议已暂停");

    // changes 结构化投影
    const chg = await call("GET", `/api/tables/${tableId}/changes?since=0`, { token: ownerSeatToken });
    const pauseChg = chg.data.changes.filter((c: { kind: string }) => c.kind === "pause");
    expect(pauseChg.some((c: { what: string }) => c.what === "pause")).toBe(true);

    // 审计
    const aud = hub.store.listAudit(500).filter((a) => a.tableId === tableId && a.event === "table_pause");
    expect(aud).toHaveLength(1);
    expect((aud[0].detail as { via: string }).via).toBe("direct");

    // 列表页 paused 标记
    const list = await call("GET", "/api/observer/tables", { token: admin });
    const row = list.data.tables.find((t: { tableId: string }) => t.tableId === tableId);
    expect(row.paused).toBe(true);

    // 重复暂停 → 409
    const again = await call("POST", `/api/tables/${tableId}/my/pause`, { token: owner, body: { reason: "x" } });
    expect(again.error?.code).toBe("already_paused");
  });

  it("暂停期闸门：回合消息/产物 409，讨论类与资料放行，seat-config 可改（动设定才重置就绪）", async () => {
    // 回合型消息被压（statements 阶段提案人本有发言权，暂停期一律 409 meeting_paused）
    const st = await call("POST", `/api/tables/${tableId}/messages`, {
      token: ownerSeatToken, body: { type: "STATEMENT", payload: { text: "陈述" } },
    });
    expect(st.status).toBe(409);
    expect(st.error?.code).toBe("meeting_paused");

    // 讨论类放行
    const q = await call("POST", `/api/tables/${tableId}/messages`, {
      token: rev1SeatToken, body: { type: "QUESTION", payload: { text: "暂停期可以提问吗" } },
    });
    expect(q.ok, JSON.stringify(q.error)).toBe(true);
    const hi = await call("POST", `/api/tables/${tableId}/human-input`, {
      token: rev1, body: { text: "给 agent 的补充信息", byHuman: "评审1" },
    });
    expect(hi.ok, JSON.stringify(hi.error)).toBe(true);

    // 产物发布被压
    const art = await call("POST", `/api/tables/${tableId}/artifacts`, {
      token: ownerSeatToken,
      body: { name: "a.md", format: "md", contentBase64: b64("x"), changeNote: "暂停期发布" },
    });
    expect(art.error?.code).toBe("meeting_paused");

    // 资料上传放行（给 agent 补充信息的通道）
    const doc = await call("POST", `/api/tables/${tableId}/documents`, {
      token: rev1SeatToken,
      body: { name: "背景.md", purpose: "暂停期补充资料", contentBase64: b64("背景资料") },
    });
    expect(doc.ok, JSON.stringify(doc.error)).toBe(true);

    // seat-config：暂停期可改；不带 ready 保存 → 未就绪
    const cfg1 = await call("POST", `/api/tables/${tableId}/my/seat-config`, {
      token: rev1, body: { stance: "评审方 暂停-评审1（已补充新立场）" },
    });
    expect(cfg1.ok, JSON.stringify(cfg1.error)).toBe(true);
    expect(cfg1.data.seat.config.ready).toBe(false);
    // 带 ready:true → 重新就绪
    const cfg2 = await call("POST", `/api/tables/${tableId}/my/seat-config`, {
      token: rev1, body: { stance: "评审方 暂停-评审1（已补充新立场）", ready: true },
    });
    expect(cfg2.data.seat.config.ready).toBe(true);
    // 不动的席位保持就绪（owner / rev2 未保存过）
    const info = await call("GET", `/api/tables/${tableId}`, { token: ownerSeatToken });
    const seatOf = (id: string) => info.data.seats.find((s: { seatId: string }) => s.seatId === id);
    expect(seatOf(ownerSeat).config.ready).toBe(true);
    expect(seatOf(rev2Seat).config.ready).toBe(true);
  });

  it("恢复：未全员就绪 409，全员就绪后建桌人继续，阶段与发言权原样恢复", async () => {
    // 先把 rev2 置为未就绪（暂停期保存不带 ready）
    await call("POST", `/api/tables/${tableId}/my/seat-config`, {
      token: rev2, body: { stance: "评审方 暂停-评审2（调整中）" },
    });
    const bad = await call("POST", `/api/tables/${tableId}/my/resume`, { token: owner });
    expect(bad.status).toBe(409);
    expect(bad.error?.code).toBe("not_ready");

    // 重新就绪后恢复
    await call("POST", `/api/tables/${tableId}/my/seat-config`, {
      token: rev2, body: { stance: "评审方 暂停-评审2（调整中）", ready: true },
    });
    const r = await call("POST", `/api/tables/${tableId}/my/resume`, { token: owner });
    expect(r.ok, JSON.stringify(r.error)).toBe(true);

    const info = await call("GET", `/api/tables/${tableId}`, { token: ownerSeatToken });
    expect(info.data.pause).toBeNull();
    expect(info.data.phase).toBe("statements");
    expect(info.data.activeTurn.seatId).toBe(ownerSeat); // 事件溯源重推导，发言权回到提案人
    const msgs = hub.store.getMessages(tableId).filter((m) => m.type === "MEETING_RESUMED");
    expect(msgs).toHaveLength(1);
    expect(hub.store.listAudit(500).some((a) => a.tableId === tableId && a.event === "table_resume")).toBe(true);

    // 未暂停时恢复 → 409
    const np = await call("POST", `/api/tables/${tableId}/my/resume`, { token: owner });
    expect(np.error?.code).toBe("not_paused");
  });

  it("申请-同意流：申请广播+审计记录申请方；同意后暂停；其余申请 superseded；暂停期再申请 409", async () => {
    const req1 = await call("POST", `/api/tables/${tableId}/my/pause-request`, { token: rev1, body: { reason: "我方需要补充成本数据" } });
    expect(req1.ok, JSON.stringify(req1.error)).toBe(true);
    const reqId1 = req1.data.requestId as string;
    expect(typeof reqId1).toBe("string");

    const req2 = await call("POST", `/api/tables/${tableId}/my/pause-request`, { token: rev2, body: { reason: "附议" } });
    expect(req2.ok).toBe(true);

    // 同席重复申请 → 409
    const dup = await call("POST", `/api/tables/${tableId}/my/pause-request`, { token: rev1, body: { reason: "再申请" } });
    expect(dup.error?.code).toBe("dup_pause_request");

    // 广播与审计（记录哪方申请）
    const prMsgs = hub.store.getMessages(tableId).filter((m) => m.type === "PAUSE_REQUESTED");
    expect(prMsgs).toHaveLength(2);
    expect((prMsgs[0].payload as { byName: string; reason: string }).byName).toBe("暂停-评审1");
    expect((prMsgs[0].payload as { byName: string; reason: string }).reason).toBe("我方需要补充成本数据");
    const audReq = hub.store.listAudit(500).filter((a) => a.tableId === tableId && a.event === "pause_request");
    expect(audReq).toHaveLength(2);
    const audRev1 = audReq.find((a) => (a.detail as { by: string }).by === "暂停-评审1")!;
    expect((audRev1.detail as { by: string; role: string }).role).toBe("reviewer");
    expect(String(audRev1.detail.requestId)).toBe(reqId1);

    // 观察端 pending 投影
    const det = await call("GET", `/api/observer/tables/${tableId}`, { token: owner });
    expect(det.data.pauseRequests).toHaveLength(2);

    // 建桌人同意第一条 → 暂停且留痕申请方；第二条变 superseded
    const ok1 = await call("POST", `/api/tables/${tableId}/my/pause-request/${reqId1}/approve`, { token: owner });
    expect(ok1.ok, JSON.stringify(ok1.error)).toBe(true);
    const info = await call("GET", `/api/tables/${tableId}`, { token: ownerSeatToken });
    expect(info.data.pause.via).toBe("request");
    expect(info.data.pause.requestedByName).toBe("暂停-评审1");
    expect(info.data.pause.requestedByRole).toBe("reviewer");
    const audPause = hub.store.listAudit(500).filter((a) => a.tableId === tableId && a.event === "table_pause");
    const viaReq = audPause.find((a) => (a.detail as { via: string }).via === "request");
    expect(viaReq).toBeTruthy();
    expect((viaReq!.detail as { requestedBy: { name: string } }).requestedBy.name).toBe("暂停-评审1");
    expect(hub.store.listAudit(500).some((a) => a.tableId === tableId && a.event === "pause_request_approved")).toBe(true);
    const reqId2 = req2.data.requestId as string;
    const again2 = await call("POST", `/api/tables/${tableId}/my/pause-request/${reqId2}/approve`, { token: owner });
    expect(again2.error?.code).toBe("no_pending_request");

    // 暂停期再申请 → 409
    const req3 = await call("POST", `/api/tables/${tableId}/my/pause-request`, { token: rev1, body: { reason: "x" } });
    expect(req3.error?.code).toBe("already_paused");
  });

  it("systemadmin：可同意申请、可强制继续（跳过就绪，记审计）", async () => {
    // 当前处于暂停（经申请）；rev1 调整设定变未就绪
    await call("POST", `/api/tables/${tableId}/my/seat-config`, { token: rev1, body: { stance: "评审方 暂停-评审1（再调整）" } });
    // admin 强制继续（跳过就绪）
    const force = await call("POST", `/api/admin/tables/${tableId}/resume`, { token: admin, body: { force: true } });
    expect(force.ok, JSON.stringify(force.error)).toBe(true);
    const audForce = hub.store.listAudit(500).filter((a) => a.tableId === tableId && a.event === "table_resume");
    expect((audForce[0].detail as { forced: boolean }).forced).toBe(true); // listAudit 倒序，最新在前

    // admin 同意申请：rev2 再申请 → admin approve → 暂停（byRole=systemadmin）
    const req = await call("POST", `/api/tables/${tableId}/my/pause-request`, { token: rev2, body: { reason: "admin 同意场景" } });
    expect(req.ok).toBe(true);
    const ap = await call("POST", `/api/admin/tables/${tableId}/pause-request/${req.data.requestId}/approve`, { token: admin });
    expect(ap.ok, JSON.stringify(ap.error)).toBe(true);
    const info = await call("GET", `/api/observer/tables/${tableId}`, { token: admin });
    expect(info.data.table.pause.byRole).toBe("systemadmin");
    expect(info.data.table.pause.requestedByName).toBe("暂停-评审2");

    // admin 直接暂停在已暂停桌 → 409；admin 恢复（全员就绪后）
    const dp = await call("POST", `/api/admin/tables/${tableId}/pause`, { token: admin, body: { reason: "x" } });
    expect(dp.error?.code).toBe("already_paused");
    await call("POST", `/api/tables/${tableId}/my/seat-config`, {
      token: rev1, body: { stance: "评审方 暂停-评审1（再调整）", ready: true },
    });
    const rs = await call("POST", `/api/admin/tables/${tableId}/resume`, { token: admin });
    expect(rs.ok).toBe(true);
    expect((await call("GET", `/api/observer/tables/${tableId}`, { token: admin })).data.table.pause).toBeNull();
  });

  it("hosted 桌：主持人（host）可暂停/继续，host 豁免就绪；observer 席可申请", async () => {
    const hostUser = await reg("暂停-主持人");
    const created = await call("POST", "/api/tables", {
      token: hostUser,
      body: { mode: "hosted", topic: "暂停-hosted桌", owner: { seatName: "主持人H", agentLabel: "human-only" } },
    });
    const hTable = created.data.tableId;
    const codes = created.data.inviteCodes as { code: string; role: string }[];
    const prop = await reg("暂停-提案");
    const pj = await call("POST", `/api/tables/${hTable}/seats`, {
      token: prop, body: { inviteCode: codes.find((c) => c.role === "proposer")!.code, seatName: "提案P", role: "proposer", agentLabel: "zcode" },
    });
    await call("POST", `/api/tables/${hTable}/seat-config`, { token: pj.data.token, body: { stance: "提案方", ready: true } });
    const revU = await reg("暂停-hosted评审");
    const rj = await call("POST", `/api/tables/${hTable}/seats`, {
      token: revU, body: { inviteCode: codes.find((c) => c.role === "reviewer")!.code, seatName: "评审R", role: "reviewer", agentLabel: "claude" },
    });
    await call("POST", `/api/tables/${hTable}/seat-config`, { token: rj.data.token, body: { stance: "评审方", ready: true } });
    const obsU = await reg("暂停-hosted观察");
    const oj = await call("POST", `/api/tables/${hTable}/seats`, {
      token: obsU, body: { inviteCode: codes.find((c) => c.role === "observer")!.code, seatName: "观察O", role: "observer", agentLabel: "claude" },
    });
    await call("POST", `/api/tables/${hTable}/seat-config`, { token: oj.data.token, body: { stance: "观察方", ready: true } });
    // 主持人点开始（my/start）
    const st = await call("POST", `/api/tables/${hTable}/my/start`, { token: hostUser });
    expect(st.ok, JSON.stringify(st.error)).toBe(true);

    // observer 申请 → host 同意
    const req = await call("POST", `/api/tables/${hTable}/my/pause-request`, { token: obsU, body: { reason: "观察方发现问题" } });
    expect(req.ok, JSON.stringify(req.error)).toBe(true);
    const ap = await call("POST", `/api/tables/${hTable}/my/pause-request/${req.data.requestId}/approve`, { token: hostUser });
    expect(ap.ok, JSON.stringify(ap.error)).toBe(true);
    const info = await call("GET", `/api/observer/tables/${hTable}`, { token: hostUser });
    expect(info.data.table.pause).toBeTruthy();
    expect(info.data.table.pause.byRole).toBe("host");
    expect(info.data.table.pause.requestedByName).toBe("观察O");
    expect(info.data.table.pause.requestedByRole).toBe("observer");

    // 暂停期席位动设定 → 未就绪；host 恢复需全员就绪（observer 也算）
    await call("POST", `/api/tables/${hTable}/my/seat-config`, { token: obsU, body: { stance: "观察方（补充）" } });
    const bad = await call("POST", `/api/tables/${hTable}/my/resume`, { token: hostUser });
    expect(bad.error?.code).toBe("not_ready");
    await call("POST", `/api/tables/${hTable}/my/seat-config`, { token: obsU, body: { stance: "观察方（补充）", ready: true } });
    const rs = await call("POST", `/api/tables/${hTable}/my/resume`, { token: hostUser });
    expect(rs.ok).toBe(true);
  });

  it("closed 桌不可暂停", async () => {
    const u = await reg("暂停-closed用户");
    const created = await call("POST", "/api/tables", {
      token: u, body: { topic: "暂停-closed桌", owner: { seatName: "c-owner", agentLabel: "zcode" } },
    });
    await call("POST", "/api/admin/tables/" + created.data.tableId + "/close", { token: admin, body: { reason: "测试闭桌" } });
    const bad = await call("POST", `/api/tables/${created.data.tableId}/my/pause`, { token: u, body: { reason: "x" } });
    expect(bad.error?.code).toBe("table_closed");
  });
});
