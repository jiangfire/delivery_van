import { describe, expect, it } from "vitest";
import {
  memberTag,
  ownerPointsField,
  sourceField,
  carryReasonField,
  requesterField,
  doneAtField,
} from "./vanRouter";
import { taskAddInput } from "./schemas";

describe("memberTag（成员/负责人标签约束）", () => {
  it("拒绝含半角逗号的名称（历史上负责人列表用逗号聚合，禁令保留）", () => {
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

describe("ownerPointsField（每人点数：0~10 整数，1 点 = 半天）", () => {
  it("接受 0~10 任意整数（0 = 挂名不占运力）", () => {
    for (const p of [0, 1, 5, 10]) {
      expect(ownerPointsField.safeParse(p).success).toBe(true);
    }
  });

  it("拒绝超过 10、负数与非整数", () => {
    for (const p of [11, -1, 1.5]) {
      expect(ownerPointsField.safeParse(p).success).toBe(false);
    }
  });
});

describe("taskAddInput.owners（一个需求多个负责人时各自设置点数）", () => {
  it("接受 [{ name, points }]，每人一份自己的点数", () => {
    const r = taskAddInput.safeParse({
      van: "DV2607A",
      title: "多人件",
      owners: [
        { name: "甲", points: 3 },
        { name: "乙", points: 2 },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("拒绝没有点数的负责人（勾选不等于设置完成）", () => {
    const r = taskAddInput.safeParse({
      van: "DV2607A",
      title: "多人件",
      owners: [{ name: "甲" }],
    });
    expect(r.success).toBe(false);
  });

  it("拒绝同一人重复出现（重复会让点数被双计）", () => {
    const r = taskAddInput.safeParse({
      van: "DV2607A",
      title: "多人件",
      owners: [
        { name: "甲", points: 3 },
        { name: "甲", points: 2 },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("size 已不属于入参契约（传了也会被剥离）", () => {
    const r = taskAddInput.safeParse({
      van: "DV2607A",
      title: "件",
      size: 5,
    });
    expect(r.success).toBe(true);
    expect(r.success && "size" in r.data).toBe(false);
  });
});

describe("sourceField（需求类型，v2.7 动态化）", () => {
  it("接受内置三项与自定义类型（zod 只管形状，值域在数据层查 sources 表）", () => {
    for (const s of ["customer", "platform", "exploration", "运营", "技术债"]) {
      expect(sourceField.safeParse(s).success).toBe(true);
    }
  });

  it("拒绝空值、超长与首尾空白（16 字符与 mysql source 列宽对齐）", () => {
    expect(sourceField.safeParse("").success).toBe(false);
    expect(sourceField.safeParse("  ").success).toBe(false);
    expect(
      sourceField.safeParse("十七字十七字十七字十七字十七字十七字17").success,
    ).toBe(false);
  });

  it("拒绝「＋」开头（与来源下拉的新增哨兵项冲突）", () => {
    expect(sourceField.safeParse("＋ 新增类型…").success).toBe(false);
    expect(sourceField.safeParse("＋运营").success).toBe(false);
    expect(sourceField.safeParse("运营＋").success).toBe(true);
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
