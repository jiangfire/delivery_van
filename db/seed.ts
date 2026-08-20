import { getDb } from "../api/queries/connection";
import { ensureSchema } from "../api/ensureSchema";
import { members } from "./schema";

/** 初始化种子数据：示例成员。任务大厅与任务由团队在发车会上录入，不预置。 */
async function seed() {
  // 自愈：全新库先幂等建表，无需先启动一次服务
  await ensureSchema();

  const db = getDb();
  console.log("Seeding database...");

  await db
    .insert(members)
    .values([
      { name: "张三", capacity: 5 },
      { name: "李四", capacity: 5 },
      { name: "王五", capacity: 5 },
    ])
    .onConflictDoNothing();

  console.log("Done.");
}

await seed();
