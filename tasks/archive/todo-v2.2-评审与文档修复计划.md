# 修复 todo（v2：含 doing/ 全文档差距）——已完成（2026-09-04）

## 阶段 1：必做代码修复 ✅

- [x] 任务 1：e2e 加「显隐开关切班保持」回归（先红）→ BoardPage 删两处 `hide: true`（转绿）→ e2e 全绿（commit 179821c）
- [x] 任务 2：dialect.ts 加 `writeLockSql()` → tx.ts pg/mysql 取锁 → dialect.test 补用例 → 注释补写串行化口径（commit de05bea）

## 检查点：代码修复 ✅

- [x] 本地四件套 + e2e 22/22 全绿；CI 三 job 绿（run 33886894358，pg/mysql 变体真实连库）

## 阶段 2：可选代码加固 ✅（已纳入）

- [x] 任务 3：doneAt 日期正则 + requester `.min(1)` + router 拒绝用例（commit 56b0c77）
- [x] 任务 4：mysql group_concat_max_len 会话调大 + boot/schema 过时注释（commit a4d3bb7）

## 阶段 3：文档收口 ✅

- [x] 任务 5：灵魂文档 git mv 至 docs/ 根 + 决议 7 豁免注记 + 附 2 残留修订（措辞收敛/法务注记/数据最小化/M9 小节）+ 状态行更新 + carriedReason 命名注记 + 引用路径全量更新（commit df20be5）
- [x] 任务 6：v2.2 计划小结与「明确不做」更新；v2.0 计划状态头（分支/发版/Gate 0）+ WP2 DDL 注记；v2.1 手册补部署前置与备注列开关提醒；删远程 feat/v2.0-phase1（commit 2b43c57）

## 阶段 4：发版与部署 ✅（代码侧完成；部署为线下动作）

- [x] 任务 7：版本策略拍板（v2.2.0 直发）→ README 谱系 + package.json（commit 8300f0b）→ CI 绿 → tag v2.2.0 推送 → release workflow 绿 → GHCR 镜像 + Release 附件发布；发现并修正 release.yml 模板遗留的 v1.2.0「niulai」硬编码（已就地修正 Release 标题/正文，commit dfb3533）
- [x] 任务 8（文档部分）：v2.2/v2.0 计划归档 + 引用路径更新 + AGENTS/README/设计方案同步（commit 9b571f9）

## 待线下执行（无法代办）

- [ ] 部署 v2.2.0（docker pull ghcr.io/jiangfire/delivery_van:v2.2.0，按 README 部署节）
- [ ] 部署后启动 Gate 0 基线采集；首个周五复盘会跑通锚定仪式（指纹进纪要，补 v2.0 DoD 5）
- [ ] Phase 2 系统侧仪式（周五落账/开奖）自部署后生效，4 班计时从首个完整走完议价台流程的班次起算
