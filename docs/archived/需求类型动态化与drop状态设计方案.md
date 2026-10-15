# 需求类型动态化与 drop 状态设计方案（v2.7）

> 状态：已实施并随 v2.7.0 发布（2026-10-15 归档；含同日双代理 review 修复，见「Review 修复记录」）。两项需求：① 「需求类型」（即快件来源 `tasks.source`，原客户/平台/探索三枚举）改为**可修改可增加**的存库动态列表；② 快件状态新增 **drop（放弃）**。方向四问已于 2026-10-15 由用户拍板（见「已拍板决策」）。决策编号延续 v2.6 的 D17，从 D18 起。

## 目标

1. 团队可以自行新增需求类型（如「运营」「技术债」）、改名显示名，不必发版改枚举；
2. 不做了的快件可以标记「放弃」，从一切统计口径中出清，且不参与结转、不挡徽章；
3. 既有口径连续性不被破坏：非 drop 件的完成率/滞留率/签收/昨日天气/徽章数值与 v2.6 完全一致。

## 已拍板决策（2026-10-15，用户四问）

| 问题                   | 拍板                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 「需求类型」指哪个字段 | 来源（`tasks.source`，客户/平台/探索）                                                                                  |
| 形态                   | 存库管理：内置三项 + 可新增自定义；改名只改显示名（内部 code 稳定，历史零迁移）；删除仅限零引用；服务端校验必须命中列表 |
| drop 口径              | 彻底出清：不进任何分母/分子（完成率、滞留率、三方占比、昨日天气、徽章、记分卡），只在表格可见                           |
| drop 动线              | 手动双向：todo/doing 可选「放弃」；drop 后聚合重算不覆盖；可手动改回恢复；结转不带走 drop 件                            |

## 设计决策

### 需求类型（来源）动态化

- **D18 存储模型**：新表 `sources(code PK, label NOT NULL UNIQUE, built_in NOT NULL DEFAULT 0, created_at)`，三方言同步（sqlite/pg text，mysql varchar(16)，均无外键）。`tasks.source` 继续存 **code**。内置三项 `customer/platform/exploration` 由 ensureSchema 幂等种子（`INSERT OR IGNORE` / `ON CONFLICT DO NOTHING` / `INSERT IGNORE`，`built_in=1`，种子 SQL 三方言硬编码），库表是唯一事实来源；`contracts/enums.ts` 的 `SOURCES` 供 `listSources` 排序，`SOURCE_LABELS` 用作前端在 sources 未加载完成时的显示兜底。自定义类型创建时 **code == 显示名**，此后 code 永不变，改名只动 label——历史数据零迁移。code/label 统一 trim 后 1~16 字符（16 与 mysql `tasks.source varchar(16)` 列宽对齐，零 ALTER）。
- **D19 操作面**：新子路由 `van.sources.{list,add,rename,remove}`，业务在 `api/queries/sources.ts`（与 van.ts 分文件）。add 按 label 查重（CONFLICT；label 不得以「＋」开头——该前缀保留给看板下拉的新增哨兵项，zod 层拒绝）；rename 只改 label（含内置项，`code` 不动，并发撞 label 唯一约束时归一为 CONFLICT 不裸 500）；remove 双守卫——`built_in=1` 拒绝、`tasks.source` 有引用拒绝（报引用件数，**引用复查在删除事务内**执行，封堵与 addTask 值域校验的交错窗口），零引用自定义硬删。四个操作都是写操作带 `actor`，审计 entity=`source`、entityId=code、field=`*`（增删）/`label`（改名），与成员管理同款同事务。
- **D20 校验分层**：`api/schemas.ts` 的 `sourceField` 从 `z.enum(SOURCES)` 放宽为 `z.string().trim().min(1).max(16)`（形状校验）；「必须命中 sources 列表」在数据层 `addTask/updateTask` 查表校验（不存在抛 BAD_REQUEST 并列出可用值）——对齐成员存在性校验的既有位置，zod 保持同步可生成 MCP JSON Schema。
- **D21 统计读模型**：`sourceStatsOf(rows, codes)` 增传入列表参数，按列表出桶（含零桶，保持迷你条结构不变），返回 `source: string`（code），drop 件出清（见 D28）；`weeklyStats` 从 sources 表读列表传入。前端以 `code→label` 映射显示。
- **D22 前端**：`BoardPage` 挂 `van.sources.list` 查询，构建 labelOf / label→code 反查 / 配色（内置三色保留，自定义按 `SOURCE_PALETTE` 序取，`src/lib/sources.ts`）。来源列下拉 values 动态化，并加哨兵项「＋ 新增类型…」；统计面板来源页签加「管理类型」入口；两者共用新组件 `SourceManagerDialog`（新增/改名/删除，删除走 confirm，失败 toast 服务端守卫文案）。「三方占比」文案改「来源占比」。
- **D23 MCP**：读加 `sources_list`；写加 `sources_add/sources_rename/sources_remove`（与 members 三件套对齐，`MCP_WRITES=on` 才注册）；`tasks_add/tasks_update` 的 source 参数描述改为「use sources_list」。

### drop（放弃）状态

- **D24 五态**：`todo/doing/done/carried/drop`，三方言 drizzle enum 同步加 `"drop"`（DB 列 text/varchar(16) 原样装得下，无值域迁移）。`STATUS_LABEL` 加 `drop:「放弃」`，样式 `status-badge status-drop`。
- 结转归档后同班的 drop 件与 done 件一样整班只读锁定（不可恢复，弃置决策随班封存）。**D25 手动双向动线**：状态列按当前状态给选项——todo/doing → [未开始/进行中/完成/放弃]；done → [未开始/进行中/完成]（**done 不可弃**，服务端守卫：`patch.status==="drop" && current.status==="done"` 抛 BAD_REQUEST「已送达的件不能放弃，请先取消完成」）；drop → [放弃/未开始/进行中]（恢复）。carried 归档只读不变。恢复后由聚合按叶子收敛（有人交付过 → doing，即 v2.6 已有的「手动状态被聚合收回」不变量的自然延续）。
- **D26 聚合粘性**：`aggregateOf` 的 status 推导把 `drop` 放在**最前**（优先于 allDone）：drop 不由聚合推导、不被叶子覆盖，恢复只能手动改状态。同时 `setOwnerDone/confirmTask` 对 `status==="drop"` 的件直接抛 BAD_REQUEST（已放弃的件不能打勾交付/签收），`updateTask` 对 drop 件传 `status:"done"` 或 `doneAt` 同样拒绝（先恢复）——从全部写入口杜绝「drop 且叶子全齐/带完成日期」的歧义状态。
- **D27 结转排除**：`carryOver` 的未完成筛选从 `ne(status,"done")` 改为 `notInArray(status,["done","drop"])`——drop 件留在原班不动、不复制、不触发归档。
- **D28 统计出清（一处函数一个口径）**：各纯函数自行滤掉 drop 行——`taskStatsOf`（total/remaining/两率的分母均剔除）、`requesterStatsOf`、`rarityInflationOf`、`sourceStatsOf`、`badgesOf`（teamPunctual 的分母与 streaks 的参与班次均剔除）；`suggestedLoadOf`/`carryReasonStatsOf` 天然 done/carried 口径不动；`weeklyStats` 内联段（byMember 的 mine、loadPoints）滤 drop；`unconfirmed` 天然不动。**不新增「放弃数」展示字段**（用户拍板纯出清，非「出清+面板加数」）；drop 件仅在表格状态列可见。
- **D29 审计**：drop/恢复走 `updateTask` 既有 status diff（field=`status`），零新增格式，序列化锁定不受影响。

### 版本与文档

- **D30**：落 **v2.7.0**（向后兼容新功能，minor；无破坏性入参变更——`sourceField` 从枚举放宽为字符串是超集）。版本 bump 与发版（tag/Release）单独收口提交，待用户确认后执行。
- **D31**：文档口径同步——AGENTS.md（快件来源/状态五态/口径出清三处规则）、README 谱系与速查、`docs/周度发车机制设计方案.md` 追加 2026-10-15 注记。本方案实施完成后归档进 `docs/archived/`。

## 任务分解

| #   | 任务                                                                                                                                                                                                            | 验收                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| T1  | 三方言 schema 加 `"drop"`、新增 `sources` 表；ensureSchema 三方言建表+种子；schemaDrift 加 `sources`                                                                                                            | `npm test` 方言套件绿；防漂移用例覆盖 sources |
| T2  | `api/queries/sources.ts`（list/add/rename/remove + 校验辅助）+ schemas.ts zod + vanRouter 子路由                                                                                                                | 内存库套件：增改删守卫/审计同事务用例绿       |
| T3  | van.ts：status 守卫（done 不可弃）、aggregateOf drop 粘性、setOwnerDone/confirmTask 拒 drop、carryOver 排除 drop、六个统计纯函数与 weeklyStats 出清、addTask/updateTask source 查表校验、sourceStatsOf 动态列表 | 纯函数单测 + 三方言套件绿                     |
| T4  | MCP：`sources_list` 读工具 + sources 三写工具 + tasks 工具描述同步                                                                                                                                              | read/write 工具测试绿（含 actor 必填断言）    |
| T5  | 前端：display/sources 工具、状态列选项按状态过滤+放弃徽标、来源列动态下拉+哨兵项、SourceManagerDialog、StatsBar/StatsPanel 适配与文案                                                                           | `npm run check` + e2e 绿                      |
| T6  | e2e：新增类型并选用、drop 出清与恢复、结转不带走 drop                                                                                                                                                           | `npm run test:e2e` 绿                         |
| T7  | 文档口径同步（AGENTS/README/机制设计注记）                                                                                                                                                                      | 全仓 grep 无「四态」「三方占比」残留旧口径    |

## 成功标准（不改即须通过）

1. 既有全部单测/e2e 不改断言即通过（口径连续性：无 drop 件时数值与 v2.6 逐位一致）；
2. 新增自定义来源 → 建件选用 → 统计面板来源页签与迷你条出现该类型；改名后历史件显示名同步、库中 `tasks.source` 不变；
3. 删除被引用类型被拒（报引用数），零引用自定义可删，内置三项不可删；
4. todo/doing 件可标放弃：统计条 total/remaining 立减、完成率/滞留率分母同步缩小、徽章不再被它挡住；结转后 drop 件仍在原班且原班未因此归档；
5. done 件在状态列看不到「放弃」选项，直连 API 传 `status:"drop"` 被服务端拒绝；
6. drop 件上 `setOwnerDone/confirm` 被拒；改回「未开始」后一切恢复；
7. 审计链上 drop/恢复/来源管理全部留痕且 `verifyAuditChain` 通过。

## Review 修复记录（2026-10-15，双代理审查后收口）

| #   | 发现                                                                                                                                   | 修复                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | drop 件直连 API 传 `status:"done"` 无守卫：件级完成快捷会给叶子打勾但件级保持 drop，造出 D26 明文禁止的状态，恢复后未经操作直接跳 done | `updateTask` 加对称守卫（drop 上拒绝 done/doneAt，提示先恢复）+ 回归用例                                              |
| 2   | 来源列 stale：sources 异步到位后 AG Grid 缓存单元格不重渲染，英文 code 滞留到下次编辑                                                  | ref 同步 effect 里追加 `refreshCells({columns:["_source"],force:true})`；`SOURCE_LABELS` 作内置显示兜底消灭加载期闪现 |
| 3   | 哨兵项「＋ 新增类型…」与真实类型撞名会使该类型经 UI 永远选不上                                                                         | `sourceField` zod 拒绝「＋」开头 + 用例；MCP description 同步                                                         |
| 4   | `renameSource` 并发撞 label 唯一约束裸 500；`removeSource` 引用预检与 addTask 值域校验有理论交错窗口                                   | rename 补 `isUniqueViolation`→CONFLICT；remove 引用复查挪进删除事务                                                   |
| 5   | `SOURCE_COLOR`（display.ts）与手写 labelOf/colorOf（StatsBar/StatsPanel）成重复/孤儿                                                   | 删孤儿；两组件收敛到 `buildSourceStyle` 单一实现                                                                      |
| 6   | README MCP 工具数、多处「四态/三方占比」旧口径、MCP tasks_update 描述未提 drop 不可直接完成                                            | 全部同步；确认 drop 出清在所有统计口径无遗漏、结转/审计/三方言/事务铁律核对无问题                                     |

## 风险与对策

- **label 反查失效**（改名后正在编辑的旧 label）：反查不到即不写并 invalidate 回滚到服务端数据（既有约定）。
- **mysql 旧库 source 列宽**：16 字符上限由 zod 双入口（tRPC/MCP）拦截，pg/sqlite text 不受限但同样按 16 收口，防止三方言值域漂移。
- **e2e 共享库累积**：新用例沿用既有「新班次内自建数据」模式，不依赖历史班次状态。
