import { describe, expect, it } from "vitest";
import { taskPointsOf } from "./points";

/**
 * v2.5 每人点数制：点数归属到人，任务点数 = 各负责人点数之和。
 * 这里刻意**不测任何"分摊/均分"**——系统不替人拍板每个人各该几点。
 */
describe("taskPointsOf", () => {
  it("没有负责人 → 0 点（未指派的件不进任何点数统计）", () => {
    expect(taskPointsOf([])).toBe(0);
  });

  it("单人负责 → 该人的点数", () => {
    expect(taskPointsOf([{ points: 7 }])).toBe(7);
  });

  it("多人负责 → 各人之和（甲 3、乙 2、丙 1 = 6 点）", () => {
    expect(taskPointsOf([{ points: 3 }, { points: 2 }, { points: 1 }])).toBe(6);
  });

  it("挂名（显式 0 点）不占点数：甲 5、乙 0 = 5 点", () => {
    expect(taskPointsOf([{ points: 5 }, { points: 0 }])).toBe(5);
  });
});
