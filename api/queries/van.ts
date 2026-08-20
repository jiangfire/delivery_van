import { and, asc, desc, eq, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./connection";
import {
  members,
  poolItems,
  tasks,
  vans,
  RARITIES,
  type PoolItem,
  type Task,
} from "../../db/schema";
import { firstVanCodeOf, nextVanCode, todayStr } from "../../contracts/vans";

/* ── 纯函数（无库可测） ── */

/**
 * 负荷校验（设计方案 3.3）：映射任务时每人档位合计 ≤ 当周运力。
 * assignedTotal 为该负责人在本班次已占用的档位合计。
 */
export function assertWithinCapacity(
  ownerName: string,
  assignedTotal: number,
  addedSize: number,
  capacity: number,
): void {
  const after = assignedTotal + addedSize;
  if (after > capacity) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${ownerName} 本班次超载：${assignedTotal} + ${addedSize} = ${after} 天 > 运力 ${capacity} 天`,
    });
  }
}

/**
 * 委托状态联动（任务大厅）：由名下全部任务状态推导委托状态。
 * 无任务 → open（待切片）；有任务且全部 done → done（已完成）；否则 scheduled（已排期）。
 */
export function poolStatusOf(
  statuses: Task["status"][],
): "open" | "scheduled" | "done" {
  if (statuses.length === 0) return "open";
  if (statuses.every((s) => s === "done")) return "done";
  return "scheduled";
}

/** 生成结转到下一班次的任务副本（未完成 → 重置状态、结转次数 +1） */
export function toStrandedTask(
  task: Task,
  toVan: string,
): Omit<Task, "id" | "createdAt"> {
  return {
    vanCode: toVan,
    title: task.title,
    poolItemId: task.poolItemId,
    ownerName: task.ownerName,
    size: task.size,
    acceptance: task.acceptance,
    status: "todo",
    carriedFrom: task.vanCode,
    carryCount: task.carryCount + 1,
    doneAt: null,
    note: task.note,
  };
}

/**
 * 稀有度分桶：把任务按所属委托的稀有度聚合为 { rarity, total, done } 列表。
 * 无关联委托（poolItemId 为空或委托不存在）的任务不计入；
 * 只返回有任务的桶，顺序按 RARITIES 定义。
 */
export function rarityStatsOf(
  rows: Pick<Task, "poolItemId" | "status">[],
  rarityById: ReadonlyMap<number, PoolItem["rarity"]>,
): { rarity: PoolItem["rarity"]; total: number; done: number }[] {
  const buckets = new Map<
    PoolItem["rarity"],
    { total: number; done: number }
  >();
  for (const t of rows) {
    if (t.poolItemId === null) continue;
    const rarity = rarityById.get(t.poolItemId);
    if (!rarity) continue;
    const b = buckets.get(rarity) ?? { total: 0, done: 0 };
    b.total += 1;
    if (t.status === "done") b.done += 1;
    buckets.set(rarity, b);
  }
  return RARITIES.filter((r) => buckets.has(r)).map((r) => ({
    rarity: r,
    ...buckets.get(r)!,
  }));
}

/* ── 班次（手动发新车，不再绑定周五） ── */

/** 全部班次编码（最新在前），来自 vans 表 */
export async function listVans(): Promise<string[]> {
  const rows = await getDb()
    .select({ code: vans.code })
    .from(vans)
    .orderBy(desc(vans.code));
  return rows.map((r) => r.code);
}

/** 发新车：表空时建当月首班车，否则在最新班次基础上 +1；返回最新列表 */
export async function dispatchVan(): Promise<string[]> {
  const list = await listVans();
  const code =
    list.length === 0 ? firstVanCodeOf(new Date()) : nextVanCode(list[0]);
  await getDb().insert(vans).values({ code });
  return listVans();
}

/* ── 成员 ── */

export async function listMembers() {
  return getDb().select().from(members).orderBy(asc(members.id));
}

export async function addMember(name: string, capacity: number) {
  const db = getDb();
  // 成员名有 UNIQUE 约束：先查重给出中文提示，避免原生 SqliteError 以 500 抛给前端
  const dup = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.name, name))
    .limit(1);
  if (dup.length > 0) {
    throw new TRPCError({ code: "CONFLICT", message: `成员「${name}」已存在` });
  }
  await db.insert(members).values({ name, capacity });
  return listMembers();
}

export async function updateMemberCapacity(id: number, capacity: number) {
  const db = getDb();
  const [member] = await db.select().from(members).where(eq(members.id, id));
  if (!member)
    throw new TRPCError({ code: "NOT_FOUND", message: `成员 ${id} 不存在` });

  // 调低运力时校验：该成员任一班次的已排档位合计都不能超过新运力
  if (capacity < member.capacity) {
    const rows = await db
      .select({ vanCode: tasks.vanCode, size: tasks.size })
      .from(tasks)
      .where(eq(tasks.ownerName, member.name));
    const byVan = new Map<string, number>();
    for (const r of rows)
      byVan.set(r.vanCode, (byVan.get(r.vanCode) ?? 0) + (r.size ?? 0));
    let peakVan = "";
    let peak = 0;
    for (const [van, total] of byVan) {
      if (total > peak) {
        peak = total;
        peakVan = van;
      }
    }
    if (capacity < peak) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `${member.name} 在 ${peakVan} 已排 ${peak} 天，运力不能调低到 ${capacity} 天`,
      });
    }
  }

  await db.update(members).set({ capacity }).where(eq(members.id, id));
  return listMembers();
}

/* ── 任务大厅（委托池） ── */

export type PoolItemWithRounds = PoolItem & { postedRounds: number };

export async function listPoolItems(): Promise<PoolItemWithRounds[]> {
  const db = getDb();
  const items = await db.select().from(poolItems).orderBy(desc(poolItems.id));
  // 挂账轮数 = 晚于 posted_van 创建的班次数；按 created_at 升序定位后取尾部数量
  const vanRows = await db
    .select({ code: vans.code })
    .from(vans)
    .orderBy(asc(vans.createdAt));
  return items.map((item) => {
    let postedRounds = 0;
    if (item.status === "open" && item.postedVan !== null) {
      const idx = vanRows.findIndex((v) => v.code === item.postedVan);
      // posted_van 不在 vans 表中（脏数据）时按 0 处理
      if (idx >= 0) postedRounds = vanRows.length - idx - 1;
    }
    return { ...item, postedRounds };
  });
}

export async function addPoolItem(input: {
  title: string;
  rarity: PoolItem["rarity"];
  targetVan?: string | null;
  note?: string;
}) {
  const db = getDb();
  // 挂出时记当时最新班次（还没有班车则为 null），用于挂账轮数统计
  const latest = await db
    .select({ code: vans.code })
    .from(vans)
    .orderBy(desc(vans.code))
    .limit(1);
  await db.insert(poolItems).values({
    title: input.title,
    rarity: input.rarity,
    targetVan: input.targetVan ?? null,
    postedVan: latest[0]?.code ?? null,
    note: input.note ?? null,
  });
  return listPoolItems();
}

export async function updatePoolItem(
  id: number,
  patch: Partial<{
    title: string;
    rarity: PoolItem["rarity"];
    status: "open" | "scheduled" | "done";
    targetVan: string | null;
    note: string | null;
  }>,
) {
  await getDb().update(poolItems).set(patch).where(eq(poolItems.id, id));
  return listPoolItems();
}

export async function removePoolItem(id: number) {
  const db = getDb();
  const [item] = await db
    .select({ id: poolItems.id })
    .from(poolItems)
    .where(eq(poolItems.id, id));
  if (!item)
    throw new TRPCError({ code: "NOT_FOUND", message: `委托 ${id} 不存在` });
  await db.delete(poolItems).where(eq(poolItems.id, id));
  return listPoolItems();
}

/** 按委托名下全部任务状态重算委托状态（联动见 poolStatusOf） */
async function syncPoolStatus(
  db: ReturnType<typeof getDb>,
  poolItemId: number,
) {
  const rows = await db
    .select({ status: tasks.status })
    .from(tasks)
    .where(eq(tasks.poolItemId, poolItemId));
  await db
    .update(poolItems)
    .set({ status: poolStatusOf(rows.map((r) => r.status)) })
    .where(eq(poolItems.id, poolItemId));
}

/* ── 任务 ── */

export async function listTasksByVan(van: string) {
  return getDb()
    .select()
    .from(tasks)
    .where(eq(tasks.vanCode, van))
    .orderBy(asc(tasks.id));
}

/** 计算某负责人在该班次已占用的档位合计（可排除某个任务自身） */
async function assignedTotalOf(
  van: string,
  ownerName: string,
  excludeTaskId?: number,
) {
  const rows = await getDb()
    .select({ size: tasks.size })
    .from(tasks)
    .where(
      and(
        eq(tasks.vanCode, van),
        eq(tasks.ownerName, ownerName),
        excludeTaskId ? ne(tasks.id, excludeTaskId) : undefined,
      ),
    );
  return rows.reduce((sum, r) => sum + (r.size ?? 0), 0);
}

/** 若负责人在成员表中，则按运力做负荷校验；自由输入的名字不校验 */
async function checkCapacity(
  van: string,
  ownerName: string | null | undefined,
  size: number | null | undefined,
  excludeTaskId?: number,
) {
  if (!ownerName || !size) return;
  const [member] = await getDb()
    .select()
    .from(members)
    .where(eq(members.name, ownerName));
  if (!member) return;
  const assigned = await assignedTotalOf(van, ownerName, excludeTaskId);
  assertWithinCapacity(ownerName, assigned, size, member.capacity);
}

export async function addTask(input: {
  van: string;
  title: string;
  poolItemId?: number | null;
  ownerName?: string | null;
  size?: 1 | 3 | 5 | null;
  acceptance?: string | null;
}) {
  await checkCapacity(input.van, input.ownerName, input.size);
  const db = getDb();
  await db.insert(tasks).values({
    vanCode: input.van,
    title: input.title,
    poolItemId: input.poolItemId ?? null,
    ownerName: input.ownerName ?? null,
    size: input.size ?? null,
    acceptance: input.acceptance ?? null,
  });
  // 需求池联动：按任务状态重算委托状态（上车 → 至少 scheduled）
  if (input.poolItemId) await syncPoolStatus(db, input.poolItemId);
  return listTasksByVan(input.van);
}

export async function updateTask(
  id: number,
  patch: Partial<{
    title: string;
    poolItemId: number | null;
    ownerName: string | null;
    size: 1 | 3 | 5 | null;
    acceptance: string | null;
    status: "todo" | "doing" | "done";
    doneAt: string | null;
    note: string | null;
  }>,
) {
  const db = getDb();
  const [current] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!current)
    throw new TRPCError({ code: "NOT_FOUND", message: `任务 ${id} 不存在` });

  // 负荷校验：负责人或档位变化时，按合并后的值检查
  if (patch.ownerName !== undefined || patch.size !== undefined) {
    const owner =
      patch.ownerName !== undefined ? patch.ownerName : current.ownerName;
    const size = patch.size !== undefined ? patch.size : current.size;
    await checkCapacity(current.vanCode, owner, size as 1 | 3 | 5 | null, id);
  }

  // 换委托：记录是否变更，供下方同步新旧委托状态
  const poolChanged =
    patch.poolItemId !== undefined && patch.poolItemId !== current.poolItemId;

  // 完成日期：打勾时随手填的自动化——置完成且无日期时记今天，取消完成则清空
  if (patch.status === "done" && patch.doneAt === undefined) {
    patch.doneAt = todayStr();
  } else if (patch.status && patch.status !== "done") {
    patch.doneAt = null;
  }

  await db.update(tasks).set(patch).where(eq(tasks.id, id));

  // 需求池联动：换委托时新旧委托都重算，仅状态变化时重算当前委托
  const poolIdsToSync = new Set<number>();
  if (poolChanged) {
    if (current.poolItemId !== null) poolIdsToSync.add(current.poolItemId);
    if (patch.poolItemId !== null) poolIdsToSync.add(patch.poolItemId!);
  } else if (patch.status !== undefined) {
    const poolId =
      patch.poolItemId !== undefined ? patch.poolItemId : current.poolItemId;
    if (poolId !== null) poolIdsToSync.add(poolId);
  }
  for (const poolId of poolIdsToSync) await syncPoolStatus(db, poolId);

  return listTasksByVan(current.vanCode);
}

export async function removeTask(id: number) {
  const db = getDb();
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!task)
    throw new TRPCError({ code: "NOT_FOUND", message: `任务 ${id} 不存在` });
  await db.delete(tasks).where(eq(tasks.id, id));
  // 需求池联动：任务下车，原委托按剩余任务重算状态
  if (task.poolItemId !== null) await syncPoolStatus(db, task.poolItemId);
}

/* ── 结转（设计方案第五章：未完成 = 结转下周，不允许"完成 80%"） ── */

export async function carryOver(fromVan: string, toVan: string) {
  if (fromVan === toVan) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "不能结转到同一班次" });
  }
  // 滞留件只能跟下一班车走
  const expected = nextVanCode(fromVan);
  if (toVan !== expected) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `只能结转到下一班次 ${expected}（收到 ${toVan}）`,
    });
  }
  const db = getDb();

  // 事务包裹查重 + 逐条插入：要么全部成功要么整体回滚，
  // 避免中途崩溃留下半截数据，被幂等守卫误判为"已结转"而锁死
  const carried = db.transaction((tx) => {
    // 幂等：同一对班次只允许结转一次，重复点击不产生重复任务
    const already = tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.vanCode, toVan), eq(tasks.carriedFrom, fromVan)))
      .limit(1)
      .all();
    if (already.length > 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `${fromVan} 的未完成任务已结转至 ${toVan}，请勿重复操作`,
      });
    }

    // 目标班次尚未发出时顺带创建：发新车与结转一步完成
    const vanExists = tx
      .select({ code: vans.code })
      .from(vans)
      .where(eq(vans.code, toVan))
      .limit(1)
      .all();
    if (vanExists.length === 0) {
      tx.insert(vans).values({ code: toVan }).run();
    }

    const unfinished = tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.vanCode, fromVan), ne(tasks.status, "done")))
      .all();

    for (const t of unfinished) {
      tx.insert(tasks).values(toStrandedTask(t, toVan)).run();
    }
    return unfinished.length;
  });
  return { carried, tasks: await listTasksByVan(toVan) };
}

/* ── 周统计（设计方案第八章：完成率 / 结转率；产能速览 = 表 3） ── */

export async function weeklyStats(van: string) {
  const rows = await listTasksByVan(van);
  const total = rows.length;
  const done = rows.filter((t) => t.status === "done").length;
  const carriedIn = rows.filter((t) => t.carriedFrom !== null).length;
  const reviewNeeded = rows.filter((t) => t.carryCount >= 2).length;

  // 稀有度分桶：任务 → 所属委托稀有度（无关联委托的任务不计入）
  const poolRows = await getDb()
    .select({ id: poolItems.id, rarity: poolItems.rarity })
    .from(poolItems);
  const rarityById = new Map(poolRows.map((r) => [r.id, r.rarity]));

  const memberRows = await listMembers();
  const byMember = memberRows.map((m) => {
    const mine = rows.filter((t) => t.ownerName === m.name);
    return {
      name: m.name,
      capacity: m.capacity,
      assigned: mine.reduce((s, t) => s + (t.size ?? 0), 0),
      taskCount: mine.length,
      done: mine.filter((t) => t.status === "done").length,
      carriedIn: mine.filter((t) => t.carriedFrom !== null).length,
    };
  });

  return {
    van,
    total,
    done,
    remaining: total - done,
    carriedIn,
    reviewNeeded,
    completionRate: total === 0 ? null : done / total,
    carryRate: total === 0 ? null : carriedIn / total,
    rarity: rarityStatsOf(rows, rarityById),
    members: byMember,
  };
}
