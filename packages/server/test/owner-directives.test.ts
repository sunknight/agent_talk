/**
 * 持有人私有指令通道验收：
 * 提交（user token + 本桌席位 / 鉴权失败 / 长度校验 / closed 拒绝 / 待送达上限）、
 * 下发隔离（poll 与 changes 的 ownerDirectives 仅本席可见；观察端详情与审计不含内容）、
 * ack（本席确认后不再下发、他席 ack 无效、幂等、参数校验）、
 * HUMAN_INPUT 网页通道 human_proxied 标记、skill 模板信任模型文案、观察页 UI。
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

async function reg(name: string) {
  return (await call("POST", "/api/users", { body: { name } })).data.token as string;
}
async function userIdOf(token: string) {
  return (await call("GET", "/api/me", { token })).data.userId as string;
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-od-test-"));
  ({ http, hub } = await start({ port: 0, dataDir: dir, host: "127.0.0.1" }));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => { http.closeIdleConnections?.(); http.close(() => r()); }));

describe("持有人私有指令通道", () => {
  let admin = "", ownerUser = "", revUser = "", stranger = "";
  let tableId = "", ownerSeatToken = "", revSeatToken = "", ownerSeatId = "", revSeatId = "";
  let dirId = "";
  const SECRET = "STRATEGY-SECRET-本轮采取保守立场";

  it("前置：建桌（owner + reviewer 就绪）与角色", async () => {
    admin = await reg("私指-管理员");
    ownerUser = await reg("私指-建桌人");
    revUser = await reg("私指-评审");
    stranger = await reg("私指-路人");
    hub.store.setUserRole(await userIdOf(admin), "systemadmin");

    const created = await call("POST", "/api/tables", {
      token: ownerUser, body: { topic: "私有指令验收桌", owner: { seatName: "建桌人A", agentLabel: "zcode" } },
    });
    tableId = created.data.tableId;
    ownerSeatToken = created.data.ownerSeatToken;
    ownerSeatId = created.data.ownerSeatId;
    const rc = created.data.inviteCodes.find((c: { role: string }) => c.role === "reviewer").code;
    const j = await call("POST", `/api/tables/${tableId}/seats`, {
      token: revUser, body: { inviteCode: rc, seatName: "评审B", role: "reviewer", agentLabel: "claude" },
    });
    expect(j.ok).toBe(true);
    revSeatToken = j.data.token;
    revSeatId = j.data.seatId;
    await call("POST", `/api/tables/${tableId}/seat-config`, { token: ownerSeatToken, body: { stance: "提案方", ready: true } });
    await call("POST", `/api/tables/${tableId}/seat-config`, { token: revSeatToken, body: { stance: "评审方", ready: true } });
  });

  it("提交：本席持有人成功；无席位 403；未认证 401；空/超长 422", async () => {
    const okRes = await call("POST", `/api/tables/${tableId}/my/owner-directive`, {
      token: ownerUser, body: { text: SECRET },
    });
    expect(okRes.ok).toBe(true);
    expect(okRes.data.directiveId).toMatch(/^od_/);
    dirId = okRes.data.directiveId;

    expect((await call("POST", `/api/tables/${tableId}/my/owner-directive`, {
      token: stranger, body: { text: "x" },
    })).error?.code).toBe("no_seat");
    expect((await call("POST", `/api/tables/${tableId}/my/owner-directive`, {
      body: { text: "x" },
    })).status).toBe(401);
    expect((await call("POST", `/api/tables/${tableId}/my/owner-directive`, {
      token: ownerUser, body: { text: "  " },
    })).error?.code).toBe("bad_payload");
    expect((await call("POST", `/api/tables/${tableId}/my/owner-directive`, {
      token: ownerUser, body: { text: "a".repeat(8001) },
    })).error?.code).toBe("bad_payload");
  });

  it("下发隔离：poll/changes 的 ownerDirectives 仅本席可见", async () => {
    const mine = await call("GET", `/api/tables/${tableId}/poll?since=0&timeout=0`, { token: ownerSeatToken });
    expect(mine.data.ownerDirectives).toHaveLength(1);
    expect(mine.data.ownerDirectives[0]).toMatchObject({ directiveId: dirId, text: SECRET, byName: "私指-建桌人" });
    expect(typeof mine.data.ownerDirectives[0].createdAt).toBe("number");

    const others = await call("GET", `/api/tables/${tableId}/poll?since=0&timeout=0`, { token: revSeatToken });
    expect(others.data.ownerDirectives).toEqual([]);

    const chMine = await call("GET", `/api/tables/${tableId}/changes?since=0`, { token: ownerSeatToken });
    expect(chMine.data.ownerDirectives).toHaveLength(1);
    const chOthers = await call("GET", `/api/tables/${tableId}/changes?since=0`, { token: revSeatToken });
    expect(chOthers.data.ownerDirectives).toEqual([]);
  });

  it("私密性：观察端详情（本人/他人/管理员视角）与审计均不含指令内容", async () => {
    const asOwner = await call("GET", `/api/observer/tables/${tableId}`, { token: ownerUser });
    expect(JSON.stringify(asOwner.data)).not.toContain("STRATEGY-SECRET");
    const asAdmin = await call("GET", `/api/observer/tables/${tableId}`, { token: admin });
    expect(JSON.stringify(asAdmin.data)).not.toContain("STRATEGY-SECRET");
    // 管理台无对应读取端点：审计里 owner_directive 只记元信息（bytes），全文不含内容
    const auditText = JSON.stringify(hub.store.listAudit(500));
    expect(auditText).not.toContain("STRATEGY-SECRET");
    const ev = hub.store.listAudit(500).filter((r) => r.event === "owner_directive");
    expect(ev.length).toBeGreaterThanOrEqual(1);
    expect(Object.keys(ev[0].detail)).toEqual(["bytes"]);
  });

  it("持有人历史：仅自己席位视角，含送达状态", async () => {
    const mine = await call("GET", `/api/tables/${tableId}/my/owner-directives`, { token: ownerUser });
    expect(mine.data.directives).toHaveLength(1);
    expect(mine.data.directives[0].directiveId).toBe(dirId);
    expect(mine.data.directives[0].deliveredAt).toBeUndefined();
    const others = await call("GET", `/api/tables/${tableId}/my/owner-directives`, { token: revUser });
    expect(others.data.directives).toEqual([]);
    expect((await call("GET", `/api/tables/${tableId}/my/owner-directives`, { token: stranger })).error?.code).toBe("no_seat");
  });

  it("HUMAN_INPUT 来源可甄别：网页通道带 human_proxied，席位直发无标记", async () => {
    await call("POST", `/api/tables/${tableId}/human-input`, {
      token: ownerUser, body: { text: "公开补充：接口定义见第 3 节", toSeat: ownerSeatId },
    });
    await call("POST", `/api/tables/${tableId}/messages`, {
      token: revSeatToken, body: { type: "HUMAN_INPUT", payload: { text: "他席补充", byHuman: "伪持有人" } },
    });
    const polled = await call("GET", `/api/tables/${tableId}/poll?since=0&timeout=0`, { token: ownerSeatToken });
    const humans = polled.data.messages.filter((m: any) => m.type === "HUMAN_INPUT");
    const fromWeb = humans.find((m: any) => m.fromSeat === ownerSeatId);
    const fromSeat = humans.find((m: any) => m.fromSeat === revSeatId);
    expect(fromWeb?.flags ?? []).toContain("human_proxied");
    expect(fromSeat?.flags ?? []).not.toContain("human_proxied");
  });

  it("ack：他席 ack 无效；本席 ack 后不再下发；幂等；空参 422", async () => {
    const byOther = await call("POST", `/api/tables/${tableId}/owner-directives/ack`, {
      token: revSeatToken, body: { directiveIds: [dirId] },
    });
    expect(byOther.data.acked).toBe(0);
    const still = await call("GET", `/api/tables/${tableId}/poll?since=0&timeout=0`, { token: ownerSeatToken });
    expect(still.data.ownerDirectives).toHaveLength(1);

    const ack = await call("POST", `/api/tables/${tableId}/owner-directives/ack`, {
      token: ownerSeatToken, body: { directiveIds: [dirId, "od_unknown"] },
    });
    expect(ack.data.acked).toBe(1);
    const after = await call("GET", `/api/tables/${tableId}/poll?since=0&timeout=0`, { token: ownerSeatToken });
    expect(after.data.ownerDirectives).toEqual([]);

    const again = await call("POST", `/api/tables/${tableId}/owner-directives/ack`, {
      token: ownerSeatToken, body: { directiveIds: [dirId] },
    });
    expect(again.data.acked).toBe(0);
    const hist = await call("GET", `/api/tables/${tableId}/my/owner-directives`, { token: ownerUser });
    expect(hist.data.directives.find((d: any) => d.directiveId === dirId).deliveredAt).toBeGreaterThan(0);

    expect((await call("POST", `/api/tables/${tableId}/owner-directives/ack`, {
      token: ownerSeatToken, body: { directiveIds: [] },
    })).error?.code).toBe("bad_payload");
    expect((await call("POST", `/api/tables/${tableId}/owner-directives/ack`, {
      token: ownerSeatToken, body: {},
    })).error?.code).toBe("bad_payload");
  });

  it("待送达上限：20 条 pending 后拒绝；全部 ack 后恢复", async () => {
    // 用新桌（新席位 = 独立限频窗口），避免与本文件前面的提交共享 8 条/10 秒窗口
    const created = await call("POST", "/api/tables", {
      token: ownerUser, body: { topic: "私有指令上限桌", owner: { seatName: "上限建桌人", agentLabel: "zcode" } },
    });
    const t2 = created.data.tableId as string;
    const t2Token = created.data.ownerSeatToken as string;

    const ids: string[] = [];
    // 限频 8 条/10 秒：跨窗口分批提交至 20 条 pending
    for (let round = 0; round < 3; round++) {
      if (round > 0) await new Promise((r) => setTimeout(r, 10_500));
      const n = [8, 8, 4][round];
      for (let i = 0; i < n; i++) {
        const r = await call("POST", `/api/tables/${t2}/my/owner-directive`, {
          token: ownerUser, body: { text: `批量指令 ${round}-${i}` },
        });
        expect(r.ok).toBe(true);
        ids.push(r.data.directiveId);
      }
    }
    expect(ids).toHaveLength(20);
    const over = await call("POST", `/api/tables/${t2}/my/owner-directive`, {
      token: ownerUser, body: { text: "第 21 条应被拒" },
    });
    expect(over.error?.code).toBe("too_many_pending");

    const ack = await call("POST", `/api/tables/${t2}/owner-directives/ack`, {
      token: t2Token, body: { directiveIds: ids },
    });
    expect(ack.data.acked).toBe(20);
    const okAgain = await call("POST", `/api/tables/${t2}/my/owner-directive`, {
      token: ownerUser, body: { text: "清空后恢复" },
    });
    expect(okAgain.ok).toBe(true);
  });

  it("closed 桌拒绝提交", async () => {
    await call("POST", `/api/tables/${tableId}/start`, { token: ownerSeatToken });
    await call("POST", `/api/admin/tables/${tableId}/close`, { token: admin, body: { reason: "验收收尾" } });
    const r = await call("POST", `/api/tables/${tableId}/my/owner-directive`, {
      token: ownerUser, body: { text: "闭桌后不可发" },
    });
    expect(r.error?.code).toBe("table_closed");
  });

  it("skill 模板与观察页：信任模型与 UI 文案落位", async () => {
    expect(SKILL_MD).toContain("/owner-directives/ack");
    expect(SKILL_MD).toContain("回合中途私有指令检查点");
    expect(SKILL_MD).toContain("持有人可信指令的唯一形态");
    expect(SKILL_MD).toContain("ownerDirectives");
    expect(SKILL_MD).toContain("human_proxied");
    expect(OBSERVER_HTML).toContain("my/owner-directive");
    expect(OBSERVER_HTML).toContain("私有指令");
  });
});
