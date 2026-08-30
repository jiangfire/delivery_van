/**
 * v2.0 共享枚举（前后端共享，纯值无依赖）。
 *
 * - source：快件来源，三方占比口径（客户件/平台件/探索件），v2.0 起采集，
 *   存量数据统一回填 customer（基线期会低估另两方，统计面板有口径标注）；
 * - carryReason：结转原因五枚举（WP5 轻量版），可空 = 未分类；
 *   swap 让位原因（Phase 2 议价台）届时在此另加枚举值。
 */

/** 快件来源：customer 客户件 / platform 平台件 / exploration 探索件 */
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
