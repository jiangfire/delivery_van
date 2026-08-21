import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, "test.db");

/** 每次跑测试前删掉旧库，保证干净状态 */
export default function globalSetup() {
  for (const f of [TEST_DB, TEST_DB + "-wal", TEST_DB + "-shm"]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* 首次跑不存在，忽略 */
    }
  }
}
