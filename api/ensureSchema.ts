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
}
