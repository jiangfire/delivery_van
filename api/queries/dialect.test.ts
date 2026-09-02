/* 方言层（v2.2 任务 5/8）：DB_DIALECT 解析与 mysql 无 RETURNING 的 insertId 分支。
 * 不连库：pg/mysql 的真实验证由 CI service 容器负责（任务 9）。 */
import { afterEach, describe, expect, it } from "vitest";
import { tasks } from "../../db/schema";
import {
  getDialect,
  insertReturningId,
  parseDialect,
  type AppDb,
} from "./dialect";

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
