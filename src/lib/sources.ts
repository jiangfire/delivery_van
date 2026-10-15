import { SOURCE_LABELS } from "@contracts/enums";
import type { SourceOption } from "../../api/queries/sources";

/* ── 需求类型（快件来源）动态列表的前端展示工具（v2.7）：
 * 来源值域存库（sources 表），下拉以 label 交互、反查回 code；
 * 配色按列表序取调色板（内置三项恰好命中前三色，与 v2.6 前视觉连续） ── */

/** 来源配色调色板：前三色 = 原 客户/平台/探索 固定色 */
export const SOURCE_PALETTE = [
  "#0ea5e9",
  "#d97706",
  "#8b5cf6",
  "#10b981",
  "#f43f5e",
  "#6366f1",
  "#14b8a6",
  "#f97316",
];

/** 兜底色：code 不在列表时（改名窗口期等）不至于渲染空白 */
const FALLBACK_COLOR = "#94a3b8";

/** 来源下拉的哨兵项：选中即打开类型管理弹层，不作为值落库 */
export const SOURCE_ADD_SENTINEL = "＋ 新增类型…";

/**
 * 内置三项的显示兜底：sources 列表未加载完成时，网格先以常量渲染
 * （label 用 SOURCE_LABELS、配色用调色板前三色，恰与种子值一致），不出英文码
 */
const BUILTIN_FALLBACK: Record<string, { label: string; color: string }> = {
  customer: { label: SOURCE_LABELS.customer, color: SOURCE_PALETTE[0] },
  platform: { label: SOURCE_LABELS.platform, color: SOURCE_PALETTE[1] },
  exploration: { label: SOURCE_LABELS.exploration, color: SOURCE_PALETTE[2] },
};

/** 由 sources 列表构建展示映射：code→label / label→code（下拉反查）/ code→配色 */
export function buildSourceStyle(list: SourceOption[]) {
  const labelOf = new Map<string, string>();
  const codeOfLabel = new Map<string, string>();
  const colorOf = new Map<string, string>();
  list.forEach((s, i) => {
    labelOf.set(s.code, s.label);
    // 同名 label 只认第一个（label 唯一约束由服务端保证，此处防御）
    if (!codeOfLabel.has(s.label)) codeOfLabel.set(s.label, s.code);
    colorOf.set(s.code, SOURCE_PALETTE[i % SOURCE_PALETTE.length]);
  });
  return {
    label: (code: string) =>
      labelOf.get(code) ?? BUILTIN_FALLBACK[code]?.label ?? code,
    codeOfLabel: (label: string) => codeOfLabel.get(label),
    color: (code: string) =>
      colorOf.get(code) ?? BUILTIN_FALLBACK[code]?.color ?? FALLBACK_COLOR,
    /** 下拉候选（含零引用类型；新增入口的哨兵项由调用方追加） */
    labels: list.map((s) => s.label),
  };
}
