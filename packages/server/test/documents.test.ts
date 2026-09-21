/**
 * 资料文档（上传阅资料 / 投屏）验收：
 * 上传与作用声明必填、shared/private 可见性权限、列表 downloadable 标记、
 * 下载（他席私有 403 / observer 可读共享）、DOC_UPLOADED 广播、
 * REVIEW_COMMENT 关联 docId、纪要含资料清单、my 通道（user token）、
 * 旧 state.json（缺 documents / caps 缺 canUploadDocs）兼容兜底。
 * fetch 直调 REST，零 mock。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start, Store, Hub } from "../src";

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

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

/** 建桌（不开始）：建桌人 proposer + 一名 reviewer + 一名 observer，全部就绪 */
async function tableWithSeats(topic: string) {
  const ownerUser = (await call("POST", "/api/users", { body: { name: `${topic}-owner` } })).data.token;
  const created = await call("POST", "/api/tables", {
    token: ownerUser,
    body: { topic, owner: { seatName: `${topic}-owner`, agentLabel: "zcode" } },
  });
  const { tableId, ownerSeatToken, ownerSeatId, inviteCodes } = created.data;
  const reviewerCode = inviteCodes.find((c: { role: string }) => c.role === "reviewer").code;
  const observerCode = inviteCodes.find((c: { role: string }) => c.role === "observer").code;
  await call("POST", `/api/tables/${tableId}/seat-config`, {
    token: ownerSeatToken, body: { stance: "需求提出方", ready: true },
  });
  const ru = (await call("POST", "/api/users", { body: { name: `${topic}-rev` } })).data.token;
  const rj = await call("POST", `/api/tables/${tableId}/seats`, {
    token: ru, body: { inviteCode: reviewerCode, seatName: `${topic}-rev`, role: "reviewer", agentLabel: "claude" },
  });
  expect(rj.ok).toBe(true);
  await call("POST", `/api/tables/${tableId}/seat-config`, {
    token: rj.data.token, body: { stance: "评审方", ready: true },
  });
  const ou = (await call("POST", "/api/users", { body: { name: `${topic}-obs` } })).data.token;
  const oj = await call("POST", `/api/tables/${tableId}/seats`, {
    token: ou, body: { inviteCode: observerCode, seatName: `${topic}-obs`, role: "observer", agentLabel: "claude" },
  });
  expect(oj.ok).toBe(true);
  // observer 也需就绪（全员就绪才能开始）
  await call("POST", `/api/tables/${tableId}/seat-config`, {
    token: oj.data.token, body: { stance: "观察方旁听", ready: true },
  });
  return {
    tableId,
    ownerUser,
    reviewerUser: ru,
    owner: { seatId: ownerSeatId, token: ownerSeatToken },
    reviewer: { seatId: rj.data.seatId, token: rj.data.token },
    observer: { seatId: oj.data.seatId, token: oj.data.token },
  };
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-doc-test-"));
  ({ http } = await start({ port: 0, dataDir: dir, host: "127.0.0.1" }));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => {
  http.closeIdleConnections?.();
  http.close(() => r());
}));

describe("资料文档：上传 / 可见性 / 下载", () => {
  let t: Awaited<ReturnType<typeof tableWithSeats>>;
  let v: Awaited<ReturnType<typeof tableWithSeats>>; // 校验用例桌（分摊席位限频窗口）
  let sharedDocId = "", privateDocId = "", revDocId = "";

  it("建桌入席（proposer+reviewer+observer，open 阶段）", async () => {
    t = await tableWithSeats("需求文档投屏评审");
    v = await tableWithSeats("上传校验用例");
    const empty = await call("GET", `/api/tables/${t.tableId}/documents`, { token: t.owner.token });
    expect(empty.data.documents).toEqual([]);
  });

  it("上传 shared 文档：purpose 必填、元数据返回、全桌收到 DOC_UPLOADED 广播", async () => {
    const noPurpose = await call("POST", `/api/tables/${v.tableId}/documents`, {
      token: v.owner.token, body: { name: "x.md", contentBase64: b64("缺作用声明") },
    });
    expect(noPurpose.status).toBe(422);
    expect(noPurpose.error?.code).toBe("bad_payload");

    const up = await call("POST", `/api/tables/${t.tableId}/documents`, {
      token: t.owner.token,
      body: { name: "a.docx", purpose: "待评审需求文档，各方对此文档评审", visibility: "shared", contentBase64: b64("# 需求 v3") },
    });
    expect(up.ok, JSON.stringify(up.error)).toBe(true);
    sharedDocId = up.data.doc.docId;
    expect(up.data.doc.visibility).toBe("shared");
    expect(up.data.doc.uploadedBy).toBe(t.owner.seatId);

    const poll = await call("GET", `/api/tables/${t.tableId}/poll?since=0&timeout=0`, { token: t.reviewer.token });
    const docMsg = poll.data.messages.find((m: any) => m.type === "DOC_UPLOADED");
    expect(docMsg).toBeTruthy();
    expect(docMsg.payload.doc.name).toBe("a.docx");
    expect(docMsg.payload.doc.purpose).toContain("待评审需求文档");
    expect(docMsg.payload.doc).not.toHaveProperty("contentBase64"); // 广播只含元数据
  });

  it("上传 private 文档与评审方资料；observer 不可上传", async () => {
    const priv = await call("POST", `/api/tables/${t.tableId}/documents`, {
      token: t.owner.token,
      body: { name: "c.md", purpose: "提案方内部底稿，仅本席使用", visibility: "private", contentBase64: b64("内部") },
    });
    expect(priv.ok).toBe(true);
    privateDocId = priv.data.doc.docId;

    const rev = await call("POST", `/api/tables/${t.tableId}/documents`, {
      token: t.reviewer.token,
      body: { name: "b.md", purpose: "调研原始资料，各方可参考", visibility: "shared", contentBase64: b64("调研…") },
    });
    expect(rev.ok).toBe(true);
    revDocId = rev.data.doc.docId;

    const obs = await call("POST", `/api/tables/${t.tableId}/documents`, {
      token: t.observer.token,
      body: { name: "o.md", purpose: "观察方补充材料", contentBase64: b64("…") },
    });
    expect(obs.status).toBe(403);
    expect(obs.error?.code).toBe("caps");
  });

  it("列表：私有文档他席可见存在但 downloadable=false；文件名路径成分被清洗", async () => {
    const dirty = await call("POST", `/api/tables/${v.tableId}/documents`, {
      token: v.owner.token,
      body: { name: "../../etc/计划.docx", purpose: "路径清洗用例", contentBase64: b64("x") },
    });
    expect(dirty.ok).toBe(true);
    expect(dirty.data.doc.name).not.toMatch(/[/\\]/);

    const revList = await call("GET", `/api/tables/${t.tableId}/documents`, { token: t.reviewer.token });
    const byId = new Map<string, any>(revList.data.documents.map((d: any) => [d.docId, d]));
    expect(byId.get(sharedDocId).downloadable).toBe(true);   // 他席 shared 可下
    expect(byId.get(revDocId).downloadable).toBe(true);       // 本席 private 可下
    expect(byId.get(privateDocId).downloadable).toBe(false);  // 他席 private 不可下
    expect(byId.get(privateDocId).purpose).toBe("提案方内部底稿，仅本席使用"); // 元数据可见

    const ownList = await call("GET", `/api/tables/${t.tableId}/documents`, { token: t.owner.token });
    expect(new Map<string, any>(ownList.data.documents.map((d: any) => [d.docId, d])).get(privateDocId).downloadable).toBe(true);
  });

  it("下载：共享全桌可下（含 observer）；他席私有 403；无席位用户 my 通道 403", async () => {
    const dl = await call("GET", `/api/tables/${t.tableId}/documents/${sharedDocId}`, { token: t.reviewer.token });
    expect(dl.ok).toBe(true);
    expect(Buffer.from(dl.data.contentBase64, "base64").toString("utf8")).toBe("# 需求 v3");

    const obsDl = await call("GET", `/api/tables/${t.tableId}/documents/${sharedDocId}`, { token: t.observer.token });
    expect(obsDl.ok).toBe(true); // observer 只读但可读共享投屏

    const denied = await call("GET", `/api/tables/${t.tableId}/documents/${privateDocId}`, { token: t.reviewer.token });
    expect(denied.status).toBe(403);
    expect(denied.error?.code).toBe("doc_private");

    const own = await call("GET", `/api/tables/${t.tableId}/documents/${privateDocId}`, { token: t.owner.token });
    expect(own.ok).toBe(true);

    const outsider = (await call("POST", "/api/users", { body: { name: "无席位者" } })).data.token;
    const noSeat = await call("GET", `/api/tables/${t.tableId}/my/documents/${sharedDocId}`, { token: outsider });
    expect(noSeat.status).toBe(403);
    expect(noSeat.error?.code).toBe("no_seat");
  });

  it("超 5MB 拒收（413）；缺 contentBase64 拒收（422）", async () => {
    const big = await call("POST", `/api/tables/${v.tableId}/documents`, {
      token: v.owner.token,
      body: { name: "big.bin", purpose: "超限用例", contentBase64: Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64") },
    });
    expect(big.status).toBe(413);
    expect(big.error?.code).toBe("too_large");

    const empty = await call("POST", `/api/tables/${v.tableId}/documents`, {
      token: v.owner.token, body: { name: "e.txt", purpose: "空内容" },
    });
    expect(empty.status).toBe(422);
  });

  it("my 通道（网页持有人 user token）上传成功并广播", async () => {
    const up = await call("POST", `/api/tables/${t.tableId}/my/documents`, {
      token: t.reviewerUser,
      body: { name: "d.md", purpose: "网页上传的评审补充说明", visibility: "shared", contentBase64: b64("补充") },
    });
    expect(up.ok, JSON.stringify(up.error)).toBe(true);
    expect(up.data.doc.uploadedBy).toBe(t.reviewer.seatId);
  });

  it("评审关联 docId：shared 文档可挂、他席私有/不存在被拒；纪要含资料清单", async () => {
    const s = await call("POST", `/api/tables/${t.tableId}/start`, { token: t.owner.token });
    expect(s.ok).toBe(true);

    await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.owner.token, body: { type: "STATEMENT", payload: { text: "提案：按 a.docx 需求文档推进，请各方评审。" } },
    });
    await call("POST", `/api/tables/${t.tableId}/artifacts`, {
      token: t.owner.token,
      body: { name: "方案.md", format: "md", contentBase64: b64("# 方案\n响应 a.docx 各条需求"), changeNote: "v1" },
    });

    const badDoc = await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.reviewer.token,
      body: { type: "REVIEW_COMMENT", payload: { docId: "doc_nope", items: [{ id: "r0", target: "全文", severity: "must", comment: "x" }] } },
    });
    expect(badDoc.status).toBe(404);
    const privateDoc = await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.reviewer.token,
      body: { type: "REVIEW_COMMENT", payload: { docId: privateDocId, items: [{ id: "r0b", target: "全文", severity: "must", comment: "x" }] } },
    });
    expect(privateDoc.status).toBe(403);

    const rc = await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.reviewer.token,
      body: {
        type: "REVIEW_COMMENT",
        payload: { docId: sharedDocId, items: [{ id: "rev-1", target: "a.docx §2", severity: "must", comment: "该条需求缺验收标准" }], done: true },
      },
    });
    expect(rc.ok, JSON.stringify(rc.error)).toBe(true);

    await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.owner.token,
      body: { type: "RESPONSE", payload: { items: [{ reviewItemId: "rev-1", decision: "defer", reason: "补验收标准后下轮确认" }] } },
    });
    await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.owner.token, body: { type: "CONSENSUS_VOTE", payload: { decision: "pass" } },
    });
    await call("POST", `/api/tables/${t.tableId}/messages`, {
      token: t.reviewer.token, body: { type: "CONSENSUS_VOTE", payload: { decision: "pass" } },
    });

    const poll = await call("GET", `/api/tables/${t.tableId}/poll?since=0&timeout=0`, { token: t.owner.token });
    const minutes = poll.data.messages.filter((m: any) => m.type === "MINUTES").at(-1);
    expect(minutes).toBeTruthy();
    expect(minutes.payload.markdown).toContain("桌内资料");
    expect(minutes.payload.markdown).toContain("a.docx");
    expect(minutes.payload.markdown).toContain("私有·仅本席");
  });

  it("闭桌后不可再上传，但可下载（档案）", async () => {
    const up = await call("POST", `/api/tables/${t.tableId}/documents`, {
      token: t.owner.token, body: { name: "late.md", purpose: "迟到资料", contentBase64: b64("x") },
    });
    expect(up.status).toBe(409);
    expect(up.error?.code).toBe("table_closed");

    const dl = await call("GET", `/api/tables/${t.tableId}/documents/${sharedDocId}`, { token: t.reviewer.token });
    expect(dl.ok).toBe(true);
  });
});

describe("旧数据兼容（直调 Store/Hub，不经 HTTP）", () => {
  it("缺 documents 的旧 state.json 可加载；旧席位 caps 缺 canUploadDocs 按 canPublish 兜底可上传", () => {
    const dir = mkdtempSync(join(tmpdir(), "rt-doc-legacy-"));
    const legacy = {
      users: {}, artifacts: {}, invites: {}, messages: {}, requests: [], audit: [], seatTokens: {}, seatOwners: {},
      tables: {
        tbl_old: {
          tableId: "tbl_old", topic: "旧桌", template: "review-collab", goals: "", deliverables: "",
          rules: "", rolePlan: "", ownerSeat: "seat_p", phase: "review", roundNo: 1, deadlockCount: 0,
          createdAt: 1, seatCount: 1, maxReviewRounds: 2, turnTimeoutMs: 300_000,
        },
      },
      seats: {
        "tbl_old:seat_p": {
          seatId: "seat_p", name: "旧提案方", role: "proposer",
          caps: { canPublish: true, canModifyOwn: true, canExecuteRequests: true, canSendRequests: true, canVote: true },
          agentLabel: "zcode", joinedAt: 1, status: "active",
          config: { stance: "s", scope: "", dataScope: [], ready: true },
        },
      },
    };
    writeFileSync(join(dir, "state.json"), JSON.stringify(legacy));
    const store: Store = new Store(dir);
    const hub = new Hub(store);
    const seat = hub.requireSeat("tbl_old", "seat_p");
    const doc = hub.uploadDocument("tbl_old", seat, {
      name: "legacy.docx", purpose: "旧席位补传资料", contentBase64: b64("legacy"),
    });
    expect(doc.visibility).toBe("shared");
    expect(hub.getDocument("tbl_old", hub.requireSeat("tbl_old", "seat_p"), doc.docId).name).toBe("legacy.docx");
    store.flushSync();
  });
});
