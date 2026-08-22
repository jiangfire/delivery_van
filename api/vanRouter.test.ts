import { describe, expect, it } from "vitest";
import { memberTag } from "./vanRouter";

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
