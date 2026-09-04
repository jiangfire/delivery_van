import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as sqliteSchema from "../../db/schema";
import * as pgSchema from "../../db/schema.pg";
import * as mysqlSchema from "../../db/schema.mysql";
import type { tasks } from "../../db/schema";

/**
 * 方言层（v2.2 任务 5）：方言解析、schema 选择、统一执行入口。
 *
 * drizzle 三方言的 db/查询类型本不兼容，强求零 cast 会让类型噪音扩散到全部
 * 业务代码。务实策略：**受控 cast 集中在方言层**——运行期 db/schema 可为任一
 * 方言实例，类型上统一标为 sqlite 形状（AppDb / typeof sqliteSchema），三份
 * schema 字段形状的一致性由防漂移单测（api/schemaDrift.test.ts）保证，
 * 业务代码（van.ts / audit.ts）因此一份、无方言 if。
 */

export type Dialect = "sqlite" | "postgres" | "mysql";

/** 运行时 db 实例可为任一方言；类型统一标为 sqlite db（见文件头说明） */
export type AppDb = BetterSQLite3Database<typeof sqliteSchema>;

/** 解析 DB_DIALECT（纯函数）：缺省/空 = sqlite，非法值抛错（启动即败，由 boot 兜底退出非零） */
export function parseDialect(raw: string | undefined): Dialect {
  if (raw === undefined || raw === "" || raw === "sqlite") return "sqlite";
  if (raw === "postgres" || raw === "mysql") return raw;
  throw new Error(
    `非法 DB_DIALECT「${raw}」：只支持 sqlite | postgres | mysql`,
  );
}

/** 当前方言（每次读环境变量，进程内不变；不缓存以便测试注入） */
export function getDialect(): Dialect {
  return parseDialect(process.env.DB_DIALECT);
}

/** 当前方言的 schema：类型标为 sqlite schema，运行时返回对应方言版本 */
export function getSchema(): typeof sqliteSchema {
  const dialect = getDialect();
  if (dialect === "postgres") return pgSchema as unknown as typeof sqliteSchema;
  if (dialect === "mysql") return mysqlSchema as unknown as typeof sqliteSchema;
  return sqliteSchema;
}

/**
 * 统一查询执行入口：sqlite（better-sqlite3）是同步驱动，builder 用
 * .all()/.run() 收尾；pg/mysql 的 builder 直接 await（thenable）。
 * **事务内必须经此出口**（事务 body 直接收 db，收尾方式随方言）；事务外
 * 也可直接 await builder（drizzle builder 三方言均为 thenable），两种写法等价。
 */
export async function qAll<T>(query: { all(): T[] }): Promise<T[]> {
  if (getDialect() === "sqlite") return query.all();
  return await (query as unknown as PromiseLike<T[]>);
}

/** 统一写执行入口（insert/update/delete 收尾）：sqlite .run()，pg/mysql await */
export async function qRun(query: { run(): unknown }): Promise<void> {
  if (getDialect() === "sqlite") {
    query.run();
    return;
  }
  await (query as unknown as PromiseLike<unknown>);
}

/** 统一裸 SQL 执行（ensureSchema 建表用）：sqlite db.run，pg/mysql db.execute */
export async function execRaw(db: AppDb, stmt: SQL): Promise<void> {
  if (getDialect() === "sqlite") {
    db.run(stmt);
    return;
  }
  await (db as unknown as { execute(s: SQL): Promise<unknown> }).execute(stmt);
}

/** 字符串聚合的方言差异：pg 用 string_agg，sqlite/mysql 同名 group_concat */
export function groupConcatSql(expr: SQLWrapper) {
  return getDialect() === "postgres"
    ? sql<string>`string_agg(${expr}, ',')`
    : sql<string>`group_concat(${expr})`;
}

/**
 * 写事务的串行化锁（v2.2 评审修复：防 pg/mysql 并发写事务分叉审计链）。
 * 所有写事务在 body 前执行同一条锁 SQL，拿到才继续——效果对齐 sqlite 的
 * BEGIN IMMEDIATE 写串行化：
 * - postgres：pg_advisory_xact_lock（事务级咨询锁，COMMIT/ROLLBACK 自动释放，
 *   常量 9137 任意取值，全库只此一处使用即无冲突）；
 * - mysql：对 _dv_meta 的 schema_version 行 SELECT ... FOR UPDATE（该行由
 *   ensureSchema 保证存在，锁随事务结束释放；行不存在时静默无锁=优雅降级为现状）。
 * 单一锁无锁序问题；写吞吐串行化与 sqlite 同语义，小团队单实例场景可接受。
 */
export function writeLockSql(): SQL | null {
  if (getDialect() === "postgres") {
    return sql`select pg_advisory_xact_lock(9137)`;
  }
  if (getDialect() === "mysql") {
    // key 是保留字需反引号（与 ensureSchema.mysql.ts 的 _dv_meta DDL 同款写法）
    return sql`select value from _dv_meta where \`key\` = 'schema_version' for update`;
  }
  return null;
}

/**
 * 唯一/主键约束冲突的方言归一判断（并发兜底用，如发新车撞班次主键、
 * 成员重名撞唯一约束）：better-sqlite3 抛 error.code = SQLITE_CONSTRAINT_*、
 * postgres.js 抛 error.code = 23505（unique_violation）、mysql2 抛
 * error.code = ER_DUP_ENTRY（errno 1062）。识别不了返回 false，由上层按
 * 未知错误处理。
 */
export function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return (
    code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
    code === "SQLITE_CONSTRAINT_UNIQUE" ||
    code === "23505" ||
    code === "ER_DUP_ENTRY"
  );
}

/**
 * 插入并取回自增 id：sqlite/pg 用 RETURNING，mysql 无 RETURNING、
 * 改读驱动结果的 insertId。仅在 tasks 表使用（新增快件 / 结转副本）。
 */
export async function insertReturningId(
  tx: AppDb,
  table: typeof tasks,
  values: typeof tasks.$inferInsert,
): Promise<number> {
  if (getDialect() === "mysql") {
    // mysql2 drizzle 的 insert 结果形如 [ResultSetHeader, ...]，insertId 在其上
    const result = (await (
      tx as unknown as {
        insert(t: unknown): { values(v: unknown): Promise<unknown> };
      }
    )
      .insert(table)
      .values(values)) as unknown;
    const header = (Array.isArray(result) ? result[0] : result) as {
      insertId: number | bigint;
    };
    return Number(header.insertId);
  }
  const [row] = await qAll(
    tx.insert(table).values(values).returning({ id: table.id }),
  );
  if (!row) throw new Error("insert 未返回 id");
  return row.id;
}
