/**
 * chatbox 左右侧个人偏好 + 问询方席位展示（任务 0035）：
 * - store：user_table_prefs 读写 round-trip、坏 JSON 容错
 * - API：POST /api/tables/:id/my/chat-sides 白名单过滤（非法席/退席/非法值丢弃、asker 仅问询桌）；
 *   observerDetail 回读 chatSides（按查看者隔离）；非参与方 403；systemadmin 可设
 * - 问询桌：observerDetail 返回 asker 真名（非问询方视角也是真名，不再误用查看者姓名）
 * - 页面：sideT 切换按钮 / chatSideOf / my/chat-sides 端点 / 问询方卡片元素
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start } from "../src";
import { Store } from "../src/store";
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

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-sides-"));
  ({ http, hub } = await start({ port: 0, dataDir: dir, host: "127.0.0.1" }));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => { http.closeIdleConnections?.(); http.close(() => r()); }));

describe("store：user_table_prefs", () => {
  it("chatSides 写读 round-trip；默认空；坏 JSON 容错回空", () => {
    const s = new Store(mkdtempSync(join(tmpdir(), "rt-sides-store-")));
    expect(s.getChatSides("tbl_x", "u1")).toEqual({});
    s.setChatSides("tbl_x", "u1", { st_a: "L", st_b: "R" });
    expect(s.getChatSides("tbl_x", "u1")).toEqual({ st_a: "L", st_b: "R" });
    expect(s.getChatSides("tbl_x", "u2")).toEqual({}); // 按用户隔离
    // 手改库造坏数据：不抛错、按空处理
    s.db.prepare("UPDATE user_table_prefs SET chat_sides = ? WHERE user_id = ? AND table_id = ?").run("{not json", "u1", "tbl_x");
    expect(s.getChatSides("tbl_x", "u1")).toEqual({});
    // 合法 JSON 但值越界：只保留 L/R
    s.setChatSides("tbl_x", "u3", { st_a: "LEFT" });
    expect(s.getChatSides("tbl_x", "u3")).toEqual({});
    s.close();
  });
});

describe("chatbox 左右侧偏好（评审桌）", () => {
  let owner = "", reviewer = "", stranger = "";
  let tableId = "", reviewerSeatId = "";

  beforeAll(async () => {
    owner = await reg("侧别-建桌人");
    reviewer = await reg("侧别-评审方");
    stranger = await reg("侧别-路人");
    const r = await call("POST", "/api/tables", {
      token: owner, body: { topic: "侧别偏好桌", owner: { seatName: "提案人", agentLabel: "a" } },
    });
    tableId = r.data.tableId;
    const code = (r.data.inviteCodes as { code: string; role: string }[]).find((c) => c.role === "reviewer")!.code;
    const j = await call("POST", `/api/tables/${tableId}/seats`, {
      token: reviewer, body: { inviteCode: code, seatName: "评审人", role: "reviewer", agentLabel: "a" },
    });
    reviewerSeatId = j.data.seatId;
  });

  it("保存（白名单过滤非法键值）→ observerDetail 按查看者回读", async () => {
    const save = await call("POST", `/api/tables/${tableId}/my/chat-sides`, {
      token: owner,
      body: { chatSides: { [reviewerSeatId]: "R", st_fake: "L", asker: "R", st_bad: "CENTER" } },
    });
    expect(save.ok).toBe(true);
    expect(save.data.chatSides).toEqual({ [reviewerSeatId]: "R" }); // 假席/非问询桌 asker/非法值全被过滤

    const d1 = await call("GET", `/api/observer/tables/${tableId}`, { token: owner });
    expect(d1.data.chatSides).toEqual({ [reviewerSeatId]: "R" });

    const d2 = await call("GET", `/api/observer/tables/${tableId}`, { token: reviewer });
    expect(d2.data.chatSides).toEqual({}); // 评审方自己的偏好表独立为空
    expect(d2.data.asker).toBe(null); // 非问询桌无问询方
  });

  it("全量替换：第二次保存覆盖第一次；空对象清空", async () => {
    const save = await call("POST", `/api/tables/${tableId}/my/chat-sides`, {
      token: owner, body: { chatSides: {} },
    });
    expect(save.data.chatSides).toEqual({});
    const d = await call("GET", `/api/observer/tables/${tableId}`, { token: owner });
    expect(d.data.chatSides).toEqual({});
  });

  it("非参与方保存 403；systemadmin 可设自己的", async () => {
    const no = await call("POST", `/api/tables/${tableId}/my/chat-sides`, {
      token: stranger, body: { chatSides: { [reviewerSeatId]: "R" } },
    });
    expect(no.status).toBe(403);
    expect(no.error!.code).toBe("not_participant");

    // 提权 stranger 为 systemadmin（停服通道与生产一致）
    const uid = (await call("GET", "/api/me", { token: stranger })).data.userId;
    hub.store.setUserRole(uid, "systemadmin");
    const adm = await call("POST", `/api/tables/${tableId}/my/chat-sides`, {
      token: stranger, body: { chatSides: { [reviewerSeatId]: "L" } },
    });
    expect(adm.ok).toBe(true);
    const d = await call("GET", `/api/observer/tables/${tableId}`, { token: stranger });
    expect(d.data.chatSides).toEqual({ [reviewerSeatId]: "L" }); // 与建桌人的偏好互不影响
    const dOwner = await call("GET", `/api/observer/tables/${tableId}`, { token: owner });
    expect(dOwner.data.chatSides).toEqual({});
  });
});

describe("问询桌：asker 展示与偏好", () => {
  let asker = "", answerer = "";
  let tableId = "", answererSeatId = "", answererCode = "";

  beforeAll(async () => {
    asker = await reg("侧别-问询人");
    const r = await call("POST", "/api/tables", {
      token: asker, body: { tableType: "inquiry", topic: "侧别问询桌", owner: { seatName: "侧别-问询人", agentLabel: "human" } },
    });
    tableId = r.data.tableId;
    answererCode = (r.data.inviteCodes as { code: string; role: string }[]).find((c) => c.role === "answerer")!.code;
    answerer = await reg("侧别-回答人");
    const j = await call("POST", `/api/tables/${tableId}/seats`, {
      token: answerer, body: { inviteCode: answererCode, seatName: "回答人甲", role: "answerer", agentLabel: "a" },
    });
    answererSeatId = j.data.seatId;
  });

  it("observerDetail 返回 asker 真名（回答方视角也是问询方姓名，非查看者自己）", async () => {
    const d = await call("GET", `/api/observer/tables/${tableId}`, { token: answerer });
    expect(d.data.asker).toEqual({ seatId: "asker", name: "侧别-问询人" });
    expect(d.data.isAsker).toBe(false);
    const mine = await call("GET", `/api/observer/tables/${tableId}`, { token: asker });
    expect(mine.data.asker).toEqual({ seatId: "asker", name: "侧别-问询人" });
    expect(mine.data.isAsker).toBe(true);
  });

  it("asker 键在问询桌合法：问询方/回答方均可保存并回读", async () => {
    const s1 = await call("POST", `/api/tables/${tableId}/my/chat-sides`, {
      token: asker, body: { chatSides: { asker: "R", [answererSeatId]: "L" } },
    });
    expect(s1.data.chatSides).toEqual({ asker: "R", [answererSeatId]: "L" });
    const s2 = await call("POST", `/api/tables/${tableId}/my/chat-sides`, {
      token: answerer, body: { chatSides: { asker: "R" } }, // 回答方把问询方挪到右侧
    });
    expect(s2.data.chatSides).toEqual({ asker: "R" });
    const d = await call("GET", `/api/observer/tables/${tableId}`, { token: answerer });
    expect(d.data.chatSides).toEqual({ asker: "R" });
  });
});

describe("页面：左右侧切换与问询方卡片元素", () => {
  it("OBSERVER_HTML 含 sideT 按钮 / chatSideOf 解析 / my/chat-sides 端点 / 问询方节点文案", () => {
    expect(OBSERVER_HTML).toContain("function chatSideOf"); // 侧别解析（显式覆盖优先）
    expect(OBSERVER_HTML).toContain('class="sideT'); // 切换按钮（席位与立场 + 圆桌示意图）
    expect(OBSERVER_HTML).toContain("/my/chat-sides"); // 保存端点
    expect(OBSERVER_HTML).toContain("尚未提问"); // 示意图 asker 节点 fallback 文案
    expect(OBSERVER_HTML).toContain('vcard asker'); // 席位与立场的问询方卡片
    expect(OBSERVER_HTML).toContain("不占席位 · 在会话区提问"); // 问询方卡片说明
    expect(OBSERVER_HTML).not.toContain("问询方 · '+esc(view.userName"); // 旧的误用查看者姓名徽章已移除
    expect(OBSERVER_HTML).toContain("左右侧可在席位与立场 / 圆桌示意图中调整"); // 会话区提示
  });
});
