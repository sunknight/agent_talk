/**
 * web ↔ agent 账号打通验收：
 * skill 模板（.roundtable/user.json 账号文件、第 0 步账号准备、凭证粘贴解析、§6 白名单），
 * 观察端（复制账号凭证、席位/恢复凭证提示行、接入指令账号准备、帮助文案），
 * 端到端：持有人把同一 user token 交给 agent → agent 凭码入席 → 席位归属同用户 →
 * 网页提交私有指令 → 席位 poll 收到 → ack 闭环（「同用户才可用私密指令」的打通证明）。
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

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-acct-test-"));
  ({ http, hub } = await start({ port: 0, dataDir: dir, host: "127.0.0.1" }));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => { http.closeIdleConnections?.(); http.close(() => r()); }));

describe("skill 模板：账号凭证体系", () => {
  it("账号文件 user.json：格式、多服务器查找、不得重复注册", () => {
    expect(SKILL_MD).toContain("账号凭证文件 .roundtable/user.json");
    expect(SKILL_MD).toContain('"token":"rtu_xxx"');
    expect(SKILL_MD).toContain("user-<主机名>.json");
    expect(SKILL_MD).toContain("不得重复注册");
  });
  it("【圆桌账号凭证】粘贴解析：写入账号文件并告知持有人同用户", () => {
    expect(SKILL_MD).toContain("【圆桌账号凭证】");
    expect(SKILL_MD).toContain("网页与本体即同一用户");
  });
  it("向导第 0 步 · 账号准备：先问持有人、/api/me 校验、注册后醒目交付 token", () => {
    expect(SKILL_MD.indexOf("第 0 步 · 账号准备")).toBeGreaterThan(0);
    expect(SKILL_MD.indexOf("第 0 步 · 账号准备")).toBeLessThan(SKILL_MD.indexOf("第 1 步 · 建桌还是进桌"));
    expect(SKILL_MD).toContain("$server/api/me");
    expect(SKILL_MD).toContain("持有人答复前不得自行注册");
    expect(SKILL_MD).toContain("token 只显示这一次，请自行留存");
    // A/B 两条路径不再各自注册，统一引用账号准备步骤
    expect(SKILL_MD).toContain("第 0 步 · 账号准备；复用账号文件，不再另行注册");
    expect(SKILL_MD).not.toContain("无则注册");
  });
  it("§6 白名单覆盖 .roundtable/（账号与桌配置所在目录）", () => {
    expect(SKILL_MD).toContain("b. 读写 ./.roundtable/ 与 ./roundtables/ 目录内的文件");
  });
  it("模板整体不含反引号（String.raw 单一事实源约束）", () => {
    expect(SKILL_MD.includes("`")).toBe(false);
  });
});

describe("观察端：账号凭证流转", () => {
  it("账号凭证构造器与身份区「复制账号凭证」按钮", () => {
    expect(OBSERVER_HTML).toContain("function accountCredentialText()");
    expect(OBSERVER_HTML).toContain("【圆桌账号凭证】");
    expect(OBSERVER_HTML).toContain('id="acctBtn"');
    expect(OBSERVER_HTML).toContain("copyText(accountCredentialText())");
    expect(OBSERVER_HTML).toContain("只交给自己的 agent"); // 复制后警示 toast / 文本内警示
    expect(OBSERVER_HTML).toContain("系统观察员权限"); // systemadmin 强警示
  });
  it("席位凭证与恢复凭证带「另发账号凭证」提示；邀请码不带（不引导外发账号）", () => {
    expect(OBSERVER_HTML).toContain("function seatTokenText");
    expect(OBSERVER_HTML).toContain("function recoveryText");
    expect(OBSERVER_HTML).toContain("另点网页右上角「复制账号凭证」发给它");
    const inviteFn = OBSERVER_HTML.slice(OBSERVER_HTML.indexOf("function inviteText"), OBSERVER_HTML.indexOf("function seatTokenText"));
    expect(inviteFn).not.toContain("复制账号凭证");
  });
  it("agent 接入指令：账号准备（复用优先 / 注册保存 user.json / 告知持有人）", () => {
    expect(OBSERVER_HTML).toContain("账号准备（先问持有人，勿擅自注册）");
    expect(OBSERVER_HTML).toContain(".roundtable/user.json");
    expect(OBSERVER_HTML).toContain("网页与 agent 即同一账号");
  });
  it("帮助与引导文案：账号互通说明（面向用户，不写实现细节）", () => {
    expect(OBSERVER_HTML).toContain("账号互通");
    expect(OBSERVER_HTML).toContain("席位凭证与邀请码不含账号 token");
  });
});

describe("端到端：同一账号 web ↔ agent（私密指令可达）", () => {
  const holderName = "账号打通-持有人";
  let holderToken = ""; // 同一份 rtu_ token：网页登录 = agent 持有
  let holderUserId = "";
  let tableId = "";
  let agentSeatToken = ""; // agent 拿到的席位 token（凭码入席时签发）
  let agentSeatId = "";
  let inviteCode = ""; // reviewer 邀请码（10 次可用，重复入席用例复用）
  let directiveId = "";

  it("网页注册 → 账号凭证（同一 token）交给 agent → 凭码入席：席位归属同一用户", async () => {
    // 他人（桌主）建桌并发出邀请码
    const ownerToken = (await call("POST", "/api/users", { body: { name: "账号打通-桌主" } })).data.token;
    const created = await call("POST", "/api/tables", {
      token: ownerToken,
      body: { topic: "账号打通验收桌", owner: { seatName: "桌主", agentLabel: "zcode" } },
    });
    tableId = created.data.tableId;
    inviteCode = created.data.inviteCodes.find((c: { role: string }) => c.role === "reviewer").code;
    // 持有人网页注册（观察端登录）
    const reg = await call("POST", "/api/users", { body: { name: holderName } });
    holderToken = reg.data.token;
    holderUserId = reg.data.userId;
    // agent 用 /api/me 校验账号凭证（skill 第 0 步）
    const me = await call("GET", "/api/me", { token: holderToken });
    expect(me.ok).toBe(true);
    expect(me.data.userId).toBe(holderUserId);
    // agent 持同一 token 凭码入席（对应「复制账号凭证 → agent 复用」路径）
    const joined = await call("POST", `/api/tables/${tableId}/seats`, {
      token: holderToken, body: { inviteCode, seatName: "持有人agent", role: "reviewer", agentLabel: "zcode" },
    });
    expect(joined.ok).toBe(true);
    agentSeatToken = joined.data.token;
    agentSeatId = joined.data.seatId;
    // 席位绑定到同一用户（seat_owners 命中）
    expect(hub.store.seatOwnerOf(tableId, agentSeatId)).toBe(holderUserId);
  });

  it("同用户重复入席被拒（409 already_seated）——账号复用不产生重复席位；网页同账号可见本桌", async () => {
    const list = await call("GET", "/api/observer/tables", { token: holderToken });
    expect(list.ok).toBe(true);
    const mine = list.data.tables.find((t: { tableId: string }) => t.tableId === tableId);
    expect(mine).toBeTruthy(); // 网页可见本桌（同一账号）
    // 同一账号再次凭码入席（already_seated 拦截发生在消费邀请码之前）→ 409
    const again = await call("POST", `/api/tables/${tableId}/seats`, {
      token: holderToken, body: { inviteCode, seatName: "重复入席", role: "reviewer", agentLabel: "zcode" },
    });
    expect(again.error?.code).toBe("already_seated");
  });

  it("网页（同账号）提交私有指令 → agent 席位 poll 收到 → ack 闭环", async () => {
    const secret = "ACCOUNT-UNIFY-私有指令可达证明";
    const submit = await call("POST", `/api/tables/${tableId}/my/owner-directive`, {
      token: holderToken, body: { text: secret },
    });
    expect(submit.ok).toBe(true);
    directiveId = submit.data.directiveId;
    // agent 以席位 token poll（timeout=0 立即返回）
    const poll = await call("GET", `/api/tables/${tableId}/poll?since=0&timeout=0`, { token: agentSeatToken });
    expect(poll.ok).toBe(true);
    const got = (poll.data.ownerDirectives ?? []).find((d: { directiveId: string }) => d.directiveId === directiveId);
    expect(got?.text).toBe(secret);
    // ack 后不再下发
    const ack = await call("POST", `/api/tables/${tableId}/owner-directives/ack`, {
      token: agentSeatToken, body: { directiveIds: [directiveId] },
    });
    expect(ack.ok).toBe(true);
    const repoll = await call("GET", `/api/tables/${tableId}/poll?since=0&timeout=0`, { token: agentSeatToken });
    expect((repoll.data.ownerDirectives ?? []).some((d: { directiveId: string }) => d.directiveId === directiveId)).toBe(false);
  });

  it("agent 端注册的用户：token 即网页登录凭证（同一 token /api/me 直连）", async () => {
    // 模拟 agent 侧注册（skill 第 0 步第 4 条）：注册返回 token 交给持有人 → 网页粘贴登录
    const reg = await call("POST", "/api/users", { body: { name: "账号打通-agent侧注册" } });
    expect(reg.data.token).toMatch(/^rtu_/);
    const me = await call("GET", "/api/me", { token: reg.data.token });
    expect(me.ok).toBe(true);
    expect(me.data.name).toBe("账号打通-agent侧注册");
  });
});
