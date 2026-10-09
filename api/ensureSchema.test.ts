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

import { ensureSchema, splitLegacyPoints } from "./ensureSchema";

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
      {
        title: "滞留件",
        confirmed_by: null,
        confirmed_at: null,
        source: "customer",
      },
      {
        title: "未开始件",
        confirmed_by: null,
        confirmed_at: null,
        source: "customer",
      },
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
    const fresh = await mockDb.all<{
      title: string;
      confirmed_at: string | null;
    }>(sql`SELECT title, confirmed_at FROM tasks WHERE title = '新送达件'`);
    expect(fresh).toEqual([{ title: "新送达件", confirmed_at: null }]);
  });

  it("全新库（user_version 0）一次走完三级迁移，空表回填为 no-op", async () => {
    mockDb = drizzle(new Database(":memory:"), { schema });
    await ensureSchema();

    const [v] = await mockDb.all<{ user_version: number }>(
      sql`PRAGMA user_version`,
    );
    expect(v.user_version).toBe(4);
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

// ── v2.5 每人点数制迁移：旧件级档位（tasks.size）均分回填到每个负责人 ──

describe("splitLegacyPoints（回填期的均分规则）", () => {
  it("整除：6 点 3 人 → 每人 2 点", () => {
    expect(splitLegacyPoints(6, ["安", "白", "陈"])).toEqual({
      安: 2,
      白: 2,
      陈: 2,
    });
  });

  it("除不尽：5 点 2 人 → 余数给拼音序靠前者（安 3、陈 2）", () => {
    expect(splitLegacyPoints(5, ["安", "陈"])).toEqual({ 安: 3, 陈: 2 });
  });

  it("余数按拼音序分配，与传入顺序无关（传入 陈、安 仍是安 3 陈 2）", () => {
    expect(splitLegacyPoints(5, ["陈", "安"])).toEqual({ 安: 3, 陈: 2 });
  });

  it("余数多于 1：8 点 3 人 → 拼音序前两人各 3、末位 2", () => {
    expect(splitLegacyPoints(8, ["陈", "安", "白"])).toEqual({
      安: 3,
      白: 3,
      陈: 2,
    });
  });

  it("旧档位为空 → 全员 0 点", () => {
    expect(splitLegacyPoints(null, ["安", "白"])).toEqual({ 安: 0, 白: 0 });
  });

  it("没有负责人 → 空结果（不产生任何点数）", () => {
    expect(splitLegacyPoints(5, [])).toEqual({});
  });
});

describe("ensureSchema v2.5 点数回填", () => {
  it("存量件的旧档位均分给各负责人，user_version 升到 3，重复启动幂等且不误伤新行", async () => {
    mockDb = drizzle(new Database(":memory:"), { schema });
    // 模拟 v2.4 旧库：task_owners 没有 points 列，user_version = 2
    await mockDb.run(sql`
      CREATE TABLE tasks (
        id integer PRIMARY KEY AUTOINCREMENT,
        van_code text NOT NULL,
        title text NOT NULL,
        requester text,
        size integer,
        status text NOT NULL DEFAULT 'todo',
        created_at integer NOT NULL DEFAULT (unixepoch())
      )
    `);
    await mockDb.run(sql`
      CREATE TABLE task_owners (
        task_id integer NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        owner_name text NOT NULL
      )
    `);
    await mockDb.run(sql`PRAGMA user_version = 2`);
    await mockDb.run(sql`
      INSERT INTO tasks (van_code, title, size, status) VALUES
        ('DV2607A', '除不尽件', 5, 'doing'),
        ('DV2607A', '整除件', 6, 'doing'),
        ('DV2607A', '无档位件', NULL, 'todo'),
        ('DV2607A', '无负责人件', 10, 'todo')
    `);
    await mockDb.run(sql`
      INSERT INTO task_owners (task_id, owner_name) VALUES
        (1, '陈'), (1, '安'),
        (2, '陈'), (2, '白'), (2, '安'),
        (3, '安')
    `);

    await ensureSchema();

    const pointsByTask = async () => {
      const rows = await mockDb.all<{
        task_id: number;
        owner_name: string;
        points: number;
      }>(sql`SELECT task_id, owner_name, points FROM task_owners`);
      const out: Record<number, Record<string, number>> = {};
      for (const r of rows) {
        (out[r.task_id] ??= {})[r.owner_name] = r.points;
      }
      return out;
    };

    // 除不尽 → 余数按拼音序；整除 → 均分；无档位 → 全员 0；无负责人的件不产生任何行
    expect(await pointsByTask()).toEqual({
      1: { 安: 3, 陈: 2 },
      2: { 安: 2, 白: 2, 陈: 2 },
      3: { 安: 0 },
    });

    const [v] = await mockDb.all<{ user_version: number }>(
      sql`PRAGMA user_version`,
    );
    expect(v.user_version).toBe(4);

    // cutover 后新增的负责人行默认 0 点，且重启不会被二次回填
    await mockDb.run(
      sql`INSERT INTO task_owners (task_id, owner_name) VALUES (1, '己')`,
    );
    await ensureSchema();
    expect(await pointsByTask()).toEqual({
      1: { 安: 3, 陈: 2, 己: 0 },
      2: { 安: 2, 白: 2, 陈: 2 },
      3: { 安: 0 },
    });
  });
});

// ── v2.6 逐人完成与签收迁移：存量 done 件的件级日期复制给每个负责人 ──

describe("ensureSchema v2.6 逐人完成回填", () => {
  it("done 件每人拿到件级完成/签收日期，todo 件保持 NULL，无负责人件不入列，幂等重跑", async () => {
    mockDb = drizzle(new Database(":memory:"), { schema });
    // 模拟 v2.5 旧库：task_owners 没有三列，user_version = 3
    await mockDb.run(sql`
      CREATE TABLE tasks (
        id integer PRIMARY KEY AUTOINCREMENT,
        van_code text NOT NULL,
        title text NOT NULL,
        requester text,
        size integer,
        status text NOT NULL DEFAULT 'todo',
        done_at text,
        confirmed_by text,
        confirmed_at text,
        created_at integer NOT NULL DEFAULT (unixepoch())
      )
    `);
    await mockDb.run(sql`
      CREATE TABLE task_owners (
        task_id integer NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        owner_name text NOT NULL,
        points integer NOT NULL DEFAULT 0
      )
    `);
    await mockDb.run(sql`PRAGMA user_version = 3`);
    await mockDb.run(sql`
      INSERT INTO tasks (van_code, title, status, done_at, confirmed_by, confirmed_at) VALUES
        ('DV2607A', '已交已签件', 'done', '2026-08-20', '张三', '2026-08-21'),
        ('DV2607A', '已交未签件', 'done', '2026-08-22', NULL, NULL),
        ('DV2607A', '进行中件', 'doing', NULL, NULL, NULL),
        ('DV2607A', '无负责人完成件', 'done', '2026-08-23', NULL, NULL)
    `);
    await mockDb.run(sql`
      INSERT INTO task_owners (task_id, owner_name, points) VALUES
        (1, '安', 3), (1, '陈', 2),
        (2, '白', 4),
        (3, '安', 2)
    `);

    await ensureSchema();

    const ownerRows = async () =>
      await mockDb.all<{
        task_id: number;
        owner_name: string;
        done_at: string | null;
        confirmed_at: string | null;
        confirmed_by: string | null;
      }>(
        sql`SELECT task_id, owner_name, done_at, confirmed_at, confirmed_by FROM task_owners ORDER BY task_id, owner_name`,
      );

    expect(await ownerRows()).toEqual([
      {
        task_id: 1,
        owner_name: "安",
        done_at: "2026-08-20",
        confirmed_at: "2026-08-21",
        confirmed_by: "张三",
      },
      {
        task_id: 1,
        owner_name: "陈",
        done_at: "2026-08-20",
        confirmed_at: "2026-08-21",
        confirmed_by: "张三",
      },
      {
        task_id: 2,
        owner_name: "白",
        done_at: "2026-08-22",
        confirmed_at: null,
        confirmed_by: null,
      },
      {
        task_id: 3,
        owner_name: "安",
        done_at: null,
        confirmed_at: null,
        confirmed_by: null,
      },
    ]);

    const [v] = await mockDb.all<{ user_version: number }>(
      sql`PRAGMA user_version`,
    );
    expect(v.user_version).toBe(4);

    // 幂等：重跑不改动已回填的行，也不给 todo 件补日期
    await ensureSchema();
    expect(await ownerRows()).toEqual([
      {
        task_id: 1,
        owner_name: "安",
        done_at: "2026-08-20",
        confirmed_at: "2026-08-21",
        confirmed_by: "张三",
      },
      {
        task_id: 1,
        owner_name: "陈",
        done_at: "2026-08-20",
        confirmed_at: "2026-08-21",
        confirmed_by: "张三",
      },
      {
        task_id: 2,
        owner_name: "白",
        done_at: "2026-08-22",
        confirmed_at: null,
        confirmed_by: null,
      },
      {
        task_id: 3,
        owner_name: "安",
        done_at: null,
        confirmed_at: null,
        confirmed_by: null,
      },
    ]);
  });
});
