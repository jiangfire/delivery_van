/**
 * v2.0 共享枚举（前后端共享，纯值无依赖）。
 *
 * - source：快件来源（需求类型），来源占比口径（客户件/平台件/探索件），v2.0 起采集，
 *   存量数据统一回填 customer（基线期会低估另两方，统计面板有口径标注）；
 *   v2.7 起动态化——`SOURCES` 只是**内置三项的种子定义**（ensureSchema 幂等种入
 *   `sources` 表），运行时值域以库中 `sources` 表为准，可增可改名（种子 SQL
 *   三方言硬编码，本文件的 `SOURCE_LABELS` 用作前端未加载完成时的显示兜底；见
 *   docs/doing/需求类型动态化与drop状态设计方案.md）；
 * - carryReason：结转原因五枚举（WP5 轻量版），可空 = 未分类；
 *   swap 让位原因（Phase 2 议价台）届时在此另加枚举值。
 */

/** 快件来源（内置三项的种子定义）：customer 客户件 / platform 平台件 / exploration 探索件 */
export const SOURCES = ["customer", "platform", "exploration"] as const;
export type Source = (typeof SOURCES)[number];

export const SOURCE_LABELS: Record<Source, string> = {
  customer: "客户",
  platform: "平台",
  exploration: "探索",
};

/** 结转原因：requirement-change 需求变更 / blocker 依赖阻塞 / estimate 估算偏差 / capacity 产能不足 / priority 优先级被挤 */
export const CARRY_REASONS = [
  "requirement-change",
  "blocker",
  "estimate",
  "capacity",
  "priority",
] as const;
export type CarryReason = (typeof CARRY_REASONS)[number];

export const CARRY_REASON_LABELS: Record<CarryReason, string> = {
  "requirement-change": "需求变更",
  blocker: "依赖阻塞",
  estimate: "估算偏差",
  capacity: "产能不足",
  priority: "优先级被挤",
};
