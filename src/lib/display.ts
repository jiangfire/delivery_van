import { SOURCE_LABELS, type Source } from "@contracts/enums";

/* ── 看板展示层共享的纯展示工具（BoardPage 与统计子组件共用） ── */

/** 稀有度文字着色：N 无色 / R 绿 / SR 蓝 / SSR 紫 / UR 彩虹动画 */
export const RARITY_CLASS: Record<string, string> = {
  n: "",
  r: "text-emerald-600",
  sr: "text-sky-600",
  ssr: "text-violet-600",
  ur: "rarity-ur-text",
};

/** 任务四态的中文标签（存储值仍是英文枚举） */
export const STATUS_LABEL: Record<string, string> = {
  todo: "未开始",
  doing: "进行中",
  done: "完成",
  carried: "结转",
};

export const STATUS_CODE: Record<string, string> = {
  未开始: "todo",
  进行中: "doing",
  完成: "done",
};

/** 来源中文标签 ↔ 存储枚举（网格下拉编辑用） */
export const SOURCE_CODE = Object.fromEntries(
  Object.entries(SOURCE_LABELS).map(([code, label]) => [label, code]),
) as Record<string, Source>;

/** 三方占比迷你条配色：客户天蓝 / 平台琥珀 / 探索紫 */
export const SOURCE_COLOR: Record<Source, string> = {
  customer: "#0ea5e9",
  platform: "#d97706",
  exploration: "#8b5cf6",
};

/** 档位徽标颜色分桶：≤2 点（≤1 天）蓝、≤6 点（≤3 天）橙、更大红 */
export function sizeBucket(size: number): 1 | 3 | 5 {
  if (size <= 2) return 1;
  if (size <= 6) return 3;
  return 5;
}

/** 比率显示：null → “–” */
export function fmtRate(x: number | null | undefined): string {
  return x == null ? "–" : `${Math.round(x * 100)}%`;
}
