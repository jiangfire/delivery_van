/**
 * E2E 预清理（package.json 的 test:e2e 前置，必须在 playwright 启动之前跑）：
 * 1. 杀掉占用测试端口（4173）的残留服务进程——Windows 上 Playwright 结束后
 *    node 服务进程偶尔不死透，端口被占时 Playwright 会直接复用旧服务
 *    （reuseExistingServer），带着上一轮的脏库继续跑；
 * 2. 删除旧测试库——不能放在 globalSetup 里：Playwright 的 webServer 先于
 *    globalSetup 启动并锁住库文件，那时删除必然静默失败（表现为班次跨运行
 *    累积、编码莫名跳月/爆 Z——本项目真实踩过的坑）。
 * 全程尽力而为，任何异常都以退出码 0 结束，不阻塞测试启动。
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, "test.db");
/** 与 playwright.config.ts 的 webServer 端口一致 */
const PORT = 4173;

function killLingeringServer() {
  if (process.platform === "win32") {
    const lines = execSync("netstat -ano", { encoding: "utf8" }).split("\n");
    const pids = new Set(
      lines.flatMap((line) => {
        const cols = line.trim().split(/\s+/);
        // TCP  本地地址:端口  远端地址  LISTENING  PID
        if (
          cols[0] === "TCP" &&
          cols[1]?.endsWith(`:${PORT}`) &&
          cols[3] === "LISTENING" &&
          cols[4] &&
          cols[4] !== "0"
        ) {
          return [cols[4]];
        }
        return [];
      }),
    );
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
        console.log(`[pre-test] 已清理残留服务进程 PID ${pid}（端口 ${PORT}）`);
      } catch {
        // 进程可能在查杀间隙已退出
      }
    }
  } else {
    try {
      execSync(`lsof -ti:${PORT} | xargs -r kill -9`, { stdio: "ignore" });
    } catch {
      // 无残留进程
    }
  }
}

try {
  killLingeringServer();
} catch {
  // netstat/lsof 不可用等异常：不阻塞
}

for (const f of [TEST_DB, TEST_DB + "-wal", TEST_DB + "-shm"]) {
  try {
    fs.unlinkSync(f);
  } catch {
    /* 首次跑不存在，忽略 */
  }
}
