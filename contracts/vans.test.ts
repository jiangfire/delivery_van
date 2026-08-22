import { describe, expect, it } from "vitest";
import {
  VAN_CODE_RE,
  carryTargetCode,
  firstVanCodeOf,
  isVanCode,
  nextVanCode,
  nextVanCodeFrom,
  parse,
} from "./vans";

describe("isVanCode / VAN_CODE_RE", () => {
  it("接受合法编码（字母 A–Z）", () => {
    expect(isVanCode("DV2607A")).toBe(true);
    expect(isVanCode("DV2612Z")).toBe(true);
    expect(isVanCode("DV2601M")).toBe(true);
  });

  it("拒绝非法月份、非法字母、小写、旧周次格式", () => {
    expect(isVanCode("DV2613A")).toBe(false);
    expect(isVanCode("DV2600A")).toBe(false);
    expect(isVanCode("DV26070A")).toBe(false);
    expect(isVanCode("DV2607a")).toBe(false);
    expect(isVanCode("2026-W27")).toBe(false);
    expect(VAN_CODE_RE.test("rr2607a")).toBe(false);
  });
});

describe("nextVanCode", () => {
  it("同月递增：DV2607A → DV2607B", () => {
    expect(nextVanCode("DV2607A")).toBe("DV2607B");
  });

  it("Y → Z 仍在同月：DV2607Y → DV2607Z", () => {
    expect(nextVanCode("DV2607Y")).toBe("DV2607Z");
  });

  it("Z 换月换字母：DV2607Z → DV2608A", () => {
    expect(nextVanCode("DV2607Z")).toBe("DV2608A");
  });

  it("12 月 Z 跨年：DV2612Z → DV2701A", () => {
    expect(nextVanCode("DV2612Z")).toBe("DV2701A");
  });

  it("对格式非法的编码抛错", () => {
    expect(() => nextVanCode("2026-W27")).toThrow();
  });
});

describe("firstVanCodeOf", () => {
  it("返回该年月的 A 班车", () => {
    expect(firstVanCodeOf(new Date(2026, 6, 15))).toBe("DV2607A");
    expect(firstVanCodeOf(new Date(2026, 0, 1))).toBe("DV2601A");
    expect(firstVanCodeOf(new Date(2026, 11, 31))).toBe("DV2612A");
  });
});

describe("nextVanCodeFrom（跨月感知）", () => {
  it("同月内字母 +1：DV2608A + 8月 → DV2608B", () => {
    expect(nextVanCodeFrom("DV2608A", new Date(2026, 7, 15))).toBe("DV2608B");
  });

  it("跨月从新月份 A 重新计数：DV2607E + 8月 → DV2608A", () => {
    expect(nextVanCodeFrom("DV2607E", new Date(2026, 7, 1))).toBe("DV2608A");
  });

  it("跨年：DV2612B + 次年 1 月 → DV2701A", () => {
    expect(nextVanCodeFrom("DV2612B", new Date(2027, 0, 10))).toBe("DV2701A");
  });

  it("当月已到 Z：再发车跨月回 A（DV2608Z + 8月 → DV2609A）", () => {
    expect(nextVanCodeFrom("DV2608Z", new Date(2026, 7, 28))).toBe("DV2609A");
  });
});

describe("carryTargetCode（结转目标）", () => {
  const jul = new Date(2026, 6, 20);
  const aug = new Date(2026, 7, 5);

  it("优先取已存在的最近一班：DV2607E 结转时 DV2608A 已发 → DV2608A", () => {
    expect(
      carryTargetCode("DV2607E", ["DV2608A", "DV2607A", "DV2607E"], aug),
    ).toBe("DV2608A");
  });

  it("没有下一班时同月推导：DV2607A → DV2607B（由调用方自动创建）", () => {
    expect(carryTargetCode("DV2607A", ["DV2607A"], jul)).toBe("DV2607B");
  });

  it("没有下一班且已跨月：DV2607E + 8月 → DV2608A（由调用方自动创建）", () => {
    expect(carryTargetCode("DV2607E", ["DV2607E"], aug)).toBe("DV2608A");
  });
});

describe("parse", () => {
  it("解析合法编码并返回 year、month、nth", () => {
    const result = parse("DV2607A");
    expect(result).toEqual({ year: 2026, month: 7, nth: 1 });
  });

  it("解析年末编码", () => {
    const result = parse("DV2612Z");
    expect(result).toEqual({ year: 2026, month: 12, nth: 26 });
  });

  it("解析中间字母", () => {
    const result = parse("DV2607M");
    expect(result).toEqual({ year: 2026, month: 7, nth: 13 });
  });

  it("非法编码抛出错误", () => {
    expect(() => parse("2026-W27")).toThrow("非法班次编码");
    expect(() => parse("DV2607a")).toThrow("非法班次编码");
    expect(() => parse("")).toThrow("非法班次编码");
  });
});
