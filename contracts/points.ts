/**
 * 负责人点数（v2.5 每人点数制，前后端共享，纯值无依赖）。
 *
 * 点数**归属到人**：`task_owners.points` 是唯一来源，任务点数 = 各负责人点数之和。
 * 因此本文件刻意不提供任何"分摊 / 均分"逻辑——系统不替人拍板每个负责人各该几点
 * （见 docs/archived/负责人点数制设计方案.md D1/D5）。
 *
 * 数据层：`tasks.size` 列已废弃（保留不读写），历史值仅作追溯与一次性回填依据。
 */

/** 每人点数上限：1 点 = 半天，10 点 = 5 天（与成员每周运力同口径）；任务合计无上限 */
export const OWNER_POINTS_MAX = 10;

/** 某个负责人在这件快件上的那份：谁 + 他自己的点数（0~10） */
export type OwnerAlloc = { name: string; points: number };

/**
 * 任务点数 = 各负责人点数之和。
 * 无负责人 → 0 点：未指派的件不进任何点数统计（整车档位/昨日天气/个人运力）。
 */
export function taskPointsOf(owners: { points: number }[]): number {
  return owners.reduce((sum, o) => sum + o.points, 0);
}
