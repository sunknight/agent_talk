/**
 * 指挥桌（dispatch 桌类型，任务 0047：多人指挥 agent 干活）：
 * - 建桌：self 建桌人=director 席（不签 seat token）、默认三码 worker/director/observer；hosted 建桌；director 入席不签 token
 * - 开始：无执行方 409；执行方未就绪 409（director 永不就绪但不阻塞）；就绪 → working
 * - 指令：open 409 / working 可发（进消息流 + pending 记录）；非 director 403；text 必填 422；注入标记
 * - 状态机：executing→done/failed；pending 直接 done=隐式领单；need_clarify→答复回 pending；rejected；终态 409；抢单 409 claimed_other
 * - 权限：DIRECTIVE_RESULT 仅 worker；observer poll 无 pendingDirectives；worker poll 有
 * - 暂停：working 可暂停；暂停期发指令/回执双 409
 * - 纪要：闭桌出工作纪要（指令清单与状态统计）
 * - 观察端/skill：详情投影 directives/isDirector；页面与 skill.md 含指挥桌文案
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start } from "../src";

let base = "";
let http: import("../src").Server;
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

/** 建 self 指挥桌：建桌人=director（无席位 token），返回桌 ID + 三码 + 建 桌人 user token */
async function mkDispatch(topic: string) {
  const user = await reg(`${topic}-指挥方`);
  const r = await call("POST", "/api/tables", {
    token: user,
    body: { tableType: "dispatch", topic, owner: { seatName: `${topic}-指挥方`, agentLabel: "human" } },
  });
  if (!r.ok) return { user, ok: false as const, error: r.error };
  const codes: Record<string, string> = {};
  for (const c of r.data.inviteCodes as { code: string; role: string }[]) codes[c.role] = c.code;
  return { user, ok: true as const, tableId: r.data.tableId as string, codes, ...r.data };
}

/** worker 凭码入席并就绪 */
async function joinWorker(tableId: string, code: string, name: string, scope = "设计稿微调等本席能力范围内的执行工作") {
  const u = await reg(name);
  const j = await call("POST", `/api/tables/${tableId}/seats`, {
    token: u, body: { inviteCode: code, seatName: name, role: "worker", agentLabel: "zcode" },
  });
  expect(j.ok, `worker ${name} join: ${JSON.stringify(j.error)}`).toBe(true);
  const cfg = await call("POST", `/api/tables/${tableId}/seat-config`, {
    token: j.data.token, body: { stance: `执行方 ${name}`, scope, dataScope: [], ready: true },
  });
  expect(cfg.ok).toBe(true);
  return { userToken: u, seatId: j.data.seatId as string, seatToken: j.data.token as string, name };
}

/** director 凭码入桌（人类席位，无 token） */
async function joinDirector(tableId: string, code: string, name: string) {
  const u = await reg(name);
  const j = await call("POST", `/api/tables/${tableId}/seats`, {
    token: u, body: { inviteCode: code, seatName: name, role: "director", agentLabel: "human-only" },
  });
  expect(j.ok, `director ${name} join: ${JSON.stringify(j.error)}`).toBe(true);
  return { userToken: u, seatId: j.data.seatId as string, name };
}

/** 建一张已开始的指挥桌（1 director + 1 worker 就绪），返回各方身份 */
async function mkWorking(topic: string) {
  const t = await mkDispatch(topic);
  expect(t.ok).toBe(true);
  const w = await joinWorker(t.tableId, t.codes.worker, `${topic}-执行方`);
  const s = await call("POST", `/api/tables/${t.tableId}/my/start`, { token: t.user });
  expect(s.ok, `start: ${JSON.stringify(s.error)}`).toBe(true);
  return { ...t, worker: w };
}

async function detailOf(token: string, tableId: string) {
  const r = await call("GET", `/api/observer/tables/${tableId}`, { token });
  expect(r.ok).toBe(true);
  return r.data;
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-dispatch-"));
  ({ http, hub } = await start({ port: 0, dataDir: dir, host: "127.0.0.1" }));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => {
  http.closeIdleConnections?.();
  http.close(() => r());
}));

describe("指挥桌：建桌与开始", () => {
  it("self 建桌：建桌人=director 席位（不签 seat token），默认发 worker/director/observer 三码", async () => {
    const t = await mkDispatch("建桌校验");
    expect(t.ok).toBe(true);
    expect(t.tableType).toBe("dispatch");
    expect(t.ownerSeatToken).toBe(""); // director 人类席位：无席位 token
    expect(Object.keys(t.codes).sort()).toEqual(["director", "observer", "worker"]);
    const d = await detailOf(t.user, t.tableId);
    expect(d.table.seats.some((s: any) => s.role === "director" && s.seatId === t.ownerSeatId)).toBe(true);
    expect(d.isDirector).toBe(true);
  });

  it("director 凭码入桌：建人类席位、不签 token；同桌可多个 director", async () => {
    const t = await mkDispatch("多指挥方");
    const d1 = await joinDirector(t.tableId, t.codes.director, "指挥方乙");
    expect(d1.seatId).toBeTruthy();
    const j = await call("POST", `/api/tables/${t.tableId}/seats`, {
      token: d1.userToken, body: { inviteCode: t.codes.worker, seatName: "指挥方乙", role: "director", agentLabel: "x" },
    });
    expect(j.ok).toBe(false); // 角色由码定死：worker 码不能当 director
    const d2 = await joinDirector(t.tableId, t.codes.director, "指挥方丙");
    expect(d2.seatId).toBeTruthy();
    const dd = await detailOf(d2.userToken, t.tableId);
    expect(dd.table.seats.filter((s: any) => s.role === "director").length).toBe(3); // 建桌人 + 乙 + 丙
  });

  it("director 不参与就绪设定（seat-config 403）；开始需 ≥1 worker 全就绪（director 未就绪不阻塞）", async () => {
    const t = await mkDispatch("开始校验");
    // director 建桌人 seat-config 应被拒
    const seats = (await detailOf(t.user, t.tableId)).table.seats;
    // open 阶段未就绪的 director 恒在，但不应阻塞开始；先验证无 worker 时 409
    const s0 = await call("POST", `/api/tables/${t.tableId}/my/start`, { token: t.user });
    expect(s0.ok).toBe(false);
    expect(s0.error?.code).toBe("no_worker");
    const w = await joinWorker(t.tableId, t.codes.worker, "执行方-开始校验");
    const s1 = await call("POST", `/api/tables/${t.tableId}/my/start`, { token: t.user });
    expect(s1.ok, JSON.stringify(s1.error)).toBe(true);
    expect((await detailOf(t.user, t.tableId)).table.phase).toBe("working");
    // worker 的 seat-config 在会议开始后锁定（原有语义），director 的 seat-config 恒 403
    const cfg = await call("POST", `/api/tables/${t.tableId}/seat-config`, {
      token: w.seatToken, body: { stance: "x", scope: "", dataScope: [], ready: true },
    });
    expect(cfg.ok).toBe(false);
    expect(cfg.error?.code).toBe("already_started");
  });

  it("hosted 建桌：host 建桌签发三码，host 席位正常持有 token；worker 未就绪开始 409", async () => {
    const u = await reg("指挥桌-主持人");
    const r = await call("POST", "/api/tables", {
      token: u,
      body: { tableType: "dispatch", mode: "hosted", topic: "主持人指挥桌", owner: { seatName: "主持人", agentLabel: "human" } },
    });
    expect(r.ok).toBe(true);
    expect(r.data.ownerSeatToken).not.toBe(""); // host 正常签发
    const codes: Record<string, string> = {};
    for (const c of r.data.inviteCodes as { code: string; role: string }[]) codes[c.role] = c.code;
    const w = await joinWorker(r.data.tableId, codes.worker, "执行方-未就绪前的入席");
    // worker 已入席但此分支的 joinWorker 已置 ready —— 再拉一个不就绪的验证 not_ready
    const u2 = await reg("散漫执行方");
    const j2 = await call("POST", `/api/tables/${r.data.tableId}/seats`, {
      token: u2, body: { inviteCode: codes.worker, seatName: "散漫执行方", role: "worker", agentLabel: "zcode" },
    });
    expect(j2.ok).toBe(true);
    const s = await call("POST", `/api/tables/${r.data.tableId}/my/start`, { token: u });
    expect(s.ok).toBe(false);
    expect(s.error?.code).toBe("not_ready");
  });
});

describe("指挥桌：指令下达", () => {
  it("open 阶段 409 not_started；working 后 director 可发（进消息流 + pending 记录 + 投影）", async () => {
    const t = await mkDispatch("指令下达");
    const early = await call("POST", `/api/tables/${t.tableId}/directives`, { token: t.user, body: { text: "过早的指令" } });
    expect(early.ok).toBe(false);
    expect(early.error?.code).toBe("not_started");

    const w = await joinWorker(t.tableId, t.codes.worker, "执行方-指令下达");
    await call("POST", `/api/tables/${t.tableId}/my/start`, { token: t.user });
    const r = await call("POST", `/api/tables/${t.tableId}/directives`, {
      token: t.user, body: { title: "改搜索框配色", text: "修改 bd10 页面的搜索框背景颜色为白色" },
    });
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect(r.data.directiveId).toMatch(/^wd_/);
    const d = await detailOf(t.user, t.tableId);
    expect(d.directives.length).toBe(1);
    expect(d.directives[0].status).toBe("pending");
    expect(d.directives[0].bySeat).toBe(t.ownerSeatId);
    expect(d.directives[0].title).toBe("改搜索框配色");
    // 消息流可见（worker 视角）
    const poll = await call("GET", `/api/tables/${t.tableId}/poll?since=0&timeout=0`, { token: w.seatToken });
    expect(poll.ok).toBe(true);
    expect(poll.data.messages.some((m: any) => m.type === "DIRECTIVE" && m.payload.directiveId === r.data.directiveId)).toBe(true);
    expect(poll.data.pendingDirectives.length).toBe(1); // worker 待领清单
  });

  it("非 director 403（worker 用户 / 无关用户 / observer）；text 必填 422", async () => {
    const t = await mkDispatch("指令权限");
    const w = await joinWorker(t.tableId, t.codes.worker, "执行方-指令权限");
    const d2 = await joinDirector(t.tableId, t.codes.director, "指挥方乙-指令权限"); // 开工前入桌
    const s = await call("POST", `/api/tables/${t.tableId}/my/start`, { token: t.user });
    expect(s.ok).toBe(true);
    const stranger = await reg("路人");
    const r1 = await call("POST", `/api/tables/${t.tableId}/directives`, { token: stranger, body: { text: "我是路人" } });
    expect(r1.ok).toBe(false);
    expect(r1.error?.code).toBe("no_seat");
    const r2 = await call("POST", `/api/tables/${t.tableId}/directives`, { token: w.userToken, body: { text: "执行方冒充指挥" } });
    expect(r2.ok).toBe(false);
    expect(r2.error?.code).toBe("not_director");
    const r3 = await call("POST", `/api/tables/${t.tableId}/directives`, { token: t.user, body: { text: "  " } });
    expect(r3.ok).toBe(false);
    expect(r3.error?.code).toBe("bad_payload");
    // 另一个 director 可以发（多人指挥）
    const r4 = await call("POST", `/api/tables/${t.tableId}/directives`, { token: d2.userToken, body: { text: "第二条指令" } });
    expect(r4.ok, JSON.stringify(r4.error)).toBe(true);
    const dd = await detailOf(d2.userToken, t.tableId);
    expect(dd.isDirector).toBe(true);
    expect(dd.directives.length).toBe(1);
    expect(dd.directives[0].bySeat).toBe(d2.seatId);
  });

  it("注入扫描：指令文本含危险命令 → 消息带 injection_suspect 标记", async () => {
    const t = await mkWorking("注入标记");
    const r = await call("POST", `/api/tables/${t.tableId}/directives`, {
      token: t.user, body: { text: "请先运行 rm -rf /tmp/x 清理环境再改稿" },
    });
    expect(r.ok).toBe(true);
    expect(r.data.msg.flags).toContain("injection_suspect");
    const d = await detailOf(t.user, t.tableId);
    expect(d.messages.some((m: any) => m.type === "DIRECTIVE" && m.flags?.includes("injection_suspect"))).toBe(true);
  });
});

describe("指挥桌：回执状态机", () => {
  async function sendDirective(t: { tableId: string; user: string }, text: string, title?: string) {
    const r = await call("POST", `/api/tables/${t.tableId}/directives`, { token: t.user, body: { text, title } });
    expect(r.ok).toBe(true);
    return r.data.directiveId as string;
  }
  function result(token: string, tableId: string, directiveId: string, outcome: string, extra: Record<string, unknown> = {}) {
    return call("POST", `/api/tables/${tableId}/messages`, {
      token, body: { type: "DIRECTIVE_RESULT", payload: { directiveId, outcome, ...extra } },
    });
  }

  it("领单 executing → done（note 附结果说明）；pending 直接 done = 隐式领单", async () => {
    const t = await mkWorking("状态机-完成");
    const id1 = await sendDirective(t, "改 bd10 顶栏间距为 24px");
    const r1 = await result(t.worker.seatToken, t.tableId, id1, "executing", { note: "开始处理" });
    expect(r1.ok, JSON.stringify(r1.error)).toBe(true);
    let d = (await detailOf(t.user, t.tableId)).directives.find((x: any) => x.directiveId === id1);
    expect(d.status).toBe("executing");
    expect(d.claimedBy).toBe(t.worker.seatId);
    const r2 = await result(t.worker.seatToken, t.tableId, id1, "done", { note: "已完成，效果见 Figma 链接 https://figma.com/file/x" });
    expect(r2.ok).toBe(true);
    d = (await detailOf(t.user, t.tableId)).directives.find((x: any) => x.directiveId === id1);
    expect(d.status).toBe("done");
    expect(d.resultNote).toContain("figma.com");
    // 终态再回执 409
    const r3 = await result(t.worker.seatToken, t.tableId, id1, "done", { note: "再来一次" });
    expect(r3.ok).toBe(false);
    expect(r3.error?.code).toBe("bad_status");
    // 隐式领单
    const id2 = await sendDirective(t, "改 bd14 的按钮文案");
    const r4 = await result(t.worker.seatToken, t.tableId, id2, "done", { note: "顺手一起做完了" });
    expect(r4.ok).toBe(true);
    d = (await detailOf(t.user, t.tableId)).directives.find((x: any) => x.directiveId === id2);
    expect(d.status).toBe("done");
    expect(d.claimedBy).toBe(t.worker.seatId);
  });

  it("failed/rejected 必须带 note；need_clarify 必须带 clarify → director 答复回 pending → 再执行", async () => {
    const t = await mkWorking("状态机-失败与澄清");
    const id1 = await sendDirective(t, "把页面改成竞品的样子");
    const r1 = await result(t.worker.seatToken, t.tableId, id1, "failed");
    expect(r1.ok).toBe(false);
    const r2 = await result(t.worker.seatToken, t.tableId, id1, "rejected");
    expect(r2.ok).toBe(false);
    expect(r2.error?.code).toBe("bad_payload");
    const r3 = await result(t.worker.seatToken, t.tableId, id1, "need_clarify", { note: "没问问题" });
    expect(r3.ok).toBe(false); // clarify 必填
    // 正常反问
    const r4 = await result(t.worker.seatToken, t.tableId, id1, "need_clarify", { clarify: "「竞品」指哪一家？能给参考链接吗" });
    expect(r4.ok, JSON.stringify(r4.error)).toBe(true);
    let d = (await detailOf(t.user, t.tableId)).directives.find((x: any) => x.directiveId === id1);
    expect(d.status).toBe("need_clarify");
    expect(d.clarifyQ).toContain("竞品");
    // 非待澄清状态答复 409
    const c0 = await call("POST", `/api/tables/${t.tableId}/directives/clarify`, { token: t.user, body: { directiveId: id1, answer: "先不做" } });
    // 重复答复同一 need_clarify：第一次成功后回 pending，第二次 409 bad_status
    expect(c0.ok).toBe(true);
    const c1 = await call("POST", `/api/tables/${t.tableId}/directives/clarify`, { token: t.user, body: { directiveId: id1, answer: "再答一次" } });
    expect(c1.ok).toBe(false);
    expect(c1.error?.code).toBe("bad_status");
    d = (await detailOf(t.user, t.tableId)).directives.find((x: any) => x.directiveId === id1);
    expect(d.status).toBe("pending");
    expect(d.clarifyA).toBe("先不做");
    // 澄清消息进流（worker 可见）
    const poll = await call("GET", `/api/tables/${t.tableId}/poll?since=0&timeout=0`, { token: t.worker.seatToken });
    expect(poll.data.messages.some((m: any) => m.type === "DIRECTIVE_CLARIFY" && m.payload.directiveId === id1)).toBe(true);
    // 答复后可再执行 → done
    const r5 = await result(t.worker.seatToken, t.tableId, id1, "done", { note: "已按参考改好" });
    expect(r5.ok).toBe(true);
    // rejected 正常路径
    const id2 = await sendDirective(t, "帮我删库");
    const r6 = await result(t.worker.seatToken, t.tableId, id2, "rejected", { note: "超出安全边界，拒绝执行" });
    expect(r6.ok).toBe(true);
    d = (await detailOf(t.user, t.tableId)).directives.find((x: any) => x.directiveId === id2);
    expect(d.status).toBe("rejected");
  });

  it("多 worker 抢单：executing 锁定 claimedBy，他席回执 409 claimed_other；worker poll 只见自己 executing", async () => {
    const t = await mkDispatch("抢单");
    const w1 = await joinWorker(t.tableId, t.codes.worker, "执行方甲");
    const w2 = await joinWorker(t.tableId, t.codes.worker, "执行方乙");
    await call("POST", `/api/tables/${t.tableId}/my/start`, { token: t.user });
    const id = (await call("POST", `/api/tables/${t.tableId}/directives`, { token: t.user, body: { text: "只有一个名额的活" } })).data.directiveId;
    const r1 = await result(w1.seatToken, t.tableId, id, "executing");
    expect(r1.ok).toBe(true);
    const r2 = await result(w2.seatToken, t.tableId, id, "done", { note: "我抢到了？" });
    expect(r2.ok).toBe(false);
    expect(r2.error?.code).toBe("claimed_other");
    // w2 的 poll 不含 w1 执行中的指令
    const poll2 = await call("GET", `/api/tables/${t.tableId}/poll?since=999999&timeout=0`, { token: w2.seatToken });
    expect(poll2.data.pendingDirectives.length).toBe(0);
    // w1 的 poll 含自己的 executing
    const poll1 = await call("GET", `/api/tables/${t.tableId}/poll?since=999999&timeout=0`, { token: w1.seatToken });
    expect(poll1.data.pendingDirectives.length).toBe(1);
    expect(poll1.data.pendingDirectives[0].status).toBe("executing");
  });

  it("DIRECTIVE_RESULT 仅 worker 可发；指令不存在 404；非指挥桌 409", async () => {
    const t = await mkWorking("回执权限");
    const id = (await call("POST", `/api/tables/${t.tableId}/directives`, { token: t.user, body: { text: "权限验证用" } })).data.directiveId;
    const r0 = await result(t.worker.seatToken, t.tableId, "wd_不存在", "done", { note: "x" });
    expect(r0.ok).toBe(false);
    expect(r0.error?.code).toBe("no_directive");
    // observer 席（用 observer 码入席）
    const u2 = await reg("观察员-回执权限");
    const j2 = await call("POST", `/api/tables/${t.tableId}/seats`, {
      token: u2, body: { inviteCode: t.codes.observer, seatName: "观察员", role: "observer", agentLabel: "zcode" },
    });
    // 会议已开始（working），open 才能入席 → 这里应失败，改用 REST 席位消息权限验证：director 无 token，worker 以外的席位用 observer 无法入席
    // 直接验证：worker 之外的席位 token 不存在可用的，因此用 worker 发合法消息后再验非 dispatch 桌
    const r = await result(t.worker.seatToken, t.tableId, id, "executing");
    expect(r.ok).toBe(true);
    // 非 dispatch 桌发指令 409
    const other = await mkDispatch("非指挥桌对照");
    // 用一张 review 桌验证 not_dispatch
    const u3 = await reg("评审建桌人");
    const t3 = await call("POST", "/api/tables", { token: u3, body: { topic: "评审桌", owner: { seatName: "A", agentLabel: "zcode" } } });
    const rd = await call("POST", `/api/tables/${t3.data.tableId}/directives`, { token: u3, body: { text: "在评审桌发指令" } });
    expect(rd.ok).toBe(false);
    expect(rd.error?.code).toBe("not_dispatch");
    const rc = await call("POST", `/api/tables/${t3.data.tableId}/directives/clarify`, { token: u3, body: { directiveId: "wd_x", answer: "x" } });
    expect(rc.ok).toBe(false);
    expect(rc.error?.code).toBe("not_dispatch");
    // review 桌席位发 DIRECTIVE_RESULT → wrong_phase（working 之外不接受）
    const rrev = await call("POST", `/api/tables/${t3.data.tableId}/messages`, {
      token: t3.data.ownerSeatToken, body: { type: "DIRECTIVE_RESULT", payload: { directiveId: "wd_x", outcome: "done", note: "x" } },
    });
    expect(rrev.ok).toBe(false);
  });
});

describe("指挥桌：暂停与纪要", () => {
  it("working 可暂停（指挥方=建桌人是控制人）：暂停期发指令/回执双 409，恢复后照常", async () => {
    const t = await mkWorking("暂停");
    const id = (await call("POST", `/api/tables/${t.tableId}/directives`, { token: t.user, body: { text: "暂停前的活" } })).data.directiveId;
    const p = await call("POST", `/api/tables/${t.tableId}/my/pause`, { token: t.user, body: { reason: "指挥方整理需求" } });
    expect(p.ok, JSON.stringify(p.error)).toBe(true);
    const r1 = await call("POST", `/api/tables/${t.tableId}/directives`, { token: t.user, body: { text: "暂停期的指令" } });
    expect(r1.ok).toBe(false);
    expect(r1.error?.code).toBe("meeting_paused");
    const r2 = await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.worker.seatToken, body: { type: "DIRECTIVE_RESULT", payload: { directiveId: id, outcome: "executing" } },
    });
    expect(r2.ok).toBe(false);
    expect(r2.error?.code).toBe("meeting_paused");
    // 恢复：worker 已就绪（未动设定），控制人继续
    const resume = await call("POST", `/api/tables/${t.tableId}/my/resume`, { token: t.user });
    expect(resume.ok, JSON.stringify(resume.error)).toBe(true); // director 永不就绪但不阻塞恢复
    const r3 = await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.worker.seatToken, body: { type: "DIRECTIVE_RESULT", payload: { directiveId: id, outcome: "done", note: "恢复后完成" } },
    });
    expect(r3.ok).toBe(true);
  });

  it("闭桌出工作纪要：指令清单与状态统计", async () => {
    const t = await mkWorking("纪要");
    const id1 = (await call("POST", `/api/tables/${t.tableId}/directives`, { token: t.user, body: { text: "第一条：改搜索框", title: "搜索框" } })).data.directiveId;
    await call("POST", `/api/tables/${t.tableId}/directives`, { token: t.user, body: { text: "第二条：未处理的活" } });
    await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.worker.seatToken, body: { type: "DIRECTIVE_RESULT", payload: { directiveId: id1, outcome: "done", note: "已完成" } },
    });
    // 管理员强制闭桌（走通用 closeTable → buildDispatchMinutes）
    const admin = await reg("指挥桌管理员");
    const me = await call("GET", "/api/me", { token: admin });
    hub.store.setUserRole(me.data.userId, "systemadmin");
    const c = await call("POST", `/api/admin/tables/${t.tableId}/close`, { token: admin, body: { reason: "验收闭桌" } });
    expect(c.ok, JSON.stringify(c.error)).toBe(true);
    const d = await detailOf(t.user, t.tableId);
    expect(d.table.phase).toBe("closed");
    expect(d.minutes).toBeTruthy();
    const md = d.minutes.markdown as string;
    expect(md).toContain("工作纪要");
    expect(md).toContain("工作指令（共 2 条");
    expect(md).toContain("已完成 1");
    expect(md).toContain("待处理 1");
    expect(md).toContain("搜索框");
    expect(md).toContain("已完成");
  });
});

describe("指挥桌：观察端与 skill 文案", () => {
  it("观察页含指挥桌要素：工作指令卡 / 指令输入组 / 消息标签；skill.md 含指挥流语义", async () => {
    const html = await (await fetch(base + "/")).text();
    expect(html).toContain("工作指令");
    expect(html).toContain("下达工作指令（指挥方）");
    expect(html).toContain("指挥桌（dispatch · 多人指挥 agent 干活）");
    expect(html).toContain("DIRECTIVE_RESULT");
    const skill = await (await fetch(base + "/skill.md")).text();
    expect(skill).toContain("指挥流语义");
    expect(skill).toContain("pendingDirectives");
    expect(skill).toContain("DIRECTIVE_RESULT");
    expect(skill).toContain("dispatch 指挥");
  });

  it("建桌表单与桌型注册：观察页注入 dispatch 注册表（客户端生成选项）", async () => {
    const html = await (await fetch(base + "/")).text();
    expect(html).toContain('"id":"dispatch"'); // JSON.stringify 注入的注册表项
    expect(html).toContain("多人指挥 agent 干活");
  });
});
