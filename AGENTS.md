# AGENTS.md · delivery_van（快递发车台）

> 面向 AI 编码代理的项目说明。读者对本项目一无所知，请先读完本文件再动手。

## 项目概览

delivery_van 是一个**周度发车管理工具**，机制设计见 `docs/周度发车机制设计方案.md`。核心隐喻：团队每周五发一班"厢式快递车"，任务是快件，周五验收只看"这班的件送没送到"；没送完的滞留件跟下一班车走。

- 当前版本 v1.0，代号 `niulai`（大版本以动漫代号命名，仿 Vue 传统，谱系见 `README.md`）。
- 单页应用：一个看板页（`BoardPage`）承载全部功能——成员产能、任务大厅（委托）、周任务表、班次切换、结转与统计。
- **任务大厅**：UI 上的「任务大厅」（代码里仍叫 `pool_items`）存放的是**委托**（可接取的工作条目），不是需求；需求本身在团队另一套流程里管理。委托带稀有度分级（六级，仅作标记），设计见 `docs/archived/任务大厅与稀有度分级设计方案.md`（已实施）。委托已合并进主表格展示（open 委托在前，带接取按钮）。
- 无账号体系、无鉴权：小团队内部工具，任务负责人用标签（多人），成员是**永久标签，不可删除**（没有删除入口与接口）。
- 代码与文档注释主要使用**中文**，新代码请沿用中文注释风格。

### 核心业务规则（改动代码时不得破坏）

- **班次编码**：仿期货合约风格 `DV` + 2 位年 + 2 位月 + 字母序号（如 `DV2607A`）。班次由「发新车」**手动创建**，不绑定周五；字母 = 当月第几班车（A–Z，单月最多 26 班），Z 之后跨月回 A。已发班次存 `vans` 表。规则与测试在 `contracts/vans.ts`、`contracts/vans.test.ts`。
- **三档粒度**：任务体量只允许 1 / 3 / 5 天，接口层用 zod 强制（拒绝 2/4 天）。
- **多人负责**：一个任务可由多人共同负责（标签输入，按回车添加），运力仅做记录不做校验。
- **送达二值化**：没有"完成 80%"。打勾 `done` 自动记送达日期（今天），取消完成自动清空日期；送达日期可手工补录/改填。
- **滞留结转**：未完成任务一键转下一班（只能转**紧邻的下一班**，服务端校验 `toVan === nextVanCode(fromVan)`，目标班不存在时自动创建），记录 `carriedFrom` 来源班次；同一事务内把源班任务标记为 `carried`（🔁结转，任务四态 todo/doing/done/carried，仅由结转动作写入）；统计的滞留率 = 结转出去的任务数 / 总数（设计方案「结转率」指标）。`carryCount >= 2` 触发强制复盘**提示**（仅提示不拦截）；同一对班次幂等 + 事务包裹，防重复转运与半截数据。**结转归档只读**：只要班次存在 carried 任务，整班不可增/改/删（服务端 `isVanArchived` 强制校验，前端同步禁用编辑与操作按钮）。
- **任务大厅联动**：委托三态（open 待切片 / scheduled 已排期 / done 已完成），由关联任务自动推导（`syncPoolStatus`：无关联任务 → open，全部送达 → done，否则 scheduled）；手动编辑委托状态后，下一次任务增删改会重新推导覆盖。
- **稀有度**：委托带六级稀有度（common/uncommon/rare/epic/legendary/mythic），是价值/优先度/工作量的综合标签，凭直觉定级。**稀有度只是标记（颜色），系统不做任何校验或上车拦截**；录入时记 `postedVan`，待接取期间按经过班次数显示「挂 N 轮」。

## 技术栈

| 层     | 技术                                                                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 前端   | React 19 + react-router 7 + Vite 7，Tailwind CSS v3 + shadcn（new-york 风格，配置见 `components.json`），AG Grid Community（看板表格），sonner（toast） |
| 后端   | Hono + tRPC v11（`@trpc/server` fetch adapter，superjson 序列化），zod v4 做入参校验                                                                    |
| 数据库 | SQLite（better-sqlite3 + Drizzle ORM，WAL 模式，外键开启），本地文件库，默认 `./data/delivery_van.db`，可用环境变量 `DATABASE_URL` 覆盖                 |
| 运行时 | Node.js 22（`engines` 已锁定 >= 22，better-sqlite3 v13 需要）；开发时 `@hono/vite-dev-server` 把 Hono 挂进 Vite dev server（端口 3000）                 |
| 测试   | Vitest（node 环境）                                                                                                                                     |
| 部署   | 多阶段 Dockerfile：`node:22-slim`，构建产物为 `dist/`，运行阶段只保留 better-sqlite3 原生模块，容器内 `node dist/boot.js`                               |

## 目录结构

```
api/        Hono + tRPC 薄后端
  boot.ts       入口：tRPC 挂 /api/trpc/*，启动时幂等建表（失败进程退出非零），生产模式托管静态文件
  router.ts     根路由（ping + van），导出 AppRouter 类型供前端使用
  middleware.ts initTRPC（superjson transformer），导出 createRouter / publicQuery
  context.ts    tRPC context（req / resHeaders）
  ensureSchema.ts 启动时 CREATE TABLE IF NOT EXISTS，必须与 db/schema.ts 保持同步
  lib/env.ts    环境变量（仅 NODE_ENV；DATABASE_URL 由 queries/connection.ts 直接读取）
  lib/vite.ts   生产模式静态文件托管 + SPA 回退（静态根按模块路径定位，不依赖 cwd）
  queries/      数据访问与业务逻辑（connection.ts 惰性连接；van.ts 全部查询/校验/结转/统计）
contracts/    前后端共享代码
  vans.ts       班次编码工具（isVanCode / nextVanCode / firstVanCodeOf / todayStr 等）
db/
  schema.ts     Drizzle 表定义：members（成员）、pool_items（任务大厅·委托）、tasks（周任务）、task_owners（任务·负责人关联）、vans（已发班次）
  seed.ts       种子脚本（仅示例成员），npm run db:seed 运行（会先自动建表，全新库可直接跑）
src/          React 前端
  main.tsx      入口：BrowserRouter + TRPCProvider
  App.tsx       路由（仅看板页，path="*" 通配是有意的 SPA 回退）
  pages/BoardPage.tsx  看板主页面（AG Grid 表格 + tRPC 查询/变更，委托合并展示）
  lib/trpc.ts   createTRPCReact<AppRouter>()
  providers/trpc.tsx   QueryClient + httpBatchLink(/api/trpc) + superjson
  components/TagCellEditor.tsx   AG Grid 自定义单元格编辑器（标签输入）
  components/TagEditorInner.tsx  标签输入 React 组件
  components/ui/       shadcn 组件（目前仅 sonner）
scripts/      start.mjs：跨平台生产启动（Windows 不支持 POSIX 的 VAR=x 语法）
docs/         文档目录，按状态分类（规则见下文「文档组织」）：根目录放常驻核心文档（《周度发车机制设计方案.md》，理解规则先读它）；doing/ 进行中（《v1.0-niulai-发版计划.md》）；archived/ 已归档（稀有度方案、评审决策存档）
dist/         构建产物（前端 dist/public + 服务端 dist/boot.js），由 npm run build 生成，勿手改
```

## 文档组织（docs/ 生命周期）

文档按状态分目录，状态流转 = 物理移动：

- `docs/` 根目录：**常驻文档**——长期有效的核心设计与规范（如《周度发车机制设计方案.md》），不随版本归档；
- `docs/doing/`：**进行中**——已立项、正在实施或等待实施的本版本文档（如发版计划），事项完成后移入 archived/；
- `docs/archived/`：**已归档**——已定稿实施或评审结束的文档，只作历史查阅，不再更新（如确需修订，在文档内追加注记而非改写结论）。

新增文档时先想清它属于哪一类；发版完成等节点主动把 doing/ 里已完成的文档移入 archived/。

## 构建与测试命令

```bash
npm install        # 安装依赖
npm run dev        # 开发模式 http://localhost:3000（前后端同端口，首次启动自动建表）
npm test           # vitest run：班次编码、委托状态推导、稀有度统计、滞留件转运逻辑
npm run check      # tsc -b 类型检查（app / node / server 三个 tsconfig project reference）
npm run lint       # eslint（flat config，typescript-eslint + react-hooks + react-refresh）
npm run format     # prettier --write .
npm run build      # vite build → dist/public；esbuild 打包 api/boot.ts → dist/boot.js（better-sqlite3 为 external）
npm start          # 生产模式：node scripts/start.mjs（跨平台，端口可用 PORT 覆盖，默认 3000）
npm run db:seed    # 写入示例成员（tsx db/seed.ts，全新库可用，会先建表）
```

提交改动前至少跑 `npm test`、`npm run check`、`npm run lint`、`npx prettier --check .`（格式不符先 `npm run format`）。

## CI（GitHub Actions）

`.github/workflows/ci.yml`，push 与 PR 触发，两个 job：

- `check`：prettier --check → eslint → tsc → vitest（与本地门禁一致）
- `docker`：`docker build` + 容器冒烟（首页 200、`/api/trpc/ping` 返回 ok）——Docker 构建正确性由 CI 保证，本机无需装 Docker

## 代码风格与约定

- 语言：TypeScript strict 模式，ESM（`"type": "module"`），前后端均 ESM。
- 注释与业务文案使用中文；代码标识符用英文。
- 路径别名：`@/*` → `src/*`，`@contracts/*` → `contracts/*`，`@db/*` → `db/*`（vite、vitest、tsconfig 三处都有配置，改动需同步）。
- 服务端入参一律用 zod 校验（见 `api/vanRouter.ts`），业务错误抛 `TRPCError`。
- `contracts/` 会被前端打包，**不要在 contracts 里 import 服务端依赖**（如 @trpc/server），错误抛带中文说明的 `Error` 即可。
- 分层约定：router 只做 zod 校验与转发，业务逻辑与 SQL 写在 `api/queries/`；可纯函数化的逻辑（如 `toStrandedTask`、`poolStatusOf`、`rarityStatsOf`）与 DB 访问分离，便于无库单测。
- tRPC 端到端类型共享：前端通过 `import type { AppRouter } from "../../api/router"` 获得类型，改路由签名后前端调用点会自动报错。
- 前端变更后统一 `utils.invalidate()` 刷新，错误统一 `toast.error`；校验失败时同时 invalidate 让网格回滚到服务端数据。

## 测试策略

- 测试框架 Vitest，`vitest.config.ts` 只收集 `api/**/*.test.ts`、`api/**/*.spec.ts`、`contracts/**/*.test.ts`。
- 现有测试：`contracts/vans.test.ts`（班次编码规则）、`api/queries/van.test.ts`（委托状态推导、稀有度统计、滞留件转运纯函数）。
- 偏好为纯函数写无库单测；涉及 DB 的逻辑尽量拆出纯函数再测。
- 新增业务规则（尤其是 `contracts/` 与 `api/queries/` 中的校验逻辑）应配套测试。

## 数据库与迁移

- **启动时自动幂等建表**（`api/ensureSchema.ts`），开发与生产都无需手动迁移。
- 新增列/表时必须**同步改两处**：`db/schema.ts`（Drizzle 定义）和 `api/ensureSchema.ts`（建表 SQL）。
- `npm run db:generate / db:migrate / db:push`（drizzle-kit）存在但不是主流程；`drizzle.config.ts` 默认 url 已与运行时一致（`data/delivery_van.db`）。

## 部署

- `Dockerfile` 多阶段构建（`node:22-slim`）：构建阶段 `npm ci && npm run build`；运行阶段只从构建阶段 COPY `better-sqlite3` 与 `node-addon-api` 两个包（dist/boot.js 已 bundle 其余全部依赖），`node dist/boot.js`，暴露 3000 端口。
- better-sqlite3 是原生模块，服务端打包时以 `--external:better-sqlite3` 排除，运行时二进制来自构建阶段在容器内 `npm ci` 安装的 linux 版本。
- 数据库文件通过 `DATABASE_URL` 指定；容器化部署必须挂载数据卷（`-v ...:/app/data`），否则容器重建丢数据，示例见 `README.md`。

## 安全注意事项

- 应用**没有任何鉴权**，所有 tRPC 过程都是 public；不要暴露到公网，也不要在接口中存放敏感数据。
- 请求体上限 50MB（`hono/body-limit`）。
- 所有 SQL 走 Drizzle 参数化查询，无拼接 SQL；保持这一点。
- 班次编码、档位等输入在服务端 zod 层强制校验，不要只在前端校验。
