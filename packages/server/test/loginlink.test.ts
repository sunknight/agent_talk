/**
 * 一次性网页登录链接 + 观察端多帐号切换 验收：
 * 服务端：生成需鉴权、链接 token 形态（rtwb_、path 可拼 URL）、兑换成功设登录态（并行 token 不顶掉 agent 主 token）、
 * 一次性（二次兑换拒绝）、过期拒绝、无效拒绝、禁用用户兑换拒绝、admin 重签后并行网页 token 一并失效；
 * skill 模板：第 0 步第 5 条「账号就绪即交付网页登录链接」与 curl 命令；
 * 观察端：#/login/<token> 兑换流程、多帐号存储（rt_accounts/rt_active_uid）、帐号切换重载与登出移除。
 * fetch 直调 REST，零 mock；过期用例走 engine 的 TTL 注入。
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
  const dir = mkdtempSync(join(tmpdir(), "rt-llogin-test-"));
  ({ http, hub } = await start({ port: 0, dataDir: dir, host: "127.0.0.1" }));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => { http.closeIdleConnections?.(); http.close(() => r()); }));

describe("服务端：一次性登录链接", () => {
  const name = "登录链接-持有人";
  let userToken = ""; // agent 侧主 token（rtu_，注册签发）
  let userId = "";
  let linkToken = "";
  let webToken = ""; // 兑换签发的并行网页 token

  it("生成链接需用户 token 鉴权", async () => {
    const anon = await call("POST", "/api/auth/login-link");
    expect(anon.ok).toBe(false);
    expect(anon.error?.code).toBe("unauthorized");
  });

  it("生成成功：rtwb_ 前缀 + path 可拼完整 URL（#/login/…）", async () => {
    const reg = await call("POST", "/api/users", { body: { name } });
    userToken = reg.data.token;
    userId = reg.data.userId;
    const made = await call("POST", "/api/auth/login-link", { token: userToken });
    expect(made.ok).toBe(true);
    expect(made.data.token).toMatch(/^rtwb_/);
    expect(made.data.path).toBe(`#/login/${made.data.token}`);
    expect(made.data.expiresAt).toBeGreaterThan(Date.now());
    linkToken = made.data.token;
  });

  it("兑换成功：签发并行 rtu_ token，设为网页登录态；agent 主 token 不受影响（不顶号）", async () => {
    const ex = await call("POST", "/api/auth/exchange", { body: { token: linkToken } });
    expect(ex.ok).toBe(true);
    expect(ex.data.token).toMatch(/^rtu_/);
    expect(ex.data.userId).toBe(userId);
    expect(ex.data.name).toBe(name);
    webToken = ex.data.token;
    // 网页 token 可用（/api/me 同一用户）
    const meWeb = await call("GET", "/api/me", { token: webToken });
    expect(meWeb.ok).toBe(true);
    expect(meWeb.data.userId).toBe(userId);
    // agent 主 token 依旧有效（并行共存，而非重签顶替）
    const meAgent = await call("GET", "/api/me", { token: userToken });
    expect(meAgent.ok).toBe(true);
  });

  it("一次性：同一条链接二次兑换被拒（401 bad_login_link）", async () => {
    const again = await call("POST", "/api/auth/exchange", { body: { token: linkToken } });
    expect(again.ok).toBe(false);
    expect(again.error?.code).toBe("bad_login_link");
    // 已兑换出的网页 token 不受影响
    const me = await call("GET", "/api/me", { token: webToken });
    expect(me.ok).toBe(true);
  });

  it("过期拒绝：TTL 注入生成短时效链接，过期后兑换 401", async () => {
    const short = hub.createLoginLink(userToken, 1);
    await new Promise((r) => setTimeout(r, 20)); // 等过期
    const ex = await call("POST", "/api/auth/exchange", { body: { token: short.token } });
    expect(ex.ok).toBe(false);
    expect(ex.error?.code).toBe("bad_login_link");
  });

  it("无效 token 兑换 401；空 token 422", async () => {
    const bad = await call("POST", "/api/auth/exchange", { body: { token: "rtwb_nope" } });
    expect(bad.error?.code).toBe("bad_login_link");
    const empty = await call("POST", "/api/auth/exchange", { body: { token: "" } });
    expect(empty.status).toBe(422);
  });

  it("禁用用户：链接生成后被禁用，兑换 403", async () => {
    // 另建用户做禁用用例，不污染主链路账号
    const reg = await call("POST", "/api/users", { body: { name: "登录链接-将被禁用" } });
    const adminReg = await call("POST", "/api/users", { body: { name: "登录链接-管理员" } });
    const adminUserId = adminReg.data.userId;
    hub.store.setUserRole(adminUserId, "systemadmin");
    const link = await call("POST", "/api/auth/login-link", { token: reg.data.token });
    await call("POST", `/api/admin/users/${reg.data.userId}/disabled`, { token: adminReg.data.token, body: { disabled: true } });
    const ex = await call("POST", "/api/auth/exchange", { body: { token: link.data.token } });
    expect(ex.ok).toBe(false);
    expect(ex.error?.code).toBe("user_disabled");
  });

  it("admin 重签用户 token：并行网页 token 一并失效（重签即换新语义）", async () => {
    const adminReg = await call("POST", "/api/users", { body: { name: "登录链接-重签管理员" } });
    hub.store.setUserRole(adminReg.data.userId, "systemadmin");
    const re = await call("POST", `/api/admin/users/${userId}/token`, { token: adminReg.data.token });
    expect(re.ok).toBe(true);
    const oldWeb = await call("GET", "/api/me", { token: webToken });
    expect(oldWeb.ok).toBe(false); // 旧网页 token 已失效
    const newMain = await call("GET", "/api/me", { token: re.data.token });
    expect(newMain.ok).toBe(true); // 重签出的新主 token 可用
    userToken = re.data.token; // 后续用例改用新主 token
  });
});

describe("skill 模板：登录链接交付", () => {
  it("第 0 步第 5 条：账号就绪即交付网页登录链接（curl + 拼接说明 + 一次性/时效说明）", () => {
    expect(SKILL_MD).toContain("第 5 条网页登录链接每次连接都要交付");
    expect(SKILL_MD).toContain('curl -s -X POST -H "Authorization: Bearer $userToken" "$server/api/auth/login-link"');
    expect(SKILL_MD).toContain("#/login/rtwb_");
    expect(SKILL_MD).toContain("10 分钟内一次有效");
    expect(SKILL_MD.indexOf("第 0 步 · 账号准备")).toBeLessThan(SKILL_MD.indexOf("第 1 步 · 建桌还是进桌"));
  });
  it("恢复参会场景同样指向登录链接交付", () => {
    expect(SKILL_MD).toContain("同样按第 0 步第 5 条交付网页登录链接");
  });
  it("模板整体不含反引号（String.raw 单一事实源约束）", () => {
    expect(SKILL_MD.includes("`")).toBe(false);
  });
});

describe("观察端：链接兑换与多帐号", () => {
  it("#/login/<token> 路由：启动即兑换、先清 URL 防重复消费", () => {
    expect(OBSERVER_HTML).toContain("function routeLoginToken()");
    expect(OBSERVER_HTML).toContain("function tryExchangeLogin(");
    expect(OBSERVER_HTML).toContain('history.replaceState(null,\'\',location.pathname+location.search);');
    expect(OBSERVER_HTML).toContain("/api/auth/exchange");
  });
  it("已打开页面内点到登录链接（hash 变化不重载）同样走兑换（syncRoute 路由分支）", () => {
    expect(OBSERVER_HTML).toContain("var lt=routeLoginToken();");
    expect(OBSERVER_HTML.indexOf("function syncRoute()")).toBeGreaterThan(0);
    expect(OBSERVER_HTML.indexOf("var lt=routeLoginToken();")).toBeGreaterThan(
      OBSERVER_HTML.indexOf("function syncRoute()"),
    );
  });
  it("多帐号存储：rt_accounts 数组 + rt_active_uid 活跃指针 + 旧单帐号键自动迁移", () => {
    expect(OBSERVER_HTML).toContain("function loadAccounts()");
    expect(OBSERVER_HTML).toContain("function accountUpsert(a)");
    expect(OBSERVER_HTML).toContain("rt_accounts");
    expect(OBSERVER_HTML).toContain("rt_active_uid");
    expect(OBSERVER_HTML).toContain("localStorage.getItem('rt_token')");
  });
  it("切换帐号 = 改活跃指针后整页重载；退出仅移除当前帐号（其余保留切回）", () => {
    expect(OBSERVER_HTML).toContain("function toggleAcctMenu()");
    expect(OBSERVER_HTML).toContain('localStorage.setItem(\'rt_active_uid\',a.userId);');
    expect(OBSERVER_HTML).toContain("location.reload(); // 切换帐号：重载页面，以新登录态重新初始化");
    expect(OBSERVER_HTML).toContain("还有其他帐号：移除当前，自动切到第一个并重载");
  });
  it("已登录即可用帐号入口（不因单帐号隐藏），支持填 token 补登其他帐号并切换、保留全部已有登录态", () => {
    // 入口恒显示：不再有「>1 帐号才渲染」的条件包裹
    expect(OBSERVER_HTML.includes("ACCOUNTS.length>1?'<button id=\"acctSwBtn\"")).toBe(false);
    expect(OBSERVER_HTML).toContain('id="acctSwBtn"');
    // 切换浮层底部的补登入口 + 添加浮层 + 连接逻辑
    expect(OBSERVER_HTML).toContain("acctAddRow");
    expect(OBSERVER_HTML).toContain("function toggleAddAcctMenu()");
    expect(OBSERVER_HTML).toContain("function doAddAccount()");
    expect(OBSERVER_HTML).toContain("登录其他帐号");
    expect(OBSERVER_HTML).toContain("id=\"addAcctGo\"");
    // 连接即验证 token（/api/me）→ 记录（accountUpsert 保留旧帐号）→ 切换
    const addFn = OBSERVER_HTML.slice(OBSERVER_HTML.indexOf("function doAddAccount"), OBSERVER_HTML.indexOf("function closeAcctMenu"));
    expect(addFn).toContain("/api/me");
    expect(addFn).toContain("accountUpsert");
    expect(addFn).toContain("已登录并切换");
  });
  it("登录/注册/兑换均写入帐号记录；fetchMe 回写最新身份", () => {
    expect(OBSERVER_HTML).toContain("accountUpsert({ token:TOKEN");
    expect(OBSERVER_HTML).toContain("accountUpsert({ token:d.token");
    expect(OBSERVER_HTML).toContain("accountUpsert({ token:d.token, userId:d.userId||''");
  });
  it("帮助文案：登录链接与多帐号切换的用户面说明", () => {
    expect(OBSERVER_HTML).toContain("网页登录链接");
    expect(OBSERVER_HTML).toContain("多帐号切换");
    expect(OBSERVER_HTML).toContain("帐号切换");
  });
});
