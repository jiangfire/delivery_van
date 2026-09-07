# AGENTS.md · delivery_van（快递发车台）

> 面向 AI 编码代理的项目说明。读者对本项目一无所知，请先读完本文件再动手。本文件按最小可披露原则只收录代码推不出来的约束与惯例，其余细节见 `README.md` 与 `docs/`。

## 项目概览

delivery_van 是一个**周度发车管理工具**：团队每周五发一班"厢式快递车"，任务是快件，周五验收只看"这班的件送没送到"；没送完的滞留件跟下一班车走。机制设计见 `docs/周度发车机制设计方案.md`。

- 当前版本 **v2.3.0**，主版本线代号 `STEINS;GATE`（v2.x.y 全系通用，谱系见 `README.md`）：v2.3 统计面板统一与成员删除、v2.2 表格体验与多数据库、v2.0 博弈机制（签收制 / 链式审计日志 / 统计三件套 / 昨日天气 / 结转原因 / 徽章，随 v2.2.0 合并首发）。**Phase 2「议价台 + 预测投票」纸面运行中（2026-09-01 启动，零开发零发版，手册见 `docs/doing/v2.1-Phase2-议价台与预测投票纸面运行手册.md`）**。
- 单页应用：`src/pages/BoardPage.tsx` 承载全部功能——班次切换、AG Grid 快件表（行内编辑）、统计条、统一统计面板（负责人 / 提出人 / 稀有度 / 结转原因 / 来源五维度页签，负责人默认，设计见 `docs/archived/统计面板统一设计方案.md`）。
- **快件即一切**：工作条目只有 `tasks` 表一种，直接携带稀有度与提出人。旧「任务大厅」（`pool_items` 表）已废弃：表结构保留但不读写。
- 无账号无鉴权，成员用名字标签。成员删除是**有守卫的硬删**：零历史成员可删（删除与审计同事务），名字出现在任何快件上（负责人 / 提出人 / 签收人，均无外键的纯文本引用）即拒绝（方案见 `docs/archived/成员删除功能设计方案.md`）。
- 注释与业务文案使用中文，代码标识符用英文。

### 核心业务规则（改动代码时不得破坏）

- **班次编码**：`DV` + 2 位年 + 2 位月 + 字母序号（如 `DV2607A`）；「发新车」手动创建，不绑定周五；锚定创建时所在日历月，**每个自然月从 A 重新计数**，同月 A–Z，到 Z 后跨月回 A。规则在 `contracts/vans.ts`。
- **半天点数制**：任务体量 1~10 整数点（1 点 = 半天），接口层 zod 强制；成员运力同口径（默认 10 点/周、上限 14 点），仅记录不校验。
- **多人负责**：一个任务多人负责（勾选式多选编辑器，可即时新增成员标签）。
- **送达二值化**：没有"完成 80%"；打勾自动记送达日期，取消自动清空，日期可手工补录。
- **滞留结转**：只能转**紧邻的下一班**（服务端 `carryTargetCode` 校验：已存在则必须转已存在的最近一班，否则按当前日期推导，目标班不存在自动创建）；同一事务把源班任务标 `carried`（四态 todo/doing/done/carried 仅由结转写入）；同一对班次幂等；`carryCount >= 2` 仅提示不拦截；**结转归档只读**——班次存在 carried 任务则整班不可增/改/删（`isVanArchived`）。
- **稀有度/提出人**：五级 `n/r/sr/ssr/ur`（显示 N/R/SR/SSR/UR）与提出人只是标记，系统不做任何校验或上车拦截。
- **行内拖拽排序**：按班次持久化到 `sort_order`；拖后按传入 id 顺序全量重写该班序号（幂等）；新建与结转快件排班末尾。
- **签收制**：done 拆两拍——送达（打勾）→ 签收（提出人一次点击）；任务必须 done、班次未归档、actor 必须是成员；**无提出人的自驱件不写库直接视同签收**（能推导不落库）；重签幂等不覆盖首签。
- **快件来源**：三枚举 `customer/platform/exploration`，默认 customer，仅供统计不拦截。
- **结转原因**：五枚举，默认空=未分类；滞留原因瀑布只统计本班 status=carried 的件（与滞留率同口径）。**Phase 2 纸面约定（改代码/清理数据不得破坏）**：让位件结转选 `priority` 且 note 以 `swap：` 开头——Gate 2 工具化时凭此前缀回溯补录。
- **链式审计日志**：`audit_log` 以 SHA256 hash 链记录一切写操作（读不记）。**业务写与审计追加同一事务**，统一走 `api/queries/tx.ts` 的 `runTx` + `api/queries/audit.ts` 的 `appendAudit`（事务回调内 await 调用）；**铁律：事务 body 内禁止任何真实 I/O 的 await**（sqlite 手写 BEGIN IMMEDIATE 包裹 async body，better-sqlite3 驱动事务回调必须同步，传 async 会在首个 await 提前 COMMIT）；**序列化格式锁定**（`serializeAudit`），改格式 = 旧链全量失效，必须同步改锁定单测；自由文本以 `'(text)'` 占位进链。actor 是软身份（页头「我是谁」单选），缺省 `'(unknown)'`。
- **昨日天气**：建议装载上限 = 上一班 done 点数合计，无历史班返回 null，只提示不拦截。
- **徽章**：🚚 整班准点、📦 送达连击，实时推导不落库（`badgesOf` 纯函数）。
- **口径连续性**：滞留率/完成率/三方占比/通胀沿用 done/carried 定义；记分卡「送达」用签收口径（`isConfirmed`）；昨日天气与徽章用 done 口径——一处函数一个口径，禁止混用。

## 技术栈

| 层     | 技术                                                                                                                                           |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 前端   | React 19 + react-router 7 + Vite 7，Tailwind CSS v3 + shadcn（new-york 风格），AG Grid Community（看板表格），sonner（toast）                  |
| 后端   | Hono + tRPC v11（fetch adapter，superjson 序列化），zod v4 入参校验                                                                            |
| 数据库 | `DB_DIALECT=sqlite\|postgres\|mysql`（默认 sqlite）+ Drizzle ORM；sqlite 走 better-sqlite3（WAL、外键开启），pg/mysql 走 `DATABASE_URL` 连接串 |
| 运行时 | Node.js >= 22（engines 锁定）；开发 `@hono/vite-dev-server` 前后端同端口 3000                                                                  |
| 测试   | Vitest（单测）+ Playwright（E2E，Chromium）                                                                                                    |

## 目录结构

```
api/          Hono + tRPC 薄后端：boot.ts（入口）/ vanRouter.ts（zod 校验与转发）/ ensureSchema*.ts（幂等建表）/ queries/（业务与 SQL：van.ts、audit.ts、tx.ts、dialect.ts 方言层）
contracts/    前后端共享：vans.ts（班次编码）、enums.ts（枚举）——会被前端打包，勿 import 服务端依赖
db/           三方言 Drizzle 表定义 schema.ts / schema.pg.ts / schema.mysql.ts + 种子脚本
src/          React 前端：pages/BoardPage.tsx（看板页）、components/（单元格编辑器 + 统计组件）、lib/、providers/
e2e/          Playwright E2E（board / bugs / v2 三套 + helpers.ts + pre-test.mjs）
scripts/      start.mjs：跨平台生产启动
docs/         文档目录（生命周期见下文「文档组织」）
dist/         构建产物，勿手改
```

## 文档组织（docs/ 生命周期）

文档按状态分目录，状态流转 = 物理移动：

- `docs/` 根目录：**常驻文档**——长期有效的核心设计与规范（如《周度发车机制设计方案.md》《会议纪要模板.md》《博弈机制科研探索-PM与开发显性博弈设计.md》），不随版本归档；
- `docs/doing/`：**进行中**——已立项、正在实施的文档，事项完成后移入 archived/；
- `docs/archived/`：**已归档**——只作历史查阅，不再更新（如确需修订，在文档内追加注记而非改写结论）。

## 构建与测试命令

```bash
npm install        # 安装依赖
npm run dev        # 开发模式 http://localhost:3000（前后端同端口，首次启动自动建表）
npm test           # vitest run（TEST_PG_URL/TEST_MYSQL_URL 存在时加跑 pg/mysql 方言变体，本地缺省 skip）
npm run test:e2e   # Playwright E2E（先 build 再起生产服务，独立测试库 e2e/test.db，串行零重试）
npm run check      # tsc -b 类型检查
npm run lint       # eslint
npm run format     # prettier --write .
npm run build      # vite build → dist/public；esbuild 打包 api/boot.ts → dist/boot.js
npm start          # 生产模式：node scripts/start.mjs（跨平台，端口可用 PORT 覆盖）
npm run db:seed    # 写入示例成员（会先自动建表）；db:seed:demo 生成全虚构演示库（data/demo.db）
```

提交改动前至少跑 `npm test`、`npm run check`、`npm run lint`、`npx prettier --check .`；涉及 UI 交互的改动建议补跑 `npm run test:e2e`。

## CI（GitHub Actions）

`.github/workflows/ci.yml`（push 与 PR 触发）三个 job：`check`（prettier → eslint → tsc → vitest，附 pg/mysql service 容器真实跑方言变体）、`e2e`、`docker`（构建 + 容器冒烟，本机无需装 Docker）。另有 `release.yml`：推 `v*` tag 构建镜像推 GHCR 并创建带 zip 附件的 Release（流程见 README「部署」）。

## 代码风格与约定

- TypeScript strict + ESM；路径别名 `@/*` → `src/*`、`@contracts/*` → `contracts/*`、`@db/*` → `db/*`（vite / vitest / tsconfig 三处都有配置，改动需同步）。
- 服务端入参一律 zod 校验（`api/vanRouter.ts`），业务错误抛 `TRPCError`；分层约定：router 只做校验与转发，业务逻辑与 SQL 写在 `api/queries/`，可纯函数化的逻辑与 DB 访问分离。
- **写操作（mutation）一律带可选 `actor` 软身份参数**并传给数据层（审计日志用）；前端从 `src/lib/actor.ts` 读「我是谁」附带；`tasks.confirm` 的 actor 必填且必须是成员。
- `contracts/` 会被前端打包，**不要 import 服务端依赖**（如 @trpc/server），错误抛带中文说明的 `Error` 即可。
- tRPC 端到端类型共享：前端通过 `import type { AppRouter } from "../../api/router"` 获得类型，改路由签名后前端调用点会自动报错。
- 前端变更后统一 `utils.invalidate()` 刷新，错误统一 `toast.error`；校验失败时同时 invalidate 让网格回滚到服务端数据。

## 测试策略

- Vitest 只收集 `api/**` 与 `contracts/**` 的测试文件（`vitest.config.ts`）；E2E 由 Playwright 单独跑。
- 偏好：业务逻辑拆纯函数写无库单测；数据层行为优先用**内存 SQLite 跑真实 `ensureSchema`**；mock DB 只用于并发异常注入。
- 数据层行为回归抽成三方共享套件（`api/queries/van.*.suite.ts`）：sqlite 变体内存库跑，pg/mysql 变体由 `dialect.pg/mysql.test.ts` 在 `TEST_PG_URL` / `TEST_MYSQL_URL` 存在时跑；变体文件第一个 import 必须是 `testEnv.pg/mysql.ts`（ESM 加载序固化方言）；隔离靠每用例前 ensureSchema + `cleanAllTables`，自增 id 不复位，用例不得假设 id 从 1 起。
- E2E 共享一个测试库、班次跨用例累积：必须串行（workers=1）、零重试；`pre-test.mjs` 必须在 playwright 启动前跑。
- 新增业务规则（尤其 `contracts/` 与 `api/queries/` 的校验逻辑）应配套测试；改审计序列化格式必须同步改锁定单测。

## 数据库与迁移

- 三方言一份业务代码：方言差异全部收敛在 `api/queries/dialect.ts`；启动时自动幂等建表（`api/ensureSchema*.ts` 按方言分发），无需手动迁移。
- **新增列/表必须同步改三份 schema + ensureSchema**：`db/schema.ts` / `schema.pg.ts` / `schema.mysql.ts` 与 `api/ensureSchema.ts`（+ `.pg/.mysql` 建表 SQL），防漂移单测 `api/schemaDrift.test.ts` 兜底；sqlite 旧库补列用 `try ALTER TABLE ... catch 忽略` 的幂等模式。
- 无法幂等的值域迁移（仅 sqlite 有历史库）用 `PRAGMA user_version` 门控只执行一次；pg/mysql 对应 `_dv_meta` 版本表。
- drizzle-kit 脚本（`db:generate/migrate/push`）存在但不是主流程，`drizzle.config.ts` 只覆盖 sqlite 方言。

## 部署

多阶段 Dockerfile（`node:22-slim`）构建 `dist/`，容器内 `node dist/boot.js`；better-sqlite3 为 external 原生模块，**即使 pg/mysql 部署也保留它**（connection.ts 静态 import 启动即加载）。sqlite 容器部署必须挂载数据卷。详见 `README.md`「部署」。

## 安全注意事项

- 应用**没有任何鉴权**，所有 tRPC 过程都是 public；不要暴露到公网，也不要在接口中存放敏感数据。
- 请求体上限 50MB（`hono/body-limit`）。
- 所有 SQL 走 Drizzle 参数化查询，无拼接 SQL；保持这一点。
- 班次编码、档位等输入在服务端 zod 层强制校验，不要只在前端校验。
