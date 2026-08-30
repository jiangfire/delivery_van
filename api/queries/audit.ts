import { createHash } from "node:crypto";
import { desc } from "drizzle-orm";
import { getDb } from "./connection";
import { auditLog, type AuditLogRow } from "../../db/schema";

/** 空链的创世哈希（全零 64 位十六进制），链上第一条记录的 prev_hash 由此起 */
export const GENESIS_HASH = "0".repeat(64);

/** 单条审计记录（不含链字段与时间戳，由 appendAudit 统一补齐） */
export type AuditEntry = {
  /** 实体类型：'task' | 'member' | 'van' | ... */
  entity: string;
  entityId: string | number;
  /** 变更字段，整行新增/删除记 '*' */
  field: string;
  oldValue: string | null;
  newValue: string | null;
};

/** 入链的行内容（id 插入前未知，不入链；ts 由 appendAudit 统一取当前秒） */
type ChainRow = Omit<AuditLogRow, "id" | "hash">;

/**
 * 序列化规范（锁定，勿改）：字段序 [ts, actor, entity, entity_id, field,
 * old_value, new_value, prev_hash]，每个值用 JSON 编码（null → null、字符串带
 * 引号，杜绝与定界符的歧义），以 U+001F（单元分隔符）连接。
 * 改此格式 = 旧链全量失效，必须带数据迁移；配套「锁定序列化格式」单测防悄悄变更。
 */
export function serializeAudit(row: ChainRow): string {
  return [
    row.ts,
    row.actor,
    row.entity,
    row.entityId,
    row.field,
    row.oldValue,
    row.newValue,
    row.prevHash,
  ]
    .map((v) => JSON.stringify(v ?? null))
    .join("\u001f");
}

/** 行哈希：SHA256(规范序列化字符串)，十六进制小写 */
export function auditHash(row: ChainRow): string {
  return createHash("sha256").update(serializeAudit(row)).digest("hex");
}

/**
 * 校验全链（周五对账与单测用）：重算每行 hash 并核对 prev_hash 链接。
 * rows 须按 id 升序传入；返回首个断点的下标（0-based），完好返回 null。
 */
export function verifyAuditChain(rows: AuditLogRow[]): number | null {
  let prev = GENESIS_HASH;
  for (const [i, r] of rows.entries()) {
    if (r.prevHash !== prev || auditHash(r) !== r.hash) return i;
    prev = r.hash;
  }
  return null;
}

/** 日志指纹：链头（最新一条）hash 前 8 位，供周五锚定仪式抄进会议纪要 */
export function fingerprintOf(hash: string | null | undefined): string | null {
  return typeof hash === "string" && hash.length > 0 ? hash.slice(0, 8) : null;
}

/** 事务对象的最小结构约束（db 与 tx 均满足） */
export type AuditDb = Pick<ReturnType<typeof getDb>, "select" | "insert">;

/**
 * 追加审计记录（同步）：读链尾 → 逐条算 hash 串成链 → 批量插入。
 *
 * **必须在 db.transaction 回调内调用**——业务写与审计同生共死：任何一侧失败
 * 整体回滚，崩溃/异常都不留「未记账的写」；better-sqlite3 单连接同步驱动，
 * 事务内「读链尾→算 hash→插入」天然串行，无并发断链风险。actor 缺省
 * '(unknown)'（软身份，链上可对质即可）。
 */
export function appendAudit(
  db: AuditDb,
  actor: string | undefined,
  entries: AuditEntry[],
): void {
  if (entries.length === 0) return;
  // 读链尾（最新一条的 hash）；空链为创世哈希
  const [tail] = db
    .select({ hash: auditLog.hash })
    .from(auditLog)
    .orderBy(desc(auditLog.id))
    .limit(1)
    .all();
  let prev = tail?.hash ?? GENESIS_HASH;
  const ts = Math.floor(Date.now() / 1000);
  const who = actor?.trim() || "(unknown)";
  const values = entries.map((e) => {
    const base: ChainRow = {
      ts,
      actor: who,
      entity: e.entity,
      entityId: String(e.entityId),
      field: e.field,
      oldValue: e.oldValue,
      newValue: e.newValue,
      prevHash: prev,
    };
    prev = auditHash(base);
    return { ...base, hash: prev };
  });
  db.insert(auditLog).values(values).run();
}
