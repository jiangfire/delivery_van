import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema";

let db: BetterSQLite3Database<typeof schema> | null = null;

/** SQLite 数据库文件路径：默认 ./data/delivery_van.db，可用 DATABASE_URL 覆盖 */
export function dbFilePath(): string {
  return (
    process.env.DATABASE_URL ||
    path.resolve(process.cwd(), "data", "delivery_van.db")
  );
}

/** 惰性打开连接：WAL 模式（读写并发），外键开启 */
export function getDb(): BetterSQLite3Database<typeof schema> {
  if (!db) {
    const file = dbFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const sqlite = new Database(file);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    db = drizzle(sqlite, { schema });
  }
  return db;
}
