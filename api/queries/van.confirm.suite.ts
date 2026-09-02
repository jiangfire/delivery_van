/* v2.0 Phase 1 数据层行为套件（WP3 签收制 / WP5 结转原因 / WP2 审计接线 / weeklyStats 扩展）：
 * 同一份用例跑三个方言变体——sqlite 内存库（van.confirm.test.ts）与
 * pg/mysql CI 容器（dialect.pg.test.ts / dialect.mysql.test.ts）。
 * pg/mysql 容器库自增序号跨用例不复位：取 id 一律走 insertReturningId。 */
import { beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  addMember,
  addTask,
  carryOver,
  confirmTask,
  dispatchVan,
  listTasksByVan,
  updateTask,
  weeklyStats,
} from "./van";
import { verifyAuditChain } from "./audit";
import { insertReturningId } from "./dialect";
import { todayStr } from "../../contracts/vans";
import type { DataLayerCtx } from "./dialectHarness";

export function registerConfirmSuite(ctx: DataLayerCtx) {
  const { S } = ctx;

  describe("v2 签收与博弈机制", () => {
    beforeEach(async () => {
      await ctx.db().insert(S.vans).values({ code: "DV2607A" });
      // 直接落库造成员，避免 addMember 的审计条目污染各用例的链断言
      await ctx.db().insert(S.members).values({ name: "张三", capacity: 10 });
    });

    async function seedDoneTask(requester?: string) {
      return insertReturningId(ctx.db(), S.tasks, {
        vanCode: "DV2607A",
        title: "客户看板",
        status: "done",
        doneAt: "2026-08-28",
        requester: requester ?? null,
        size: 3,
      });
    }

    describe("签收制（WP3）", () => {
      it("正常签收：done 件写入签收人与当天日期，audit 留痕", async () => {
        const id = await seedDoneTask("张三");

        const list = await confirmTask(id, "张三");

        const [t] = list;
        expect(t.confirmedBy).toBe("张三");
        expect(t.confirmedAt).toBe(todayStr());
        const rows = await ctx.db().select().from(S.auditLog);
        expect(rows).toHaveLength(1);
        expect(rows[0].field).toBe("confirm");
        expect(rows[0].newValue).toBe("张三");
      });

      it("非 done 不可签", async () => {
        const id = await insertReturningId(ctx.db(), S.tasks, {
          vanCode: "DV2607A",
          title: "进行中",
          status: "doing",
          requester: "张三",
        });
        await expect(confirmTask(id, "张三")).rejects.toThrow(TRPCError);
        await expect(confirmTask(id, "张三")).rejects.toThrow("已送达");
      });

      it("归档班次（已结转）不可签收", async () => {
        const id = await seedDoneTask("张三");
        await ctx.db().insert(S.tasks).values({
          vanCode: "DV2607A",
          title: "滞留件",
          status: "todo",
          requester: "张三",
        });
        await carryOver("DV2607A", "DV2607B", new Date(2026, 6, 20));

        await expect(confirmTask(id, "张三")).rejects.toThrow(TRPCError);
        await expect(confirmTask(id, "张三")).rejects.toThrow("归档");
      });

      it("签收人必须是成员", async () => {
        const id = await seedDoneTask("张三");
        await expect(confirmTask(id, "路人甲")).rejects.toThrow(TRPCError);
        await expect(confirmTask(id, "路人甲")).rejects.toThrow("不是团队成员");
      });

      it("幂等重签：不报错且不覆盖首签信息", async () => {
        const id = await seedDoneTask("张三");
        await addMember("李四", 10);
        await confirmTask(id, "张三");
        await confirmTask(id, "李四"); // 再签不覆盖

        const [t] = await listTasksByVan("DV2607A");
        expect(t.confirmedBy).toBe("张三");
      });

      it("无提出人的自驱件不写库直接视同签收：confirm 成功且 confirmed_* 保持 NULL", async () => {
        const id = await seedDoneTask(); // requester = null
        const list = await confirmTask(id, "张三");
        const [t] = list;
        expect(t.confirmedBy).toBeNull();
        expect(t.confirmedAt).toBeNull();
        // 不写库也不写审计（能推导不落库）
        expect(await ctx.db().select().from(S.auditLog)).toHaveLength(0);
      });

      it("任务不存在抛 NOT_FOUND", async () => {
        await expect(confirmTask(999, "张三")).rejects.toThrow(TRPCError);
      });

      it("取消完成时签收作废：confirmed_* 清空，重新送达后需重新签收", async () => {
        const id = await seedDoneTask("张三");
        await confirmTask(id, "张三");

        await updateTask(id, { status: "todo" });
        const [afterUndo] = await listTasksByVan("DV2607A");
        expect(afterUndo.status).toBe("todo");
        expect(afterUndo.doneAt).toBeNull();
        expect(afterUndo.confirmedBy).toBeNull();
        expect(afterUndo.confirmedAt).toBeNull();

        // 重新送达：回到未签收状态（不沿用旧签收，isConfirmed 口径正确）
        await updateTask(id, { status: "done" });
        const [afterRedo] = await listTasksByVan("DV2607A");
        expect(afterRedo.status).toBe("done");
        expect(afterRedo.confirmedAt).toBeNull();

        // 签收作废进审计链（留痕可对质）
        const rows = await ctx
          .db()
          .select()
          .from(S.auditLog)
          .orderBy(S.auditLog.id);
        const voided = rows.find(
          (r) => r.field === "confirm" && r.newValue === null,
        );
        expect(voided?.oldValue).toBe("张三");
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
          owners: ["张三"],
          source: "platform",
          actor: "张三",
        });
        const id = list[0].id;
        // 编辑：完成 + 补送达日期
        await updateTask(id, { status: "done", doneAt: "2026-08-29" }, "张三");
        // 签收
        await confirmTask(id, "张三");
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
          size: 3,
          requester: "张三",
          confirmedAt: "2026-08-28",
          confirmedBy: "(历史)",
        });
        await insertReturningId(ctx.db(), S.tasks, {
          vanCode: "DV2607A",
          title: "上班滞留件",
          status: "todo",
          size: 2,
          requester: "张三",
        });
        // 本班：done 未签收 + carried 结转件
        const curDoneId = await insertReturningId(ctx.db(), S.tasks, {
          vanCode: "DV2607B",
          title: "本班完成件",
          status: "done",
          doneAt: "2026-08-29",
          size: 4,
          requester: "张三",
          source: "platform",
          rarity: "ur",
        });
        await ctx
          .db()
          .insert(S.taskOwners)
          .values([
            { taskId: prevDoneId, ownerName: "张三" },
            { taskId: curDoneId, ownerName: "张三" }, // 本班完成件也归张三 → 两班零滞留点亮连击
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
