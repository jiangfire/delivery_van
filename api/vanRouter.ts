import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { VAN_CODE_RE } from "../contracts/vans";
import { RARITIES } from "../db/schema";
import {
  addMember,
  addPoolItem,
  addTask,
  carryOver,
  dispatchVan,
  listMembers,
  listPoolItems,
  listTasksByVan,
  listVans,
  removePoolItem,
  removeTask,
  updateMemberCapacity,
  updatePoolItem,
  updateTask,
  weeklyStats,
} from "./queries/van";

const vanCode = z
  .string()
  .regex(VAN_CODE_RE, "班次编码格式应为 DV2607A（年+月+当月第几班）");
const sizeTier = z.union([z.literal(1), z.literal(3), z.literal(5)]);
const idField = z.number().int().positive();
const rarity = z.enum(RARITIES);

export const vanRouter = createRouter({
  /* ── 班次（手动发新车） ── */
  vans: createRouter({
    list: publicQuery.query(() => listVans()),
    dispatch: publicQuery
      .input(z.object({}).optional())
      .mutation(() => dispatchVan()),
  }),

  /* ── 成员（表 3：产能速览的数据源） ── */
  members: createRouter({
    list: publicQuery.query(() => listMembers()),
    add: publicQuery
      .input(
        z.object({
          name: z.string().trim().min(1).max(64),
          capacity: z.number().int().min(0).max(7).default(5),
        }),
      )
      .mutation(({ input }) => addMember(input.name, input.capacity)),
    setCapacity: publicQuery
      .input(
        z.object({ id: idField, capacity: z.number().int().min(0).max(7) }),
      )
      .mutation(({ input }) => updateMemberCapacity(input.id, input.capacity)),
  }),

  /* ── 任务大厅（委托池，PM 维护） ── */
  pool: createRouter({
    list: publicQuery.query(() => listPoolItems()),
    add: publicQuery
      .input(
        z.object({
          title: z.string().min(1).max(255),
          rarity: rarity.default("common"),
          targetVan: vanCode.nullable().optional(),
          note: z.string().optional(),
        }),
      )
      .mutation(({ input }) => addPoolItem(input)),
    update: publicQuery
      .input(
        z.object({
          id: idField,
          title: z.string().min(1).max(255).optional(),
          rarity: rarity.optional(),
          status: z.enum(["open", "scheduled", "done"]).optional(),
          targetVan: vanCode.nullable().optional(),
          note: z.string().nullable().optional(),
        }),
      )
      .mutation(({ input }) => {
        const { id, ...patch } = input;
        return updatePoolItem(id, patch);
      }),
    remove: publicQuery
      .input(z.object({ id: idField }))
      .mutation(({ input }) => removePoolItem(input.id)),
  }),

  /* ── 任务（表 2：班次任务表） ── */
  tasks: createRouter({
    byVan: publicQuery
      .input(z.object({ van: vanCode }))
      .query(({ input }) => listTasksByVan(input.van)),
    add: publicQuery
      .input(
        z.object({
          van: vanCode,
          title: z.string().min(1).max(255),
          poolItemId: idField.nullable().optional(),
          ownerName: z.string().trim().max(64).nullable().optional(),
          size: sizeTier.nullable().optional(),
          acceptance: z.string().max(255).nullable().optional(),
        }),
      )
      .mutation(({ input }) => addTask(input)),
    update: publicQuery
      .input(
        z.object({
          id: idField,
          title: z.string().min(1).max(255).optional(),
          poolItemId: idField.nullable().optional(),
          ownerName: z.string().trim().max(64).nullable().optional(),
          size: sizeTier.nullable().optional(),
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
