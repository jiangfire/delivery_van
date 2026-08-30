import { describe, expect, it } from "vitest";
import { rarityStatsOf, taskStatsOf, toStrandedTask } from "./van";
import type { Task } from "../../db/schema";

describe("rarityStatsOf", () => {
  const task = (
    rarity: Task["rarity"],
    status: Task["status"],
  ): Pick<Task, "rarity" | "status"> => ({ rarity, status });

  it("按稀有度分桶，统计 total 与 done", () => {
    const stats = rarityStatsOf([
      task("ssr", "done"),
      task("ssr", "todo"),
      task("sr", "done"),
    ]);
    expect(stats).toEqual([
      { rarity: "sr", total: 1, done: 1 },
      { rarity: "ssr", total: 2, done: 1 },
    ]);
  });

  it("空任务列表返回空数组", () => {
    expect(rarityStatsOf([])).toEqual([]);
  });

  it("只返回有任务的桶", () => {
    const stats = rarityStatsOf([task("n", "todo")]);
    expect(stats).toEqual([{ rarity: "n", total: 1, done: 0 }]);
  });
});

describe("taskStatsOf", () => {
  const row = (
    status: Task["status"],
    carriedFrom: string | null = null,
    carryCount = 0,
  ): Pick<Task, "status" | "carriedFrom" | "carryCount"> => ({
    status,
    carriedFrom,
    carryCount,
  });

  it("滞留率 = 结转出去的任务数 / 总数（结转后旧车数据随之更新）", () => {
    const stats = taskStatsOf([
      row("done"),
      row("done"),
      row("carried"),
      row("carried"),
    ]);
    expect(stats.total).toBe(4);
    expect(stats.done).toBe(2);
    expect(stats.carriedOut).toBe(2);
    expect(stats.remaining).toBe(2);
    expect(stats.completionRate).toBe(0.5);
    expect(stats.carryRate).toBe(0.5);
  });

  it("carriedIn 统计本班承接的上一班滞留件，连续滞留 ≥2 触发复盘计数", () => {
    const stats = taskStatsOf([
      row("todo", "DV2607A", 1),
      row("todo", "DV2607A", 2),
      row("doing"),
    ]);
    expect(stats.carriedIn).toBe(2);
    expect(stats.reviewNeeded).toBe(1);
    expect(stats.carryRate).toBe(0);
  });

  it("空班次速率为 null 而非 0", () => {
    const stats = taskStatsOf([]);
    expect(stats.total).toBe(0);
    expect(stats.completionRate).toBeNull();
    expect(stats.carryRate).toBeNull();
  });
});

describe("toStrandedTask", () => {
  const base: Task = {
    id: 7,
    vanCode: "DV2607A",
    title: "创建/核销优惠券接口联调通过",
    rarity: "ssr",
    requester: "张经理",
    size: 3,
    acceptance: "接口联调通过",
    status: "doing",
    carriedFrom: null,
    carryCount: 0,
    doneAt: null,
    note: "阻塞于下游",
    sortOrder: null,
    source: "customer",
    carryReason: null,
    confirmedBy: null,
    confirmedAt: null,
    createdAt: new Date("2026-07-01T00:00:00Z"),
  };

  it("转运到目标班次并标记来源", () => {
    const carried = toStrandedTask(base, "DV2607B");
    expect(carried.vanCode).toBe("DV2607B");
    expect(carried.carriedFrom).toBe("DV2607A");
  });

  it("转运后状态重置为未开始、清空完成日期", () => {
    const carried = toStrandedTask(
      { ...base, doneAt: "2026-07-02" },
      "DV2607B",
    );
    expect(carried.status).toBe("todo");
    expect(carried.doneAt).toBeNull();
  });

  it("连续转运次数递增（≥2 触发强制复盘）", () => {
    expect(toStrandedTask(base, "DV2607B").carryCount).toBe(1);
    const again = toStrandedTask(
      { ...base, vanCode: "DV2607B", carriedFrom: "DV2607A", carryCount: 1 },
      "DV2607C",
    );
    expect(again.carryCount).toBe(2);
  });

  it("保留快件内容、稀有度、档位、验收标准和备注", () => {
    const carried = toStrandedTask(base, "DV2607B");
    expect(carried.title).toBe(base.title);
    expect(carried.rarity).toBe("ssr");
    expect(carried.size).toBe(base.size);
    expect(carried.acceptance).toBe(base.acceptance);
    expect(carried.note).toBe(base.note);
  });
});
