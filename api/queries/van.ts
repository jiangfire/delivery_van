import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./connection";
import {
  members,
  tasks,
  taskOwners,
  vans,
  RARITIES,
  type Rarity,
  type Task,
} from "../../db/schema";
import { firstVanCodeOf, nextVanCode, todayStr } from "../../contracts/vans";

/* ── 纯函数（无库可测） ── */

/** 生成结转到下一班次的任务副本（未完成 → 重置状态、结转次数 +1） */
export function toStrandedTask(
  task: Task,
  toVan: string,
): Omit<Task, "id" | "createdAt"> {
  return {
    vanCode: toVan,
    title: task.title,
    rarity: task.rarity,
    ownerName: null,
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
 * 稀有度分桶：把任务按稀有度聚合为 { rarity, total, done } 列表。
 * 只返回有任务的桶，顺序按 RARITIES 定义。
 */
export function rarityStatsOf(
  rows: Pick<Task, "rarity" | "status">[],
): { rarity: Rarity; total: number; done: number }[] {
  const buckets = new Map<Rarity, { total: number; done: number }>();
  for (const t of rows) {
    const b = buckets.get(t.rarity) ?? { total: 0, done: 0 };
    b.total += 1;
    if (t.status === "done") b.done += 1;
    buckets.set(t.rarity, b);
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
  await db.update(members).set({ capacity }).where(eq(members.id, id));
  return listMembers();
}

/* ── 快件 ── */

/** 查询班次快件列表（附带负责人标签，单次 JOIN 查询） */
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
      rarity: tasks.rarity,
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

/** 替换快件的负责人标签（先删后插） */
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
  rarity?: Rarity;
  owners?: string[];
  size?: 1 | 3 | 5 | null;
  acceptance?: string | null;
}) {
  const db = getDb();
  const [inserted] = await db
    .insert(tasks)
    .values({
      vanCode: input.van,
      title: input.title,
      rarity: input.rarity ?? "common",
      size: input.size ?? null,
      acceptance: input.acceptance ?? null,
    })
    .returning({ id: tasks.id });
  if (input.owners && input.owners.length > 0) {
    await replaceOwners(db, inserted.id, input.owners);
  }
  return listTasksByVan(input.van);
}

export async function updateTask(
  id: number,
  patch: Partial<{
    title: string;
    rarity: Rarity;
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

  // 完成日期：打勾时随手填的自动化——置完成且无日期时记今天，取消完成则清空
  if (patch.status === "done" && patch.doneAt === undefined) {
    patch.doneAt = todayStr();
  } else if (patch.status && patch.status !== "done") {
    patch.doneAt = null;
  }

  // 分离 task_owners 字段（不写入 tasks 表）
  const { owners, ...taskPatch } = patch;
  if (Object.keys(taskPatch).length > 0) {
    await db.update(tasks).set(taskPatch).where(eq(tasks.id, id));
  }

  // 更新负责人标签
  if (owners !== undefined) {
    await replaceOwners(db, id, owners);
  }

  return listTasksByVan(current.vanCode);
}

export async function removeTask(id: number) {
  const db = getDb();
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!task)
    throw new TRPCError({ code: "NOT_FOUND", message: `任务 ${id} 不存在` });
  // ON DELETE CASCADE 会自动清理 task_owners
  await db.delete(tasks).where(eq(tasks.id, id));
}

/* ── 结转（未完成 = 结转下周，不允许"完成 80%"） ── */

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
      // 结转快件
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

/* ── 周统计 ── */

export async function weeklyStats(van: string) {
  const rows = await listTasksByVan(van);
  const total = rows.length;
  const done = rows.filter((t) => t.status === "done").length;
  const carriedIn = rows.filter((t) => t.carriedFrom !== null).length;
  const reviewNeeded = rows.filter((t) => t.carryCount >= 2).length;

  // 按负责人标签聚合运力统计
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
    rarity: rarityStatsOf(rows),
    members: byMember,
  };
}
