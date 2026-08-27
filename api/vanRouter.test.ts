import { describe, expect, it } from "vitest";
import { memberTag, sizePoints } from "./vanRouter";

describe("memberTag（成员/负责人标签约束）", () => {
  it("拒绝含半角逗号的名称（负责人列表用逗号聚合，含逗号会错拆标签）", () => {
    expect(memberTag.safeParse("张三,李四").success).toBe(false);
  });

  it("接受正常名称与全角逗号", () => {
    expect(memberTag.safeParse("张三").success).toBe(true);
    expect(memberTag.safeParse("张三，李四").success).toBe(true);
  });

  it("自动 trim，trim 后为空则拒绝", () => {
    expect(memberTag.safeParse("  张三  ").success).toBe(true);
    expect(memberTag.safeParse("   ").success).toBe(false);
  });

  it("超过 64 字符拒绝", () => {
    expect(memberTag.safeParse("名".repeat(65)).success).toBe(false);
  });
});

describe("sizePoints（半天点数制：1 点 = 半天，10 点 = 五天）", () => {
  it("接受 1~10 任意整数", () => {
    for (const p of [1, 2, 3, 7, 10]) {
      expect(sizePoints.safeParse(p).success).toBe(true);
    }
  });

  it("拒绝 0、超过 10 与非整数", () => {
    for (const p of [0, 11, 1.5, -1]) {
      expect(sizePoints.safeParse(p).success).toBe(false);
    }
  });
});
