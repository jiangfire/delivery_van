/**
 * 班次编码工具（前后端共享）。
 *
 * 班次由「发新车」动作手动创建，不再绑定周五。编码仿期货合约风格：
 * `DV` + 2 位年 + 2 位月 + 字母序号。例：DV2607A = 2026 年 7 月第一班车。
 *
 * 归属规则：编码锚定班次创建时所在的日历月份，**每个自然月从 A 重新计数**
 * （A=1 … Z=26，单月最多 26 班）；同月内字母递增，当月到 Z 之后再发车则跨月回 A。
 */

export const VAN_CODE_RE = /^DV(\d{2})(0[1-9]|1[0-2])([A-Z])$/;

export function isVanCode(code: string): boolean {
  return VAN_CODE_RE.test(code);
}

export function parse(code: string): {
  year: number;
  month: number;
  nth: number;
} {
  const m = VAN_CODE_RE.exec(code);
  if (!m) throw new Error(`非法班次编码：${code}（示例：DV2607A）`);
  return {
    year: 2000 + Number(m[1]),
    month: Number(m[2]),
    nth: m[3].charCodeAt(0) - 64,
  };
}

/** 下一班编码：同月字母 +1；Z 换月为下月 A（12 月 → 次年 01 月 A） */
export function nextVanCode(code: string): string {
  const { year, month, nth } = parse(code);
  if (nth < 26) {
    const yy = String(year % 100).padStart(2, "0");
    const mm = String(month).padStart(2, "0");
    return `DV${yy}${mm}${String.fromCharCode(64 + nth + 1)}`;
  }
  const y = month === 12 ? year + 1 : year;
  const mo = month === 12 ? 1 : month + 1;
  return `DV${String(y % 100).padStart(2, "0")}${String(mo).padStart(2, "0")}A`;
}

/** 某日期所属年月的第一班车编码（用于表空时的首班车） */
export function firstVanCodeOf(date: Date): string {
  const yy = String(date.getFullYear() % 100).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `DV${yy}${mm}A`;
}

/**
 * 下一班编码（跨月感知）：today 已晚于 code 所属月份时，从 today 所在月的 A 班
 * 重新计数（跨月发新车不沿用旧月份字母）；否则同月字母 +1（Z 跨月回 A）。
 */
export function nextVanCodeFrom(code: string, today: Date): string {
  const { year, month } = parse(code);
  const cur = today.getFullYear() * 12 + (today.getMonth() + 1);
  return cur > year * 12 + month ? firstVanCodeOf(today) : nextVanCode(code);
}

/**
 * 结转目标班编码：优先取 fromVan 之后**已存在**的最近一班（编码定宽，字典序
 * 即发车时间序）；不存在则按 today 用 nextVanCodeFrom 推导（由调用方按需创建）。
 */
export function carryTargetCode(
  fromVan: string,
  existingVans: string[],
  today: Date,
): string {
  const after = existingVans.filter((v) => v > fromVan).sort()[0];
  return after ?? nextVanCodeFrom(fromVan, today);
}

export function todayStr(): string {
  // 使用中国时区（UTC+8）获取今天的日期，避免服务器 UTC 时差导致日期偏移
  const t = new Date();
  const zhDate = new Date(
    t.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }),
  );
  return `${zhDate.getFullYear()}-${String(zhDate.getMonth() + 1).padStart(2, "0")}-${String(
    zhDate.getDate(),
  ).padStart(2, "0")}`;
}
