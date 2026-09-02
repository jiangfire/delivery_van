import { test, expect, type Page } from "@playwright/test";
import {
  dispatchVan,
  addTaskAndWait,
  dataCell,
  waitForTaskUpdate,
} from "./helpers";

/** 把第一行任务状态改为 done，刷新页面生效 */
async function setFirstTaskDone(page: Page) {
  const van = await page.getByLabel("班次").inputValue();
  await page.evaluate(
    async ([v]) => {
      const res = await fetch(
        `/api/trpc/van.tasks.byVan?input=${encodeURIComponent(JSON.stringify({ json: { van: v } }))}`,
      );
      const { result } = await res.json();
      const task = result?.data?.json?.[0];
      if (task) {
        await fetch("/api/trpc/van.tasks.update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ json: { id: task.id, status: "done" } }),
        });
      }
    },
    [van],
  );
  await page.reload();
  await expect(page.getByText("快递发车台")).toBeVisible();
  // 等待数据加载
  await page.waitForTimeout(500);
}

/* ── 测试 ── */

test.describe("Bug 回归：快件编辑", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("快递发车台")).toBeVisible();
    await dispatchVan(page);
  });

  test("新增快件的稀有度可修改并保存", async ({ page }) => {
    await addTaskAndWait(page);

    const rarityCell = dataCell(page, "_rarity");
    await expect(rarityCell).toHaveText("N");
    await rarityCell.dblclick();

    const option = page.getByText("SR", { exact: true });
    await expect(option).toBeVisible({ timeout: 3000 });
    await option.click();

    // onClose 直接传值 → valueSetter 同步写入
    await expect(rarityCell).toHaveText("SR", { timeout: 3000 });

    // 持久化验证
    await page.getByText("快递发车台").first().click();
    await page.waitForTimeout(600);
    await expect(rarityCell).toHaveText("SR");
  });

  test("新增快件的提出人可修改并保存", async ({ page }) => {
    await addTaskAndWait(page);

    const requesterCell = dataCell(page, "_requester");
    await requesterCell.dblclick();

    // 弹出提出人面板 — 通过"无" radio 选项验证基本编辑流程
    const noneOption = page.getByText("无", { exact: true });
    await expect(noneOption).toBeVisible({ timeout: 3000 });

    // 选择"无"验证面板关闭
    await noneOption.click();
    await page.waitForTimeout(300);

    // 再次打开，通过输入框新增成员
    await requesterCell.dblclick();
    await expect(noneOption).toBeVisible({ timeout: 3000 });

    const nameInput = page.getByPlaceholder("新成员名称");
    await nameInput.fill("测试员");
    await nameInput.press("Enter");

    // submitNew → setValue + onClose → 面板关闭，值写入
    await page.waitForTimeout(500);
    const text = await requesterCell.textContent();
    expect(text?.trim()).toBe("测试员");
  });

  test("提出人可清空并持久化（选「无」）", async ({ page }) => {
    await addTaskAndWait(page);

    // 先设置一个提出人（输入框新增成员并选中）
    const requesterCell = dataCell(page, "_requester");
    await requesterCell.dblclick();
    const nameInput = page.getByPlaceholder("新成员名称");
    await nameInput.fill("临时提出人");
    await nameInput.press("Enter");
    await expect(requesterCell).toHaveText("临时提出人", {
      timeout: 3000,
    });

    // 重新打开，选「无」清空
    await requesterCell.dblclick();
    const noneOption = page.getByText("无", { exact: true });
    await expect(noneOption).toBeVisible({ timeout: 3000 });
    const updated = waitForTaskUpdate(page);
    await noneOption.click();
    await updated;
    await expect(requesterCell).toHaveText("", { timeout: 5000 });

    // 持久化验证
    await page.reload();
    await expect(page.getByText("快递发车台")).toBeVisible();
    await expect(dataCell(page, "_requester")).toHaveText("", {
      timeout: 5000,
    });
  });

  test("送达日期弹框点击外部自动关闭", async ({ page }) => {
    // 先创建一个任务
    await addTaskAndWait(page);

    // 通过 API 把这个任务状态改为 done
    await setFirstTaskDone(page);

    // 双击送达日期打开弹框
    const doneAtCell = dataCell(page, "_doneAt");
    await doneAtCell.dblclick();

    const popup = page.getByText("选择送达日期");
    await expect(popup).toBeVisible({ timeout: 3000 });

    // 点击标题触发外部点击 → 弹框关闭
    await page.getByText("快递发车台").first().click();
    await expect(popup).toBeHidden({ timeout: 3000 });
  });

  test("结转后旧班次数据同步更新（状态标记🔁结转、滞留率）", async ({
    page,
  }) => {
    await addTaskAndWait(page);

    // 发第二班车并切回旧车（下拉里选旧班次）
    await dispatchVan(page);
    await page.getByLabel("班次").selectOption({ index: 1 });
    const fromVan = await page.getByLabel("班次").inputValue();

    // 旧车有 1 个未完成任务，结转后滞留率应为 100%
    await page.getByRole("button", { name: "滞留件转下一班" }).click();
    await page.getByRole("button", { name: "确认结转" }).click();

    // 旧车：任务状态变为 🔁结转，统计条滞留率更新为 100%
    await expect(dataCell(page, "_status")).toHaveText("🔁 结转", {
      timeout: 5000,
    });
    await expect(page.getByText("100%", { exact: true }).first()).toBeVisible();

    // 旧车归档只读：头部出现归档标识，新增/删除/再结转均禁用
    await expect(page.getByText("已结转 · 归档")).toBeVisible();
    await expect(page.getByRole("button", { name: "+ 快件" })).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "滞留件转下一班" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "删除" }).first(),
    ).toBeDisabled();

    // 双击标题不应进入编辑态（断言限定在网格单元格内——表格上方的列显隐开关本身是合法 input）
    await dataCell(page, "title").dblclick();
    await expect(
      page.locator('[role="gridcell"] input, [role="gridcell"] textarea'),
    ).toHaveCount(0);
    await page.waitForTimeout(300);

    // 新车：任务以滞留件形式出现，结转记录标记来源班次
    await page.getByLabel("班次").selectOption({ index: 0 });
    await expect(
      page.locator('[role="gridcell"][col-id="_carry"]').first(),
    ).toContainText(fromVan, { timeout: 5000 });
  });
});
