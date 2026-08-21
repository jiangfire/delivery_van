import { describe, expect, it } from "vitest";

/* ── 纯函数：可从 MultiSelectEditor 提取的逻辑 ── */

/** 向列表追加一项（去重），返回新数组 */
export function addItem(list: string[], item: string): string[] {
  return list.includes(item) ? list : [...list, item];
}

/** 从列表移除一项，返回新数组 */
export function removeItem(list: string[], item: string): string[] {
  return list.filter((n) => n !== item);
}

/** 合并已有列表与新选列表（去重、保序：先保留 old 顺序，再追加 new 中独有的） */
export function mergeSelected(old: string[], fresh: string[]): string[] {
  const result = [...old];
  for (const item of fresh) {
    if (!result.includes(item)) result.push(item);
  }
  return result;
}

// ── addItem ──

describe("addItem", () => {
  it("追加新成员", () => {
    expect(addItem(["A"], "B")).toEqual(["A", "B"]);
  });

  it("去重：已有成员不重复添加", () => {
    expect(addItem(["A", "B"], "A")).toEqual(["A", "B"]);
  });

  it("空列表追加", () => {
    expect(addItem([], "X")).toEqual(["X"]);
  });

  it("不修改原数组", () => {
    const orig = ["A"];
    addItem(orig, "B");
    expect(orig).toEqual(["A"]);
  });
});

// ── removeItem ──

describe("removeItem", () => {
  it("移除已有成员", () => {
    expect(removeItem(["A", "B", "C"], "B")).toEqual(["A", "C"]);
  });

  it("移除不存在的成员，列表不变", () => {
    expect(removeItem(["A"], "Z")).toEqual(["A"]);
  });

  it("空列表", () => {
    expect(removeItem([], "A")).toEqual([]);
  });

  it("不修改原数组", () => {
    const orig = ["A", "B"];
    removeItem(orig, "A");
    expect(orig).toEqual(["A", "B"]);
  });
});

// ── mergeSelected ──

describe("mergeSelected", () => {
  it("合并两个不重叠列表", () => {
    expect(mergeSelected(["A"], ["B", "C"])).toEqual(["A", "B", "C"]);
  });

  it("去重：重叠项保留 old 中的位置", () => {
    expect(mergeSelected(["A", "B"], ["B", "C"])).toEqual(["A", "B", "C"]);
  });

  it("fresh 为空", () => {
    expect(mergeSelected(["A"], [])).toEqual(["A"]);
  });

  it("old 为空", () => {
    expect(mergeSelected([], ["X"])).toEqual(["X"]);
  });

  it("保序：old 的顺序优先", () => {
    expect(mergeSelected(["C", "A"], ["A", "B"])).toEqual(["C", "A", "B"]);
  });
});
