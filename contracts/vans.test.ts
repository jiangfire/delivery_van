import { describe, expect, it } from "vitest";
import { VAN_CODE_RE, firstVanCodeOf, isVanCode, nextVanCode } from "./vans";

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
