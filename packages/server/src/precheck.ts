/**
 * 主持人预审（DeepSeek）——hosted 桌上对每条消费发言权的回合提交做预审：
 * pass 放行走原调度 / redirect 点名指定席位补充 / skipped（未配置或失败）放行+标注。
 * 结果只是数据：引擎侧再校验目标席位与链深，模型文本不构成指令。
 * 环境变量：DEEPSEEK_API_KEY（未设即 skipped）、DEEPSEEK_BASE_URL、DEEPSEEK_MODEL、PRECHECK_TIMEOUT_MS。
 */
import type { PrecheckIssue, Severity } from "@rt/shared";

/** 引擎组装的预审输入（全部为只读快照） */
export interface PrecheckInput {
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

function validOutcome(raw: unknown): PrecheckOutcome | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const verdict = r.verdict;
  if (verdict !== "pass" && verdict !== "redirect") return null;
  const issues: PrecheckIssue[] = Array.isArray(r.issues)
    ? r.issues
      .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
      .filter((x) => typeof x.comment === "string" && x.comment.length > 0)
      .map((x) => {
        const sv: Severity = x.severity === "must" || x.severity === "should" || x.severity === "nice" ? x.severity : "should";
        return { severity: sv, comment: String(x.comment).slice(0, 2_000) };
      })
      .slice(0, 20)
    : [];
  const targetSeatId = typeof r.targetSeatId === "string" ? r.targetSeatId : undefined;
  const note = typeof r.note === "string" ? r.note.slice(0, 4_000) : undefined;
  if (verdict === "redirect" && !targetSeatId) return null; // redirect 必须点名
  return { verdict, targetSeatId, issues, note, by: "deepseek" };
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
  if (!key) return skipped("未配置 DEEPSEEK_API_KEY，预审跳过（放行）");
  const base = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
  const timeoutMs = Number(process.env.PRECHECK_TIMEOUT_MS || 30_000);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const resp = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(input) },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 2_000,
      }),
      signal: ac.signal,
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      return skipped(`DeepSeek HTTP ${resp.status}：${body.slice(0, 300)}，预审跳过（放行）`);
    }
    const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? "";
    if (!content) return skipped("DeepSeek 返回空内容，预审跳过（放行）");
    const outcome = validOutcome(extractJson(content));
    if (!outcome) return skipped(`DeepSeek 输出格式异常，预审跳过（放行）：${content.slice(0, 200)}`);
    return outcome;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return skipped(`DeepSeek 调用失败：${msg.slice(0, 300)}，预审跳过（放行）`);
  } finally {
    clearTimeout(timer);
  }
};
