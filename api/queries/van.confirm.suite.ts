/* v2.0 Phase 1 数据层行为套件（WP3 签收制 / WP5 结转原因 / WP2 审计接线 / weeklyStats 扩展）：
 * 同一份用例跑三个方言变体——sqlite 内存库（van.confirm.test.ts）与
 * pg/mysql CI 容器（dialect.pg.test.ts / dialect.mysql.test.ts）。
 * pg/mysql 容器库自增序号跨用例不复位：取 id 一律走 insertReturningId。 */
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  addMember,
  addTask,
  carryOver,
  confirmTask,
  dispatchVan,
  listTasksByVan,
  setOwnerDone,
  updateTask,
  weeklyStats,
} from "./van";
import { verifyAuditChain } from "./audit";
import { insertReturningId } from "./dialect";
import { todayStr } from "../../contracts/vans";
import { taskPointsOf } from "../../contracts/points";
import type { DataLayerCtx } from "./dialectHarness";

export function registerConfirmSuite(ctx: DataLayerCtx) {
  const { S } = ctx;

  describe("v2 签收与博弈机制", () => {
    beforeEach(async () => {
      await ctx.db().insert(S.vans).values({ code: "DV2607A" });
      // 直接落库造成员，避免 addMember 的审计条目污染各用例的链断言
      await ctx.db().insert(S.members).values({ name: "张三", capacity: 10 });
    });

    /** 两人件（张三 3 / 李四 2），默认都没交；requester 缺省 null = 自驱件 */
    async function seedTwoOwners(requester?: string) {
      const id = await insertReturningId(ctx.db(), S.tasks, {
        vanCode: "DV2607A",
        title: "客户看板",
        status: "todo",
        requester: requester ?? null,
      });
      await ctx.db().insert(S.taskOwners).values([
        { taskId: id, ownerName: "张三", points: 3 },
        { taskId: id, ownerName: "李四", points: 2 },
      ]);
      return id;
    }

    describe("签收制（v2.6 逐人）", () => {
      it("逐人签收：只签该人的交付，件级未全签时 confirmed_* 仍为空", async () => {
        await ctx.db().insert(S.members).values({ name: "李四", capacity: 10 });
        const id = await seedTwoOwners("张三");
        await setOwnerDone(id, "张三", true, "2026-08-27");
        await setOwnerDone(id, "李四", true, "2026-08-28");

        const list = await confirmTask(id, "张三", "张三");

        const [t] = list;
        expect(t.owners.find((o) => o.name === "张三")!.confirmedAt).toBe(
          todayStr(),
        );
        expect(t.owners.find((o) => o.name === "李四")!.confirmedAt).toBeNull();
        expect(t.confirmedAt).toBeNull(); // 未全签
        const rec = (
          await ctx.db().select().from(S.auditLog).orderBy(S.auditLog.id)
        )
          .filter((r) => r.field === "owner:张三")
          .at(-1);
        expect(rec?.actor).toBe("张三");
        expect(JSON.parse(rec!.newValue!).confirmedAt).toBe(todayStr());
      });

      it("参与判定全体签完 → 件级 confirmed_* 写入", async () => {
        await ctx.db().insert(S.members).values({ name: "李四", capacity: 10 });
        const id = await seedTwoOwners("张三");
        await setOwnerDone(id, "张三", true, "2026-08-27");
        await setOwnerDone(id, "李四", true, "2026-08-28");
        await confirmTask(id, "张三", "张三");
        const list = await confirmTask(id, "李四", "李四");

        const [t] = list;
        expect(t.confirmedAt).toBe(todayStr());
        expect(["张三", "李四"]).toContain(t.confirmedBy);
      });

      it("未交付的份额不可签收", async () => {
        const id = await seedTwoOwners("张三");
        await expect(confirmTask(id, "张三", "张三")).rejects.toThrow(TRPCError);
        await expect(confirmTask(id, "张三", "张三")).rejects.toThrow(
          "尚未交付",
        );
      });

      it("归档班次（已结转）不可签收", async () => {
        const id = await seedTwoOwners("张三");
        await setOwnerDone(id, "张三", true, "2026-08-27");
        await ctx.db().insert(S.tasks).values({
          vanCode: "DV2607A",
          title: "滞留件",
          status: "todo",
          requester: "张三",
        });
        await carryOver("DV2607A", "DV2607B", new Date(2026, 6, 20));

        await expect(confirmTask(id, "张三", "张三")).rejects.toThrow(TRPCError);
        await expect(confirmTask(id, "张三", "张三")).rejects.toThrow("归档");
      });

      it("签收人必须是成员", async () => {
        const id = await seedTwoOwners("张三");
        await setOwnerDone(id, "张三", true, "2026-08-27");
        await expect(confirmTask(id, "张三", "路人甲")).rejects.toThrow(
          TRPCError,
        );
        await expect(confirmTask(id, "张三", "路人甲")).rejects.toThrow(
          "不是团队成员",
        );
      });

      it("幂等重签：不覆盖首签信息", async () => {
        await ctx.db().insert(S.members).values({ name: "李四", capacity: 10 });
        const id = await seedTwoOwners("张三");
        await setOwnerDone(id, "张三", true, "2026-08-27");
        await confirmTask(id, "张三", "张三");
        const list = await confirmTask(id, "张三", "李四"); // 再签不覆盖

        expect(
          list[0].owners.find((o) => o.name === "张三")!.confirmedBy,
        ).toBe("张三");
      });

      it("无提出人的自驱件不写库直接视同签收：confirm 成功且 confirmed_* 保持 NULL", async () => {
        const id = await seedTwoOwners(); // requester = null
        // 直接落库置已交付，避免 setOwnerDone 的审计条目干扰断言
        await ctx
          .db()
          .update(S.taskOwners)
          .set({ doneAt: "2026-08-28" })
          .where(
            and(
              eq(S.taskOwners.taskId, id),
              eq(S.taskOwners.ownerName, "张三"),
            ),
          );
        const list = await confirmTask(id, "张三", "张三");
        const [t] = list;
        expect(t.owners.find((o) => o.name === "张三")!.confirmedAt).toBeNull();
        expect(t.confirmedAt).toBeNull();
        // 不写库也不写审计（能推导不落库）
        expect(await ctx.db().select().from(S.auditLog)).toHaveLength(0);
      });

      it("任务不存在抛 NOT_FOUND", async () => {
        await expect(confirmTask(999, "张三", "张三")).rejects.toThrow(
          TRPCError,
        );
      });

      it("取消某人完成 → 只作废该人签收，他人签收保留，件级签收失效", async () => {
        await ctx.db().insert(S.members).values({ name: "李四", capacity: 10 });
        const id = await seedTwoOwners("张三");
        await setOwnerDone(id, "张三", true, "2026-08-27");
        await setOwnerDone(id, "李四", true, "2026-08-28");
        await confirmTask(id, "张三", "张三");
        await confirmTask(id, "李四", "李四");
        expect((await listTasksByVan("DV2607A"))[0].confirmedAt).not.toBeNull();

        await setOwnerDone(id, "张三", false);
        let [t] = await listTasksByVan("DV2607A");
        expect(t.owners.find((o) => o.name === "张三")!.confirmedAt).toBeNull();
        expect(
          t.owners.find((o) => o.name === "李四")!.confirmedAt,
        ).not.toBeNull();
        expect(t.confirmedAt).toBeNull(); // 件级签收失效
        expect(t.status).toBe("doing");

        // 重新送达 → 该人需重新签收（不沿用旧签收）
        await setOwnerDone(id, "张三", true, "2026-08-29");
        [t] = await listTasksByVan("DV2607A");
        expect(t.owners.find((o) => o.name === "张三")!.confirmedAt).toBeNull();
        expect(t.status).toBe("done");
      });
    });

    describe("结转原因（WP5）", () => {
      it("结转带原因：源班 carried 行与目标班副本都带 carry_reason", async () => {
        await ctx.db().insert(S.tasks).values({
          vanCode: "DV2607A",
          title: "滞留件",
          status: "todo",
          requester: "张三",
        });

        await carryOver("DV2607A", "DV2607B", new Date(2026, 6, 20), {
          carryReason: "blocker",
        });

        const [src] = await listTasksByVan("DV2607A");
        expect(src.status).toBe("carried");
        expect(src.carryReason).toBe("blocker");
        const [copy] = await listTasksByVan("DV2607B");
        expect(copy.title).toBe("滞留件");
        expect(copy.carryReason).toBe("blocker");
        expect(copy.carriedFrom).toBe("DV2607A");
      });

      it("不选原因则保持 NULL（未分类）", async () => {
        await ctx
          .db()
          .insert(S.tasks)
          .values({ vanCode: "DV2607A", title: "滞留件", status: "todo" });

        await carryOver("DV2607A", "DV2607B", new Date(2026, 6, 20));

        const [copy] = await listTasksByVan("DV2607B");
        expect(copy.carryReason).toBeNull();
      });
    });

    describe("每人点数随件搬运（v2.5）", () => {
      it("结转时各负责人的点数各自原样搬到下一班，任务点数 = 各人之和", async () => {
        const id = await insertReturningId(ctx.db(), S.tasks, {
          vanCode: "DV2607A",
          title: "多人滞留件",
          status: "doing",
        });
        await ctx
          .db()
          .insert(S.taskOwners)
          .values([
            { taskId: id, ownerName: "张三", points: 3 },
            { taskId: id, ownerName: "李四", points: 2 },
          ]);

        await carryOver("DV2607A", "DV2607B", new Date(2026, 6, 20), {
          actor: "张三",
        });

        const [copy] = await listTasksByVan("DV2607B");
        expect(copy.owners).toEqual([
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
        expect(taskPointsOf(copy.owners)).toBe(5);
      });

      it("部分完成件结转：已完成份额保持完成/已签收，未完成份额为空（D3）", async () => {
        await ctx.db().insert(S.members).values({ name: "李四", capacity: 10 });
        const id = await seedTwoOwners("张三"); // 张三 3 / 李四 2
        await setOwnerDone(id, "张三", true, "2026-08-27");
        await confirmTask(id, "张三", "张三");

        await carryOver("DV2607A", "DV2607B", new Date(2026, 6, 20));

        const [copy] = await listTasksByVan("DV2607B");
        const zhang = copy.owners.find((o) => o.name === "张三")!;
        const li = copy.owners.find((o) => o.name === "李四")!;
        // 已交付已签收的份额随件转运，不重做
        expect(zhang.doneAt).toBe("2026-08-27");
        expect(zhang.confirmedAt).toBe(todayStr());
        expect(zhang.confirmedBy).toBe("张三");
        // 未完成份额仍为空
        expect(li.doneAt).toBeNull();
        expect(li.confirmedAt).toBeNull();
        // 装载仍是承诺量（含已交付份额）
        expect(taskPointsOf(copy.owners)).toBe(5);
        // 源班 owner 行原样保留（历史事实）
        const [src] = await listTasksByVan("DV2607A");
        expect(src.owners.find((o) => o.name === "张三")!.doneAt).toBe(
          "2026-08-27",
        );
      });
    });

    describe("审计接线（WP2：写操作出口全部进链）", () => {
      it("发车/新增成员/新增快件/编辑/完成/签收/结转全部留痕，全链 verify 通过", async () => {
        // 发新车（第二班）+ 新增成员：覆盖 van / member 两类 entity
        await dispatchVan(new Date(2026, 6, 20), "张三");
        await addMember("李四", 10, "张三");
        // 新增快件（带负责人与来源）
        const list = await addTask({
          van: "DV2607A",
          title: "新快件",
          requester: "张三",
          owners: [{ name: "张三", points: 3 }],
          source: "platform",
          actor: "张三",
        });
        const id = list[0].id;
        // 编辑：完成 + 补送达日期
        await updateTask(id, { status: "done", doneAt: "2026-08-29" }, "张三");
        // 签收（逐人）
        await confirmTask(id, "张三", "张三");
        // 结转另一件滞留件
        await ctx
          .db()
          .insert(S.tasks)
          .values({ vanCode: "DV2607A", title: "滞留件", status: "todo" });
        await carryOver("DV2607A", "DV2607B", new Date(2026, 6, 20), {
          actor: "张三",
          carryReason: "capacity",
        });

        const rows = await ctx
          .db()
          .select()
          .from(S.auditLog)
          .orderBy(S.auditLog.id);
        expect(rows.length).toBeGreaterThanOrEqual(5);
        expect(rows.map((r) => r.entity)).toContain("task");
        // 全链校验通过（读链尾→算 hash→插入的串行链无断点）
        expect(verifyAuditChain(rows)).toBeNull();
        // actor 软身份贯穿
        expect(new Set(rows.map((r) => r.actor))).toEqual(new Set(["张三"]));
      });

      it("未提供 actor 时记 '(unknown)'，敏感自由文本（note）以占位符进链", async () => {
        const list = await addTask({ van: "DV2607A", title: "甲" });
        await updateTask(list[0].id, { note: "内部吐槽，不该进链" });

        const rows = await ctx
          .db()
          .select()
          .from(S.auditLog)
          .orderBy(S.auditLog.id);
        expect(rows.every((r) => r.actor === "(unknown)")).toBe(true);
        const noteEntry = rows.find((r) => r.field === "note");
        // 原无备注 → oldValue null；新内容以占位符进链，不落原文
        expect(noteEntry?.oldValue).toBeNull();
        expect(noteEntry?.newValue).toBe("(text)");
        expect(JSON.stringify(rows)).not.toContain("内部吐槽");
      });
    });

    describe("weeklyStats v2 扩展", () => {
      it("返回记分卡/通胀/三方/未签收/昨日天气/徽章/原因瀑布/日志指纹", async () => {
        // 第二班：承接结转 + 本班新件
        await ctx.db().insert(S.vans).values({ code: "DV2607B" });
        // 上一班：done 3 点（昨日天气）+ 滞留件（结转进 B）
        const prevDoneId = await insertReturningId(ctx.db(), S.tasks, {
          vanCode: "DV2607A",
          title: "上班完成件",
          status: "done",
          doneAt: "2026-08-28",
          requester: "张三",
          confirmedAt: "2026-08-28",
          confirmedBy: "(历史)",
        });
        await insertReturningId(ctx.db(), S.tasks, {
          vanCode: "DV2607A",
          title: "上班滞留件",
          status: "todo",
          requester: "张三",
        });
        // 本班：done 未签收 + carried 结转件
        const curDoneId = await insertReturningId(ctx.db(), S.tasks, {
          vanCode: "DV2607B",
          title: "本班完成件",
          status: "done",
          doneAt: "2026-08-29",
          requester: "张三",
          source: "platform",
          rarity: "ur",
        });
        await ctx
          .db()
          .insert(S.taskOwners)
          .values([
            // v2.5 每人点数制：点数记在负责人行上（张三上一班 3 点、本班 4 点）
            { taskId: prevDoneId, ownerName: "张三", points: 3 },
            { taskId: curDoneId, ownerName: "张三", points: 4 }, // 本班完成件也归张三 → 两班零滞留点亮连击
          ]);
        await carryOver("DV2607A", "DV2607B", new Date(2026, 6, 20), {
          actor: "张三",
          carryReason: "estimate",
        });

        const s = await weeklyStats("DV2607B");

        // 未签收：本班 done 且有提出人且未签 = 1
        expect(s.unconfirmed).toBe(1);
        // 昨日天气：上一班（DV2607A）done 件点数 = 3
        expect(s.suggestedLoad).toBe(3);
        // 三方占比：本班 platform 1 件、customer 1 件（结转件默认 customer）
        const bySrc = Object.fromEntries(
          s.source.map((x) => [x.source, x.total]),
        );
        expect(bySrc).toEqual({ customer: 1, platform: 1, exploration: 0 });
        // 记分卡：本班张三 2 件（done 未签收 + 结转副本 n），均不满足签收口径 → delivered 0
        expect(s.requester.find((r) => r.requester === "张三")).toMatchObject({
          total: 2,
          delivered: 0,
          urSsrRate: 0.5,
        });
        // 原因瀑布：统计「本班结转出去」的原因（与滞留率口径一致）→ 源班 DV2607A 可见
        const prev = await weeklyStats("DV2607A");
        expect(prev.carryReasons).toEqual([{ reason: "estimate", count: 1 }]);
        expect(s.carryReasons).toEqual([]);
        // 徽章：本班有 carried 件 → 整班准点不亮；张三最近两班均零滞留 → 连击点亮
        expect(s.badges.teamPunctual).toBe(false);
        expect(s.badges.streaks).toContain("张三");
        // 日志指纹：结转已进链，链头 hash 前 8 位
        expect(s.auditFingerprint).toMatch(/^[0-9a-f]{8}$/);
      });

      it("多人件按各人各自的那份计入个人已装（不再每人各计全量）", async () => {
        await ctx.db().insert(S.vans).values({ code: "DV2607B" });
        await ctx.db().insert(S.members).values({ name: "李四", capacity: 10 });
        const id = await insertReturningId(ctx.db(), S.tasks, {
          vanCode: "DV2607B",
          title: "多人件",
          status: "todo",
        });
        await ctx
          .db()
          .insert(S.taskOwners)
          .values([
            { taskId: id, ownerName: "张三", points: 3 },
            { taskId: id, ownerName: "李四", points: 2 },
          ]);

        const s = await weeklyStats("DV2607B");
        const assigned = Object.fromEntries(
          s.members.map((m) => [m.name, m.assigned]),
        );
        // 一件 5 点、两人参加：旧口径「每人各计全量」会给张三 5、李四 5（个人合计 10 点）
        expect(assigned["张三"]).toBe(3);
        expect(assigned["李四"]).toBe(2);
        // 整车装载 = 各负责人点数之和 = 这件快件的 5 点
        expect(s.loadPoints).toBe(5);
      });

      it("负责人页签补「已交付 x / y 点」：只算该人已完成的份额（v2.6/D5）", async () => {
        await ctx.db().insert(S.vans).values({ code: "DV2607B" });
        await ctx.db().insert(S.members).values({ name: "李四", capacity: 10 });
        const id = await insertReturningId(ctx.db(), S.tasks, {
          vanCode: "DV2607B",
          title: "多人件",
          status: "todo",
        });
        await ctx
          .db()
          .insert(S.taskOwners)
          .values([
            { taskId: id, ownerName: "张三", points: 3, doneAt: "2026-08-28" },
            { taskId: id, ownerName: "李四", points: 2 },
          ]);

        const s = await weeklyStats("DV2607B");
        const byName = Object.fromEntries(s.members.map((m) => [m.name, m]));
        expect(byName["张三"].deliveredPoints).toBe(3);
        expect(byName["张三"].assigned).toBe(3);
        expect(byName["李四"].deliveredPoints).toBe(0);
        expect(byName["李四"].assigned).toBe(2);
      });

      it("空库班次：指纹 null、昨日天气 null、三方零桶", async () => {
        const s = await weeklyStats("DV2607A");
        expect(s.auditFingerprint).toBeNull();
        expect(s.suggestedLoad).toBeNull();
        expect(s.source.every((x) => x.total === 0)).toBe(true);
        expect(s.badges.teamPunctual).toBe(false);
      });
    });
  });
}
