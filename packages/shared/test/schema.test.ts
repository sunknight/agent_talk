import { describe, it, expect } from "vitest";
import { validateEnvelope, is, resolveCaps, makeEnvelope } from "../src";

const base = { tableId: "t1", fromSeat: "seat_a", toSeat: "all", ts: Date.now() } as const;

describe("信封校验", () => {
  it("合法 STATEMENT 通过", () => {
    const env = makeEnvelope({ ...base, type: "STATEMENT", payload: { text: "hello" }, from: "seat_a", to: "all" });
    expect(validateEnvelope(env).ok).toBe(true);
  });

  it("缺字段拒绝", () => {
    const env = { ...makeEnvelope({ ...base, type: "STATEMENT", payload: { text: "x" }, from: "a", to: "all" }) };
    delete (env as Record<string, unknown>).msgId;
    const r = validateEnvelope(env as never);
    expect(r.ok).toBe(false);
  });

  it("未知消息类型在信封层仍可过结构（payload 无 schema 时只查信封），但登记过的类型查 payload", () => {
    const env = makeEnvelope({ ...base, type: "PING", payload: {}, from: "a", to: "server" });
    expect(validateEnvelope(env).ok).toBe(true);
  });
});

describe("payload schema", () => {
  it("REVIEW_COMMENT 合法结构", () => {
    const p = { items: [{ id: "ri1", target: "第2节", severity: "must", comment: "缺少错误处理" }], summary: "整体可行" };
    expect(is.reviewComment(p)).toBe(true);
    expect(is.reviewComment({ items: [] })).toBe(false);
    expect(is.reviewComment({ items: [{ id: "x", target: "t", severity: "critical", comment: "c" }] })).toBe(false);
  });

  it("REQUEST intent 白名单", () => {
    expect(is.request({ requestId: "r1", toSeat: "s", intent: "modify_artifact", title: "t", detail: "d", artifactId: "a1" })).toBe(true);
    expect(is.request({ requestId: "r1", toSeat: "s", intent: "rm_rf", title: "t", detail: "d" })).toBe(false);
  });

  it("ARTIFACT_PUBLISH 超大内容拒绝（>5MB base64）", () => {
    const big = "A".repeat(7_000_001);
    expect(is.artifactPublish({ name: "n", format: "md", contentBase64: big, changeNote: "c" })).toBe(false);
  });

  it("RESPOND_REQUEST decision 枚举", () => {
    expect(is.requestResponse({ requestId: "r1", decision: "escalate_human" })).toBe(true);
    expect(is.requestResponse({ requestId: "r1", decision: "yes" })).toBe(false);
  });

  it("RESPOND_REQUEST 批量：requestIds 数组合法；皆空的至少其一校验留在 engine 层（schema 放行）", () => {
    expect(is.requestResponse({ requestIds: ["r1", "r2"], decision: "accept" })).toBe(true);
    expect(is.requestResponse({ requestIds: [], decision: "accept" })).toBe(false);
    expect(is.requestResponse({ decision: "accept" } as never)).toBe(true);
  });

  it("ARTIFACT_PUBLISH 批量溯源 requestIds 数组", () => {
    expect(is.artifactPublish({ name: "n", format: "md", contentBase64: "QQ==", changeNote: "c", requestIds: ["r1", "r2"] })).toBe(true);
    expect(is.artifactPublish({ name: "n", format: "md", contentBase64: "QQ==", changeNote: "c", requestIds: "r1" } as never)).toBe(false);
  });

  it("TABLE_CREATE 必须带 owner 席位", () => {
    expect(is.tableCreate({ topic: "API 设计评审", template: "review-collab", owner: { seatName: "Alice", agentLabel: "zcode" } })).toBe(true);
    expect(is.tableCreate({ topic: "x", template: "review-collab" })).toBe(false);
  });

  it("SEAT_CONFIG 立场设定合法结构", () => {
    expect(is.seatConfig({ stance: "我方是需求评审方", scope: "接口契约", dataScope: ["art_1", "docs/api 目录"], ready: true })).toBe(true);
    expect(is.seatConfig({ stance: "", scope: "", dataScope: [], ready: false })).toBe(false);
  });

  it("RESPONSE 四态：接纳/后续跟进/拒绝/人工处理", () => {
    expect(is.response({ items: [{ reviewItemId: "ri1", decision: "defer", reason: "下期处理" }] })).toBe(true);
    expect(is.response({ items: [{ reviewItemId: "ri1", decision: "human", reason: "涉及预算" }] })).toBe(true);
    expect(is.response({ items: [{ reviewItemId: "ri1", decision: "maybe" }] })).toBe(false);
  });

  it("HUMAN_RULING resumePhase 合法阶段", () => {
    expect(is.humanRuling({ instruction: "继续", resumePhase: "review" })).toBe(true);
    expect(is.humanRuling({ instruction: "继续", resumePhase: "war" })).toBe(false);
  });

  it("DIRECTIVE：text 必填、title 可选；directiveId 必填（服务器生成后回填校验同款）", () => {
    expect(is.directive({ directiveId: "wd_1", text: "修改 bd10 搜索框背景为白色" })).toBe(true);
    expect(is.directive({ directiveId: "wd_1", title: "改配色", text: "…" })).toBe(true);
    expect(is.directive({ directiveId: "wd_1" })).toBe(false);
    expect(is.directive({ text: "缺 directiveId" })).toBe(false);
  });

  it("DIRECTIVE_RESULT：outcome 枚举五态；note/clarify 可选（必填性留 engine 层）", () => {
    expect(is.directiveResult({ directiveId: "wd_1", outcome: "executing" })).toBe(true);
    expect(is.directiveResult({ directiveId: "wd_1", outcome: "need_clarify", clarify: "指哪一家竞品？" })).toBe(true);
    expect(is.directiveResult({ directiveId: "wd_1", outcome: "done", note: "完成" })).toBe(true);
    expect(is.directiveResult({ directiveId: "wd_1", outcome: "cancelled" })).toBe(false);
    expect(is.directiveResult({ directiveId: "wd_1" })).toBe(false);
  });

  it("DIRECTIVE_CLARIFY：directiveId + answer 必填", () => {
    expect(is.directiveClarify({ directiveId: "wd_1", answer: "参考竞品 A" })).toBe(true);
    expect(is.directiveClarify({ directiveId: "wd_1" })).toBe(false);
    expect(is.directiveClarify({ answer: "缺 id" })).toBe(false);
  });
});

describe("能力声明", () => {
  it("observer 不能被覆盖放宽", () => {
    const caps = resolveCaps("observer", { canPublish: true, canVote: true });
    expect(caps.canPublish).toBe(false);
    expect(caps.canVote).toBe(false);
  });

  it("reviewer 可收紧", () => {
    const caps = resolveCaps("reviewer", { canPublish: false });
    expect(caps.canPublish).toBe(false);
    expect(caps.canSendRequests).toBe(true);
  });
});
