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
  /* 已知竞态均在测试内根治（编辑提交用 waitForTaskUpdate 等待落库），失败即真实回归，不做重试掩盖 */
  retries: 0,
  /* 测试共享一个测试库、班次跨用例累积，必须串行执行 */
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    screenshot: "only-on-failure",
    /* 与服务端 todayStr 的上海时区同口径，避免 CI（UTC）在 UTC 16 点后日期差一天 */
    timezone: "Asia/Shanghai",
  },
  /* 先构建生产产物再起服务：e2e 跑真实部署形态，也避开 dev 模式（StrictMode 双挂载/HMR）
     在慢启动下放大 AG Grid 编辑会话的时序竞态 */
  webServer: {
    command: "npm run build && node scripts/start.mjs",
    port: PORT,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      DATABASE_URL: TEST_DB,
      PORT: String(PORT),
    },
  },
  /* 每次跑测试前删掉旧库 */
  globalSetup: "./e2e/global-setup.ts",
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
