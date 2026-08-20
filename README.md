# delivery_van · 快递发车台

**版本：v1.0「niulai」**（大版本以动漫代号命名，参照 Vue 的命名方式）

## 版本代号谱系

仿 Vue 传统：数字版本号管兼容性，动漫代号管情怀。每发一个大版本，在这里记一行。

| 版本 | 代号         | 日期       | 备注                                                     |
| ---- | ------------ | ---------- | -------------------------------------------------------- |
| v1.0 | niulai       | 2026-08-20 | 首个发行版：快递发车台跑通                               |
| v2.0 | （虚位以待） | —          | 备选：Initial D——AE86 每天凌晨送豆腐，是最早的"周度发车" |

按《docs/周度发车机制设计方案.md》实现的周度发车工具。隐喻：团队每周五发一班**厢式快递车**（京东/顺丰路上跑的那种），任务是快件，周五验收只看一件事——**这班的件送没送到**（最后一公里）。没送完的滞留件跟下一班车走，装多了就是超载。

技术栈：React + AG Grid Community + Hono/tRPC 薄后端 + SQLite（Drizzle，WAL 模式）。无账号无权限，小团队内部使用。

## 班次编码

仿期货合约风格：`DV` + 2 位年 + 2 位月 + 字母序号。例：`DV2607A` = 2026 年 7 月第一班车。
归属规则：每周五发一班，班次归该班**发车日（周五）**所在月份，字母 = 当月第几个周五（A–E）。规则与测试见 `contracts/vans.ts`、`contracts/vans.test.ts`。

## 开发

```bash
npm install
npm run dev   # http://localhost:3000，数据库为本地 SQLite 文件（默认 ./data/delivery_van.db，WAL 模式）
```

首次启动自动建表，无需手动迁移。可用环境变量 `DATABASE_URL` 指定数据库文件路径。

## 验证与构建

```bash
npm test        # vitest：班次编码、运力校验、委托状态推导、滞留件转运逻辑
npm run check   # tsc -b 类型检查
npm run lint    # eslint
npm run format  # prettier --write .
npm run build   # 前端 dist/public + 服务端 dist/boot.js
npm start       # 生产模式（跨平台，首次启动自动建表）
npm run db:seed # 写入示例成员
```

CI（GitHub Actions）覆盖以上门禁与 Docker 构建冒烟，见 `.github/workflows/ci.yml`。

## 部署（Docker）

```bash
docker build -t delivery_van .
docker run -p 3000:3000 -v delivery_van_data:/app/data delivery_van
```

数据库是容器内 `/app/data/delivery_van.db` 的 SQLite 文件，**务必挂载数据卷**（`-v ...:/app/data`），否则容器重建后数据全部丢失。库文件路径可用 `-e DATABASE_URL=...` 覆盖。

## 落地的设计规则

- 三档粒度 1/3/5 天，接口层强制（不接受 2/4 天）
- 每人每班档位合计 ≤ 运力（默认 5 天，请假可扣减），超载服务端直接拒单；调低运力不得低于已排峰值
- 成员是永久标签，不可删除
- 送达只看二值；打勾自动记送达日期，取消送达自动清空，日期可手工补录
- 滞留件一键转下一班车（仅紧邻班次，事务 + 幂等防重），📦 标记来源班次；连续滞留 ≥2 班黄色高亮提示强制复盘
- 任务大厅（委托）三态（待切片/已排期/已完成）由关联快件自动推导；Epic 委托不可直接上车
- 表头实时显示 未送达 X / 共 Y 件、送达率、滞留率（第八章三指标之二；估偏率靠备注 + 周五复盘定性）

## 目录

```
api/        Hono + tRPC 薄后端（router / queries / ensureSchema）
contracts/  前后端共享：班次编码工具
db/         Drizzle schema、种子脚本
scripts/    跨平台生产启动
src/        React 前端（pages/BoardPage 看板、lib/trpc、providers）
docs/       设计方案与发版计划
```
