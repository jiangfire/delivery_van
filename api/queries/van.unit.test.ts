import { describe, expect, it } from "vitest";
import { aggregateOf, toStrandedTask } from "./van";
import type { Task } from "../../db/schema";

// ── aggregateOf（v2.6 件级聚合的期望值推导，D2/D7/D9/D11/D12） ──

/** 叶子工厂：默认未交付未签收 */
function leaf(
  points: number,
  doneAt: string | null = null,
  confirmedAt: string | null = null,
  confirmedBy: string | null = null,
) {
  return { points, doneAt, confirmedAt, confirmedBy };
}

describe("aggregateOf", () => {
  it("无 owner 行返回 null（D12：件级完全手动）", () => {
    expect(aggregateOf([], "done")).toBeNull();
  });

  it("参与判定的人全交完 → done，日期取最后一个完成者（D2/D7）", () => {
    expect(
      aggregateOf(
        [leaf(3, "2026-07-18"), leaf(7, "2026-07-20")],
        "doing",
      ),
    ).toMatchObject({ status: "done", doneAt: "2026-07-20" });
  });

  it("部分完成 → 保持 doing，件级日期为空；首次有人完成从 todo 升 doing（D9）", () => {
    expect(
      aggregateOf([leaf(3, "2026-07-18"), leaf(7)], "todo"),
    ).toMatchObject({ status: "doing", doneAt: null });
  });

  it("无人动工保持原状态（todo/doing）", () => {
    expect(aggregateOf([leaf(3), leaf(7)], "todo")?.status).toBe("todo");
    expect(aggregateOf([leaf(3), leaf(7)], "doing")?.status).toBe("doing");
  });

  it("取消某人完成 → 从 done 回落 doing 并清空件级日期（D6）", () => {
    expect(
      aggregateOf([leaf(3, "2026-07-18"), leaf(7)], "done"),
    ).toMatchObject({ status: "doing", doneAt: null });
  });

  it("归档班次未全交时保持 carried，不参与推导", () => {
    expect(
      aggregateOf([leaf(3, "2026-07-18"), leaf(7)], "carried")?.status,
    ).toBe("carried");
  });

  it("0 点负责人不参与判定：挂名的勾不阻塞全件闭环（D11/D15）", () => {
    // 有正点数负责人：只看他，挂名者未交不影响 done
    expect(aggregateOf([leaf(3, "2026-07-18"), leaf(0)], "doing")).toMatchObject(
      { status: "done", doneAt: "2026-07-18" },
    );
    // 挂名者先交（无人正点）不应触发闭环信号
    expect(aggregateOf([leaf(3), leaf(0, "2026-07-18")], "todo")).toMatchObject(
      { status: "todo" },
    );
  });

  it("全是 0 点 → 退化为按全部 owner 判定（D11）", () => {
    expect(aggregateOf([leaf(0, "2026-07-18"), leaf(0)], "todo")?.status).toBe(
      "doing",
    );
    expect(
      aggregateOf(
        [leaf(0, "2026-07-18"), leaf(0, "2026-07-19")],
        "todo",
      ),
    ).toMatchObject({ status: "done", doneAt: "2026-07-19" });
  });

  it("参与判定全体签收才算件级已签收，取最后一次的签收人与日期", () => {
    expect(
      aggregateOf(
        [
          leaf(3, "2026-07-18", "2026-07-19", "张三"),
          leaf(7, "2026-07-20", "2026-07-21", "李四"),
        ],
        "doing",
      ),
    ).toMatchObject({
      confirmedAt: "2026-07-21",
      confirmedBy: "李四",
    });
    // 有人未签收 → 件级未签收
    expect(
      aggregateOf(
        [leaf(3, "2026-07-18", "2026-07-19", "张三"), leaf(7, "2026-07-20")],
        "doing",
      ),
    ).toMatchObject({ confirmedAt: null, confirmedBy: null });
  });
});

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

  it("保留快件内容、稀有度、验收标准和备注", () => {
    const carried = toStrandedTask(base, "DV2607B");
    expect(carried.title).toBe(base.title);
    expect(carried.rarity).toBe("ssr");
    expect(carried.acceptance).toBe(base.acceptance);
    expect(carried.note).toBe(base.note);
  });

  it("不搬运已废弃的档位列（v2.5 起点数由各负责人各自持有）", () => {
    expect(toStrandedTask(base, "DV2607B")).not.toHaveProperty("size");
  });

  it("排除 id 和 createdAt 字段", () => {
    const carried = toStrandedTask(base, "DV2607B");
    expect(carried).not.toHaveProperty("id");
    expect(carried).not.toHaveProperty("createdAt");
  });
});
