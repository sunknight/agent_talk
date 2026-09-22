/**
 * 桌类型与协同模式验收：
 * - 类型注册表 / 建桌选类型 + 按类型选邀请角色（校验与默认值）
 * - 协作桌全流程（各自初稿 → 互审补缺 → 意见归属方认领 → 补齐执行 → 定稿表决 → 纪要）
 * - 角色硬校验（协作桌 collaborator；observer 不可回合发言）/ 开始前置（≥2 协作者）
 * - 头脑风暴 / 方案决策变体映射；hosted 主持人建协作桌
 * - 评审桌默认行为不变（回归锚点）
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

/** 建协作桌：owner（自动 collaborator）+ 1~N 位协作者 + 1 位观察者，全部就绪并点开始 */
async function quickCollab(topic: string, collaboratorNames: string[], withObserver = true) {
  const ownerUser = await newUser(`${topic}-owner`);
  const created = await call("POST", "/api/tables", {
    token: ownerUser,
    body: {
      tableType: "collab",
      topic, goals: "共同完成交付", deliverables: "完整文档", rules: "互审补缺、认领必达",
      owner: { seatName: `${topic}-owner`, agentLabel: "zcode" },
    },
  });
  expect(created.ok, `create collab: ${JSON.stringify(created.error)}`).toBe(true);
  const { tableId, ownerSeatToken, ownerSeatId, inviteCodes, tableType } = created.data;
  expect(tableType).toBe("collab");
  await call("POST", `/api/tables/${tableId}/seat-config`, {
    token: ownerSeatToken,
    body: { stancePreset: "coauthor-lead", stance: "分工协作者", ready: true },
  });
  const collabCode = inviteCodes.find((c: { role: string }) => c.role === "collaborator").code;
  const collaborators: { seatId: string; token: string; name: string }[] = [];
  for (const name of collaboratorNames) {
    const u = await newUser(name);
    const j = await call("POST", `/api/tables/${tableId}/seats`, {
      token: u, body: { inviteCode: collabCode, seatName: name, role: "collaborator", agentLabel: "claude" },
    });
    expect(j.ok, `collaborator ${name} join: ${JSON.stringify(j.error)}`).toBe(true);
    await call("POST", `/api/tables/${tableId}/seat-config`, {
      token: j.data.token,
      body: { stancePreset: "gap-supporter", stance: `协作者 ${name}`, ready: true },
    });
    collaborators.push({ seatId: j.data.seatId, token: j.data.token, name });
  }
  let observer: { seatId: string; token: string } | null = null;
  if (withObserver) {
    const obsCode = inviteCodes.find((c: { role: string }) => c.role === "observer").code;
    const u = await newUser(`${topic}-observer`);
    const j = await call("POST", `/api/tables/${tableId}/seats`, {
      token: u, body: { inviteCode: obsCode, seatName: `${topic}-观察者`, role: "observer", agentLabel: "codex" },
    });
    expect(j.ok).toBe(true);
    await call("POST", `/api/tables/${tableId}/seat-config`, {
      token: j.data.token,
      body: { stance: "旁听", ready: true },
    });
    observer = { seatId: j.data.seatId, token: j.data.token };
  }
  const s = await call("POST", `/api/tables/${tableId}/start`, { token: ownerSeatToken });
  expect(s.ok, `start: ${JSON.stringify(s.error)}`).toBe(true);
  return { tableId, owner: { seatId: ownerSeatId, token: ownerSeatToken, userToken: ownerUser }, collaborators, observer };
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-collab-"));
  ({ http, hub } = await start({ port: 0, dataDir: dir, host: "127.0.0.1" }));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => {
  http.closeIdleConnections?.();
  http.close(() => r());
}));

describe("桌类型注册与建桌校验", () => {
  it("GET /api/table-types 返回 4 类注册表", async () => {
    const r = await call("GET", "/api/table-types");
    expect(r.ok).toBe(true);
    const ids = r.data.tableTypes.map((t: { id: string }) => t.id);
    expect(ids).toEqual(["review", "collab", "brainstorm", "decision"]);
    const collab = r.data.tableTypes.find((t: { id: string }) => t.id === "collab");
    expect(collab.roles).toEqual(["collaborator", "observer"]);
    expect(collab.flow).toBe("collab");
  });

  it("协作桌：owner 自动成为 collaborator，默认发 collaborator+observer 两码（self 模式协作者可多席）", async () => {
    const u = await newUser("T-collab-default");
    const r = await call("POST", "/api/tables", {
      token: u,
      body: { tableType: "collab", topic: "默认角色", owner: { seatName: "A", agentLabel: "zcode" } },
    });
    expect(r.ok).toBe(true);
    const roles = (r.data.inviteCodes as { role: string }[]).map((c) => c.role).sort();
    expect(roles).toEqual(["collaborator", "observer"]);
    const info = await call("GET", `/api/tables/${r.data.tableId}`, { token: r.data.ownerSeatToken });
    expect(info.data.tableType).toBe("collab");
    expect(info.data.seats[0].role).toBe("collaborator");
    expect(info.data.seats[0].caps.canVote).toBe(true);
    expect(info.data.seats[0].caps.canPublish).toBe(true);
  });

  it("inviteRoles 按类型勾选：只开 observer 码；类型外角色 422", async () => {
    const u = await newUser("T-invite-roles");
    const only = await call("POST", "/api/tables", {
      token: u,
      body: { tableType: "collab", inviteRoles: ["observer"], topic: "只开观察", owner: { seatName: "A", agentLabel: "zcode" } },
    });
    expect(only.ok).toBe(true);
    expect(only.data.inviteCodes).toHaveLength(1);
    expect(only.data.inviteCodes[0].role).toBe("observer");

    const bad = await call("POST", "/api/tables", {
      token: u,
      body: { tableType: "collab", inviteRoles: ["reviewer"], topic: "非法角色", owner: { seatName: "A", agentLabel: "zcode" } },
    });
    expect(bad.status).toBe(422);
    expect(bad.error?.code).toBe("bad_invite_role");

    const badType = await call("POST", "/api/tables", {
      token: u,
      body: { tableType: "duel", topic: "非法类型", owner: { seatName: "A", agentLabel: "zcode" } },
    });
    expect(badType.status).toBe(422);
    expect(badType.error?.code).toBe("bad_table_type");
  });

  it("评审桌默认不变：owner=proposer，reviewer+observer 码（回归锚点）", async () => {
    const u = await newUser("T-review-default");
    const r = await call("POST", "/api/tables", {
      token: u,
      body: { topic: "默认评审", owner: { seatName: "A", agentLabel: "zcode" } },
    });
    expect(r.data.tableType ?? "review").toBe("review");
    const roles = (r.data.inviteCodes as { role: string }[]).map((c) => c.role).sort();
    expect(roles).toEqual(["observer", "reviewer"]);
    const info = await call("GET", `/api/tables/${r.data.tableId}`, { token: r.data.ownerSeatToken });
    expect(info.data.seats[0].role).toBe("proposer");
  });

  it("立场预设带 forTypes：协作预设只在 collab 桌出现", async () => {
    const r = await call("GET", "/api/stances");
    const coauthor = r.data.stances.find((s: { id: string }) => s.id === "coauthor-lead");
    expect(coauthor.forTypes).toEqual(["collab"]);
    expect(coauthor.forRole).toBe("collaborator");
    const reqOwner = r.data.stances.find((s: { id: string }) => s.id === "req-owner");
    expect(reqOwner.forTypes).toBeUndefined();
  });
});

describe("协作桌全流程（协同模式验收）", () => {
  let tableId = "";
  let alice = { seatId: "", token: "" }; // 建桌人 = 协作者
  let bob = { seatId: "", token: "" }; // 协作者
  let obs = { seatId: "", token: "" }; // 观察者
  let artA = "", artB = "";

  it("开始前置：仅 1 位协作者不可开始（no_collaborators）", async () => {
    const u = await newUser("solo");
    const r = await call("POST", "/api/tables", {
      token: u,
      body: { tableType: "collab", topic: "单人协作", owner: { seatName: "solo", agentLabel: "zcode" } },
    });
    await call("POST", `/api/tables/${r.data.tableId}/seat-config`, {
      token: r.data.ownerSeatToken, body: { stance: "就绪", ready: true },
    });
    const s = await call("POST", `/api/tables/${r.data.tableId}/start`, { token: r.data.ownerSeatToken });
    expect(s.status).toBe(409);
    expect(s.error?.code).toBe("no_collaborators");
  });

  it("建桌入席开始：statements 发言权先给建桌协作者；observer 陈述被角色拒绝", async () => {
    const t = await quickCollab("产品白皮书协作撰写", ["Bob"]);
    tableId = t.tableId;
    alice = { seatId: t.owner.seatId, token: t.owner.token };
    bob = { seatId: t.collaborators[0].seatId, token: t.collaborators[0].token };
    obs = { seatId: t.observer!.seatId, token: t.observer!.token };
    const info = await call("GET", `/api/tables/${tableId}`, { token: alice.token });
    expect(info.data.phase).toBe("statements");
    expect(info.data.tableType).toBe("collab");
    expect(info.data.activeTurn.seatId).toBe(alice.seatId);
    // statements 阶段（类型白名单放行 STATEMENT）→ 角色硬校验拦下 observer
    const st = await call("POST", `/api/tables/${tableId}/messages`, {
      token: obs.token, body: { type: "STATEMENT", payload: { text: "x" } },
    });
    expect(st.status).toBe(403);
    expect(st.error?.code).toBe("role");
  });

  it("各自初稿：A 发布产物+陈述后 turn 移交 B；全员齐备进互审", async () => {
    // A：产物 + 陈述
    const pubA = await call("POST", `/api/tables/${tableId}/artifacts`, {
      token: alice.token,
      body: { name: "白皮书-背景章.md", format: "md", contentBase64: b64("# 背景\n\n（A 负责章节初稿）\n"), changeNote: "背景章 v1" },
    });
    expect(pubA.ok).toBe(true);
    artA = pubA.data.artifactId;
    const stA = await call("POST", `/api/tables/${tableId}/messages`, {
      token: alice.token, body: { type: "STATEMENT", payload: { text: "背景章初稿：覆盖动机与现状，已知缺口是缺少竞品对比。" } },
    });
    expect(stA.ok).toBe(true);
    // 仅 A 完成：仍处 statements，turn 给 B
    let info = await call("GET", `/api/tables/${tableId}`, { token: alice.token });
    expect(info.data.phase).toBe("statements");
    expect(info.data.activeTurn.seatId).toBe(bob.seatId);

    // B：先陈述后补产物（顺序无关），全员齐备自动进互审
    const stB = await call("POST", `/api/tables/${tableId}/messages`, {
      token: bob.token, body: { type: "STATEMENT", payload: { text: "方案章初稿：给出三阶段演进，缺口是成本估算。" } },
    });
    expect(stB.ok).toBe(true);
    info = await call("GET", `/api/tables/${tableId}`, { token: alice.token });
    expect(info.data.phase).toBe("statements");
    const pubB = await call("POST", `/api/tables/${tableId}/artifacts`, {
      token: bob.token,
      body: { name: "白皮书-方案章.md", format: "md", contentBase64: b64("# 方案\n\n（B 负责章节初稿）\n"), changeNote: "方案章 v1" },
    });
    expect(pubB.ok).toBe(true);
    artB = pubB.data.artifactId;
    info = await call("GET", `/api/tables/${tableId}`, { token: alice.token });
    expect(info.data.phase).toBe("review");
    expect(info.data.activeTurn.seatId).toBe(alice.seatId); // 互审按入席顺序从 A 开始
  });

  it("角色硬校验：observer 不可互审（review 阶段放行类型后由角色拦截）", async () => {
    const r2 = await call("POST", `/api/tables/${tableId}/messages`, {
      token: obs.token, body: { type: "REVIEW_COMMENT", payload: { items: [{ id: "x", target: "全文", severity: "nice", comment: "x" }] } },
    });
    expect(r2.status).toBe(403);
    expect(r2.error?.code).toBe("role");
  });

  it("互审：A 评 B 的部分，B 评 A 的部分 + 一条无指向意见 → 进认领", async () => {
    // A 互审（指向 B 的产物）
    const rcA = await call("POST", `/api/tables/${tableId}/messages`, {
      token: alice.token,
      body: {
        type: "REVIEW_COMMENT",
        payload: { artifactId: artB, items: [{ id: "a1", target: "三阶段演进", severity: "must", comment: "缺少每阶段成本估算，请补齐" }], summary: "方案章需补成本", done: true },
      },
    });
    expect(rcA.ok).toBe(true);
    let info = await call("GET", `/api/tables/${tableId}`, { token: alice.token });
    expect(info.data.phase).toBe("review");
    expect(info.data.activeTurn.seatId).toBe(bob.seatId);
    // 非持权方（A）再发互审 → not_your_turn
    const rWrong = await call("POST", `/api/tables/${tableId}/messages`, {
      token: alice.token,
      body: { type: "REVIEW_COMMENT", payload: { items: [{ id: "a2", target: "x", severity: "nice", comment: "x" }] } },
    });
    expect(rWrong.status).toBe(409);
    expect(rWrong.error?.code).toBe("not_your_turn");
    // B 互审（指向 A 的产物 + 一条无指向的整体建议）
    const rcB = await call("POST", `/api/tables/${tableId}/messages`, {
      token: bob.token,
      body: {
        type: "REVIEW_COMMENT",
        payload: {
          artifactId: artA,
          items: [
            { id: "b1", target: "背景章", severity: "must", comment: "缺竞品对比小节，我可以帮忙补" },
            { id: "b2", target: "全文结构", severity: "should", comment: "建议统一术语表（后续跟进）" },
          ],
          summary: "背景章补竞品；整体加术语表", done: true,
        },
      },
    });
    expect(rcB.ok).toBe(true);
    info = await call("GET", `/api/tables/${tableId}`, { token: alice.token });
    expect(info.data.phase).toBe("response");
    // 归属：b1/b2 均归 A（产物 owner / 建桌人统稿）→ 认领发言权先给 A
    expect(info.data.activeTurn.seatId).toBe(alice.seatId);
  });

  it("认领：A 处置自己名下意见（b1 请 B 帮改 / b2 记录跟进）→ turn 移交 B 处置 a1", async () => {
    const respA = await call("POST", `/api/tables/${tableId}/messages`, {
      token: alice.token,
      body: {
        type: "RESPONSE",
        payload: {
          items: [
            { reviewItemId: "b1", decision: "accept", reason: "请 B 帮忙补竞品对比", action: { executeBy: "reviewerSeat", note: "补一节竞品对比，2~3 段" } },
            { reviewItemId: "b2", decision: "defer", reason: "术语表放在定稿后统一处理" },
          ],
        },
      },
    });
    expect(respA.ok, JSON.stringify(respA.error)).toBe(true);
    // A 的意见已处置完，B（a1 归属：B 的产物）仍待认领
    let info = await call("GET", `/api/tables/${tableId}`, { token: alice.token });
    expect(info.data.phase).toBe("response");
    expect(info.data.activeTurn.seatId).toBe(bob.seatId);
    const respB = await call("POST", `/api/tables/${tableId}/messages`, {
      token: bob.token,
      body: {
        type: "RESPONSE",
        payload: { items: [{ reviewItemId: "a1", decision: "accept", reason: "我自己补成本估算", action: { executeBy: "self", note: "补每阶段成本表" } }] },
      },
    });
    expect(respB.ok).toBe(true);
    info = await call("GET", `/api/tables/${tableId}`, { token: alice.token });
    expect(info.data.phase).toBe("execution"); // 存在 2 个待执行认领请求
  });

  it("补齐执行：被请求方按 requestId 发布新版本并 accept，全部处置完进定稿表决", async () => {
    // 让限频窗口（8 次/10 秒）清空：前序 Bob 已连续多次发言+发布
    await new Promise((r) => setTimeout(r, 10_500));
    const reqs = await call("GET", `/api/tables/${tableId}/requests`, { token: alice.token });
    const pending = reqs.data.requests.filter((r: { status: string }) => r.status === "pending");
    expect(pending).toHaveLength(2);
    // 第一个 pending：b1 派生（A 的产物改版，执行席 = 意见提出者 B）——「互相支持补缺」
    const first = pending[0];
    expect(first.req.toSeat).toBe(bob.seatId);
    expect(first.req.artifactId).toBe(artA);
    let info = await call("GET", `/api/tables/${tableId}`, { token: alice.token });
    expect(info.data.activeTurn.seatId).toBe(bob.seatId);
    const v2 = await call("POST", `/api/tables/${tableId}/artifacts`, {
      token: bob.token,
      body: { artifactId: artA, name: "白皮书-背景章.md", format: "md", contentBase64: b64("# 背景\n\n## 竞品对比\n\n（B 补齐的竞品对比小节）\n"), changeNote: "补竞品对比（b1）", requestId: first.req.requestId },
    });
    expect(v2.ok, JSON.stringify(v2.error)).toBe(true);
    expect(v2.data.version.v).toBe(2);
    const acc1 = await call("POST", `/api/tables/${tableId}/messages`, {
      token: bob.token,
      body: { type: "RESPOND_REQUEST", payload: { requestId: first.req.requestId, decision: "accept" } },
    });
    expect(acc1.ok).toBe(true);
    // 第二个 pending：a1 派生（B 自己的产物）
    const second = pending[1];
    expect(second.req.toSeat).toBe(bob.seatId);
    expect(second.req.artifactId).toBe(artB);
    info = await call("GET", `/api/tables/${tableId}`, { token: alice.token });
    expect(info.data.activeTurn.seatId).toBe(bob.seatId);
    const v2b = await call("POST", `/api/tables/${tableId}/artifacts`, {
      token: bob.token,
      body: { artifactId: artB, name: "白皮书-方案章.md", format: "md", contentBase64: b64("# 方案\n\n## 成本估算\n\n（B 自己补齐）\n"), changeNote: "补成本估算（a1）", requestId: second.req.requestId },
    });
    expect(v2b.ok).toBe(true);
    const acc2 = await call("POST", `/api/tables/${tableId}/messages`, {
      token: bob.token,
      body: { type: "RESPOND_REQUEST", payload: { requestId: second.req.requestId, decision: "accept" } },
    });
    expect(acc2.ok).toBe(true);
    info = await call("GET", `/api/tables/${tableId}`, { token: alice.token });
    expect(info.data.phase).toBe("convergence");
  });

  it("定稿表决：观察者无表决权，双协作者 pass → 闭桌出纪要（含桌类型）", async () => {
    const vo = await call("POST", `/api/tables/${tableId}/messages`, {
      token: obs.token, body: { type: "CONSENSUS_VOTE", payload: { decision: "pass" } },
    });
    expect(vo.status).toBe(403); // caps: 无表决权
    let info = await call("GET", `/api/tables/${tableId}`, { token: alice.token });
    expect(info.data.activeTurn.seatId).toBe(alice.seatId);
    await call("POST", `/api/tables/${tableId}/messages`, {
      token: alice.token, body: { type: "CONSENSUS_VOTE", payload: { decision: "pass" } },
    });
    await call("POST", `/api/tables/${tableId}/messages`, {
      token: bob.token, body: { type: "CONSENSUS_VOTE", payload: { decision: "pass" } },
    });
    info = await call("GET", `/api/tables/${tableId}`, { token: alice.token });
    expect(info.data.phase).toBe("closed");
    const polled = await call("GET", `/api/tables/${tableId}/poll?since=0&timeout=0`, { token: alice.token });
    const minutes = polled.data.messages.find((m: { type: string }) => m.type === "MINUTES");
    expect(minutes).toBeTruthy();
    expect(minutes.payload.markdown).toContain("桌类型：协作");
    expect(minutes.payload.markdown).toContain("竞品对比"); // 认领补齐的处置在纪要中可见
  });
});

describe("变体类型与 hosted 组合", () => {
  it("brainstorm：协作流变体（collaborator 角色 / ≥2 协作者才可开始）", async () => {
    const u = await newUser("bs-owner");
    const r = await call("POST", "/api/tables", {
      token: u,
      body: { tableType: "brainstorm", topic: "新功能点子会", owner: { seatName: "主持发起", agentLabel: "zcode" } },
    });
    expect(r.ok).toBe(true);
    expect(r.data.tableType).toBe("brainstorm");
    expect(r.data.inviteCodes.map((c: { role: string }) => c.role).sort()).toEqual(["collaborator", "observer"]);
    await call("POST", `/api/tables/${r.data.tableId}/seat-config`, {
      token: r.data.ownerSeatToken, body: { stance: "点子贡献", ready: true },
    });
    const s = await call("POST", `/api/tables/${r.data.tableId}/start`, { token: r.data.ownerSeatToken });
    expect(s.status).toBe(409);
    expect(s.error?.code).toBe("no_collaborators");
  });

  it("decision：评审流变体（self 模式不发 proposer 码；陈述权归提案方；hosted 下 proposer 唯一）", async () => {
    const u = await newUser("dec-owner");
    const r = await call("POST", "/api/tables", {
      token: u,
      body: { tableType: "decision", topic: "数据库选型", owner: { seatName: "主张方", agentLabel: "zcode" } },
    });
    expect(r.data.tableType).toBe("decision");
    // self 模式建桌人已占唯一角色 proposer：只发 reviewer/observer 码
    expect(r.data.inviteCodes.map((c: { role: string }) => c.role).sort()).toEqual(["observer", "reviewer"]);
    const info0 = await call("GET", `/api/tables/${r.data.tableId}`, { token: r.data.ownerSeatToken });
    expect(info0.data.seats[0].role).toBe("proposer");
    // 评审方入席 → 就绪 → 开始 → 陈述权归提案方
    const revCode = r.data.inviteCodes.find((c: { role: string }) => c.role === "reviewer").code;
    const u3 = await newUser("dec-r");
    const j3 = await call("POST", `/api/tables/${r.data.tableId}/seats`, {
      token: u3, body: { inviteCode: revCode, seatName: "评估方", role: "reviewer", agentLabel: "claude" },
    });
    expect(j3.ok).toBe(true);
    await call("POST", `/api/tables/${r.data.tableId}/seat-config`, { token: r.data.ownerSeatToken, body: { stance: "主张方", ready: true } });
    await call("POST", `/api/tables/${r.data.tableId}/seat-config`, { token: j3.data.token, body: { stance: "评估方", ready: true } });
    const s = await call("POST", `/api/tables/${r.data.tableId}/start`, { token: r.data.ownerSeatToken });
    expect(s.ok).toBe(true);
    const info = await call("GET", `/api/tables/${r.data.tableId}`, { token: r.data.ownerSeatToken });
    expect(info.data.activeTurn.seatId).toBe(info.data.ownerSeat);

    // hosted 决策桌发 proposer 码：第二个提案席入席 → 唯一角色 409
    const host = await newUser("dec-host");
    const rh = await call("POST", "/api/tables", {
      token: host,
      body: { mode: "hosted", tableType: "decision", topic: "主持的选型会", owner: { seatName: "主持人", agentLabel: "human-only" } },
    });
    expect(rh.data.inviteCodes.map((c: { role: string }) => c.role).sort()).toEqual(["observer", "proposer", "reviewer"]);
    const propCode = rh.data.inviteCodes.find((c: { role: string }) => c.role === "proposer").code;
    const p1 = await call("POST", `/api/tables/${rh.data.tableId}/seats`, {
      token: await newUser("dec-p1"), body: { inviteCode: propCode, seatName: "P1", role: "proposer", agentLabel: "claude" },
    });
    expect(p1.ok).toBe(true);
    const p2 = await call("POST", `/api/tables/${rh.data.tableId}/seats`, {
      token: await newUser("dec-p2"), body: { inviteCode: propCode, seatName: "P2", role: "proposer", agentLabel: "claude" },
    });
    expect(p2.status).toBe(409);
    expect(p2.error?.code).toBe("role_exists");
  });

  it("hosted + collab：主持人建协作桌，邀请两位协作者后开始，初稿权给首位协作者", async () => {
    const host = await newUser("host-c");
    const r = await call("POST", "/api/tables", {
      token: host,
      body: {
        mode: "hosted", tableType: "collab", topic: "主持的协作桌",
        owner: { seatName: "主持人", agentLabel: "human-only" },
      },
    });
    expect(r.ok).toBe(true);
    const { tableId, ownerSeatToken } = r.data;
    const info0 = await call("GET", `/api/tables/${tableId}`, { token: ownerSeatToken });
    expect(info0.data.seats[0].role).toBe("host");
    expect(r.data.inviteCodes.map((c: { role: string }) => c.role).sort()).toEqual(["collaborator", "observer"]);
    const code = r.data.inviteCodes.find((c: { role: string }) => c.role === "collaborator").code;
    const seats: { seatId: string; token: string }[] = [];
    for (const n of ["C1", "C2"]) {
      const u = await newUser(n);
      const j = await call("POST", `/api/tables/${tableId}/seats`, {
        token: u, body: { inviteCode: code, seatName: n, role: "collaborator", agentLabel: "claude" },
      });
      expect(j.ok).toBe(true);
      await call("POST", `/api/tables/${tableId}/seat-config`, { token: j.data.token, body: { stance: `协作者${n}`, ready: true } });
      seats.push({ seatId: j.data.seatId, token: j.data.token });
    }
    const s = await call("POST", `/api/tables/${tableId}/start`, { token: ownerSeatToken });
    expect(s.ok).toBe(true);
    const info = await call("GET", `/api/tables/${tableId}`, { token: ownerSeatToken });
    expect(info.data.phase).toBe("statements");
    expect(info.data.activeTurn.seatId).toBe(seats[0].seatId);
  });
});
