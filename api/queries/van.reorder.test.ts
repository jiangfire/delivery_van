/* 行拖拽排序：用内存 SQLite 跑真实 ensureSchema + 数据层（与 ensureSchema.test.ts 同模式） */
import { describe, expect, it, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { TRPCError } from "@trpc/server";
import * as schema from "../../db/schema";

let mockDb: BetterSQLite3Database<typeof schema>;

vi.mock("./connection", () => ({
  getDb: vi.fn(() => mockDb),
}));

import { ensureSchema } from "../ensureSchema";
import { addTask, carryOver, listTasksByVan, reorderTasks } from "./van";

beforeEach(async () => {
  mockDb = drizzle(new Database(":memory:"), { schema });
  await ensureSchema();
});

describe("行拖拽排序", () => {
  it("新快件追加到班次末尾，列表按 sort_order 排序", async () => {
    await addTask({ van: "DV2607A", title: "甲" });
    await addTask({ van: "DV2607A", title: "乙" });
    await addTask({ van: "DV2607A", title: "丙" });

    const list = await listTasksByVan("DV2607A");
    expect(list.map((t) => t.title)).toEqual(["甲", "乙", "丙"]);
  });

  it("reorderTasks 按传入 id 顺序全量重写并持久化", async () => {
    await addTask({ van: "DV2607A", title: "甲" });
    await addTask({ van: "DV2607A", title: "乙" });
    await addTask({ van: "DV2607A", title: "丙" });
    const [a, b, c] = await listTasksByVan("DV2607A");

    await reorderTasks("DV2607A", [c.id, a.id, b.id]);

    const list = await listTasksByVan("DV2607A");
    expect(list.map((t) => t.title)).toEqual(["丙", "甲", "乙"]);
  });

  it("排序列表必须恰好覆盖本班快件：缺行或混入别班 id 都拒绝", async () => {
    await addTask({ van: "DV2607A", title: "甲" });
    await addTask({ van: "DV2607A", title: "乙" });
    await addTask({ van: "DV2607B", title: "别班件" });
    const [a, b] = await listTasksByVan("DV2607A");
    const [other] = await listTasksByVan("DV2607B");

    await expect(reorderTasks("DV2607A", [a.id])).rejects.toThrow(TRPCError);
    await expect(reorderTasks("DV2607A", [a.id, other.id])).rejects.toThrow(
      TRPCError,
    );
    await expect(
      reorderTasks("DV2607A", [a.id, b.id, other.id]),
    ).rejects.toThrow(TRPCError);
    // 原有顺序未被破坏
    const list = await listTasksByVan("DV2607A");
    expect(list.map((t) => t.title)).toEqual(["甲", "乙"]);
  });

  it("归档班次禁止调整顺序", async () => {
    await mockDb.insert(schema.vans).values({ code: "DV2607A" });
    await addTask({ van: "DV2607A", title: "滞留件" });
    await carryOver("DV2607A", "DV2607B", new Date(2026, 6, 20));
    const [a] = await listTasksByVan("DV2607A");

    await expect(reorderTasks("DV2607A", [a.id])).rejects.toThrow(TRPCError);
  });

  it("结转快件追加到目标班末尾", async () => {
    await mockDb
      .insert(schema.vans)
      .values([{ code: "DV2607A" }, { code: "DV2607B" }]);
    await addTask({ van: "DV2607B", title: "本班原有" });
    await addTask({ van: "DV2607A", title: "滞留件" });

    await carryOver("DV2607A", "DV2607B", new Date(2026, 6, 20));

    const list = await listTasksByVan("DV2607B");
    expect(list.map((t) => t.title)).toEqual(["本班原有", "滞留件"]);
  });
});
