import { test, expect } from "@playwright/test";
import {
  waitForBoard,
  dispatchVan,
  addTaskAndWait,
  dataCell,
  selectEditorOption,
} from "./helpers";

/* ── v2.7 动线：需求类型（来源）动态化 + drop（放弃）出清。
 * 测试库整轮清空一次、班次跨用例累积；每个用例从「发新车」拿独立班次。
 * 口径断言锚在统计条的「未送达 / 共」——drop 出清即 total/remaining 同步缩小。
 */

test.describe.configure({ timeout: 60_000 });

test.describe("v2.7 需求类型动态化与 drop", () => {
  test.beforeEach(async ({ page }) => {
    await waitForBoard(page);
    await dispatchVan(page);
  });

  test("自定义类型动线：下拉哨兵项打开管理弹层新增「运营」→ 件选用 → 面板出现", async ({
    page,
  }) => {
    await addTaskAndWait(page);
    // 来源下拉的哨兵项打开类型管理弹层
    await selectEditorOption(page, "_source", "＋ 新增类型…");
    const dlg = page.getByRole("dialog", { name: "管理需求类型" });
    await expect(dlg).toBeVisible();
    await dlg.getByPlaceholder("新类型名（如：运营 / 技术债）").fill("运营");
    await dlg.getByRole("button", { name: "新增", exact: true }).click();
    await expect(page.getByText("需求类型已新增")).toBeVisible({
      timeout: 5000,
    });
    // 失败路径：新增撞内置显示名「客户」→ 错误 toast，输入保留可改后重试
    await dlg.getByPlaceholder("新类型名（如：运营 / 技术债）").fill("客户");
    await dlg.getByRole("button", { name: "新增", exact: true }).click();
    await expect(page.getByText("需求类型「客户」已存在")).toBeVisible({
      timeout: 5000,
    });
    await expect(
      dlg.getByPlaceholder("新类型名（如：运营 / 技术债）"),
    ).toHaveValue("客户");

    await dlg.getByRole("button", { name: "关闭" }).click();
    await expect(dlg).toBeHidden();

    // 回到来源列选「运营」并落库
    await selectEditorOption(page, "_source", "运营");
    await expect(dataCell(page, "_source")).toContainText("运营", {
      timeout: 5000,
    });

    // 统计面板来源页签出现该类型（1 件 100%）
    await page
      .getByRole("button", { name: "来源", exact: true })
      .first()
      .click();
    await expect(
      page.getByText("来源占比（统计条迷你条的同口径明细）"),
    ).toBeVisible();
    await expect(
      page.getByText("1 件 · 100%", { exact: false }).first(),
    ).toBeVisible();

    // 改名动线：管理弹层把「运营」改成「运营需求」，表格显示名同步、
    // 库里 tasks.source 仍是原 code「运营」（历史零迁移）
    await page.getByRole("button", { name: "管理类型" }).click();
    const mgr = page.getByRole("dialog", { name: "管理需求类型" });
    await expect(mgr).toBeVisible();
    await mgr.getByRole("button", { name: "改名" }).last().click();
    // 行内改名 input：按所在行过滤定位（弹层里还有一个底部「新增」输入框，
    // 不能用 input.last()——那会填错位置、草稿不变，改名幂等空转）
    // 行内改名 input 的定位：编辑态行是弹层里唯一含 input 的 li
    // （不能按行文本过滤——input 的 value 不计入 li 的 textContent）
    await mgr.locator("li").locator("input").fill("运营需求");
    await mgr.getByRole("button", { name: "确定" }).click();
    await expect(
      page.getByText("已改名（历史快件显示名同步生效）"),
    ).toBeVisible({ timeout: 5000 });
    await mgr.getByRole("button", { name: "关闭" }).click();
    await expect(dataCell(page, "_source")).toContainText("运营需求", {
      timeout: 5000,
    });
    const van = await page.getByLabel("班次").inputValue();
    const tasks = await page.evaluate(async (v: string) => {
      const res = await fetch(
        `/api/trpc/van.tasks.byVan?input=${encodeURIComponent(JSON.stringify({ json: { van: v } }))}`,
      );
      return (await res.json()).result.data.json as { source: string }[];
    }, van);
    expect(tasks[0]?.source).toBe("运营");
  });

  test("drop 出清与恢复：统计条分母随放弃缩小、恢复后还原", async ({
    page,
  }) => {
    await addTaskAndWait(page);
    await addTaskAndWait(page);
    await expect(page.getByText("2 / 2 件")).toBeVisible();

    // 第一件标放弃（无 owner 的单件件不弹确认；done 快捷确认只对「完成」弹）
    await selectEditorOption(page, "_status", "放弃");
    await expect(dataCell(page, "_status")).toHaveText("✕ 放弃", {
      timeout: 5000,
    });
    // 彻底出清：total 与 remaining 同步缩 1
    await expect(page.getByText("1 / 1 件")).toBeVisible({ timeout: 5000 });

    // 手动双向：drop 下拉只有恢复项，改回「未开始」后统计还原
    await selectEditorOption(page, "_status", "未开始");
    await expect(page.getByText("2 / 2 件")).toBeVisible({ timeout: 5000 });
  });

  test("done 件的下拉不提供「放弃」选项（服务端守卫的前置过滤）", async ({
    page,
  }) => {
    await addTaskAndWait(page);
    await selectEditorOption(page, "_status", "完成");
    await expect(dataCell(page, "_status")).toHaveText("完成", {
      timeout: 5000,
    });

    const cell = dataCell(page, "_status");
    await cell.dblclick();
    const combo = cell.getByRole("combobox");
    await expect(combo).toBeVisible({ timeout: 3000 });
    await combo.click();
    await expect(
      page.getByRole("option", { name: "放弃", exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  test("结转不带走 drop 件：弃置件留在原班保持放弃", async ({ page }) => {
    await addTaskAndWait(page); // 第一件 → 弃置
    await addTaskAndWait(page); // 第二件 → 正常滞留
    await selectEditorOption(page, "_status", "放弃");
    await expect(dataCell(page, "_status")).toHaveText("✕ 放弃", {
      timeout: 5000,
    });

    // 结转：只带走 todo 件（carried=1，drop 件不跟车）。
    // 等 vans.list 的 refetch 落地后再切班：toast 先于班次下拉刷新出现，
    // 抢跑 selectOption 会选到更旧的班
    const vansRefetched = page.waitForResponse(
      (r) => r.url().includes("van.vans.list") && r.status() === 200,
      { timeout: 8000 },
    );
    await page.getByRole("button", { name: "滞留件转下一班" }).click();
    await page.getByRole("button", { name: "确认结转" }).click();
    await expect(page.getByText("已把 1 个滞留件转上下一班车")).toBeVisible({
      timeout: 8000,
    });
    await vansRefetched;

    // 切回源班（最新在前，index 1 即上一班）：弃置件仍在原班且保持放弃
    await page.getByLabel("班次").selectOption({ index: 1 });
    await expect(dataCell(page, "_status")).toHaveText("✕ 放弃", {
      timeout: 5000,
    });
  });
});
