import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { LEGACY_RARITY_TO, RARITIES } from "../db/schema";
import * as schema from "../db/schema";

// ── 稀有度五级重构的存量迁移映射（ensureSchema 启动时据此幂等 UPDATE） ──

describe("LEGACY_RARITY_TO", () => {
  it("旧六级每个值都有映射，无遗漏", () => {
    expect(Object.keys(LEGACY_RARITY_TO).sort()).toEqual(
      ["common", "epic", "legendary", "mythic", "rare", "uncommon"].sort(),
    );
  });

  it("映射目标都落在新五级值域内", () => {
    for (const to of Object.values(LEGACY_RARITY_TO)) {
      expect(RARITIES).toContain(to);
    }
  });

  it("前四档一对一保序，顶级两档归并 UR", () => {
    expect(LEGACY_RARITY_TO).toEqual({
      common: "n",
      uncommon: "r",
      rare: "sr",
      epic: "ssr",
      legendary: "ur",
      mythic: "ur",
    });
  });
});

// ── 迁移接线（内存库跑真实 ensureSchema，防映射正确但 UPDATE 循环被改坏） ──

let mockDb: BetterSQLite3Database<typeof schema>;

vi.mock("./queries/connection", () => ({
  getDb: vi.fn(() => mockDb),
}));

import { ensureSchema } from "./ensureSchema";

describe("ensureSchema 稀有度迁移", () => {
  it("启动时把旧六级存量迁移到新五级，新值不受影响，重复启动幂等", async () => {
    mockDb = drizzle(new Database(":memory:"), { schema });
    await ensureSchema();

    // 模拟旧库数据：六个旧值各一行，外加一行已是新值（sr）
    for (const r of [...Object.keys(LEGACY_RARITY_TO), "sr"]) {
      await mockDb.run(
        sql`INSERT INTO tasks (van_code, title, rarity) VALUES ('DV2607A', ${"快件-" + r}, ${r})`,
      );
    }

    await ensureSchema();

    const rows = await mockDb.all<{ rarity: string }>(
      sql`SELECT rarity FROM tasks ORDER BY id`,
    );
    expect(rows.map((r) => r.rarity)).toEqual([
      "n",
      "r",
      "sr",
      "ssr",
      "ur",
      "ur",
      "sr",
    ]);

    await ensureSchema();
    const again = await mockDb.all<{ rarity: string }>(
      sql`SELECT rarity FROM tasks ORDER BY id`,
    );
    expect(again).toEqual(rows);
  });
});
