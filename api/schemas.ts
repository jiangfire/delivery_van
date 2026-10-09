/**
 * 服务端入参 zod schema（tRPC 与 MCP 共享的唯一校验来源）。
 *
 * 抽出本文件的唯一动机：MCP 工具需要与 tRPC **引用同一份 zod 对象**——
 * tRPC 侧拿它做入参校验，MCP 侧拿它生成 JSON Schema 给模型看，并复用同一套
 * 校验逻辑。校验单点，杜绝「MCP 直连数据层绕过 zod」这条铁律被绕过
 * （见 AGENTS.md「服务端入参一律 zod 校验」）。
 *
 * 约定：schema 变更会同时影响 tRPC 与 MCP 两个入口，对外可见的校验行为
 * 由 `api/vanRouter.test.ts` 锁定（该文件是唯一的入参校验回归网）。
 */
import { z } from "zod";
import { VAN_CODE_RE } from "../contracts/vans";
import { CARRY_REASONS, SOURCES } from "../contracts/enums";
import { OWNER_POINTS_MAX } from "../contracts/points";
import { RARITIES } from "../db/schema";

export const vanCode = z
  .string()
  .regex(VAN_CODE_RE, "班次编码格式应为 DV2607A（年+月+当月第几班）");
/**
 * 负责人点数（v2.5 每人点数制）：每个负责人各自持有自己的点数，0 = 挂名不占运力；
 * 任务点数 = 各负责人点数之和，故**任务合计无上限**。
 */
export const ownerPointsField = z.number().int().min(0).max(OWNER_POINTS_MAX);
export const idField = z.number().int().positive();
export const rarity = z.enum(RARITIES);
/** 快件来源（三方占比口径，v2.0） */
export const sourceField = z.enum(SOURCES);
/** 结转原因五枚举（v2.0 WP5；swap 让位原因 Phase 2 另加） */
export const carryReasonField = z.enum(CARRY_REASONS);
/** 操作人标签（软身份，缺省 '(unknown)'，链式审计日志用） */
export const actorField = z.string().trim().max(64).optional();

/**
 * 成员/负责人标签的统一约束：trim 后 1~64 字符，且不含半角逗号。
 *
 * 半角逗号的禁令来自历史上的负责人聚合方式（`group_concat` 逗号拼接，含逗号会错拆标签）；
 * v2.5 每人点数制起负责人按行读取、已不再需要该限制，但为免存量标签与既有校验契约突变，
 * 保留这条禁令。
 */
export const memberTag = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((v) => !v.includes(","), "名称不能包含半角逗号「,」");

/**
 * 负责人 + 该人在这个需求上的点数。`points` **必填**（不给默认值）：勾选负责人
 * 不等于设置完成——一个需求多个负责人参加时，这些人都要各自设置自己的点数
 * （见 docs/archived/负责人点数制设计方案.md D5；服务端不接受"有负责人但没有点数"的行）。
 */
export const ownerAllocInput = z.object({
  name: memberTag,
  points: ownerPointsField,
});

/** 负责人列表：同一个人不得重复出现（重复会让点数被双计） */
export const ownerAllocList = z
  .array(ownerAllocInput)
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    for (const o of list) {
      if (seen.has(o.name)) {
        ctx.addIssue({
          code: "custom",
          message: `负责人「${o.name}」重复`,
        });
      }
      seen.add(o.name);
    }
  });

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

/* ── 各过程的入参对象（tRPC 与 MCP 共用） ── */

export const vansDispatchInput = z.object({ actor: actorField }).optional();

export const memberAddInput = z.object({
  name: memberTag,
  capacity: z.number().int().min(0).max(14).default(10),
  actor: actorField,
});

/**
 * 改运力也是写操作，故与其余 mutation 同口径带 actor（落审计链）。
 * 前端目前无调用方（运力只在只读统计面板展示），补 actor 无回归风险。
 */
export const memberSetCapacityInput = z.object({
  id: idField,
  capacity: z.number().int().min(0).max(14),
  actor: actorField,
});

export const memberRemoveInput = z.object({
  name: memberTag,
  actor: actorField,
});

export const vanCodeInput = z.object({ van: vanCode });

export const taskAddInput = z.object({
  van: vanCode,
  title: z.string().min(1).max(255),
  rarity: rarity.default("n"),
  requester: requesterField.optional(),
  owners: ownerAllocList.optional(),
  acceptance: z.string().max(255).nullable().optional(),
  source: sourceField.optional(),
  actor: actorField,
});

export const taskUpdateInput = z.object({
  id: idField,
  title: z.string().min(1).max(255).optional(),
  rarity: rarity.optional(),
  requester: requesterField.nullable().optional(),
  owners: ownerAllocList.optional(),
  acceptance: z.string().max(255).nullable().optional(),
  status: z.enum(["todo", "doing", "done"]).optional(),
  doneAt: doneAtField.nullable().optional(),
  note: z.string().max(255).nullable().optional(),
  source: sourceField.optional(),
  actor: actorField,
});

export const taskRemoveInput = z.object({ id: idField, actor: actorField });

export const taskReorderInput = z.object({
  van: vanCode,
  ids: z.array(idField).max(1000),
  actor: actorField,
});

/** 签收制（v2.0 WP3）：done 后由提出人一次点击签收，actor 必填且必须是成员 */
export const taskConfirmInput = z.object({ taskId: idField, actor: memberTag });

/**
 * 逐人完成（v2.6）：done=true 打勾（doneAt 缺省今天，可补录），false 取消
 * （同时作废该人签收）。actor 为软身份（审计用，可缺省）。
 */
export const taskSetOwnerDoneInput = z.object({
  taskId: idField,
  owner: memberTag,
  done: z.boolean(),
  doneAt: doneAtField.optional(),
  actor: actorField,
});

export const carryRunInput = z.object({
  fromVan: vanCode,
  toVan: vanCode,
  carryReason: carryReasonField.optional(),
  actor: actorField,
});
