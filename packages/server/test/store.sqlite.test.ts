/** 存储层 SQLite + blob 驱动（任务 0010）：实体 CRUD 往返、重开持久、blob 去重、旧 state.json 自动迁移 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeEnvelope, resolveCaps, sha256 } from "@rt/shared";
import { Store } from "../src/store";
import type { ArtifactRecord, TableDocumentRecord } from "../src/model";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const mkSeat = (seatId: string, name: string, role: "proposer" | "reviewer" | "observer" = "reviewer") => ({
  seatId, name, role, caps: resolveCaps(role), agentLabel: "zcode", joinedAt: 1_000, status: "active" as const,
  config: { stance: "", scope: "", dataScope: [], ready: false },
});
const mkTable = (tableId: string) => ({
  tableId, topic: "测试桌", template: "review-collab" as const, goals: "", deliverables: "", rules: "",
  rolePlan: "", ownerSeat: "seat_a", phase: "open" as const, roundNo: 1, deadlockCount: 0,
  createdAt: 1_234, seatCount: 2, maxReviewRounds: 3, turnTimeoutMs: 60_000,
});

describe("Store（SQLite）实体往返与持久", () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-sqlite-"));
  const s = new Store(dir);

  it("用户/角色/禁用/token 哈希查询", () => {
    const uid = s.addUser("alice", sha256("t1"));
    expect(uid).toMatch(/^u_/);
    expect(s.findUserByToken("t1")?.userId).toBe(uid);
    expect(s.findUserByToken("wrong")).toBeNull();
    expect(s.setUserRole(uid, "systemadmin")).toBe(true);
    expect(s.getUser(uid)?.role).toBe("systemadmin");
    expect(s.setUserDisabled(uid, true)).toBe(true);
    expect(s.findUserByToken("t1")?.disabled).toBe(true);
    expect(s.listUsers().map((u) => u.name)).toContain("alice");
  });

  it("桌/席位/归属/token：保存即查，seatsOfUser 反查", () => {
    s.saveTable(mkTable("tbl_1"));
    s.saveSeat("tbl_1", mkSeat("seat_a", "甲", "proposer"));
    s.saveSeat("tbl_1", mkSeat("seat_b", "乙"));
    s.bindSeatOwner("tbl_1", "seat_a", "u_owner");
    s.saveSeatToken("st1", "tbl_1", "seat_a");
    expect(s.getTable("tbl_1")?.topic).toBe("测试桌");
    expect(s.getSeats("tbl_1").map((x) => x.seatId)).toEqual(["seat_a", "seat_b"]);
    expect(s.seatOwnerOf("tbl_1", "seat_a")).toBe("u_owner");
    expect(s.seatOfUser("tbl_1", "u_owner")).toBe("seat_a");
    expect(s.seatsOfUser("u_owner")).toEqual([{ tableId: "tbl_1", seatId: "seat_a" }]);
    expect(s.findSeatByToken("st1")).toEqual({ tableId: "tbl_1", seatId: "seat_a" });
    s.revokeSeatTokens("tbl_1", "seat_a");
    expect(s.findSeatByToken("st1")).toBeNull();
  });

  it("消息：seq 单调、since 增量、flags 落库", () => {
    const env = makeEnvelope({ tableId: "tbl_1", from: "seat_a", to: "all", type: "SPEAK", payload: { text: "hi" } });
    const m1 = s.addMessage("tbl_1", env, ["injection_suspect"]);
    const m2 = s.addMessage("tbl_1", makeEnvelope({ tableId: "tbl_1", from: "seat_a", to: "all", type: "SPEAK", payload: { text: "2" } }));
    expect(m1.seq).toBe(1);
    expect(m2.seq).toBe(2);
    expect(s.latestSeq("tbl_1")).toBe(2);
    expect(s.getMessages("tbl_1")[0].flags).toEqual(["injection_suspect"]);
    expect(s.getMessagesSince("tbl_1", 1).map((m) => m.seq)).toEqual([2]);
    expect(s.getMessages("tbl_1")[0].payload).toEqual({ text: "hi" });
  });

  it("邀请：消耗递减、过期/耗尽失效", () => {
    s.addInvite("inv1", "tbl_1", "reviewer");
    expect(s.consumeInvite("inv1")).toEqual({ tableId: "tbl_1", role: "reviewer" });
    expect(s.invitesOfTable("tbl_1")[0].usesLeft).toBe(9);
    expect(s.consumeInvite("nope")).toBeNull();
  });

  it("产物：版本元数据入库、内容外置 blob", () => {
    const sha = s.saveBlob(b64("v1 内容"));
    const sha2 = s.saveBlob(b64("v2 内容"));
    const rec: ArtifactRecord = {
      artifactId: "art_1", tableId: "tbl_1", name: "报告", format: "md", ownerSeat: "seat_a",
      versions: [
        { v: 1, sha256: sha, size: Buffer.byteLength("v1 内容"), changeNote: "init", publishedBy: "seat_a", ts: 1 },
        { v: 2, sha256: sha2, size: Buffer.byteLength("v2 内容"), changeNote: "改", publishedBy: "seat_a", ts: 2, diffFromPrev: "diff", requestId: "req_1" },
      ],
      lockedBy: null,
    };
    s.saveArtifact("tbl_1", rec);
    const got = s.getArtifact("tbl_1", "art_1");
    expect(got?.versions).toHaveLength(2);
    expect(got?.versions[1].diffFromPrev).toBe("diff");
    expect(got?.versions[1].requestId).toBe("req_1");
    expect(s.readBlob(sha).toString("utf8")).toBe("v1 内容");
    expect(s.readBlob(sha2).toString("utf8")).toBe("v2 内容");
  });

  it("文档：元数据 + hash 入库，blob 可回读", () => {
    const content = "资料文档内容 abc";
    const doc: TableDocumentRecord = {
      docId: "doc_1", name: "需求.md", purpose: "待评审", visibility: "shared",
      sha256: s.saveBlob(b64(content)), size: Buffer.byteLength(content),
      uploadedBy: "seat_a", uploadedAt: 9,
    };
    s.saveDocument("tbl_1", doc);
    const got = s.getDocument("tbl_1", "doc_1");
    expect(got?.name).toBe("需求.md");
    expect(s.readBlob(got!.sha256).toString("utf8")).toBe(content);
    expect(s.getDocuments("tbl_1")).toHaveLength(1);
  });

  it("审计：追加与最近读取", () => {
    s.appendAudit({ id: "aud_1", ts: 5, tableId: "tbl_1", seatId: "seat_a", event: "doc_upload", detail: { docId: "doc_1" } });
    expect(s.listAudit(10)[0].detail).toEqual({ docId: "doc_1" });
  });

  it("重开实例：全部数据仍在（SQLite 持久化）", () => {
    s.close();
    const s2 = new Store(dir);
    expect(s2.findUserByToken("t1")?.role).toBe("systemadmin");
    expect(s2.getTable("tbl_1")?.topic).toBe("测试桌");
    expect(s2.getMessages("tbl_1")).toHaveLength(2);
    expect(s2.getArtifact("tbl_1", "art_1")?.versions).toHaveLength(2);
    expect(s2.readBlob(s2.getDocument("tbl_1", "doc_1")!.sha256).toString("utf8")).toBe("资料文档内容 abc");
    expect(s2.seatOfUser("tbl_1", "u_owner")).toBe("seat_a");
    s2.close();
  });

  it("blob 去重：同内容重复保存同 hash、磁盘只一份文件", () => {
    const dir2 = mkdtempSync(join(tmpdir(), "rt-sqlite-blob-"));
    const st = new Store(dir2);
    const h1 = st.saveBlob(b64("重复内容"));
    const h2 = st.saveBlob(b64("重复内容"));
    expect(h1).toBe(h2);
    expect(readdirSync(join(dir2, "blobs")).filter((f) => !f.includes(".tmp"))).toHaveLength(1);
    st.close();
  });
});

describe("Store 旧 state.json 自动迁移", () => {
  const mkLegacy = () => {
    const dir = mkdtempSync(join(tmpdir(), "rt-sqlite-mig-"));
    const legacy = {
      users: { u_1: { userId: "u_1", name: "老用户", tokenHash: sha256("old_t"), createdAt: 1 } },
      tables: { tbl_old: mkTable("tbl_old") },
      seats: { "tbl_old:seat_a": mkSeat("seat_a", "甲", "proposer") },
      artifacts: {
        "tbl_old:art_old": {
          artifactId: "art_old", tableId: "tbl_old", name: "老产物", format: "md", ownerSeat: "seat_a",
          versions: [{ v: 1, contentBase64: b64("老内容"), changeNote: "init", publishedBy: "seat_a", ts: 1, size: 12 }],
          lockedBy: null,
        },
      },
      documents: { tbl_old: [{ docId: "doc_old", name: "老文档.txt", purpose: "资料", visibility: "shared", contentBase64: b64("老文档内容"), size: 18, uploadedBy: "seat_a", uploadedAt: 2 }] },
      invites: { inv_old: { code: "inv_old", tableId: "tbl_old", role: "reviewer", expiresAt: Date.now() + 86_400_000, usesLeft: 5 } },
      messages: {
        tbl_old: [{ ...makeEnvelope({ tableId: "tbl_old", from: "seat_a", to: "all", type: "SPEAK", payload: { text: "旧消息" } }), seq: 1, flags: ["legacy_flag"] }],
      },
      requests: {},
      audit: [{ id: "aud_old", ts: 1, tableId: "tbl_old", seatId: "seat_a", event: "table_open", detail: {} }],
      seatTokens: { [sha256("old_seat_t")]: { tableId: "tbl_old", seatId: "seat_a" } },
      seatOwners: { "tbl_old:seat_a": "u_1" },
    };
    writeFileSync(join(dir, "state.json"), JSON.stringify(legacy));
    return dir;
  };

  it("构造即迁移：入库 + blob 落盘 + 原 state.json 改名备份", () => {
    const dir = mkLegacy();
    const s = new Store(dir);
    expect(existsSync(join(dir, "state.json"))).toBe(false);
    expect(existsSync(join(dir, "state.json.migrated"))).toBe(true);
    // 实体全部入库
    expect(s.findUserByToken("old_t")?.name).toBe("老用户");
    expect(s.getTable("tbl_old")?.ownerSeat).toBe("seat_a");
    expect(s.getMessages("tbl_old")[0].flags).toEqual(["legacy_flag"]);
    expect(s.listAudit(5)[0].id).toBe("aud_old");
    expect(s.findSeatByToken("old_seat_t")).toEqual({ tableId: "tbl_old", seatId: "seat_a" });
    // 内容外置 blob 且可回读
    const doc = s.getDocument("tbl_old", "doc_old");
    expect(s.readBlob(doc!.sha256).toString("utf8")).toBe("老文档内容");
    const art = s.getArtifact("tbl_old", "art_old");
    expect(s.readBlob(art!.versions[0].sha256).toString("utf8")).toBe("老内容");
    // 迁移后新写入正常
    const seq2 = s.addMessage("tbl_old", makeEnvelope({ tableId: "tbl_old", from: "seat_a", to: "all", type: "SPEAK", payload: {} }));
    expect(seq2.seq).toBe(2);
    s.close();
    // 再开：数据仍在，且不会二次迁移
    const s2 = new Store(dir);
    expect(s2.getMessages("tbl_old")).toHaveLength(2);
    s2.close();
  });

  it("库非空时忽略旧文件（不迁移、不覆盖）", () => {
    const dir = mkLegacy();
    const seed = new Store(dir); // 触发迁移
    seed.addUser("新用户", sha256("new_t"));
    seed.close();
    // 人为放回一个 state.json：库非空 → 保留原文件不动
    const raw = JSON.parse(readFileSync(join(dir, "state.json.migrated"), "utf8"));
    writeFileSync(join(dir, "state.json"), JSON.stringify(raw));
    const s = new Store(dir);
    expect(existsSync(join(dir, "state.json"))).toBe(true);
    expect(s.listUsers().map((u) => u.name)).toContain("新用户");
    s.close();
  });
});
