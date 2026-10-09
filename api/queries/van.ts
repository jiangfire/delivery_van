import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./connection";
import { RARITIES, type Rarity, type Task } from "../../db/schema";
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
import { taskPointsOf, type OwnerAlloc } from "../../contracts/points";
import {
  appendAudit,
  fingerprintOf,
  type AuditDb,
  type AuditEntry,
} from "./audit";
import { runTx } from "./tx";
import {
  getSchema,
  insertReturningId,
  isUniqueViolation,
  qAll,
  qRun,
  type AppDb,
} from "./dialect";

// 当前方言的表对象（类型标为 sqlite schema，运行时为对应方言版本，见 dialect.ts）
const { members, tasks, taskOwners, vans, auditLog } = getSchema();

/* ── 纯函数（无库可测） ── */

/** 生成结转到下一班次的任务副本（未完成 → 重置状态、结转次数 +1） */
export function toStrandedTask(
  task: Task,
  toVan: string,
): Omit<Task, "id" | "createdAt" | "size"> {
  return {
    vanCode: toVan,
    title: task.title,
    rarity: task.rarity,
    requester: task.requester,
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
 * 口径连续性规则：昨日天气与徽章统一用 done，confirmed 只喂签收覆盖率）的**点数合计**
 * ——v2.5 起点数归属到人，任务点数 = 各负责人点数之和（未指派的件为 0）。
 * vans 为最新在前的编码列表（编码定宽，字典序即发车时间序）；无历史班返回 null。
 */
export function suggestedLoadOf(
  van: string,
  vans: string[],
  rows: (Pick<Task, "vanCode" | "status"> & { owners: { points: number }[] })[],
): number | null {
  const prev = vans
    .filter((v) => v < van)
    .sort()
    .at(-1);
  if (prev === undefined) return null;
  return rows
    .filter((t) => t.vanCode === prev && t.status === "done")
    .reduce((sum, t) => sum + taskPointsOf(t.owners), 0);
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
  rows: (Pick<Task, "vanCode" | "status"> & { owners: { name: string }[] })[],
): { teamPunctual: boolean; streaks: string[] } {
  const mine = rows.filter((t) => t.vanCode === van);
  const teamPunctual =
    mine.length > 0 && mine.every((t) => t.status === "done");

  const orderedVans = [...vans].sort().reverse(); // 最新在前
  const streaks: string[] = [];
  for (const name of new Set(
    rows.flatMap((t) => t.owners.map((o) => o.name)),
  )) {
    let streak = 0;
    for (const v of orderedVans) {
      const mineInVan = rows.filter(
        (t) => t.vanCode === v && t.owners.some((o) => o.name === name),
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

/**
 * 读模型：快件 + 各负责人的点数与逐人完成/签收状态。`size` 已废弃（v2.5），
 * 对外不再暴露——任务点数一律由 `taskPointsOf(owners)` 求得。
 */
export type OwnerState = OwnerAlloc & {
  doneAt: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
};
export type TaskWithOwners = Omit<Task, "size"> & { owners: OwnerState[] };

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
    await runTx(getDb(), async (tx) => {
      await qRun(tx.insert(vans).values({ code }));
      await appendAudit(tx, actor, [
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
    // 并发双击等极端情况下编码已被抢先插入（撞班次主键）：视为对方已发车，幂等返回当前列表
    if (isUniqueViolation(e)) {
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
    await runTx(db, async (tx) => {
      await qRun(tx.insert(members).values({ name, capacity }));
      await appendAudit(tx, actor, [
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
    // 并发窗口内被抢先插入（撞 name 唯一约束，各方言错误码见 isUniqueViolation）：按重名处理，不给前端裸 500
    if (isUniqueViolation(e)) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `成员「${name}」已存在`,
      });
    }
    throw e;
  }
  return listMembers();
}

/**
 * 改成员运力：业务写与审计同事务（`actor` 为软身份，缺省 '(unknown)'）。
 * 此前该 mutation 漏记账——运力变更不在链上，无法对质；v2.4 随 MCP 暴露
 * 该操作后补齐，与其余写操作同口径。
 */
export async function updateMemberCapacity(
  id: number,
  capacity: number,
  actor?: string,
) {
  const db = getDb();
  const [member] = await db.select().from(members).where(eq(members.id, id));
  if (!member)
    throw new TRPCError({ code: "NOT_FOUND", message: `成员 ${id} 不存在` });
  await runTx(db, async (tx) => {
    await qRun(tx.update(members).set({ capacity }).where(eq(members.id, id)));
    await appendAudit(tx, actor, [
      {
        entity: "member",
        entityId: member.name,
        field: "capacity",
        oldValue: String(member.capacity),
        newValue: String(capacity),
      },
    ]);
  });
  return listMembers();
}

/**
 * 删除成员（有守卫的硬删）：名字在任何快件上留过痕迹即拒绝——
 * 负责人/提出人/签收人全是纯文本名字引用（无外键），删了会留悬空标签弄脏统计，
 * 且签收要求操作人是成员，有历史的成员必须保留。
 * 入参用名字（members.name 唯一）：全领域身份本就是名字标签，统计区/我是谁都只持名字。
 */
export async function removeMember(name: string, actor?: string) {
  const db = getDb();
  const [member] = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.name, name))
    .limit(1);
  if (!member)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `成员「${name}」不存在`,
    });

  const owned = await db
    .select({ taskId: taskOwners.taskId })
    .from(taskOwners)
    .where(eq(taskOwners.ownerName, name));
  const requested = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.requester, name));
  const confirmed = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.confirmedBy, name));
  if (owned.length + requested.length + confirmed.length > 0) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `成员「${name}」已有快件记录（负责 ${owned.length} 件 / 提出 ${requested.length} 件 / 签收 ${confirmed.length} 件），不可删除`,
    });
  }

  // 删除与审计同事务（整行删除记 '*'，与 addMember 对称）
  await runTx(db, async (tx) => {
    await qRun(tx.delete(members).where(eq(members.id, member.id)));
    await appendAudit(tx, actor, [
      {
        entity: "member",
        entityId: name,
        field: "*",
        oldValue: name,
        newValue: null,
      },
    ]);
  });
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

/** 查询班次快件列表（附带各负责人的点数） */
export async function listTasksByVan(van: string): Promise<TaskWithOwners[]> {
  const rows = await taskRowsQuery(getDb())
    .where(eq(tasks.vanCode, van))
    .orderBy(asc(tasks.sortOrder), asc(tasks.id));
  return attachOwners(rows);
}

/** 全部班次的快件列表（昨日天气与徽章等跨班统计用） */
export async function listAllTasks(): Promise<TaskWithOwners[]> {
  const rows = await taskRowsQuery(getDb()).orderBy(
    asc(tasks.vanCode),
    asc(tasks.sortOrder),
    asc(tasks.id),
  );
  return attachOwners(rows);
}

/**
 * 快件查询（不含负责人）。负责人是**每人一份的叶子行**（各自带点数），
 * 单独查一次再在 JS 里按 taskId 归组——不用 group_concat 把名字与点数拼成串对齐：
 * 组内顺序各方言无保证，靠两次聚合恰好同序是脆弱假设。
 */
function taskRowsQuery(db: ReturnType<typeof getDb>) {
  return db
    .select({
      id: tasks.id,
      vanCode: tasks.vanCode,
      title: tasks.title,
      rarity: tasks.rarity,
      requester: tasks.requester,
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
    })
    .from(tasks);
}

type TaskBaseRow = Omit<Task, "size">;

/** 给一批快件挂上各自的负责人（含点数）；无负责人的件得到空数组 */
async function attachOwners(rows: TaskBaseRow[]): Promise<TaskWithOwners[]> {
  if (rows.length === 0) return [];
  const allocs = await getDb()
    .select({
      taskId: taskOwners.taskId,
      name: taskOwners.ownerName,
      points: taskOwners.points,
      doneAt: taskOwners.doneAt,
      confirmedAt: taskOwners.confirmedAt,
      confirmedBy: taskOwners.confirmedBy,
    })
    .from(taskOwners)
    .where(
      inArray(
        taskOwners.taskId,
        rows.map((r) => r.id),
      ),
    );
  const byTask = new Map<number, OwnerState[]>();
  for (const a of allocs) {
    const alloc = {
      name: a.name,
      points: a.points,
      doneAt: a.doneAt,
      confirmedAt: a.confirmedAt,
      confirmedBy: a.confirmedBy,
    };
    const list = byTask.get(a.taskId);
    if (list) list.push(alloc);
    else byTask.set(a.taskId, [alloc]);
  }
  return rows.map((r) => ({ ...r, owners: byTask.get(r.id) ?? [] }));
}

/* ── 审计辅助（WP2：写操作出口统一走 appendAudit） ── */

/** 敏感自由文本的审计占位：留「变过」的事实不留内容（不可篡改日志与数据最小化的折衷） */
const TEXT_REDACTED = "(text)";

/** 审计日志用的快件摘要 JSON（note / acceptance 自由文本不进链） */
function taskAuditValue(t: {
  title: string;
  rarity: string;
  requester: string | null;
  source: string;
  status?: string;
  carriedFrom?: string | null;
  owners?: OwnerAlloc[];
}): string {
  return JSON.stringify({
    title: t.title,
    rarity: t.rarity,
    requester: t.requester ?? undefined,
    source: t.source,
    ...(t.status ? { status: t.status } : {}),
    ...(t.carriedFrom !== undefined ? { carriedFrom: t.carriedFrom } : {}),
    ...(t.owners ? { owners: t.owners } : {}),
  });
}

/** 事务对象的最小结构约束（业务写与审计同事务，回调内同步调用） */
type TxDb = AuditDb &
  Pick<ReturnType<typeof getDb>, "update" | "delete" | "select">;

/**
 * 替换快件的负责人（含各自点数）。**同名保留**（D14）：名字仍在的人保留其
 * `done_at` / `confirmed_at` / `confirmed_by`，新名字三列 NULL，被移除的人整行删除——
 * 否则「改个点数就抹掉交付与签收」。事务内调用，执行统一走方言层。
 */
async function replaceOwners(tx: TxDb, taskId: number, owners: OwnerAlloc[]) {
  const existing = await qAll(
    tx.select().from(taskOwners).where(eq(taskOwners.taskId, taskId)),
  );
  const byName = new Map(existing.map((r) => [r.ownerName, r]));
  const keep = new Set(owners.map((o) => o.name));
  for (const r of existing) {
    if (!keep.has(r.ownerName)) {
      await qRun(
        tx
          .delete(taskOwners)
          .where(
            and(
              eq(taskOwners.taskId, taskId),
              eq(taskOwners.ownerName, r.ownerName),
            ),
          ),
      );
    }
  }
  for (const o of owners) {
    const prev = byName.get(o.name);
    if (prev) {
      if (prev.points !== o.points) {
        await qRun(
          tx
            .update(taskOwners)
            .set({ points: o.points })
            .where(
              and(
                eq(taskOwners.taskId, taskId),
                eq(taskOwners.ownerName, o.name),
              ),
            ),
        );
      }
    } else {
      await qRun(
        tx
          .insert(taskOwners)
          .values({ taskId, ownerName: o.name, points: o.points }),
      );
    }
  }
}

export async function addTask(input: {
  van: string;
  title: string;
  rarity?: Rarity;
  requester?: string;
  owners?: OwnerAlloc[];
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
  await runTx(db, async (tx) => {
    // mysql 无 RETURNING，取自增 id 统一走方言层
    const insertedId = await insertReturningId(tx, tasks, {
      vanCode: input.van,
      title: input.title,
      rarity: input.rarity ?? "n",
      requester: input.requester ?? null,
      acceptance: input.acceptance ?? null,
      source: input.source ?? "customer",
      sortOrder: (maxRow?.max ?? 0) + 1,
    });
    if (input.owners && input.owners.length > 0) {
      await replaceOwners(tx, insertedId, input.owners);
    }
    await appendAudit(tx, input.actor, [
      {
        entity: "task",
        entityId: insertedId,
        field: "*",
        oldValue: null,
        newValue: taskAuditValue({
          title: input.title,
          rarity: input.rarity ?? "n",
          requester: input.requester ?? null,
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
  await runTx(db, async (tx) => {
    for (const [idx, id] of ids.entries()) {
      await qRun(
        tx.update(tasks).set({ sortOrder: idx }).where(eq(tasks.id, id)),
      );
    }
    await appendAudit(
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
    owners: OwnerAlloc[];
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
  // 现任负责人（含各自点数，审计对比用）。负责人顺序无语义（点数各归各人），
  // 故对比前按名字归一，避免仅顺序变化就记一条无意义的链。
  const currentOwners: OwnerAlloc[] = await db
    .select({ name: taskOwners.ownerName, points: taskOwners.points })
    .from(taskOwners)
    .where(eq(taskOwners.taskId, id));
  const ownersKey = (list: OwnerAlloc[]) =>
    JSON.stringify(
      [...list].sort((a, b) => a.name.localeCompare(b.name, "zh")),
    );

  // ── 件级完成/日期 → 叶子聚合（v2.6）──
  // 有负责人的件里，件级 status / doneAt 是叶子聚合的物化，不能直接写：把它们翻译成
  // 对**参与判定全体**的叶子写（D8/D17），再由 recomputeTaskAggregate 收敛件级字段。
  // 无负责人的件保留原手动路径（D12）。
  const targetOwners = patch.owners ?? currentOwners;
  const hasOwners = targetOwners.length > 0;
  const judged = judgedOf(targetOwners);
  let leafDoneAt: string | null | undefined; // undefined = 不改叶子
  if (hasOwners) {
    if (patch.status === "done") {
      leafDoneAt = patch.doneAt ?? todayStr();
    } else if (
      patch.doneAt !== undefined &&
      patch.status === undefined &&
      current.status === "done"
    ) {
      // 送达日期手工补录/清除（当前已完成）
      leafDoneAt = patch.doneAt;
    } else if (
      patch.status !== undefined &&
      current.status === "done"
    ) {
      // 取消完成：清全体完成日期并作废全体签收（D6/D8）
      leafDoneAt = null;
    }
  }
  const shortcut = leafDoneAt !== undefined;

  // 分离 task_owners 字段（不写入 tasks 表）
  const { owners, ...taskPatchBase } = patch;
  const taskPatch: typeof taskPatchBase = { ...taskPatchBase };
  // 叶子变更已代表这次完成/日期修改，件级派生字段交给 recompute，不直接落任务行
  if (hasOwners && shortcut) {
    delete taskPatch.status;
    delete taskPatch.doneAt;
  }

  // 无负责人件的原口径（D12）：打勾自动填今天、取消完成清日期并作废签收
  let confirmVoided = false;
  if (!hasOwners) {
    if (patch.status === "done" && patch.doneAt === undefined) {
      taskPatch.doneAt = todayStr();
    } else if (patch.status && patch.status !== "done") {
      taskPatch.doneAt = null;
      if (current.confirmedBy !== null || current.confirmedAt !== null) {
        taskPatch.confirmedBy = null;
        taskPatch.confirmedAt = null;
        confirmVoided = true;
      }
    }
  }

  // 审计：逐字段 diff，值未变不记；note / acceptance 自由文本以占位符进链
  const FIELD_KEYS = [
    "title",
    "rarity",
    "requester",
    "acceptance",
    "status",
    "doneAt",
    "note",
    "source",
  ] as const;
  const entries: AuditEntry[] = [];
  for (const f of FIELD_KEYS) {
    const next = taskPatch[f];
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
  if (owners !== undefined && ownersKey(owners) !== ownersKey(currentOwners)) {
    entries.push({
      entity: "task",
      entityId: id,
      field: "owners",
      oldValue: currentOwners.length > 0 ? ownersKey(currentOwners) : null,
      newValue: owners.length > 0 ? ownersKey(owners) : null,
    });
  }

  // 业务写与审计同事务：任何一侧失败整体回滚，不留未记账的写
  const leafEntries: AuditEntry[] = [];
  await runTx(db, async (tx) => {
    if (Object.keys(taskPatch).length > 0) {
      await qRun(tx.update(tasks).set(taskPatch).where(eq(tasks.id, id)));
    }
    // 更新负责人标签（同名保留交付/签收记录，D14）
    if (owners !== undefined) {
      await replaceOwners(tx, id, owners);
    }
    // 件级完成快捷/工期修改 → 给参与判定全体打/清同一天（D8）
    if (hasOwners && shortcut) {
      await applyJudgedDone(
        tx,
        id,
        judged.map((o) => o.name),
        leafDoneAt!,
        leafEntries,
      );
    }
    // 叶子有变动才重算件级聚合（单一重算入口，§3.3）
    if (hasOwners && (owners !== undefined || shortcut)) {
      await recomputeTaskAggregate(tx, id);
    }
    await appendAudit(tx, actor, [...entries, ...leafEntries]);
  });

  return listTasksByVan(current.vanCode);
}

/** 负责人行的审计值（D13）：紧凑 JSON，链上可对质到人 */
function ownerAuditValue(o: {
  points: number;
  doneAt: string | null;
  confirmedAt: string | null;
}): string {
  return JSON.stringify({
    points: o.points,
    doneAt: o.doneAt,
    confirmedAt: o.confirmedAt,
  });
}

/**
 * 参与件级闭环判定的负责人（D11）：`points > 0` 的人；若一件有 owner 行但全是
 * 0 点（全挂名），退化回全部 owner——否则既不能闭环、也永远签不掉，成死结。
 */
function judgedOf<T extends { points: number }>(owners: T[]): T[] {
  const positive = owners.filter((o) => o.points > 0);
  return positive.length > 0 ? positive : owners;
}

/**
 * 件级聚合的期望值（纯函数，D2/D7/D9/D11/D12）：由叶子与当前件级状态推导。
 * 无 owner 行返回 null（D12：件级字段完全手动，聚合跳过）。`recomputeTaskAggregate`
 * 是其唯一调用方；单测直接验证这里的推导规则。
 * - `done` = 参与判定集合**全部** `done_at` 非空（D2）；`done_at` = 最后一个完成者的日期（D7）
 * - 首次有人完成 → `todo` 自动升 `doing`，不自动回落（D9）
 * - `confirmed_*` = 参与判定集合全部签收时取最后一次签收的 actor 与日期，否则 NULL
 */
export function aggregateOf(
  leaves: {
    points: number;
    doneAt: string | null;
    confirmedAt: string | null;
    confirmedBy: string | null;
  }[],
  currentStatus: Task["status"],
): {
  status: Task["status"];
  doneAt: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
} | null {
  if (leaves.length === 0) return null;
  const judged = judgedOf(leaves);
  const allDone = judged.every((o) => o.doneAt !== null);
  const allConfirmed = judged.every((o) => o.confirmedAt !== null);
  const anyDone = judged.some((o) => o.doneAt !== null);

  const status: Task["status"] = allDone
    ? "done"
    : currentStatus === "carried"
      ? "carried" // 归档只读，不参与推导
      : currentStatus === "done" || anyDone
        ? "doing" // D9：首次有人完成单向升 doing；有人取消则从 done 回落
        : currentStatus;
  const doneAt = allDone
    ? judged.reduce((max, o) => (o.doneAt! > max ? o.doneAt! : max), "")
    : null;
  let confirmedAt: string | null = null;
  let confirmedBy: string | null = null;
  if (allConfirmed) {
    const last = judged.reduce((a, b) =>
      b.confirmedAt! > a.confirmedAt! ? b : a,
    );
    confirmedAt = last.confirmedAt;
    confirmedBy = last.confirmedBy;
  }
  return { status, doneAt, confirmedAt, confirmedBy };
}

/**
 * 件级聚合重算（v2.6 §3.3 唯一重算入口）：把叶子（task_owners）与任务级聚合字段
 * 对齐。只在事务内、写叶子之后调用；推导规则全在 `aggregateOf`。
 */
async function recomputeTaskAggregate(tx: AppDb, taskId: number) {
  const leaves = await qAll(
    tx
      .select({
        points: taskOwners.points,
        doneAt: taskOwners.doneAt,
        confirmedAt: taskOwners.confirmedAt,
        confirmedBy: taskOwners.confirmedBy,
      })
      .from(taskOwners)
      .where(eq(taskOwners.taskId, taskId)),
  );
  const [task] = await qAll(
    tx
      .select({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, taskId)),
  );
  if (!task) return;
  const agg = aggregateOf(leaves, task.status);
  if (!agg) return; // D12：无 owner 的件不推导
  await qRun(
    tx.update(tasks).set(agg).where(eq(tasks.id, taskId)),
  );
}

/**
 * 给指定负责人打/清同一完成日期（D8 件级快捷的叶子实现），并把实际变化的行
 * 以 `owner:<名字>` 紧凑 JSON 记入审计（D13）。幂等的行不写不入链。
 */
async function applyJudgedDone(
  tx: AppDb,
  taskId: number,
  names: string[],
  doneAt: string | null,
  entries: AuditEntry[],
) {
  for (const name of names) {
    const [row] = await qAll(
      tx
        .select()
        .from(taskOwners)
        .where(
          and(
            eq(taskOwners.taskId, taskId),
            eq(taskOwners.ownerName, name),
          ),
        ),
    );
    if (!row) continue;
    const next = {
      doneAt,
      confirmedAt: doneAt === null ? null : row.confirmedAt,
      confirmedBy: doneAt === null ? null : row.confirmedBy,
    };
    if (
      row.doneAt === next.doneAt &&
      row.confirmedAt === next.confirmedAt &&
      row.confirmedBy === next.confirmedBy
    ) {
      continue;
    }
    await qRun(
      tx
        .update(taskOwners)
        .set(next)
        .where(
          and(
            eq(taskOwners.taskId, taskId),
            eq(taskOwners.ownerName, name),
          ),
        ),
    );
    entries.push({
      entity: "task",
      entityId: taskId,
      field: `owner:${name}`,
      oldValue: ownerAuditValue(row),
      newValue: ownerAuditValue({ points: row.points, ...next }),
    });
  }
}

/**
 * 逐人完成/取消（v2.6）：打勾记当天日期（可补录），取消清空该人日期并作废
 * 该人签收（D6，其他人的签收保留）。0 点负责人同样可打勾（D15，只留痕不阻塞件级闭环）。
 * 幂等：目标状态与现值一致时不写库不入链。件级聚合由 T3 在同一事务内联动。
 */
export async function setOwnerDone(
  taskId: number,
  ownerName: string,
  done: boolean,
  doneAt?: string,
  actor?: string,
): Promise<TaskWithOwners[]> {
  const db = getDb();
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task)
    throw new TRPCError({ code: "NOT_FOUND", message: `任务 ${taskId} 不存在` });
  if (await isVanArchived(task.vanCode)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `班次 ${task.vanCode} 已结转归档，不可修改`,
    });
  }
  const [row] = await db
    .select()
    .from(taskOwners)
    .where(
      and(
        eq(taskOwners.taskId, taskId),
        eq(taskOwners.ownerName, ownerName),
      ),
    );
  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `快件 ${taskId} 上没有负责人「${ownerName}」`,
    });
  }

  const nextDoneAt = done ? (doneAt ?? todayStr()) : null;
  // 取消完成同时作废该人签收（D6）
  const nextConfirmedAt = done ? row.confirmedAt : null;
  const nextConfirmedBy = done ? row.confirmedBy : null;
  if (
    row.doneAt === nextDoneAt &&
    row.confirmedAt === nextConfirmedAt &&
    row.confirmedBy === nextConfirmedBy
  ) {
    return listTasksByVan(task.vanCode); // 幂等：无变化不写库不入链
  }

  await runTx(db, async (tx) => {
    await qRun(
      tx
        .update(taskOwners)
        .set({
          doneAt: nextDoneAt,
          confirmedAt: nextConfirmedAt,
          confirmedBy: nextConfirmedBy,
        })
        .where(
          and(
            eq(taskOwners.taskId, taskId),
            eq(taskOwners.ownerName, ownerName),
          ),
        ),
    );
    // 叶子变动后重算件级聚合（单一重算入口）
    await recomputeTaskAggregate(tx, taskId);
    await appendAudit(tx, actor, [
      {
        entity: "task",
        entityId: taskId,
        field: `owner:${ownerName}`,
        oldValue: ownerAuditValue(row),
        newValue: ownerAuditValue({
          points: row.points,
          doneAt: nextDoneAt,
          confirmedAt: nextConfirmedAt,
        }),
      },
    ]);
  });
  return listTasksByVan(task.vanCode);
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
  await runTx(db, async (tx) => {
    await qRun(tx.delete(tasks).where(eq(tasks.id, id)));
    await appendAudit(tx, actor, [
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

  const carried = await runTx(db, async (tx) => {
    const already = await qAll(
      tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.vanCode, toVan), eq(tasks.carriedFrom, fromVan)))
        .limit(1),
    );
    if (already.length > 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `${fromVan} 的未完成任务已结转至 ${toVan}，请勿重复操作`,
      });
    }

    const vanExists = await qAll(
      tx
        .select({ code: vans.code })
        .from(vans)
        .where(eq(vans.code, toVan))
        .limit(1),
    );
    if (vanExists.length === 0) {
      await qRun(tx.insert(vans).values({ code: toVan }));
    }

    const unfinished = await qAll(
      tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.vanCode, fromVan), ne(tasks.status, "done"))),
    );

    // 结转快件追加到目标班末尾（拖拽排序列：从目标班现有 max(sort_order) 起递增）
    const [maxRow] = await qAll(
      tx
        .select({ max: sql<number | null>`max(${tasks.sortOrder})` })
        .from(tasks)
        .where(eq(tasks.vanCode, toVan)),
    );
    let nextSort = (maxRow?.max ?? 0) + 1;

    const copies: { src: (typeof unfinished)[number]; newId: number }[] = [];
    for (const t of unfinished) {
      // 结转快件（本次结转原因覆写：结转原因描述的是「这次为什么没送完」）
      const newId = await insertReturningId(tx, tasks, {
        ...toStrandedTask(t, toVan),
        carryReason: carryReason ?? null,
        sortOrder: nextSort++,
      });
      copies.push({ src: t, newId });
      // 结转负责人：各自点数**随件搬运**（v2.5 每人点数制——点数属于人，不属于车）
      const owners = await qAll(
        tx
          .select({
            ownerName: taskOwners.ownerName,
            points: taskOwners.points,
          })
          .from(taskOwners)
          .where(eq(taskOwners.taskId, t.id)),
      );
      if (owners.length > 0) {
        await qRun(
          tx.insert(taskOwners).values(
            owners.map((o) => ({
              taskId: newId,
              ownerName: o.ownerName,
              points: o.points,
            })),
          ),
        );
      }
    }
    // 源班次的快件标记为 🔁结转，旧车数据同步可见（四态：未开始/进行中/完成/结转）
    if (unfinished.length > 0) {
      await qRun(
        tx
          .update(tasks)
          .set({
            status: "carried",
            ...(carryReason ? { carryReason } : {}),
          })
          .where(
            inArray(
              tasks.id,
              unfinished.map((t) => t.id),
            ),
          ),
      );
    }
    const result = {
      count: unfinished.length,
      vanCreated: vanExists.length === 0,
      copies,
    };
    // 审计与结转同事务：half-way 崩溃不产生「转了件但没记账」
    await appendAudit(tx, opts.actor, [
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
  await runTx(db, async (tx) => {
    await qRun(
      tx
        .update(tasks)
        .set({ confirmedBy: actor, confirmedAt: todayStr() })
        .where(eq(tasks.id, taskId)),
    );
    await appendAudit(tx, actor, [
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

  // 按负责人聚合运力统计（v2.5 每人点数制：每人只计**自己那份**点数，
  // 不再"一件多人则每人各计全量"——那会把 5 点的活记成 3 个人各 5 点）
  const memberRows = await listMembers();
  const byMember = memberRows.map((m) => {
    const mine = rows.filter((t) => t.owners.some((o) => o.name === m.name));
    return {
      name: m.name,
      capacity: m.capacity,
      assigned: mine.reduce(
        (s, t) => s + (t.owners.find((o) => o.name === m.name)?.points ?? 0),
        0,
      ),
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
    members: byMember,
    /** 整车装载点数 = 本班各件点数（各负责人点数之和）的合计；对照个人条看口径 */
    loadPoints: rows.reduce((s, t) => s + taskPointsOf(t.owners), 0),
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
