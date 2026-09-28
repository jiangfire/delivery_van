# MCP 接入规划（v1：只读先行，写工具开关控制）

> 2026-09-28 立项并拍板并**全部实施完毕**。四项决策（工具描述语言 / 写工具默认策略 / stdio 取舍 / 文档落位）见文末「拍板记录」。
> 一页纸实施提案见 `docs/archived/v2.4-MCP接入一页纸实施提案.md`（本文为详细工作产出）。
> 前置计划（v2.2 评审与文档修复）已完成，归档于 `tasks/archive/`。

## Overview

给 delivery_van 增加 MCP（Model Context Protocol）能力，**挂在现有 Hono 服务的 `/mcp` 路径上**，让 AI 编码代理（Claude Code / Mavis / Cursor）能直接查询看板数据，后续按需扩展为业务工具与 Phase 2 机制工具。

三步走：**① 开发向只读工具**（本计划主体）→ **② 写工具（环境变量开关）** → **③ 业务向 / Phase 2 工具（Gate 2 拍板后）**。本次交付 ① 与 ② 的骨架，③ 留扩展位不预建。

**核心设计立场：MCP 是纯适配层，不是第二套业务逻辑。** 所有工具经 tRPC caller 执行，复用同一份 zod 校验与同一套业务规则，审计链路径完全不变。

## 现状勘察结论（约束设计的硬事实）

1. **唯一执行路径已存在**：tRPC `appRouter` → `api/vanRouter.ts`（zod 校验）→ `api/queries/van.ts`（业务 + SQL + 审计）。tRPC v11 提供 `appRouter.createCaller(ctx)`，可在进程内直接调用，**绕过 HTTP 但保留全部校验与业务规则**。
2. **zod 校验是铁律**（AGENTS.md「服务端入参一律 zod 校验」）。若 MCP 直接 import `queries/van.ts` 就绕过了 zod——**必须走 caller 或复用同一份 schema**。
3. **审计链只认「业务写 + 审计同事务」**（`runTx` + `appendAudit`，序列化格式锁定）。MCP 走 caller 即自动继承，无需改动 `tx.ts` / `audit.ts`。
4. **写串行化已有三方言实现**：`BEGIN IMMEDIATE`（sqlite）/ `pg_advisory_xact_lock(9137)`（pg）/ `_dv_meta` 行 FOR UPDATE（mysql）。**这三把锁都是库级/数据库级，跨进程同样生效**——所以「另起进程连同一个 sqlite 文件」不会导致审计链分叉，残余风险只有 SQLITE_BUSY 争用与事务外前置读的既有 TOCTOU。**结论：单进程 vs 多进程不是安全问题，HTTP 挂载的理由是「贴合现有部署形态 + 单一连接模型」，不是「防链分叉」。**
5. **项目零鉴权**（AGENTS.md 明确「不要暴露到公网」）。`/mcp` 与 `/api/trpc` 同端口同进程，**不新增暴露面**；但写工具开关必须默认关。
6. **技术栈契合**：项目已用 Hono 4 + zod ^4.3.5。官方 SDK v2（`@modelcontextprotocol/server`，实现 2026-07-28 spec）基于 Standard Schema + zod v4，零适配直接可用。
7. **Phase 2 时点**：`docs/doing/v2.1-Phase2-...手册.md` 记录纸面运行自 2026-09-01 起，按每周五节奏 4 班，**Gate 2 复盘会已临近**。其「工具化范围」尚未拍板——本计划**不预建 Phase 2 工具**，避免既成事实干扰复盘会决策。

## Architecture Decisions

- **MCP 经 `appRouter.createCaller(ctx)` 执行，不直连 `queries/van.ts`**：单一执行路径，零业务逻辑重复，zod 校验与业务规则（`isVanArchived` 归档锁、`carryOver` 幂等、`confirmTask` 守卫）自动继承。这是本计划最关键的一条。
- **zod schema 抽到 `api/schemas.ts` 共享**：`vanRouter.ts` 现内联定义全部入参 schema，拆出后 tRPC 与 MCP 引用**同一个 zod 对象**——校验单点、JSON Schema 自动同源。拆分必须是**纯搬迁，零行为变化**，用现有 `vanRouter.test.ts` 兜底。
- **工具命名用 snake_case，不照搬 tRPC 点号路径**（`van_list` 而非 `van.list`）：点号在部分 MCP 客户端的工具名校验中不通用。映射表在 `api/mcp/tools/README` 注释中固化。
- **工具描述（description）用英文，业务注释与 UI 文案仍用中文**：这是对 AGENTS.md「注释与业务文案使用中文」的**显式例外**，理由是 description 是喂给模型的英文语料、且未来可能对接英文语境的 MCP host。**仅 description 例外，工具名、参数名、错误文案、代码注释一律照旧中文。**
- **挂 `/mcp` 且不带尾斜杠**：`vite.config.ts` 的 devServer `exclude` 语义是「这些路径**不**交给 Hono」。原式 `^\/(?!api\/).*$` 会把所有非 `/api/` 路径（含 `/mcp`）推给 Vite——**dev 下 /mcp 404 而 prod 正常**，纯本地调试盲区。已改为 `^\/(?!(api|mcp)(\/|$)).*$`。**实现时必须 dev + prod 双模式实测**（单测直接打 Hono 的 `app.fetch`，绕过 Vite 中间件，发现不了这个问题）。
- **SDK 选 v2（`@modelcontextprotocol/server`）**：v2 是 2026-07-28 spec 的稳定线，v1 只收 bug/安全修复。**实际未采用 `@modelcontextprotocol/hono`**——它的 `createMcpHonoApp` 返回一个独立 Hono app 而非可挂载 handler，挂不到既有 `boot.ts` 上；改用同包的 `createMcpHandler`，其 `McpHttpHandler.fetch(request)` 直接吃 web 标准 `Request`，Hono 侧 `app.all("/mcp", (c) => h.fetch(c.req.raw))` 即可。该包已从依赖中移除。
- **version 取自 `package.json`**（构建期由 esbuild 内联进 boot.js，不依赖运行时文件），不写死字面量。
- **懒加载 MCP 模块**：`boot.ts` 已用 `await import()` 懒加载 `@hono/node-server`，MCP 同样条件导入——未启用时不给生产 bundle 增加体积。
- **只读先行 + `MCP_WRITES` 开关**：`MCP_WRITES=off`（默认）时**不注册任何写工具**（未注册优于注册后拒绝）；`on` 时写工具强制要求 `actor` 参数，承接软身份与审计链约定。
- **永不静默截断**：`tasks.byVan` 加 `limit`，超限时返回 `truncated: true` + 实际条数，与项目「口径清晰、不撒谎」一致。
- **Phase 2 工具留扩展位不预建**：目录与注册机制按域分片（`tools/read.ts` / `tools/write.ts` / 未来 `tools/phase2.ts`），Gate 2 拍板后按域新增文件即可，传输层与注册机制不动。

## Task List

### 阶段 1：地基（只读通路）

- [ ] **任务 1（S）：zod schema 抽出到 `api/schemas.ts`（零行为变化）**
  - **Description**：把 `vanRouter.ts` 内联的 `vanCode` / `idField` / `rarity` / `sourceField` / `carryReasonField` / `actorField` / `memberTag` / `requesterField` / `doneAtField` / `sizePoints` 及各处 `.input(z.object({...}))` 移到新文件，router 改为 import。**纯搬迁，不改任何校验规则。**
  - **Acceptance criteria**：
    - [ ] `npm test` 全绿，`api/vanRouter.test.ts` 的拒绝用例**无需修改**即通过（证明行为等价）
    - [ ] `vanRouter.ts` 中不再出现 zod 字面量定义
  - **Verification**：`npm test -- api/vanRouter.test.ts`；`npm run check`
  - **Dependencies**：无 ｜ **Files**：`api/vanRouter.ts`（新）、`api/schemas.ts` ｜ **Scope**：S
  - **Commit**：`refactor: 入参 zod schema 抽出到 api/schemas.ts 供 tRPC 与 MCP 共享（零行为变化）`

- [ ] **任务 2（S~M）：MCP server 骨架 + `/mcp` 挂载 + 工具注册机制**
  - **Description**：`api/mcp/server.ts` 组装 `McpServer`（name/version 取 package.json），`api/mcp/tools/index.ts` 提供「工具定义数组 → 批量 registerTool」的注册入口。先只注册 `ping` 一个工具打通链路。
  - **Acceptance criteria**：
    - [ ] `curl` / MCP Inspector 能连上 `/mcp` 并 `tools/list` 看到 `ping`
    - [ ] dev 模式（`npm run dev`）与生产模式（`npm run build && npm start`）**均**可连通
    - [ ] 未设 `MCP_WRITES` 时行为与现在完全一致（`/api/trpc` 不受影响）
  - **Verification**：MCP Inspector（`npx @modelcontextprotocol/inspector`）连 `http://localhost:3000/mcp`；**重点验证 `/mcp` 未被 vite `exclude` 正则吞掉**
  - **Dependencies**：任务 1 ｜ **Files**：`api/mcp/server.ts`、`api/mcp/tools/index.ts`、`api/boot.ts` ｜ **Scope**：S~M
  - **Commit**：`feat: 挂载 /mcp 端点与工具注册骨架（ping 工具打通链路）`

### 检查点：地基可用

- [ ] MCP Inspector 能列出并调用 `ping`；tRPC 与前端功能零回归（`npm test` + `npm run test:e2e`）

- [ ] **任务 3（M）：只读工具集（开发向）**
  - **Description**：按 tRPC 路径一一对应实现只读工具，**全部经 `appRouter.createCaller(ctx)`**。description 用英文写清业务语义（模型靠它决定调不调），**必须带上业务术语的英文解释**，否则模型看不懂 `van` / `task` / `carry-over` 的关系。
  - 工具清单（description 为实现时须落地的英文原文）：

    | MCP 工具       | 对应 tRPC           | description（英文，实现时落地）                                                                                                                                                                                                 |
    | -------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
    | `van_list`     | `van.list`          | List all delivery-run codes, newest first. Code format is `DV` + 2-digit year + 2-digit month + letter, e.g. `DV2609A`.                                                                                                         |
    | `tasks_by_van` | `van.tasks.byVan`   | List the packages on one van, in board display order. Pass `limit` to cap rows; when the cap is hit the response sets `truncated: true` and reports the total.                                                                  |
    | `tasks_all`    | —（`listAllTasks`） | List every package across all vans. Read-only debugging aid — prefer `tasks_by_van` for normal use.                                                                                                                             |
    | `members_list` | `van.members.list`  | List team members and their weekly capacity in points (1 point = half a day, 10 = full week, max 14).                                                                                                                           |
    | `stats_by_van` | `van.stats.byVan`   | Weekly statistics for one van: task counts, completion rate, carry-over rate, per-owner capacity, requester scorecards, rarity inflation, source split, carry-reason breakdown, yesterday's-weather suggested load, and badges. |

  - **Acceptance criteria**：
    - [ ] 5 个工具在 Inspector 中可列出、可调用、返回真实数据
    - [ ] `tasks_by_van` 超 `limit` 时返回 `truncated: true` 与实际条数，**不静默丢弃**
    - [ ] 非法入参（如 `van: 'ABC'`）返回 MCP 错误而非崩溃——**证明 zod 校验确实生效**
    - [ ] `api/mcp/tools/read.test.ts` 覆盖「caller 被正确调用」「错误映射为 MCP 错误」两条
  - **Verification**：`npm test`；Inspector 手工过一遍
  - **Dependencies**：任务 2 ｜ **Files**：`api/mcp/tools/read.ts`、`api/mcp/tools/read.test.ts` ｜ **Scope**：M
  - **Commit**：`feat: 只读 MCP 工具集（van/tasks/members/stats，经 tRPC caller 执行）`

- [ ] **任务 4（S）：审计链校验工具**
  - **Description**：`audit.ts` 已有纯函数 `verifyAuditChain` / `fingerprintOf`，但**没有读全链的查询函数**。补 `listAuditRows()`（按 id 升序），新增 `audit_verify` 工具返回「断点下标 / 链头指纹」。这是 dev 最有价值的自查工具（对应锚定仪式）。description（英文）：`Verify the integrity of the SHA256 hash-chained audit log. Returns \`ok\`, \`brokenAt\` (index of the first broken link, or null), and the chain-head fingerprint used in the weekly meeting record.`
  - **Acceptance criteria**：
    - [ ] 返回 `{ ok: boolean, brokenAt: number | null, fingerprint: string | null }`
    - [ ] 空链时 `ok: true` + `fingerprint: null`（创世哈希语义正确）
    - [ ] `audit.test.ts` 补 `listAuditRows` 用例
  - **Verification**：`npm test`
  - **Dependencies**：任务 2 ｜ **Files**：`api/queries/audit.ts`、`api/queries/audit.test.ts`、`api/mcp/tools/read.ts` ｜ **Scope**：S
  - **Commit**：`feat: 审计链校验 MCP 工具——补 listAuditRows 与链完整性自查`

### 检查点：只读能力完成

- [ ] 5+1 个只读工具可用；`npm test` / `npm run check` / `npm run lint` / prettier 全绿；e2e 无回归

### 阶段 2：写工具（开关控制）

- [ ] **任务 5（M）：写工具注册 + `MCP_WRITES` 开关 + 危险度标注**
  - **Description**：`api/mcp/tools/write.ts` 实现写工具，**仅当 `MCP_WRITES=on` 时注册**。每个写工具强制 `actor` 参数（承接软身份，落审计链）。用 MCP `annotations` 标注危险度，**description 中须明写不可逆后果**（模型读的是 description，不是 annotations）。
  - 工具清单（全部对应既有 mutation，**不新增任何业务规则**）：

    | MCP 工具                          | 危险度 | description 要点（英文）                                                                                                                                                                   |
    | --------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
    | `van_dispatch`                    | 中     | Dispatch a new van. Month-scoped letter sequencing is automatic.                                                                                                                           |
    | `tasks_add` / `tasks_update`      | 中     | Add/update a package. `actor` is required and is recorded in the audit log.                                                                                                                |
    | `tasks_confirm`                   | 中     | Confirm receipt of a delivered package. Must be `status=done`, van not archived, and `actor` an existing member.                                                                           |
    | `carry_run`                       | **高** | **DESTRUCTIVE.** Writes a `carried` marker that **permanently archives the source van** — once any carried task exists, that van can no longer be added to, edited, or have tasks removed. |
    | `tasks_remove` / `members_remove` | **高** | **DESTRUCTIVE.** Removal is recorded in the audit log; member removal is rejected if the name appears on any package as owner, requester, or confirmer.                                    |

  - **Acceptance criteria**：
    - [ ] 默认（`MCP_WRITES` 未设）时 `tools/list` **不含任何写工具**
    - [ ] `MCP_WRITES=on` 时写工具出现，且缺 `actor` 的调用被拒绝
    - [ ] `carry_run` 经 MCP 执行后，**审计链 `verifyAuditChain` 仍返回 ok**（复用任务 4 的工具自证）
    - [ ] `api/mcp/tools/write.test.ts` 覆盖「默认不注册」「开关注册」「缺 actor 拒绝」三条
  - **Verification**：`npm test`；`MCP_WRITES=on` 用 Inspector 实跑一次结转演练（**在测试库上**）
  - **Dependencies**：任务 3、4 ｜ **Files**：`api/mcp/tools/write.ts`、`api/mcp/tools/write.test.ts`、`api/mcp/server.ts` ｜ **Scope**：M
  - **Commit**：`feat: 写类 MCP 工具——MCP_WRITES 开关控制 + actor 必填 + 危险度标注`

### 检查点：全量完成

- [ ] 只读 + 写工具全部可用；`npm test` / `npm run check` / `npm run lint` / `npx prettier --check .` 全绿；`npm run test:e2e` 无回归
- [ ] **人工评审后再决定是否合并**

### 阶段 3：文档（随实现收口）

- [ ] **任务 6（S）：文档与调试入口**
  - `README.md` 加「MCP」节：启用方式、开关、Inspector 调试步骤、安全边界（**勿暴露公网**，与既有约定一致）；`AGENTS.md` 目录结构加 `api/mcp/`，并加一条约定「MCP 工具一律经 tRPC caller 执行，**禁止在工具里直连 `queries/`**」——防止后续维护绕过校验。
  - **Dependencies**：任务 5

### 明确不做（本期）

- **不预建 Phase 2 机制工具**（议价单 / 预测投票 / 让步总账 / `swap` 枚举）——Gate 2 复盘会尚未拍板「工具化范围」，预建会形成既成事实干扰决策；目录与注册机制已留扩展位，拍板后按域新增 `tools/phase2.ts` 即可。
- **不做鉴权**——沿用项目现状（全 public），不因 MCP 单独引入。
- **不做 stdio 形态**——HTTP 已满足本机与内网；不额外维护一层薄代理（拍板记录 3）。
- **不做业务向自然语言界面**——MCP 提供的是「能力」，团队要聊天式入口需要另做前端；本期只交付能力层。
- **不改 `serializeAudit` 格式**，不碰 `runTx` / `appendAudit` 内部实现。

## Risks and Mitigations

| 风险                                                                   | 影响   | 缓解                                                                      |
| ---------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------- |
| zod schema 拆分引入行为漂移                                            | 中     | 纯搬迁；`vanRouter.test.ts` 现有拒绝用例**不改即须通过**，是最强回归保证  |
| `createCaller` 绕过了 superjson 序列化                                 | 低     | caller 返回原生 JS 值，**正是我们想要的**；无需 transformer               |
| `/mcp` 被 vite dev server 的 `exclude` 正则吞掉（dev 可用、prod 挂掉） | 中     | 任务 2 验收项明确要求 dev + prod **双模式**实测；不挂尾斜杠               |
| 写工具被误用造成整班归档锁定                                           | **高** | 默认不注册 + 开关控制 + `destructiveHint` 标注 + 工具描述中写明不可逆     |
| MCP SDK v2 Hono 适配器不成熟                                           | 中     | 降级路径已定：低层 `StreamableHTTPServerTransport` 手动挂载，业务层零改动 |
| 输出过大撑爆模型上下文                                                 | 中     | `limit` + `truncated` 显式标记，绝不静默截断                              |
| 提前预建 Phase 2 工具干扰 Gate 2 决策                                  | 中     | 本期明确不做，扩展位靠目录分片预留                                        |

## 拍板记录（2026-09-28，四项已决）

1. **工具描述语言 → 英文。** 作为对 AGENTS.md「注释与业务文案使用中文」的显式例外，仅限 MCP tool description；工具名、参数名、错误文案、代码注释一律照旧中文。已在 Architecture Decisions 固化。
2. **写工具默认策略 → 未注册。** `MCP_WRITES` 未设时 `tools/list` 不含任何写工具（未注册优于注册后拒绝）；`on` 时才注册并强制 `actor`。
3. **stdio 形态 → 不补。** HTTP 已满足本机与内网；若日后出现「AI 编辑器只能配 stdio」的场合，再加一层薄代理转发到 `/mcp`，届时另行评估。
4. **文档落位 → 立一页纸。** 已建 `docs/archived/v2.4-MCP接入一页纸实施提案.md`；本文保留为详细工作产出。

## 遗留 Open Questions

- **版本号与代号**：~~提议 v2.4.0，待发版拍板~~ **已定并发布**——v2.4.0「STEINS;GATE」（2026-09-28，commit `d003f66`），`package.json`、README 谱系、AGENTS.md、`release.yml` 发版说明均已同步。
- **Phase 2 工具化**：Gate 2 复盘会拍板「工具化范围」后再动，届时按 `tools/phase2.ts` 分片新增。
