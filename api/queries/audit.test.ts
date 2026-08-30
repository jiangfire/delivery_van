/* 链式审计日志（WP2）：序列化格式锁定、hash 链、verifyAuditChain、appendAudit 落库 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema";
import { auditLog } from "../../db/schema";

let mockDb: BetterSQLite3Database<typeof schema>;

vi.mock("./connection", () => ({
  getDb: vi.fn(() => mockDb),
}));

import { ensureSchema } from "../ensureSchema";
import {
  GENESIS_HASH,
  appendAudit,
  auditHash,
  fingerprintOf,
  serializeAudit,
  verifyAuditChain,
} from "./audit";

beforeEach(async () => {
  mockDb = drizzle(new Database(":memory:"), { schema });
  await ensureSchema();
});

describe("序列化格式锁定（评审补：防重构悄悄改格式导致全链校验失效）", () => {
  const row = {
    ts: 1770000000,
    actor: "张三",
    entity: "task",
    entityId: "42",
    field: "status",
    oldValue: null,
    newValue: "done",
    prevHash: GENESIS_HASH,
  };

  it("字段序 / JSON 编码 / U+001F 定界的规范字符串", () => {
    expect(serializeAudit(row)).toBe(
      [
        "1770000000",
        '"张三"',
        '"task"',
        '"42"',
        '"status"',
        "null",
        '"done"',
        `"${GENESIS_HASH}"`,
      ].join("\u001f"),
    );
  });

  it("hash = SHA256(规范字符串)，与独立实现一致", () => {
    const expected = createHash("sha256")
      .update(serializeAudit(row))
      .digest("hex");
    expect(auditHash(row)).toBe(expected);
  });
});

describe("appendAudit 落库", () => {
  it("读链尾→算 hash→插入，多条成链且 verify 通过", async () => {
    await appendAudit("张三", [
      { entity: "task", entityId: 1, field: "*", oldValue: null, newValue: '{"title":"甲"}' },
      { entity: "task", entityId: 1, field: "status", oldValue: "todo", newValue: "done" },
    ]);
    await appendAudit(undefined, [
      { entity: "member", entityId: "李四", field: "*", oldValue: null, newValue: "李四" },
    ]);

    const rows = await mockDb.select().from(auditLog).orderBy(auditLog.id);
    expect(rows).toHaveLength(3);
    // actor 缺省 '(unknown)'（软身份）
    expect(rows.map((r) => r.actor)).toEqual(["张三", "张三", "(unknown)"]);
    // 链头从创世哈希起，逐条 prev_hash 指向前一条 hash
    expect(rows[0].prevHash).toBe(GENESIS_HASH);
    expect(rows[1].prevHash).toBe(rows[0].hash);
    expect(rows[2].prevHash).toBe(rows[1].hash);
    expect(verifyAuditChain(rows)).toBeNull();
  });

  it("跨 entity 混合写入（task / member / van）不断链", async () => {
    await appendAudit("张三", [
      { entity: "van", entityId: "DV2608A", field: "*", oldValue: null, newValue: "DV2608A" },
      { entity: "task", entityId: 9, field: "carry", oldValue: "DV2607A", newValue: "DV2608A" },
      { entity: "member", entityId: "王五", field: "*", oldValue: null, newValue: "王五" },
    ]);
    const rows = await mockDb.select().from(auditLog).orderBy(auditLog.id);
    expect(verifyAuditChain(rows)).toBeNull();
    expect(rows.map((r) => r.entity)).toEqual(["van", "task", "member"]);
  });
});

describe("verifyAuditChain 篡改检测", () => {
  async function seed() {
    await appendAudit("张三", [
      { entity: "task", entityId: 1, field: "*", oldValue: null, newValue: "a" },
      { entity: "task", entityId: 1, field: "status", oldValue: "todo", newValue: "done" },
      { entity: "task", entityId: 2, field: "note", oldValue: "(text)", newValue: "(text)" },
    ]);
    return mockDb.select().from(auditLog).orderBy(auditLog.id);
  }

  it("完好链返回 null，空链也返回 null", async () => {
    expect(verifyAuditChain([])).toBeNull();
    expect(verifyAuditChain(await seed())).toBeNull();
  });

  it("篡改 old_value / actor / hash 后返回首个断点下标", async () => {
    const rows = await seed();

    rows[1].oldValue = "doing"; // 篡改内容 → 该行 hash 不符
    expect(verifyAuditChain(rows)).toBe(1);

    const fresh = await seed();
    fresh[0].actor = "李四"; // 篡改链头内容 → 下标 0 断
    expect(verifyAuditChain(fresh)).toBe(0);

    const again = await seed();
    again[2].hash = "f".repeat(64); // 篡改行自身 hash → 该行断，且后续 prev_hash 随之不符
    expect(verifyAuditChain(again)).toBe(2);
  });

  it("删除中间行（prev_hash 对不上前驱）在缺口处报断链", async () => {
    const rows = await seed();
    const gapped = [rows[0], rows[2]];
    expect(verifyAuditChain(gapped)).toBe(1);
  });

  it("直接 UPDATE 库中记录后重读校验也断链（对抗落库后篡改）", async () => {
    await seed();
    await mockDb
      .update(auditLog)
      .set({ newValue: "tampered" })
      .where(eq(auditLog.id, 2));
    const rows = await mockDb.select().from(auditLog).orderBy(auditLog.id);
    expect(verifyAuditChain(rows)).toBe(1);
  });
});

describe("fingerprintOf（日志指纹 = 链头 hash 前 8 位）", () => {
  it("取前 8 位十六进制，空值返回 null", () => {
    expect(fingerprintOf("a1b2c3d4e5f6")).toBe("a1b2c3d4");
    expect(fingerprintOf(null)).toBeNull();
    expect(fingerprintOf(undefined)).toBeNull();
  });
});
