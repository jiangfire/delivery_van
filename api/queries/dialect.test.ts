/* 方言层（v2.2 任务 5/8）：DB_DIALECT 解析与 mysql 无 RETURNING 的 insertId 分支。
 * 不连库：pg/mysql 的真实验证由 CI service 容器负责（任务 9）。 */
import { afterEach, describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import { tasks } from "../../db/schema";
import {
  getDialect,
  insertReturningId,
  isUniqueViolation,
  parseDialect,
  writeLockSql,
  type AppDb,
} from "./dialect";

/** 从 SQL 对象提取字面量文本（锁语句为纯字面量模板，无参数与标识符块） */
function sqlText(s: SQL): string {
  let out = "";
  for (const c of s.queryChunks) {
    if (typeof c === "string") out += c;
    else if (c && typeof c === "object" && "value" in c) {
      const v = (c as { value: unknown }).value;
      out += Array.isArray(v) ? v.join("") : String(v ?? "");
    } else out += " ";
  }
  return out;
}

afterEach(() => {
  delete process.env.DB_DIALECT;
});

describe("parseDialect / getDialect", () => {
  it("缺省与空串为 sqlite，pg/mysql 原样通过", () => {
    expect(parseDialect(undefined)).toBe("sqlite");
    expect(parseDialect("")).toBe("sqlite");
    expect(parseDialect("sqlite")).toBe("sqlite");
    expect(parseDialect("postgres")).toBe("postgres");
    expect(parseDialect("mysql")).toBe("mysql");
  });

  it("非法值抛错（启动即败，由 boot 兜底退出非零）", () => {
    expect(() => parseDialect("oracle")).toThrow("非法 DB_DIALECT");
  });

  it("getDialect 读 DB_DIALECT 环境变量", () => {
    process.env.DB_DIALECT = "postgres";
    expect(getDialect()).toBe("postgres");
  });
});

describe("insertReturningId（mysql 分支，无 RETURNING）", () => {
  it("从驱动结果的 insertId 取回自增 id", async () => {
    process.env.DB_DIALECT = "mysql";
    // 模拟 mysql2 drizzle 的 insert 返回：[ResultSetHeader, ...]
    const fakeTx = {
      insert: () => ({
        values: async () => [{ insertId: 42 }],
      }),
    } as unknown as AppDb;

    await expect(
      insertReturningId(fakeTx, tasks, { vanCode: "DV2609A", title: "甲" }),
    ).resolves.toBe(42);
  });
});

describe("isUniqueViolation（唯一约束冲突的方言归一）", () => {
  it("识别 sqlite / pg / mysql 三方言的错误形状", () => {
    // better-sqlite3：SqliteError.code
    expect(isUniqueViolation({ code: "SQLITE_CONSTRAINT_PRIMARYKEY" })).toBe(
      true,
    );
    expect(isUniqueViolation({ code: "SQLITE_CONSTRAINT_UNIQUE" })).toBe(true);
    // postgres.js：Postgres.Error.code = 23505（unique_violation）
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    // mysql2：code = ER_DUP_ENTRY（errno 1062）
    expect(isUniqueViolation({ code: "ER_DUP_ENTRY" })).toBe(true);
  });

  it("非约束错误与异常形状返回 false", () => {
    expect(isUniqueViolation({ code: "SQLITE_CONSTRAINT_FOREIGNKEY" })).toBe(
      false,
    );
    expect(isUniqueViolation(new Error("普通错误"))).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation({ code: 23505 })).toBe(false); // 数字形状不认，防误报
  });
});

describe("writeLockSql（写事务串行化锁，v2.2 评审修复）", () => {
  it("sqlite 不取锁（BEGIN IMMEDIATE 已串行化写事务）", () => {
    process.env.DB_DIALECT = "sqlite";
    expect(writeLockSql()).toBeNull();
  });

  it("postgres 用事务级咨询锁", () => {
    process.env.DB_DIALECT = "postgres";
    const lock = writeLockSql();
    expect(lock).not.toBeNull();
    expect(sqlText(lock!)).toContain("pg_advisory_xact_lock");
  });

  it("mysql 对 _dv_meta 版本行 FOR UPDATE", () => {
    process.env.DB_DIALECT = "mysql";
    const lock = writeLockSql();
    expect(lock).not.toBeNull();
    const text = sqlText(lock!);
    expect(text).toContain("_dv_meta");
    expect(text).toContain("for update");
  });
});
