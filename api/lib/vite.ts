import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Env, Hono } from "hono";

/** 生产模式下托管 vite 构建产物（dist/public），并对前端路由做 SPA 回退 */
export function serveStaticFiles<E extends Env>(app: Hono<E>) {
  // 本模块被 esbuild 内联进 dist/boot.js，故以模块所在目录定位 dist/public，
  // 不依赖 process.cwd()，从任意目录启动都不会 404
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "public",
  );
  app.use("/*", serveStatic({ root }));
  app.get("*", serveStatic({ path: path.join(root, "index.html") }));
}
