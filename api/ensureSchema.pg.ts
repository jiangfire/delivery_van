import { sql } from "drizzle-orm";
import { getDb } from "./queries/connection";
import { execRaw } from "./queries/dialect";

/**
 * PostgreSQL 建表（v2.2）：pg 是全新方言、不存在历史库，只需 CREATE TABLE IF NOT EXISTS
 * 最终形态 + `_dv_meta` 版本表（写入当前版本 2），幂等由 IF NOT EXISTS 保证；
 * 不需要 sqlite 路径的 try-ALTER-catch 补列链与 PRAGMA user_version 值域迁移。
 * 表结构与 db/schema.pg.ts 保持一致；created_at 存 Unix 秒整数（审计链字节确定性）。
 */
export async function ensureSchemaPg() {
  const db = getDb();
  await execRaw(
    db,
    sql`CREATE TABLE IF NOT EXISTS members (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name text NOT NULL UNIQUE,
      capacity integer NOT NULL DEFAULT 5,
      created_at integer NOT NULL DEFAULT ((extract(epoch from now()))::int)
    )`,
  );
  await execRaw(
    db,
    sql`CREATE TABLE IF NOT EXISTS vans (
      code text PRIMARY KEY,
      created_at integer NOT NULL DEFAULT ((extract(epoch from now()))::int)
    )`,
  );
  // pool_items：已废弃的历史表，保持三方开工一致性照建
  await execRaw(
    db,
    sql`CREATE TABLE IF NOT EXISTS pool_items (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      title text NOT NULL,
      rarity text NOT NULL DEFAULT 'common',
      status text NOT NULL DEFAULT 'open',
      posted_van text,
      note text,
      created_at integer NOT NULL DEFAULT ((extract(epoch from now()))::int)
    )`,
  );
  await execRaw(
    db,
    sql`CREATE TABLE IF NOT EXISTS tasks (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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
      created_at integer NOT NULL DEFAULT ((extract(epoch from now()))::int)
    )`,
  );
  await execRaw(
    db,
    sql`CREATE INDEX IF NOT EXISTS tasks_van_code_idx ON tasks (van_code)`,
  );
  await execRaw(
    db,
    sql`CREATE TABLE IF NOT EXISTS task_owners (
      task_id integer NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      owner_name text NOT NULL
    )`,
  );
  // 链式审计日志表（WP2）：只追加不改写，读链校验见 queries/audit.ts
  await execRaw(
    db,
    sql`CREATE TABLE IF NOT EXISTS audit_log (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      ts integer NOT NULL,
      actor text NOT NULL,
      entity text NOT NULL,
      entity_id text NOT NULL,
      field text NOT NULL,
      old_value text,
      new_value text,
      prev_hash text NOT NULL,
      hash text NOT NULL
    )`,
  );
  // 版本表（对应 sqlite 的 PRAGMA user_version）：pg 全新库直接落当前版本 2
  await execRaw(
    db,
    sql`CREATE TABLE IF NOT EXISTS _dv_meta (
      key text PRIMARY KEY,
      value text NOT NULL
    )`,
  );
  await execRaw(
    db,
    sql`INSERT INTO _dv_meta (key, value) VALUES ('schema_version', '2') ON CONFLICT (key) DO NOTHING`,
  );
}
