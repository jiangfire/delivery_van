/**
 * 班次编码工具（前后端共享）。
 *
 * 班次由「发新车」动作手动创建，不再绑定周五。编码仿期货合约风格：
 * `DV` + 2 位年 + 2 位月 + 字母序号。例：DV2607A = 2026 年 7 月第一班车。
 *
 * 归属规则：班次归属创建时所在的月份，字母序号 = 当月第几班车
 * （A=1 … Z=26，单月最多 26 班）。
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
