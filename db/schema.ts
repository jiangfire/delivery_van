import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** 团队成员 */
export const members = sqliteTable("members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  /** 每周可用容量（天），默认 5，请假/支持时扣减 */
  capacity: integer("capacity").notNull().default(5),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** 需求池：PM 维护，Epic 需切片后才能上车 */
export const poolItems = sqliteTable("pool_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  type: text("type", { enum: ["epic", "ready"] })
    .notNull()
    .default("ready"),
  status: text("status", { enum: ["open", "scheduled", "done"] })
    .notNull()
    .default("open"),
  /** 目标班次：PM 期望上车的周次，仅意向（如 DV2607A） */
  targetVan: text("target_van"),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** 周任务：发车会的核心载体 */
export const tasks = sqliteTable(
  "tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** 班次编码，如 DV2607A（= 2026 年 7 月第一个发车，见 contracts/vans.ts） */
    vanCode: text("van_code").notNull(),
    title: text("title").notNull(),
    /** 关联需求池条目 */
    poolItemId: integer("pool_item_id"),
    /** 负责人姓名（小团队无账号体系，直接存名） */
    ownerName: text("owner_name"),
    /** 档位：1 / 3 / 5 天 */
    size: integer("size"),
    /** 验收标准：周五凭什么说它做完了 */
    acceptance: text("acceptance"),
    status: text("status", { enum: ["todo", "doing", "done"] })
      .notNull()
      .default("todo"),
    /** 结转自哪个车次 */
    carriedFrom: text("carried_from"),
    /** 连续滞留 ≥2 班触发强制复盘提示（仅提示不拦截，可继续结转） */
    carryCount: integer("carry_count").notNull().default(0),
    /** 完成日期，YYYY-MM-DD */
    doneAt: text("done_at"),
    note: text("note"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("tasks_van_code_idx").on(t.vanCode)],
);

export type Member = typeof members.$inferSelect;
export type PoolItem = typeof poolItems.$inferSelect;
export type Task = typeof tasks.$inferSelect;
