import { asc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./connection";
import { getSchema, isUniqueViolation, qAll, qRun } from "./dialect";
import { appendAudit } from "./audit";
import { runTx } from "./tx";
import { SOURCES } from "../../contracts/enums";

/**
 * 需求类型（快件来源，v2.7 动态化）：内置三项由 ensureSchema 幂等种子
 * （customer/platform/exploration，built_in=1 不可删可改名），自定义类型
 * 创建时 code == 显示名、此后 code 永不变——改名只动 label，历史数据零迁移。
 * 快件上的值域校验（addTask/updateTask 的 source 必须命中本表）也在本文件。
 */
const { sources, tasks } = getSchema();

export type SourceOption = {
  code: string;
  label: string;
  builtIn: boolean;
};

/** 全部需求类型：内置三项按种子定义序在前，自定义按 code 排序（展示顺序，无语义） */
export async function listSources(): Promise<SourceOption[]> {
  const rows = await getDb()
    .select({
      code: sources.code,
      label: sources.label,
      builtIn: sources.builtIn,
    })
    .from(sources);
  const builtin = SOURCES.flatMap((code) => {
    const row = rows.find((r) => r.code === code);
    return row ? [row] : [];
  });
  const custom = rows
    .filter((r) => !(SOURCES as readonly string[]).includes(r.code))
    .sort((a, b) => a.code.localeCompare(b.code, "zh"));
  return [...builtin, ...custom].map((r) => ({
    code: r.code,
    label: r.label,
    builtIn: r.builtIn === 1,
  }));
}

/**
 * 新增自定义类型（code == 显示名）。重名（撞 code 主键或 label 唯一约束）拒绝。
 * 业务写与审计同事务。
 */
export async function addSource(label: string, actor?: string) {
  const db = getDb();
  try {
    await runTx(db, async (tx) => {
      await qRun(tx.insert(sources).values({ code: label, label }));
      await appendAudit(tx, actor, [
        {
          entity: "source",
          entityId: label,
          field: "*",
          oldValue: null,
          newValue: label,
        },
      ]);
    });
  } catch (e) {
    // 并发窗口内被抢先插入（撞 code/label 唯一约束）：按重名处理，不给前端裸 500
    if (isUniqueViolation(e)) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `需求类型「${label}」已存在`,
      });
    }
    throw e;
  }
  return listSources();
}

/** 改显示名：code 不动（历史数据零迁移）；内置三项同样可改。幂等：值未变不写库不入链 */
export async function renameSource(
  code: string,
  label: string,
  actor?: string,
) {
  const db = getDb();
  const [row] = await db.select().from(sources).where(eq(sources.code, code));
  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `需求类型「${code}」不存在`,
    });
  }
  if (row.label === label) return listSources();
  const [taken] = await db
    .select({ code: sources.code })
    .from(sources)
    .where(eq(sources.label, label));
  if (taken) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `显示名「${label}」已被类型「${taken.code}」占用`,
    });
  }
  try {
    await runTx(db, async (tx) => {
      await qRun(
        tx.update(sources).set({ label }).where(eq(sources.code, code)),
      );
      await appendAudit(tx, actor, [
        {
          entity: "source",
          entityId: code,
          field: "label",
          oldValue: row.label,
          newValue: label,
        },
      ]);
    });
  } catch (e) {
    // 并发窗口内 label 被抢先占用（撞唯一约束；预检在事务外）：按重名处理，不给前端裸 500
    if (isUniqueViolation(e)) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `显示名「${label}」已被占用`,
      });
    }
    throw e;
  }
  return listSources();
}

/**
 * 删除自定义类型（有守卫的硬删）：内置三项不可删（历史数据与默认值依赖）；
 * 有快件引用不可删（tasks.source 是纯文本引用无外键，删了会留悬空值弄脏统计）。
 */
export async function removeSource(code: string, actor?: string) {
  const db = getDb();
  const [row] = await db.select().from(sources).where(eq(sources.code, code));
  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `需求类型「${code}」不存在`,
    });
  }
  if (row.builtIn === 1) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `「${row.label}」是内置类型，不可删除（可改名）`,
    });
  }
  await runTx(db, async (tx) => {
    // 引用复查放在删除事务内：事务外的预检与 addTask 的值域校验之间存在交错
    // 窗口（预检通过后、提交前被并发写入引用），事务内复查保证不留幽灵 code
    const refRows = await qAll(
      tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.source, code)),
    );
    if (refRows.length > 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `需求类型「${row.label}」仍有 ${refRows.length} 个快件在用，不可删除`,
      });
    }
    await qRun(tx.delete(sources).where(eq(sources.code, code)));
    await appendAudit(tx, actor, [
      {
        entity: "source",
        entityId: code,
        field: "*",
        oldValue: row.label,
        newValue: null,
      },
    ]);
  });
  return listSources();
}

/**
 * 快件 source 的值域校验（addTask/updateTask 用）：必须命中 sources 表，
 * 不存在时列出可用值——对齐成员存在性校验的位置（zod 只管形状，值域在数据层）。
 */
export async function ensureSourceExists(code: string) {
  const [row] = await getDb()
    .select({ code: sources.code })
    .from(sources)
    .where(eq(sources.code, code));
  if (row) return;
  const all = await getDb()
    .select({ code: sources.code })
    .from(sources)
    .orderBy(asc(sources.code));
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: `需求类型「${code}」不存在，可先在来源管理里新增（现有：${all.map((r) => r.code).join("、")}）`,
  });
}
