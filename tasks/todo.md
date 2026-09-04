# 修复 todo（v2：含 doing/ 全文档差距）

## 阶段 1：必做代码修复

- [ ] 任务 1：e2e 加「显隐开关切班保持」回归（先红）→ BoardPage 删两处 `hide: true`（转绿）→ e2e 全绿 + dev 人工过
- [ ] 任务 2：dialect.ts 加 `writeLockSql()` → tx.ts pg/mysql 取锁 → dialect.test 补用例 → 注释补写串行化口径

## 检查点：代码修复

- [ ] 本地四件套 + e2e 全绿；CI 三 job 绿

## 阶段 2：可选代码加固

- [ ] 任务 3：doneAt 日期正则 + requester `.min(1)` + router 拒绝用例
- [ ] 任务 4：mysql group_concat_max_len 会话调大 + boot/schema 过时注释

## 阶段 3：文档收口

- [ ] 任务 5：灵魂文档 git mv 至 docs/ 根 + 决议 7 豁免注记 + 附 2 残留修订（措辞收敛/法务注记/数据最小化/M9 小节）+ 状态行更新 + carriedReason 命名注记 + 引用路径全量更新
- [ ] 任务 6：v2.2 计划小结与「明确不做」更新；v2.0 计划状态头（分支/发版/Gate 0）+ WP2 DDL 注记；v2.1 手册补部署前置与备注列开关提醒；删远程 feat/v2.0-phase1

## 检查点：文档收口

- [ ] 全文检索无残留（分支名/旧路径/「标准答案」/carriedReason）；prettier 绿

## 阶段 4：发版与部署

- [ ] 任务 7：拍板版本策略（默认推荐 v2.2.0 直发）→ README 谱系 + AGENTS + package.json → CI 绿 → tag 推送 → GHCR → 部署冒烟
- [ ] 任务 8：Gate 0 基线采集启动 + 首个周五锚定仪式（v2.0 DoD 5）+ Phase 2 系统侧仪式生效 → v2.2/v2.0 计划文档归档 + AGENTS 清单同步

## 检查点：全部完成

- [ ] 验收标准全达成、CI 绿、部署实例运行、文档与实际零矛盾
