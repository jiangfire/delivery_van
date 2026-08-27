import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { VAN_CODE_RE } from "../contracts/vans";
import { RARITIES } from "../db/schema";
import {
  addMember,
  addTask,
  carryOver,
  dispatchVan,
  listMembers,
  listTasksByVan,
  listVans,
  removeTask,
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

export const vanRouter = createRouter({
  /* ── 班次（手动发新车） ── */
  vans: createRouter({
    list: publicQuery.query(() => listVans()),
    dispatch: publicQuery
      .input(z.object({}).optional())
      .mutation(() => dispatchVan()),
  }),

  /* ── 成员 ── */
  members: createRouter({
    list: publicQuery.query(() => listMembers()),
    add: publicQuery
      .input(
        z.object({
          name: memberTag,
          capacity: z.number().int().min(0).max(14).default(10),
        }),
      )
      .mutation(({ input }) => addMember(input.name, input.capacity)),
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
          requester: z.string().max(64).optional(),
          owners: z.array(memberTag).optional(),
          size: sizePoints.nullable().optional(),
          acceptance: z.string().max(255).nullable().optional(),
        }),
      )
      .mutation(({ input }) => addTask(input)),
    update: publicQuery
      .input(
        z.object({
          id: idField,
          title: z.string().min(1).max(255).optional(),
          rarity: rarity.optional(),
          requester: z.string().max(64).nullable().optional(),
          owners: z.array(memberTag).optional(),
          size: sizePoints.nullable().optional(),
          acceptance: z.string().max(255).nullable().optional(),
          status: z.enum(["todo", "doing", "done"]).optional(),
          doneAt: z.string().nullable().optional(),
          note: z.string().max(255).nullable().optional(),
        }),
      )
      .mutation(({ input }) => {
        const { id, ...patch } = input;
        return updateTask(id, patch);
      }),
    remove: publicQuery
      .input(z.object({ id: idField }))
      .mutation(({ input }) => removeTask(input.id)),
  }),

  /* ── 结转与统计 ── */
  carry: createRouter({
    run: publicQuery
      .input(z.object({ fromVan: vanCode, toVan: vanCode }))
      .mutation(({ input }) => carryOver(input.fromVan, input.toVan)),
  }),
  stats: createRouter({
    byVan: publicQuery
      .input(z.object({ van: vanCode }))
      .query(({ input }) => weeklyStats(input.van)),
  }),
});
