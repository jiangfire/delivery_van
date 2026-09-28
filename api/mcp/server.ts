import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import type { McpHttpHandler } from "@modelcontextprotocol/server";
// 版本取自 package.json（构建期由 esbuild 内联进 dist/boot.js，不依赖运行时文件，
// 故容器里即便不读 package.json 也能拿到正确值）——写死字面量会在发版后静默漂移。
import { version } from "../../package.json";
import { readTools } from "./tools/read";
import { writeTools } from "./tools/write";
import { registerTools } from "./tools/types";

/** 写工具总开关：仅 `MCP_WRITES=on` 时注册写工具。默认关闭 = `tools/list` 里根本没有写工具 */
export function writesEnabled(): boolean {
  return process.env.MCP_WRITES === "on";
}

/**
 * 组装 MCP server 工厂。同一份工厂同时服务新版（2026-07-28 spec）与旧版
 * 兼容流量，`createMcpHandler` 负责协议世代分流。
 */
function factory() {
  const server = new McpServer({
    name: "delivery_van",
    version,
  });
  registerTools(server, readTools);
  if (writesEnabled()) {
    registerTools(server, writeTools);
  }
  return server;
}

/**
 * `/mcp` 的 HTTP 处理器。stateless 模式（每请求一个 server 实例）——
 * 与本项目「无鉴权、单实例小团队」的部署形态相称，且无会话状态需要清理。
 */
export function createMcpHttpHandler(): McpHttpHandler {
  return createMcpHandler(factory, { legacy: "stateless" });
}
