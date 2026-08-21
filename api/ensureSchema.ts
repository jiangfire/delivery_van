import { getDb } from "./queries/connection";
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
      pool_item_id integer,
      owner_name text,
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
  await db.run(
    sql`CREATE INDEX IF NOT EXISTS tasks_van_code_idx ON tasks (van_code)`,
  );
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS task_owners (
      task_id integer NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      owner_name text NOT NULL
    )
  `);
}
