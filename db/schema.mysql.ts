import { sql } from "drizzle-orm";
import {
  customType,
  index,
  int,
  mysqlTable,
  text,
  varchar,
} from "drizzle-orm/mysql-core";
import { CARRY_REASONS, SOURCES } from "../contracts/enums";
import { RARITIES } from "./schema";

/**
 * Unix 秒整数时间戳列：JS 侧读出 Date（与 sqlite 版 integer mode:'timestamp'
 * 行形状一致），库内仍存整数秒（审计链字节确定性要求）。
 */
const unixTs = customType<{ data: Date; driverData: number }>({
  dataType() {
    return "int";
  },
  toDriver: (v) => Math.floor(v.getTime() / 1000),
  fromDriver: (v) => new Date(Number(v) * 1000),
});

/**
 * MySQL 的 TEXT 列不允许字面量默认值，凡带默认值/唯一约束的字符串列
 * 一律用 varchar（utf8mb4 唯一索引长度上限 → members.name 用 191）。
 */

/** 团队成员 */
export const members = mysqlTable("members", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 191 }).notNull().unique(),
  /** 每周可用容量（天），默认 5，请假/支持时扣减 */
  capacity: int("capacity").notNull().default(5),
  createdAt: unixTs("created_at")
    .notNull()
    .default(sql`(unix_timestamp())`),
});

/** 班次：由「发新车」动作手动创建，code 即班次编码（如 DV2607A） */
export const vans = mysqlTable("vans", {
  code: varchar("code", { length: 16 }).primaryKey(),
  createdAt: unixTs("created_at")
    .notNull()
    .default(sql`(unix_timestamp())`),
});

/** @deprecated 委托概念已合并至快件，此表不再使用（rarity 为旧六级历史值，故不做枚举收窄） */
export const poolItems = mysqlTable("pool_items", {
  id: int("id").autoincrement().primaryKey(),
  title: text("title").notNull(),
  rarity: varchar("rarity", { length: 16 }).notNull().default("common"),
  status: varchar("status", {
    length: 16,
    enum: ["open", "scheduled", "done"],
  })
    .notNull()
    .default("open"),
  postedVan: text("posted_van"),
  note: text("note"),
  createdAt: unixTs("created_at")
    .notNull()
    .default(sql`(unix_timestamp())`),
});

/** 快件：发车会的核心载体 */
export const tasks = mysqlTable(
  "tasks",
  {
    id: int("id").autoincrement().primaryKey(),
    /** 班次编码，如 DV2607A */
    vanCode: varchar("van_code", { length: 16 }).notNull(),
    title: text("title").notNull(),
    /** 稀有度标记（N/R/SR/SSR/UR，颜色），不做任何拦截 */
    rarity: varchar("rarity", { length: 16, enum: RARITIES })
      .notNull()
      .default("n"),
    /** 提出人：谁提的需求 */
    requester: varchar("requester", { length: 64 }),
    /** 档位（半天点数制）：1~10 整数，1 点 = 半天，10 点 = 5 天 */
    size: int("size"),
    /** 验收标准：周五凭什么说它做完了 */
    acceptance: text("acceptance"),
    /** 四态：未开始 / 进行中 / 完成 / 结转（结转由「滞留件转下一班」自动标记） */
    status: varchar("status", {
      length: 16,
      enum: ["todo", "doing", "done", "carried"],
    })
      .notNull()
      .default("todo"),
    /** 结转自哪个车次 */
    carriedFrom: varchar("carried_from", { length: 16 }),
    /** 连续滞留 ≥2 班触发强制复盘提示 */
    carryCount: int("carry_count").notNull().default(0),
    /** 完成日期，YYYY-MM-DD */
    doneAt: varchar("done_at", { length: 16 }),
    note: text("note"),
    /** 班次内手动排序序号（拖拽排序），班次内按 sort_order ASC, id ASC 展示 */
    sortOrder: int("sort_order"),
    /** 快件来源（三方占比口径）：v2.0 起采集，存量统一回填 customer */
    source: varchar("source", { length: 16, enum: SOURCES })
      .notNull()
      .default("customer"),
    /** 结转原因（五枚举，可空 = 未分类），swap 让位原因 Phase 2 另加 */
    carryReason: varchar("carry_reason", { length: 32, enum: CARRY_REASONS }),
    /** 签收人（WP3 签收制：done 后由提出人签收；无提出人的自驱件不落库视同签收） */
    confirmedBy: varchar("confirmed_by", { length: 64 }),
    /** 签收日期 YYYY-MM-DD */
    confirmedAt: varchar("confirmed_at", { length: 16 }),
    createdAt: unixTs("created_at")
      .notNull()
      .default(sql`(unix_timestamp())`),
  },
  (t) => [index("tasks_van_code_idx").on(t.vanCode)],
);

export const taskOwners = mysqlTable("task_owners", {
  taskId: int("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  ownerName: varchar("owner_name", { length: 64 }).notNull(),
});

/**
 * 链式审计日志（WP2）：hash 链记录一切写操作。
 * hash = SHA256(prev_hash ‖ 本行内容序列化)，序列化格式锁定在 queries/audit.ts。
 * ts 为 Unix 秒原始整数（不经过 timestamp 模式），保证入链字节确定。
 */
export const auditLog = mysqlTable("audit_log", {
  id: int("id").autoincrement().primaryKey(),
  ts: int("ts").notNull(),
  /** 操作人标签（软身份，缺省 '(unknown)'） */
  actor: varchar("actor", { length: 64 }).notNull(),
  /** 实体类型：'task' | 'member' | 'van' | ... */
  entity: varchar("entity", { length: 32 }).notNull(),
  entityId: varchar("entity_id", { length: 191 }).notNull(),
  /** 变更字段，整行新增/删除记 '*' */
  field: varchar("field", { length: 64 }).notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  prevHash: varchar("prev_hash", { length: 64 }).notNull(),
  hash: varchar("hash", { length: 64 }).notNull(),
});
