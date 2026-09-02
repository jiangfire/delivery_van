/* mysql 方言变体（v2.2 任务 9）：TEST_MYSQL_URL 存在时（CI service 容器）用真实
 * MySQL 连接跑数据层行为套件 + 建表幂等冒烟；本地无连接串时整组 skip。
 * 注意：本文件不做 vi.mock，业务代码走真实 connection.ts（mysql2 连接池）。
 * 隔离：每用例前 ensureSchema（幂等）+ 清表；容器库跨用例共享，用例不得假设
 * 自增 id 从 1 起。 */
import { restoreMysqlTestEnv } from "./testEnv.mysql"; // 第一顺位 import：先于业务模块设定方言环境
import { describe, it, beforeEach, afterAll } from "vitest";
import { closeDb, getDb } from "./connection";
import { getSchema } from "./dialect";
import { cleanAllTables } from "./dialectHarness";
import { ensureSchema } from "../ensureSchema";
import { registerWriteSuite } from "./van.write.suite";
import { registerConfirmSuite } from "./van.confirm.suite";
import { registerReorderSuite } from "./van.reorder.suite";

const TEST_MYSQL_URL = process.env.TEST_MYSQL_URL;

describe.skipIf(!TEST_MYSQL_URL)("方言变体：mysql（CI 容器真实连接）", () => {
  const ctx = { db: () => getDb(), S: getSchema() };

  beforeEach(async () => {
    await ensureSchema();
    await cleanAllTables(getDb());
  });

  afterAll(async () => {
    await closeDb();
    restoreMysqlTestEnv();
  });

  it("建表冒烟：空库 ensureSchema 成功，二次调用幂等", async () => {
    await ensureSchema();
    await ensureSchema();
  });

  registerWriteSuite(ctx);
  registerConfirmSuite(ctx);
  registerReorderSuite(ctx);
});
