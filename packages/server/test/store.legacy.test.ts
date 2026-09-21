/** 存储层兼容性：旧格式 state.json（缺后来新增的字段，如 seatOwners）加载不崩、缺字段补默认值 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store";

describe("Store 旧格式 state 兼容", () => {
  it("缺 seatOwners 的旧 state.json 可加载，bindSeatOwner 不再抛 undefined", () => {
    const dir = mkdtempSync(join(tmpdir(), "rt-store-legacy-"));
    const legacy = { users: {}, tables: {}, seats: {}, artifacts: {}, invites: {}, messages: {}, requests: [], audit: [], seatTokens: {} };
    writeFileSync(join(dir, "state.json"), JSON.stringify(legacy));
    const store = new Store(dir);
    store.bindSeatOwner("tbl_x", "seat_y", "u_z");
    expect(store.seatOwnerOf("tbl_x", "seat_y")).toBe("u_z");
    store.flushSync();
  });

  it("空目录全新初始化仍可用，且多实例不共享嵌套状态", () => {
    const a = new Store(mkdtempSync(join(tmpdir(), "rt-store-fresh-")));
    const b = new Store(mkdtempSync(join(tmpdir(), "rt-store-fresh-")));
    expect(a.seatOwnerOf("tbl_x", "seat_y")).toBeNull();
    a.bindSeatOwner("tbl_x", "seat_y", "u_z");
    expect(b.seatOwnerOf("tbl_x", "seat_y")).toBeNull();
    expect(a.addUser("alice", "h1")).toMatch(/^u_/);
    expect(b.getSeats("tbl_x")).toEqual([]);
  });
});
