import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as sqliteSchema from "../../db/schema";
import * as pgSchema from "../../db/schema.pg";
import * as mysqlSchema from "../../db/schema.mysql";
import { getDialect, type AppDb } from "./dialect";

let db: AppDb | null = null;
let closer: (() => void | Promise<void>) | null = null;

/**
 * 关闭当前连接并重置缓存（测试拆装机用——pg/mysql 的连接/连接池不关闭会
 * 挂住事件循环；服务进程生命周期内不调用）。
 */
export async function closeDb(): Promise<void> {
  const close = closer;
  db = null;
  closer = null;
  await close?.();
}

/** SQLite 数据库文件路径：默认 ./data/delivery_van.db，可用 DATABASE_URL 覆盖 */
export function dbFilePath(): string {
  return (
    process.env.DATABASE_URL ||
    path.resolve(process.cwd(), "data", "delivery_van.db")
  );
}

/** pg/mysql 的 DATABASE_URL 是连接串（必填）；sqlite 时是文件路径（见 dbFilePath） */
function databaseUrl(dialect: string): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(`方言 ${dialect} 需要 DATABASE_URL 提供连接串`);
  }
  return url;
}

/**
 * 惰性打开连接，按 DB_DIALECT 分方言（默认 sqlite）：
 * - sqlite：本地文件库，WAL 模式（读写并发），外键开启；
 * - postgres：postgres.js 驱动；mysql：mysql2 连接池。
 * 返回值类型统一标为 sqlite db（受控 cast 集中在方言层，见 dialect.ts 说明）。
 */
export function getDb(): AppDb {
  if (db) return db;
  const dialect = getDialect();
  if (dialect === "postgres") {
    const client = postgres(databaseUrl(dialect));
    db = drizzlePg(client, {
      schema: pgSchema,
    }) as unknown as AppDb;
    closer = () => client.end();
    return db;
  }
  if (dialect === "mysql") {
    const pool = mysql.createPool(databaseUrl(dialect));
    // mysql 默认 group_concat_max_len=1024：负责人聚合（owners）超限会被静默截断，
    // 每个新建连接统一会话级调大（PromisePool 不转发事件，挂在原生 pool 上）
    pool.pool.on("connection", (conn) => {
      conn.query("SET SESSION group_concat_max_len = 65535");
    });
    db = drizzleMysql(pool, {
      schema: mysqlSchema,
      mode: "default",
    }) as unknown as AppDb;
    closer = () => pool.end();
    return db;
  }
  const file = dbFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  db = drizzleSqlite(sqlite, { schema: sqliteSchema });
  closer = () => {
    sqlite.close();
  };
  return db;
}
