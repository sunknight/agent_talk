/**
 * 数据范围披露级别（user_id 身份红线）验收：
 * 席位/网页双通道提交 union 条目（{text,grant} 与旧 string 混合）、非法 grant 422、
 * 旧格式兼容（存储原样）、网页通道对象条目不被字符串化（api 层 parseDataScope）、
 * skill 模板身份红线与披露纪律文案、观察页表单/徽章/邀请引导/帮助文案。
 * fetch 直调 REST，零 mock。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start } from "../src";
import { SKILL_MD } from "../src/skill-template";
import { OBSERVER_HTML } from "../src/observer-html";
import { is } from "@rt/shared";

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

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-disc-test-"));
  ({ http, hub } = await start({ port: 0, dataDir: dir, host: "127.0.0.1" }));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => { http.closeIdleConnections?.(); http.close(() => r()); }));

describe("数据范围披露级别", () => {
  let ownerUserToken = "", ownerSeatToken = "", tableId = "";

  it("建桌并就绪基线", async () => {
    ownerUserToken = ((await call("POST", "/api/users", { body: { name: "披露验证-建桌人" } })).data!.token) as string;
    const created = await call("POST", "/api/tables", {
      token: ownerUserToken,
      body: { topic: "披露级别验证", template: "review-collab", owner: { seatName: "提案席", agentLabel: "zcode" } },
    });
    tableId = created.data!.tableId;
    ownerSeatToken = created.data!.ownerSeatToken;
    expect(tableId).toBeTruthy();
  });

  it("席位通道：union 条目（对象 grant 三档 + 旧 string 混合）保存并原样回读", async () => {
    const r = await call("POST", `/api/tables/${tableId}/seat-config`, {
      token: ownerSeatToken,
      body: {
        stance: "测试立场", scope: "全部",
        dataScope: [
          { text: "packages/", grant: "read" },
          { text: "docs/", grant: "quote" },
          { text: "本桌全部产物", grant: "full" },
          "旧格式纯文本条目",
        ],
        ready: true,
      },
    });
    expect(r.ok).toBe(true);
    expect(r.data!.seat.config.dataScope).toEqual([
      { text: "packages/", grant: "read" },
      { text: "docs/", grant: "quote" },
      { text: "本桌全部产物", grant: "full" },
      "旧格式纯文本条目",
    ]);
    // 落库回读（防只改响应不落库）
    const t = await call("GET", `/api/tables/${tableId}`, { token: ownerSeatToken });
    const seat = t.data!.seats.find((s: any) => s.config?.dataScope?.length);
    expect(seat.config.dataScope[1]).toEqual({ text: "docs/", grant: "quote" });
  });

  it("席位通道：非法 grant 422", async () => {
    const r = await call("POST", `/api/tables/${tableId}/seat-config`, {
      token: ownerSeatToken,
      body: { stance: "测试立场", scope: "", dataScope: [{ text: "x", grant: "loud" }], ready: true },
    });
    expect(r.status).toBe(422);
    expect(r.error!.code).toBe("bad_payload");
  });

  it("网页通道（my/seat-config）：对象条目不被字符串化（parseDataScope 回归）", async () => {
    const r = await call("POST", `/api/tables/${tableId}/my/seat-config`, {
      token: ownerUserToken,
      body: {
        stance: "网页通道立场", scope: "全部",
        dataScope: [{ text: "docs/api/", grant: "quote" }, "混合旧格式"],
        ready: true,
      },
    });
    expect(r.ok).toBe(true);
    expect(r.data!.seat.config.dataScope).toEqual([{ text: "docs/api/", grant: "quote" }, "混合旧格式"]);
  });

  it("wire schema：SEAT_CONFIG payload 接受 union 条目、拒非法对象", () => {
    expect(is.seatConfig({ stance: "s", scope: "", dataScope: [{ text: "a", grant: "full" }], ready: true })).toBe(true);
    expect(is.seatConfig({ stance: "s", scope: "", dataScope: ["a"], ready: true })).toBe(true);
    expect(is.seatConfig({ stance: "s", scope: "", dataScope: [{ text: "a", grant: "loud" }], ready: true })).toBe(false);
    expect(is.seatConfig({ stance: "s", scope: "", dataScope: [{ text: "a" }], ready: true })).toBe(false);
  });

  it("skill 模板：身份红线与披露纪律文案就位", () => {
    expect(SKILL_MD).toContain("身份判定只认 user_id");
    expect(SKILL_MD).toContain("一律不按「己方/同一人」处理");
    expect(SKILL_MD).toContain("超出该条目披露级别的内容");
    expect(SKILL_MD).toContain("文件名+行号定位属 quote 级、逐字原文属 full 级");
    expect(SKILL_MD).toContain("read 仅概括、quote 可摘录片段与文件定位、full 可提供原文");
    expect(SKILL_MD).toContain("逐字引用数据范围内容超过约 10 行");
    expect(SKILL_MD).toContain("不拒答而降级");
  });

  it("观察页：披露级别表单/徽章/邀请引导/帮助文案就位", () => {
    expect(OBSERVER_HTML).toContain("DS_GRANT_LABEL");
    expect(OBSERVER_HTML).toContain("仅概括");
    expect(OBSERVER_HTML).toContain("可摘引");
    expect(OBSERVER_HTML).toContain("可原文");
    expect(OBSERVER_HTML).toContain("账号不同的各方即不同参与方");
    expect(OBSERVER_HTML).toContain("与本桌问询方是不同用户");
    expect(OBSERVER_HTML).toContain("账号即身份边界");
  });

  it("纪要数据范围序列化：对象条目标注披露级别，不再出现 [object Object]（任务 0043）", async () => {
    const admin = ((await call("POST", "/api/users", { body: { name: "纪要-admin" } })).data!.token) as string;
    hub.store.setUserRole(hub.store.findUserByToken(admin)!.userId, "systemadmin");
    const owner = ((await call("POST", "/api/users", { body: { name: "纪要-建桌人" } })).data!.token) as string;
    const created = await call("POST", "/api/tables", {
      token: owner, body: { topic: "纪要序列化桌", owner: { seatName: "A", agentLabel: "z" } },
    });
    const tid = created.data!.tableId;
    const seatTok = created.data!.ownerSeatToken;
    const rc = created.data!.inviteCodes.find((c: { role: string }) => c.role === "reviewer").code;
    const revUser = ((await call("POST", "/api/users", { body: { name: "纪要-评审" } })).data!.token) as string;
    const rj = await call("POST", `/api/tables/${tid}/seats`, {
      token: revUser, body: { inviteCode: rc, seatName: "B", role: "reviewer", agentLabel: "c" },
    });
    // 建桌人带混合条目（对象 + 旧字符串）就绪
    const cfg = await call("POST", `/api/tables/${tid}/seat-config`, {
      token: seatTok,
      body: { stance: "提案", scope: "全文", ready: true, dataScope: [{ text: "设计文档", grant: "quote" }, "旧格式条目"] },
    });
    expect(cfg.ok).toBe(true);
    await call("POST", `/api/tables/${tid}/seat-config`, { token: rj.data.token, body: { stance: "评审", ready: true } });
    await call("POST", `/api/tables/${tid}/start`, { token: seatTok });
    const closed = await call("POST", `/api/admin/tables/${tid}/close`, { token: admin, body: { reason: "验证纪要序列化" } });
    expect(closed.ok, JSON.stringify(closed.error)).toBe(true);
    const minutes = (await call("GET", `/api/tables/${tid}/poll?since=0&timeout=0`, { token: seatTok })).data!.messages
      .filter((m: { type: string }) => m.type === "MINUTES").at(-1);
    expect(minutes).toBeTruthy();
    expect(minutes.payload.markdown).not.toContain("[object Object]");
    expect(minutes.payload.markdown).toContain("设计文档（可摘录）");
    expect(minutes.payload.markdown).toContain("旧格式条目");
  });

  it("GET /api/styles 别名：返回风格预设（任务 0043）", async () => {
    const r = await call("GET", "/api/styles");
    expect(r.ok).toBe(true);
    expect(Array.isArray(r.data!.styles)).toBe(true);
    expect(r.data!.styles.length).toBeGreaterThan(0);
  });
});
