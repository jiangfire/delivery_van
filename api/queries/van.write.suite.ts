/* 写路径行为套件（发新车 / 成员 / 快件增删改 + 审计同事务原子性）：
 * 同一份用例跑三个方言变体——sqlite 内存库（van.write.test.ts）与
 * pg/mysql CI 容器（dialect.pg.test.ts / dialect.mysql.test.ts）。 */
import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  addMember,
  addTask,
  carryOver,
  confirmTask,
  dispatchVan,
  listMembers,
  listTasksByVan,
  listVans,
  removeMember,
  removeTask,
  setOwnerDone,
  updateMemberCapacity,
  updateTask,
} from "./van";
import { execRaw } from "./dialect";
import { todayStr } from "../../contracts/vans";
import { taskPointsOf } from "../../contracts/points";
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
        await addTask({
          van: "DV2607A",
          title: "甲",
          owners: [{ name: "张三", points: 3 }],
        });
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

      it("改运力进审计链，记账带操作人与新旧值（v2.4 补齐）", async () => {
        await addMember("张三", 10);
        await updateMemberCapacity(
          (await listMembers()).find((m) => m.name === "张三")!.id,
          7,
          "管理员",
        );
        const rec = (await ctx.db().select().from(S.auditLog)).find(
          (a) => a.entity === "member" && a.field === "capacity",
        );
        expect(rec?.actor).toBe("管理员");
        expect(rec?.oldValue).toBe("10");
        expect(rec?.newValue).toBe("7");
        expect(
          (await listMembers()).find((m) => m.name === "张三")?.capacity,
        ).toBe(7);
      });

      it("改运力的记账缺 actor 时落 '(unknown)' 软身份", async () => {
        await addMember("李四", 10);
        await updateMemberCapacity(
          (await listMembers()).find((m) => m.name === "李四")!.id,
          12,
        );
        const rec = (await ctx.db().select().from(S.auditLog)).find(
          (a) => a.entity === "member" && a.field === "capacity",
        );
        expect(rec?.actor).toBe("(unknown)");
      });
    });

    describe("快件增删改", () => {
      it("创建快件时写入各负责人的点数，排在班次末尾", async () => {
        await addTask({ van: "DV2607A", title: "甲" });
        await addTask({
          van: "DV2607A",
          title: "乙",
          owners: [
            { name: "张三", points: 3 },
            { name: "李四", points: 2 },
          ],
          source: "exploration",
        });
        const list = await listTasksByVan("DV2607A");
        expect(list.map((t) => t.title)).toEqual(["甲", "乙"]);
        expect(list[1].owners).toEqual([
          {
            name: "张三",
            points: 3,
            doneAt: null,
            confirmedAt: null,
            confirmedBy: null,
          },
          {
            name: "李四",
            points: 2,
            doneAt: null,
            confirmedAt: null,
            confirmedBy: null,
          },
        ]);
        expect(taskPointsOf(list[1].owners)).toBe(5);
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

      it("无负责人的完成件补上负责人后由叶子聚合接管：未交付则回落 doing", async () => {
        await addTask({ van: "DV2607A", title: "甲" });
        const [t] = await listTasksByVan("DV2607A");
        await updateTask(t.id, { status: "done" });
        const list = await updateTask(t.id, {
          owners: [{ name: "张三", points: 4 }],
        });
        expect(list[0].owners).toEqual([
          {
            name: "张三",
            points: 4,
            doneAt: null,
            confirmedAt: null,
            confirmedBy: null,
          },
        ]);
        // 参与判定的人未交付，件级不能继续声称完成
        expect(list[0].status).toBe("doing");
        expect(list[0].doneAt).toBeNull();
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

    describe("逐人完成（v2.6）", () => {
      async function seedOwnersTask() {
        await addTask({
          van: "DV2607A",
          title: "多人件",
          requester: "张三",
          owners: [
            { name: "李子烨", points: 7 },
            { name: "王思雨", points: 2 },
          ],
        });
        const [t] = await listTasksByVan("DV2607A");
        return t.id;
      }

      it("打勾记当天日期，可补录日期，其他人不受影响", async () => {
        const id = await seedOwnersTask();
        let list = await setOwnerDone(id, "李子烨", true);
        const of = (name: string) =>
          list[0].owners.find((o) => o.name === name)!;
        expect(of("李子烨").doneAt).toBe(todayStr());
        expect(of("王思雨").doneAt).toBeNull();

        list = await setOwnerDone(id, "王思雨", true, "2026-07-20");
        expect(of("王思雨").doneAt).toBe("2026-07-20");
        expect(of("李子烨").doneAt).toBe(todayStr());
      });

      it("取消完成只清空该人日期，并作废该人的签收（他人的签收保留）", async () => {
        const id = await seedOwnersTask();
        await setOwnerDone(id, "李子烨", true, "2026-07-18");
        await ctx
          .db()
          .update(S.taskOwners)
          .set({ confirmedAt: "2026-07-19", confirmedBy: "张三" })
          .where(
            and(
              eq(S.taskOwners.taskId, id),
              eq(S.taskOwners.ownerName, "李子烨"),
            ),
          );
        await setOwnerDone(id, "王思雨", true, "2026-07-20");

        const list = await setOwnerDone(id, "李子烨", false);
        const of = (name: string) =>
          list[0].owners.find((o) => o.name === name)!;
        expect(of("李子烨").doneAt).toBeNull();
        expect(of("李子烨").confirmedAt).toBeNull();
        expect(of("李子烨").confirmedBy).toBeNull();
        expect(of("王思雨").doneAt).toBe("2026-07-20");
      });

      it("重复打勾同一天幂等：不新增审计条目", async () => {
        const id = await seedOwnersTask();
        await setOwnerDone(id, "李子烨", true, "2026-07-18");
        const before = await ctx.db().select().from(S.auditLog);
        await setOwnerDone(id, "李子烨", true, "2026-07-18");
        expect(await ctx.db().select().from(S.auditLog)).toHaveLength(
          before.length,
        );
      });

      it("归档班次拒绝改完成", async () => {
        const id = await seedOwnersTask();
        await ctx.db().insert(S.tasks).values({
          vanCode: "DV2607A",
          title: "滞留件",
          status: "todo",
        });
        await carryOver("DV2607A", "DV2607B", new Date(2026, 6, 20));
        await expect(setOwnerDone(id, "李子烨", true)).rejects.toThrow(
          "归档",
        );
      });

      it("负责人不在件上报 NOT_FOUND", async () => {
        const id = await seedOwnersTask();
        await expect(setOwnerDone(id, "查无此人", true)).rejects.toThrow(
          "负责人",
        );
      });

      it("审计记 owner:<名字> 紧凑 JSON，含点数与新旧完成日期", async () => {
        const id = await seedOwnersTask();
        await setOwnerDone(id, "李子烨", true, "2026-07-18", "张三");
        const rec = (await ctx.db().select().from(S.auditLog)).find(
          (a) => a.field === "owner:李子烨",
        );
        expect(rec?.actor).toBe("张三");
        expect(JSON.parse(rec!.oldValue!)).toEqual({
          points: 7,
          doneAt: null,
          confirmedAt: null,
        });
        expect(JSON.parse(rec!.newValue!)).toEqual({
          points: 7,
          doneAt: "2026-07-18",
          confirmedAt: null,
        });
      });
    });

    describe("件级聚合（v2.6 §3.3）", () => {
      async function seedMulti() {
        await addTask({
          van: "DV2607A",
          title: "多人件",
          requester: "张三",
          owners: [
            { name: "丰智娟", points: 3 },
            { name: "李子烨", points: 7 },
          ],
        });
        const [t] = await listTasksByVan("DV2607A");
        return t.id;
      }

      it("参与判定的人全交完才算 done，件级日期取最后一个完成者（D7）", async () => {
        const id = await seedMulti();
        await setOwnerDone(id, "丰智娟", true, "2026-07-18");
        let [t] = await listTasksByVan("DV2607A");
        expect(t.status).toBe("doing");
        expect(t.doneAt).toBeNull();

        await setOwnerDone(id, "李子烨", true, "2026-07-20");
        [t] = await listTasksByVan("DV2607A");
        expect(t.status).toBe("done");
        expect(t.doneAt).toBe("2026-07-20");
      });

      it("取消某人完成 → 件级从 done 回落 doing 并清空日期（D6）", async () => {
        const id = await seedMulti();
        await setOwnerDone(id, "丰智娟", true, "2026-07-18");
        await setOwnerDone(id, "李子烨", true, "2026-07-20");
        await setOwnerDone(id, "李子烨", false);
        const [t] = await listTasksByVan("DV2607A");
        expect(t.status).toBe("doing");
        expect(t.doneAt).toBeNull();
      });

      it("件级完成快捷：给参与判定全体打同一天（D8）", async () => {
        const id = await seedMulti();
        const list = await updateTask(id, {
          status: "done",
          doneAt: "2026-07-19",
        });
        const of = (n: string) => list[0].owners.find((o) => o.name === n)!;
        expect(of("丰智娟").doneAt).toBe("2026-07-19");
        expect(of("李子烨").doneAt).toBe("2026-07-19");
        expect(list[0].status).toBe("done");
        expect(list[0].doneAt).toBe("2026-07-19");
      });

      it("件级取消完成：清全体完成日期（D8）", async () => {
        const id = await seedMulti();
        await updateTask(id, { status: "done", doneAt: "2026-07-19" });
        const list = await updateTask(id, { status: "todo" });
        expect(list[0].owners.every((o) => o.doneAt === null)).toBe(true);
        expect(list[0].status).toBe("doing"); // 不自动回落（D9）
        expect(list[0].doneAt).toBeNull();
      });

      it("改点数不抹交付与签收记录（D14 同名保留）", async () => {
        const id = await seedMulti();
        await setOwnerDone(id, "丰智娟", true, "2026-07-18");
        await ctx
          .db()
          .update(S.taskOwners)
          .set({ confirmedAt: "2026-07-19", confirmedBy: "张三" })
          .where(
            and(
              eq(S.taskOwners.taskId, id),
              eq(S.taskOwners.ownerName, "丰智娟"),
            ),
          );
        const list = await updateTask(id, {
          owners: [
            { name: "丰智娟", points: 5 },
            { name: "李子烨", points: 7 },
          ],
        });
        const of = (n: string) => list[0].owners.find((o) => o.name === n)!;
        expect(of("丰智娟").points).toBe(5);
        expect(of("丰智娟").doneAt).toBe("2026-07-18");
        expect(of("丰智娟").confirmedAt).toBe("2026-07-19");
        expect(of("丰智娟").confirmedBy).toBe("张三");
      });

      it("移除再补回同名负责人会丢失记录（新名字三列 NULL）", async () => {
        const id = await seedMulti();
        await setOwnerDone(id, "丰智娟", true, "2026-07-18");
        let list = await updateTask(id, {
          owners: [{ name: "李子烨", points: 7 }],
        });
        expect(list[0].owners.map((o) => o.name)).toEqual(["李子烨"]);
        list = await updateTask(id, {
          owners: [
            { name: "李子烨", points: 7 },
            { name: "丰智娟", points: 3 },
          ],
        });
        expect(
          list[0].owners.find((o) => o.name === "丰智娟")!.doneAt,
        ).toBeNull();
      });

      it("全 0 点件退化为按全部 owner 判定（D11）", async () => {
        await addTask({
          van: "DV2607A",
          title: "全挂名件",
          owners: [
            { name: "丰智娟", points: 0 },
            { name: "李子烨", points: 0 },
          ],
        });
        const [t] = await listTasksByVan("DV2607A");
        await setOwnerDone(t.id, "丰智娟", true, "2026-07-18");
        expect((await listTasksByVan("DV2607A"))[0].status).toBe("doing");
        await setOwnerDone(t.id, "李子烨", true, "2026-07-19");
        const [after] = await listTasksByVan("DV2607A");
        expect(after.status).toBe("done");
        expect(after.doneAt).toBe("2026-07-19");
      });

      it("0 点负责人完成不参与件级闭环判定（D11/D15）", async () => {
        await addTask({
          van: "DV2607A",
          title: "带挂名件",
          requester: "张三",
          owners: [
            { name: "丰智娟", points: 3 },
            { name: "刘洋", points: 0 },
          ],
        });
        const [t] = await listTasksByVan("DV2607A");
        await setOwnerDone(t.id, "刘洋", true, "2026-07-18");
        const [mid] = await listTasksByVan("DV2607A");
        expect(mid.status).toBe("todo"); // 挂名的勾不算闭环信号
        expect(mid.owners.find((o) => o.name === "刘洋")!.doneAt).toBe(
          "2026-07-18",
        );
        await setOwnerDone(t.id, "丰智娟", true, "2026-07-20");
        const [after] = await listTasksByVan("DV2607A");
        expect(after.status).toBe("done");
        expect(after.doneAt).toBe("2026-07-20");
      });

      it("无 owner 的件件级字段完全手动，聚合不降级（D12）", async () => {
        await addTask({ van: "DV2607A", title: "无主件" });
        const [t] = await listTasksByVan("DV2607A");
        const list = await updateTask(t.id, {
          status: "done",
          doneAt: "2026-07-18",
        });
        expect(list[0].status).toBe("done");
        expect(list[0].doneAt).toBe("2026-07-18");
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
