import { describe, expect, it } from "vitest";
import { rarityStatsOf, toStrandedTask } from "./van";
import type { Task } from "../../db/schema";

// ── toStrandedTask ──

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

  it("排除 id 和 createdAt 字段", () => {
    const carried = toStrandedTask(base, "DV2607B");
    expect(carried).not.toHaveProperty("id");
    expect(carried).not.toHaveProperty("createdAt");
  });
});

// ── rarityStatsOf ──

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

  it("全部 done 的稀有度桶", () => {
    const stats = rarityStatsOf([task("ssr", "done"), task("ssr", "done")]);
    expect(stats).toEqual([{ rarity: "ssr", total: 2, done: 2 }]);
  });

  it("按 RARITIES 定义顺序返回", () => {
    const stats = rarityStatsOf([
      task("n", "todo"),
      task("sr", "done"),
      task("ssr", "doing"),
    ]);
    expect(stats.map((s) => s.rarity)).toEqual(["n", "sr", "ssr"]);
  });
});
