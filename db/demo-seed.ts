import path from "node:path";
import { desc } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { ensureSchema } from "../api/ensureSchema";
import {
  addMember,
  addTask,
  carryOver,
  confirmTask,
  dispatchVan,
  listTasksByVan,
  listVans,
  updateTask,
} from "../api/queries/van";
import { fingerprintOf, verifyAuditChain } from "../api/queries/audit";
import { getDialect } from "../api/queries/dialect";
import { auditLog } from "./schema";

/**
 * 演示数据种子：全虚构（人物/班次/任务均为编造，零真实信息），走真实业务函数写入——
 * 审计链、签收、结转、归档全部按线上路径落库，可用于演示 v2.0 全部统计块：
 * 三方占比、稀有度通胀、提出人记分卡、结转原因瀑布、昨日天气、徽章、未签收提示。
 *
 * 默认写 data/demo.db（不碰开发库 delivery_van.db），DATABASE_URL 可覆盖；目标库已有班次则拒绝，防重复灌。
 */
if (getDialect() !== "sqlite") {
  console.error(
    `演示种子只支持 sqlite（默认写 data/demo.db）；当前 DB_DIALECT=${getDialect()} 会把文件路径当连接串解析，请去掉 DB_DIALECT 后重跑。`,
  );
  process.exit(1);
}
process.env.DATABASE_URL ??= path.resolve(process.cwd(), "data", "demo.db");

const ACTOR = "冈部"; // 软身份：演示库的操作记录统一记在 Lab 主人名下，链上可对质

const day = (s: string) => new Date(s);

async function seed() {
  await ensureSchema();

  // 防重复灌：演示库只允许空库生成，已有班次说明是别人的数据，拒绝覆盖
  if ((await listVans()).length > 0) {
    console.error(
      "目标库已有班次数据，拒绝覆盖。请换一个空库（rm data/demo.db 后重跑，或用 DATABASE_URL 指定新路径）。",
    );
    process.exit(1);
  }

  console.log(`Seeding demo database → ${process.env.DATABASE_URL} ...`);

  /* ── 成员（虚构：未来道具研究所 Lab 成员，点数为运力）── */
  for (const [name, cap] of [
    ["冈部", 12],
    ["红莉栖", 14],
    ["桶子", 10],
    ["铃羽", 10],
    ["琉华", 8],
    ["菲莉", 10],
  ] as const) {
    await addMember(name, cap, ACTOR);
  }

  /** 按标题找任务 id（演示任务标题全库唯一，结转副本按班次区分） */
  const idOf = async (van: string, title: string) => {
    const found = (await listTasksByVan(van)).find((t) => t.title === title);
    if (!found) throw new Error(`未找到任务：${van} / ${title}`);
    return found.id;
  };
  /** 录件（演示专用简写） */
  const put = (
    van: string,
    title: string,
    opts: Omit<Parameters<typeof addTask>[0], "van" | "title" | "actor">,
  ) => addTask({ van, title, ...opts, actor: ACTOR });
  /** 打勾送达（可补历史日期）+ 提出人签收（自驱件 confirmTask 幂等跳过） */
  const deliver = async (van: string, title: string, doneAt: string) => {
    const id = await idOf(van, title);
    await updateTask(id, { status: "done", doneAt }, ACTOR);
    await confirmTask(id, ACTOR);
  };

  /* ── DV2608A（8/7 发）：整班准点素材——4 件全送达全签收，无结转 → 🚚 徽章 ── */
  await dispatchVan(day("2026-08-07"));
  await put("DV2608A", "微波炉定时器联调", {
    rarity: "sr",
    requester: "天王寺",
    owners: ["冈部"],
    size: 4,
    source: "customer",
  });
  await put("DV2608A", "电话微波炉支架改造", {
    rarity: "r",
    requester: "天王寺",
    owners: ["桶子"],
    size: 2,
    source: "customer",
  });
  await put("DV2608A", "Lab 门户样式微调", {
    rarity: "n",
    owners: ["琉华"],
    size: 1,
    source: "exploration",
  });
  await put("DV2608A", "Jellyman 报告模板", {
    rarity: "n",
    requester: "比屋定",
    owners: ["红莉栖"],
    size: 2,
    source: "platform",
  });
  await deliver("DV2608A", "微波炉定时器联调", "2026-08-11");
  await deliver("DV2608A", "电话微波炉支架改造", "2026-08-12");
  await deliver("DV2608A", "Lab 门户样式微调", "2026-08-10");
  await deliver("DV2608A", "Jellyman 报告模板", "2026-08-13");

  /* ── DV2608B（8/14 发）：UR 大件滞留素材——2 件结转（依赖阻塞），B 班归档 ── */
  await dispatchVan(day("2026-08-14"));
  await put("DV2608B", "D-mail 协议加密", {
    rarity: "ssr",
    requester: "天王寺",
    owners: ["红莉栖"],
    size: 6,
    source: "customer",
  });
  await put("DV2608B", "IBN5100 拆机评估", {
    rarity: "r",
    requester: "比屋定",
    owners: ["桶子"],
    size: 3,
    source: "platform",
  });
  await put("DV2608B", "时间跳跃机 PoC", {
    rarity: "ur",
    requester: "天王寺",
    owners: ["冈部"],
    size: 8,
    source: "customer",
  });
  await put("DV2608B", "记忆数据恢复工具", {
    rarity: "sr",
    owners: ["铃羽"],
    size: 4,
    source: "exploration",
  });
  await deliver("DV2608B", "D-mail 协议加密", "2026-08-18");
  await deliver("DV2608B", "IBN5100 拆机评估", "2026-08-20");
  await dispatchVan(day("2026-08-21"));
  const carriedB = await carryOver("DV2608B", "DV2608C", day("2026-08-21"), {
    actor: ACTOR,
    carryReason: "blocker",
  });

  /* ── DV2608C（8/21 发）：结转件二进宫素材——探索件副本送达，UR 件再次结转（carryCount=2 强制复盘提示） ── */
  await put("DV2608C", "D-mail 网关重试", {
    rarity: "r",
    requester: "天王寺",
    owners: ["桶子"],
    size: 2,
    source: "customer",
  });
  await put("DV2608C", "Lab 安全演练", {
    rarity: "n",
    owners: ["琉华"],
    size: 1,
    source: "customer",
  });
  await put("DV2608C", "世界线变动率计量", {
    rarity: "sr",
    requester: "比屋定",
    owners: ["冈部"],
    size: 4,
    source: "platform",
  });
  await put("DV2608C", "42 寸显像管采购", {
    rarity: "n",
    requester: "天王寺",
    owners: ["菲莉"],
    size: 2,
    source: "customer",
  });
  await deliver("DV2608C", "记忆数据恢复工具", "2026-08-26"); // B 班结转来的探索件（自驱，视同签收）
  await deliver("DV2608C", "D-mail 网关重试", "2026-08-25");
  await deliver("DV2608C", "Lab 安全演练", "2026-08-26");
  await deliver("DV2608C", "世界线变动率计量", "2026-08-27");
  await dispatchVan(day("2026-08-28"));
  const carriedC = await carryOver("DV2608C", "DV2608D", day("2026-08-28"), {
    actor: ACTOR,
    carryReason: "estimate",
  });

  /* ── DV2608D（8/28 发）：昨日天气源——done 合计 9 点 = 当前班建议装载上限；1 件结转（产能不足） ── */
  await put("DV2608D", "世界线变动率探测器", {
    rarity: "sr",
    requester: "比屋定",
    owners: ["红莉栖"],
    size: 4,
    source: "platform",
  });
  await put("DV2608D", "菲利斯咖啡联动页", {
    rarity: "r",
    requester: "天王寺",
    owners: ["菲莉"],
    size: 2,
    source: "customer",
  });
  await put("DV2608D", "未来道具补完计划", {
    rarity: "n",
    owners: ["桶子"],
    size: 1,
    source: "exploration",
  });
  await put("DV2608D", "Lab 空调滤网更换", {
    rarity: "n",
    requester: "天王寺",
    owners: ["琉华"],
    size: 2,
    source: "customer",
  });
  await put("DV2608D", "CERN 漏洞通报处理", {
    rarity: "ssr",
    requester: "比屋定",
    owners: ["冈部"],
    size: 6,
    source: "platform",
  });
  await deliver("DV2608D", "Lab 空调滤网更换", "2026-08-29");
  await deliver("DV2608D", "未来道具补完计划", "2026-08-30");
  await deliver("DV2608D", "世界线变动率探测器", "2026-08-31");
  await deliver("DV2608D", "菲利斯咖啡联动页", "2026-08-31");
  await dispatchVan(day("2026-09-01")); // 跨月发车：DV26 09 从 A 重新计数
  const carriedD = await carryOver("DV2608D", "DV2609A", day("2026-09-01"), {
    actor: ACTOR,
    carryReason: "capacity",
  });

  /* ── DV2609A（当前班）：进行中 + 2 件 done 未签收（统计条「未签收 N 件」素材） ── */
  await put("DV2609A", "Luka 邮件模板引擎", {
    rarity: "n",
    requester: "天王寺",
    owners: ["琉华"],
    size: 2,
    source: "customer",
  });
  await put("DV2609A", "Amadeus 语音接口", {
    rarity: "ssr",
    requester: "比屋定",
    owners: ["红莉栖"],
    size: 6,
    source: "platform",
  });
  await put("DV2609A", "运维脚本整理", {
    rarity: "r",
    owners: ["桶子"],
    size: 2,
    source: "exploration",
  });
  await put("DV2609A", "显像管散热改造", {
    rarity: "sr",
    owners: ["冈部"],
    size: 4,
    source: "exploration",
  });
  await put("DV2609A", "需求评审会纪要", {
    rarity: "n",
    requester: "天王寺",
    owners: ["菲莉"],
    size: 1,
    source: "customer",
  });
  await put("DV2609A", "D-mail 检索加速", {
    rarity: "ur",
    requester: "天王寺",
    owners: ["冈部"],
    size: 8,
    source: "customer",
  });
  for (const title of ["Luka 邮件模板引擎", "Amadeus 语音接口"]) {
    await updateTask(await idOf("DV2609A", title), { status: "doing" }, ACTOR);
  }
  for (const title of ["需求评审会纪要", "D-mail 检索加速"]) {
    await updateTask(
      await idOf("DV2609A", title),
      { status: "done", doneAt: "2026-09-01" },
      ACTOR,
    ); // 故意不签收：演示「未签收 2 件」
  }

  /* ── 汇总 ── */
  const vans = await listVans();
  const db = getDb();
  const chain = await db.select().from(auditLog).orderBy(auditLog.id);
  const broken = verifyAuditChain(chain);
  const [head] = await db
    .select({ hash: auditLog.hash })
    .from(auditLog)
    .orderBy(desc(auditLog.id))
    .limit(1);
  console.log("\n── 演示数据就绪 ──");
  console.log(`班次：${vans.join(" ← ")}（跨月 09 从 A 重计）`);
  for (const van of [...vans].reverse()) {
    const rows = await listTasksByVan(van);
    const by = (s: string) => rows.filter((t) => t.status === s).length;
    console.log(
      `  ${van}：${rows.length} 件（done ${by("done")} / todo ${by("todo")} / doing ${by("doing")} / carried ${by("carried")}）`,
    );
  }
  console.log(
    `结转：B→C ${carriedB.carried} 件(blocker)、C→D ${carriedC.carried} 件(estimate)、D→9A ${carriedD.carried} 件(capacity)`,
  );
  console.log(
    `审计链：${chain.length} 行，校验 ${broken === null ? "通过" : `断点 @${broken}`}，指纹 ${fingerprintOf(head?.hash)}`,
  );
  console.log(
    "\n查看：DATABASE_URL=<演示库绝对路径> npm run dev（生产则 npm run build 后同变量 npm start）",
  );
}

await seed();
