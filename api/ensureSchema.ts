import { getDb } from "./queries/connection";
import { LEGACY_RARITY_TO } from "../db/schema";
import { sql } from "drizzle-orm";

/**
 * 启动时幂等确保表结构存在（CREATE TABLE IF NOT EXISTS）。
 * 与 db/schema.ts 保持一致；新增列/表时同步更新此处。
 */
export async function ensureSchema() {
  const db = getDb();
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS members (
      id integer PRIMARY KEY AUTOINCREMENT,
      name text NOT NULL UNIQUE,
      capacity integer NOT NULL DEFAULT 5,
      created_at integer NOT NULL DEFAULT (unixepoch())
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS vans (
      code text PRIMARY KEY,
      created_at integer NOT NULL DEFAULT (unixepoch())
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS pool_items (
      id integer PRIMARY KEY AUTOINCREMENT,
      title text NOT NULL,
      rarity text NOT NULL DEFAULT 'common',
      status text NOT NULL DEFAULT 'open',
      posted_van text,
      note text,
      created_at integer NOT NULL DEFAULT (unixepoch())
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id integer PRIMARY KEY AUTOINCREMENT,
      van_code text NOT NULL,
      title text NOT NULL,
      rarity text NOT NULL DEFAULT 'n',
      requester text,
      size integer,
      acceptance text,
      status text NOT NULL DEFAULT 'todo',
      carried_from text,
      carry_count integer NOT NULL DEFAULT 0,
      done_at text,
      note text,
      sort_order integer,
      source text NOT NULL DEFAULT 'customer',
      carry_reason text,
      confirmed_by text,
      confirmed_at text,
      created_at integer NOT NULL DEFAULT (unixepoch())
    )
  `);
  // 兼容旧库：tasks 表可能没有 rarity 列，幂等添加
  try {
    db.run(sql`ALTER TABLE tasks ADD COLUMN rarity text NOT NULL DEFAULT 'n'`);
  } catch {
    // 列已存在，忽略
  }
  // 稀有度五级重构（N/R/SR/SSR/UR）：把旧六级存量值幂等迁移到新值域，旧值迁移后不再存在
  for (const [from, to] of Object.entries(LEGACY_RARITY_TO)) {
    await db.run(sql`UPDATE tasks SET rarity = ${to} WHERE rarity = ${from}`);
  }
  // 兼容旧库：tasks 表可能没有 requester 列，幂等添加
  try {
    db.run(sql`ALTER TABLE tasks ADD COLUMN requester text`);
  } catch {
    // 列已存在，忽略
  }
  // 兼容旧库：tasks 表可能没有 sort_order 列（行内拖拽排序），幂等添加；
  // 存量行按 id 顺序回填，保持升级前后展示顺序一致
  try {
    db.run(sql`ALTER TABLE tasks ADD COLUMN sort_order integer`);
  } catch {
    // 列已存在，忽略
  }
  await db.run(sql`UPDATE tasks SET sort_order = id WHERE sort_order IS NULL`);
  // v2.0 兼容旧库：source（三方占比口径，存量统一客户件）与结转原因列，幂等添加
  try {
    db.run(sql`ALTER TABLE tasks ADD COLUMN source text NOT NULL DEFAULT 'customer'`);
  } catch {
    // 列已存在，忽略
  }
  try {
    db.run(sql`ALTER TABLE tasks ADD COLUMN carry_reason text`);
  } catch {
    // 列已存在，忽略
  }
  // v2.0 签收制：confirmed_by / confirmed_at 列，幂等添加
  try {
    db.run(sql`ALTER TABLE tasks ADD COLUMN confirmed_by text`);
  } catch {
    // 列已存在，忽略
  }
  try {
    db.run(sql`ALTER TABLE tasks ADD COLUMN confirmed_at text`);
  } catch {
    // 列已存在，忽略
  }
  // 链式审计日志表（WP2）：只追加不改写，读链校验见 queries/audit.ts
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS audit_log (
      id integer PRIMARY KEY AUTOINCREMENT,
      ts integer NOT NULL,
      actor text NOT NULL,
      entity text NOT NULL,
      entity_id text NOT NULL,
      field text NOT NULL,
      old_value text,
      new_value text,
      prev_hash text NOT NULL,
      hash text NOT NULL
    )
  `);
  await db.run(
    sql`CREATE INDEX IF NOT EXISTS tasks_van_code_idx ON tasks (van_code)`,
  );
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS task_owners (
      task_id integer NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      owner_name text NOT NULL
    )
  `);
  // 半天点数制迁移：旧三档 1/3/5 天 ×2 变 2/6/10 点，成员运力 ≤7 天 ×2。
  // 用 PRAGMA user_version 作迁移标记保证只执行一次——值域迁移无法幂等
  // （迁移后新写入的 1/3/5 点与旧天数值撞车），新库表为空时 UPDATE 为 no-op。
  const [versionRow] = await db.all<{ user_version: number }>(
    sql`PRAGMA user_version`,
  );
  if (versionRow.user_version === 0) {
    await db.run(sql`UPDATE tasks SET size = size * 2 WHERE size IN (1, 3, 5)`);
    await db.run(
      sql`UPDATE members SET capacity = capacity * 2 WHERE capacity <= 7`,
    );
    await db.run(sql`PRAGMA user_version = 1`);
  }
  // 签收制一次性回填（v1 → v2）：存量 done 视同已签收，历史班次完成率不突变；
  // 此后新产生的 done 未签收即保持 NULL。回填无法幂等（新 done 未签收是合法状态），
  // 沿用 PRAGMA user_version 作迁移标记保证只执行一次（全新库表为空时为 no-op）。
  if (versionRow.user_version <= 1) {
    // 远古库可能连 done_at 列都没有（早于送达日期特性），无日期可回填时以 '(历史)' 占位
    const cols = await db.all<{ name: string }>(sql`PRAGMA table_info(tasks)`);
    const hasDoneAt = cols.some((c) => c.name === "done_at");
    await db.run(
      hasDoneAt
        ? sql`UPDATE tasks SET confirmed_at = done_at, confirmed_by = '(历史)' WHERE status = 'done' AND confirmed_at IS NULL`
        : sql`UPDATE tasks SET confirmed_at = '(历史)', confirmed_by = '(历史)' WHERE status = 'done' AND confirmed_at IS NULL`,
    );
    await db.run(sql`PRAGMA user_version = 2`);
  }
}
