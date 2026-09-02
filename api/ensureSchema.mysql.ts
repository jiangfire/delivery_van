import { sql } from "drizzle-orm";
import { getDb } from "./queries/connection";
import { execRaw } from "./queries/dialect";

/**
 * MySQL 建表（v2.2）：mysql 是全新方言、不存在历史库，只需 CREATE TABLE IF NOT EXISTS
 * 最终形态 + `_dv_meta` 版本表（写入当前版本 2），幂等由 IF NOT EXISTS 保证；
 * 不需要 sqlite 路径的 try-ALTER-catch 补列链与 PRAGMA user_version 值域迁移。
 * 表结构与 db/schema.mysql.ts 保持一致。注意方言差异：
 * - TEXT 列不允许字面量默认值 → 带默认值的字符串列用 varchar（与 schema.mysql.ts 一致）；
 * - utf8mb4 唯一索引长度限制 → members.name 用 varchar(191)；
 * - CREATE INDEX 无 IF NOT EXISTS → tasks_van_code_idx 内联进 tasks 建表；
 * - created_at 存 Unix 秒整数（审计链字节确定性）。
 */
export async function ensureSchemaMysql() {
  const db = getDb();
  await execRaw(
    db,
    sql`CREATE TABLE IF NOT EXISTS members (
      id int AUTO_INCREMENT PRIMARY KEY,
      name varchar(191) NOT NULL UNIQUE,
      capacity int NOT NULL DEFAULT 5,
      created_at int NOT NULL DEFAULT (unix_timestamp())
    )`,
  );
  await execRaw(
    db,
    sql`CREATE TABLE IF NOT EXISTS vans (
      code varchar(16) PRIMARY KEY,
      created_at int NOT NULL DEFAULT (unix_timestamp())
    )`,
  );
  // pool_items：已废弃的历史表，保持三方开工一致性照建
  await execRaw(
    db,
    sql`CREATE TABLE IF NOT EXISTS pool_items (
      id int AUTO_INCREMENT PRIMARY KEY,
      title text NOT NULL,
      rarity varchar(16) NOT NULL DEFAULT 'common',
      status varchar(16) NOT NULL DEFAULT 'open',
      posted_van text,
      note text,
      created_at int NOT NULL DEFAULT (unix_timestamp())
    )`,
  );
  await execRaw(
    db,
    sql`CREATE TABLE IF NOT EXISTS tasks (
      id int AUTO_INCREMENT PRIMARY KEY,
      van_code varchar(16) NOT NULL,
      title text NOT NULL,
      rarity varchar(16) NOT NULL DEFAULT 'n',
      requester varchar(64),
      size int,
      acceptance text,
      status varchar(16) NOT NULL DEFAULT 'todo',
      carried_from varchar(16),
      carry_count int NOT NULL DEFAULT 0,
      done_at varchar(16),
      note text,
      sort_order int,
      source varchar(16) NOT NULL DEFAULT 'customer',
      carry_reason varchar(32),
      confirmed_by varchar(64),
      confirmed_at varchar(16),
      created_at int NOT NULL DEFAULT (unix_timestamp()),
      INDEX tasks_van_code_idx (van_code)
    )`,
  );
  await execRaw(
    db,
    sql`CREATE TABLE IF NOT EXISTS task_owners (
      task_id int NOT NULL,
      owner_name varchar(64) NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )`,
  );
  // 链式审计日志表（WP2）：只追加不改写，读链校验见 queries/audit.ts
  await execRaw(
    db,
    sql`CREATE TABLE IF NOT EXISTS audit_log (
      id int AUTO_INCREMENT PRIMARY KEY,
      ts int NOT NULL,
      actor varchar(64) NOT NULL,
      entity varchar(32) NOT NULL,
      entity_id varchar(191) NOT NULL,
      field varchar(64) NOT NULL,
      old_value text,
      new_value text,
      prev_hash varchar(64) NOT NULL,
      hash varchar(64) NOT NULL
    )`,
  );
  // 版本表（对应 sqlite 的 PRAGMA user_version）：mysql 全新库直接落当前版本 2
  await execRaw(
    db,
    sql`CREATE TABLE IF NOT EXISTS _dv_meta (
      \`key\` varchar(64) PRIMARY KEY,
      value text NOT NULL
    )`,
  );
  await execRaw(
    db,
    sql`INSERT IGNORE INTO _dv_meta (\`key\`, value) VALUES ('schema_version', '2')`,
  );
}
