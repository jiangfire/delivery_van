import { appRouter } from "../router";
import type { TrpcContext } from "../context";

/**
 * 进程内 tRPC caller——MCP 工具的唯一写路径。
 *
 * 为什么走 caller 而不是直接 import `api/queries/van.ts`：入参 zod 校验目前
 * 全部挂在 tRPC router 上（`api/schemas.ts`），直连数据层等于绕过
 * AGENTS.md 的「服务端入参一律 zod 校验」铁律。经 caller 调用则一次性继承
 * 校验 + 全部业务规则（归档锁 / 结转幂等 / 签收守卫）+ 审计链路径，
 * 零业务逻辑重复。
 *
 * `req` 用合成 Request 占位：MCP SDK v2 的 `ServerContext` 不暴露底层 HTTP
 * Request（只有 `mcpReq` 的 JSON-RPC 元信息），无从取真值；而 tRPC context
 * 目前**没有任何过程读取 `ctx.req`**（`api/vanRouter.ts` 全部过程不接 ctx），
 * 故此处不传真请求不会丢失任何行为。若将来某过程真的要用 req，
 * 需改由 MCP 层显式透传。
 */
export function createCaller() {
  const ctx: TrpcContext = {
    req: new Request("http://mcp.local/invoke"),
    resHeaders: new Headers(),
  };
  return appRouter.createCaller(ctx);
}
