# v2.2 评审 + doing/ 全文档差距修复计划（v2）

> 2026-09-04 立项；同日扩展为 doing/ 四文档全量差距评审的合并修复计划。
> 来源：v2.2 二轮代码评审（代码级缺陷）+ doing/ 全文档对照代码与运行状态的差距评审。
> 结论总览：唯一影响功能的差距是切班显隐丢失（Critical）；其余为并发风险加固、入参加固、文档时效/承诺未兑现项；最大的流程差距是「未部署」卡住了 Gate 0 / Phase 2 系统侧仪式 / 锚定仪式整条管线。

## Overview

五个阶段：① 必做代码修复（显隐丢失 + 审计链分叉）；② 可选代码加固（入参校验 + mysql group_concat）；③ 文档收口（灵魂文档决议 7 执行与附 2 残留修订、三份计划文档状态行、v2.1 手册补注、过时注释）；④ 发版与部署（版本策略拍板 → tag → GHCR → 部署）；⑤ 流程启动与归档（Gate 0 基线、锚定仪式、文档归档动作）。阶段 1/2 即前版计划的任务 1~4，不变。

## Architecture Decisions

- **任务 1 选「colDef 去 `hide`」而非「effect 延迟一帧重套」**：后者依赖与 AG Grid 内部属性应用时序的赛跑，脆弱且难测；前者让显隐成为纯列状态（AG Grid 文档化行为：colDef 不含 `hide` 时，columnDefs 更新按 colId 匹配保留列状态），从根上消除冲突。初始隐藏由已有 `onGridReady → applyColumnVisibility` 承担（首帧无闪烁）。净变化 = 删 2 行。
- **任务 2 选「写锁串行化」而非「仅文档化」**：runTx 的 pg/mysql 分支 body 前取事务级写锁（pg `pg_advisory_xact_lock`、mysql 对 `_dv_meta.schema_version` 行 FOR UPDATE），所有写事务先取同一把锁 → 与 sqlite `BEGIN IMMEDIATE` 等价的写串行化，审计链分叉与事务内前置检查竞态一并消除。锁 SQL 收敛 `dialect.ts`（`writeLockSql()`，与 `groupConcatSql` 同模式）。事务外读的 TOCTOU 维持「明确不做」口径。
- **发版策略（推荐，待拍板）**：直接发 **v2.2.0**，不回溯打 v2.0.0 tag——回溯 tag 的镜像不含 v2.2 修复与多方言支持，无运维价值；Phase 2 约定零发版。README 谱系补 v2.2 行，v2.0 行标注「未独立发版，随 v2.2.0 首发」。
- **灵魂文档处置（执行决议 7 + 一处注记豁免）**：移至 `docs/` 根目录作常驻核心文档（决议 7 原文，v2.0 已立项，逾期未执行）；「doing/ 只放一页纸实施提案」以注记豁免——v2.0 落地计划与 AGENTS.md 已承担该职能，在决议 7 处追加注记说明，不改写决议。
- **文档修订纪律**：所有对已定稿文档的修订以「追加注记」为主（符合仓库文档规范），状态行（文档头部）可直接更新。

## Task List

### 阶段 1：必做代码修复

- [ ] **任务 1（P0 / S 级）：修复切班后长文本列显隐丢失**
  - **Description**：`src/pages/BoardPage.tsx` 删除 `_acceptance` 与 `_note` 两个 colDef 的 `hide: true`（2 行）。先在 `e2e/board.spec.ts` 加回归用例（红）→ 删 2 行（绿）。
  - **Acceptance criteria**：
    - [ ] 新 e2e 用例：默认两列隐藏 → 勾选「验收标准」→ 列头出现 → 切班再切回 → 列头仍在、「备注」仍隐藏（修复前确定性失败）
    - [ ] 全量 e2e 绿；人工 dev 验证开关/切班/编辑/invalidate 后显隐保持、首帧无闪烁
  - **Verification**：`npm run test:e2e`；dev 人工过一遍
  - **Dependencies**：无 ｜ **Files**：`src/pages/BoardPage.tsx`、`e2e/board.spec.ts` ｜ **Scope**：S
  - **Commit**：`fix: 切班后长文本列显隐丢失——colDef 去 hide 让显隐成为纯列状态，附 e2e 回归`

- [ ] **任务 2（P1 / S~M 级）：pg/mysql 写事务串行化，堵审计链分叉**
  - **Description**：`dialect.ts` 新增 `writeLockSql()`（pg advisory xact lock 常量；mysql `_dv_meta` 版本行 FOR UPDATE；sqlite null）；`tx.ts` pg/mysql 分支 body 前 await 锁。
  - **Acceptance criteria**：
    - [ ] `dialect.test.ts` 补 writeLockSql 三方言分支用例；本地四件套绿（sqlite 零行为变化）
    - [ ] CI 三方言矩阵绿；`tx.ts` 注释写明写串行化语义与事务外 TOCTOU 口径
  - **Verification**：四件套 + CI ｜ **Dependencies**：无（与任务 1 可并行）｜ **Files**：`dialect.ts`、`tx.ts`、`dialect.test.ts` ｜ **Scope**：S~M
  - **Commit**：`fix: pg/mysql 写事务取锁串行化——堵审计链并发分叉（advisory lock / _dv_meta 行锁）`

### 阶段 2：可选代码加固（建议做，可砍）

- [ ] **任务 3（P2 / XS~S）：API 入参校验补强**
  - `vanRouter.ts`：update 的 `doneAt` 加 `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)`；add/update 的 `requester` 加 `.min(1)`；`vanRouter.test.ts` 补两组拒绝用例。
  - **Verification**：`npm test` ｜ **Files**：`api/vanRouter.ts`、`api/vanRouter.test.ts` ｜ **Commit**：`fix: doneAt/requester 入参校验补强（日期格式 + 非空）`

- [ ] **任务 4（P2 / XS）：mysql group_concat 上限 + 过时注释**
  - `connection.ts` mysql 分支 `pool.on('connection', ...)` 设 `group_concat_max_len`；`boot.ts`「SQLite 本地文件」注释改方言化表述；三份 schema 的 capacity 注释「天」→「点」。
  - **Verification**：check/prettier ｜ **Files**：`connection.ts`、`boot.ts`、三份 `db/schema*.ts` ｜ **Commit**：`chore: mysql group_concat_max_len 加固 + 过时注释清理`

### 检查点：代码修复完成

- [ ] 本地四件套 + e2e 全绿；推送后 CI 三 job 绿

### 阶段 3：文档收口（doing/ 差距评审产物）

- [ ] **任务 5（S）：灵魂文档执行决议 7 + 附 2 残留修订**
  - **Description**：① `docs/doing/博弈机制科研探索-PM与开发显性博弈设计.md` 移至 `docs/` 根目录（git mv，决议 7）；② 决议 7 处追加注记：一页纸实施提案豁免（由 v2.0 落地计划与 AGENTS.md 承担职能）；③ 正文补附 2 承诺但未落地的四处：结论节「诺奖标准答案」措辞收敛（附 1 Minor 2）、法务注记（gacha 概率公示，内部工具低风险一句带过）、数据最小化注记（让步总账滚动保留 4 季，Phase 2 工具化时生效）、M9「点数制下的估算博弈分析」小节（可用附 2 M9 应答内容浓缩）；④ 状态行更新：「分支 feat/v2.0-phase1」→ 已并入 main、待发版策略见 README 谱系；⑤ T2.1 咬合节的 `carriedReason/'stranded'` 命名处加一句注记（实际代码为 `carry_reason`，Gate 2 工具化时对齐）。
  - **Acceptance criteria**：文档移至 docs/ 根且 AGENTS.md/各计划文档中所有引用路径同步更新；上述四处正文修订完成
  - **Files**：灵魂文档（git mv + 编辑）、`AGENTS.md`、`docs/doing/v2.0-博弈机制落地计划.md`、`README.md`（关联文档链接）
  - **Commit**：`docs: 灵魂文档执行决议 7 移入 docs/ 根 + 附 2 残留修订落地`

- [ ] **任务 6（XS）：三份计划/手册文档状态收口**
  - **Description**：① v2.2 计划：line 112 实施状态小结更新（阶段 A 已随 d3ea355 提交、本轮评审结论与本修复批次补记）；「明确不做」小节补审计链分叉条目（任务 2 落地后改记「已修」）；② v2.0 计划：状态头更新（feat 分支已并入 main 可删、发版策略按拍板结果改写、Gate 0 待部署后启动）；WP2 示例 DDL 加注记（实际实现 ts/actor 无库级默认，由 appendAudit 统一供给）；③ v2.1 手册：启动记录补一句「系统侧仪式（周五落账/按统计条开奖/急件录件）依赖 v2.x 部署上线后生效」；§5.3 补操作提醒「朗读剔除前先开启表格上方『备注』列显示开关（v2.2 起默认隐藏）」；④ 删除远程 `feat/v2.0-phase1` 分支（已全并入，git push origin --delete）。
  - **Acceptance criteria**：四份文档与代码/仓库状态零矛盾；引用路径全通
  - **Files**：`docs/doing/v2.2-*.md`、`docs/doing/v2.0-*.md`、`docs/doing/v2.1-*.md`
  - **Commit**：`docs: doing/ 三份计划与手册状态收口——评审差距修复`

### 检查点：文档收口完成

- [ ] 全文检索（分支名/路径/「标准答案」/carryReason）无残留；prettier 绿

### 阶段 4：发版与部署（阻塞 Gate 0 / Phase 2 的关键路径）

- [ ] **任务 7（M，含一次拍板）：发版 v2.2.0**
  - **Description**：① 拍板版本策略（推荐直接 v2.2.0，见 Architecture Decisions；备选：回溯打 v2.0.0 再发 v2.2.0）；② README 谱系补 v2.2 行（表格体验 + 多数据库，代号按谱系取）+ v2.0 行标注「未独立发版，随 v2.2.0 首发」；AGENTS.md 项目概览版本段同步；package.json version bump 2.2.0；③ 确认 CI 三 job 绿 → 打 tag `v2.2.0` 推送触发 release.yml（GHCR 镜像 + Release 附件）；④ 按 README 部署节上线（sqlite 文件卷或 pg/mysql 连接串）。
  - **Acceptance criteria**：GHCR 镜像发布成功；部署实例 `/api/trpc/ping` ok、看板可访问、建首班数据落库
  - **Verification**：release workflow 绿 + 部署实例冒烟
  - **Open**：版本策略与谱系代号需用户拍板

- [ ] **任务 8（S）：流程启动与文档归档**
  - **Description**：① 部署后按 v2.0 计划启动【Gate 0】基线采集（班次 1 起记）；第一个周五复盘会跑通锚定仪式（指纹进纪要，补 v2.0 DoD 5）；Phase 2 系统侧仪式（周五落账/开奖）自此生效，4 班计时从首个完整走完议价台流程的班次起算；② 发版完成节点文档归档（按仓库文档组织规则）：`docs/doing/v2.2-表格体验与多数据库支持计划.md` → `archived/`、`docs/doing/v2.0-博弈机制落地计划.md` → `archived/`（Phase 1 已发版完结；Gate 1 判定记录改由纪要与 v2.1 手册承接）；v2.1 手册留在 doing/（纸面运行中）；③ AGENTS.md 目录结构与文档清单同步。
  - **Acceptance criteria**：纪要含指纹锚定；归档移动完成且引用路径更新
  - **Dependencies**：任务 7

### 检查点：全部完成

- [ ] 所有验收标准达成；CI 绿；部署实例运行中；文档与实际状态零矛盾

## Risks and Mitigations

| 风险                                                   | 影响 | 缓解                                                                                           |
| ------------------------------------------------------ | ---- | ---------------------------------------------------------------------------------------------- |
| 任务 1 依赖 AG Grid「colDef 无 hide 时保留列状态」行为 | 中   | 文档化行为 + e2e 红转绿直接证明；保留重套 effect 兜底；人工确认首帧无闪烁                      |
| 任务 2 mysql FOR UPDATE 在 `_dv_meta` 行缺失时静默无锁 | 低   | ensureSchema 后该行必存在；缺行=优雅降级为现状，不崩                                           |
| 灵魂文档移动造成引用断链                               | 中   | git mv 后全文检索路径批量更新（AGENTS.md/README/三份计划/纪要模板）；prettier + 人工复核       |
| 发版策略拍板悬置                                       | 中   | 计划给默认推荐（v2.2.0 直发），阻塞点只有一处、可快速决策                                      |
| 归档时机争议（v2.0 计划是否等 Gate 1）                 | 低   | Phase 1 交付物已发版即完结，判定流程由纪要/手册承接；如需保留在 doing/ 亦可，只影响任务 8 一行 |
| doneAt 严校验拒绝历史脏数据回写                        | 低   | 存量均为前端编辑器产出的 YYYY-MM-DD；报错反而暴露脏数据                                        |
| CI 是 pg/mysql 唯一真实验证环境                        | 中   | 锁 SQL 语法错误会让变体套件全红（fail loud）                                                   |

## Open Questions

1. **发版版本策略**（任务 7）：推荐直接 v2.2.0、不回溯打 v2.0.0 tag；谱系代号待取。
2. 任务 3/4 是否纳入（建议纳入，合计 < 1 小时）。
3. v2.0 落地计划归档时机（推荐发版后即归档；也可等 Gate 1 后）。
