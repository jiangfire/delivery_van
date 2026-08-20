import { createRouter, publicQuery } from "./middleware";
import { vanRouter } from "./vanRouter";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  van: vanRouter,
});

export type AppRouter = typeof appRouter;
