import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { VAN_CODE_RE } from "../contracts/vans";
import { CARRY_REASONS, SOURCES } from "../contracts/enums";
import { RARITIES } from "../db/schema";
import {
  addMember,
  addTask,
  carryOver,
  confirmTask,
  dispatchVan,
  listMembers,
  listTasksByVan,
  listVans,
  removeTask,
  reorderTasks,
  updateMemberCapacity,
  updateTask,
  weeklyStats,
} from "./queries/van";

const vanCode = z
  .string()
  .regex(VAN_CODE_RE, "班次编码格式应为 DV2607A（年+月+当月第几班）");
/** 半天点数制：1 点 = 半天，只允许 1~10 整数（10 点 = 5 天） */
export const sizePoints = z.number().int().min(1).max(10);
const idField = z.number().int().positive();
const rarity = z.enum(RARITIES);
/** 快件来源（三方占比口径，v2.0） */
export const sourceField = z.enum(SOURCES);
/** 结转原因五枚举（v2.0 WP5；swap 让位原因 Phase 2 另加） */
export const carryReasonField = z.enum(CARRY_REASONS);
/** 操作人标签（软身份，缺省 '(unknown)'，链式审计日志用） */
const actorField = z.string().trim().max(64).optional();

/**
 * 成员/负责人标签的统一约束：trim 后 1~64 字符，且不含半角逗号——
 * 负责人列表读取时用逗号分隔聚合（group_concat），含逗号会错拆标签。
 */
export const memberTag = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((v) => !v.includes(","), "名称不能包含半角逗号「,」");

/**
 * 提出人标签：非空 1~64 字符。空串会让「requester IS NULL = 自驱件视同签收」
 * 的推导失效——件永久计入未签收统计且 UI 无签收入口，故服务端拒绝（v2.2 评审补强）。
 */
export const requesterField = z.string().min(1).max(64);

/**
 * 送达日期：YYYY-MM-DD（前端日期编辑器产出；mysql 列为 varchar(16)，超长/错格式
 * 会裸报数据库错误，故服务端统一强制格式——v2.2 评审补强）。
 */
export const doneAtField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "送达日期格式应为 YYYY-MM-DD");

export const vanRouter = createRouter({
  /* ── 班次（手动发新车） ── */
  vans: createRouter({
    list: publicQuery.query(() => listVans()),
    dispatch: publicQuery
      .input(z.object({ actor: actorField }).optional())
      .mutation(({ input }) => dispatchVan(new Date(), input?.actor)),
  }),

  /* ── 成员 ── */
  members: createRouter({
    list: publicQuery.query(() => listMembers()),
    add: publicQuery
      .input(
        z.object({
          name: memberTag,
          capacity: z.number().int().min(0).max(14).default(10),
          actor: actorField,
        }),
      )
      .mutation(({ input }) =>
        addMember(input.name, input.capacity, input.actor),
      ),
    setCapacity: publicQuery
      .input(
        z.object({ id: idField, capacity: z.number().int().min(0).max(14) }),
      )
      .mutation(({ input }) => updateMemberCapacity(input.id, input.capacity)),
  }),

  /* ── 快件 ── */
  tasks: createRouter({
    byVan: publicQuery
      .input(z.object({ van: vanCode }))
      .query(({ input }) => listTasksByVan(input.van)),
    add: publicQuery
      .input(
        z.object({
          van: vanCode,
          title: z.string().min(1).max(255),
          rarity: rarity.default("n"),
          requester: requesterField.optional(),
          owners: z.array(memberTag).optional(),
          size: sizePoints.nullable().optional(),
          acceptance: z.string().max(255).nullable().optional(),
          source: sourceField.optional(),
          actor: actorField,
        }),
      )
      .mutation(({ input }) => addTask(input)),
    update: publicQuery
      .input(
        z.object({
          id: idField,
          title: z.string().min(1).max(255).optional(),
          rarity: rarity.optional(),
          requester: requesterField.nullable().optional(),
          owners: z.array(memberTag).optional(),
          size: sizePoints.nullable().optional(),
          acceptance: z.string().max(255).nullable().optional(),
          status: z.enum(["todo", "doing", "done"]).optional(),
          doneAt: doneAtField.nullable().optional(),
          note: z.string().max(255).nullable().optional(),
          source: sourceField.optional(),
          actor: actorField,
        }),
      )
      .mutation(({ input }) => {
        const { id, actor, ...patch } = input;
        return updateTask(id, patch, actor);
      }),
    remove: publicQuery
      .input(z.object({ id: idField, actor: actorField }))
      .mutation(({ input }) => removeTask(input.id, input.actor)),
    reorder: publicQuery
      .input(
        z.object({
          van: vanCode,
          ids: z.array(idField).max(1000),
          actor: actorField,
        }),
      )
      .mutation(({ input }) => reorderTasks(input.van, input.ids, input.actor)),
    /* 签收制（v2.0 WP3）：done 后由提出人一次点击签收 */
    confirm: publicQuery
      .input(z.object({ taskId: idField, actor: memberTag }))
      .mutation(({ input }) => confirmTask(input.taskId, input.actor)),
  }),

  /* ── 结转与统计 ── */
  carry: createRouter({
    run: publicQuery
      .input(
        z.object({
          fromVan: vanCode,
          toVan: vanCode,
          carryReason: carryReasonField.optional(),
          actor: actorField,
        }),
      )
      .mutation(({ input }) =>
        carryOver(input.fromVan, input.toVan, new Date(), {
          actor: input.actor,
          carryReason: input.carryReason,
        }),
      ),
  }),
  stats: createRouter({
    byVan: publicQuery
      .input(z.object({ van: vanCode }))
      .query(({ input }) => weeklyStats(input.van)),
  }),
});
