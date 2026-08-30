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

// 通用 insert mock：审计日志等写操作出口会调用 db.insert，测试不关心其落库细节
const anyInsert = () =>
  vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      then: (resolve: (value: any) => any) =>
        Promise.resolve(undefined).then(resolve),
    }),
  });

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

      const result = await dispatchVan(new Date(2026, 6, 15));

      expect(result).toEqual(["DV2607A"]);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("已有班次时同月自动递增", async () => {
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

      const result = await dispatchVan(new Date(2026, 6, 20));

      expect(result).toEqual(["DV2607B", "DV2607A"]);
    });

    it("跨月发新车从新月份 A 重新计数", async () => {
      const firstQuery = createQueryable([{ code: "DV2607E" }]);
      const secondQuery = createQueryable([
        { code: "DV2608A" },
        { code: "DV2607E" },
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

      const result = await dispatchVan(new Date(2026, 7, 5));

      expect(result).toEqual(["DV2608A", "DV2607E"]);
    });

    it("并发撞主键时幂等返回当前列表，不抛错", async () => {
      const listQuery = createQueryable([{ code: "DV2607A" }]);

      mockDb = {
        select: vi.fn().mockReturnValue(listQuery),
        insert: vi.fn().mockReturnValue({
          values: vi
            .fn()
            .mockReturnValue(
              Promise.reject({ code: "SQLITE_CONSTRAINT_PRIMARYKEY" }),
            ),
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

    it("并发撞唯一约束时按重名处理，不裸抛 500", async () => {
      mockDb = {
        select: vi.fn().mockReturnValue(createQueryable([])),
        insert: vi.fn().mockReturnValue({
          values: vi
            .fn()
            .mockImplementation(() =>
              Promise.reject({ code: "SQLITE_CONSTRAINT_UNIQUE" }),
            ),
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
        insert: anyInsert(),
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
        insert: anyInsert(),
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
        insert: anyInsert(),
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
        insert: anyInsert(),
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

    let callCount = 0;
    mockDb = {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
      transaction: vi.fn((fn: Function) => fn(mockTx)),
      select: vi.fn().mockImplementation(() => {
        callCount++;
        // 第 1 次是结转前校验用的 listVans（无下一班），第 2 次是末尾 listTasksByVan
        return createQueryable(
          callCount === 1
            ? []
            : [{ id: 10, vanCode: "DV2607B", owners: "张三" }],
        );
      }),
      insert: anyInsert(), // 审计日志出口（entries 为空时不触发，补齐以防未来用例带入数据）
    };

    const result = await carryOver("DV2607A", "DV2607B", new Date(2026, 6, 20));

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
      insert: anyInsert(), // 审计日志出口（结转带原因时逐条进链）
    };

    const result = await carryOver("DV2607A", "DV2607B", new Date(2026, 6, 20));

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
      insert: anyInsert(), // 审计日志出口（van 自动创建也进链）
    };

    await carryOver("DV2607A", "DV2607B", new Date(2026, 6, 20));

    expect(vanCreated).toBe(true);
  });

  it("下一班已存在时转入既有班次，不再创建", async () => {
    let vanInserted = false;
    // 事务内查询顺序：① 幂等检查（无既往结转）→ ② vanExists（目标班已存在）→ ③ 源班未完成（无）
    let limitCall = 0;
    const mockTx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              limitCall++;
              return {
                all: vi
                  .fn()
                  .mockReturnValue(
                    limitCall === 1 ? [] : [{ code: "DV2608A" }],
                  ),
              };
            }),
            all: vi.fn().mockReturnValue([]),
          }),
        }),
      }),
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
    };

    let callCount = 0;
    mockDb = {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
      transaction: vi.fn((fn: Function) => fn(mockTx)),
      select: vi.fn().mockImplementation(() => {
        callCount++;
        // 第 1 次是 listVans：DV2608A 已发，是 DV2607A 的紧邻下一班
        return createQueryable(
          callCount === 1 ? [{ code: "DV2607A" }, { code: "DV2608A" }] : [],
        );
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
