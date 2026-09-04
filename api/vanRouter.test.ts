import { describe, expect, it } from "vitest";
import {
  memberTag,
  sizePoints,
  sourceField,
  carryReasonField,
  requesterField,
  doneAtField,
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

describe("requesterField（提出人标签，v2.2 评审补强）", () => {
  it("接受 1~64 字符", () => {
    expect(requesterField.safeParse("天王寺").success).toBe(true);
    expect(requesterField.safeParse("名".repeat(64)).success).toBe(true);
  });

  it("拒绝空串（空串会让自驱件推导失效，件永久卡未签收统计）与超长", () => {
    expect(requesterField.safeParse("").success).toBe(false);
    expect(requesterField.safeParse("名".repeat(65)).success).toBe(false);
  });
});

describe("doneAtField（送达日期格式，v2.2 评审补强）", () => {
  it("接受 YYYY-MM-DD", () => {
    expect(doneAtField.safeParse("2026-09-04").success).toBe(true);
  });

  it("拒绝超长、非日期格式与空串（mysql 列为 varchar(16)，超长会裸报数据库错误）", () => {
    expect(doneAtField.safeParse("2026/09/04").success).toBe(false);
    expect(doneAtField.safeParse("2026-9-4").success).toBe(false);
    expect(doneAtField.safeParse("").success).toBe(false);
    expect(doneAtField.safeParse("2026-09-04T12:00:00Z").success).toBe(false);
  });
});
