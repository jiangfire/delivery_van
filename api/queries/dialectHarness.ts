/* 数据层多方言测试 harness（v2.2 任务 9）。
 *
 * 同一份行为套件（van.write.suite / van.confirm.suite / van.reorder.suite）跑在：
 * - sqlite 变体：内存库 + mock connection（van.*.test.ts，默认全量跑）；
 * - pg/mysql 变体：TEST_PG_URL / TEST_MYSQL_URL 注入时（CI service 容器）用真实
 *   连接（dialect.pg.test.ts / dialect.mysql.test.ts），缺省整组 skip。
 *
 * pg/mysql 容器库跨用例共享：每用例前 cleanAllTables 清表隔离；自增序号不复位，
 * 用例一律不得假设 id 从 1 起（用 insertReturningId 取真实 id）。
 */
import { sql } from "drizzle-orm";
import type * as sqliteSchema from "../../db/schema";
import { execRaw, type AppDb } from "./dialect";

/** 行为套件的运行上下文：db 访问 + 当前方言的表对象 */
export interface DataLayerCtx {
  db: () => AppDb;
  S: typeof sqliteSchema;
}

/** 清空业务表（pg/mysql 变体每用例前置调用；_dv_meta 版本表不动）。先子表后主表。 */
export async function cleanAllTables(db: AppDb): Promise<void> {
  for (const t of ["task_owners", "tasks", "audit_log", "members", "vans"]) {
    await execRaw(db, sql`DELETE FROM ${sql.identifier(t)}`);
  }
}
