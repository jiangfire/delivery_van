import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});

app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

// 启动时按 DB_DIALECT（sqlite/pg/mysql）幂等建表——失败说明数据库不可用，退出非零
const { ensureSchema } = await import("./ensureSchema");
try {
  await ensureSchema();
} catch (e) {
  // 建表失败说明数据库不可用，继续跑只会每个请求都报错；直接非零退出，让容器编排判定不健康
  console.error("[ensureSchema] 建表失败，进程退出：", e);
  process.exit(1);
}

/**
 * MCP 端点（v2.4）：挂在 `/mcp` 且**不带尾斜杠**。
 * ⚠️ dev 模式另有陷阱：`vite.config.ts` 的 devServer `exclude` 语义是
 * 「这些路径**不**交给 Hono」。原式 `^\/(?!api\/).*$` 会把所有非 /api/ 路径
 * （含 /mcp）推给 Vite → dev 下 /mcp 404 而 prod 正常，本地调试盲区。
 * 已改为显式放行 api 与 mcp（见 vite.config.ts 注释）。`/mcp/` 带尾斜杠时
 * 同样会交给 Hono，但那里没有对应路由 → Hono 的 404。
 * 与 `/api/trpc` 同端口同进程，不新增暴露面——沿用「不要暴露公网」既有约束。
 *
 * 注册位置在 ensureSchema 之后：建表失败会 process.exit，届时不该留下一个
 * 指向未建表的 MCP 端点。`export default app` 虽在前面，但导出的是同一个
 * app 对象引用，Hono 路由表可变，dev 侧 ssrLoadModule 在模块求值（含顶层
 * await）完成后才拿到 fetch，故此处后注册对开发模式同样生效。
 */
const { createMcpHttpHandler } = await import("./mcp/server");
const mcpHandler = createMcpHttpHandler();
app.all("/mcp", (c) => mcpHandler.fetch(c.req.raw));

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
