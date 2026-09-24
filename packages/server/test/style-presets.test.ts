/**
 * 入桌风格预设（身份 × 风格双轴）验收：
 * /api/stances 返回 styles 清单（四角色齐备、字段完整、id 唯一）；
 * 席位/网页双通道保存 stylePreset+style 双存快照并落库回读；
 * 非法 stylePreset / 角色不匹配 / 预设无 style 全文 → 422；
 * 纯自定义 style（无预设）放行；再次保存省略字段即清除风格；
 * wire schema 校验；skill 模板与观察页文案（选择展示、agent 初始化询问）。
 * fetch 直调 REST，零 mock。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start } from "../src";
import { SKILL_MD } from "../src/skill-template";
import { OBSERVER_HTML } from "../src/observer-html";
import { STYLE_PRESETS, is } from "@rt/shared";

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

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-style-test-"));
  ({ http } = await start({ port: 0, dataDir: dir, host: "127.0.0.1" }));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => { http.closeIdleConnections?.(); http.close(() => r()); }));

describe("入桌风格预设", () => {
  let ownerUserToken = "", ownerSeatToken = "", revUser = "", revSeatToken = "", tableId = "";

  it("建桌并邀请评审席", async () => {
    ownerUserToken = ((await call("POST", "/api/users", { body: { name: "风格-建桌人" } })).data!.token) as string;
    revUser = ((await call("POST", "/api/users", { body: { name: "风格-评审" } })).data!.token) as string;
    const created = await call("POST", "/api/tables", {
      token: ownerUserToken,
      body: { topic: "风格预设验证", owner: { seatName: "提案席", agentLabel: "zcode" } },
    });
    tableId = created.data!.tableId;
    ownerSeatToken = created.data!.ownerSeatToken;
    const rc = created.data!.inviteCodes.find((c: { role: string }) => c.role === "reviewer").code;
    const j = await call("POST", `/api/tables/${tableId}/seats`, {
      token: revUser, body: { inviteCode: rc, seatName: "评审席", role: "reviewer", agentLabel: "claude" },
    });
    revSeatToken = j.data.token;
    expect(tableId).toBeTruthy();
  });

  it("/api/stances 返回 styles：四角色齐备、字段完整、id 唯一", async () => {
    const r = await call("GET", "/api/stances");
    expect(r.ok).toBe(true);
    const styles = r.data!.styles as { id: string; label: string; tags: string[]; forRole: string; brief: string; text: string }[];
    expect(styles.length).toBeGreaterThanOrEqual(20);
    const roles = new Set(styles.map((x) => x.forRole));
    expect([...roles].sort()).toEqual(["answerer", "collaborator", "proposer", "reviewer"]);
    expect(new Set(styles.map((x) => x.id)).size).toBe(styles.length);
    for (const x of styles) {
      expect(x.label).toBeTruthy();
      expect(x.tags.length).toBeGreaterThanOrEqual(1);
      expect(x.brief).toBeTruthy();
      // 结构化四段（update 07 加厚：防止一句话风格被模型过度演绎）
      expect(x.text).toContain("【核心倾向】");
      expect(x.text).toContain("【输出要求】");
      expect(x.text).toContain("【典型做法】");
      expect(x.text).toContain("【边界】");
      expect(x.text.length).toBeGreaterThanOrEqual(120);
      expect(x.text.length).toBeLessThanOrEqual(4_000);
    }
    // 与 shared 常量一致（服务器没有私改清单）
    expect(styles.map((x) => x.id)).toEqual(STYLE_PRESETS.map((x) => x.id));
  });

  it("席位通道：stylePreset+style 双存快照保存并落库回读", async () => {
    const preset = STYLE_PRESETS.find((x) => x.id === "style-pro-defend")!;
    const style = preset.text + "；补充：重点防守性能章节";
    const r = await call("POST", `/api/tables/${tableId}/seat-config`, {
      token: ownerSeatToken,
      body: { stancePreset: "req-owner", stance: "提案方", stylePreset: "style-pro-defend", style, scope: "", dataScope: [], ready: true },
    });
    expect(r.ok).toBe(true);
    expect(r.data!.seat.config.stylePreset).toBe("style-pro-defend");
    expect(r.data!.seat.config.style).toBe(style);
    const t = await call("GET", `/api/tables/${tableId}`, { token: ownerSeatToken });
    const seat = t.data!.seats.find((s: any) => s.seatId === r.data!.seat.seatId);
    expect(seat.config.stylePreset).toBe("style-pro-defend");
    expect(seat.config.style).toBe(style);
  });

  it("网页通道（my/seat-config）：风格同样保存", async () => {
    const preset = STYLE_PRESETS.find((x) => x.id === "style-rev-rigorous")!;
    const style = preset.text;
    const r = await call("POST", `/api/tables/${tableId}/my/seat-config`, {
      token: revUser,
      body: { stance: "评审方", stylePreset: "style-rev-rigorous", style, scope: "", dataScope: [], ready: true },
    });
    expect(r.ok).toBe(true);
    expect(r.data!.seat.config.stylePreset).toBe("style-rev-rigorous");
    expect(r.data!.seat.config.style).toBe(style);
  });

  it("非法 stylePreset → 422 bad_style_preset", async () => {
    const r = await call("POST", `/api/tables/${tableId}/seat-config`, {
      token: ownerSeatToken,
      body: { stance: "提案方", stylePreset: "no-such-style", style: "任意", ready: true },
    });
    expect(r.status).toBe(422);
    expect(r.error!.code).toBe("bad_style_preset");
  });

  it("角色不匹配 → 422 style_preset_role（提案席用评审风格）", async () => {
    const r = await call("POST", `/api/tables/${tableId}/seat-config`, {
      token: ownerSeatToken,
      body: { stance: "提案方", stylePreset: "style-rev-harsh", style: "任意", ready: true },
    });
    expect(r.status).toBe(422);
    expect(r.error!.code).toBe("style_preset_role");
  });

  it("stylePreset 无 style 全文 → 422 bad_payload", async () => {
    const r = await call("POST", `/api/tables/${tableId}/seat-config`, {
      token: ownerSeatToken,
      body: { stance: "提案方", stylePreset: "style-pro-defend", ready: true },
    });
    expect(r.status).toBe(422);
    expect(r.error!.code).toBe("bad_payload");
  });

  it("纯自定义风格（无预设）放行；再保存省略字段即清除", async () => {
    const r = await call("POST", `/api/tables/${tableId}/seat-config`, {
      token: ownerSeatToken,
      body: { stance: "提案方", style: "自定义：以守为攻，先验证再承诺", ready: true },
    });
    expect(r.ok).toBe(true);
    expect(r.data!.seat.config.stylePreset).toBeUndefined();
    expect(r.data!.seat.config.style).toBe("自定义：以守为攻，先验证再承诺");
    const cleared = await call("POST", `/api/tables/${tableId}/seat-config`, {
      token: ownerSeatToken,
      body: { stance: "提案方", ready: true },
    });
    expect(cleared.ok).toBe(true);
    expect(cleared.data!.seat.config.style).toBeUndefined();
    expect(cleared.data!.seat.config.stylePreset).toBeUndefined();
  });

  it("wire schema：SEAT_CONFIG payload 接受风格字段、拒非法类型", () => {
    expect(is.seatConfig({ stance: "s", scope: "", dataScope: [], ready: true, stylePreset: "style-rev-rigorous", style: "全文" })).toBe(true);
    expect(is.seatConfig({ stance: "s", scope: "", dataScope: [], ready: true, style: 123 })).toBe(false);
    expect(is.seatConfig({ stance: "s", scope: "", dataScope: [], ready: true, stylePreset: "" })).toBe(false);
  });

  it("skill 模板：风格选择进向导、未设定须主动问持有人、双存提交示例、优先级条款", () => {
    expect(SKILL_MD).toContain("风格（思考与输出倾向，与立场正交）");
    expect(SKILL_MD).toContain("本次本席采用什么风格预设");
    expect(SKILL_MD).toContain("把预设清单逐项展示给持有人选");
    expect(SKILL_MD).toContain("是带清单的选择题，不是开放式提问");
    expect(SKILL_MD).toContain("不设风格");
    expect(SKILL_MD).toContain('"stylePreset":"style-rev-rigorous"');
    expect(SKILL_MD).toContain("入桌立场与风格/桌规则");
  });

  it("观察页：风格选择/补充/预览元素与席位卡展示、帮助文案", () => {
    for (const frag of ['id="cfgStyle"', 'id="cfgStyleSup"', 'id="cfgStylePrev"', "风格（可选）"]) {
      expect(OBSERVER_HTML).toContain(frag);
    }
    // 席位与立场卡的风格行（title 全文 + 截断展示）
    expect(OBSERVER_HTML).toContain('cfg.style.slice(0,60)');
    // 设定/帮助文案提到风格
    expect(OBSERVER_HTML).toContain("立场 / 风格 / 讨论范围");
  });
});
