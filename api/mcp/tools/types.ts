import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { McpServer } from "@modelcontextprotocol/server";

/**
 * MCP 工具的统一形状与注册机制。
 *
 * 约定（AGENTS.md「代码风格与约定」同款纪律，改动前先读）：
 * - **description 用英文**：这是喂给模型的语料，是对「注释与业务文案使用中文」
 *   的显式例外。工具名、参数名、错误文案、代码注释一律中文。
 * - **工具名用 snake_case**：不照搬 tRPC 的点号路径（`van.list`），点号在部分
 *   MCP 客户端的工具名校验中不通用。映射见各 tools/*.ts 文件头对照表。
 * - **写工具的 description 必须明写不可逆后果**：模型读的是 description，
 *   `annotations` 只是给 UI 用的提示，危险信息放错地方等于没写。
 */

export type ToolDef<S extends z.ZodType = z.ZodType> = {
  name: string;
  title: string;
  /** 英文。模型据此决定调不调、怎么调参数 */
  description: string;
  inputSchema: S;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
  };
  run: (args: z.infer<S>) => Promise<unknown> | unknown;
};

/** 写工具必须显式声明 destructive（不可逆），避免漏标 */
export type WriteToolDef<S extends z.ZodType = z.ZodType> = ToolDef<S> & {
  annotations: { readOnlyHint: false; destructiveHint: boolean };
};

export function defineTool<S extends z.ZodType>(def: ToolDef<S>) {
  return def;
}
export function defineWriteTool<S extends z.ZodType>(def: WriteToolDef<S>) {
  return def;
}

/** 业务错误 → MCP 错误结果：把中文 message 透传给模型，不吞异常、不伪装成功 */
function toResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function toError(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

/**
 * 注册循环用的类型擦除形状。`run` 的入参取 `never`：`ToolDef<S>` 的
 * `(args: z.infer<S>) => R` 对 `never` 可赋值，于是各工具的异构 schema
 * 收敛成同一数组类型；真正调用时再放宽回 `unknown`（SDK 已按 inputSchema
 * 校验过 args，擦除在语义上成立）。
 */
type ErasedToolDef = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodType;
  annotations?: ToolDef["annotations"];
  run: (args: never) => Promise<unknown> | unknown;
};

/**
 * 批量注册工具。
 *
 * 入参校验由 SDK 依据 `inputSchema`（Standard Schema / zod v4）自动完成，
 * 非法入参不会进入 handler——因此工具实现内部不需要再重复校验。
 * 这里只负责把**业务层**抛出的错误（TRPCError / 普通 Error）转成 MCP 错误结果，
 * 避免整个请求 500。
 */
export function registerTools(
  server: McpServer,
  defs: readonly ErasedToolDef[],
) {
  for (const def of defs) {
    const run = def.run as (args: unknown) => Promise<unknown> | unknown;
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.inputSchema,
        annotations: def.annotations,
      },
      async (args: unknown) => {
        try {
          return toResult(await run(args));
        } catch (e) {
          if (e instanceof TRPCError) return toError(e.message);
          if (e instanceof z.ZodError) return toError(z.prettifyError(e));
          return toError(e instanceof Error ? e.message : String(e));
        }
      },
    );
  }
}
