import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
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
import {
  CARRY_REASONS,
  SOURCES,
  type CarryReason,
  type Source,
} from "../../contracts/enums";
import {
  carryTargetCode,
  firstVanCodeOf,
  nextVanCodeFrom,
  todayStr,
} from "../../contracts/vans";
import {
  appendAudit,
  fingerprintOf,
  type AuditDb,
  type AuditEntry,
} from "./audit";
import { auditLog } from "../../db/schema";

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
    requester: task.requester,
    size: task.size,
    acceptance: task.acceptance,
    status: "todo",
    carriedFrom: task.vanCode,
    carryCount: task.carryCount + 1,
    doneAt: null,
    note: task.note,
    sortOrder: task.sortOrder,
    source: task.source,
    // 签收信息不随件转运：副本重置为未签收（本次结转原因由 carryOver 覆写）
    carryReason: null,
    confirmedBy: null,
    confirmedAt: null,
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

/**
 * 班次任务统计（纯函数）：结转率 = 结转出去的任务数 / 总数（见设计方案「结转率」指标），
 * carriedIn 则记录本班承接的上一班滞留件数。
 */
export function taskStatsOf(
  rows: Pick<Task, "status" | "carriedFrom" | "carryCount">[],
) {
  const total = rows.length;
  const done = rows.filter((t) => t.status === "done").length;
  const carriedOut = rows.filter((t) => t.status === "carried").length;
  const carriedIn = rows.filter((t) => t.carriedFrom !== null).length;
  const reviewNeeded = rows.filter((t) => t.carryCount >= 2).length;
  return {
    total,
    done,
    carriedOut,
    carriedIn,
    reviewNeeded,
    remaining: total - done,
    completionRate: total === 0 ? null : done / total,
    carryRate: total === 0 ? null : carriedOut / total,
  };
}

/* ── v2.0 统计纯函数（WP1/WP3~WP6，全部无库可测） ── */

/**
 * 签收口径（WP3）：done 且（已签收 或 无提出人的自驱件）。
 * 自驱件不写库直接视同签收——统计口径推导，遵守「能推导不落库」。
 */
export function isConfirmed(
  t: Pick<Task, "status" | "requester" | "confirmedAt">,
): boolean {
  return (
    t.status === "done" && (t.confirmedAt !== null || t.requester === null)
  );
}

/** 提出人记分卡（WP1）：按提出人聚合，送达用签收口径，滞留用 stranded 口径 */
export function requesterStatsOf(
  rows: Pick<
    Task,
    "requester" | "status" | "rarity" | "carryCount" | "confirmedAt"
  >[],
) {
  const buckets = new Map<
    string,
    {
      key: string;
      total: number;
      delivered: number;
      stranded: number;
      urSsr: number;
      vans: number;
    }
  >();
  for (const t of rows) {
    const key = t.requester ?? "未标注";
    const b = buckets.get(key) ?? {
      key,
      total: 0,
      delivered: 0,
      stranded: 0,
      urSsr: 0,
      vans: 0,
    };
    b.total += 1;
    if (isConfirmed(t)) b.delivered += 1;
    if (t.status === "carried") b.stranded += 1;
    if (t.rarity === "ur" || t.rarity === "ssr") b.urSsr += 1;
    // 在车班数 = carryCount + 1（初始班 + 每次结转各一班）
    b.vans += t.carryCount + 1;
    buckets.set(key, b);
  }
  return [...buckets.values()]
    .map((b) => ({
      requester: b.key,
      total: b.total,
      delivered: b.delivered,
      stranded: b.stranded,
      urSsrRate: b.urSsr / b.total,
      avgVans: Math.round((b.vans / b.total) * 10) / 10,
    }))
    .sort(
      (a, b) => b.total - a.total || a.requester.localeCompare(b.requester),
    );
}

/** 稀有度通胀报表（WP1）：稀有度 × {done, stranded} 交叉表 + UR/N 滞留率对比行 */
export function rarityInflationOf(rows: Pick<Task, "rarity" | "status">[]): {
  byRarity: { rarity: Rarity; total: number; done: number; stranded: number }[];
  urStrandRate: number | null;
  nStrandRate: number | null;
} {
  const buckets = new Map<
    Rarity,
    { total: number; done: number; stranded: number }
  >();
  for (const t of rows) {
    const b = buckets.get(t.rarity) ?? { total: 0, done: 0, stranded: 0 };
    b.total += 1;
    if (t.status === "done") b.done += 1;
    if (t.status === "carried") b.stranded += 1;
    buckets.set(t.rarity, b);
  }
  const byRarity = RARITIES.filter((r) => buckets.has(r)).map((r) => ({
    rarity: r,
    ...buckets.get(r)!,
  }));
  const rate = (r: Rarity) => {
    const b = buckets.get(r);
    return b && b.total > 0 ? b.stranded / b.total : null;
  };
  return { byRarity, urStrandRate: rate("ur"), nStrandRate: rate("n") };
}

/** 三方占比（WP1）：全部三个来源桶都返回（含零桶，迷你条需要完整结构）+ 各方滞留率 */
export function sourceStatsOf(rows: Pick<Task, "source" | "status">[]): {
  source: Source;
  total: number;
  done: number;
  stranded: number;
  strandRate: number | null;
}[] {
  return SOURCES.map((source) => {
    const mine = rows.filter((t) => t.source === source);
    const total = mine.length;
    const stranded = mine.filter((t) => t.status === "carried").length;
    return {
      source,
      total,
      done: mine.filter((t) => t.status === "done").length,
      stranded,
      strandRate: total === 0 ? null : stranded / total,
    };
  });
}

/**
 * 昨日天气（WP4）：建议装载上限 = 上一班 done 任务（v1 口径，非签收口径——
 * 口径连续性规则：昨日天气与徽章统一用 done，confirmed 只喂签收覆盖率）点数合计。
 * vans 为最新在前的编码列表（编码定宽，字典序即发车时间序）；无历史班返回 null。
 */
export function suggestedLoadOf(
  van: string,
  vans: string[],
  rows: Pick<Task, "vanCode" | "status" | "size">[],
): number | null {
  const prev = vans
    .filter((v) => v < van)
    .sort()
    .at(-1);
  if (prev === undefined) return null;
  return rows
    .filter((t) => t.vanCode === prev && t.status === "done")
    .reduce((sum, t) => sum + (t.size ?? 0), 0);
}

/** 滞留原因瀑布（WP5）：只统计 stranded（carried）件，按枚举定义序输出，未分类殿后 */
export function carryReasonStatsOf(
  rows: Pick<Task, "carryReason" | "status">[],
): { reason: CarryReason | null; count: number }[] {
  const stranded = rows.filter((t) => t.status === "carried");
  const out: { reason: CarryReason | null; count: number }[] =
    CARRY_REASONS.map((reason) => ({
      reason,
      count: stranded.filter((t) => t.carryReason === reason).length,
    })).filter((r) => r.count > 0);
  const unclassified = stranded.filter((t) => t.carryReason === null).length;
  if (unclassified > 0) out.push({ reason: null, count: unclassified });
  return out;
}

/**
 * 徽章 v1（WP6，决议 4）：仅两枚、全自动、实时推导不落库。
 * - 🚚 整班准点：本班有件且全部送达（stranded 滞留 = 0）；
 * - 📦 送达连击：成员在连续 2 个「实际负责过件的班次」零滞留（跳班不补给，
 *   最新班实时乐观计数——尚未结转即视为暂无滞留，结转后如滞留会自动熄灭）。
 * vans 为最新在前的编码列表。
 */
export function badgesOf(
  van: string,
  vans: string[],
  rows: (Pick<Task, "vanCode" | "status"> & { owners: string[] })[],
): { teamPunctual: boolean; streaks: string[] } {
  const mine = rows.filter((t) => t.vanCode === van);
  const teamPunctual =
    mine.length > 0 && mine.every((t) => t.status === "done");

  const orderedVans = [...vans].sort().reverse(); // 最新在前
  const streaks: string[] = [];
  for (const name of new Set(rows.flatMap((t) => t.owners))) {
    let streak = 0;
    for (const v of orderedVans) {
      const mineInVan = rows.filter(
        (t) => t.vanCode === v && t.owners.includes(name),
      );
      if (mineInVan.length === 0) continue; // 未参与的班次不补给连击
      if (mineInVan.some((t) => t.status === "carried")) break; // 滞留断连击
      streak += 1;
    }
    if (streak >= 2) streaks.push(name);
  }
  return { teamPunctual, streaks: streaks.sort((a, b) => a.localeCompare(b)) };
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

/**
 * 发新车：表空时建当月首班车，否则在最新班次基础上 +1（跨月从新月份 A 重新
 * 计数）；返回最新列表。today 参数仅供测试注入，运行时取当前日期。
 */
export async function dispatchVan(
  today: Date = new Date(),
  actor?: string,
): Promise<string[]> {
  const list = await listVans();
  const code =
    list.length === 0 ? firstVanCodeOf(today) : nextVanCodeFrom(list[0], today);
  try {
    // 发车与审计同事务
    getDb().transaction((tx) => {
      tx.insert(vans).values({ code }).run();
      appendAudit(tx, actor, [
        {
          entity: "van",
          entityId: code,
          field: "*",
          oldValue: null,
          newValue: code,
        },
      ]);
    });
  } catch (e) {
    // 并发双击等极端情况下编码已被抢先插入：视为对方已发车，幂等返回当前列表
    if ((e as { code?: string }).code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
      return listVans();
    }
    throw e;
  }
  return listVans();
}

/* ── 成员 ── */

export async function listMembers() {
  return getDb().select().from(members).orderBy(asc(members.id));
}

export async function addMember(
  name: string,
  capacity: number,
  actor?: string,
) {
  const db = getDb();
  const dup = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.name, name))
    .limit(1);
  if (dup.length > 0) {
    throw new TRPCError({ code: "CONFLICT", message: `成员「${name}」已存在` });
  }
  try {
    // 成员新增与审计同事务
    db.transaction((tx) => {
      tx.insert(members).values({ name, capacity }).run();
      appendAudit(tx, actor, [
        {
          entity: "member",
          entityId: name,
          field: "*",
          oldValue: null,
          newValue: name,
        },
      ]);
    });
  } catch (e) {
    // 并发窗口内被抢先插入（UNIQUE 唯一约束）：按重名处理，不给前端裸 500
    if ((e as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
      throw new TRPCError({
        code: "CONFLICT",
        message: `成员「${name}」已存在`,
      });
    }
    throw e;
  }
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

/** 班次是否已结转归档：只要结转过（存在 carried 任务），整班只读不可改 */
async function isVanArchived(van: string) {
  const rows = await getDb()
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.vanCode, van), eq(tasks.status, "carried")))
    .limit(1);
  return rows.length > 0;
}

/** 查询班次快件列表（附带负责人标签，单次 JOIN 查询） */
export async function listTasksByVan(van: string): Promise<TaskWithOwners[]> {
  const rows = await taskRowsQuery(getDb())
    .where(eq(tasks.vanCode, van))
    .orderBy(asc(tasks.sortOrder), asc(tasks.id));
  return rows.map(splitOwners);
}

/** 全部班次的快件列表（昨日天气与徽章等跨班统计用） */
export async function listAllTasks(): Promise<TaskWithOwners[]> {
  const rows = await taskRowsQuery(getDb()).orderBy(
    asc(tasks.vanCode),
    asc(tasks.sortOrder),
    asc(tasks.id),
  );
  return rows.map(splitOwners);
}

/** 快件 + 负责人聚合的查询构造（listTasksByVan / listAllTasks 共用） */
function taskRowsQuery(db: ReturnType<typeof getDb>) {
  const ownerAgg = db
    .select({
      taskId: taskOwners.taskId,
      owners: sql<string>`group_concat(${taskOwners.ownerName})`.as("owners"),
    })
    .from(taskOwners)
    .groupBy(taskOwners.taskId)
    .as("owner_agg");
  return db
    .select({
      id: tasks.id,
      vanCode: tasks.vanCode,
      title: tasks.title,
      rarity: tasks.rarity,
      requester: tasks.requester,
      size: tasks.size,
      acceptance: tasks.acceptance,
      status: tasks.status,
      carriedFrom: tasks.carriedFrom,
      carryCount: tasks.carryCount,
      doneAt: tasks.doneAt,
      note: tasks.note,
      sortOrder: tasks.sortOrder,
      source: tasks.source,
      carryReason: tasks.carryReason,
      confirmedBy: tasks.confirmedBy,
      confirmedAt: tasks.confirmedAt,
      createdAt: tasks.createdAt,
      owners: sql<string>`coalesce(${ownerAgg.owners}, '')`.as("owners"),
    })
    .from(tasks)
    .leftJoin(ownerAgg, eq(tasks.id, ownerAgg.taskId));
}

function splitOwners<T extends { owners: string | null }>(row: T) {
  return { ...row, owners: row.owners ? row.owners.split(",") : [] };
}

/* ── 审计辅助（WP2：写操作出口统一走 appendAudit） ── */

/** 敏感自由文本的审计占位：留「变过」的事实不留内容（不可篡改日志与数据最小化的折衷） */
const TEXT_REDACTED = "(text)";

/** 审计日志用的快件摘要 JSON（note / acceptance 自由文本不进链） */
function taskAuditValue(t: {
  title: string;
  rarity: string;
  requester: string | null;
  size: number | null;
  source: string;
  status?: string;
  carriedFrom?: string | null;
  owners?: string[];
}): string {
  return JSON.stringify({
    title: t.title,
    rarity: t.rarity,
    requester: t.requester ?? undefined,
    size: t.size ?? undefined,
    source: t.source,
    ...(t.status ? { status: t.status } : {}),
    ...(t.carriedFrom !== undefined ? { carriedFrom: t.carriedFrom } : {}),
    ...(t.owners ? { owners: t.owners } : {}),
  });
}

/** 事务对象的最小结构约束（业务写与审计同事务，回调内同步调用） */
type TxDb = AuditDb & Pick<ReturnType<typeof getDb>, "update" | "delete">;

/** 替换快件的负责人标签（先删后插；事务内同步调用） */
function replaceOwners(tx: TxDb, taskId: number, owners: string[]) {
  tx.delete(taskOwners).where(eq(taskOwners.taskId, taskId)).run();
  if (owners.length > 0) {
    tx.insert(taskOwners)
      .values(owners.map((name) => ({ taskId, ownerName: name })))
      .run();
  }
}

export async function addTask(input: {
  van: string;
  title: string;
  rarity?: Rarity;
  requester?: string;
  owners?: string[];
  size?: number | null;
  acceptance?: string | null;
  source?: Source;
  actor?: string;
}) {
  if (await isVanArchived(input.van)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `班次 ${input.van} 已结转归档，不可新增快件`,
    });
  }
  const db = getDb();
  // 新快件排在班次末尾
  const [maxRow] = await db
    .select({ max: sql<number | null>`max(${tasks.sortOrder})` })
    .from(tasks)
    .where(eq(tasks.vanCode, input.van));
  // 业务写与审计同事务：任何一侧失败整体回滚，不留未记账的写
  db.transaction((tx) => {
    const [inserted] = tx
      .insert(tasks)
      .values({
        vanCode: input.van,
        title: input.title,
        rarity: input.rarity ?? "n",
        requester: input.requester ?? null,
        size: input.size ?? null,
        acceptance: input.acceptance ?? null,
        source: input.source ?? "customer",
        sortOrder: (maxRow?.max ?? 0) + 1,
      })
      .returning({ id: tasks.id })
      .all();
    if (input.owners && input.owners.length > 0) {
      replaceOwners(tx, inserted.id, input.owners);
    }
    appendAudit(tx, input.actor, [
      {
        entity: "task",
        entityId: inserted.id,
        field: "*",
        oldValue: null,
        newValue: taskAuditValue({
          title: input.title,
          rarity: input.rarity ?? "n",
          requester: input.requester ?? null,
          size: input.size ?? null,
          source: input.source ?? "customer",
          owners: input.owners,
        }),
      },
    ]);
  });
  return listTasksByVan(input.van);
}

/** 拖拽排序：按传入 id 顺序全量重写班次内 sort_order（幂等，可重复调用） */
export async function reorderTasks(van: string, ids: number[], actor?: string) {
  if (await isVanArchived(van)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `班次 ${van} 已结转归档，不可调整顺序`,
    });
  }
  const db = getDb();
  // 防御：ids 必须恰好覆盖本班全部快件，避免越权改别班数据或漏排
  const rows = await db
    .select({ id: tasks.id, sortOrder: tasks.sortOrder })
    .from(tasks)
    .where(eq(tasks.vanCode, van));
  const vanIds = new Set(rows.map((r) => r.id));
  if (ids.length !== vanIds.size || ids.some((id) => !vanIds.has(id))) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "排序列表与本班快件不一致，请刷新后重试",
    });
  }
  // 只记实际变化的行（单次拖拽通常只动 1~3 行）
  const oldById = new Map(rows.map((r) => [r.id, r.sortOrder]));
  db.transaction((tx) => {
    ids.forEach((id, idx) => {
      tx.update(tasks).set({ sortOrder: idx }).where(eq(tasks.id, id)).run();
    });
    appendAudit(
      tx,
      actor,
      ids.flatMap((id, idx) => {
        const old = oldById.get(id);
        return old === idx
          ? []
          : [
              {
                entity: "task",
                entityId: id,
                field: "sort_order",
                oldValue: old == null ? null : String(old),
                newValue: String(idx),
              },
            ];
      }),
    );
  });
  return listTasksByVan(van);
}

export async function updateTask(
  id: number,
  patch: Partial<{
    title: string;
    rarity: Rarity;
    requester: string | null;
    owners: string[];
    size: number | null;
    acceptance: string | null;
    status: "todo" | "doing" | "done";
    doneAt: string | null;
    note: string | null;
    source: Source;
    /* confirmed_* 仅数据层内部使用：取消完成时作废签收，路由层不暴露 */
    confirmedBy?: string | null;
    confirmedAt?: string | null;
  }>,
  actor?: string,
) {
  const db = getDb();
  const [current] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!current)
    throw new TRPCError({ code: "NOT_FOUND", message: `任务 ${id} 不存在` });
  if (await isVanArchived(current.vanCode)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `班次 ${current.vanCode} 已结转归档，不可修改`,
    });
  }
  // 现任负责人（审计对比用，成员标签不含半角逗号，join 安全）
  const currentOwners = (
    await db
      .select({ ownerName: taskOwners.ownerName })
      .from(taskOwners)
      .where(eq(taskOwners.taskId, id))
  ).map((r) => r.ownerName);

  // 完成日期：打勾时随手填的自动化——置完成且无日期时记今天，取消完成则清空；
  // 取消完成同时作废签收（重新送达后需重新签收，与 doneAt 同口径）
  let confirmVoided = false;
  if (patch.status === "done" && patch.doneAt === undefined) {
    patch.doneAt = todayStr();
  } else if (patch.status && patch.status !== "done") {
    patch.doneAt = null;
    if (current.confirmedBy !== null || current.confirmedAt !== null) {
      patch.confirmedBy = null;
      patch.confirmedAt = null;
      confirmVoided = true;
    }
  }

  // 分离 task_owners 字段（不写入 tasks 表）
  const { owners, ...taskPatch } = patch;

  // 审计：逐字段 diff，值未变不记；note / acceptance 自由文本以占位符进链
  const FIELD_KEYS = [
    "title",
    "rarity",
    "requester",
    "size",
    "acceptance",
    "status",
    "doneAt",
    "note",
    "source",
  ] as const;
  const entries: AuditEntry[] = [];
  for (const f of FIELD_KEYS) {
    const next = patch[f];
    if (next === undefined) continue;
    const prev = current[f];
    if (prev === next) continue;
    const redact = f === "note" || f === "acceptance";
    entries.push({
      entity: "task",
      entityId: id,
      field: f === "doneAt" ? "done_at" : f,
      oldValue:
        redact && prev != null
          ? TEXT_REDACTED
          : prev == null
            ? null
            : String(prev),
      newValue:
        redact && next != null
          ? TEXT_REDACTED
          : next == null
            ? null
            : String(next),
    });
  }
  // 签收作废留痕：留「谁签过的」事实，重新签收另行入链
  if (confirmVoided) {
    entries.push({
      entity: "task",
      entityId: id,
      field: "confirm",
      oldValue: current.confirmedBy,
      newValue: null,
    });
  }
  if (owners !== undefined && owners.join(",") !== currentOwners.join(",")) {
    entries.push({
      entity: "task",
      entityId: id,
      field: "owners",
      oldValue: currentOwners.length > 0 ? currentOwners.join(",") : null,
      newValue: owners.length > 0 ? owners.join(",") : null,
    });
  }

  // 业务写与审计同事务：任何一侧失败整体回滚，不留未记账的写
  db.transaction((tx) => {
    if (Object.keys(taskPatch).length > 0) {
      tx.update(tasks).set(taskPatch).where(eq(tasks.id, id)).run();
    }
    // 更新负责人标签
    if (owners !== undefined) {
      replaceOwners(tx, id, owners);
    }
    appendAudit(tx, actor, entries);
  });

  return listTasksByVan(current.vanCode);
}

export async function removeTask(id: number, actor?: string) {
  const db = getDb();
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!task)
    throw new TRPCError({ code: "NOT_FOUND", message: `任务 ${id} 不存在` });
  if (await isVanArchived(task.vanCode)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `班次 ${task.vanCode} 已结转归档，不可删除`,
    });
  }
  // ON DELETE CASCADE 会自动清理 task_owners；删除留痕与删除同事务
  db.transaction((tx) => {
    tx.delete(tasks).where(eq(tasks.id, id)).run();
    appendAudit(tx, actor, [
      {
        entity: "task",
        entityId: id,
        field: "*",
        oldValue: taskAuditValue(task),
        newValue: null,
      },
    ]);
  });
}

/* ── 结转（未完成 = 结转下周，不允许"完成 80%"） ── */

export async function carryOver(
  fromVan: string,
  toVan: string,
  today: Date = new Date(),
  opts: { actor?: string; carryReason?: CarryReason } = {},
) {
  if (fromVan === toVan) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "不能结转到同一班次" });
  }
  // 紧邻的下一班：已存在则必须转去已存在的最近一班，否则按当前日期推导（可能跨月从 A 起）
  const expected = carryTargetCode(fromVan, await listVans(), today);
  if (toVan !== expected) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `只能结转到下一班次 ${expected}（收到 ${toVan}）`,
    });
  }
  const db = getDb();
  const { carryReason } = opts;

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

    // 结转快件追加到目标班末尾（拖拽排序列：从目标班现有 max(sort_order) 起递增）
    const [maxRow] = tx
      .select({ max: sql<number | null>`max(${tasks.sortOrder})` })
      .from(tasks)
      .where(eq(tasks.vanCode, toVan))
      .all();
    let nextSort = (maxRow?.max ?? 0) + 1;

    const copies: { src: (typeof unfinished)[number]; newId: number }[] = [];
    for (const t of unfinished) {
      // 结转快件（本次结转原因覆写：结转原因描述的是「这次为什么没送完」）
      const [inserted] = tx
        .insert(tasks)
        .values({
          ...toStrandedTask(t, toVan),
          carryReason: carryReason ?? null,
          sortOrder: nextSort++,
        })
        .returning({ id: tasks.id })
        .all();
      copies.push({ src: t, newId: inserted.id });
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
    // 源班次的快件标记为 🔁结转，旧车数据同步可见（四态：未开始/进行中/完成/结转）
    if (unfinished.length > 0) {
      tx.update(tasks)
        .set({
          status: "carried",
          ...(carryReason ? { carryReason } : {}),
        })
        .where(
          inArray(
            tasks.id,
            unfinished.map((t) => t.id),
          ),
        )
        .run();
    }
    const result = {
      count: unfinished.length,
      vanCreated: vanExists.length === 0,
      copies,
    };
    // 审计与结转同事务：half-way 崩溃不产生「转了件但没记账」
    appendAudit(tx, opts.actor, [
      ...(result.vanCreated
        ? [
            {
              entity: "van",
              entityId: toVan,
              field: "*",
              oldValue: null,
              newValue: toVan,
            },
          ]
        : []),
      ...result.copies.flatMap((c) => [
        {
          entity: "task",
          entityId: c.src.id,
          field: "status",
          oldValue: String(c.src.status),
          newValue: "carried",
        },
        ...(carryReason
          ? [
              {
                entity: "task",
                entityId: c.src.id,
                field: "carry_reason",
                oldValue: null,
                newValue: carryReason,
              },
            ]
          : []),
        {
          entity: "task",
          entityId: c.newId,
          field: "*",
          oldValue: null,
          newValue: taskAuditValue({
            ...c.src,
            status: "todo",
            carriedFrom: fromVan,
          }),
        },
      ]),
    ]);
    return result;
  });
  return { carried: carried.count, tasks: await listTasksByVan(toVan) };
}

/* ── 签收制（WP3）：done 拆两拍，送达（承运人）→ 签收（提出人） ── */

/**
 * 提出人签收：任务必须已送达（done）、班次未归档、签收人必须是成员。
 * 无提出人的自驱件不写库直接视同签收（能推导不落库）；已签收的重签幂等
 * （保持首签信息不变）。
 */
export async function confirmTask(taskId: number, actor: string) {
  const db = getDb();
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `任务 ${taskId} 不存在`,
    });
  if (task.status !== "done") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "只有已送达（完成）的快件才能签收",
    });
  }
  if (await isVanArchived(task.vanCode)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `班次 ${task.vanCode} 已结转归档，不可签收`,
    });
  }
  const [member] = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.name, actor))
    .limit(1);
  if (!member) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `签收人「${actor}」不是团队成员`,
    });
  }
  // 自驱件（无提出人）与已签收件：直接返回，不写库（幂等，不覆盖首签）
  if (task.requester === null || task.confirmedAt !== null) {
    return listTasksByVan(task.vanCode);
  }
  // 签收留痕与签收同事务
  db.transaction((tx) => {
    tx.update(tasks)
      .set({ confirmedBy: actor, confirmedAt: todayStr() })
      .where(eq(tasks.id, taskId))
      .run();
    appendAudit(tx, actor, [
      {
        entity: "task",
        entityId: taskId,
        field: "confirm",
        oldValue: null,
        newValue: actor,
      },
    ]);
  });
  return listTasksByVan(task.vanCode);
}

/* ── 周统计 ── */

export async function weeklyStats(van: string) {
  const rows = await listTasksByVan(van);
  const taskStats = taskStatsOf(rows);

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

  // v2.0 扩展：跨班统计（昨日天气 / 徽章）需要全部班次与快件，日志指纹取链头
  const [allVans, allTasks] = await Promise.all([listVans(), listAllTasks()]);
  const [auditTail] = await getDb()
    .select({ hash: auditLog.hash })
    .from(auditLog)
    .orderBy(desc(auditLog.id))
    .limit(1);

  return {
    van,
    ...taskStats,
    rarity: rarityStatsOf(rows),
    members: byMember,
    /* ── v2.0（Phase 1）统计扩展 ── */
    // 未签收：done 且不满足签收口径（自驱件视同签收，不计入）
    unconfirmed: rows.filter((t) => t.status === "done" && !isConfirmed(t))
      .length,
    requester: requesterStatsOf(rows),
    inflation: rarityInflationOf(rows),
    source: sourceStatsOf(rows),
    suggestedLoad: suggestedLoadOf(van, allVans, allTasks),
    badges: badgesOf(van, allVans, allTasks),
    carryReasons: carryReasonStatsOf(rows),
    auditFingerprint: fingerprintOf(auditTail?.hash),
  };
}
