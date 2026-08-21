import { test, expect, type Page } from "@playwright/test";

/* ── 辅助函数 ── */

async function dispatchVan(page: Page) {
  await page.getByRole("button", { name: "发新车" }).click();
  await expect(page.locator("select")).toBeVisible({ timeout: 5000 });
}

async function addTaskAndWait(page: Page) {
  await page.getByRole("button", { name: "+ 快件" }).click();
  await expect(
    page.locator('[role="gridcell"]').filter({ hasText: "新快件" }).first(),
  ).toBeVisible({ timeout: 5000 });
}

function dataCell(page: Page, colId: string) {
  return page.locator(`[role="gridcell"][col-id="${colId}"]`).first();
}

/** 把第一行任务状态改为 done，刷新页面生效 */
async function setFirstTaskDone(page: Page) {
  const van = await page.locator("select").inputValue();
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
    await expect(rarityCell).toHaveText("普通");
    await rarityCell.dblclick();

    const option = page.getByText("稀有", { exact: true });
    await expect(option).toBeVisible({ timeout: 3000 });
    await option.click();

    // onClose 直接传值 → valueSetter 同步写入
    await expect(rarityCell).toHaveText("稀有", { timeout: 3000 });

    // 持久化验证
    await page.getByText("快递发车台").first().click();
    await page.waitForTimeout(600);
    await expect(rarityCell).toHaveText("稀有");
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
});
