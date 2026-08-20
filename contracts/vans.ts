/**
 * 班次编码工具（前后端共享）。
 *
 * delivery_van 每周五发一班快递车。编码仿期货合约风格：
 * `DV` + 2 位年 + 2 位月 + 字母序号。例：DV2607A = 2026 年 7 月第一班车。
 *
 * 归属规则：班次归属该班**发车日（周五）**所在的月份，
 * 字母序号 = 该周五是当月第几个周五（A=1 … E=5，一个月最多 5 个周五）。
 */

export const VAN_CODE_RE = /^DV(\d{2})(0[1-9]|1[0-2])([A-E])$/;

export function isVanCode(code: string): boolean {
  return VAN_CODE_RE.test(code);
}

/** 某日期所在周（周一至周日）的班次编码，以周五发车日为锚 */
export function vanCodeOf(date: Date): string {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  const dow = (d.getUTCDay() + 6) % 7; // 周一=0 … 周日=6
  const friday = new Date(d);
  friday.setUTCDate(d.getUTCDate() + (4 - dow));
  const yy = String(friday.getUTCFullYear() % 100).padStart(2, "0");
  const mm = String(friday.getUTCMonth() + 1).padStart(2, "0");
  const nth = Math.ceil(friday.getUTCDate() / 7);
  return `DV${yy}${mm}${String.fromCharCode(64 + nth)}`;
}

function parse(code: string): { year: number; month: number; nth: number } {
  const m = VAN_CODE_RE.exec(code);
  if (!m) throw new Error(`非法班次编码：${code}（示例：DV2607A）`);
  return {
    year: 2000 + Number(m[1]),
    month: Number(m[2]),
    nth: m[3].charCodeAt(0) - 64,
  };
}

/** 班次对应的发车日（周五，UTC 零点） */
export function fridayOf(code: string): Date {
  const { year, month, nth } = parse(code);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const toFriday = (5 - first.getUTCDay() + 7) % 7; // 1 号到当月第一个周五的天数
  const friday = new Date(
    Date.UTC(year, month - 1, 1 + toFriday + (nth - 1) * 7),
  );
  if (friday.getUTCMonth() !== month - 1) {
    throw new Error(
      `班次编码 ${code} 不存在：${year} 年 ${month} 月没有第 ${nth} 个周五`,
    );
  }
  return friday;
}

/** 班次所属周的周一（UTC 零点） */
export function mondayOf(code: string): Date {
  const f = fridayOf(code);
  const monday = new Date(f);
  monday.setUTCDate(f.getUTCDate() - 4);
  return monday;
}

export function nextVanCode(code: string): string {
  const m = mondayOf(code);
  m.setUTCDate(m.getUTCDate() + 7);
  return vanCodeOf(
    new Date(m.getUTCFullYear(), m.getUTCMonth(), m.getUTCDate()),
  );
}

export function prevVanCode(code: string): string {
  const m = mondayOf(code);
  m.setUTCDate(m.getUTCDate() - 7);
  return vanCodeOf(
    new Date(m.getUTCFullYear(), m.getUTCMonth(), m.getUTCDate()),
  );
}

function fmt(d: Date): string {
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/** 班次周期展示："6/29 – 7/3"（周一至周五） */
export function vanRange(code: string): string {
  return `${fmt(mondayOf(code))} – ${fmt(fridayOf(code))}`;
}

/** 当前日期所属班次 */
export function currentVanCode(): string {
  return vanCodeOf(new Date());
}

/**
 * 阶段：0 需求录入 / 1 发车会 / 2 派送中。
 * 节奏对齐设计方案：周四 PM 写需求，周五验收 + 装车，周一至周四派送。
 */
export const STAGES = [
  { name: "需求录入", desc: "周四 · PM 写下周需求" },
  { name: "发车会", desc: "周五 · 验收本周 + 下周装车到人" },
  { name: "派送中", desc: "周一–周四 · 每日更新状态" },
] as const;

export function currentStageIdx(): number[] {
  // 与 vanCodeOf 一致用 UTC 取日，避免本地时区与 UTC 锚定的班次归属错位
  const day = new Date().getUTCDay(); // 0=周日
  if (day === 4) return [0, 2]; // 周四：一边派送一边录下周需求
  if (day === 5) return [1];
  if (day >= 1 && day <= 3) return [2];
  return [];
}

export function todayStr(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(
    t.getDate(),
  ).padStart(2, "0")}`;
}
