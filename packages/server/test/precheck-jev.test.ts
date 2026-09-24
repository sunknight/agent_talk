/**
 * Jev（OpenRouter Decisions API）分层预审单元（方案 A）：
 * 判定（noul）与点名（choice）一次调用；redirect 说明由 DeepSeek 生成（失败退按档模板）；
 * fail-open（任何判定失败 skipped 放行）；resolvePrecheck 按 PRECHECK_PROVIDER 选路。
 * 全程 mock fetch，不发真实网络请求。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deepseekPrecheck, jevPrecheck, resolvePrecheck, type PrecheckInput } from "../src";

const input = (): PrecheckInput => ({
  table: { topic: "方案评审", goals: "达成共识", deliverables: "", rules: "must 意见必须处置", rolePlan: "", sharedDocs: [] },
  seat: { name: "Alice", role: "proposer", stance: "", scope: "" },
  submission: { msgId: "m1", type: "STATEMENT", payload: { text: "提案陈述：见产物 v1。" } },
  history: [],
  participants: [
    { seatId: "seat_a", name: "Alice", role: "proposer" },
    { seatId: "seat_b", name: "Bob", role: "reviewer" },
  ],
});

const decisionsOk = (answers: unknown) => new Response(
  JSON.stringify({ model: "~typesafe/jev-latest", answers, usage: { input_tokens: 10, output_tokens: 0 } }),
  { status: 200 },
);
const chatOk = (content: string) => new Response(
  JSON.stringify({ choices: [{ message: { content } }] }),
  { status: 200 },
);

/** 可配置响应 + 恒定记录的 fetch mock（decisions 路径 / chat 说明路径分流） */
let calls: { url: string; body: any }[];
let decisionsAnswers: unknown;
let decisionsStatus: number;
let chatResponse: (() => Response) | null; // null = 说明路径一律 500（未预期的调用）

beforeEach(() => {
  calls = [];
  decisionsAnswers = {};
  decisionsStatus = 200;
  chatResponse = null;
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: { body?: string }) => {
    const u = String(url);
    calls.push({ url: u, body: init?.body ? JSON.parse(init.body) : undefined });
    if (u.includes("chat/completions")) return chatResponse ? chatResponse() : new Response("unexpected chat call", { status: 500 });
    if (decisionsStatus !== 200) return new Response("err", { status: decisionsStatus });
    return decisionsOk(decisionsAnswers);
  }));
  const envKeys = ["OPENROUTER_API_KEY", "DEEPSEEK_API_KEY", "PRECHECK_PROVIDER", "PRECHECK_TIMEOUT_MS"] as const;
  for (const k of envKeys) (envStore as any)[k] = process.env[k];
  process.env.OPENROUTER_API_KEY = "test-or-key";
  process.env.PRECHECK_TIMEOUT_MS = "2000";
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.PRECHECK_PROVIDER;
});
const envStore: Record<string, string | undefined> = {};
afterEach(() => {
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(envStore)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("jevPrecheck：判定与点名（OpenRouter Decisions API）", () => {
  it("未配置 OPENROUTER_API_KEY → skipped 放行，不发起任何调用", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const out = await jevPrecheck(input());
    expect(out.verdict).toBe("skipped");
    expect(out.by).toBe("skipped");
    expect(out.note).toContain("未配置");
    expect(calls.length).toBe(0);
  });

  it("合格（noul≥0.5）→ pass：单次调用出三问，无需说明生成", async () => {
    decisionsAnswers = {
      qualified: { type: "noul", noul: 0.93 },
      target: { type: "choice", choice: "seat_a", probabilities: {}, confidence: 1 },
      severity: { type: "score", score: 0.1, probabilities: {}, confidence: 1 },
    };
    const out = await jevPrecheck(input());
    expect(out).toMatchObject({ verdict: "pass", by: "jev", issues: [] });
    expect(out.note).toContain("0.93");
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(calls[0].body.model).toBe("~typesafe/jev-latest");
    expect(calls[0].body.state.submitter.name).toBe("Alice");
    expect(calls[0].body.questions.qualified.type).toBe("noul");
    expect(calls[0].body.questions.severity.type).toBe("score");
    expect(calls[0].body.questions.target.type).toBe("choice");
    expect(Object.keys(calls[0].body.questions.target.criteria)).toEqual(["seat_a", "seat_b"]);
  });

  it("不合格 → redirect：Jev 点名 + DeepSeek 在已判定前提下生成说明（jev+deepseek）", async () => {
    process.env.DEEPSEEK_API_KEY = "test-ds-key";
    decisionsAnswers = { qualified: { type: "noul", noul: 0.12 }, target: { type: "choice", choice: "seat_b" }, severity: { type: "score", score: 2.0 } };
    chatResponse = () => chatOk('{"issues":[{"severity":"must","comment":"缺具体依据，请定位到产物章节"},{"severity":"should","comment":"未逐条回应目标"}],"note":"需补充"}');
    const out = await jevPrecheck(input());
    expect(out.verdict).toBe("redirect");
    expect(out.targetSeatId).toBe("seat_b");
    expect(out.by).toBe("jev+deepseek");
    expect(out.issues).toHaveLength(2);
    expect(out.issues[0]).toMatchObject({ severity: "must", comment: "缺具体依据，请定位到产物章节" });
    expect(out.note).toBe("需补充");
    expect(calls.length).toBe(2);
    expect(calls[1].url).toContain("chat/completions");
    expect(calls[1].body.messages[0].content).toContain("已判定");
    expect(calls[1].body.messages[1].content).toContain("seat_b");
  });

  it("不合格且未配置 DeepSeek → 按档模板说明（jev），严重度取自 score 就近档", async () => {
    decisionsAnswers = {
      qualified: { type: "noul", noul: 0.2 },
      target: { type: "choice", choice: "seat_a" },
      severity: { type: "score", score: 1.9 },
    };
    const out = await jevPrecheck(input());
    expect(out.verdict).toBe("redirect");
    expect(out.by).toBe("jev");
    expect(calls.length).toBe(1); // 只有判定调用，未发说明请求
    expect(out.issues).toHaveLength(1);
    expect(out.issues[0].severity).toBe("must");
    expect(out.issues[0].comment.length).toBeGreaterThan(0);
  });

  it("说明生成失败（DeepSeek HTTP 500）→ 模板回退，判定维持 redirect；严重度缺省 should", async () => {
    process.env.DEEPSEEK_API_KEY = "test-ds-key";
    decisionsAnswers = { qualified: { type: "noul", noul: 0.3 }, target: { type: "choice", choice: "seat_a" } };
    chatResponse = () => new Response("boom", { status: 500 });
    const out = await jevPrecheck(input());
    expect(out.verdict).toBe("redirect");
    expect(out.by).toBe("jev");
    expect(out.issues[0].severity).toBe("should");
    expect(calls.length).toBe(2);
  });

  it("判定调用失败（HTTP 500）→ skipped 放行（fail-open）", async () => {
    decisionsStatus = 500;
    const out = await jevPrecheck(input());
    expect(out.verdict).toBe("skipped");
    expect(out.note).toContain("HTTP 500");
  });

  it("判定应答缺 qualified → skipped 放行", async () => {
    decisionsAnswers = { target: { type: "choice", choice: "seat_a" } };
    const out = await jevPrecheck(input());
    expect(out.verdict).toBe("skipped");
    expect(out.note).toContain("缺合格判定");
  });

  it("无可点名席位（participants 空）→ 不问 target，判定需补充时放行+标注", async () => {
    const i = input();
    i.participants = [];
    decisionsAnswers = { qualified: { type: "noul", noul: 0.1 } };
    const out = await jevPrecheck(i);
    expect(calls[0].body.questions.target).toBeUndefined();
    expect(out.verdict).toBe("pass");
    expect(out.note).toContain("点名");
  });

  it("点名目标不在候选席位内 → 放行+标注（等价引擎侧降级）", async () => {
    decisionsAnswers = { qualified: { type: "noul", noul: 0.1 }, target: { type: "choice", choice: "seat_x" } };
    const out = await jevPrecheck(input());
    expect(out.verdict).toBe("pass");
    expect(out.note).toContain("点名对象");
  });
});

describe("resolvePrecheck：PRECHECK_PROVIDER 选路", () => {
  it("jev → jevPrecheck；缺省与其他值 → deepseekPrecheck", () => {
    expect(resolvePrecheck()).toBe(deepseekPrecheck);
    process.env.PRECHECK_PROVIDER = "deepseek";
    expect(resolvePrecheck()).toBe(deepseekPrecheck);
    process.env.PRECHECK_PROVIDER = "jev";
    expect(resolvePrecheck()).toBe(jevPrecheck);
  });
});
