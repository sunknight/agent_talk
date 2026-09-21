/**
 * REST API — skill 档唯一接入面（原生 http，零依赖）。
 * 全部动作用系统 curl 即可完成（design.md v1.1 §5.1）。
 * 统一响应：{ok:true,data} / {ok:false,error:{code,message}}
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { STANCE_PRESETS, type MsgType } from "@rt/shared";
import type { ServerSeat } from "./engine";
import { ApiError, type Hub } from "./engine";
import { SKILL_MD } from "./skill-template";
import { OBSERVER_HTML } from "./observer-html";

const BODY_LIMIT = 8 * 1024 * 1024; // 产物 base64 最大 ~7MB
const POLL_MAX_MS = 25_000;

function json(res: ServerResponse, status: number, body: unknown) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": buf.length });
  res.end(buf);
}

function ok(res: ServerResponse, data: unknown) { json(res, 200, { ok: true, data }); }
function fail(res: ServerResponse, err: unknown) {
  if (err instanceof ApiError) return json(res, err.status, { ok: false, error: { code: err.code, message: err.message } });
  const e = err as { message?: string };
  json(res, 500, { ok: false, error: { code: "server_error", message: e?.message ?? String(err) } });
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > BODY_LIMIT) { reject(new ApiError(413, "too_large", "请求体超限")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const buf = await readBody(req);
  if (buf.length === 0) return {};
  try { return JSON.parse(buf.toString("utf8")); } catch { throw new ApiError(400, "bad_json", "请求体不是合法 JSON"); }
}

function bearer(req: IncomingMessage): string {
  const h = req.headers.authorization ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) throw new ApiError(401, "unauthorized", "缺少 Authorization: Bearer <token>");
  return m[1].trim();
}

export function createHttpServer(hub: Hub) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname.replace(/\/+$/, "") || "/";
      const method = req.method ?? "GET";
      const seg = path.split("/").filter(Boolean); // ["api","tables",id,...]

      if (path === "/healthz") return ok(res, { status: "ok" });
      if (path === "/" && method === "GET") {
        const buf = Buffer.from(OBSERVER_HTML, "utf8");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": buf.length });
        return res.end(buf);
      }

      // ---------- 观察端（Web 控制台，user token 鉴权） ----------
      if (path === "/api/observer/tables" && method === "GET") {
        const u = hub.requireUser(bearer(req));
        return ok(res, { tables: hub.observerTables(u.userId) });
      }
      if (seg[0] === "api" && seg[1] === "observer" && seg[2] === "tables" && seg[3]) {
        const tableId = seg[3];
        if (seg[4] === "invites" && method === "GET" && !seg[5]) {
          return ok(res, hub.observerInvites(bearer(req), tableId));
        }
        if (!seg[4] && method === "GET") {
          const u = hub.requireUser(bearer(req));
          return ok(res, hub.observerDetail(tableId, u.userId));
        }
      }
      if (seg[0] === "api" && seg[1] === "tables" && seg[2] && seg[3] === "human-input" && method === "POST" && !seg[4]) {
        const body = await readJson(req);
        return ok(res, { sent: hub.humanInputByUser(bearer(req), seg[2], {
          text: String(body.text ?? ""),
          toSeat: body.toSeat ? String(body.toSeat) : undefined,
          byHuman: String(body.byHuman ?? ""),
        }) });
      }
      // ---------- 「我的席位」通道（网页持有人，user token 鉴权） ----------
      if (seg[0] === "api" && seg[1] === "tables" && seg[2] && seg[3] === "my" && seg[4] === "documents" && method === "GET" && seg[5] && !seg[6]) {
        return ok(res, hub.getDocumentByUser(bearer(req), seg[2], seg[5]));
      }
      if (seg[0] === "api" && seg[1] === "tables" && seg[2] && seg[3] === "my" && method === "POST") {
        const tableId = seg[2];
        const body = await readJson(req);
        if (seg[4] === "seat-config" && !seg[5]) {
          return ok(res, { seat: hub.seatConfigByUser(bearer(req), tableId, {
            stancePreset: body.stancePreset ? String(body.stancePreset) : undefined,
            stance: String(body.stance ?? ""),
            scope: body.scope !== undefined ? String(body.scope) : undefined,
            dataScope: Array.isArray(body.dataScope) ? body.dataScope.map(String) : undefined,
            ready: typeof body.ready === "boolean" ? body.ready : undefined,
          }) });
        }
        if (seg[4] === "message" && !seg[5]) {
          const type = String(body.type ?? "");
          if (!type) throw new ApiError(422, "bad_payload", "type 必填");
          return ok(res, { message: hub.postByUser(bearer(req), tableId, { type: type as MsgType, payload: body.payload }) });
        }
        // 开始会议（建桌人专属，网页 user token 通道）
        if (seg[4] === "start" && !seg[5]) {
          return ok(res, hub.startByUser(bearer(req), tableId));
        }
        // 上传资料文档（网页持有人以本桌席位身份）
        if (seg[4] === "documents" && !seg[5]) {
          return ok(res, { doc: hub.docByUser(bearer(req), tableId, {
            name: String(body.name ?? ""),
            purpose: String(body.purpose ?? ""),
            visibility: body.visibility !== undefined ? String(body.visibility) : undefined,
            contentBase64: String(body.contentBase64 ?? ""),
          }) });
        }
        // 凭证重签（恢复参会 recover / agent 替代 replace）
        if (seg[4] === "seat-token" && !seg[5]) {
          return ok(res, hub.reissueByUser(bearer(req), tableId,
            body.mode !== undefined ? String(body.mode) : "recover",
            body.agentLabel !== undefined ? String(body.agentLabel) : undefined));
        }
      }
      if (path === "/api/stances" && method === "GET") {
        return ok(res, { stances: STANCE_PRESETS });
      }
      if (path === "/skill.md" && method === "GET") {
        const buf = Buffer.from(SKILL_MD, "utf8");
        res.writeHead(200, { "content-type": "text/markdown; charset=utf-8", "content-length": buf.length });
        return res.end(buf);
      }

      // ---------- 管理台（systemadmin 专属，服务端强制角色） ----------
      if (seg[0] === "api" && seg[1] === "admin") {
        if (seg[2] === "users" && method === "GET" && !seg[3]) {
          return ok(res, { users: hub.adminUsers(bearer(req)) });
        }
        if (seg[2] === "users" && seg[3] && seg[4] === "tables" && method === "GET" && !seg[5]) {
          return ok(res, { tables: hub.adminUserTables(bearer(req), seg[3]) });
        }
        if (seg[2] === "users" && seg[3] && seg[4] === "role" && method === "POST" && !seg[5]) {
          const body = await readJson(req);
          return ok(res, hub.adminSetRole(bearer(req), seg[3], body.role === "systemadmin" ? "systemadmin" : "user"));
        }
        if (seg[2] === "users" && seg[3] && seg[4] === "disabled" && method === "POST" && !seg[5]) {
          const body = await readJson(req);
          return ok(res, hub.adminSetDisabled(bearer(req), seg[3], body.disabled === true));
        }
        // 用户登录 token 重签：原始 token 只存 hash，恢复登录入口 = 换新 token（只返回这一次）
        if (seg[2] === "users" && seg[3] && seg[4] === "token" && method === "POST" && !seg[5]) {
          return ok(res, hub.adminReissueUserToken(bearer(req), seg[3]));
        }
        if (seg[2] === "tables" && seg[3] && seg[4] === "invites" && method === "GET" && !seg[5]) {
          return ok(res, hub.adminInvites(bearer(req), seg[3]));
        }
        // 凭证重签：systemadmin 可代任意席位恢复参会配置 / 替代 agent
        if (seg[2] === "tables" && seg[3] && seg[4] === "seats" && seg[5] && seg[6] === "token" && method === "POST" && !seg[7]) {
          const body = await readJson(req);
          return ok(res, hub.adminReissueSeatToken(bearer(req), seg[3], seg[5],
            body.mode !== undefined ? String(body.mode) : "recover",
            body.agentLabel !== undefined ? String(body.agentLabel) : undefined));
        }
        if (seg[2] === "tables" && seg[3] && seg[4] === "close" && method === "POST" && !seg[5]) {
          const body = await readJson(req);
          return ok(res, hub.adminCloseTable(bearer(req), seg[3], String(body.reason ?? "")));
        }
        if (seg[2] === "tables" && seg[3] && seg[4] === "human" && method === "POST" && !seg[5]) {
          const body = await readJson(req);
          return ok(res, hub.adminEnterHumanMode(bearer(req), seg[3], String(body.reason ?? "")));
        }
        if (seg[2] === "tables" && seg[3] && !seg[4] && method === "DELETE") {
          return ok(res, hub.adminDeleteTable(bearer(req), seg[3]));
        }
      }

      // ---------- 用户 ----------
      if (path === "/api/users" && method === "POST") {
        const body = await readJson(req);
        const name = String(body.name ?? "");
        if (!name) throw new ApiError(422, "bad_payload", "name 必填");
        return ok(res, hub.registerUser(name));
      }
      if (path === "/api/me" && method === "GET") {
        const u = hub.requireUser(bearer(req));
        return ok(res, { userId: u.userId, name: u.name, role: u.role });
      }

      // ---------- 桌 ----------
      if (path === "/api/tables" && method === "POST") {
        const body = await readJson(req);
        const topic = String(body.topic ?? "");
        if (!topic) throw new ApiError(422, "bad_payload", "topic 必填");
        const owner = body.owner as { seatName?: string; agentLabel?: string } | undefined;
        if (!owner?.seatName) throw new ApiError(422, "bad_payload", "owner.seatName 必填（建桌人自动成为提案方席位）");
        return ok(res, hub.createTable(bearer(req), {
          topic,
          goals: body.goals ? String(body.goals) : undefined,
          deliverables: body.deliverables ? String(body.deliverables) : undefined,
          rules: body.rules ? String(body.rules) : undefined,
          rolePlan: body.rolePlan ? String(body.rolePlan) : undefined,
          owner: { seatName: owner.seatName, agentLabel: String(owner.agentLabel ?? "unknown") },
          maxReviewRounds: body.maxReviewRounds ? Number(body.maxReviewRounds) : undefined,
          turnTimeoutMs: body.turnTimeoutMs ? Number(body.turnTimeoutMs) : undefined,
        }));
      }
      if (path === "/api/tables" && method === "GET") {
        hub.requireUser(bearer(req));
        return ok(res, { tables: hub.store.listTables() });
      }

      // /api/tables/:id/...
      if (seg[0] === "api" && seg[1] === "tables" && seg[2]) {
        const tableId = seg[2];
        const sub = seg[3];

        // 入席（用户 token + 邀请码）
        if (sub === "seats" && method === "POST" && !seg[4]) {
          const body = await readJson(req);
          return ok(res, hub.joinTable(bearer(req), tableId, {
            inviteCode: String(body.inviteCode ?? ""),
            seatName: String(body.seatName ?? ""),
            role: body.role as "proposer" | "reviewer" | "observer",
            agentLabel: String(body.agentLabel ?? "unknown"),
            capsOverride: body.capsOverride as Record<string, boolean> | undefined,
          }));
        }

        // 以下均需席位 token
        const seatAuth = authSeat(hub, req, tableId);

        // 入桌设定：立场（预设+补充）/讨论范围/数据范围/就绪
        if (sub === "seat-config" && method === "POST" && !seg[4]) {
          const body = await readJson(req);
          return ok(res, { seat: hub.updateSeatConfig(tableId, seatAuth, {
            stancePreset: body.stancePreset ? String(body.stancePreset) : undefined,
            stance: String(body.stance ?? ""),
            scope: body.scope !== undefined ? String(body.scope) : undefined,
            dataScope: Array.isArray(body.dataScope) ? body.dataScope.map(String) : undefined,
            ready: typeof body.ready === "boolean" ? body.ready : undefined,
          }) });
        }
        // 点开始（建桌人专属）
        if (sub === "start" && method === "POST" && !seg[4]) {
          return ok(res, hub.startTable(tableId, seatAuth));
        }

        if (sub === undefined && method === "GET") {
          return ok(res, hub.tableInfo(tableId));
        }
        if (sub === "poll" && method === "GET") {
          const since = Number(url.searchParams.get("since") ?? 0) || 0;
          const waitSec = Math.min(Number(url.searchParams.get("timeout") ?? 20), POLL_MAX_MS / 1000);
          return ok(res, await hub.poll(tableId, seatAuth, since, waitSec * 1000));
        }
        // 变动记录（回合开始刷新）：最新桌况 + 资料列表（本席视角）+ since 之后的结构化变动；poll 响应亦附同款字段
        if (sub === "changes" && method === "GET" && !seg[4]) {
          const since = Number(url.searchParams.get("since") ?? 0) || 0;
          return ok(res, hub.changesSince(tableId, seatAuth, since));
        }
        if (sub === "messages" && method === "POST") {
          const body = await readJson(req);
          const type = String(body.type ?? "");
          if (!type) throw new ApiError(422, "bad_payload", "type 必填");
          return ok(res, hub.postMessage(tableId, seatAuth, type as MsgType, body.payload));
        }
        if (sub === "leave" && method === "POST" && !seg[4]) {
          hub.leaveTable(tableId, seatAuth);
          return ok(res, { left: true });
        }

        // ---------- 产物 ----------
        if (sub === "artifacts") {
          if (method === "POST" && !seg[4]) {
            const body = await readJson(req);
            return ok(res, hub.publishArtifact(tableId, seatAuth, {
              artifactId: body.artifactId ? String(body.artifactId) : undefined,
              name: String(body.name ?? ""),
              format: body.format as "md" | "txt" | "json" | "png",
              contentBase64: String(body.contentBase64 ?? ""),
              changeNote: String(body.changeNote ?? ""),
              requestId: body.requestId ? String(body.requestId) : undefined,
              requestIds: Array.isArray(body.requestIds)
                ? body.requestIds.map((x: unknown) => String(x)).filter((x: string) => x.length > 0 && x.length <= 64).slice(0, 32)
                : undefined,
            }));
          }
          if (method === "GET" && !seg[4]) return ok(res, { artifacts: hub.listArtifacts(tableId) });

          const artifactId = seg[4];
          if (artifactId && method === "GET" && !seg[5]) {
            const v = hub.getArtifactVersion(tableId, artifactId, url.searchParams.get("version") ? Number(url.searchParams.get("version")) : undefined);
            return ok(res, v);
          }
          if (artifactId && seg[5] === "diff" && method === "GET") {
            const from = Number(url.searchParams.get("from") ?? 1) || 1;
            let to = Number(url.searchParams.get("to") ?? 0) || 0;
            if (!to) to = hub.getArtifactVersion(tableId, artifactId).version.v;
            return ok(res, hub.diffArtifact(tableId, artifactId, from, to));
          }
          if (artifactId && seg[5] === "lock" && method === "POST") {
            const body = await readJson(req);
            return ok(res, hub.lockArtifact(tableId, seatAuth, artifactId, body.action as "acquire" | "release"));
          }
        }

        // ---------- 资料文档（上传阅资料 / 投屏；shared 全桌可下载，private 仅本席） ----------
        if (sub === "documents") {
          if (method === "POST" && !seg[4]) {
            const body = await readJson(req);
            return ok(res, { doc: hub.uploadDocument(tableId, seatAuth, {
              name: String(body.name ?? ""),
              purpose: String(body.purpose ?? ""),
              visibility: body.visibility !== undefined ? String(body.visibility) : undefined,
              contentBase64: String(body.contentBase64 ?? ""),
            }) });
          }
          if (method === "GET" && !seg[4]) return ok(res, { documents: hub.listDocuments(tableId, seatAuth.seatId) });
          if (seg[4] && method === "GET" && !seg[5]) return ok(res, hub.getDocument(tableId, seatAuth, seg[4]));
        }

        if (sub === "requests" && method === "GET" && !seg[4]) {
          hub.requireTable(tableId);
          return ok(res, { requests: hub.store.getRequests(tableId) });
        }
        if (sub === "review-items" && method === "GET" && !seg[4]) {
          hub.requireTable(tableId);
          return ok(res, { items: hub.collectReviewItems(tableId) });
        }
      }

      throw new ApiError(404, "no_route", `无此路由：${method} ${path}`);
    } catch (err) {
      fail(res, err);
    }
  });
}

function authSeat(hub: Hub, req: IncomingMessage, tableId: string): ServerSeat {
  const t = hub.store.findSeatByToken(bearer(req));
  if (!t || t.tableId !== tableId) throw new ApiError(401, "unauthorized", "席位 token 无效或不属于本桌");
  return hub.requireSeat(tableId, t.seatId);
}
