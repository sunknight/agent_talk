/** JSON Schema 校验 — 服务器与网关共享，进出消息双端校验 */
import Ajv, { type JSONSchemaType } from "ajv";
import type {
  Envelope, HelloPayload, SeatJoinPayload, SeatConfigPayload, TableCreatePayload, TableStartPayload,
  StatementPayload, QuestionPayload, ReplyPayload,
  ReviewCommentPayload, ResponsePayload, RequestPayload, RequestResponsePayload,
  ArtifactPublishPayload, ArtifactFetchPayload, ArtifactLockPayload,
  ConsensusVotePayload, EscalatePayload, HumanInputPayload, HumanRulingPayload,
  TurnReleasePayload, HostPrereviewPayload, SupplementPayload, HistoryPayload,
} from "./types";

const ajv = new Ajv({ allErrors: true });

const s = (def: object) => ajv.compile(def as JSONSchemaType<never>);

// ---------- 信封 ----------
const envelopeSchema = {
  type: "object", required: ["v", "tableId", "msgId", "fromSeat", "toSeat", "type", "payload", "ts"],
  properties: {
    v: { type: "integer", const: 1 },
    tableId: { type: "string", minLength: 1 },
    msgId: { type: "string", minLength: 1 },
    fromSeat: { type: "string", minLength: 1 },
    toSeat: { type: "string", minLength: 1 },
    type: { type: "string", minLength: 2 },
    payload: {},
    ts: { type: "integer", minimum: 0 },
    sig: { type: "string" },
  },
  additionalProperties: false,
};

// ---------- payload schemas ----------
const str = (min = 0, max = 100_000) => ({ type: "string", minLength: min, maxLength: max });

const helloSchema = s({ type: "object", required: ["token", "clientId"], properties: { token: str(8, 256), clientId: str(1, 128) }, additionalProperties: false });

const seatJoinSchema = s({
  type: "object", required: ["inviteCode", "seatName", "role", "agentLabel"],
  properties: {
    inviteCode: str(4, 64), seatName: str(1, 64),
    role: { type: "string", enum: ["proposer", "reviewer", "observer", "collaborator", "answerer", "asker"] },
    agentLabel: str(1, 64),
    capsOverride: {
      type: "object", additionalProperties: false,
      properties: {
        canPublish: { type: "boolean" }, canModifyOwn: { type: "boolean" },
        canExecuteRequests: { type: "boolean" }, canSendRequests: { type: "boolean" },
        canVote: { type: "boolean" }, canUploadDocs: { type: "boolean" },
      },
    },
  },
});

const statementSchema = s({ type: "object", required: ["text"], properties: { text: str(1, 20_000) }, additionalProperties: false });
const questionSchema = s({ type: "object", required: ["text"], properties: { text: str(1, 4_000), toSeat: str(1, 64) }, additionalProperties: false });
const replySchema = s({ type: "object", required: ["toMsgId", "text"], properties: { toMsgId: str(1, 64), text: str(1, 4_000) }, additionalProperties: false });

const reviewCommentSchema = s({
  type: "object", required: ["items"],
  properties: {
    artifactId: str(1, 64),
    docId: str(1, 64),
    summary: str(0, 4_000),
    done: { type: "boolean" },
    items: {
      type: "array", minItems: 1, maxItems: 50,
      items: {
        type: "object", required: ["id", "target", "severity", "comment"],
        properties: {
          id: str(1, 64), target: str(1, 500),
          severity: { type: "string", enum: ["must", "should", "nice"] },
          comment: str(1, 4_000),
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
});

const responseSchema = s({
  type: "object", required: ["items"],
  properties: {
    items: {
      type: "array", minItems: 1, maxItems: 50,
      items: {
        type: "object", required: ["reviewItemId", "decision"],
        properties: {
          reviewItemId: str(1, 64),
          decision: { type: "string", enum: ["accept", "defer", "reject", "human"] },
          reason: str(0, 4_000),
          action: {
            type: "object", required: ["executeBy"],
            properties: { executeBy: { type: "string", enum: ["self", "reviewerSeat"] }, note: str(0, 2_000) },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
});

const requestSchema = s({
  type: "object",
  required: ["requestId", "toSeat", "intent", "title", "detail"],
  properties: {
    requestId: str(1, 64), toSeat: str(1, 64),
    intent: { type: "string", enum: ["modify_artifact", "clarify"] },
    artifactId: str(1, 64),
    title: str(1, 200), detail: str(1, 8_000),
    sourceReviewItemId: str(1, 64),
  },
  additionalProperties: false,
});

const requestResponseSchema = s({
  type: "object", required: ["decision"],
  properties: {
    requestId: str(1, 64),
    requestIds: { type: "array", minItems: 1, maxItems: 32, items: str(1, 64) }, // 批量处置，与 requestId 至少其一（engine 侧校验）
    decision: { type: "string", enum: ["accept", "reject", "counter", "escalate_human"] },
    reason: str(0, 4_000), counterDetail: str(0, 8_000),
  },
  additionalProperties: false,
});

const artifactPublishSchema = s({
  type: "object", required: ["name", "format", "contentBase64", "changeNote"],
  properties: {
    artifactId: str(1, 64), name: str(1, 200),
    format: { type: "string", enum: ["md", "txt", "json", "png"] },
    contentBase64: { type: "string", minLength: 1, maxLength: 7_000_000 }, // ~5MB 解码后
    changeNote: str(1, 2_000),
    requestId: str(1, 64),
    requestIds: { type: "array", minItems: 1, maxItems: 32, items: str(1, 64) }, // 一版满足多请求的批量溯源
  },
  additionalProperties: false,
});

const artifactFetchSchema = s({ type: "object", required: ["artifactId"], properties: { artifactId: str(1, 64), version: { type: "integer", minimum: 1 } }, additionalProperties: false });
const artifactLockSchema = s({ type: "object", required: ["artifactId", "action"], properties: { artifactId: str(1, 64), action: { type: "string", enum: ["acquire", "release"] } }, additionalProperties: false });

const consensusVoteSchema = s({
  type: "object", required: ["decision"],
  properties: {
    decision: { type: "string", enum: ["pass", "conditional_pass", "reject"] },
    conditions: str(0, 2_000), note: str(0, 2_000),
  },
  additionalProperties: false,
});

const escalateSchema = s({ type: "object", required: ["reason"], properties: { reason: str(1, 4_000), bySeat: str(0, 64) }, additionalProperties: false });
const humanInputSchema = s({ type: "object", required: ["text", "byHuman"], properties: { text: str(1, 8_000), byHuman: str(1, 64), toSeat: str(1, 64) }, additionalProperties: false });
const humanRulingSchema = s({
  type: "object", required: ["instruction"],
  properties: {
    instruction: str(1, 8_000),
    resumePhase: { type: "string", enum: ["open", "qa", "statements", "review", "response", "execution", "convergence", "human_intervention", "closed"] },
    forceConvergence: { type: "boolean" },
  },
  additionalProperties: false,
});

const turnReleaseSchema = s({
  type: "object",
  properties: { reason: str(0, 1_000), pass: { type: "boolean" } },
  additionalProperties: false,
});

const hostPrereviewSchema = s({
  type: "object", required: ["verdict", "reviewedSeatId", "reviewedMsgId", "issues"],
  properties: {
    verdict: { type: "string", enum: ["pass", "redirect", "skipped"] },
    reviewedSeatId: str(1, 64), reviewedMsgId: str(1, 64), targetSeatId: str(1, 64),
    issues: {
      type: "array", maxItems: 20,
      items: {
        type: "object", required: ["severity", "comment"],
        properties: { severity: { type: "string", enum: ["must", "should", "nice"] }, comment: str(1, 2_000) },
        additionalProperties: false,
      },
    },
    note: str(0, 4_000), by: str(0, 64),
  },
  additionalProperties: false,
});

const supplementSchema = s({
  type: "object", required: ["directiveId", "text"],
  properties: {
    directiveId: str(1, 64), text: str(1, 20_000),
    artifactId: str(1, 64), docId: str(1, 64),
  },
  additionalProperties: false,
});

const tableCreateSchema = s({
  type: "object", required: ["topic", "template", "owner"],
  properties: {
    topic: str(1, 300),
    template: { type: "string", enum: ["review-collab"] },
    tableType: { type: "string", enum: ["review", "collab", "brainstorm", "decision", "inquiry"] },
    inviteRoles: { type: "array", minItems: 1, maxItems: 5, uniqueItems: true, items: { type: "string", enum: ["proposer", "reviewer", "observer", "collaborator", "answerer"] } },
    mode: { type: "string", enum: ["self", "hosted"] },
    goals: str(0, 4_000), deliverables: str(0, 4_000), rules: str(0, 4_000), rolePlan: str(0, 4_000),
    owner: {
      type: "object", required: ["seatName", "agentLabel"],
      properties: { seatName: str(1, 64), agentLabel: str(1, 64) },
      additionalProperties: false,
    },
    maxReviewRounds: { type: "integer", minimum: 1, maximum: 10 },
    turnTimeoutMs: { type: "integer", minimum: 30_000, maximum: 3_600_000 },
  },
  additionalProperties: false,
});

const tableStartSchema = s({ type: "object", properties: { reason: str(0, 1_000) }, additionalProperties: false });

const seatConfigSchema = s({
  type: "object", required: ["stance", "scope", "dataScope", "ready"],
  properties: {
    stancePreset: str(1, 64),
    stance: str(1, 8_000),
    scope: str(0, 4_000),
    dataScope: { type: "array", items: str(1, 500), maxItems: 50 },
    ready: { type: "boolean" },
  },
  additionalProperties: false,
});

/** type → payload 校验器表 */
export const payloadValidators: Partial<Record<string, (p: unknown) => boolean>> = {
  HELLO: helloSchema,
  TABLE_CREATE: tableCreateSchema,
  TABLE_START: tableStartSchema,
  SEAT_JOIN: seatJoinSchema,
  SEAT_CONFIG: seatConfigSchema,
  STATEMENT: statementSchema,
  QUESTION: questionSchema,
  REPLY: replySchema,
  REVIEW_COMMENT: reviewCommentSchema,
  RESPONSE: responseSchema,
  REQUEST: requestSchema,
  RESPOND_REQUEST: requestResponseSchema,
  ARTIFACT_PUBLISH: artifactPublishSchema,
  ARTIFACT_FETCH: artifactFetchSchema,
  ARTIFACT_LOCK: artifactLockSchema,
  CONSENSUS_VOTE: consensusVoteSchema,
  ESCALATE: escalateSchema,
  HUMAN_INPUT: humanInputSchema,
  HUMAN_RULING: humanRulingSchema,
  TURN_RELEASE: turnReleaseSchema,
  HOST_PREREVIEW: hostPrereviewSchema,
  SUPPLEMENT: supplementSchema,
};

const envelopeValidator = ajv.compile(envelopeSchema);

export interface ValidateResult { ok: boolean; errors: string[]; }

/** 校验一条消息：信封结构 + （若登记了）payload schema */
export function validateEnvelope(env: Envelope): ValidateResult {
  const errors: string[] = [];
  if (!envelopeValidator(env)) {
    errors.push(...(envelopeValidator.errors ?? []).map((e) => `envelope:${e.instancePath} ${e.message ?? ""}`));
  }
  const pv = payloadValidators[env.type];
  if (pv && !pv(env.payload)) {
    // ajv validate 函数挂 errors
    const verrs = (pv as { errors?: { instancePath: string; message?: string }[] }).errors ?? [];
    errors.push(...verrs.map((e) => `payload:${e.instancePath} ${e.message ?? ""}`));
  }
  return { ok: errors.length === 0, errors };
}

/** Payload 类型守卫（供网关/服务器按需使用） */
export const is = {
  hello: (p: unknown): p is HelloPayload => !!payloadValidators.HELLO!(p),
  tableCreate: (p: unknown): p is TableCreatePayload => !!payloadValidators.TABLE_CREATE!(p),
  tableStart: (p: unknown): p is TableStartPayload => !!payloadValidators.TABLE_START!(p),
  seatJoin: (p: unknown): p is SeatJoinPayload => !!payloadValidators.SEAT_JOIN!(p),
  seatConfig: (p: unknown): p is SeatConfigPayload => !!payloadValidators.SEAT_CONFIG!(p),
  statement: (p: unknown): p is StatementPayload => !!payloadValidators.STATEMENT!(p),
  question: (p: unknown): p is QuestionPayload => !!payloadValidators.QUESTION!(p),
  reply: (p: unknown): p is ReplyPayload => !!payloadValidators.REPLY!(p),
  reviewComment: (p: unknown): p is ReviewCommentPayload => !!payloadValidators.REVIEW_COMMENT!(p),
  response: (p: unknown): p is ResponsePayload => !!payloadValidators.RESPONSE!(p),
  request: (p: unknown): p is RequestPayload => !!payloadValidators.REQUEST!(p),
  requestResponse: (p: unknown): p is RequestResponsePayload => !!payloadValidators.RESPOND_REQUEST!(p),
  artifactPublish: (p: unknown): p is ArtifactPublishPayload => !!payloadValidators.ARTIFACT_PUBLISH!(p),
  artifactFetch: (p: unknown): p is ArtifactFetchPayload => !!payloadValidators.ARTIFACT_FETCH!(p),
  artifactLock: (p: unknown): p is ArtifactLockPayload => !!payloadValidators.ARTIFACT_LOCK!(p),
  consensusVote: (p: unknown): p is ConsensusVotePayload => !!payloadValidators.CONSENSUS_VOTE!(p),
  escalate: (p: unknown): p is EscalatePayload => !!payloadValidators.ESCALATE!(p),
  humanInput: (p: unknown): p is HumanInputPayload => !!payloadValidators.HUMAN_INPUT!(p),
  humanRuling: (p: unknown): p is HumanRulingPayload => !!payloadValidators.HUMAN_RULING!(p),
  turnRelease: (p: unknown): p is TurnReleasePayload => !!payloadValidators.TURN_RELEASE!(p),
  hostPrereview: (p: unknown): p is HostPrereviewPayload => !!payloadValidators.HOST_PREREVIEW!(p),
  supplement: (p: unknown): p is SupplementPayload => !!payloadValidators.SUPPLEMENT!(p),
};

// 防止 tree-shaking 误判（HistoryPayload 仅作类型导出使用）
export type { HistoryPayload };
