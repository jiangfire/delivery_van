import { test, expect, type Page } from "@playwright/test";
import {
  waitForBoard,
  dispatchVan,
  addTaskAndWait,
  dataCell,
  selectEditorOption,
  trpcCall,
} from "./helpers";

/* ── v2.0 Phase 1 动线：签收制 / 结转原因 / 审计指纹 / 昨日天气 / 三方占比 / 徽章 ──
 * 测试库由 global-setup 整轮清空一次，班次跨用例累积；
 * 每个用例从「发新车」拿独立班次，不依赖执行顺序。
 */

/** 当前班次的快件列表（页面内直调 tRPC 查询） */
async function tasksOf(page: Page, van: string) {
  return page.evaluate(async (v) => {
    const res = await fetch(
      `/api/trpc/van.tasks.byVan?input=${encodeURIComponent(JSON.stringify({ json: { van: v } }))}`,
    );
    return (await res.json()).result.data.json;
  }, van);
}

test.describe("v2 签收与博弈机制", () => {
  test.beforeEach(async ({ page }) => {
    await waitForBoard(page);
    // 预置成员（重复添加返回 CONFLICT，忽略）；刷新让「我是谁」下拉加载成员
    await trpcCall(page, "van.members.add", { name: "签收人" });
    await page.reload();
    await expect(page.getByText("快递发车台")).toBeVisible();
    await dispatchVan(page);

    const actorSel = page.getByLabel("我是谁（当前操作人）");
    await expect(actorSel.locator('option[value="签收人"]')).toHaveCount(1, {
      timeout: 5000,
    });
    await actorSel.selectOption("签收人");
  });

  test("签收动线：打勾送达 → 待签收徽标 → 一次点击签收 → 统计变化并持久化", async ({
    page,
  }) => {
    await addTaskAndWait(page);
    const van = await page.getByLabel("班次").inputValue();
    const [task] = await tasksOf(page, van);
    await trpcCall(page, "van.tasks.update", {
      id: task.id,
      requester: "签收人",
    });
    await page.reload();
    await expect(page.getByText("快递发车台")).toBeVisible();

    // 未完成时没有签收徽标
    await expect(page.getByRole("button", { name: "待签收" })).toBeHidden();

    // 置完成 → 提出人格子出现「待签收」，统计条提示未签收 1 件
    await selectEditorOption(page, "_status", "完成");
    await expect(dataCell(page, "_status")).toHaveText("完成", {
      timeout: 5000,
    });
    await expect(page.getByRole("button", { name: "待签收" })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText("未签收", { exact: true })).toBeVisible();
    await expect(page.getByText("1 件", { exact: true })).toBeVisible();

    // 一次点击签收 → 徽标消失、✅ 出现、未签收归零后统计条不再显示
    await page.getByRole("button", { name: "待签收" }).click();
    await expect(page.getByText("已签收")).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: "待签收" })).toBeHidden({
      timeout: 5000,
    });
    await expect(dataCell(page, "_requester")).toContainText("✅");
    await expect(page.getByText("未签收", { exact: true })).toBeHidden({
      timeout: 5000,
    });

    // 持久化：刷新后仍已签收
    await page.reload();
    await expect(page.getByText("快递发车台")).toBeVisible();
    await expect(dataCell(page, "_requester")).toContainText("✅", {
      timeout: 5000,
    });
  });

  test("结转选原因：源班归档拒签收、目标班带原因徽标、日志指纹可见", async ({
    page,
  }) => {
    await addTaskAndWait(page);
    await addTaskAndWait(page);
    const van1 = await page.getByLabel("班次").inputValue();
    const tasks = await tasksOf(page, van1);
    // 第一件完成并挂提出人（可签收件），第二件滞留
    await trpcCall(page, "van.tasks.update", {
      id: tasks[0].id,
      requester: "签收人",
      status: "done",
    });

    await dispatchVan(page); // 第二班
    await page.getByLabel("班次").selectOption({ index: 1 });
    await expect(page.getByLabel("班次")).toHaveValue(van1);

    // 结转确认弹层：选择「依赖阻塞」原因
    await page.getByRole("button", { name: "滞留件转下一班" }).click();
    await page.locator("#carry-reason").selectOption("blocker");
    await page.getByRole("button", { name: "确认结转" }).click();
    await expect(page.getByText("已把 1 个滞留件转上下一班车")).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText("已结转 · 归档")).toBeVisible();

    // 归档班次签收被拒（服务端校验，DoD 人工动线第 3 条）
    const res = await trpcCall(page, "van.tasks.confirm", {
      taskId: tasks[0].id,
      actor: "签收人",
    });
    expect(JSON.stringify(res)).toContain("归档");

    // 目标班：滞留件带原因徽标
    await page.getByLabel("班次").selectOption({ index: 0 });
    await expect(dataCell(page, "_carry")).toContainText("依赖阻塞", {
      timeout: 5000,
    });

    // 日志指纹（链头 hash 前 8 位，周五锚定用）：可一键复制
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    const fpButton = page.getByText(/日志指纹 [0-9a-f]{8}/);
    await expect(fpButton).toBeVisible();
    await fpButton.click();
    await expect(page.getByText("日志指纹已复制")).toBeVisible({
      timeout: 5000,
    });
    const clipped = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipped).toMatch(/^[0-9a-f]{8}$/);
  });

  test("昨日天气与三方占比：建议装载上限取上一班送达点数，source 可编辑", async ({
    page,
  }) => {
    // 上一班：完成一件 5 点
    await addTaskAndWait(page);
    const van1 = await page.getByLabel("班次").inputValue();
    const [t1] = await tasksOf(page, van1);
    await trpcCall(page, "van.tasks.update", {
      id: t1.id,
      size: 5,
      status: "done",
    });

    await dispatchVan(page); // 新班：昨日天气生效
    await expect(page.getByText("建议装载上限")).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText("5 点", { exact: true })).toBeVisible();

    // 来源列：编辑为探索件 → 三方占比迷你条显示探索
    await addTaskAndWait(page);
    await selectEditorOption(page, "_source", "探索");
    await expect(dataCell(page, "_source")).toHaveText("探索", {
      timeout: 5000,
    });
    await expect(page.getByText("探索 100%")).toBeVisible({ timeout: 5000 });

    // 折叠统计面板（默认收起，点开可见记分卡 / 通胀 / 瀑布三块）
    await page.getByText("统计面板（v2）").click();
    await expect(
      page.getByText("提出人记分卡（送达 = 签收口径）"),
    ).toBeVisible();
    await expect(page.getByText("稀有度通胀（done × 滞留交叉）")).toBeVisible();
    await expect(
      page.getByText("滞留原因瀑布（本班结转出去的件，无人名排序）"),
    ).toBeVisible();
    // 本班无结转出去的件 → 瀑布空态
    await expect(page.getByText("本班暂无结转出去的滞留件")).toBeVisible();
  });

  test("送达连击徽章：成员连续两班负责快件零滞留点亮", async ({ page }) => {
    // 第一班：签收人负责的件送达（零滞留）
    await addTaskAndWait(page);
    let van = await page.getByLabel("班次").inputValue();
    let [t] = await tasksOf(page, van);
    await trpcCall(page, "van.tasks.update", {
      id: t.id,
      owners: ["签收人"],
      status: "done",
    });

    // 第二班：同样零滞留 → 连击点亮（×1 = 一名成员）
    await dispatchVan(page);
    van = await page.getByLabel("班次").inputValue();
    await addTaskAndWait(page);
    [t] = await tasksOf(page, van);
    await trpcCall(page, "van.tasks.update", {
      id: t.id,
      owners: ["签收人"],
      status: "done",
    });
    // 徽章由 stats 实时推导：API 改数据不触发前端缓存刷新，reload 后断言
    await page.reload();
    await expect(page.getByText("快递发车台")).toBeVisible();
    // 用「送达连击 ×1」定位角标本体（轻提示 toast 文案相近，避免 strict mode 冲突）
    await expect(page.getByText("送达连击 ×1")).toBeVisible({
      timeout: 5000,
    });
  });

  test("整班准点徽章：本班全部送达即点亮", async ({ page }) => {
    await addTaskAndWait(page);
    await selectEditorOption(page, "_status", "完成");
    await expect(dataCell(page, "_status")).toHaveText("完成", {
      timeout: 5000,
    });
    // 角标本体（轻提示 toast 文案相近，用徽章类名定位避免 strict mode 冲突）
    await expect(page.locator(".badge-green")).toBeVisible({ timeout: 5000 });
  });
});
