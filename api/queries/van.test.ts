import { describe, expect, it } from "vitest";
import {
  assertWithinCapacity,
  poolStatusOf,
  rarityStatsOf,
  toStrandedTask,
} from "./van";
import type { PoolItem, Task } from "../../db/schema";

describe("assertWithinCapacity", () => {
  it("合计未超过运力时放行", () => {
    expect(() => assertWithinCapacity("张三", 3, 1, 5)).not.toThrow();
    expect(() => assertWithinCapacity("张三", 0, 5, 5)).not.toThrow();
  });

  it("合计超过运力时报错并给出量化信息", () => {
    expect(() => assertWithinCapacity("张三", 3, 3, 5)).toThrow(/张三/);
    expect(() => assertWithinCapacity("张三", 3, 3, 5)).toThrow(/6.*5/);
  });

  it("运力被扣减（请假）后按新运力校验", () => {
    expect(() => assertWithinCapacity("李四", 1, 3, 3)).toThrow();
    expect(() => assertWithinCapacity("李四", 1, 1, 3)).not.toThrow();
  });
});

describe("poolStatusOf", () => {
  it("无任务 → open（待切片）", () => {
    expect(poolStatusOf([])).toBe("open");
  });

  it("有任务且全部 done → done（已完成）", () => {
    expect(poolStatusOf(["done"])).toBe("done");
    expect(poolStatusOf(["done", "done", "done"])).toBe("done");
  });

  it("有未完成任务 → scheduled（已排期）", () => {
    expect(poolStatusOf(["todo"])).toBe("scheduled");
    expect(poolStatusOf(["done", "doing"])).toBe("scheduled");
    expect(poolStatusOf(["doing", "todo"])).toBe("scheduled");
  });
});

describe("rarityStatsOf", () => {
  const rarityById = new Map<number, PoolItem["rarity"]>([
    [1, "epic"],
    [2, "rare"],
    [3, "common"],
  ]);
  const task = (
    poolItemId: number | null,
    status: Task["status"],
  ): Pick<Task, "poolItemId" | "status"> => ({ poolItemId, status });

  it("按所属委托的稀有度分桶，统计 total 与 done", () => {
    const stats = rarityStatsOf(
      [task(1, "done"), task(1, "todo"), task(2, "done")],
      rarityById,
    );
    expect(stats).toEqual([
      { rarity: "rare", total: 1, done: 1 },
      { rarity: "epic", total: 2, done: 1 },
    ]);
  });

  it("无关联委托或委托不存在的任务不计入", () => {
    const stats = rarityStatsOf(
      [task(null, "done"), task(999, "done"), task(3, "todo")],
      rarityById,
    );
    expect(stats).toEqual([{ rarity: "common", total: 1, done: 0 }]);
  });

  it("空任务列表返回空数组", () => {
    expect(rarityStatsOf([], rarityById)).toEqual([]);
  });
});

describe("toStrandedTask", () => {
  const base: Task = {
    id: 7,
    vanCode: "DV2607A",
    title: "创建/核销优惠券接口联调通过",
    poolItemId: 3,
    ownerName: "张三",
    size: 3,
    acceptance: "接口联调通过",
    status: "doing",
    carriedFrom: null,
    carryCount: 0,
    doneAt: null,
    note: "阻塞于下游",
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

  it("保留任务内容、负责人、档位、验收标准和备注", () => {
    const carried = toStrandedTask(base, "DV2607B");
    expect(carried.title).toBe(base.title);
    expect(carried.ownerName).toBe(base.ownerName);
    expect(carried.size).toBe(base.size);
    expect(carried.acceptance).toBe(base.acceptance);
    expect(carried.note).toBe(base.note);
    expect(carried.poolItemId).toBe(base.poolItemId);
  });
});
