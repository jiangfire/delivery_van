/* 写路径内存库回归（发新车 / 成员 / 快件增改删 / 签收）+ 审计同事务原子性。
 * 与 van.reorder.test.ts 同模式：内存 SQLite 跑真实 ensureSchema + 数据层；
 * van.mock.test.ts 只保留并发异常注入等无法在真实库模拟的用例。 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { TRPCError } from "@trpc/server";
import * as schema from "../../db/schema";

let mockDb: BetterSQLite3Database<typeof schema>;

vi.mock("./connection", () => ({
  getDb: vi.fn(() => mockDb),
}));

import { ensureSchema } from "../ensureSchema";
import {
  addMember,
  addTask,
  dispatchVan,
  listMembers,
  listTasksByVan,
  listVans,
  removeTask,
  updateTask,
} from "./van";
import { auditLog } from "../../db/schema";
import { todayStr } from "../../contracts/vans";

beforeEach(async () => {
  mockDb = drizzle(new Database(":memory:"), { schema });
  await ensureSchema();
});

describe("发新车（内存库）", () => {
  it("空表时创建当月首班车，并进审计链", async () => {
    const result = await dispatchVan(new Date(2026, 6, 15), "张三");
    expect(result).toEqual(["DV2607A"]);
    const rows = await mockDb.select().from(auditLog);
    expect(rows[0].entity).toBe("van");
    expect(rows[0].actor).toBe("张三");
  });

  it("已有班次时同月自动递增", async () => {
    await dispatchVan(new Date(2026, 6, 15));
    const result = await dispatchVan(new Date(2026, 6, 20));
    expect(result).toEqual(["DV2607B", "DV2607A"]);
  });

  it("跨月发新车从新月份 A 重新计数", async () => {
    await dispatchVan(new Date(2026, 6, 15)); // DV2607A
    const result = await dispatchVan(new Date(2026, 7, 5)); // 8 月 → DV2608A
    expect(result).toEqual(["DV2608A", "DV2607A"]);
  });
});

describe("成员（内存库）", () => {
  it("正常添加新成员", async () => {
    const result = await addMember("张三", 10);
    expect(result).toEqual([
      { id: 1, name: "张三", capacity: 10, createdAt: expect.any(Date) },
    ]);
  });

  it("重名时抛出 CONFLICT 错误", async () => {
    await addMember("张三", 10);
    await expect(addMember("张三", 5)).rejects.toThrow(TRPCError);
    await expect(addMember("张三", 5)).rejects.toThrow("已存在");
    expect(await listMembers()).toHaveLength(1);
  });
});

describe("快件增删改（内存库）", () => {
  it("创建快件时写入负责人标签，排在班次末尾", async () => {
    await addTask({ van: "DV2607A", title: "甲" });
    await addTask({
      van: "DV2607A",
      title: "乙",
      owners: ["张三", "李四"],
      source: "exploration",
    });
    const list = await listTasksByVan("DV2607A");
    expect(list.map((t) => t.title)).toEqual(["甲", "乙"]);
    expect(list[1].owners).toEqual(["张三", "李四"]);
    expect(list[1].source).toBe("exploration");
    expect(list[0].source).toBe("customer"); // 默认客户件
  });

  it("更新快件状态时自动填充完成日期，未签收", async () => {
    await addTask({ van: "DV2607A", title: "甲" });
    const [t] = await listTasksByVan("DV2607A");
    const list = await updateTask(t.id, { status: "done" });
    expect(list[0].doneAt).toBe(todayStr());
    expect(list[0].confirmedAt).toBeNull();
  });

  it("取消完成时清空完成日期", async () => {
    await addTask({ van: "DV2607A", title: "甲" });
    const [t] = await listTasksByVan("DV2607A");
    await updateTask(t.id, { status: "done" });
    const list = await updateTask(t.id, { status: "todo" });
    expect(list[0].doneAt).toBeNull();
  });

  it("仅更新负责人时不动任务行字段（状态与日期保持）", async () => {
    await addTask({ van: "DV2607A", title: "甲" });
    const [t] = await listTasksByVan("DV2607A");
    await updateTask(t.id, { status: "done" });
    const list = await updateTask(t.id, { owners: ["张三"] });
    expect(list[0].owners).toEqual(["张三"]);
    expect(list[0].status).toBe("done");
    expect(list[0].doneAt).toBe(todayStr());
  });

  it("显式送达日期不被当天覆盖，删除快件后列表为空", async () => {
    await addTask({ van: "DV2607A", title: "甲" });
    const [t] = await listTasksByVan("DV2607A");
    const list = await updateTask(t.id, {
      status: "done",
      doneAt: "2026-07-20",
    });
    expect(list[0].doneAt).toBe("2026-07-20");

    await removeTask(t.id);
    expect(await listTasksByVan("DV2607A")).toHaveLength(0);
  });
});

describe("审计与业务写同事务（原子性）", () => {
  it("审计写入失败时业务写一并回滚，不留未记账的写", async () => {
    await mockDb.run(sql`DROP TABLE audit_log`);

    await expect(addTask({ van: "DV2607A", title: "甲" })).rejects.toThrow();
    // 回滚生效：快件没有落库
    expect(await listTasksByVan("DV2607A")).toHaveLength(0);
    expect(await listVans()).toEqual([]);
  });
});
