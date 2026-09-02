/* mysql 变体测试环境（v2.2 任务 9）：TEST_MYSQL_URL 存在时设定 DB_DIALECT/DATABASE_URL。
 * ESM import 按源码序执行——本模块必须是变体测试文件的**第一个 import**，
 * 保证业务模块（van.ts 的 getSchema() 在模块加载时固化方言）加载前环境就绪。
 * 测试结束用 restoreMysqlTestEnv 恢复原环境（同一 fork 内后续文件不受影响）。 */

const prevDialect = process.env.DB_DIALECT;
const prevUrl = process.env.DATABASE_URL;

export const mysqlEnvActive = Boolean(process.env.TEST_MYSQL_URL);

if (mysqlEnvActive) {
  process.env.DB_DIALECT = "mysql";
  process.env.DATABASE_URL = process.env.TEST_MYSQL_URL;
}

/** 恢复加载本模块前的 DB_DIALECT / DATABASE_URL */
export function restoreMysqlTestEnv() {
  if (!mysqlEnvActive) return;
  if (prevDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = prevDialect;
  if (prevUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = prevUrl;
}
