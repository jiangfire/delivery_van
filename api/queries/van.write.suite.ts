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
  weeklyStats,
} from "./van";
import { addSource, listSources, removeSource, renameSource } from "./sources";
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
        await addMember("张三", 10); // 提出人兼负责人
        await addMember("李四", 10); // 签收人
        await addTask({
          van: "DV2607A",
          title: "甲",
          requester: "张三",
          owners: [{ name: "张三", points: 3 }],
        });
        const [t] = await listTasksByVan("DV2607A");
        await updateTask(t.id, { status: "done" });
        await confirmTask(t.id, "张三", "李四");
        await expect(removeMember("李四")).rejects.toThrow("不可删除");
      });

      it("部分签收中当签收人的成员不可删除（v2.6 逐人签收叶子）", async () => {
        await addMember("张三", 10); // 提出人兼负责人
        await addMember("李四", 10); // 签收人（非负责人）
        await addTask({
          van: "DV2607A",
          title: "甲",
          requester: "张三",
          owners: [
            { name: "张三", points: 3 },
            { name: "王五", points: 2 },
          ],
        });
        const [t] = await listTasksByVan("DV2607A");
        // 只交付并签收其中一人 → 件级 confirmed_* 仍为 NULL，签收人名只在叶子上
        await setOwnerDone(t.id, "张三", true, "2026-08-28");
        await confirmTask(t.id, "张三", "李四");
        expect((await listTasksByVan("DV2607A"))[0].confirmedAt).toBeNull();
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
        await expect(setOwnerDone(id, "李子烨", true)).rejects.toThrow("归档");
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

      it("手动把有已交付份额的件改回未开始，会被聚合收回 doing（不变量）", async () => {
        const id = await seedMulti();
        await setOwnerDone(id, "丰智娟", true, "2026-07-18");
        const list = await updateTask(id, { status: "todo" });
        expect(list[0].status).toBe("doing");
        expect(list[0].owners.find((o) => o.name === "丰智娟")!.doneAt).toBe(
          "2026-07-18",
        );
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

    describe("放弃状态（v2.7 drop）", () => {
      it("todo 可标放弃、可恢复；审计记两笔 status 变更", async () => {
        await addTask({ van: "DV2607A", title: "甲" });
        const [t] = await listTasksByVan("DV2607A");
        let list = await updateTask(t.id, { status: "drop" });
        expect(list[0].status).toBe("drop");
        expect(list[0].doneAt).toBeNull();
        list = await updateTask(t.id, { status: "todo" });
        expect(list[0].status).toBe("todo");
        const rows = await ctx.db().select().from(S.auditLog);
        const flips = rows
          .filter((a) => a.entity === "task" && a.field === "status")
          .map((a) => [a.oldValue, a.newValue]);
        expect(flips).toContainEqual(["todo", "drop"]);
        expect(flips).toContainEqual(["drop", "todo"]);
      });

      it("已送达的件不能放弃（D25）", async () => {
        await addTask({ van: "DV2607A", title: "甲" });
        const [t] = await listTasksByVan("DV2607A");
        await updateTask(t.id, { status: "done" });
        await expect(updateTask(t.id, { status: "drop" })).rejects.toThrow(
          "不能放弃",
        );
      });

      it("drop 件上拒绝逐人完成（D26）", async () => {
        await addMember("张三", 10);
        await addTask({
          van: "DV2607A",
          title: "甲",
          owners: [{ name: "张三", points: 3 }],
        });
        const [t] = await listTasksByVan("DV2607A");
        await updateTask(t.id, { status: "drop" });
        await expect(setOwnerDone(t.id, "张三", true)).rejects.toThrow(
          "已放弃",
        );
      });

      it("drop 彻底出清：不进统计分母（D28）", async () => {
        await addTask({ van: "DV2607A", title: "甲" });
        await addTask({ van: "DV2607A", title: "乙" });
        const [甲, 乙] = await listTasksByVan("DV2607A");
        await updateTask(乙.id, { status: "done" });
        await updateTask(甲.id, { status: "drop" });
        const stats = await weeklyStats("DV2607A");
        expect(stats.total).toBe(1);
        expect(stats.done).toBe(1);
        expect(stats.remaining).toBe(0);
        expect(stats.completionRate).toBe(1);
        expect(stats.loadPoints).toBe(0); // 未指派件本就 0 点
      });

      it("结转不带走 drop 件：留在原班保持 drop（D27）", async () => {
        await addTask({ van: "DV2607A", title: "留班弃置" });
        await addTask({ van: "DV2607A", title: "正常滞留" });
        const [甲, 乙] = await listTasksByVan("DV2607A");
        await updateTask(甲.id, { status: "drop" });
        const carry = await carryOver(
          "DV2607A",
          "DV2607B",
          new Date(2026, 6, 20),
        );
        expect(carry.carried).toBe(1); // 只有 todo 件跟车
        const src = await listTasksByVan("DV2607A");
        expect(src.find((x) => x.title === "留班弃置")?.status).toBe("drop");
        expect(src.find((x) => x.title === "正常滞留")?.status).toBe("carried");
        expect((await listTasksByVan("DV2607B")).map((x) => x.title)).toEqual([
          "正常滞留",
        ]);
        expect(乙.status).toBe("todo");
      });

      it("drop 件上直接完成/补录日期被拒（先恢复，双向守卫）", async () => {
        await addTask({
          van: "DV2607A",
          title: "甲",
          owners: [{ name: "张三", points: 3 }],
        });
        const [t] = await listTasksByVan("DV2607A");
        await updateTask(t.id, { status: "drop" });
        await expect(updateTask(t.id, { status: "done" })).rejects.toThrow(
          "请先恢复",
        );
        await expect(
          updateTask(t.id, { doneAt: "2026-07-20" }),
        ).rejects.toThrow("请先恢复");
        // 守卫挡在叶子写之前：全体 done_at 保持空，不存在「drop 且叶子全齐」
        const after = (await listTasksByVan("DV2607A"))[0];
        expect(after.status).toBe("drop");
        expect(after.owners.every((o) => o.doneAt === null)).toBe(true);
        expect(after.doneAt).toBeNull();
      });

      it("drop 件上拒绝签收（D26）", async () => {
        await addMember("张三", 10);
        await addMember("李四", 10);
        await addMember("产品", 10);
        await addTask({
          van: "DV2607A",
          title: "甲",
          requester: "产品",
          // 双人件：一人交付后件级是 doing（不是 done），仍可放弃
          owners: [
            { name: "张三", points: 3 },
            { name: "李四", points: 2 },
          ],
        });
        const [t] = await listTasksByVan("DV2607A");
        await setOwnerDone(t.id, "张三", true);
        await updateTask(t.id, { status: "drop" });
        await expect(confirmTask(t.id, "张三", "产品")).rejects.toThrow(
          "已放弃",
        );
      });

      it("只有 done + drop 件的班结转：零滞留跟车、原班不归档", async () => {
        await addTask({ van: "DV2607A", title: "已送达" });
        await addTask({ van: "DV2607A", title: "已放弃" });
        const [甲, 乙] = await listTasksByVan("DV2607A");
        await updateTask(甲.id, { status: "done" });
        await updateTask(乙.id, { status: "drop" });
        const carry = await carryOver(
          "DV2607A",
          "DV2607B",
          new Date(2026, 6, 20),
        );
        expect(carry.carried).toBe(0);
        // 原班无 carried 任务 → 不归档，drop 件仍可手动恢复
        const list = await updateTask(乙.id, { status: "todo" });
        expect(list.find((x) => x.title === "已放弃")?.status).toBe("todo");
      });
    });

    describe("需求类型管理（v2.7 sources）", () => {
      it("内置三项由种子保证存在，内置在前", async () => {
        const list = await listSources();
        expect(list.map((x) => x.code)).toEqual([
          "customer",
          "platform",
          "exploration",
        ]);
        expect(list.every((x) => x.builtIn)).toBe(true);
      });

      it("新增自定义类型（code == 显示名）并可被快件选用、进统计桶", async () => {
        await addSource("运营", "管理员");
        await addTask({ van: "DV2607A", title: "甲", source: "运营" });
        const [t] = await listTasksByVan("DV2607A");
        expect(t.source).toBe("运营");
        const stats = await weeklyStats("DV2607A");
        expect(stats.source.find((x) => x.source === "运营")?.total).toBe(1);
      });

      it("重名拒绝（CONFLICT，撞 code 或 label 同罪）", async () => {
        await addSource("运营");
        await expect(addSource("运营")).rejects.toThrow("已存在");
      });

      it("新增撞他人 label（如内置显示名）拒绝；改名撞他人 label 拒绝", async () => {
        // 内置 customer 的 label 是「客户」：新类型想叫「客户」→ 撞 label 唯一约束
        await expect(addSource("客户")).rejects.toThrow("已存在");
        await addSource("运营");
        await expect(renameSource("运营", "客户")).rejects.toThrow("占用");
      });

      it("改名只动 label：历史件零迁移（code 不变）", async () => {
        await addSource("运营");
        await addTask({ van: "DV2607A", title: "甲", source: "运营" });
        await renameSource("运营", "运营需求");
        const [t] = await listTasksByVan("DV2607A");
        expect(t.source).toBe("运营");
        expect(
          (await listSources()).find((x) => x.code === "运营")?.label,
        ).toBe("运营需求");
      });

      it("内置可改名不可删", async () => {
        await renameSource("customer", "甲方");
        await expect(removeSource("customer")).rejects.toThrow("不可删除");
        expect(
          (await listSources()).find((x) => x.code === "customer")?.label,
        ).toBe("甲方");
      });

      it("有引用的类型不可删（报引用数），零引用可删", async () => {
        await addSource("运营");
        await addTask({ van: "DV2607A", title: "甲", source: "运营" });
        await expect(removeSource("运营")).rejects.toThrow("1 个快件");
        const [t] = await listTasksByVan("DV2607A");
        await removeTask(t.id);
        await removeSource("运营");
        expect((await listSources()).map((x) => x.code)).not.toContain("运营");
      });

      it("快件选用不存在的类型被拒（值域校验在数据层，列出可用值）", async () => {
        await addTask({ van: "DV2607A", title: "甲" });
        const [t] = await listTasksByVan("DV2607A");
        await expect(
          addTask({ van: "DV2607A", title: "乙", source: "幽灵" }),
        ).rejects.toThrow("需求类型「幽灵」不存在");
        await expect(updateTask(t!.id, { source: "幽灵" })).rejects.toThrow(
          "不存在",
        );
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
