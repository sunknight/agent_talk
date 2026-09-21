/** 通用工具：信封构造、ID、能力合并 */
import { randomUUID, createHash } from "node:crypto";
import type { Caps, Envelope, MsgType, Role } from "./types";
import { ROLE_PRESETS } from "./types";

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}${randomUUID().slice(0, 8)}`;
}

export function makeEnvelope(opts: {
  tableId: string; from: string; to: string; type: MsgType; payload: unknown;
}): Envelope {
  return {
    v: 1, tableId: opts.tableId, msgId: newId("msg"),
    fromSeat: opts.from, toSeat: opts.to, type: opts.type,
    payload: opts.payload, ts: Date.now(),
  };
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** 角色预设 + 覆盖（只允许收紧，不允许放宽超出预设） */
export function resolveCaps(role: Role, override?: Partial<Caps>): Caps {
  const base = ROLE_PRESETS[role];
  const merged: Caps = { ...base };
  if (override) {
    for (const k of Object.keys(base) as (keyof Caps)[]) {
      if (typeof override[k] === "boolean") {
        // 只能收紧：预设为 false 的不能被覆盖成 true
        merged[k] = (base[k] || false) && (override[k] as boolean);
      }
    }
  }
  return merged;
}

export function decodeB64(s: string): Buffer {
  return Buffer.from(s, "base64");
}

export function encodeB64(b: Buffer | string): string {
  return Buffer.from(b).toString("base64");
}
