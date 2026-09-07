/* 写路径行为套件（发新车 / 成员 / 快件增删改 + 审计同事务原子性）：
 * 同一份用例跑三个方言变体——sqlite 内存库（van.write.test.ts）与
 * pg/mysql CI 容器（dialect.pg.test.ts / dialect.mysql.test.ts）。 */
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  addMember,
  addTask,
  confirmTask,
  dispatchVan,
  listMembers,
  listTasksByVan,
  listVans,
  removeMember,
  removeTask,
  updateTask,
} from "./van";
import { execRaw } from "./dialect";
import { todayStr } from "../../contracts/vans";
import type { DataLayerCtx } from "./dialectHarness";

export function registerWriteSuite(ctx: DataLayerCtx) {
  const { S } = ctx;

  describe("写路径", () => {
    describe("发新车", () => {
      it("空表时创建当月首班车，并进审计链", async () => {
        const result = await dispatchVan(new Date(2026, 6, 15), "张三");
        expect(result).toEqual(["DV2607A"]);
        const rows = await ctx.db().select().from(S.auditLog);
        expect(rows[0].entity).toBe("van");
        expect(rows[0].actor).toBe("张三");
      });

      it("已有班次时同月自动递增", async () => {
        await dispatchVan(new Date(2026, 6, 15));
        const result = await dispatchVan(new Date(2026, 6, 20));
        expect(result).toEqual(["DV2607B", "DV2607A"]);
      });

      it("跨月发新车从新月份 A 重新计数", async () => {
        await dispatchVan(new Date(2026, 6, 15)); // DV2607A
        const result = await dispatchVan(new Date(2026, 7, 5)); // 8 月 → DV2608A
        expect(result).toEqual(["DV2608A", "DV2607A"]);
      });
    });

    describe("成员", () => {
      it("正常添加新成员", async () => {
        const result = await addMember("张三", 10);
        // pg/mysql 容器库自增序号跨用例不复位，不断言具体 id
        expect(result).toEqual([
          {
            id: expect.any(Number),
            name: "张三",
            capacity: 10,
            createdAt: expect.any(Date),
          },
        ]);
      });

      it("重名时抛出 CONFLICT 错误", async () => {
        await addMember("张三", 10);
        await expect(addMember("张三", 5)).rejects.toThrow(TRPCError);
        await expect(addMember("张三", 5)).rejects.toThrow("已存在");
        expect(await listMembers()).toHaveLength(1);
      });

      it("零历史成员可删除，删除进审计链", async () => {
        await addMember("临时工", 10);
        const result = await removeMember("临时工", "管理员");
        expect(result.map((x) => x.name)).not.toContain("临时工");
        const del = (await ctx.db().select().from(S.auditLog)).find(
          (a) => a.entity === "member" && a.oldValue === "临时工",
        );
        expect(del?.newValue).toBeNull();
        expect(del?.actor).toBe("管理员");
      });

      it("当过负责人的成员不可删除", async () => {
        await addMember("张三", 10);
        await addTask({ van: "DV2607A", title: "甲", owners: ["张三"] });
        await expect(removeMember("张三")).rejects.toThrow("不可删除");
        expect((await listMembers()).map((x) => x.name)).toContain("张三");
      });

      it("当过提出人的成员不可删除（即使没当过负责人）", async () => {
        await addMember("李四", 10);
        await addTask({ van: "DV2607A", title: "甲", requester: "李四" });
        await expect(removeMember("李四")).rejects.toThrow("不可删除");
        expect((await listMembers()).map((x) => x.name)).toContain("李四");
      });

      it("签收过快件的成员不可删除", async () => {
        await addMember("张三", 10); // 提出人
        await addMember("李四", 10); // 签收人
        await addTask({ van: "DV2607A", title: "甲", requester: "张三" });
        const [t] = await listTasksByVan("DV2607A");
        await updateTask(t.id, { status: "done" });
        await confirmTask(t.id, "李四");
        await expect(removeMember("李四")).rejects.toThrow("不可删除");
      });

      it("删除不存在的成员报 NOT_FOUND", async () => {
        await expect(removeMember("查无此人")).rejects.toThrow("不存在");
      });
    });

    describe("快件增删改", () => {
      it("创建快件时写入负责人标签，排在班次末尾", async () => {
        await addTask({ van: "DV2607A", title: "甲" });
        await addTask({
          van: "DV2607A",
          title: "乙",
          owners: ["张三", "李四"],
          source: "exploration",
        });
        const list = await listTasksByVan("DV2607A");
        expect(list.map((t) => t.title)).toEqual(["甲", "乙"]);
        expect(list[1].owners).toEqual(["张三", "李四"]);
        expect(list[1].source).toBe("exploration");
        expect(list[0].source).toBe("customer"); // 默认客户件
      });

      it("更新快件状态时自动填充完成日期，未签收", async () => {
        await addTask({ van: "DV2607A", title: "甲" });
        const [t] = await listTasksByVan("DV2607A");
        const list = await updateTask(t.id, { status: "done" });
        expect(list[0].doneAt).toBe(todayStr());
        expect(list[0].confirmedAt).toBeNull();
      });

      it("取消完成时清空完成日期", async () => {
        await addTask({ van: "DV2607A", title: "甲" });
        const [t] = await listTasksByVan("DV2607A");
        await updateTask(t.id, { status: "done" });
        const list = await updateTask(t.id, { status: "todo" });
        expect(list[0].doneAt).toBeNull();
      });

      it("仅更新负责人时不动任务行字段（状态与日期保持）", async () => {
        await addTask({ van: "DV2607A", title: "甲" });
        const [t] = await listTasksByVan("DV2607A");
        await updateTask(t.id, { status: "done" });
        const list = await updateTask(t.id, { owners: ["张三"] });
        expect(list[0].owners).toEqual(["张三"]);
        expect(list[0].status).toBe("done");
        expect(list[0].doneAt).toBe(todayStr());
      });

      it("显式送达日期不被当天覆盖，删除快件后列表为空", async () => {
        await addTask({ van: "DV2607A", title: "甲" });
        const [t] = await listTasksByVan("DV2607A");
        const list = await updateTask(t.id, {
          status: "done",
          doneAt: "2026-07-20",
        });
        expect(list[0].doneAt).toBe("2026-07-20");

        await removeTask(t.id);
        expect(await listTasksByVan("DV2607A")).toHaveLength(0);
      });
    });

    describe("审计与业务写同事务（原子性）", () => {
      it("审计写入失败时业务写一并回滚，不留未记账的写", async () => {
        // DROP 审计表让 appendAudit 失败（下个用例的 beforeEach 会重建）
        await execRaw(ctx.db(), sql`DROP TABLE audit_log`);

        await expect(
          addTask({ van: "DV2607A", title: "甲" }),
        ).rejects.toThrow();
        // 回滚生效：快件没有落库
        expect(await listTasksByVan("DV2607A")).toHaveLength(0);
        expect(await listVans()).toEqual([]);
      });
    });
  });
}
