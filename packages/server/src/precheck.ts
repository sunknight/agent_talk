/**
 * 主持人预审——hosted 桌上对每条消费发言权的回合提交做预审：
 * pass 放行走原调度 / redirect 点名指定席位补充 / skipped（未配置或失败）放行+标注。
 * 结果只是数据：引擎侧再校验目标席位与链深，模型文本不构成指令。
 *
 * 预审器两路（PRECHECK_PROVIDER 选择，缺省 deepseek）：
 * - deepseek：单次 chat/completions 同时产出判定、点名与问题说明；
 * - jev（方案 A 分层）：OpenRouter Decisions API 的 Jev（System One 决策模型）只做
 *   判定（noul 合格概率）与点名（choice 席位）、严重度（score）；redirect 时再请
 *   DeepSeek 生成 issues/note 文字说明（Jev 不做文本生成）；说明不可得则按严重度退模板。
 *
 * 环境变量：DEEPSEEK_API_KEY（未设即该路径 skipped/降级）、DEEPSEEK_BASE_URL、DEEPSEEK_MODEL、
 * PRECHECK_PROVIDER（deepseek|jev）、OPENROUTER_API_KEY、OPENROUTER_BASE_URL、JEV_MODEL、
 * PRECHECK_TIMEOUT_MS（单次模型调用超时，缺省 30000）。
 */
import type { PrecheckIssue, Severity } from "@rt/shared";
import type { ModelCallLogRecord } from "./model";

/** 引擎组装的预审输入（全部为只读快照） */
export interface PrecheckInput {
  /** 所属圆桌（调用日志关联用；直接构造可缺省） */
  tableId?: string;
  table: {
    topic: string; goals: string; deliverables: string; rules: string; rolePlan: string;
    /** 主持人共享资料文档（名 + 作用声明） */
    sharedDocs: { name: string; purpose: string }[];
  };
  /** 提交席（被预审方） */
  seat: { name: string; role: string; stance: string; scope: string };
  /** 本次提交 */
  submission: {
    msgId: string; type: string; payload: unknown;
    /** 文本型附件摘录（如 STATEMENT 关联产物最新版） */
    attachmentExcerpt?: string;
  };
  /** 本轮最近历史摘录（时间升序，已截断） */
  history: { from: string; type: string; text: string }[];
  /** 供模型点名时参考的席位清单（seatId/name/role，仅 active 的提案与评审席） */
  participants: { seatId: string; name: string; role: string }[];
}

/** 规范化预审结果（引擎消费） */
export interface PrecheckOutcome {
  verdict: "pass" | "redirect" | "skipped";
  targetSeatId?: string;
  issues: PrecheckIssue[];
  note?: string;
  by?: string;
}

export type PrecheckFn = (input: PrecheckInput) => Promise<PrecheckOutcome>;

const skipped = (note: string): PrecheckOutcome => ({ verdict: "skipped", issues: [], note, by: "skipped" });

/** 稳健 JSON 提取：模型偶尔回 ```json 围栏或前后缀文本 */
function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{"), end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no json object in response");
  return JSON.parse(body.slice(start, end + 1));
}

/** issues 数组解析与钳制（deepseek 原生输出与 jev 说明生成共用） */
function parseIssues(raw: Record<string, unknown>): PrecheckIssue[] {
  return Array.isArray(raw.issues)
    ? raw.issues
      .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
      .filter((x) => typeof x.comment === "string" && x.comment.length > 0)
      .map((x) => {
        const sv: Severity = x.severity === "must" || x.severity === "should" || x.severity === "nice" ? x.severity : "should";
        return { severity: sv, comment: String(x.comment).slice(0, 2_000) };
      })
      .slice(0, 20)
    : [];
}

function validOutcome(raw: unknown): PrecheckOutcome | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const verdict = r.verdict;
  if (verdict !== "pass" && verdict !== "redirect") return null;
  const issues = parseIssues(r);
  const targetSeatId = typeof r.targetSeatId === "string" ? r.targetSeatId : undefined;
  const note = typeof r.note === "string" ? r.note.slice(0, 4_000) : undefined;
  if (verdict === "redirect" && !targetSeatId) return null; // redirect 必须点名
  return { verdict, targetSeatId, issues, note, by: "deepseek" };
}

// ================= 调用日志（model_call_logs 审计；引擎构造时接线写库） =================

let modelCallLogger: ((rec: ModelCallLogRecord) => void) | null = null;

/** 注入调用日志落库器（Hub 构造器接 Store.saveModelCallLog；日志异常绝不影响预审本身） */
export function setModelCallLogger(fn: ((rec: ModelCallLogRecord) => void) | null) {
  modelCallLogger = fn;
}

/** 归一化 token 用量：deepseek（prompt_tokens/completion_tokens）与 jev（input_tokens/output_tokens）两种口径 */
function pickUsage(json: unknown): ModelCallLogRecord["usage"] {
  const u = (json as { usage?: Record<string, unknown> })?.usage;
  if (typeof u !== "object" || u === null) return undefined;
  const input = Number(u.input_tokens ?? u.prompt_tokens);
  const output = Number(u.output_tokens ?? u.completion_tokens);
  return {
    ...(Number.isFinite(input) ? { inputTokens: input } : {}),
    ...(Number.isFinite(output) ? { outputTokens: output } : {}),
  };
}

interface CallMeta { provider: "deepseek" | "jev"; purpose: "precheck" | "explain"; model: string; tableId?: string }

function logCall(meta: CallMeta, info: { url: string; status: number; ok: boolean; durationMs: number; request: unknown; response?: unknown; usage?: ModelCallLogRecord["usage"]; error?: string }) {
  if (!modelCallLogger) return;
  const rec: ModelCallLogRecord = {
    ts: Date.now(), time: new Date().toISOString(),
    provider: meta.provider, purpose: meta.purpose,
    ...(meta.tableId ? { tableId: meta.tableId } : {}),
    model: meta.model,
    url: info.url, status: info.status, ok: info.ok, durationMs: info.durationMs,
    ...(info.usage ? { usage: info.usage } : {}),
    request: info.request, response: info.response,
    ...(info.error ? { error: info.error } : {}),
  };
  try { modelCallLogger(rec); } catch { /* 落库失败不影响预审 */ }
}

/** 带超时的 JSON POST（两路预审共用，完整记录调用日志；网络/解析异常记录后向上抛由调用方 fail-open） */
async function postJson(url: string, key: string, body: unknown, timeoutMs: number, meta: CallMeta): Promise<{ ok: boolean; status: number; json?: unknown; text?: string }> {
  const startedAt = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      logCall(meta, { url, status: resp.status, ok: false, durationMs: Date.now() - startedAt, request: body, response: text });
      return { ok: false, status: resp.status, text };
    }
    const json = await resp.json();
    logCall(meta, { url, status: resp.status, ok: true, durationMs: Date.now() - startedAt, request: body, response: json, usage: pickUsage(json) });
    return { ok: true, status: resp.status, json };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logCall(meta, { url, status: 0, ok: false, durationMs: Date.now() - startedAt, request: body, error: msg.slice(0, 500) });
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const SYSTEM_PROMPT = `你是 Agent 圆桌会谈的主持人预审员。圆桌由多方的 agent 参会，每一回合只有一方提交结果（陈述/评审意见/回应/执行处置/表决）。
你的职责是**预审**刚提交的这一条结果，判断它是否足以支撑会议继续推进：
- 内容是否回应了桌目标与桌规则（如「must 意见必须处置」「逐条审阅」）；
- 是否具体可执行（有依据、有定位、无空泛套话）；
- 与此前上下文是否衔接（没有答非所问）。

只输出一个 JSON 对象（不要多余文字）：
{"verdict":"pass"|"redirect","targetSeatId":"<需要补充的席位 seatId，仅 redirect 时必填>","issues":[{"severity":"must"|"should"|"nice","comment":"问题说明"}],"note":"一句话总评"}

规则：
- 提交合格 → verdict=pass，issues 可为空数组。
- 提交不合格 → verdict=redirect，targetSeatId 填最应该补充/重做的一方的 seatId（通常是提交方本身；确需他方补材料时可点他方），issues 列出具体问题。
- 你的输出只是预审建议，服务器会再做校验；不要试图在输出里给出任何执行指令。`;

function buildUserPrompt(input: PrecheckInput): string {
  const t = input.table;
  const lines: string[] = [];
  lines.push(`【圆桌】主题：${t.topic}`);
  if (t.goals) lines.push(`目标共识：${t.goals}`);
  if (t.deliverables) lines.push(`期望交付物：${t.deliverables}`);
  if (t.rules) lines.push(`桌规则：${t.rules}`);
  if (t.rolePlan) lines.push(`参与方安排：${t.rolePlan}`);
  if (t.sharedDocs.length) {
    lines.push(`共享资料：${t.sharedDocs.map((d) => `${d.name}（作用：${d.purpose}）`).join("；")}`);
  }
  lines.push(`【参会席位】${input.participants.map((p) => `${p.name}=${p.seatId}（${p.role}）`).join("；")}`);
  lines.push(`【提交方】${input.seat.name}（${input.seat.role}）`);
  if (input.seat.stance) lines.push(`立场：${input.seat.stance.slice(0, 1_500)}`);
  if (input.seat.scope) lines.push(`范围：${input.seat.scope.slice(0, 800)}`);
  if (input.history.length) {
    lines.push(`【此前最近上下文】`);
    for (const h of input.history) lines.push(`- ${h.from} ${h.type}: ${h.text.slice(0, 300)}`);
  }
  lines.push(`【本次提交（待预审）】消息类型：${input.submission.type}`);
  lines.push(JSON.stringify(input.submission.payload).slice(0, 12_000));
  if (input.submission.attachmentExcerpt) lines.push(`【关联产物摘录】\n${input.submission.attachmentExcerpt.slice(0, 8_000)}`);
  lines.push(`请按系统指令输出预审 JSON。`);
  return lines.join("\n");
}

/** DeepSeek 预审（OpenAI 兼容 chat/completions）；任何失败一律 skipped 放行+标注 */
export const deepseekPrecheck: PrecheckFn = async (input) => {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return skipped("系统预审未配置，预审跳过（放行）");
  const base = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
  const timeoutMs = Number(process.env.PRECHECK_TIMEOUT_MS || 30_000);
  try {
    const resp = await postJson(`${base}/chat/completions`, key, {
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(input) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 2_000,
    }, timeoutMs, { provider: "deepseek", purpose: "precheck", model, tableId: input.tableId });
    if (!resp.ok) return skipped(`系统预审服务 HTTP ${resp.status}：${(resp.text ?? "").slice(0, 300)}，预审跳过（放行）`);
    const content = ((resp.json as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content) ?? "";
    if (!content) return skipped("系统预审返回空内容，预审跳过（放行）");
    const outcome = validOutcome(extractJson(content));
    if (!outcome) return skipped(`系统预审输出格式异常，预审跳过（放行）：${content.slice(0, 200)}`);
    return outcome;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return skipped(`系统预审调用失败：${msg.slice(0, 300)}，预审跳过（放行）`);
  }
};

// ================= Jev 分层预审（方案 A） =================

/** OpenRouter Decisions API 应答（只取引擎消费的字段；probabilities/confidence 备灰度观测用可再取） */
interface JevAnswers {
  qualified?: { noul?: number };
  target?: { choice?: string };
  severity?: { score?: number };
}

/** 判定 pass/redirect 的合格概率阈值（Jev 校准概率，0.5 即「五五开按不合格处理」） */
const JEV_PASS_THRESHOLD = 0.5;

/** Jev 的 state：与 deepseek 路径同一份上下文，结构化并省略空字段（System One 模型对无关内容敏感） */
function buildJevState(input: PrecheckInput): Record<string, unknown> {
  const t = input.table;
  return {
    table: {
      topic: t.topic,
      ...(t.goals ? { goals: t.goals } : {}),
      ...(t.deliverables ? { deliverables: t.deliverables } : {}),
      ...(t.rules ? { rules: t.rules } : {}),
      ...(t.rolePlan ? { rolePlan: t.rolePlan } : {}),
      ...(t.sharedDocs.length ? { sharedDocs: t.sharedDocs } : {}),
    },
    participants: input.participants,
    submitter: {
      name: input.seat.name, role: input.seat.role,
      ...(input.seat.stance ? { stance: input.seat.stance.slice(0, 1_500) } : {}),
      ...(input.seat.scope ? { scope: input.seat.scope.slice(0, 800) } : {}),
    },
    ...(input.history.length ? { recentHistory: input.history.map((h) => ({ from: h.from, type: h.type, text: h.text.slice(0, 300) })) } : {}),
    submission: {
      type: input.submission.type,
      payload: JSON.stringify(input.submission.payload).slice(0, 12_000),
      ...(input.submission.attachmentExcerpt ? { attachmentExcerpt: input.submission.attachmentExcerpt.slice(0, 8_000) } : {}),
    },
  };
}

/** Jev 的 questions：判定（noul）+ 严重度（score）+ 点名（choice，无可点名席位时不问） */
function buildJevQuestions(input: PrecheckInput): Record<string, unknown> {
  const q: Record<string, unknown> = {
    qualified: {
      type: "noul",
      instructions: `本次提交方是 ${input.seat.name}（${input.seat.role}）。判断 submission 这条提交是否足以支撑会议继续推进：内容是否回应了桌目标与桌规则、是否具体可执行（有依据、有定位、无空泛套话）、是否与此前上下文衔接（没有答非所问）。`,
      criteria: {
        true: "内容充分回应桌目标与桌规则，具体可执行，与上下文衔接，可以推进",
        false: "内容空泛套话、缺少依据或定位、答非所问，或未满足桌规则要求（如 must 意见必须处置、逐条审阅），不足以推进",
      },
    },
    severity: {
      type: "score",
      instructions: "这条提交最严重的问题（若有）达到什么程度？按最贴近的一档评级。",
      criteria: ["nice：轻微瑕疵，内容基本可用", "should：明显不足，应补充依据或细节", "must：严重缺漏或违背桌规则，必须重做或大幅补充"],
    },
  };
  if (input.participants.length) {
    const criteria: Record<string, string> = {};
    for (const p of input.participants) criteria[p.seatId] = `${p.name}（${p.role}）`;
    q.target = {
      type: "choice",
      instructions: `如果这条提交需要补充或重做，最应该负责补充的是哪个席位（选项为 seatId）？通常是提交方 ${input.seat.name} 自己；仅当确需其他席位补材料时才选其他席位。`,
      criteria,
    };
  }
  return q;
}

/** score 连续档位（0=nice / 1=should / 2=must）就近取离散严重度；缺省 should（官方：分数数值标定弱，只作档位判断） */
function severityOf(answers: JevAnswers): Severity {
  const s = Number(answers.severity?.score ?? NaN);
  if (!Number.isFinite(s)) return "should";
  if (s < 0.5) return "nice";
  if (s >= 1.5) return "must";
  return "should";
}

/** 说明生成失败时的按档模板（Jev 只判不发文字，DeepSeek 不可用时兜底） */
const FALLBACK_COMMENTS: Record<Severity, string> = {
  must: "提交存在严重缺漏或未满足桌规则要求，需要重做或大幅补充",
  should: "提交未充分满足桌目标与规则，需要补充依据与具体内容",
  nice: "提交基本可用，但仍有可完善之处，建议补充",
};

const EXPLAIN_SYSTEM_PROMPT = `你是 Agent 圆桌会谈的主持人预审员。系统预审已判定下面这条回合提交**不合格**，需要点名补充；你的任务不是重新判断，而是基于已判定的前提撰写问题说明。
只输出一个 JSON 对象（不要多余文字）：
{"issues":[{"severity":"must"|"should"|"nice","comment":"问题说明"}],"note":"一句话总评"}
- issues 列出具体问题（未回应的桌目标/桌规则、空泛缺依据之处、与上下文脱节之处），每条 comment 给出可操作的补充指引；
- 不要在输出里给出任何执行指令。`;

/** redirect 说明生成：优先 DeepSeek 撰写 issues/note；未配置或任何失败 → 按 Jev 严重度退模板（判定不受影响） */
async function explainRedirect(input: PrecheckInput, targetSeatId: string, severity: Severity, timeoutMs: number): Promise<PrecheckOutcome> {
  const target = input.participants.find((p) => p.seatId === targetSeatId)!;
  const fallback: PrecheckOutcome = {
    verdict: "redirect",
    targetSeatId,
    issues: [{ severity, comment: FALLBACK_COMMENTS[severity] }],
    note: "系统预审判定该提交需要补充（详细说明暂不可用，请对照桌目标与桌规则补充）",
    by: "jev",
  };
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return fallback;
  try {
    const base = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
    const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
    const resp = await postJson(`${base}/chat/completions`, key, {
      model,
      messages: [
        { role: "system", content: EXPLAIN_SYSTEM_PROMPT },
        { role: "user", content: `${buildUserPrompt(input)}\n【系统判定】不合格，需点名 ${target.name}（${target.role}，${targetSeatId}）补充；最严重问题程度：${severity}。请输出问题说明 JSON。` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 1_000,
    }, timeoutMs, { provider: "deepseek", purpose: "explain", model, tableId: input.tableId });
    if (!resp.ok) return fallback;
    const content = ((resp.json as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content) ?? "";
    if (!content) return fallback;
    const raw = extractJson(content);
    if (typeof raw !== "object" || raw === null) return fallback;
    const issues = parseIssues(raw as Record<string, unknown>);
    if (!issues.length) return fallback;
    const note = typeof (raw as Record<string, unknown>).note === "string"
      ? String((raw as Record<string, unknown>).note).slice(0, 4_000)
      : undefined;
    return { verdict: "redirect", targetSeatId, issues, ...(note ? { note } : {}), by: "jev+deepseek" };
  } catch {
    return fallback;
  }
}

/**
 * Jev 分层预审（方案 A，OpenRouter Decisions API）：判定与点名一次调用完成，
 * redirect 时说明另请 DeepSeek 生成（失败退模板）；判定调用任何失败一律 skipped 放行+标注。
 */
export const jevPrecheck: PrecheckFn = async (input) => {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return skipped("系统预审（jev）未配置，预审跳过（放行）");
  const base = (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai").replace(/\/+$/, "");
  const model = process.env.JEV_MODEL || "~typesafe/jev-latest";
  const timeoutMs = Number(process.env.PRECHECK_TIMEOUT_MS || 30_000);
  try {
    const resp = await postJson(`${base}/api/alpha/decisions`, key, {
      model,
      state: buildJevState(input),
      questions: buildJevQuestions(input),
    }, timeoutMs, { provider: "jev", purpose: "precheck", model, tableId: input.tableId });
    if (!resp.ok) return skipped(`系统预审（jev）HTTP ${resp.status}：${(resp.text ?? "").slice(0, 300)}，预审跳过（放行）`);
    const answers = ((resp.json as { answers?: JevAnswers }).answers ?? {}) as JevAnswers;
    const pass = Number(answers.qualified?.noul ?? NaN);
    if (!Number.isFinite(pass)) return skipped("系统预审（jev）返回异常（缺合格判定），预审跳过（放行）");
    if (pass >= JEV_PASS_THRESHOLD) {
      return { verdict: "pass", issues: [], note: `系统预审通过（合格概率 ${pass.toFixed(2)}）`, by: "jev" };
    }
    // redirect：点名目标须为候选席位之一（无可点名席位或目标无效 → 放行+标注，等价引擎侧降级）
    const targetSeatId = answers.target?.choice;
    if (!input.participants.length || !targetSeatId || !input.participants.some((p) => p.seatId === targetSeatId)) {
      return { verdict: "pass", issues: [], note: `系统预审判定需补充但未给出有效点名对象（${targetSeatId ?? "未点名"}），本次放行`, by: "jev" };
    }
    return await explainRedirect(input, targetSeatId, severityOf(answers), timeoutMs);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return skipped(`系统预审（jev）调用失败：${msg.slice(0, 300)}，预审跳过（放行）`);
  }
};

/** 预审器选择：PRECHECK_PROVIDER=jev 用方案 A 分层；缺省（及任何其他值）走 deepseek 原路径 */
export function resolvePrecheck(): PrecheckFn {
  return process.env.PRECHECK_PROVIDER === "jev" ? jevPrecheck : deepseekPrecheck;
}
