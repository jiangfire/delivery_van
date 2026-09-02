/* 行拖拽排序回归（sqlite 变体）：内存 SQLite + mock connection 跑真实 ensureSchema +
 * 数据层；用例本体在 van.reorder.suite.ts，pg/mysql 变体见 dialect.pg/mysql.test.ts。 */
import { vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema";
import { registerReorderSuite } from "./van.reorder.suite";

let mockDb: BetterSQLite3Database<typeof schema>;

vi.mock("./connection", () => ({
  getDb: vi.fn(() => mockDb),
}));

import { ensureSchema } from "../ensureSchema";

beforeEach(async () => {
  mockDb = drizzle(new Database(":memory:"), { schema });
  await ensureSchema();
});

registerReorderSuite({ db: () => mockDb, S: schema });
