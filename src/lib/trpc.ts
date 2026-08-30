import { createTRPCReact } from "@trpc/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../api/router";

export const trpc = createTRPCReact<AppRouter>();

export type RouterOutputs = inferRouterOutputs<AppRouter>;

/** 班次统计（stats.byVan 返回体），统计条 / 统计面板子组件共用 */
export type VanStats = RouterOutputs["van"]["stats"]["byVan"];
