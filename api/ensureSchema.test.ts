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

// ── v2.0 迁移：source / carry_reason / confirmed_* 列 + 签收一次性回填 ──

describe("ensureSchema v2.0 签收与来源迁移", () => {
  it("存量 done 视同已签收（一次性回填），重启不误伤新 done；source 回填 customer；建 audit_log 表", async () => {
    mockDb = drizzle(new Database(":memory:"), { schema });
    // 模拟 v1.2.0 旧库：tasks 无 source / carry_reason / confirmed_* 列，user_version = 1
    await mockDb.run(sql`
      CREATE TABLE tasks (
        id integer PRIMARY KEY AUTOINCREMENT,
        van_code text NOT NULL,
        title text NOT NULL,
        rarity text NOT NULL DEFAULT 'n',
        requester text,
        size integer,
        acceptance text,
        status text NOT NULL DEFAULT 'todo',
        carried_from text,
        carry_count integer NOT NULL DEFAULT 0,
        done_at text,
        note text,
        sort_order integer,
        created_at integer NOT NULL DEFAULT (unixepoch())
      )
    `);
    await mockDb.run(sql`PRAGMA user_version = 1`);
    await mockDb.run(sql`
      INSERT INTO tasks (van_code, title, status, done_at) VALUES
        ('DV2607A', '已送达件', 'done', '2026-08-20'),
        ('DV2607A', '滞留件', 'carried', NULL),
        ('DV2607A', '未开始件', 'todo', NULL)
    `);

    await ensureSchema();

    // 存量 done 视同已签收：confirmed_at ← done_at，confirmed_by = '(历史)'
    const rows = await mockDb.all<{
      title: string;
      confirmed_by: string | null;
      confirmed_at: string | null;
      source: string;
    }>(
      sql`SELECT title, confirmed_by, confirmed_at, source FROM tasks ORDER BY id`,
    );
    expect(rows).toEqual([
      {
        title: "已送达件",
        confirmed_by: "(历史)",
        confirmed_at: "2026-08-20",
        source: "customer",
      },
      { title: "滞留件", confirmed_by: null, confirmed_at: null, source: "customer" },
      { title: "未开始件", confirmed_by: null, confirmed_at: null, source: "customer" },
    ]);

    // audit_log 表已建（链式审计日志写入口）
    await mockDb.run(
      sql`INSERT INTO audit_log (ts, actor, entity, entity_id, field, prev_hash, hash) VALUES (0, 'a', 'task', '1', '*', '0', '0')`,
    );

    // cutover 后新产生的 done 未签收保持 NULL，重启不得被回填（user_version 门控）
    await mockDb.run(
      sql`INSERT INTO tasks (van_code, title, status, done_at, source) VALUES ('DV2607A', '新送达件', 'done', '2026-08-21', 'customer')`,
    );
    await ensureSchema();
    const fresh = await mockDb.all<{ title: string; confirmed_at: string | null }>(
      sql`SELECT title, confirmed_at FROM tasks WHERE title = '新送达件'`,
    );
    expect(fresh).toEqual([{ title: "新送达件", confirmed_at: null }]);
  });

  it("全新库（user_version 0）一次走完两级迁移，空表回填为 no-op", async () => {
    mockDb = drizzle(new Database(":memory:"), { schema });
    await ensureSchema();

    const [v] = await mockDb.all<{ user_version: number }>(
      sql`PRAGMA user_version`,
    );
    expect(v.user_version).toBe(2);
  });
});

// ── 半天点数制迁移：旧三档 1/3/5 天 ×2 变 2/6/10 点，成员运力 ≤7 天 ×2 ──

describe("ensureSchema 半天点数制迁移", () => {
  it("旧值 ×2 迁移为点数，只执行一次，迁移后写入的新点数不被误翻倍", async () => {
    mockDb = drizzle(new Database(":memory:"), { schema });
    // 模拟旧库（user_version 默认为 0）：手工建旧表，写入旧口径数据
    await mockDb.run(sql`
      CREATE TABLE members (
        id integer PRIMARY KEY AUTOINCREMENT,
        name text NOT NULL UNIQUE,
        capacity integer NOT NULL DEFAULT 5,
        created_at integer NOT NULL DEFAULT (unixepoch())
      )
    `);
    await mockDb.run(sql`
      CREATE TABLE tasks (
        id integer PRIMARY KEY AUTOINCREMENT,
        van_code text NOT NULL,
        title text NOT NULL,
        size integer,
        status text NOT NULL DEFAULT 'todo',
        created_at integer NOT NULL DEFAULT (unixepoch())
      )
    `);
    await mockDb.run(
      sql`INSERT INTO members (name, capacity) VALUES ('张三', 5), ('李四', 7)`,
    );
    await mockDb.run(sql`
      INSERT INTO tasks (van_code, title, size) VALUES
        ('DV2607A', '一天件', 1), ('DV2607A', '三天件', 3),
        ('DV2607A', '五天件', 5), ('DV2607A', '未标档位', NULL)
    `);

    await ensureSchema();

    expect(
      await mockDb.all<{ size: number | null }>(
        sql`SELECT size FROM tasks ORDER BY id`,
      ),
    ).toEqual([{ size: 2 }, { size: 6 }, { size: 10 }, { size: null }]);
    expect(
      await mockDb.all<{ capacity: number }>(
        sql`SELECT capacity FROM members ORDER BY id`,
      ),
    ).toEqual([{ capacity: 10 }, { capacity: 14 }]);

    // 迁移后新写入的点数（3 点 = 1.5 天）与低点数运力，重启不得被翻倍
    await mockDb.run(
      sql`INSERT INTO tasks (van_code, title, size) VALUES ('DV2607A', '新点数件', 3)`,
    );
    await mockDb.run(
      sql`INSERT INTO members (name, capacity) VALUES ('王五', 4)`,
    );
    await ensureSchema();

    expect(
      await mockDb.all<{ size: number | null }>(
        sql`SELECT size FROM tasks ORDER BY id`,
      ),
    ).toEqual([
      { size: 2 },
      { size: 6 },
      { size: 10 },
      { size: null },
      { size: 3 },
    ]);
    expect(
      await mockDb.all<{ capacity: number }>(
        sql`SELECT capacity FROM members ORDER BY id`,
      ),
    ).toEqual([{ capacity: 10 }, { capacity: 14 }, { capacity: 4 }]);
  });
});
