import devServer from "@hono/vite-dev-server";
import path from "path";
const __dirname = import.meta.dirname;
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    // exclude 的语义是「这些路径**不**交给 Hono，交给 Vite」。原式
    // `/^\/(?!api\/).*$/` 会把所有非 /api/ 路径（含 /mcp）推给 Vite，
    // 导致 dev 下 /mcp 404 而 prod 正常——本地调试盲区。故显式放行 api 与 mcp：
    //   (?!(api|mcp)(\/|$))  路径不以 /api/ 或 /mcp 开头时才排除
    // 注意 /mcp 必须不带尾斜杠：`/mcp/` 同样会交给 Hono，但那里没有对应路由，
    // 落到 Hono 的 404（「404 Not Found」，非 Vite 的空 404）。
    devServer({ entry: "api/boot.ts", exclude: [/^\/(?!(api|mcp)(\/|$)).*$/] }),
    react(),
  ],
  server: {
    port: Number(process.env.PORT ?? 3000),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@contracts": path.resolve(__dirname, "./contracts"),
      "@db": path.resolve(__dirname, "./db"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
  },
});
