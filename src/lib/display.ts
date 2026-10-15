/* ── 看板展示层共享的纯展示工具（BoardPage 与统计子组件共用） ── */

/** 稀有度文字着色：N 无色 / R 绿 / SR 蓝 / SSR 紫 / UR 彩虹动画 */
export const RARITY_CLASS: Record<string, string> = {
  n: "",
  r: "text-emerald-600",
  sr: "text-sky-600",
  ssr: "text-violet-600",
  ur: "rarity-ur-text",
};

/** 任务五态的中文标签（存储值仍是英文枚举；carried 仅展示不可选） */
export const STATUS_LABEL: Record<string, string> = {
  todo: "未开始",
  doing: "进行中",
  done: "完成",
  carried: "结转",
  drop: "放弃",
};

/** 网格下拉的可选项反查（carried 由结转写入，不进下拉，故无反查项） */
export const STATUS_CODE: Record<string, string> = {
  未开始: "todo",
  进行中: "doing",
  完成: "done",
  放弃: "drop",
};

/** 比率显示：null → “–” */
export function fmtRate(x: number | null | undefined): string {
  return x == null ? "–" : `${Math.round(x * 100)}%`;
}
