import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./connection";
import {
  members,
  poolItems,
  tasks,
  taskOwners,
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
    ownerName: null, // 已迁移至 task_owners 关联表，此处清空避免双源不一致
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

/* ── 任务带负责人列表的公共类型 ── */

export type TaskWithOwners = Task & { owners: string[] };

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

  // 调低运力时校验：通过 task_owners JOIN 查该成员各班次的档位合计
  if (capacity < member.capacity) {
    const taskRows = await db
      .select({ vanCode: tasks.vanCode, size: tasks.size })
      .from(taskOwners)
      .innerJoin(tasks, eq(taskOwners.taskId, tasks.id))
      .where(eq(taskOwners.ownerName, member.name));
    const byVan = new Map<string, number>();
    for (const r of taskRows)
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
  const vanRows = await db
    .select({ code: vans.code })
    .from(vans)
    .orderBy(asc(vans.createdAt));
  return items.map((item) => {
    let postedRounds = 0;
    if (item.status === "open" && item.postedVan !== null) {
      const idx = vanRows.findIndex((v) => v.code === item.postedVan);
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

/** 查询班次任务列表（附带负责人标签，单次 JOIN 查询） */
export async function listTasksByVan(van: string): Promise<TaskWithOwners[]> {
  const ownerAgg = getDb()
    .select({
      taskId: taskOwners.taskId,
      owners: sql<string>`group_concat(${taskOwners.ownerName})`.as("owners"),
    })
    .from(taskOwners)
    .groupBy(taskOwners.taskId)
    .as("owner_agg");
  const rows = await getDb()
    .select({
      id: tasks.id,
      vanCode: tasks.vanCode,
      title: tasks.title,
      poolItemId: tasks.poolItemId,
      ownerName: tasks.ownerName,
      size: tasks.size,
      acceptance: tasks.acceptance,
      status: tasks.status,
      carriedFrom: tasks.carriedFrom,
      carryCount: tasks.carryCount,
      doneAt: tasks.doneAt,
      note: tasks.note,
      createdAt: tasks.createdAt,
      owners: sql<string>`coalesce(${ownerAgg.owners}, '')`.as("owners"),
    })
    .from(tasks)
    .leftJoin(ownerAgg, eq(tasks.id, ownerAgg.taskId))
    .where(eq(tasks.vanCode, van))
    .orderBy(asc(tasks.id));
  return rows.map((r) => ({
    ...r,
    owners: r.owners ? r.owners.split(",") : [],
  }));
}

/** 计算某负责人在该班次已占用的档位合计（单次 JOIN 查询，可排除某个任务） */
async function assignedTotalOf(
  van: string,
  ownerName: string,
  excludeTaskId?: number,
) {
  const conditions = [
    eq(taskOwners.ownerName, ownerName),
    eq(tasks.vanCode, van),
    excludeTaskId ? ne(tasks.id, excludeTaskId) : undefined,
  ];
  const [row] = await getDb()
    .select({ total: sql<number>`coalesce(sum(${tasks.size}), 0)` })
    .from(taskOwners)
    .innerJoin(tasks, eq(taskOwners.taskId, tasks.id))
    .where(and(...conditions));
  return row?.total ?? 0;
}

/** 若负责人在成员表中，则按运力做负荷校验；自由输入的名字不校验 */
async function checkCapacity(
  van: string,
  owners: string[],
  size: number | null | undefined,
  excludeTaskId?: number,
) {
  if (!size) return;
  for (const name of owners) {
    const [member] = await getDb()
      .select()
      .from(members)
      .where(eq(members.name, name));
    if (!member) continue;
    const assigned = await assignedTotalOf(van, name, excludeTaskId);
    assertWithinCapacity(name, assigned, size, member.capacity);
  }
}

/** 替换任务的负责人标签（先删后插） */
async function replaceOwners(
  db: ReturnType<typeof getDb>,
  taskId: number,
  owners: string[],
) {
  await db.delete(taskOwners).where(eq(taskOwners.taskId, taskId));
  if (owners.length > 0) {
    await db
      .insert(taskOwners)
      .values(owners.map((name) => ({ taskId, ownerName: name })));
  }
}

export async function addTask(input: {
  van: string;
  title: string;
  poolItemId?: number | null;
  owners?: string[];
  size?: 1 | 3 | 5 | null;
  acceptance?: string | null;
}) {
  // 防重校验：同一委托只能接取一次，不能重复上车
  if (input.poolItemId) {
    const existing = await getDb()
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.poolItemId, input.poolItemId))
      .limit(1);
    if (existing.length > 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "该委托已被接取，不能重复上车",
      });
    }
  }
  await checkCapacity(input.van, input.owners ?? [], input.size);
  const db = getDb();
  const [inserted] = await db
    .insert(tasks)
    .values({
      vanCode: input.van,
      title: input.title,
      poolItemId: input.poolItemId ?? null,
      size: input.size ?? null,
      acceptance: input.acceptance ?? null,
    })
    .returning({ id: tasks.id });
  if (input.owners && input.owners.length > 0) {
    await replaceOwners(db, inserted.id, input.owners);
  }
  // 需求池联动：按任务状态重算委托状态（上车 → 至少 scheduled）
  if (input.poolItemId) await syncPoolStatus(db, input.poolItemId);
  return listTasksByVan(input.van);
}

export async function updateTask(
  id: number,
  patch: Partial<{
    title: string;
    poolItemId: number | null;
    owners: string[];
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
  if (patch.owners !== undefined || patch.size !== undefined) {
    const owners =
      patch.owners !== undefined ? patch.owners : await getOwnerNames(id);
    const size = patch.size !== undefined ? patch.size : current.size;
    await checkCapacity(current.vanCode, owners, size as 1 | 3 | 5 | null, id);
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

  // 分离 task_owners 字段（不写入 tasks 表）
  const { owners, ...taskPatch } = patch;
  await db.update(tasks).set(taskPatch).where(eq(tasks.id, id));

  // 更新负责人标签
  if (owners !== undefined) {
    await replaceOwners(db, id, owners);
  }

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

/** 获取任务的负责人名称列表 */
async function getOwnerNames(taskId: number): Promise<string[]> {
  const rows = await getDb()
    .select({ ownerName: taskOwners.ownerName })
    .from(taskOwners)
    .where(eq(taskOwners.taskId, taskId));
  return rows.map((r) => r.ownerName);
}

export async function removeTask(id: number) {
  const db = getDb();
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!task)
    throw new TRPCError({ code: "NOT_FOUND", message: `任务 ${id} 不存在` });
  // ON DELETE CASCADE 会自动清理 task_owners
  await db.delete(tasks).where(eq(tasks.id, id));
  if (task.poolItemId !== null) await syncPoolStatus(db, task.poolItemId);
}

/* ── 结转（设计方案第五章：未完成 = 结转下周，不允许"完成 80%"） ── */

export async function carryOver(fromVan: string, toVan: string) {
  if (fromVan === toVan) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "不能结转到同一班次" });
  }
  const expected = nextVanCode(fromVan);
  if (toVan !== expected) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `只能结转到下一班次 ${expected}（收到 ${toVan}）`,
    });
  }
  const db = getDb();

  const carried = db.transaction((tx) => {
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
      // 结转任务
      const [inserted] = tx
        .insert(tasks)
        .values(toStrandedTask(t, toVan))
        .returning({ id: tasks.id })
        .all();
      // 结转负责人标签
      const owners = tx
        .select({ ownerName: taskOwners.ownerName })
        .from(taskOwners)
        .where(eq(taskOwners.taskId, t.id))
        .all();
      if (owners.length > 0) {
        tx.insert(taskOwners)
          .values(
            owners.map((o) => ({
              taskId: inserted.id,
              ownerName: o.ownerName,
            })),
          )
          .run();
      }
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

  // 稀有度分桶
  const poolRows = await getDb()
    .select({ id: poolItems.id, rarity: poolItems.rarity })
    .from(poolItems);
  const rarityById = new Map(poolRows.map((r) => [r.id, r.rarity]));

  // 按负责人标签聚合运力统计（每人每班每任务计一次完整 size）
  const memberRows = await listMembers();
  const byMember = memberRows.map((m) => {
    const mine = rows.filter((t) => t.owners.includes(m.name));
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
