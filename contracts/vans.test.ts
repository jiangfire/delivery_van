import { describe, expect, it } from "vitest";
import {
  VAN_CODE_RE,
  currentStageIdx,
  fridayOf,
  isVanCode,
  mondayOf,
  nextVanCode,
  prevVanCode,
  vanCodeOf,
  vanRange,
} from "./vans";

/** 构造 UTC 日期，避免测试受时区影响 */
function d(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m - 1, day));
}

describe("vanCodeOf", () => {
  it("周五当天锚定班次：2026-07-03（7月第一个周五）→ DV2607A", () => {
    expect(vanCodeOf(d(2026, 7, 3))).toBe("DV2607A");
  });

  it("同一周的周一与周五同班次：2026-06-29（周一）→ DV2607A", () => {
    expect(vanCodeOf(d(2026, 6, 29))).toBe("DV2607A");
  });

  it("当月第二个周五 → B：2026-07-10 所在周 → DV2607B", () => {
    expect(vanCodeOf(d(2026, 7, 6))).toBe("DV2607B");
    expect(vanCodeOf(d(2026, 7, 10))).toBe("DV2607B");
  });

  it("当月第五个周五 → E：2026-07-31 所在周 → DV2607E", () => {
    expect(vanCodeOf(d(2026, 7, 31))).toBe("DV2607E");
  });

  it("跨月归属看周五：2026-08-03（周一，周五为 8/7）→ DV2608A", () => {
    expect(vanCodeOf(d(2026, 8, 3))).toBe("DV2608A");
  });

  it("周末仍归本周：2026-07-04（周六）→ DV2607A", () => {
    expect(vanCodeOf(d(2026, 7, 4))).toBe("DV2607A");
    expect(vanCodeOf(d(2026, 7, 5))).toBe("DV2607A");
  });
});

describe("mondayOf / fridayOf", () => {
  it("DV2607A 的周五是 2026-07-03，周一是 2026-06-29", () => {
    expect(fridayOf("DV2607A")).toEqual(d(2026, 7, 3));
    expect(mondayOf("DV2607A")).toEqual(d(2026, 6, 29));
  });

  it("对不存在的班次（当月没有第 5 个周五）抛错", () => {
    // 2026-06 只有 4 个周五（6/5、12、19、26）
    expect(() => fridayOf("DV2606E")).toThrow();
  });

  it("对格式非法的编码抛错", () => {
    expect(() => fridayOf("2026-W27")).toThrow();
  });
});

describe("nextVanCode / prevVanCode", () => {
  it("同月递增：DV2607A → DV2607B", () => {
    expect(nextVanCode("DV2607A")).toBe("DV2607B");
  });

  it("第 4 个周五后可能仍是同月：DV2607D → DV2607E", () => {
    expect(nextVanCode("DV2607D")).toBe("DV2607E");
  });

  it("月末换月换字母：DV2607E → DV2608A", () => {
    expect(nextVanCode("DV2607E")).toBe("DV2608A");
  });

  it("上月回退按上月实际周五数：DV2607A → DV2606D（6 月只有 4 个周五）", () => {
    expect(prevVanCode("DV2607A")).toBe("DV2606D");
  });

  it("跨年：DV2601A 的上一班在 2025 年 12 月", () => {
    expect(prevVanCode("DV2601A")).toMatch(/^DV2512[A-E]$/);
    expect(nextVanCode(prevVanCode("DV2601A"))).toBe("DV2601A");
  });
});

describe("isVanCode / VAN_CODE_RE", () => {
  it("接受合法编码", () => {
    expect(isVanCode("DV2607A")).toBe(true);
    expect(isVanCode("DV2612E")).toBe(true);
  });

  it("拒绝非法月份、非法字母、旧周次格式", () => {
    expect(isVanCode("DV2613A")).toBe(false);
    expect(isVanCode("DV2607F")).toBe(false);
    expect(isVanCode("DV26070A")).toBe(false);
    expect(isVanCode("2026-W27")).toBe(false);
    expect(VAN_CODE_RE.test("rr2607a")).toBe(false);
  });
});

describe("vanRange", () => {
  it("展示周一至周五：DV2607A → 6/29 – 7/3", () => {
    expect(vanRange("DV2607A")).toBe("6/29 – 7/3");
  });
});

describe("currentStageIdx", () => {
  it("返回值均在阶段下标范围内", () => {
    for (const idx of currentStageIdx()) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThanOrEqual(2);
    }
  });
});
