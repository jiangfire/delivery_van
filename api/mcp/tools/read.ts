/**
 * 只读工具集（开发向）。tRPC 对照：
 *   van_list     → van.list            （经 caller）
 *   tasks_by_van → van.tasks.byVan     （经 caller）
 *   members_list → van.members.list    （经 caller）
 *   stats_by_van → van.stats.byVan     （经 caller）
 *   tasks_all    → —（无对应过程，直调 listAllTasks 读函数）
 *   audit_verify → —（无对应过程，直调 audit 读函数）
 *
 * 规则：能走 caller 的一律走 caller；**读**工具在没有对应 tRPC 过程时可以直调
 * `api/queries/` 的读函数——读没有入参就没有 zod 校验可绕过，而为了 MCP
 * 专设一个 public 过程反而会扩大无鉴权 API 暴露面。**写工具无此豁免，一律走 caller。**
 */
import { z } from "zod";
import { listAllTasks } from "../../queries/van";
import {
  fingerprintOf,
  listAuditRows,
  verifyAuditChain,
} from "../../queries/audit";
import { createCaller } from "../caller";
import { defineTool } from "./types";
import { vanCode } from "../../schemas";

/** 列表类工具的行数上限：防止整库数据撑爆模型上下文 */
const DEFAULT_LIMIT = 200;

export const readTools = [
  defineTool({
    name: "van_list",
    title: "List delivery runs",
    description:
      "List all delivery-run (van) codes, newest first. A van is one weekly dispatch of the delivery truck. Code format is `DV` + 2-digit year + 2-digit month + letter, e.g. `DV2609A`. Use this to discover which van codes exist before querying tasks or stats.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
    async run() {
      return createCaller().van.vans.list();
    },
  }),

  defineTool({
    name: "tasks_by_van",
    title: "List packages on one van",
    description:
      "List the packages (tasks) on one van, in board display order. Fields include status (todo/doing/done/carried), owners, size in points (1 point = half a day), rarity, requester, source, doneAt and carry info. Pass `limit` to cap the rows; when the cap is hit the response sets `truncated: true` and reports the true total, so nothing is ever silently dropped.",
    inputSchema: z.object({
      van: vanCode.describe(
        "Van code, e.g. DV2609A. Use van_list to discover valid codes.",
      ),
      limit: z
        .number()
        .int()
        .positive()
        .max(1000)
        .default(DEFAULT_LIMIT)
        .describe("Maximum rows to return. Defaults to 200."),
    }),
    annotations: { readOnlyHint: true },
    async run({ van, limit }) {
      const rows = await createCaller().van.tasks.byVan({ van });
      return {
        van,
        total: rows.length,
        truncated: rows.length > limit,
        returned: Math.min(rows.length, limit),
        tasks: rows.slice(0, limit),
      };
    },
  }),

  defineTool({
    name: "tasks_all",
    title: "List packages across all vans",
    description:
      "List packages across vans, ordered by van then board position. This is a read-only debugging aid for cross-van analysis — prefer `tasks_by_van` for normal use, since one van's data is usually all you need. Pass `limit` to cap the rows; the response sets `truncated: true` and reports the true total, so nothing is ever silently dropped.",
    inputSchema: z.object({
      limit: z
        .number()
        .int()
        .positive()
        .max(5000)
        .default(DEFAULT_LIMIT)
        .describe("Maximum rows to return. Defaults to 200."),
    }),
    annotations: { readOnlyHint: true },
    async run({ limit }) {
      const rows = await listAllTasks();
      return {
        total: rows.length,
        truncated: rows.length > limit,
        returned: Math.min(rows.length, limit),
        tasks: rows.slice(0, limit),
      };
    },
  }),

  defineTool({
    name: "members_list",
    title: "List team members",
    description:
      "List team members and their weekly capacity in points. 1 point = half a day, the default is 10 points per week and the maximum is 14. Members are identified by plain name tags (this system has no accounts or login).",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
    async run() {
      return createCaller().van.members.list();
    },
  }),

  defineTool({
    name: "stats_by_van",
    title: "Weekly statistics for one van",
    description:
      "Weekly statistics for one van. Counts and rates: `total`, `done`, `carriedOut`, `carriedIn`, `reviewNeeded`, `remaining`, `completionRate` (done/total), `carryRate` (carriedOut/total), plus `unconfirmed` (delivered but not yet signed off). Also `members` (per-owner assigned/capacity), `requester` scorecards, `inflation` by rarity, `source` split, `carryReasons` breakdown, `suggestedLoad`, `badges`, and `auditFingerprint`. IMPORTANT: these metrics deliberately use different definitions — `completionRate`/`carryRate`/`suggestedLoad`/`badges` count a package as delivered on status=done, while `unconfirmed` uses the stricter signed-receipt rule. Do not recompute one from another; use the values as returned.",
    inputSchema: z.object({
      van: vanCode.describe(
        "Van code, e.g. DV2609A. Use van_list to discover valid codes.",
      ),
    }),
    annotations: { readOnlyHint: true },
    async run({ van }) {
      return createCaller().van.stats.byVan({ van });
    },
  }),

  defineTool({
    name: "audit_verify",
    title: "Verify the audit log hash chain",
    description:
      "Verify the integrity of the SHA256 hash-chained audit log that records every write. Returns `ok` (chain intact), `brokenAt` (0-based index of the first broken link, or null), and `fingerprint` (first 8 hex chars of the chain head, transcribed into the weekly meeting minutes). An empty chain is valid and returns fingerprint null.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
    async run() {
      const rows = await listAuditRows();
      const brokenAt = verifyAuditChain(rows);
      return {
        ok: brokenAt === null,
        brokenAt,
        fingerprint: fingerprintOf(rows.at(-1)?.hash),
        entries: rows.length,
      };
    },
  }),
];
