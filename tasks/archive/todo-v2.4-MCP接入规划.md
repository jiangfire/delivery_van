# MCP 接入 todo（v1：只读先行，写工具开关控制）——✅ 已完成（2026-09-28）

> 计划全文见 `tasks/archive/plan-v2.4-MCP接入规划.md`，一页纸提案见 `docs/archived/v2.4-MCP接入一页纸实施提案.md`。
> 状态：**六个任务全部实施完毕，四件套 + e2e 全绿**。

## 阶段 1：地基（只读通路）

- [x] 任务 1（S）：zod schema 抽出到 `api/schemas.ts`（纯搬迁、零行为变化；`vanRouter.test.ts` 14/14 **一行不改**通过，并保留 6 个 re-export 兼容既有导入面）
- [x] 任务 2（S~M）：MCP server 骨架 + `/mcp` 挂载 + 工具注册机制（`createMcpHandler` stateless；dev + prod **双模式实测连通**）

### 检查点：地基可用 ✅

- [x] 经 `/mcp` 真实 JSON-RPC 往返：initialize / tools/list / tools/call 均通（单测 + 生产进程实测双证）
- [x] tRPC 与前端零回归（`npm test` 190 passed；`npm run test:e2e` 23/23）

- [x] 任务 3（M）：只读工具集 6 个（经 caller；**description 英文**；`limit` + `truncated` 不静默截断；非法入参证明 zod 生效）
- [x] 任务 4（S）：审计链校验工具（补 `listAuditRows()` + `audit_verify`，空链 `ok:true` + `fingerprint:null`）

### 检查点：只读能力完成 ✅

- [x] `tsc -b` / `eslint` / `prettier --check .` / `npm test` 全绿

## 阶段 2：写工具（开关控制）

- [x] 任务 5（M）：写工具 10 个 + `MCP_WRITES=on` 开关（**默认不注册**）+ `actor` 必填 + `destructiveHint` + description 明写不可逆后果

### 检查点：全量完成 ✅

- [x] 四件套全绿 + e2e 23/23（人工评审已过，最终于 v2.4.0 提交并发布）

## 阶段 3：文档

- [x] 任务 6（S）：README「MCP」节（启用/开关/Inspector/安全边界）；AGENTS.md 加 `api/mcp/` 目录说明与「MCP 工具硬约束」六条（含 vite exclude 陷阱告警）

## 拍板记录（2026-09-28，四项已决并实施）

- [x] 工具 description 用英文（仅 description 例外于「注释与业务文案使用中文」；参数名/错误文案/代码注释仍中文）
- [x] 写工具默认**不注册**（`MCP_WRITES` 未设即 `tools/list` 无写工具）
- [x] 不补 stdio 薄代理
- [x] `docs/archived/v2.4-MCP接入一页纸实施提案.md` 一页纸实施提案 ✅ 已建（随 v2.4.0 发布归档）

## 实施中发现并修正的问题（计划外的真 bug）

- [x] **`vite.config.ts` 的 devServer `exclude` 吞掉 `/mcp`（dev 404 / prod 正常）**：原式 `/^\/(?!api\/).*$/` 把所有非 `/api/` 路径推给 Vite。已改为 `/^\/(?!(api|mcp)(\/|$)).*$/`，并补 `api/mcp/viteExclude.test.ts` 做回归守卫。**单测打 Hono 的 `app.fetch` 绕过 Vite 中间件，只有真跑 dev 模式才暴露。**
- [x] **计划文档里的正则写错了**：规划时把 `/^\/(?!api\/).*$/` 误读为 `...\/$/`，还拿臆造的版本去 node 里"验证"，导致最初的风险判断完全错误。已修正 `tasks/archive/plan-v2.4-MCP接入规划.md`、一页纸、`api/boot.ts` 与 `vite.config.ts` 注释。

## 代码审查与修复（2026-09-28 第二轮）

只读审查发现 9 个缺陷 + 1 条既有缺口，**已全部修复**（基线 = HEAD 未提交改动）：

- [x] **P0-1** `vite.config.ts:14` 注释称 `/mcp/` 会被推给 Vite —— 与实测相反（实测落到 Hono，404 len=13；Vite 是 len=0），且与 `boot.ts`/`README` 自相矛盾。已改正
- [x] **P0-2** `server.ts` 硬编码 `version: "2.3.0"` 违背计划。改为构建期从 `package.json` 内联（新增 `resolveJsonModule`），已实测 `serverInfo.version` = 2.3.0
- [x] **P0-3** `boot.ts` 注释称 MCP 初始化「推迟到建表之后」但实际在 `ensureSchema` 之前。**已把注册真正挪到 `ensureSchema()` 之后**，注释为真且建表失败时不会留下指向未建表的端点；dev/prod 双模式复验通过
- [x] **P0-4** `stats_by_van` description 让模型找 `definition` 字段（全仓无此字段）。已改为点名真实字段并写清 done 口径 vs 签收口径的差异
- [x] **P1-5** `members_set_capacity` 是唯一无 actor 的写工具，而 `write.ts:12` 宣称「actor 必填」、测试名也宣称但实际只断言「空对象被拒」。**已让不变量为真**：`memberSetCapacityInput` 补 actor、tRPC 透传、`updateMemberCapacity` 补审计记账（`capacity` 字段，带 actor 与新旧值），并在内存 SQLite 套件加两条真实验证；测试改为直接断言「schema 形状里有 actor」且「actor 非 optional」
- [x] **P2-6** `@modelcontextprotocol/hono` 是死依赖（全仓零 import），已卸载并修正 `tasks/archive/plan-v2.4-MCP接入规划.md` 措辞
- [x] **P2-7** `tasks_all` 无上限（与 `tasks_by_van` 口径矛盾），已补 `limit` + `truncated`
- [x] **P2-8** `read.ts` 同模块混用静态与动态 import，已并为静态
- [x] **P2-9** vite exclude 缺回归守卫，已补 `api/mcp/viteExclude.test.ts`（同时断言三处关于 `/mcp/` 的说法一致）

修复后质量门：`tsc` / `eslint` / `prettier --check .` 全绿，`npm test` **201 passed**（新增 3 条），`npm run test:e2e` **23/23**，真机 prod + dev 双模式复验通过。

**遗留（非本次引入，已单列）**：~~`updateMemberCapacity` 不写审计链~~ —— **已随 P1-5 一并补齐**，不再是缺口。

## 发版准备 v2.4.0（2026-09-28）

- [x] 版本号 bump：`package.json` 2.3.0 → **2.4.0**（MCP 是新功能 = minor；代号沿 v2.x.y 全系 `STEINS;GATE`）
- [x] README 谱系补 v2.4 行 + Docker 示例镜像标签 v2.3.0 → v2.4.0
- [x] AGENTS.md 当前版本段更新（并把「v2.4 已立项未开工」改为已发布状态）
- [x] `release.yml` 发版说明重写为 v2.4 内容（原为 v2.3 的文字 + 「单测 168」陈旧计数，已核为 **201（+76 方言变体）**）
- [x] `release.yml` 容器冒烟**新增 `/mcp` 握手检查**（本版主打功能此前完全不在冒烟范围内；曾栽过 dev 正常/prod 挂的坑，冒烟必查）
- [x] **发版说明 heredoc 反引号转义**：NOTES 用的是不带引号的 `<<EOF`，其中反引号会被 shell 当**命令替换**执行——实测未转义时 bash 报 `/mcp: No such file or directory` 并**静默把文字从说明里抹空**。已全部转义为 ``\` `` 并用 Git Bash 复现验证渲染正确
- [x] 发版前全量复验：`tsc` / `eslint` / `prettier --check .` / `npm test` 201 / `npm run build` / 真机 prod（MCP `serverInfo.version` = **2.4.0**，证明版本取自 package.json 的修复生效）
- [x] **提交 + 打 tag `v2.4.0` + 推送**（触发 `release.yml`：GHCR 镜像 + Release zip）——2026-09-28 已执行并完成
- [x] **两条流水线全绿**：Release success（`delivery_van-v2.4.0.zip` 1.62 MB + `ghcr.io/jiangfire/delivery_van:v2.4.0`）；CI success
- [x] **CI 内单测 277 passed / 277 零 skip**——即本地 skip 的 76 例 pg/mysql 方言变体在真实容器全跑通，补上发版前最后一块未实测项

### 发版实况（2026-09-28）

- commit `d003f66`，tag `v2.4.0` 指向同一 commit，fast-forward 推 `origin/main`
- Release「v2.4.0 STEINS;GATE」：<https://github.com/jiangfire/delivery_van/releases/tag/v2.4.0>
- CI 三个 job 全过：check（277 单测 + lint + tsc + prettier）、e2e（23/23）、docker（**含新增的 `/mcp` 容器握手冒烟**）
- 临发版修掉一个真缺陷：两条冒烟的 `protocolVersion` 原写 `2025-06-18`，而 SDK v2 只支持 `2025-11-25` / `2026-07-28`；**SDK 对不支持的版本是优雅降级不报错**，故它能一路混过 CI 直到客户端真用它才炸。已统一改为 `2025-11-25` 并实测原样协商

### 本地无法补的验证（留给 CI，且已由 CI 兑现）

本机无 docker；本机 5432 有 Postgres 但需密码且无凭据，而 harness 的 `cleanAllTables` 会**清空目标库全部表**，指向任何在用库都是破坏性的——不可借道。v2.2 设计文档已将 pg/mysql 定为 CI 专属验证关卡，本次照此执行。

## 遗留待拍板

- [x] 版本号与代号——**已定为 v2.4.0「STEINS;GATE」并发布**（`package.json`、README 谱系、AGENTS.md、`release.yml` 说明均已同步）
- [ ] Phase 2 工具化范围——待 Gate 2 复盘会（扩展位已在 `api/mcp/tools/` 按域预留）
