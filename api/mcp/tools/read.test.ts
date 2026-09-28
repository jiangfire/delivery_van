/* 只读 MCP 工具回归（sqlite）：内存 SQLite + mock connection 跑真实
 * ensureSchema 与数据层。覆盖三件事——
 * 1) 工具集与入参 schema（zod 校验确实拦得住非法入参，证明 MCP 没绕过校验）；
 * 2) 只读工具的真实行为（截断不撒谎、审计链空链语义）；
 * 3) 经 /mcp 端点的真实 JSON-RPC 往返（tools/list + tools/call 打通链路）。 */
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
import { addTask, dispatchVan } from "../../queries/van";
import { listAuditRows, verifyAuditChain } from "../../queries/audit";
import { readTools } from "./read";
import { createMcpHttpHandler, writesEnabled } from "../server";

/**
 * 按名取工具并直调 run()。
 *
 * 工具数组是各 `ToolDef<S>` 的联合，成员一多联合上的 `run` 入参会塌成
 * `never`（各分支入参类型的交叉）。故这里显式擦除成「入参 unknown」的
 * 形状再调用——与 `registerTools` 里的擦除同源，schema 仍由 inputSchema 兜底。
 */
type Erasable = {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  run: (args: never) => Promise<unknown> | unknown;
};

function tool(name: string) {
  const found = readTools.find((t) => t.name === name) as Erasable | undefined;
  if (!found) throw new Error(`未注册只读工具 ${name}`);
  return {
    description: found.description,
    inputSchema: found.inputSchema,
    run: (args: unknown) =>
      (found.run as (a: unknown) => Promise<unknown> | unknown)(args),
  };
}
const van_list = () => tool("van_list");
const tasks_by_van = () => tool("tasks_by_van");
const audit_verify = () => tool("audit_verify");

const VAN = "DV2609A";

beforeEach(async () => {
  mockDb = drizzle(new Database(":memory:"), { schema });
  await ensureSchema();
});

describe("只读工具集", () => {
  it("恰好提供约定的 6 个只读工具", () => {
    expect(readTools.map((t) => t.name)).toEqual([
      "van_list",
      "tasks_by_van",
      "tasks_all",
      "members_list",
      "stats_by_van",
      "audit_verify",
    ]);
  });

  it("全部标记为只读", () => {
    for (const t of readTools) expect(t.annotations?.readOnlyHint).toBe(true);
  });
});

describe("入参校验（zod 生效，未被 MCP 绕过）", () => {
  it("拒绝非法班次编码", () => {
    expect(tasks_by_van().inputSchema.safeParse({ van: "ABC" }).success).toBe(
      false,
    );
    expect(tasks_by_van().inputSchema.safeParse({ van: VAN }).success).toBe(
      true,
    );
  });

  it("拒绝非整数与越界 limit", () => {
    const s = tasks_by_van().inputSchema;
    expect(s.safeParse({ van: VAN, limit: 0 }).success).toBe(false);
    expect(s.safeParse({ van: VAN, limit: 1.5 }).success).toBe(false);
    expect(s.safeParse({ van: VAN, limit: 100000 }).success).toBe(false);
  });
});

describe("van_list", () => {
  it("返回全部班次", async () => {
    await dispatchVan(new Date("2026-09-01T00:00:00Z"), "张三");
    expect(await van_list().run({})).toEqual([VAN]);
  });
});

describe("tasks_by_van 的截断口径（永不静默丢弃）", () => {
  beforeEach(async () => {
    await dispatchVan(new Date("2026-09-01T00:00:00Z"), "张三");
  });

  it("未超 limit 时 truncated 为 false", async () => {
    await addTask({ van: VAN, title: "件1" });
    await addTask({ van: VAN, title: "件2" });

    expect(await tasks_by_van().run({ van: VAN, limit: 200 })).toMatchObject({
      total: 2,
      truncated: false,
      returned: 2,
    });
  });

  it("超 limit 时截断并如实报告总数", async () => {
    for (const t of ["件1", "件2", "件3"])
      await addTask({ van: VAN, title: t });

    expect(await tasks_by_van().run({ van: VAN, limit: 2 })).toMatchObject({
      total: 3,
      truncated: true,
      returned: 2,
    });
  });
});

describe("audit_verify", () => {
  it("空链有效，指纹为 null（创世哈希语义）", async () => {
    expect(await audit_verify().run({})).toMatchObject({
      ok: true,
      brokenAt: null,
      fingerprint: null,
      entries: 0,
    });
  });

  it("有写入后链仍有效且给出链头指纹", async () => {
    await dispatchVan(new Date("2026-09-01T00:00:00Z"), "张三");
    const out = (await audit_verify().run({})) as {
      ok: boolean;
      fingerprint: string;
    };
    expect(out.ok).toBe(true);
    expect(out.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(verifyAuditChain(await listAuditRows())).toBeNull();
  });
});

/* ── 经 /mcp 端点的真实 JSON-RPC 往返 ──
 * Streamable HTTP 规范要求客户端同时 accept json 与 event-stream，否则 406；
 * 响应体是 SSE 帧，故统一经 sseJson 取出 data: 行。 */

const ACCEPT = "application/json, text/event-stream";

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

function toolNamesOf(result: unknown) {
  const body = result as { result: { tools: { name: string }[] } };
  return body.result.tools.map((t) => t.name);
}

describe("/mcp 端点往返", () => {
  afterEach(() => {
    delete process.env.MCP_WRITES;
  });

  it("tools/list 列出只读工具且不含任何写工具（默认关闭）", async () => {
    expect(writesEnabled()).toBe(false);
    const handler = createMcpHttpHandler();

    await handler.fetch(rpc(INIT));
    const res = await handler.fetch(
      rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    );
    expect(res.status).toBe(200);
    const names = toolNamesOf(await sseJson(res));
    expect(names).toContain("van_list");
    expect(names).toContain("audit_verify");
    expect(names).not.toContain("carry_run");
    expect(names).not.toContain("tasks_add");
  });

  it("tools/call 能取到真实数据", async () => {
    await dispatchVan(new Date("2026-09-01T00:00:00Z"), "张三");
    const handler = createMcpHttpHandler();

    await handler.fetch(rpc(INIT));
    const res = await handler.fetch(
      rpc({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "van_list", arguments: {} },
      }),
    );
    const body = (await sseJson(res)) as {
      result: { content: { text: string }[] };
    };
    expect(JSON.parse(body.result.content[0].text)).toEqual([VAN]);
  });

  it("非法入参被 zod 拦下并回传中文错误（工具级错误，非崩溃）", async () => {
    const handler = createMcpHttpHandler();

    await handler.fetch(rpc(INIT));
    const res = await handler.fetch(
      rpc({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "tasks_by_van", arguments: { van: "ABC" } },
      }),
    );
    // 协议层 200 + 工具级 isError——不是 5xx，也没有静默通过
    expect(res.status).toBe(200);
    const body = (await sseJson(res)) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("班次编码格式");
  });
});
