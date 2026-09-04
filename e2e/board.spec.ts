import { test, expect } from "@playwright/test";
import { carryTargetCode } from "../contracts/vans";
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

    const optionsBefore = await page
      .getByLabel("班次")
      .locator("option")
      .count();
    await dispatchVan(page);
    await expect(page.getByLabel("班次").locator("option")).toHaveCount(
      optionsBefore + 1,
      {
        timeout: 5000,
      },
    );
    if (optionsBefore === 0) {
      // 首次运行只有一班，再发一班才能验证切换
      await dispatchVan(page);
      await expect(page.getByLabel("班次").locator("option")).toHaveCount(2, {
        timeout: 5000,
      });
    }

    // 最新班即当前班：› 禁用，‹ 切到上一班
    const newest = await page.getByLabel("班次").inputValue();
    await expect(page.getByRole("button", { name: "›" })).toBeDisabled();
    await page.getByRole("button", { name: "‹" }).click();
    await expect(page.getByLabel("班次")).not.toHaveValue(newest);
    // › 切回最新班
    await page.getByRole("button", { name: "›" }).click();
    await expect(page.getByLabel("班次")).toHaveValue(newest);
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

  test("档位为 1~10 点数可选", async ({ page }) => {
    await addTaskAndWait(page);
    const sizeCell = dataCell(page, "_size");
    await sizeCell.dblclick();
    const combo = sizeCell.getByRole("combobox");
    await expect(combo).toBeVisible({ timeout: 3000 });
    await combo.click();
    // 半天点数制：下拉提供 1~10 十个点档（富下拉选项渲染在页面级浮层）
    for (const p of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]) {
      await expect(
        page.getByRole("option", { name: p, exact: true }),
      ).toBeVisible();
    }
    await page.getByRole("option", { name: "7", exact: true }).click();
    await expect(sizeCell).toHaveText("7 点");
  });

  test("置完成自动记送达日期，取消完成清空日期", async ({ page }) => {
    await addTaskAndWait(page);
    const statusCell = dataCell(page, "_status");
    const doneAtCell = dataCell(page, "_doneAt");

    await selectEditorOption(page, "_status", "完成");
    await expect(statusCell).toHaveText("完成");
    await expect(doneAtCell).toHaveText(`📅 ${todayStr()}`, { timeout: 5000 });

    await selectEditorOption(page, "_status", "未开始");
    await expect(doneAtCell).toHaveText("完成后填写", { timeout: 5000 });
  });

  test("送达日期可手工补录与清除", async ({ page }) => {
    await addTaskAndWait(page);
    // 先置完成，送达日期列才可编辑
    await selectEditorOption(page, "_status", "完成");
    await expect(dataCell(page, "_status")).toHaveText("完成");

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

test.describe("行拖拽排序", () => {
  test.beforeEach(async ({ page }) => {
    await waitForBoard(page);
    await dispatchVan(page);
  });

  test("拖拽调整行顺序，刷新后保持", async ({ page }) => {
    // 造 3 行可区分的快件：先连加 3 行，再走接口改名（比三次行内编辑稳定）
    await addTaskAndWait(page);
    await addTaskAndWait(page);
    await addTaskAndWait(page);

    const van = await page.getByLabel("班次").inputValue();
    const tasks: { id: number }[] = await page.evaluate(async (v) => {
      const res = await fetch(
        `/api/trpc/van.tasks.byVan?input=${encodeURIComponent(JSON.stringify({ json: { van: v } }))}`,
      );
      return (await res.json()).result.data.json;
    }, van);
    expect(tasks).toHaveLength(3);
    for (const [i, title] of ["甲", "乙", "丙"].entries()) {
      await trpcCall(page, "van.tasks.update", { id: tasks[i].id, title });
    }
    await page.reload();
    await page.getByText("快递发车台").waitFor();

    const titleCells = page.locator('[role="gridcell"][col-id="title"]');
    await expect(titleCells).toHaveCount(3, { timeout: 5000 });
    // AG Grid 用 translateY 定位行，拖拽后 DOM 顺序 ≠ 视觉顺序，按 row-index 属性读
    const titles = () =>
      page.evaluate(() =>
        [...document.querySelectorAll(".ag-row[row-index]")]
          .sort(
            (a, b) =>
              Number(a.getAttribute("row-index")) -
              Number(b.getAttribute("row-index")),
          )
          .map(
            (r) =>
              r.querySelector('[col-id="title"]')?.textContent?.trim() ?? "",
          ),
      );
    expect(await titles()).toEqual(["甲", "乙", "丙"]);

    // 拖「甲」的手柄到末行（丙）底部边缘：落点在丙之后
    const reordered = page.waitForResponse(
      (r) => r.url().includes("van.tasks.reorder") && r.status() === 200,
      { timeout: 8000 },
    );
    const handle = page.locator('.ag-row[row-index="0"] .ag-drag-handle');
    const lastRow = page.locator('.ag-row[row-index="2"]');
    const hb = await handle.boundingBox();
    const lb = await lastRow.boundingBox();
    if (!hb || !lb) throw new Error("拖拽手柄或目标行未渲染");
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height - 2, {
      steps: 15,
    });
    await page.mouse.up();
    await reordered;

    // 等 invalidate 重取后的网格顺序落位
    await expect
      .poll(() => titles(), { timeout: 5000 })
      .toEqual(["乙", "丙", "甲"]);

    // 刷新后顺序保持（已持久化到 sort_order）
    await page.reload();
    await page.getByText("快递发车台").waitFor();
    await expect(titleCells).toHaveCount(3, { timeout: 5000 });
    expect(await titles()).toEqual(["乙", "丙", "甲"]);
  });
});

test.describe("长文本列显隐开关（v2.2）", () => {
  test("默认隐藏 → 开关显示 → 切班后保持", async ({ page }) => {
    await waitForBoard(page);
    // 独立两班 + 最新班一件快件（用例从「发新车」拿班次，不依赖其他用例）
    await dispatchVan(page);
    await dispatchVan(page);
    await addTaskAndWait(page);

    const accHeader = page.getByRole("columnheader", { name: "验收标准" });
    const noteHeader = page.getByRole("columnheader", { name: "备注" });
    await expect(accHeader).toBeHidden();
    await expect(noteHeader).toBeHidden();

    // 开关命令式显隐
    await page.getByLabel("验收标准").check();
    await expect(accHeader).toBeVisible();
    await expect(noteHeader).toBeHidden();

    // 切到未访问过的班次再切回（columnDefs 因加载窗口重建）：显隐须按开关状态保持
    await page.getByRole("button", { name: "‹" }).click();
    await expect(page.getByRole("button", { name: "›" })).toBeEnabled();
    await page.getByRole("button", { name: "›" }).click();
    await expect(accHeader).toBeVisible();
    await expect(noteHeader).toBeHidden();
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
    await page.getByLabel("班次").selectOption({ index: 1 });
    const fromVan = await page.getByLabel("班次").inputValue();
    // 与服务端同口径推导结转目标（已存在的最近一班优先），避免整轮跨月零点时推错
    const allVans = await page.locator("select option").allTextContents();
    const toVan = carryTargetCode(fromVan, allVans, new Date());

    await page.getByRole("button", { name: "滞留件转下一班" }).click();
    await page.getByRole("button", { name: "确认结转" }).click();
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
    await page.getByLabel("班次").selectOption({ index: 1 });
    await page.getByRole("button", { name: "滞留件转下一班" }).click();
    await page.getByRole("button", { name: "确认结转" }).click();
    await expect(dataCell(page, "_status")).toHaveText("🔁 结转", {
      timeout: 5000,
    });

    // 第二班再结转 → 第三班（目标班不存在时自动创建）
    await page.getByLabel("班次").selectOption({ index: 0 });
    await page.getByRole("button", { name: "滞留件转下一班" }).click();
    await page.getByRole("button", { name: "确认结转" }).click();
    await expect(dataCell(page, "_status")).toHaveText("🔁 结转", {
      timeout: 5000,
    });

    // 第三班：连续滞留 2 班 → ⚠️ 复盘提示 + 强制复盘计数
    await page.getByLabel("班次").selectOption({ index: 0 });
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
    await selectEditorOption(page, "_status", "完成");
    await expect(dataCell(page, "_status")).toHaveText("完成", {
      timeout: 5000,
    });

    await page.getByRole("button", { name: "滞留件转下一班" }).click();
    await page.getByRole("button", { name: "确认结转" }).click();
    await expect(page.getByText("本班次全部送达，没有滞留件")).toBeVisible({
      timeout: 4000,
    });

    // 无结转发生：状态不变、滞留率 0%、班次保持可编辑
    await expect(dataCell(page, "_status")).toHaveText("完成");
    await expect(page.getByText("0%", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "+ 快件" })).toBeEnabled();
    await expect(page.getByText("已结转 · 归档")).toBeHidden();
  });
});
