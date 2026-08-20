import { getDb } from "../api/queries/connection";
import { members } from "./schema";

/** 初始化种子数据：示例成员。需求池与任务由团队在发车会上录入，不预置。 */
async function seed() {
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

seed();
