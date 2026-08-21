import { test, expect } from "@playwright/test";
import { nextVanCode } from "../contracts/vans";
import {
  waitForBoard,
  dispatchVan,
  addTaskAndWait,
  dataCell,
  todayStr,
  trpcCall,
  cellTagGaps,
  selectEditorOption,
  waitForTaskUpdate,
} from "./helpers";

/* ── 看板核心操作回归（防倒退） ──
 * 测试库由 global-setup 整轮清空一次，班次跨用例累积；
 * 用例一律从「发新车」拿独立班次，不依赖执行顺序。
 */

test.describe("发车与班次切换", () => {
  test("发新车递增班次，箭头与下拉可切换，+快件常驻顶部", async ({ page }) => {
    await waitForBoard(page);

    // + 快件在首屏顶部可见（无需滚到表格底部）
    await expect(page.getByRole("button", { name: "+ 快件" })).toBeInViewport();

    const optionsBefore = await page.locator("select option").count();
    await dispatchVan(page);
    await expect(page.locator("select option")).toHaveCount(optionsBefore + 1, {
      timeout: 5000,
    });
    if (optionsBefore === 0) {
      // 首次运行只有一班，再发一班才能验证切换
      await dispatchVan(page);
      await expect(page.locator("select option")).toHaveCount(2, {
        timeout: 5000,
      });
    }

    // 最新班即当前班：› 禁用，‹ 切到上一班
    const newest = await page.locator("select").inputValue();
    await expect(page.getByRole("button", { name: "›" })).toBeDisabled();
    await page.getByRole("button", { name: "‹" }).click();
    await expect(page.locator("select")).not.toHaveValue(newest);
    // › 切回最新班
    await page.getByRole("button", { name: "›" }).click();
    await expect(page.locator("select")).toHaveValue(newest);
  });
});

test.describe("快件增删改", () => {
  test.beforeEach(async ({ page }) => {
    await waitForBoard(page);
    await dispatchVan(page);
  });

  test("编辑标题并持久化", async ({ page }) => {
    await addTaskAndWait(page);
    const titleCell = dataCell(page, "title");
    await titleCell.dblclick();
    const input = titleCell.locator("input");
    await expect(input).toBeVisible({ timeout: 3000 });
    await input.fill("优惠券接口联调");
    // 等更新请求落库再继续：单元格显示的是本地值，立即 reload 会中止在途请求造成假性丢数据
    const updated = waitForTaskUpdate(page);
    await input.press("Enter");
    await updated;
    await expect(titleCell).toHaveText("优惠券接口联调");

    await page.reload();
    await expect(page.getByText("快递发车台")).toBeVisible();
    await expect(titleCell).toHaveText("优惠券接口联调", { timeout: 5000 });
  });

  test("档位仅 1/3/5 三档可选", async ({ page }) => {
    await addTaskAndWait(page);
    const sizeCell = dataCell(page, "_size");
    await sizeCell.dblclick();
    const combo = sizeCell.getByRole("combobox");
    await expect(combo).toBeVisible({ timeout: 3000 });
    await combo.click();
    // 下拉只提供 1 / 3 / 5 三档（富下拉选项渲染在页面级浮层）
    for (const tier of ["1", "3", "5"]) {
      await expect(
        page.getByRole("option", { name: tier, exact: true }),
      ).toBeVisible();
    }
    await page.getByRole("option", { name: "3", exact: true }).click();
    await expect(sizeCell).toHaveText("3 天");
  });

  test("置完成自动记送达日期，取消完成清空日期", async ({ page }) => {
    await addTaskAndWait(page);
    const statusCell = dataCell(page, "_status");
    const doneAtCell = dataCell(page, "_doneAt");

    await selectEditorOption(page, "_status", "done");
    await expect(statusCell).toHaveText("done");
    await expect(doneAtCell).toHaveText(`📅 ${todayStr()}`, { timeout: 5000 });

    await selectEditorOption(page, "_status", "todo");
    await expect(doneAtCell).toHaveText("完成后填写", { timeout: 5000 });
  });

  test("送达日期可手工补录与清除", async ({ page }) => {
    await addTaskAndWait(page);
    // 先置完成，送达日期列才可编辑
    await selectEditorOption(page, "_status", "done");
    await expect(dataCell(page, "_status")).toHaveText("done");

    const doneAtCell = dataCell(page, "_doneAt");
    await doneAtCell.dblclick();
    const dateInput = page.locator('input[type="date"]');
    await expect(dateInput).toBeVisible();
    await dateInput.fill("2026-08-15");
    // 选完日期弹框自动关闭并保存
    await expect(page.getByText("选择送达日期")).toBeHidden({ timeout: 3000 });
    await expect(doneAtCell).toHaveText("📅 2026-08-15", { timeout: 5000 });

    await doneAtCell.dblclick();
    await page.getByRole("button", { name: "清除日期" }).click();
    await expect(doneAtCell).toHaveText("", { timeout: 5000 });
  });

  test("负责人多选：选中成员、标签保存并垂直居中", async ({ page }) => {
    // 预置成员（API 直建）：编辑中途新增成员会触发列表刷新销毁编辑器，故不走面板新增
    await trpcCall(page, "van.members.add", { name: "周七" });
    await trpcCall(page, "van.members.add", { name: "吴八" });
    await page.reload();
    await page.getByText("快递发车台").waitFor();

    await addTaskAndWait(page);

    const ownersCell = dataCell(page, "_owners");
    await ownersCell.dblclick();

    // 输入框回车选中已有成员 + 勾选另一成员
    const nameInput = page.getByPlaceholder("新成员名称");
    await nameInput.fill("周七");
    await nameInput.press("Enter");
    await page
      .locator("label")
      .filter({ hasText: "吴八" })
      .locator('input[type="checkbox"]')
      .check();
    // 等更新落库再断言/刷新（单元格会先显示本地值）
    const updated = waitForTaskUpdate(page);
    await page.getByRole("button", { name: "确定" }).click();
    await updated;

    await expect(ownersCell).toContainText("周七");
    await expect(ownersCell).toContainText("吴八");

    // 持久化
    await page.reload();
    await expect(page.getByText("快递发车台")).toBeVisible();
    await expect(dataCell(page, "_owners")).toContainText("周七", {
      timeout: 5000,
    });

    // 标签在单元格内垂直居中（上下留白对称）
    const gaps = await cellTagGaps(page, "_owners");
    if (!gaps) throw new Error("负责人标签未渲染，无法度量居中");
    expect(Math.abs(gaps.top - gaps.bottom)).toBeLessThanOrEqual(2);
  });

  test("删除快件需确认，取消则不删", async ({ page }) => {
    await addTaskAndWait(page);
    const delBtn = page.getByRole("button", { name: "删除" }).first();

    // Playwright 默认关闭确认框 → 取消删除，行保留
    await delBtn.click();
    await expect(
      page.locator('[role="gridcell"]').filter({ hasText: "新快件" }).first(),
    ).toBeVisible({ timeout: 3000 });

    page.once("dialog", (d) => d.accept());
    await delBtn.click();
    await expect(
      page.getByText("还没有快件，点上方「+ 快件」添加"),
    ).toBeVisible({ timeout: 5000 });
  });
});

test.describe("滞留件结转与归档", () => {
  test.beforeEach(async ({ page }) => {
    await waitForBoard(page);
    await dispatchVan(page);
  });

  test("结转后旧班归档，重复结转被服务端拒绝（幂等）", async ({ page }) => {
    await addTaskAndWait(page);
    await dispatchVan(page); // 第二班
    // 切回旧班结转
    await page.locator("select").selectOption({ index: 1 });
    const fromVan = await page.locator("select").inputValue();
    const toVan = nextVanCode(fromVan);

    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "滞留件转下一班" }).click();
    await expect(page.getByText("已把 1 个滞留件转上下一班车")).toBeVisible({
      timeout: 4000,
    });
    await expect(dataCell(page, "_status")).toHaveText("🔁 结转", {
      timeout: 5000,
    });

    // 绕过 UI 直调接口：同一对班次幂等，服务端拒绝
    const res = await trpcCall(page, "van.carry.run", { fromVan, toVan });
    expect(JSON.stringify(res)).toContain("请勿重复操作");
  });

  test("连续滞留两班触发强制复盘，负责人标签随件转运", async ({ page }) => {
    await addTaskAndWait(page);
    // 给快件挂负责人
    const ownersCell = dataCell(page, "_owners");
    await ownersCell.dblclick();
    const nameInput = page.getByPlaceholder("新成员名称");
    await nameInput.fill("郑十");
    await nameInput.press("Enter");
    await page.getByRole("button", { name: "确定" }).click();
    await expect(ownersCell).toContainText("郑十");

    await dispatchVan(page); // 第二班
    // 第一班结转 → 第二班
    await page.locator("select").selectOption({ index: 1 });
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "滞留件转下一班" }).click();
    await expect(dataCell(page, "_status")).toHaveText("🔁 结转", {
      timeout: 5000,
    });

    // 第二班再结转 → 第三班（目标班不存在时自动创建）
    await page.locator("select").selectOption({ index: 0 });
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "滞留件转下一班" }).click();
    await expect(dataCell(page, "_status")).toHaveText("🔁 结转", {
      timeout: 5000,
    });

    // 第三班：连续滞留 2 班 → ⚠️ 复盘提示 + 强制复盘计数
    await page.locator("select").selectOption({ index: 0 });
    const carryCell = dataCell(page, "_carry");
    await expect(carryCell).toContainText("⚠️", { timeout: 5000 });
    await expect(page.getByText("1 个", { exact: true })).toBeVisible();
    // 负责人标签随件转运
    await expect(dataCell(page, "_owners")).toContainText("郑十");
    // 滞留徽章垂直居中
    const gaps = await cellTagGaps(page, "_carry");
    if (!gaps) throw new Error("结转徽章未渲染，无法度量居中");
    expect(Math.abs(gaps.top - gaps.bottom)).toBeLessThanOrEqual(2);
  });

  test("全部送达的班次结转无滞留件，且不归档", async ({ page }) => {
    await addTaskAndWait(page);
    await selectEditorOption(page, "_status", "done");
    await expect(dataCell(page, "_status")).toHaveText("done", {
      timeout: 5000,
    });

    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "滞留件转下一班" }).click();
    await expect(page.getByText("本班次全部送达，没有滞留件")).toBeVisible({
      timeout: 4000,
    });

    // 无结转发生：状态不变、滞留率 0%、班次保持可编辑
    await expect(dataCell(page, "_status")).toHaveText("done");
    await expect(page.getByText("0%", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ 快件" })).toBeEnabled();
    await expect(page.getByText("已结转 · 归档")).toBeHidden();
  });
});
