/* 写工具回归（sqlite）：验证三条纪律——
 * 1) 默认不注册写工具（MCP_WRITES 未设即 tools/list 里没有写工具）；
 * 2) 开启后写工具出现，且 actor 必填；
 * 3) 结转（carry_run）经 MCP 执行后审计链仍然完整（复用 audit_verify 自证）。 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { z } from "zod";
import * as schema from "../../../db/schema";

let mockDb: BetterSQLite3Database<typeof schema>;

vi.mock("../../queries/connection", () => ({
  getDb: vi.fn(() => mockDb),
  closeDb: vi.fn(),
  dbFilePath: vi.fn(() => ":memory:"),
}));

import { ensureSchema } from "../../ensureSchema";
import { addMember, addTask, dispatchVan } from "../../queries/van";
import { writeTools } from "./write";
import { createMcpHttpHandler, writesEnabled } from "../server";

/** 同 read.test.ts：联合类型上 run 入参会塌成 never，故显式擦除后直调 */
type Erasable = {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean };
  run: (args: never) => Promise<unknown> | unknown;
};

function tool(name: string) {
  const found = writeTools.find((t) => t.name === name) as Erasable | undefined;
  if (!found) throw new Error(`未注册写工具 ${name}`);
  return {
    description: found.description,
    inputSchema: found.inputSchema,
    annotations: found.annotations,
    run: (args: unknown) =>
      (found.run as (a: unknown) => Promise<unknown> | unknown)(args),
  };
}

/** 不抛的查找：用于断言「某些名字不在注册表里」 */
const isWriteTool = (name: string) => writeTools.some((t) => t.name === name);

const ACCEPT = "application/json, text/event-stream";
const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  },
};

function rpc(body: unknown) {
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: ACCEPT },
    body: JSON.stringify(body),
  });
}

async function sseJson(res: Response) {
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  if (!line) throw new Error(`响应不是 SSE 帧：${text.slice(0, 200)}`);
  return JSON.parse(line.slice(5).trim());
}

async function listToolNames() {
  const handler = createMcpHttpHandler();
  await handler.fetch(rpc(INIT));
  const res = await handler.fetch(
    rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  );
  const body = (await sseJson(res)) as {
    result: { tools: { name: string }[] };
  };
  return body.result.tools.map((t) => t.name);
}

const VAN = "DV2609A";

beforeEach(async () => {
  mockDb = drizzle(new Database(":memory:"), { schema });
  await ensureSchema();
});

afterEach(() => {
  delete process.env.MCP_WRITES;
});

describe("MCP_WRITES 开关", () => {
  it("未设时开关为关", () => {
    delete process.env.MCP_WRITES;
    expect(writesEnabled()).toBe(false);
  });

  it("仅 MCP_WRITES=on 时开启（其他取值一律视为关）", () => {
    process.env.MCP_WRITES = "on";
    expect(writesEnabled()).toBe(true);
    process.env.MCP_WRITES = "true";
    expect(writesEnabled()).toBe(false);
    process.env.MCP_WRITES = "1";
    expect(writesEnabled()).toBe(false);
  });

  it("默认：tools/list 不含任何写工具", async () => {
    delete process.env.MCP_WRITES;
    const names = await listToolNames();
    expect(names).toContain("van_list");
    expect(names.filter((n) => isWriteTool(n))).toHaveLength(0);
  });

  it("开启：写工具出现", async () => {
    process.env.MCP_WRITES = "on";
    const names = await listToolNames();
    expect(names).toContain("carry_run");
    expect(names).toContain("tasks_add");
    expect(names).toContain("van_list");
  });
});

describe("写工具入参纪律", () => {
  it("每个写工具的 actor 必填——schema 形状里真的有 actor 字段", () => {
    // 不能只断言「空对象被拒」：那只证明存在某个必填字段，成员运力工具曾
    // 因此假通过（它的 id/capacity 必填，而 actor 压根不存在）。
    const missing = writeTools
      .filter((t) => !("actor" in t.inputSchema.shape))
      .map((t) => t.name);
    expect(missing).toEqual([]);
  });

  it("每个写工具的 actor 都是必填（非 optional）", () => {
    const optional = writeTools
      .filter((t) => t.inputSchema.shape.actor?.safeParse(undefined).success)
      .map((t) => t.name);
    expect(optional).toEqual([]);
  });

  it("不可逆工具标注 destructiveHint", () => {
    const destructive = writeTools
      .filter((t) => t.annotations.destructiveHint)
      .map((t) => t.name);
    expect(destructive.sort()).toEqual([
      "carry_run",
      "members_remove",
      "tasks_remove",
    ]);
  });

  it("不可逆后果写在 description 里（模型读的是 description 不是 annotations）", () => {
    for (const name of ["carry_run", "tasks_remove", "members_remove"]) {
      const d = tool(name).description;
      expect(d).toMatch(/DESTRUCTIVE/i);
      // 必须明说不可撤销——这是模型唯一读得到的风险提示
      expect(d).toMatch(/IRREVERSIBLE|no undo|permanently|REJECTED/i);
    }
    // 结转的不可逆点是「源班整班归档」，必须写进描述
    expect(tool("carry_run").description).toMatch(/ARCHIVES the source van/i);
  });

  it("全部写工具标 readOnlyHint=false", () => {
    for (const t of writeTools) expect(t.annotations.readOnlyHint).toBe(false);
  });
});

describe("carry_run 经 MCP 执行后审计链仍完整", () => {
  it("结转写进审计链且 verifyAuditChain 无断点", async () => {
    await dispatchVan(new Date("2026-09-01T00:00:00Z"), "张三");
    await dispatchVan(new Date("2026-10-02T00:00:00Z"), "张三");
    await addMember("李四", 10, "张三");
    await addTask({
      van: VAN,
      title: "没做完的件",
      owners: [{ name: "李四", points: 3 }],
    });

    await tool("carry_run").run({
      fromVan: VAN,
      toVan: "DV2610A",
      actor: "张三",
    });

    const { readTools } = await import("./read");
    const verify = readTools.find((t) => t.name === "audit_verify");
    if (!verify) throw new Error("未注册 audit_verify");
    const out = (await verify.run({})) as { ok: boolean; entries: number };
    expect(out.ok).toBe(true);
    expect(out.entries).toBeGreaterThan(0);
  });

  it("结转后源班整班归档：再写入被业务规则拒绝", async () => {
    await dispatchVan(new Date("2026-09-01T00:00:00Z"), "张三");
    await dispatchVan(new Date("2026-10-02T00:00:00Z"), "张三");
    await addTask({ van: VAN, title: "没做完的件" });

    await tool("carry_run").run({
      fromVan: VAN,
      toVan: "DV2610A",
      actor: "张三",
    });

    // 归档只读是既有业务规则，MCP 走 caller 故同样拒绝——证明没绕过业务层
    await expect(
      tool("tasks_add").run({
        van: VAN,
        title: "归档后不该成功",
        actor: "张三",
      }),
    ).rejects.toThrow(/归档/);
  });
});
