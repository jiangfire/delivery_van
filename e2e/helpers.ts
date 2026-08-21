import { expect, type Page } from "@playwright/test";

/** 打开看板页并等待标题渲染 */
export async function waitForBoard(page: Page) {
  await page.goto("/");
  await expect(page.getByText("快递发车台")).toBeVisible();
}

/** 发一班新车（发完停在最新班次） */
export async function dispatchVan(page: Page) {
  await page.getByRole("button", { name: "发新车" }).click();
  await expect(page.locator("select")).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(300);
}

/** 在当前班次新增一行快件，等新增触发的重取落库后再继续（避免编辑器被刷新打断） */
export async function addTaskAndWait(page: Page) {
  const refetched = page.waitForResponse(
    (r) =>
      r.url().includes("van.tasks.byVan") &&
      r.request().method() === "GET" &&
      r.status() === 200,
    { timeout: 8000 },
  );
  await page.getByRole("button", { name: "+ 快件" }).click();
  await refetched;
  await expect(
    page.locator('[role="gridcell"]').filter({ hasText: "新快件" }).first(),
  ).toBeVisible({ timeout: 5000 });
  // 留给网格应用批量刷新的稳定期
  await page.waitForTimeout(400);
}

/** 第一行指定列的单元格 */
export function dataCell(page: Page, colId: string) {
  return page.locator(`[role="gridcell"][col-id="${colId}"]`).first();
}

/** 今天的本地日期 YYYY-MM-DD（与服务端 todayStr 同口径） */
export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 在页面内直调 tRPC mutation，返回响应 JSON（供断言） */
export async function trpcCall(page: Page, path: string, input: unknown) {
  return page.evaluate(
    async ([p, body]) => {
      const res = await fetch(`/api/trpc/${p}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: body }),
      });
      return res.json();
    },
    [path, input] as const,
  );
}

/**
 * 双击单元格打开内置下拉编辑器（AG Grid 富下拉，非原生 select），
 * 展开后点击指定选项完成编辑。
 */
export async function selectEditorOption(
  page: Page,
  colId: string,
  label: string,
) {
  const cell = dataCell(page, colId);
  await cell.dblclick();
  const combo = cell.getByRole("combobox");
  await expect(combo).toBeVisible({ timeout: 3000 });
  await combo.click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

/**
 * 等待快件更新请求落库。编辑提交后单元格先显示本地值，
 * 立即 reload 会中止在途请求，造成「看似保存实则丢失」的假性失败。
 */
export function waitForTaskUpdate(page: Page) {
  return page.waitForResponse(
    (r) => r.url().includes("van.tasks.update") && r.status() === 200,
    { timeout: 8000 },
  );
}

/** 度量单元格内第一个标签的上下留白，验证垂直居中（差值 ≤ 2px 视为居中） */
export async function cellTagGaps(page: Page, colId: string) {
  return page.evaluate((col) => {
    const cell = document.querySelector(
      `.ag-row[row-index="0"] .ag-cell[col-id="${col}"]`,
    );
    const tag = cell?.querySelector("span > span");
    if (!cell || !tag) return null;
    const cr = cell.getBoundingClientRect();
    const tr = tag.getBoundingClientRect();
    return { top: tr.top - cr.top, bottom: cr.bottom - tr.bottom };
  }, colId);
}
