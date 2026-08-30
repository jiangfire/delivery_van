/* v2.0 Phase 1 统计纯函数（WP1 三件套 / WP4 昨日天气 / WP5 原因瀑布 / WP6 徽章 / WP3 签收口径）
 * 全部无库可测，与 van.test.ts 的 rarityStatsOf / taskStatsOf 同层。 */
import { describe, expect, it } from "vitest";
import {
  badgesOf,
  carryReasonStatsOf,
  isConfirmed,
  rarityInflationOf,
  requesterStatsOf,
  sourceStatsOf,
  suggestedLoadOf,
} from "./van";
import type { Task } from "../../db/schema";

/* ── 测试数据构造 ── */

type Row = Partial<Task>;
const t = (row: Row) => row as Task;

describe("isConfirmed（签收口径）", () => {
  it("done 且已签收 → true", () => {
    expect(
      isConfirmed(
        t({ status: "done", requester: "张三", confirmedAt: "2026-08-28" }),
      ),
    ).toBe(true);
  });

  it("无提出人的自驱件不落库直接视同签收", () => {
    expect(
      isConfirmed(t({ status: "done", requester: null, confirmedAt: null })),
    ).toBe(true);
  });

  it("done 且有提出人但未签收 → false（待签收）", () => {
    expect(
      isConfirmed(t({ status: "done", requester: "张三", confirmedAt: null })),
    ).toBe(false);
  });

  it("非 done 一律 false", () => {
    expect(
      isConfirmed(
        t({ status: "todo", requester: "张三", confirmedAt: "2026-08-28" }),
      ),
    ).toBe(false);
  });
});

describe("requesterStatsOf（提出人记分卡）", () => {
  it("按提出人聚合：提出数 / 送达（签收口径）/ 滞留（stranded）/ UR+SSR 占比 / 平均在车班数", () => {
    const stats = requesterStatsOf([
      t({
        requester: "张三",
        status: "done",
        rarity: "ur",
        carryCount: 0,
        confirmedAt: "2026-08-28",
      }),
      t({
        requester: "张三",
        status: "carried",
        rarity: "ssr",
        carryCount: 0,
        confirmedAt: null,
      }),
      t({
        requester: "李四",
        status: "done",
        rarity: "n",
        carryCount: 1,
        confirmedAt: null,
      }),
    ]);
    expect(stats).toEqual([
      {
        requester: "张三",
        total: 2,
        delivered: 1,
        stranded: 1,
        urSsrRate: 1,
        avgVans: 1,
      },
      {
        requester: "李四",
        total: 1,
        delivered: 0,
        stranded: 0,
        urSsrRate: 0,
        avgVans: 2,
      },
    ]);
  });

  it("requester 为空归入「未标注」桶，自驱件 done 视同签收", () => {
    const stats = requesterStatsOf([
      t({
        requester: null,
        status: "done",
        rarity: "n",
        carryCount: 0,
        confirmedAt: null,
      }),
    ]);
    expect(stats).toEqual([
      {
        requester: "未标注",
        total: 1,
        delivered: 1,
        stranded: 0,
        urSsrRate: 0,
        avgVans: 1,
      },
    ]);
  });

  it("平均在车班数 = carryCount + 1 的均值（连续滞留件计入），空数组返回空", () => {
    const stats = requesterStatsOf([
      t({
        requester: "王五",
        status: "carried",
        rarity: "n",
        carryCount: 2,
        confirmedAt: null,
      }),
      t({
        requester: "王五",
        status: "done",
        rarity: "n",
        carryCount: 0,
        confirmedAt: "2026-08-28",
      }),
    ]);
    expect(stats[0].avgVans).toBe(2);
    expect(requesterStatsOf([])).toEqual([]);
  });
});

describe("rarityInflationOf（稀有度通胀报表）", () => {
  it("稀有度 × {done, stranded} 交叉表 + UR/N 滞留率对比", () => {
    const r = rarityInflationOf([
      t({ rarity: "n", status: "done" }),
      t({ rarity: "n", status: "carried" }),
      t({ rarity: "ur", status: "carried" }),
    ]);
    expect(r.byRarity).toEqual([
      { rarity: "n", total: 2, done: 1, stranded: 1 },
      { rarity: "ur", total: 1, done: 0, stranded: 1 },
    ]);
    expect(r.nStrandRate).toBe(0.5);
    expect(r.urStrandRate).toBe(1);
  });

  it("缺 UR 桶时 urStrandRate 为 null；空列表全空", () => {
    const r = rarityInflationOf([t({ rarity: "n", status: "done" })]);
    expect(r.urStrandRate).toBeNull();
    expect(r.nStrandRate).toBe(0);
    expect(rarityInflationOf([])).toEqual({
      byRarity: [],
      urStrandRate: null,
      nStrandRate: null,
    });
  });
});

describe("sourceStatsOf（三方占比）", () => {
  it("三方各计数 + 各方滞留率，空桶也返回（迷你条需要完整结构）", () => {
    const stats = sourceStatsOf([
      t({ source: "customer", status: "done" }),
      t({ source: "customer", status: "carried" }),
      t({ source: "platform", status: "todo" }),
    ]);
    expect(stats).toEqual([
      {
        source: "customer",
        total: 2,
        done: 1,
        stranded: 1,
        strandRate: 0.5,
      },
      { source: "platform", total: 1, done: 0, stranded: 0, strandRate: 0 },
      {
        source: "exploration",
        total: 0,
        done: 0,
        stranded: 0,
        strandRate: null,
      },
    ]);
  });

  it("空班次返回三方零桶", () => {
    expect(sourceStatsOf([])).toHaveLength(3);
    expect(sourceStatsOf([])[0].total).toBe(0);
  });
});

describe("suggestedLoadOf（昨日天气）", () => {
  const rows = (van: string, status: Task["status"], size: number | null) =>
    t({ vanCode: van, status, size });

  it("取上一班 done 任务（v1 口径）点数合计，size 为空不计", () => {
    const load = suggestedLoadOf(
      "DV2608A",
      ["DV2608A", "DV2607B"],
      [
        rows("DV2607B", "done", 3),
        rows("DV2607B", "done", 4),
        rows("DV2607B", "carried", 10),
        rows("DV2607B", "todo", 2),
        rows("DV2607B", "done", null),
        rows("DV2608A", "done", 8),
      ],
    );
    expect(load).toBe(7);
  });

  it("首班无历史返回 null", () => {
    expect(suggestedLoadOf("DV2608A", ["DV2608A"], [])).toBeNull();
    expect(suggestedLoadOf("DV2608A", [], [])).toBeNull();
  });

  it("跨月按编码字典序取紧邻上一班（加班车点数计入下一班天气）", () => {
    // vans 列表按最新在前传入（listVans 口径）；DV2608A 的上一班是 DV2607C（加班车）
    const load = suggestedLoadOf(
      "DV2608A",
      ["DV2608A", "DV2607C", "DV2607B"],
      [rows("DV2607C", "done", 6), rows("DV2607B", "done", 10)],
    );
    expect(load).toBe(6);
  });
});

describe("carryReasonStatsOf（滞留原因瀑布）", () => {
  it("只统计 stranded（carried）件，按枚举序输出，未分类殿后", () => {
    const stats = carryReasonStatsOf([
      t({ carryReason: "blocker", status: "carried" }),
      t({ carryReason: "blocker", status: "carried" }),
      t({ carryReason: "capacity", status: "carried" }),
      t({ carryReason: null, status: "carried" }),
      t({ carryReason: "estimate", status: "todo" }),
      t({ carryReason: "priority", status: "done" }),
    ]);
    expect(stats).toEqual([
      { reason: "blocker", count: 2 },
      { reason: "capacity", count: 1 },
      { reason: null, count: 1 },
    ]);
  });

  it("无滞留件返回空数组", () => {
    expect(carryReasonStatsOf([])).toEqual([]);
    expect(
      carryReasonStatsOf([t({ carryReason: "blocker", status: "done" })]),
    ).toEqual([]);
  });
});

describe("badgesOf（徽章 v1，实时推导不落库）", () => {
  const own = (
    van: string,
    status: Task["status"],
    owners: string[],
  ): Pick<Task, "vanCode" | "status"> & { owners: string[] } => ({
    vanCode: van,
    status,
    owners,
  });

  it("🚚 整班准点：本班全员送达点亮，有滞留或未完或空班不亮", () => {
    const vans = ["DV2607B", "DV2607A"];
    expect(
      badgesOf("DV2607B", vans, [own("DV2607B", "done", ["甲"])]).teamPunctual,
    ).toBe(true);
    expect(
      badgesOf("DV2607B", vans, [
        own("DV2607B", "done", ["甲"]),
        own("DV2607B", "carried", ["甲"]),
      ]).teamPunctual,
    ).toBe(false);
    expect(
      badgesOf("DV2607B", vans, [own("DV2607B", "todo", ["甲"])]).teamPunctual,
    ).toBe(false);
    expect(badgesOf("DV2607B", vans, []).teamPunctual).toBe(false);
  });

  it("📦 送达连击：成员连续 2 个班次其负责任务零滞留点亮；中途加入（仅 1 班）不亮", () => {
    const vans = ["DV2607B", "DV2607A"];
    const rows = [
      own("DV2607B", "done", ["甲"]),
      own("DV2607A", "done", ["甲"]),
      own("DV2607B", "done", ["新同学"]),
    ];
    expect(badgesOf("DV2607B", vans, rows).streaks).toEqual(["甲"]);
  });

  it("多人负责件对每个负责人各计一次；某班出现滞留件则断连击", () => {
    const vans = ["DV2607B", "DV2607A"];
    const rows = [
      own("DV2607B", "done", ["甲", "丙"]),
      own("DV2607A", "done", ["甲", "丙"]),
      own("DV2607A", "carried", ["乙"]),
      own("DV2607B", "carried", ["乙"]),
    ];
    const badges = badgesOf("DV2607B", vans, rows);
    expect(badges.streaks).toEqual(["丙", "甲"]);
    expect(badges.streaks).not.toContain("乙");
  });

  it("连击只看成员实际负责过件的班次（跳班不补给），最新班实时乐观计数", () => {
    // 甲在 DV2608A 与 DV2607A 有件（中间 DV2607B 无件）：两个「参与班」连续零滞留 → 点亮
    const vans = ["DV2608A", "DV2607B", "DV2607A"];
    const rows = [
      own("DV2608A", "doing", ["甲"]),
      own("DV2607A", "done", ["甲"]),
    ];
    expect(badgesOf("DV2608A", vans, rows).streaks).toEqual(["甲"]);
  });
});
