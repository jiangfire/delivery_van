/* v2.0 Phase 1 数据层回归（sqlite 变体）：内存 SQLite + mock connection 跑真实
 * ensureSchema + 数据层；用例本体在 van.confirm.suite.ts，pg/mysql 变体见
 * dialect.pg.test.ts / dialect.mysql.test.ts。 */
import { vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema";
import { registerConfirmSuite } from "./van.confirm.suite";

let mockDb: BetterSQLite3Database<typeof schema>;

vi.mock("./connection", () => ({
  getDb: vi.fn(() => mockDb),
}));

import { ensureSchema } from "../ensureSchema";

beforeEach(async () => {
  mockDb = drizzle(new Database(":memory:"), { schema });
  await ensureSchema();
});

registerConfirmSuite({ db: () => mockDb, S: schema });
