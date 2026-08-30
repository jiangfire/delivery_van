import { describe, expect, it } from "vitest";
import {
  memberTag,
  sizePoints,
  sourceField,
  carryReasonField,
} from "./vanRouter";

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

describe("sourceField（三方占比枚举）", () => {
  it("接受 customer / platform / exploration", () => {
    for (const s of ["customer", "platform", "exploration"]) {
      expect(sourceField.safeParse(s).success).toBe(true);
    }
  });

  it("拒绝任意字符串与空值（默认值在数据层兜底）", () => {
    expect(sourceField.safeParse("顾客").success).toBe(false);
    expect(sourceField.safeParse("").success).toBe(false);
  });
});

describe("carryReasonField（结转原因枚举）", () => {
  it("接受五枚举：需求变更/依赖阻塞/估算偏差/产能不足/优先级被挤", () => {
    for (const r of [
      "requirement-change",
      "blocker",
      "estimate",
      "capacity",
      "priority",
    ]) {
      expect(carryReasonField.safeParse(r).success).toBe(true);
    }
  });

  it("拒绝枚举外的值（swap 让位原因 Phase 2 才引入）", () => {
    expect(carryReasonField.safeParse("swap").success).toBe(false);
    expect(carryReasonField.safeParse("").success).toBe(false);
  });
});
