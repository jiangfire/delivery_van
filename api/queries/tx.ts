import { sql } from "drizzle-orm";
import { execRaw, getDialect, writeLockSql, type AppDb } from "./dialect";

/**
 * 事务执行器（v2.2 任务 4/8：数据层同步→异步化 + 方言分支的统一出口）。
 *
 * sqlite（better-sqlite3）：驱动事务 db.transaction 的回调只支持同步——传 async
 * 回调会在首个 await 处提前 COMMIT，静默破坏「业务写 + 审计同事务」原子性。故
 * 这里手写 BEGIN IMMEDIATE / COMMIT / ROLLBACK 包裹 async body；单连接下 body
 * 直接收 db 本身，无独立 tx 对象。
 *
 * 铁律（仅 sqlite 路径）：事务 body 内禁止任何真实 I/O 的 await（fetch / 定时器 /
 * 文件读写等），只允许 await 数据层调用与纯计算——本实现依赖「body 内 await 仅经
 * 微任务队列、Node 在微任务排空前不处理新请求」，保证并发请求插不进已开启的
 * 事务。违反 = 审计原子性失效。
 *
 * pg/mysql：走驱动原生 db.transaction(body)（异步事务、独立连接，无此约束）；
 * body 收到的 tx 运行时是对应方言的事务对象，类型按方言层约定标为 AppDb。
 * 事务开头先取 writeLockSql 的写锁——并发写事务串行化，对齐 sqlite 的
 * BEGIN IMMEDIATE 语义：防「读审计链尾→插入」交错造成链分叉（v2.2 评审修复）。
 * 注意：事务外的 precondition 读（如 addTask 的 max(sort_order)、isVanArchived）
 * 不经此锁，TOCTOU 窗口仍是方言间已知差异（见 v2.2 计划文档「明确不做」）。
 */
export async function runTx<T>(
  db: AppDb,
  body: (tx: AppDb) => Promise<T>,
): Promise<T> {
  if (getDialect() !== "sqlite") {
    const lock = writeLockSql();
    const transactable = db as unknown as {
      transaction(fn: (tx: AppDb) => Promise<T>): Promise<T>;
    };
    return transactable.transaction(async (tx) => {
      if (lock) await execRaw(tx, lock);
      return body(tx);
    });
  }
  db.run(sql`BEGIN IMMEDIATE`);
  try {
    const result = await body(db);
    db.run(sql`COMMIT`);
    return result;
  } catch (e) {
    // 回滚自身失败时不再抛出，避免掩盖 body 的业务原异常
    try {
      db.run(sql`ROLLBACK`);
    } catch {
      /* 保留原异常 */
    }
    throw e;
  }
}
