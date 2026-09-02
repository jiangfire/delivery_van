import { defineConfig } from "drizzle-kit";

// 注意：drizzle-kit 只覆盖 sqlite 方言（db/schema.ts），pg/mysql 的 schema
// （db/schema.pg.ts / db/schema.mysql.ts）与 ensureSchema DDL 由手工维护，
// 三方一致性由 api/schemaDrift.test.ts 防漂移单测兜底。
export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "data/delivery_van.db",
  },
});
