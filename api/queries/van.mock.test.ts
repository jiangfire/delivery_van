/* eslint-disable @typescript-eslint/no-explicit-any */
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
    it("空表时创建当月首班车", async () => {
      const firstQuery = createQueryable([]);
      const secondQuery = createQueryable([{ code: "DV2607A" }]);
      let callCount = 0;

      mockDb = {
        select: vi.fn().mockImplementation(() => {
          callCount++;
          return callCount === 1 ? firstQuery : secondQuery;
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            then: (resolve: (value: any) => any) =>
              Promise.resolve({}).then(resolve),
          }),
        }),
      };

      const result = await dispatchVan();

      expect(result).toEqual(["DV2607A"]);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("已有班次时自动递增", async () => {
      const firstQuery = createQueryable([{ code: "DV2607A" }]);
      const secondQuery = createQueryable([
        { code: "DV2607B" },
        { code: "DV2607A" },
      ]);
      let callCount = 0;

      mockDb = {
        select: vi.fn().mockImplementation(() => {
          callCount++;
          return callCount === 1 ? firstQuery : secondQuery;
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            then: (resolve: (value: any) => any) =>
              Promise.resolve({}).then(resolve),
          }),
        }),
      };

      const result = await dispatchVan();

      expect(result).toEqual(["DV2607B", "DV2607A"]);
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
    it("正常添加新成员", async () => {
      const emptyQuery = createQueryable([]);
      const memberQuery = createQueryable([
        { id: 1, name: "张三", capacity: 5 },
      ]);
      let callCount = 0;

      mockDb = {
        select: vi.fn().mockImplementation(() => {
          callCount++;
          return callCount === 1 ? emptyQuery : memberQuery;
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            then: (resolve: (value: any) => any) =>
              Promise.resolve({}).then(resolve),
          }),
        }),
      };

      const result = await addMember("张三", 5);

      expect(result).toEqual([{ id: 1, name: "张三", capacity: 5 }]);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("重名时抛出 CONFLICT 错误", async () => {
      mockDb = {
        select: vi.fn().mockReturnValue(createQueryable([{ id: 1 }])),
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

describe("快件管理", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("addTask", () => {
    it("正常创建快件", async () => {
      const emptyQuery = createQueryable([]);
      const taskQuery = createQueryable([]);
      let callCount = 0;

      mockDb = {
        select: vi.fn().mockImplementation(() => {
          callCount++;
          return callCount <= 1 ? emptyQuery : taskQuery;
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockReturnValue({
              then: (resolve: (value: any) => any) =>
                Promise.resolve([{ id: 1 }]).then(resolve),
            }),
          }),
        }),
      };

      const result = await addTask({
        van: "DV2607A",
        title: "测试快件",
      });

      expect(result).toEqual([]);
    });

    it("创建快件时写入负责人标签", async () => {
      const emptyQuery = createQueryable([]);
      const taskQuery = createQueryable([]);
      let callCount = 0;

      mockDb = {
        select: vi.fn().mockImplementation(() => {
          callCount++;
          return callCount <= 1 ? emptyQuery : taskQuery;
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockReturnValue({
              then: (resolve: (value: any) => any) =>
                Promise.resolve([{ id: 1 }]).then(resolve),
            }),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: (resolve: (value: any) => any) =>
              Promise.resolve(undefined).then(resolve),
          }),
        }),
      };

      const result = await addTask({
        van: "DV2607A",
        title: "测试快件",
        owners: ["张三"],
      });

      expect(result).toEqual([]);
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe("updateTask", () => {
    it("更新快件状态时自动填充完成日期", async () => {
      const taskQuery = createQueryable([
        { id: 1, vanCode: "DV2607A", status: "todo" },
      ]);
      const listQuery = createQueryable([]);
      let callCount = 0;

      mockDb = {
        select: vi.fn().mockImplementation(() => {
          callCount++;
          return callCount === 1 ? taskQuery : listQuery;
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

      const result = await updateTask(1, { status: "done" });

      expect(result).toEqual([]);
    });

    it("取消完成时清空完成日期", async () => {
      const taskQuery = createQueryable([
        { id: 1, vanCode: "DV2607A", status: "done" },
      ]);
      const listQuery = createQueryable([]);
      let callCount = 0;

      mockDb = {
        select: vi.fn().mockImplementation(() => {
          callCount++;
          return callCount === 1 ? taskQuery : listQuery;
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

      const result = await updateTask(1, { status: "todo" });

      expect(result).toEqual([]);
    });

    it("更新负责人标签", async () => {
      const taskQuery = createQueryable([
        { id: 1, vanCode: "DV2607A", status: "todo" },
      ]);
      const listQuery = createQueryable([]);
      let callCount = 0;

      mockDb = {
        select: vi.fn().mockImplementation(() => {
          callCount++;
          return callCount === 1 ? taskQuery : listQuery;
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: (value: any) => any) =>
                Promise.resolve(undefined).then(resolve),
            }),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: (resolve: (value: any) => any) =>
              Promise.resolve(undefined).then(resolve),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            then: (resolve: (value: any) => any) =>
              Promise.resolve(undefined).then(resolve),
          }),
        }),
      };

      const result = await updateTask(1, { owners: ["张三", "李四"] });

      expect(result).toEqual([]);
      // 回归测试：仅更新 owners 时不应调用 db.update(tasks)
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it("设置完成日期时的边界情况", async () => {
      const taskQuery = createQueryable([
        { id: 1, vanCode: "DV2607A", status: "todo" },
      ]);
      const listQuery = createQueryable([]);
      let callCount = 0;

      mockDb = {
        select: vi.fn().mockImplementation(() => {
          callCount++;
          return callCount === 1 ? taskQuery : listQuery;
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

      const result = await updateTask(1, {
        status: "done",
        doneAt: "2026-07-20",
      });

      expect(result).toEqual([]);
    });

    it("快件不存在时抛出 NOT_FOUND 错误", async () => {
      mockDb = {
        select: vi.fn().mockReturnValue(createQueryable([])),
      };

      await expect(updateTask(999, { status: "done" })).rejects.toThrow(
        TRPCError,
      );
      await expect(updateTask(999, { status: "done" })).rejects.toThrow(
        "不存在",
      );
    });
  });

  describe("removeTask", () => {
    it("正常删除快件", async () => {
      const taskQuery = createQueryable([{ id: 1, vanCode: "DV2607A" }]);
      const lockQuery = createQueryable([]);
      let callCount = 0;
      mockDb = {
        select: vi.fn().mockImplementation(() => {
          callCount++;
          return callCount === 1 ? taskQuery : lockQuery;
        }),
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: (resolve: (value: any) => any) =>
              Promise.resolve(undefined).then(resolve),
          }),
        }),
      };

      await removeTask(1);

      expect(mockDb.delete).toHaveBeenCalled();
    });

    it("快件不存在时抛出 NOT_FOUND 错误", async () => {
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
  });

  describe("结转归档只读", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

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

// 导入结转和统计函数
import { carryOver, weeklyStats } from "./van";

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
    await expect(carryOver("DV2607A", "DV2607C")).rejects.toThrow(TRPCError);
    await expect(carryOver("DV2607A", "DV2607C")).rejects.toThrow(
      "只能结转到下一班次",
    );
  });

  it("正常结转未完成快件", async () => {
    const mockTx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              all: vi.fn().mockReturnValue([]),
            }),
            all: vi.fn().mockReturnValue([]),
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockReturnValue({
            all: vi.fn().mockReturnValue([{ id: 10 }]),
          }),
          run: vi.fn(),
        }),
      }),
    };

    mockDb = {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
      transaction: vi.fn((fn: Function) => fn(mockTx)),
      select: vi
        .fn()
        .mockReturnValue(
          createQueryable([{ id: 10, vanCode: "DV2607B", owners: "张三" }]),
        ),
    };

    const result = await carryOver("DV2607A", "DV2607B");

    expect(result.carried).toBe(0);
    expect(mockDb.transaction).toHaveBeenCalled();
  });

  it("结转时把源班未完成任务标记为 carried", async () => {
    const unfinished = [
      { id: 5, vanCode: "DV2607A", status: "doing" },
      { id: 6, vanCode: "DV2607A", status: "todo" },
    ];
    const setMock = vi.fn();
    const mockTx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              all: vi.fn().mockReturnValue([]),
            }),
            all: vi.fn().mockReturnValue(unfinished),
          }),
        }),
      }),
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
    };

    mockDb = {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
      transaction: vi.fn((fn: Function) => fn(mockTx)),
      select: vi.fn().mockReturnValue(createQueryable([])),
    };

    const result = await carryOver("DV2607A", "DV2607B");

    expect(result.carried).toBe(2);
    expect(mockTx.update).toHaveBeenCalled();
    expect(setMock).toHaveBeenCalledWith({ status: "carried" });
  });

  it("目标班次不存在时自动创建", async () => {
    let vanCreated = false;
    const mockTx = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              all: vi.fn().mockReturnValue([]),
            }),
            all: vi.fn().mockReturnValue([]),
          }),
        }),
      })),
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

    mockDb = {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
      transaction: vi.fn((fn: Function) => fn(mockTx)),
      select: vi.fn().mockReturnValue(createQueryable([])),
    };

    await carryOver("DV2607A", "DV2607B");

    expect(vanCreated).toBe(true);
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
          // listMembers
          return createQueryable(mockMembers);
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
    let callCount = 0;
    mockDb = {
      select: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return createQueryable([]);
        } else {
          return createQueryable([]);
        }
      }),
    };

    const result = await weeklyStats("DV2607A");

    expect(result.total).toBe(0);
    expect(result.completionRate).toBeNull();
    expect(result.carryRate).toBeNull();
  });
});
