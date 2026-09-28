/* vite devServer exclude 正则的回归守卫。
 *
 * 背景：devServer 的 `exclude` 语义是「这些路径**不**交给 Hono，交给 Vite」。
 * 原式 `/^\/(?!api\/).*$/` 把所有非 `/api/` 路径（含 `/mcp`）推给 Vite，
 * 症状是 **dev 下 /mcp 404 而 prod 正常**。该类问题单测抓不到——它打的是
 * Hono 的 `app.fetch`，天然绕过 Vite 中间件，只能真起 dev server 才暴露。
 * 故在此对正则本身下断言：把「哪些路径必须交给 Hono」固定成可失败的测试。
 *
 * 若将来新增服务端路径（如再挂 /metrics），本用例会提醒同步放行。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/** 从 vite.config.ts 里抠出 devServer 的 exclude 数组源码，避免二次维护 */
function readExcludeSource(): string {
  const file = path.resolve(import.meta.dirname, "../../vite.config.ts");
  const src = readFileSync(file, "utf8");
  const m = src.match(/devServer\(\{[^}]*exclude:\s*(\[[^\]]*\])/);
  if (!m)
    throw new Error("未能在 vite.config.ts 中定位 devServer 的 exclude 配置");
  return m[1];
}

const patterns: RegExp[] = eval(readExcludeSource()) as RegExp[];

/** 是否被 exclude（= 不交给 Hono） */
const excluded = (pathname: string) => patterns.some((re) => re.test(pathname));

describe("vite devServer exclude（dev 下服务端路径必须交给 Hono）", () => {
  it("配置里只有一个 exclude 规则", () => {
    expect(patterns).toHaveLength(1);
  });

  it.each(["/mcp", "/api/trpc/ping", "/api/trpc/van.tasks.byVan"])(
    "%s 必须交给 Hono（不被 exclude）",
    (p) => {
      expect(excluded(p)).toBe(false);
    },
  );

  it.each(["/", "/assets/index.js", "/src/main.tsx", "/favicon.ico"])(
    "%s 交给 Vite（被 exclude）",
    (p) => {
      expect(excluded(p)).toBe(true);
    },
  );

  it("/mcp/ 也交给 Hono——落 Hono 的 404，而非 Vite 的空 404", () => {
    // 与 api/boot.ts 与 README 的说明保持一致：三处说法必须相同
    expect(excluded("/mcp/")).toBe(false);
  });
});
