/* eslint-disable @typescript-eslint/no-explicit-any */
/* mock DB 单测：只保留两类无法在内存库真实模拟的用例——
 * ① 并发异常注入（撞主键/唯一约束的窗口期行为）；
 * ② 写路径前置校验的早退（NOT_FOUND / 归档只读，未触及事务）。
 * 行为回归一律走内存 SQLite（van.write.test.ts / van.confirm.test.ts / van.reorder.test.ts）。 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// 创建一个可链式调用的 mock，最后返回 Promise
const createQueryable = <T>(resolveValue: T) => {
  const query: any = {};

  // 所有链式方法返回自身
  query.select = vi.fn().mockReturnValue(query);
  query.from = vi.fn().mockReturnValue(query);
  query.where = vi.fn().mockReturnValue(query);
  query.limit = vi.fn().mockReturnValue(query);
  query.orderBy = vi.fn().mockReturnValue(query);
  query.groupBy = vi.fn().mockReturnValue(query);
  query.as = vi.fn().mockReturnValue(query);
  query.leftJoin = vi.fn().mockReturnValue(query);

  // then 方法使其可以 await
  query.then = (resolve: (value: T) => any, reject?: (error: any) => any) => {
    return Promise.resolve(resolveValue).then(resolve, reject);
  };

  return query;
};

// 万能链节点（异步化适配）：任意链式方法返回自身；await 解析为 awaitValue
// （事务外读），.all() 同步返回 allValue（事务内读），.run() 为同步写无操作。
// runTx 手写 BEGIN/COMMIT 后事务 body 直接收 db 本身，事务内外的查询都打在
// 同一个 mockDb.select 上，靠调用序分配返回值。
const createHybrid = (awaitValue: unknown, allValue: unknown[] = []) => {
  const node: any = {
    then: (resolve: (value: any) => any, reject?: (error: any) => any) =>
      Promise.resolve(awaitValue).then(resolve, reject),
    all: vi.fn().mockReturnValue(allValue),
    run: vi.fn(),
  };
  const proxy: any = new Proxy(node, {
    get(target, prop) {
      if (prop in target) return target[prop as keyof typeof target];
      return () => proxy;
    },
  });
  return proxy;
};

// Mock 数据库
let mockDb: any;

vi.mock("./connection", () => ({
  getDb: vi.fn(() => mockDb),
}));

// 导入被测模块
import {
  listVans,
  dispatchVan,
  listMembers,
  addMember,
  updateMemberCapacity,
  addTask,
  updateTask,
  removeTask,
  carryOver,
  weeklyStats,
} from "./van";

describe("班次管理", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listVans", () => {
    it("返回班次列表（按编码降序）", async () => {
      mockDb = {
        select: vi
          .fn()
          .mockReturnValue(
            createQueryable([{ code: "DV2607B" }, { code: "DV2607A" }]),
          ),
      };

      const result = await listVans();

      expect(result).toEqual(["DV2607B", "DV2607A"]);
    });

    it("空表返回空数组", async () => {
      mockDb = {
        select: vi.fn().mockReturnValue(createQueryable([])),
      };

      const result = await listVans();

      expect(result).toEqual([]);
    });
  });

  describe("dispatchVan", () => {
    it("并发撞主键时幂等返回当前列表，不抛错", async () => {
      mockDb = {
        select: vi.fn().mockReturnValue(createQueryable([{ code: "DV2607A" }])),
        // runTx 手写 BEGIN IMMEDIATE/COMMIT/ROLLBACK（sql`` 模板，mock 只记录调用）
        run: vi.fn(),
        // 事务内的 van 插入在 run() 时同步抛主键冲突（事务 body 直接收 db 本身）
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            run: vi.fn().mockImplementation(() => {
              throw { code: "SQLITE_CONSTRAINT_PRIMARYKEY" };
            }),
          }),
        }),
      };

      const result = await dispatchVan(new Date(2026, 6, 20));

      expect(result).toEqual(["DV2607A"]);
    });
  });
});

describe("成员管理", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listMembers", () => {
    it("返回成员列表（按 id 升序）", async () => {
      const mockMembers = [
        { id: 1, name: "张三", capacity: 5 },
        { id: 2, name: "李四", capacity: 3 },
      ];
      mockDb = {
        select: vi.fn().mockReturnValue(createQueryable(mockMembers)),
      };

      const result = await listMembers();

      expect(result).toEqual(mockMembers);
    });
  });

  describe("addMember", () => {
    it("并发撞唯一约束时按重名处理，不裸抛 500", async () => {
      mockDb = {
        select: vi.fn().mockReturnValue(createQueryable([])),
        run: vi.fn(),
        // 事务内的成员插入在 run() 时同步抛唯一约束
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            run: vi.fn().mockImplementation(() => {
              throw { code: "SQLITE_CONSTRAINT_UNIQUE" };
            }),
          }),
        }),
      };

      await expect(addMember("张三", 5)).rejects.toThrow(TRPCError);
      await expect(addMember("张三", 5)).rejects.toThrow("已存在");
    });
  });

  describe("updateMemberCapacity", () => {
    it("正常更新成员产能", async () => {
      const memberQuery = createQueryable([
        { id: 1, name: "张三", capacity: 5 },
      ]);
      const updatedQuery = createQueryable([
        { id: 1, name: "张三", capacity: 7 },
      ]);
      let callCount = 0;

      mockDb = {
        select: vi.fn().mockImplementation(() => {
          callCount++;
          return callCount === 1 ? memberQuery : updatedQuery;
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: (value: any) => any) =>
                Promise.resolve(undefined).then(resolve),
            }),
          }),
        }),
      };

      const result = await updateMemberCapacity(1, 7);

      expect(result).toEqual([{ id: 1, name: "张三", capacity: 7 }]);
    });

    it("成员不存在时抛出 NOT_FOUND 错误", async () => {
      mockDb = {
        select: vi.fn().mockReturnValue(createQueryable([])),
      };

      await expect(updateMemberCapacity(999, 5)).rejects.toThrow(TRPCError);
      await expect(updateMemberCapacity(999, 5)).rejects.toThrow("不存在");
    });
  });
});

describe("快件管理（前置校验早退）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("更新不存在的快件抛 NOT_FOUND", async () => {
    mockDb = {
      select: vi.fn().mockReturnValue(createQueryable([])),
    };

    await expect(updateTask(999, { status: "done" })).rejects.toThrow(
      TRPCError,
    );
    await expect(updateTask(999, { status: "done" })).rejects.toThrow("不存在");
  });

  it("删除不存在的快件抛 NOT_FOUND", async () => {
    mockDb = {
      select: vi.fn().mockReturnValue(createQueryable([])),
    };

    await expect(removeTask(999)).rejects.toThrow(TRPCError);
    await expect(removeTask(999)).rejects.toThrow("不存在");
  });

  it("已结转归档的班次不可删除快件", async () => {
    const taskQuery = createQueryable([{ id: 1, vanCode: "DV2607A" }]);
    const lockQuery = createQueryable([{ id: 1 }]);
    let callCount = 0;
    mockDb = {
      select: vi.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? taskQuery : lockQuery;
      }),
    };

    await expect(removeTask(1)).rejects.toThrow(TRPCError);
    await expect(removeTask(1)).rejects.toThrow("已结转归档");
  });

  describe("结转归档只读", () => {
    it("已结转归档的班次不可新增快件", async () => {
      mockDb = {
        select: vi.fn().mockReturnValue(createQueryable([{ id: 9 }])),
      };

      await expect(addTask({ van: "DV2607A", title: "补录" })).rejects.toThrow(
        TRPCError,
      );
      await expect(addTask({ van: "DV2607A", title: "补录" })).rejects.toThrow(
        "已结转归档",
      );
    });

    it("已结转归档的班次不可修改快件", async () => {
      const taskQuery = createQueryable([
        { id: 1, vanCode: "DV2607A", status: "carried" },
      ]);
      const lockQuery = createQueryable([{ id: 1 }]);
      let callCount = 0;
      mockDb = {
        select: vi.fn().mockImplementation(() => {
          callCount++;
          return callCount === 1 ? taskQuery : lockQuery;
        }),
      };

      await expect(updateTask(1, { status: "done" })).rejects.toThrow(
        TRPCError,
      );
      await expect(updateTask(1, { status: "done" })).rejects.toThrow(
        "已结转归档",
      );
    });
  });
});

describe("结转逻辑", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("不能结转到同一班次", async () => {
    await expect(carryOver("DV2607A", "DV2607A")).rejects.toThrow(TRPCError);
    await expect(carryOver("DV2607A", "DV2607A")).rejects.toThrow(
      "不能结转到同一班次",
    );
  });

  it("只能结转到下一班次", async () => {
    mockDb = {
      select: vi.fn().mockReturnValue(createQueryable([])),
    };

    await expect(
      carryOver("DV2607A", "DV2607C", new Date(2026, 6, 20)),
    ).rejects.toThrow(TRPCError);
    await expect(
      carryOver("DV2607A", "DV2607C", new Date(2026, 6, 20)),
    ).rejects.toThrow("只能结转到下一班次");
  });

  it("正常结转未完成快件", async () => {
    const insertMock = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockReturnValue({
          all: vi.fn().mockReturnValue([{ id: 10 }]),
        }),
        run: vi.fn(),
      }),
    });

    let callCount = 0;
    mockDb = {
      run: vi.fn(),
      insert: insertMock,
      select: vi.fn().mockImplementation(() => {
        callCount++;
        // 第 1 次是结转前校验用的 listVans（无下一班，await 路径）；
        // 第 2~6 次是事务内同步读（.all() 路径，均空）；最后是末尾 listTasksByVan
        return createHybrid(
          callCount >= 7
            ? [{ id: 10, vanCode: "DV2607B", owners: "张三" }]
            : [],
        );
      }),
    };

    const result = await carryOver("DV2607A", "DV2607B", new Date(2026, 6, 20));

    expect(result.carried).toBe(0);
    // runTx 手写事务：BEGIN IMMEDIATE + COMMIT 各一次
    expect(mockDb.run).toHaveBeenCalledTimes(2);
  });

  it("结转时把源班未完成任务标记为 carried", async () => {
    const unfinished = [
      { id: 5, vanCode: "DV2607A", status: "doing" },
      { id: 6, vanCode: "DV2607A", status: "todo" },
    ];
    const setMock = vi.fn();

    let callCount = 0;
    mockDb = {
      run: vi.fn(),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockReturnValue({
            all: vi.fn().mockReturnValue([{ id: 10 }]),
          }),
          run: vi.fn(),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: setMock.mockReturnValue({
          where: vi.fn().mockReturnValue({ run: vi.fn() }),
        }),
      }),
      select: vi.fn().mockImplementation(() => {
        callCount++;
        // 调用序：① listVans（await）→ ② 幂等检查 → ③ vanExists →
        // ④ 源班未完成快件（.all()，返回 unfinished）→ ⑤ max(sort_order) →
        // ⑥⑦ 各结转件的负责人标签 → ⑧ 审计链尾 → ⑨⑩ 末尾 listTasksByVan
        return createHybrid([], callCount === 4 ? unfinished : []);
      }),
    };

    const result = await carryOver("DV2607A", "DV2607B", new Date(2026, 6, 20));

    expect(result.carried).toBe(2);
    expect(mockDb.update).toHaveBeenCalled();
    expect(setMock).toHaveBeenCalledWith({ status: "carried" });
  });

  it("目标班次不存在时自动创建", async () => {
    let vanCreated = false;
    mockDb = {
      run: vi.fn(),
      select: vi.fn().mockImplementation(() => createHybrid([])),
      insert: vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation(() => {
          vanCreated = true;
          return {
            returning: vi.fn().mockReturnValue({
              all: vi.fn().mockReturnValue([{ id: 10 }]),
            }),
            run: vi.fn(),
          };
        }),
      })),
    };

    await carryOver("DV2607A", "DV2607B", new Date(2026, 6, 20));

    expect(vanCreated).toBe(true);
  });

  it("下一班已存在时转入既有班次，不再创建", async () => {
    let vanInserted = false;

    let callCount = 0;
    mockDb = {
      run: vi.fn(),
      insert: vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation(() => {
          vanInserted = true;
          return {
            returning: vi.fn().mockReturnValue({
              all: vi.fn().mockReturnValue([{ id: 10 }]),
            }),
            run: vi.fn(),
          };
        }),
      })),
      select: vi.fn().mockImplementation(() => {
        callCount++;
        // 调用序：① listVans（DV2608A 已发，是 DV2607A 的紧邻下一班）→
        // ② 幂等检查（无既往结转）→ ③ vanExists（目标班已存在）→ 其余均空
        if (callCount === 1) {
          return createHybrid([{ code: "DV2607A" }, { code: "DV2608A" }]);
        }
        if (callCount === 3) {
          return createHybrid([], [{ code: "DV2608A" }]);
        }
        return createHybrid([]);
      }),
    };

    const result = await carryOver("DV2607A", "DV2608A", new Date(2026, 7, 5));

    expect(result.carried).toBe(0);
    expect(vanInserted).toBe(false);
  });
});

describe("周统计", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("返回正确的统计数据", async () => {
    const mockTasks = [
      {
        id: 1,
        status: "done",
        rarity: "n",
        carryCount: 0,
        carriedFrom: null,
        size: 3,
        owners: "张三",
      },
      {
        id: 2,
        status: "carried",
        rarity: "ssr",
        carryCount: 0,
        carriedFrom: null,
        size: 5,
        owners: "张三",
      },
      {
        id: 3,
        status: "done",
        rarity: "sr",
        carryCount: 2,
        carriedFrom: "DV2607A",
        size: 1,
        owners: "李四",
      },
    ];
    const mockMembers = [
      { id: 1, name: "张三", capacity: 5 },
      { id: 2, name: "李四", capacity: 3 },
    ];

    let callCount = 0;
    mockDb = {
      select: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          // listTasksByVan 的两次查询
          return createQueryable(callCount === 1 ? [] : mockTasks);
        } else {
          // listMembers / listVans / listAllTasks / audit 链尾
          return createQueryable(
            callCount === 3
              ? mockMembers
              : callCount === 4
                ? [{ code: "DV2607B" }, { code: "DV2607A" }]
                : [],
          );
        }
      }),
    };

    const result = await weeklyStats("DV2607B");

    expect(result.van).toBe("DV2607B");
    expect(result.total).toBe(3);
    expect(result.done).toBe(2);
    expect(result.remaining).toBe(1);
    expect(result.carriedOut).toBe(1);
    expect(result.carriedIn).toBe(1);
    expect(result.reviewNeeded).toBe(1);
    expect(result.completionRate).toBeCloseTo(2 / 3);
    // 滞留率 = 结转出去的任务数 / 总数（结转后旧车数据随之更新）
    expect(result.carryRate).toBeCloseTo(1 / 3);
  });

  it("空班次返回 null 完成率", async () => {
    mockDb = {
      select: vi.fn().mockReturnValue(createQueryable([])),
    };

    const result = await weeklyStats("DV2607A");

    expect(result.total).toBe(0);
    expect(result.completionRate).toBeNull();
    expect(result.carryRate).toBeNull();
  });
});
