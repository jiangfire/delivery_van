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

/** 班次：由「发新车」动作手动创建，code 即班次编码（如 DV2607A） */
export const vans = sqliteTable("vans", {
  code: text("code").primaryKey(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** 快件稀有度：N / R / SR / SSR / UR（仅标记，显示大写英文缩写） */
export const RARITIES = ["n", "r", "sr", "ssr", "ur"] as const;
export type Rarity = (typeof RARITIES)[number];

/** 旧六级稀有度 → 新五级的迁移映射（ensureSchema 启动时幂等 UPDATE 用），顶级两档归并 UR */
export const LEGACY_RARITY_TO: Record<string, Rarity> = {
  common: "n",
  uncommon: "r",
  rare: "sr",
  epic: "ssr",
  legendary: "ur",
  mythic: "ur",
};

/** @deprecated 委托概念已合并至快件，此表不再使用（rarity 为旧六级历史值，故不做枚举收窄） */
export const poolItems = sqliteTable("pool_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  rarity: text("rarity").notNull().default("common"),
  status: text("status", { enum: ["open", "scheduled", "done"] })
    .notNull()
    .default("open"),
  postedVan: text("posted_van"),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** 快件：发车会的核心载体 */
export const tasks = sqliteTable(
  "tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** 班次编码，如 DV2607A */
    vanCode: text("van_code").notNull(),
    title: text("title").notNull(),
    /** 稀有度标记（N/R/SR/SSR/UR，颜色），不做任何拦截 */
    rarity: text("rarity", { enum: RARITIES }).notNull().default("n"),
    /** 提出人：谁提的需求 */
    requester: text("requester"),
    /** @deprecated 已迁移至 task_owners 关联表 */
    ownerName: text("owner_name"),
    /** 档位：1 / 3 / 5 天 */
    size: integer("size"),
    /** 验收标准：周五凭什么说它做完了 */
    acceptance: text("acceptance"),
    /** 四态：未开始 / 进行中 / 完成 / 结转（结转由「滞留件转下一班」自动标记） */
    status: text("status", { enum: ["todo", "doing", "done", "carried"] })
      .notNull()
      .default("todo"),
    /** 结转自哪个车次 */
    carriedFrom: text("carried_from"),
    /** 连续滞留 ≥2 班触发强制复盘提示 */
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

export const taskOwners = sqliteTable("task_owners", {
  taskId: integer("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  ownerName: text("owner_name").notNull(),
});

export type Member = typeof members.$inferSelect;
export type Van = typeof vans.$inferSelect;
export type PoolItem = typeof poolItems.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type TaskOwner = typeof taskOwners.$inferSelect;
