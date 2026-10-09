/**
 * 写工具——**仅在 `MCP_WRITES=on` 时注册**（默认不注册，见 server.ts）。
 *
 * tRPC 对照（全部经 caller，写工具无直连豁免）：
 *   van_dispatch    → van.dispatch        tasks_confirm   → van.tasks.confirm
 *   tasks_add       → van.tasks.add       carry_run       → carry.run
 *   tasks_update    → van.tasks.update    tasks_remove    → van.tasks.remove
 *   tasks_reorder   → van.tasks.reorder   members_add     → van.members.add
 *   members_remove  → van.members.remove  members_set_capacity → van.members.setCapacity
 *   tasks_set_owner_done → van.tasks.setOwnerDone
 *
 * 两条纪律：
 * 1. **actor 必填**：软身份，落链式审计日志（AGENTS.md「写操作一律带 actor」）。
 *    全部 11 个写工具的 schema 里都有**必填** actor——`write.test.ts` 对
 *    「actor 字段存在」与「actor 非 optional」各有一条断言，勿用「空对象被拒」
 *    之类的代理条件代替（那只会证明存在别的必填字段）。
 * 2. **description 必须明写不可逆后果**：模型读的是 description，不是
 *    `annotations`——危险信息只放 annotations 等于没写。
 */
import { z } from "zod";
import { createCaller } from "../caller";
import { defineWriteTool } from "./types";
import {
  carryRunInput,
  memberAddInput,
  memberRemoveInput,
  memberSetCapacityInput,
  memberTag,
  taskAddInput,
  taskConfirmInput,
  taskRemoveInput,
  taskReorderInput,
  taskSetOwnerDoneInput,
  taskUpdateInput,
} from "../../schemas";

/** 各写工具的 actor schema：写操作一律必填，落审计链 */
const actorRequired = memberTag.describe(
  "Actor name tag for the audit log. Must be an existing member. This system has no login, so this is a soft identity that is written to the hash-chained audit log.",
);

export const writeTools = [
  defineWriteTool({
    name: "van_dispatch",
    title: "Dispatch a new van",
    description:
      "Dispatch a new van (create the next weekly run). Month-scoped letter sequencing is automatic: the new van is anchored to the current calendar month and numbered from A. Use `van_list` first if you need to know the current latest van.",
    inputSchema: z.object({ actor: actorRequired }),
    annotations: { readOnlyHint: false, destructiveHint: false },
    async run({ actor }) {
      return createCaller().van.vans.dispatch({ actor });
    },
  }),

  defineWriteTool({
    name: "tasks_add",
    title: "Add a package to a van",
    description:
      "Add a package to a van. `owners` is one entry per person, each carrying their own points: `[{ name, points }]` with points 0-10 (1 point = half a day; 0 means listed but not loaded). Every owner MUST be given an explicit points value — there is no default, and there is no task-level `size` field anymore: a package's total points is the sum over its owners. A package may also be added with no owners, in which case it counts as 0 points until someone is assigned. The van must not be archived (a van that already has carried packages is permanently read-only). `actor` is required and is recorded in the audit log.",
    inputSchema: taskAddInput.extend({ actor: actorRequired }),
    annotations: { readOnlyHint: false, destructiveHint: false },
    async run(input) {
      return createCaller().van.tasks.add(input);
    },
  }),

  defineWriteTool({
    name: "tasks_update",
    title: "Update a package",
    description:
      "Update fields on an existing package. Only the fields you pass are changed. Passing `owners` REPLACES the entire owner list, so include every person together with their own points: `[{ name, points }]`, points 0-10 (1 point = half a day). Each owner must be given an explicit points value; there is no task-level `size` field anymore. The van must not be archived. `actor` is required and is recorded in the audit log.",
    inputSchema: taskUpdateInput.extend({ actor: actorRequired }),
    annotations: { readOnlyHint: false, destructiveHint: false },
    async run({ id, actor, ...patch }) {
      return createCaller().van.tasks.update({ id, actor, ...patch });
    },
  }),

  defineWriteTool({
    name: "tasks_reorder",
    title: "Reorder packages on a van",
    description:
      "Rewrite the board order of packages within a van by passing the full id list in the desired order. This is idempotent — repeating the same call is safe.",
    inputSchema: taskReorderInput.extend({ actor: actorRequired }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    async run({ van, ids, actor }) {
      return createCaller().van.tasks.reorder({ van, ids, actor });
    },
  }),

  defineWriteTool({
    name: "tasks_confirm",
    title: "Confirm receipt of one owner's delivery",
    description:
      "Confirm receipt (sign-off) of ONE owner's share of a package. The named `owner` must have already delivered (their personal done date is set), the van must not be archived, and `actor` must be an existing member. Re-confirming the same owner is idempotent and does not overwrite the first signature. Packages with no requester are treated as self-driven and count as signed without a record. The package-level confirmation is written automatically once every judged owner is signed.",
    inputSchema: taskConfirmInput,
    annotations: { readOnlyHint: false, destructiveHint: false },
    async run({ taskId, owner, actor }) {
      return createCaller().van.tasks.confirm({ taskId, owner, actor });
    },
  }),

  defineWriteTool({
    name: "tasks_set_owner_done",
    title: "Mark one owner's share as delivered or not",
    description:
      "Set the personal delivery state of ONE owner on a package (v2.6 per-person completion). With `done: true` the owner's done date is set (defaults to today; pass `doneAt` as YYYY-MM-DD to backdate). With `done: false` that owner's done date is cleared AND that owner's signature is voided (other owners' signatures are kept). Owners with 0 points can be marked too, but they are ignored when deciding whether the whole package is done. The van must not be archived. The package-level status/done date/signature are recomputed automatically. Idempotent: repeating a no-op call writes nothing. `actor` is required and is recorded in the audit log.",
    inputSchema: taskSetOwnerDoneInput.extend({ actor: actorRequired }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    async run(input) {
      return createCaller().van.tasks.setOwnerDone(input);
    },
  }),

  defineWriteTool({
    name: "carry_run",
    title: "Carry unfinished packages to the next van (DESTRUCTIVE)",
    description:
      "DESTRUCTIVE AND IRREVERSIBLE. Carry every unfinished package from one van to the immediately following van. This writes a `carried` marker, which PERMANENTLY ARCHIVES the source van: once any carried package exists, that van can no longer be added to, edited, reordered, or have packages removed. There is no undo tool. Only run this at the Friday close-out, and only after checking the source van with `tasks_by_van`.",
    inputSchema: carryRunInput.extend({ actor: actorRequired }),
    annotations: { readOnlyHint: false, destructiveHint: true },
    async run(input) {
      return createCaller().van.carry.run(input);
    },
  }),

  defineWriteTool({
    name: "tasks_remove",
    title: "Remove a package (DESTRUCTIVE)",
    description:
      "DESTRUCTIVE. Remove a package from its van and write the removal to the audit log. There is no undo. The van must not be archived.",
    inputSchema: taskRemoveInput.extend({ actor: actorRequired }),
    annotations: { readOnlyHint: false, destructiveHint: true },
    async run({ id, actor }) {
      return createCaller().van.tasks.remove({ id, actor });
    },
  }),

  defineWriteTool({
    name: "members_add",
    title: "Add a team member",
    description:
      "Add a team member by name tag, with a weekly capacity in points (0-14; 1 point = half a day, default 10). The name must not contain a half-width comma. This is additive and safe to repeat is NOT guaranteed — duplicate names are rejected by the server.",
    inputSchema: memberAddInput.extend({ actor: actorRequired }),
    annotations: { readOnlyHint: false, destructiveHint: false },
    async run(input) {
      return createCaller().van.members.add(input);
    },
  }),

  defineWriteTool({
    name: "members_set_capacity",
    title: "Set a member's weekly capacity",
    description:
      "Update a member's weekly capacity in points (0-14; 1 point = half a day). Capacity is recorded for planning and is not enforced against assignments. `actor` is required and is recorded in the audit log.",
    inputSchema: memberSetCapacityInput.extend({ actor: actorRequired }),
    annotations: { readOnlyHint: false, destructiveHint: false },
    async run(input) {
      return createCaller().van.members.setCapacity(input);
    },
  }),

  defineWriteTool({
    name: "members_remove",
    title: "Remove a team member (DESTRUCTIVE)",
    description:
      "DESTRUCTIVE. Remove a member by name tag. This is a guarded hard delete: it is REJECTED if the name appears anywhere on any package as an owner, requester, or confirmer, because those are plain-text references with no foreign keys — deleting would leave dangling tags that corrupt the statistics. Only members with zero history can be removed. There is no undo.",
    inputSchema: memberRemoveInput.extend({ actor: actorRequired }),
    annotations: { readOnlyHint: false, destructiveHint: true },
    async run(input) {
      return createCaller().van.members.remove(input);
    },
  }),
];
