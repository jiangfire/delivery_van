import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4173;
/* 每次跑测试用独立库，不影响开发数据 */
const TEST_DB = path.join(__dirname, "e2e", "test.db");

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    screenshot: "only-on-failure",
  },
  /* 先启动后端（用测试库），再跑测试；测试结束自动关 */
  webServer: {
    command: "npm run dev",
    port: PORT,
    reuseExistingServer: true,
    timeout: 30_000,
    env: {
      DATABASE_URL: TEST_DB,
      PORT: String(PORT),
    },
  },
  /* 每次跑测试前删掉旧库 */
  globalSetup: "./e2e/global-setup.ts",
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
});
