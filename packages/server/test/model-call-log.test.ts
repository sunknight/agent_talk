/**
 * 预审模型调用日志（model_call_logs）端到端：
 * Hub 构造器接线 postJson 层 logger → Store 落库；jev/deepseek 两路的每次调用
 * 完整记录时间/桌id/提交与返回报文/token 用量/耗时/状态；网络异常 status=0；随桌删除连带清理。
 * mock fetch，不发真实网络请求。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub, Store, deepseekPrecheck, jevPrecheck, type PrecheckInput } from "../src";

const input = (tableId?: string): PrecheckInput => ({
  ...(tableId ? { tableId } : {}),
  table: { topic: "方案评审", goals: "", deliverables: "", rules: "must 意见必须处置", rolePlan: "", sharedDocs: [] },
  seat: { name: "Alice", role: "proposer", stance: "", scope: "" },
  submission: { msgId: "m1", type: "STATEMENT", payload: { text: "提案陈述。" } },
  history: [],
  participants: [{ seatId: "seat_a", name: "Alice", role: "proposer" }],
});

const decisionsOk = (answers: unknown) => new Response(
  JSON.stringify({ model: "~typesafe/jev-latest", answers, usage: { input_tokens: 10, output_tokens: 0 } }),
  { status: 200 },
);
const chatOk = (content: string) => new Response(
  JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 25, completion_tokens: 80, total_tokens: 105 } }),
  { status: 200 },
);

let store: Store;
let hub: Hub;
const envKeys = ["OPENROUTER_API_KEY", "DEEPSEEK_API_KEY", "PRECHECK_TIMEOUT_MS"] as const;
const envBefore: Record<string, string | undefined> = {};
let fetchMock: ReturnType<typeof vi.fn>;

beforeAll(() => {
  store = new Store(mkdtempSync(join(tmpdir(), "rt-mcall-")));
  hub = new Hub(store); // 构造器接线 setModelCallLogger → store.saveModelCallLog
  for (const k of envKeys) envBefore[k] = process.env[k];
  process.env.OPENROUTER_API_KEY = "test-or-key";
  process.env.DEEPSEEK_API_KEY = "test-ds-key";
  process.env.PRECHECK_TIMEOUT_MS = "2000";
  fetchMock = vi.fn(async () => decisionsOk({}));
  vi.stubGlobal("fetch", fetchMock);
});
afterAll(() => {
  vi.unstubAllGlobals();
  for (const k of envKeys) {
    if (envBefore[k] === undefined) delete process.env[k];
    else process.env[k] = envBefore[k];
  }
  store.close();
});

describe("model_call_logs：完整调用审计", () => {
  it("deepseek 判定调用：完整报文/用量/时间/桌id 落库", async () => {
    expect(hub).toBeInstanceOf(Hub); // 构造器已接线 logger → 本 store
    fetchMock.mockImplementation(async () => chatOk('{"verdict":"pass","issues":[],"note":"ok"}'));
    const out = await deepseekPrecheck(input("tbl_log_1"));
    expect(out.verdict).toBe("pass");
    const logs = store.getModelCallLogs("tbl_log_1");
    expect(logs).toHaveLength(1);
    const log = logs[0];
    expect(log.provider).toBe("deepseek");
    expect(log.purpose).toBe("precheck");
    expect(log.model).toBe("deepseek-chat");
    expect(log.status).toBe(200);
    expect(log.ok).toBe(true);
    expect(log.durationMs).toBeGreaterThanOrEqual(0);
    expect(new Date(log.time).getTime()).toBeGreaterThan(0); // 可读时间
    expect(log.ts).toBeGreaterThan(0);
    // usage 归一化：deepseek prompt/completion → input/output
    expect(log.usage).toEqual({ inputTokens: 25, outputTokens: 80 });
    // 完整提交报文与返回报文
    expect((log.request as { messages: { role: string }[] }).messages[0].role).toBe("system");
    expect((log.response as { choices: { message: { content: string } }[] }).choices[0].message.content).toContain('"verdict":"pass"');
  });

  it("jev 分层 redirect：判定（jev）与说明生成（deepseek·explain）各记一条", async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      if (String(url).includes("chat/completions")) {
        return chatOk('{"issues":[{"severity":"must","comment":"缺依据"}],"note":"需补充"}');
      }
      return decisionsOk({ qualified: { type: "noul", noul: 0.12 }, target: { type: "choice", choice: "seat_a" }, severity: { type: "score", score: 2.0 } });
    });
    const out = await jevPrecheck(input("tbl_log_2"));
    expect(out.by).toBe("jev+deepseek");
    const logs = store.getModelCallLogs("tbl_log_2");
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ provider: "jev", purpose: "precheck", status: 200, tableId: "tbl_log_2" });
    expect(logs[0].usage).toEqual({ inputTokens: 10, outputTokens: 0 });
    expect((logs[0].request as { questions: Record<string, { type: string }> }).questions.qualified.type).toBe("noul");
    expect((logs[0].response as { answers: { qualified: { noul: number } } }).answers.qualified.noul).toBeCloseTo(0.12);
    expect(logs[1]).toMatchObject({ provider: "deepseek", purpose: "explain", status: 200 });
    expect((logs[1].request as { messages: { role: string; content: string }[] }).messages[0].content).toContain("已判定");
  });

  it("HTTP 错误：status 与响应文本入库，ok=false", async () => {
    fetchMock.mockImplementation(async () => new Response("upstream err", { status: 502 }));
    const out = await jevPrecheck(input("tbl_log_3"));
    expect(out.verdict).toBe("skipped");
    const log = store.getModelCallLogs("tbl_log_3")[0];
    expect(log.status).toBe(502);
    expect(log.ok).toBe(false);
    expect(log.response).toBe("upstream err");
    expect(log.usage).toBeUndefined();
  });

  it("网络异常：status=0 记 error，预审仍 fail-open 放行", async () => {
    fetchMock.mockImplementation(async () => { throw new Error("boom network"); });
    const out = await jevPrecheck(input("tbl_log_4"));
    expect(out.verdict).toBe("skipped");
    const log = store.getModelCallLogs("tbl_log_4")[0];
    expect(log.status).toBe(0);
    expect(log.ok).toBe(false);
    expect(log.error).toContain("boom");
    expect(log.response).toBeUndefined();
  });

  it("无 tableId 的调用也入库（仅全量可见）", async () => {
    fetchMock.mockImplementation(async () => decisionsOk({ qualified: { type: "noul", noul: 0.9 } }));
    const out = await jevPrecheck(input());
    expect(out.verdict).toBe("pass");
    const log = store.getModelCallLogs().at(-1)!;
    expect(log.tableId).toBeUndefined();
    expect(log.provider).toBe("jev");
  });

  it("删除圆桌连带清理其调用日志", async () => {
    store.saveModelCallLog({
      ts: Date.now(), time: new Date().toISOString(), provider: "jev", purpose: "precheck",
      tableId: "tbl_log_gone", model: "~typesafe/jev-latest", url: "https://openrouter.ai/api/alpha/decisions",
      status: 200, ok: true, durationMs: 5, request: {},
    });
    expect(store.getModelCallLogs("tbl_log_gone")).toHaveLength(1);
    store.deleteTable("tbl_log_gone");
    expect(store.getModelCallLogs("tbl_log_gone")).toHaveLength(0);
    expect(store.getModelCallLogs().some((l) => l.tableId === "tbl_log_gone")).toBe(false);
  });
});
