# AGENTS.md · delivery_van（快递发车台）

> 面向 AI 编码代理的项目说明。读者对本项目一无所知，请先读完本文件再动手。

## 项目概览

delivery_van 是一个**周度发车管理工具**，机制设计见 `docs/周度发车机制设计方案.md`。核心隐喻：团队每周五发一班"厢式快递车"，任务是快件，周五验收只看"这班的件送没送到"；没送完的滞留件跟下一班车走。

- 当前版本 v1.1（半天点数制随 v1.1.0 发布，tag 未打；最新已发布产物为 v1.0.0），代号 `niulai`（大版本以动漫代号命名，仿 Vue 传统，谱系见 `README.md`）。
- 单页应用：一个看板页（`BoardPage`）承载全部功能——班次切换、快件表（AG Grid 行内编辑）、统计条、成员运力。
- **快件即一切**：工作条目只有一种——**快件**（`tasks` 表），直接携带稀有度与提出人字段，在表格内新增/编辑/删除。早期的「任务大厅/委托」（`pool_items` 表）已合并进快件：表结构保留但**已废弃不再读写**（`db/schema.ts` 中标记 `@deprecated`），稀有度方案沿革见 `docs/archived/任务大厅与稀有度分级设计方案.md`。
- 无账号体系、无鉴权：小团队内部工具，任务负责人用标签（多人），成员是**永久标签，不可删除**（没有删除入口与接口）。
- 代码与文档注释主要使用**中文**，新代码请沿用中文注释风格。

### 核心业务规则（改动代码时不得破坏）

- **班次编码**：仿期货合约风格 `DV` + 2 位年 + 2 位月 + 字母序号（如 `DV2607A`）。班次由「发新车」**手动创建**，不绑定周五；编码锚定创建时所在的日历月份，**每个自然月从 A 重新计数**（跨月发新车不沿用旧月份字母），同月内 A–Z 递增（单月最多 26 班），当月到 Z 之后再发车跨月回 A。已发班次存 `vans` 表。规则与测试在 `contracts/vans.ts`、`contracts/vans.test.ts`。
- **半天点数制**：任务体量以「点」计，1 点 = 半天，只允许 1~10 整数（10 点 = 5 天），接口层用 zod 强制（拒绝 0、11、非整数）；成员运力同口径（默认 10 点/周、上限 14 点）。旧三档 1/3/5 天存量由 `ensureSchema` 按 `PRAGMA user_version` 门控幂等迁移（×2）。
- **多人负责**：一个任务可由多人共同负责（勾选式多选编辑器，可在编辑器内即时新增成员标签），运力仅做记录不做校验（超载只显示提示）。
- **送达二值化**：没有"完成 80%"。打勾 `done` 自动记送达日期（今天），取消完成自动清空日期；送达日期可手工补录/改填。
- **滞留结转**：未完成任务一键转下一班（只能转**紧邻的下一班**，服务端用 `carryTargetCode` 校验：已存在则必须转去已存在的最近一班，否则按当前日期推导下一班——跨月时为新月份 A 班，目标班不存在时自动创建），记录 `carriedFrom` 来源班次；同一事务内把源班任务标记为 `carried`（🔁结转，任务四态 todo/doing/done/carried，仅由结转动作写入）；统计的滞留率 = 结转出去的任务数 / 总数（设计方案「结转率」指标）。`carryCount >= 2` 触发强制复盘**提示**（仅提示不拦截）；同一对班次幂等 + 事务包裹，防重复转运与半截数据。**结转归档只读**：只要班次存在 carried 任务，整班不可增/改/删（服务端 `isVanArchived` 强制校验，前端同步禁用编辑与操作按钮）。
- **稀有度**：快件带五级稀有度（`n/r/sr/ssr/ur`，显示大写 N/R/SR/SSR/UR，抽卡风格英文缩写），是价值/优先度/工作量的综合标签，凭直觉定级。**稀有度只是标记（标题与稀有度列文字着色：绿/蓝/紫，ur 彩虹动画），系统不做任何校验或上车拦截**。快件另有**提出人**（`requester`）字段，记录谁提的需求，同样仅作记录。旧六级（common~mythic）已废弃，`ensureSchema` 启动时按 `LEGACY_RARITY_TO` 幂等迁移存量数据（顶级两档归并 ur）。

## 技术栈

| 层     | 技术                                                                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 前端   | React 19 + react-router 7 + Vite 7，Tailwind CSS v3 + shadcn（new-york 风格，配置见 `components.json`），AG Grid Community（看板表格），sonner（toast） |
| 后端   | Hono + tRPC v11（`@trpc/server` fetch adapter，superjson 序列化），zod v4 做入参校验                                                                    |
| 数据库 | SQLite（better-sqlite3 + Drizzle ORM，WAL 模式，外键开启），本地文件库，默认 `./data/delivery_van.db`，可用环境变量 `DATABASE_URL` 覆盖                 |
| 运行时 | Node.js 22（`engines` 已锁定 >= 22，better-sqlite3 v13 需要）；开发时 `@hono/vite-dev-server` 把 Hono 挂进 Vite dev server（端口 3000）                 |
| 测试   | Vitest（node 环境，单测）+ Playwright（E2E，Chromium）                                                                                                  |
| 部署   | 多阶段 Dockerfile：`node:22-slim`，构建产物为 `dist/`，运行阶段只保留 better-sqlite3 原生模块，容器内 `node dist/boot.js`                               |

## 目录结构

```
api/        Hono + tRPC 薄后端
  boot.ts       入口：tRPC 挂 /api/trpc/*，启动时幂等建表（失败进程退出非零），生产模式托管静态文件
  router.ts     根路由（ping + van），导出 AppRouter 类型供前端使用
  vanRouter.ts  van 子路由（班次/成员/快件/结转/统计），全部 zod 入参校验
  middleware.ts initTRPC（superjson transformer），导出 createRouter / publicQuery
  context.ts    tRPC context（req / resHeaders）
  ensureSchema.ts 启动时 CREATE TABLE IF NOT EXISTS，必须与 db/schema.ts 保持同步（旧库补列用 try ALTER + catch 忽略的幂等模式）
  lib/env.ts    环境变量（仅 NODE_ENV；DATABASE_URL 由 queries/connection.ts 直接读取）
  lib/vite.ts   生产模式静态文件托管 + SPA 回退（静态根按模块路径定位，不依赖 cwd）
  queries/      数据访问与业务逻辑（connection.ts 惰性连接；van.ts 全部查询/校验/结转/统计）
contracts/    前后端共享代码
  vans.ts       班次编码工具（isVanCode / nextVanCode / nextVanCodeFrom 跨月从 A 重计 / carryTargetCode 结转目标 / firstVanCodeOf / todayStr 上海时区等）
  vans.test.ts              班次编码规则测试
  multi-select.test.ts      多选标签纯函数测试（函数直接定义在测试文件内）
db/
  schema.ts     Drizzle 表定义：members（成员）、tasks（快件，含 rarity/requester）、task_owners（任务·负责人关联）、vans（已发班次）；pool_items 已废弃保留
  seed.ts       种子脚本（仅示例成员），npm run db:seed 运行（会先自动建表，全新库可直接跑）
src/          React 前端
  main.tsx      入口：BrowserRouter + TRPCProvider
  App.tsx       路由（仅看板页，path="*" 通配是有意的 SPA 回退）
  pages/BoardPage.tsx  看板主页面（AG Grid 快件表 + 统计条 + 成员运力 + 班次切换）
  lib/trpc.ts   createTRPCReact<AppRouter>()
  providers/trpc.tsx   QueryClient + httpBatchLink(/api/trpc) + superjson
  components/   AG Grid 自定义单元格编辑器：MultiSelectCellEditor（负责人多选）、RarityCellEditor（稀有度）、RequesterCellEditor（提出人）、DateCellEditorComp（送达日期）——四者均由 popupCellEditor.tsx 的 createPopupCellEditor 工厂生成（Portal 弹层 + 类适配的通用逻辑），配套内层组件 MultiSelectEditor / RarityEditor / RequesterSelect / DateCellEditor
  components/ui/       shadcn 组件（目前仅 sonner）
e2e/          Playwright E2E：board.spec.ts（核心动线回归）、bugs.spec.ts（历史 bug 回归）、helpers.ts、global-setup.ts（每次跑前删测试库）；配置见 playwright.config.ts——独立测试库 e2e/test.db，先 npm run build 再起生产服务（4173 端口），串行执行（workers=1）零重试
scripts/      start.mjs：跨平台生产启动（Windows 不支持 POSIX 的 VAR=x 语法）
docs/         文档目录，按状态分类（规则见下文「文档组织」）：根目录放常驻核心文档（《周度发车机制设计方案.md》，理解规则先读它）；doing/ 进行中（《v1.0-niulai-发版计划.md》）；archived/ 已归档（稀有度方案、测试覆盖率计划、评审决策存档、发版前评审报告）
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
npm test           # vitest run：班次编码、多选纯函数、稀有度/统计纯函数、mock DB 的结转与业务逻辑
npm run test:e2e   # Playwright E2E（先 build 再起生产服务，独立测试库 e2e/test.db，串行零重试）
npm run test:e2e:ui # Playwright UI 模式（本地调试用例用）
npm run check      # tsc -b 类型检查（app / node / server 三个 tsconfig project reference）
npm run lint       # eslint（flat config，typescript-eslint + react-hooks + react-refresh）
npm run format     # prettier --write .
npm run build      # vite build → dist/public；esbuild 打包 api/boot.ts → dist/boot.js（better-sqlite3 为 external）
npm start          # 生产模式：node scripts/start.mjs（跨平台，端口可用 PORT 覆盖，默认 3000）
npm run db:seed    # 写入示例成员（tsx db/seed.ts，全新库可用，会先建表）
```

提交改动前至少跑 `npm test`、`npm run check`、`npm run lint`、`npx prettier --check .`（格式不符先 `npm run format`）；涉及 UI 交互的改动建议补跑 `npm run test:e2e`。

## CI（GitHub Actions）

`.github/workflows/ci.yml`，push 与 PR 触发，三个 job：

- `check`：prettier --check → eslint → tsc → vitest（与本地门禁一致）
- `e2e`：安装 Chromium 后跑 `npm run test:e2e`，失败上传 playwright-report 产物
- `docker`：`docker build` + 容器冒烟（首页 200、`/api/trpc/ping` 返回 ok）——Docker 构建正确性由 CI 保证，本机无需装 Docker

## 代码风格与约定

- 语言：TypeScript strict 模式，ESM（`"type": "module"`），前后端均 ESM。
- 注释与业务文案使用中文；代码标识符用英文。
- 路径别名：`@/*` → `src/*`，`@contracts/*` → `contracts/*`，`@db/*` → `db/*`（vite、vitest、tsconfig 三处都有配置，改动需同步）。
- 服务端入参一律用 zod 校验（见 `api/vanRouter.ts`），业务错误抛 `TRPCError`。
- `contracts/` 会被前端打包，**不要在 contracts 里 import 服务端依赖**（如 @trpc/server），错误抛带中文说明的 `Error` 即可。
- 分层约定：router 只做 zod 校验与转发，业务逻辑与 SQL 写在 `api/queries/`；可纯函数化的逻辑（如 `toStrandedTask`、`rarityStatsOf`、`taskStatsOf`）与 DB 访问分离，便于无库单测。
- tRPC 端到端类型共享：前端通过 `import type { AppRouter } from "../../api/router"` 获得类型，改路由签名后前端调用点会自动报错。
- 前端变更后统一 `utils.invalidate()` 刷新，错误统一 `toast.error`；校验失败时同时 invalidate 让网格回滚到服务端数据。

## 测试策略

- 单测框架 Vitest，`vitest.config.ts` 只收集 `api/**/*.test.ts`、`api/**/*.spec.ts`、`contracts/**/*.test.ts`（E2E 由 Playwright 单独跑，见 `playwright.config.ts`）。
- 现有单测：`contracts/vans.test.ts`（班次编码规则，含跨月从 A 重计与结转目标推导）、`contracts/multi-select.test.ts`（多选标签纯函数）、`api/queries/van.test.ts` 与 `van.unit.test.ts`（`toStrandedTask` / `rarityStatsOf` / `taskStatsOf` 等纯函数）、`van.mock.test.ts`（mock `getDb()` 覆盖成员/快件/发车/结转等 DB 业务逻辑，含归档只读与并发撞约束防御）、`api/vanRouter.test.ts`（`memberTag` 标签校验，拒绝半角逗号）、`api/ensureSchema.test.ts`（旧六级稀有度迁移映射 `LEGACY_RARITY_TO` 完整性）。
- E2E（`e2e/`）：Playwright 跑真实部署形态（先 build 再起服务），`board.spec.ts` 覆盖核心动线（发新车 → 录快件 → 编辑 → 送达 → 结转 → 归档只读），`bugs.spec.ts` 回归历史 bug；共享一个测试库、班次跨用例累积，必须串行（workers=1）、零重试（失败即真实回归）。
- 偏好为纯函数写无库单测；涉及 DB 的逻辑尽量拆出纯函数再测，实在拆不出的用 mock DB。
- 新增业务规则（尤其是 `contracts/` 与 `api/queries/` 中的校验逻辑）应配套测试。

## 数据库与迁移

- **启动时自动幂等建表**（`api/ensureSchema.ts`），开发与生产都无需手动迁移。
- 新增列/表时必须**同步改两处**：`db/schema.ts`（Drizzle 定义）和 `api/ensureSchema.ts`（建表 SQL）；给旧库补新列用 `try ALTER TABLE ... catch 忽略` 的幂等模式（参考 rarity / requester 两列的写法）。
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
