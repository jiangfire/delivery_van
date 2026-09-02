/* 三方言 schema 防漂移（v2.2 任务 6）：dialect.ts 的受控 cast 以「三份 schema 字段
 * 形状一致」为前提，此处用 drizzle 表对象内省比对表名/列名/可空性/默认值有无。
 * 类型细节允许方言差异（如 mysql 的 varchar(191)、各方言自增列），不在比对范围。 */
import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import * as sqliteSchema from "../db/schema";
import * as pgSchema from "../db/schema.pg";
import * as mysqlSchema from "../db/schema.mysql";

/** 三份 schema 必须一一对应的表（导出键名一致） */
const TABLE_EXPORTS = [
  "members",
  "vans",
  "poolItems",
  "tasks",
  "taskOwners",
  "auditLog",
] as const;

type SchemaModule = Record<(typeof TABLE_EXPORTS)[number], unknown>;

/** 表的形状签名：表名 + 每列「库列名 可空性 有无默认值」 */
function shapeOf(mod: SchemaModule, key: (typeof TABLE_EXPORTS)[number]) {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const table = mod[key] as any;
  const columns = Object.values(getTableColumns(table)) as any[];
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return {
    table: getTableName(table),
    columns: columns
      .map(
        (c) =>
          `${c.name} ${c.notNull ? "NOT NULL" : "NULL"}${c.hasDefault ? " DEFAULT" : ""}`,
      )
      .sort(),
  };
}

describe("三方言 schema 防漂移", () => {
  for (const key of TABLE_EXPORTS) {
    it(`${key}：pg / mysql 与 sqlite 的表名、列名、可空性、默认值一致`, () => {
      const base = shapeOf(sqliteSchema, key);
      expect(shapeOf(pgSchema, key)).toEqual(base);
      expect(shapeOf(mysqlSchema, key)).toEqual(base);
    });
  }
});
