import { sql } from "drizzle-orm";
import { customType, index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { CARRY_REASONS, SOURCES } from "../contracts/enums";
import { RARITIES } from "./schema";

/**
 * Unix 秒整数时间戳列：JS 侧读出 Date（与 sqlite 版 integer mode:'timestamp'
 * 行形状一致），库内仍存整数秒（审计链字节确定性要求）。
 */
const unixTs = customType<{ data: Date; driverData: number }>({
  dataType() {
    return "integer";
  },
  toDriver: (v) => Math.floor(v.getTime() / 1000),
  fromDriver: (v) => new Date(Number(v) * 1000),
});

/** 团队成员 */
export const members = pgTable("members", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull().unique(),
  /** 每周可用运力（点数）：接口层默认 10，列默认 5 仅建表兜底 */
  capacity: integer("capacity").notNull().default(5),
  createdAt: unixTs("created_at")
    .notNull()
    .default(sql`(extract(epoch from now()))::int`),
});

/** 班次：由「发新车」动作手动创建，code 即班次编码（如 DV2607A） */
export const vans = pgTable("vans", {
  code: text("code").primaryKey(),
  createdAt: unixTs("created_at")
    .notNull()
    .default(sql`(extract(epoch from now()))::int`),
});

/** @deprecated 委托概念已合并至快件，此表不再使用（rarity 为旧六级历史值，故不做枚举收窄） */
export const poolItems = pgTable("pool_items", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  title: text("title").notNull(),
  rarity: text("rarity").notNull().default("common"),
  status: text("status", { enum: ["open", "scheduled", "done"] })
    .notNull()
    .default("open"),
  postedVan: text("posted_van"),
  note: text("note"),
  createdAt: unixTs("created_at")
    .notNull()
    .default(sql`(extract(epoch from now()))::int`),
});

/** 快件：发车会的核心载体 */
export const tasks = pgTable(
  "tasks",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    /** 班次编码，如 DV2607A */
    vanCode: text("van_code").notNull(),
    title: text("title").notNull(),
    /** 稀有度标记（N/R/SR/SSR/UR，颜色），不做任何拦截 */
    rarity: text("rarity", { enum: RARITIES }).notNull().default("n"),
    /** 提出人：谁提的需求 */
    requester: text("requester"),
    /**
     * @deprecated v2.5 每人点数制起废弃：点数归属到人（`task_owners.points`），
     * 任务点数 = 各负责人点数之和。列保留不读写，历史值仅供追溯与一次性回填。
     */
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
    /** 班次内手动排序序号（拖拽排序），班次内按 sort_order ASC, id ASC 展示 */
    sortOrder: integer("sort_order"),
    /** 快件来源（三方占比口径）：v2.0 起采集，存量统一回填 customer */
    source: text("source", { enum: SOURCES }).notNull().default("customer"),
    /** 结转原因（五枚举，可空 = 未分类），swap 让位原因 Phase 2 另加 */
    carryReason: text("carry_reason", { enum: CARRY_REASONS }),
    /** 签收人（WP3 签收制：done 后由提出人签收；无提出人的自驱件不落库视同签收） */
    confirmedBy: text("confirmed_by"),
    /** 签收日期 YYYY-MM-DD */
    confirmedAt: text("confirmed_at"),
    createdAt: unixTs("created_at")
      .notNull()
      .default(sql`(extract(epoch from now()))::int`),
  },
  (t) => [index("tasks_van_code_idx").on(t.vanCode)],
);

/**
 * 快件负责人（v2.5 起为「每人一份的点数」叶子表）：`points` 是点数的唯一来源——
 * 每人在同一件上各自持有自己的点数，任务点数 = 各负责人点数之和（`contracts/points.ts`）。
 */
export const taskOwners = pgTable("task_owners", {
  taskId: integer("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  ownerName: text("owner_name").notNull(),
  /**
   * 该负责人在这件上的点数（0~10 整数，1 点 = 半天；0 = 挂名不占运力）。
   * 列默认 0 只为幂等补列时存量行必须有值；运行时点数一律由人显式设置（API 层必填）。
   */
  points: integer("points").notNull().default(0),
  /**
   * 该负责人的完成日期 YYYY-MM-DD（v2.6 逐人完成）：非空 = 已交付。
   * 无布尔完成标记——`done_at IS NOT NULL` 就是完成，与「打勾即记日期、取消即清空」同构。
   */
  doneAt: text("done_at"),
  /** 提出人对该人交付的签收日期 YYYY-MM-DD（v2.6 逐人签收） */
  confirmedAt: text("confirmed_at"),
  /** 签收人（软身份，惯例是提出人本人） */
  confirmedBy: text("confirmed_by"),
});

/**
 * 链式审计日志（WP2）：hash 链记录一切写操作。
 * hash = SHA256(prev_hash ‖ 本行内容序列化)，序列化格式锁定在 queries/audit.ts。
 * ts 为 Unix 秒原始整数（不经过 timestamp 模式），保证入链字节确定。
 */
export const auditLog = pgTable("audit_log", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  ts: integer("ts").notNull(),
  /** 操作人标签（软身份，缺省 '(unknown)'） */
  actor: text("actor").notNull(),
  /** 实体类型：'task' | 'member' | 'van' | ... */
  entity: text("entity").notNull(),
  entityId: text("entity_id").notNull(),
  /** 变更字段，整行新增/删除记 '*' */
  field: text("field").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
});
