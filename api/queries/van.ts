import { and, asc, desc, eq, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./connection";
import { members, poolItems, tasks, type Task } from "../../db/schema";
import { nextVanCode, todayStr } from "../../contracts/vans";

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

/* ── 需求池 ── */

export async function listPoolItems() {
  return getDb().select().from(poolItems).orderBy(desc(poolItems.id));
}

export async function addPoolItem(input: {
  title: string;
  type: "epic" | "ready";
  targetVan?: string | null;
  note?: string;
}) {
  await getDb()
    .insert(poolItems)
    .values({
      title: input.title,
      type: input.type,
      targetVan: input.targetVan ?? null,
      note: input.note ?? null,
    });
  return listPoolItems();
}

export async function updatePoolItem(
  id: number,
  patch: Partial<{
    title: string;
    type: "epic" | "ready";
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

/** Epic 委托不可直接装车，需先切片为 ready 委托（抛错时任务不落库） */
async function assertNotEpic(db: ReturnType<typeof getDb>, poolItemId: number) {
  const [item] = await db
    .select({ type: poolItems.type })
    .from(poolItems)
    .where(eq(poolItems.id, poolItemId));
  if (item?.type === "epic") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Epic 委托需切片后才能装车",
    });
  }
}

/* ── 任务 ── */

export async function listTasksByVan(van: string) {
  return getDb()
    .select()
    .from(tasks)
    .where(eq(tasks.vanCode, van))
    .orderBy(asc(tasks.id));
}

/** 出现过的所有班次（新→旧），用于前端切换 */
export async function listVans() {
  const rows = await getDb()
    .selectDistinct({ vanCode: tasks.vanCode })
    .from(tasks)
    .orderBy(desc(tasks.vanCode));
  return rows.map((r) => r.vanCode);
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
  if (input.poolItemId) await assertNotEpic(db, input.poolItemId);
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

  // 换委托：新委托不能是 Epic
  const poolChanged =
    patch.poolItemId !== undefined && patch.poolItemId !== current.poolItemId;
  if (poolChanged && patch.poolItemId != null) {
    await assertNotEpic(db, patch.poolItemId);
  }

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
    members: byMember,
  };
}
