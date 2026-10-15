import { createRouter, publicQuery } from "./middleware";
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
  reorderTasks,
  setOwnerDone,
  updateMemberCapacity,
  updateTask,
  weeklyStats,
} from "./queries/van";
import {
  addSource,
  listSources,
  removeSource,
  renameSource,
} from "./queries/sources";
import {
  carryReasonField,
  carryRunInput,
  doneAtField,
  memberAddInput,
  memberRemoveInput,
  memberSetCapacityInput,
  memberTag,
  ownerPointsField,
  requesterField,
  sourceAddInput,
  sourceField,
  sourceRemoveInput,
  sourceRenameInput,
  taskAddInput,
  taskConfirmInput,
  taskRemoveInput,
  taskReorderInput,
  taskSetOwnerDoneInput,
  taskUpdateInput,
  vanCodeInput,
  vansDispatchInput,
} from "./schemas";

/**
 * 入参 schema 已抽至 `./schemas`，供 tRPC 与 MCP 共享同一份 zod 对象
 * （校验单点，见 schemas.ts 头部说明）。以下为历史导出面，
 * `api/vanRouter.test.ts` 仍从中取用，保留转发以免破坏回归网。
 */
export {
  ownerPointsField,
  sourceField,
  memberTag,
  carryReasonField,
  requesterField,
  doneAtField,
};

export const vanRouter = createRouter({
  /* ── 班次（手动发新车） ── */
  vans: createRouter({
    list: publicQuery.query(() => listVans()),
    dispatch: publicQuery
      .input(vansDispatchInput)
      .mutation(({ input }) => dispatchVan(new Date(), input?.actor)),
  }),

  /* ── 成员 ── */
  members: createRouter({
    list: publicQuery.query(() => listMembers()),
    add: publicQuery
      .input(memberAddInput)
      .mutation(({ input }) =>
        addMember(input.name, input.capacity, input.actor),
      ),
    setCapacity: publicQuery
      .input(memberSetCapacityInput)
      .mutation(({ input }) =>
        updateMemberCapacity(input.id, input.capacity, input.actor),
      ),
    /** 有守卫的硬删：零历史成员可删，当过负责人/提出人/签收人的拒绝（详见 queries/van.ts removeMember） */
    remove: publicQuery
      .input(memberRemoveInput)
      .mutation(({ input }) => removeMember(input.name, input.actor)),
  }),

  /* ── 需求类型（快件来源，v2.7 动态化） ── */
  sources: createRouter({
    list: publicQuery.query(() => listSources()),
    /** 新增自定义类型（code == 显示名，此后 code 永不变） */
    add: publicQuery
      .input(sourceAddInput)
      .mutation(({ input }) => addSource(input.label, input.actor)),
    /** 改显示名：code 不动，历史数据零迁移 */
    rename: publicQuery
      .input(sourceRenameInput)
      .mutation(({ input }) =>
        renameSource(input.code, input.label, input.actor),
      ),
    /** 有守卫的硬删：内置不可删、有快件引用不可删 */
    remove: publicQuery
      .input(sourceRemoveInput)
      .mutation(({ input }) => removeSource(input.code, input.actor)),
  }),

  /* ── 快件 ── */
  tasks: createRouter({
    byVan: publicQuery
      .input(vanCodeInput)
      .query(({ input }) => listTasksByVan(input.van)),
    add: publicQuery
      .input(taskAddInput)
      .mutation(({ input }) => addTask(input)),
    update: publicQuery.input(taskUpdateInput).mutation(({ input }) => {
      const { id, actor, ...patch } = input;
      return updateTask(id, patch, actor);
    }),
    remove: publicQuery
      .input(taskRemoveInput)
      .mutation(({ input }) => removeTask(input.id, input.actor)),
    reorder: publicQuery
      .input(taskReorderInput)
      .mutation(({ input }) => reorderTasks(input.van, input.ids, input.actor)),
    /* 签收制（v2.6）：逐人签收某份交付 */
    confirm: publicQuery
      .input(taskConfirmInput)
      .mutation(({ input }) =>
        confirmTask(input.taskId, input.owner, input.actor),
      ),
    /* 逐人完成（v2.6）：打勾/取消某个负责人各自的完成 */
    setOwnerDone: publicQuery
      .input(taskSetOwnerDoneInput)
      .mutation(({ input }) =>
        setOwnerDone(
          input.taskId,
          input.owner,
          input.done,
          input.doneAt,
          input.actor,
        ),
      ),
  }),

  /* ── 结转与统计 ── */
  carry: createRouter({
    run: publicQuery.input(carryRunInput).mutation(({ input }) =>
      carryOver(input.fromVan, input.toVan, new Date(), {
        actor: input.actor,
        carryReason: input.carryReason,
      }),
    ),
  }),
  stats: createRouter({
    byVan: publicQuery
      .input(vanCodeInput)
      .query(({ input }) => weeklyStats(input.van)),
  }),
});
