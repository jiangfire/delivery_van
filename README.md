# delivery_van · 快递发车台

> 每周五，这班的件送到了吗？

## 这是什么

一个给小团队用的周度发车管理工具。

隐喻很简单：团队每周五发一班**厢式快递车**（京东/顺丰路上跑的那种），任务是快件，周五验收只看一件事——**这班的件送没送到**（最后一公里）。没送完的滞留件跟下一班车走，装多了就是超载。

这个隐喻不是装饰，是机制本身：

- 快件只有两种状态：**送到**或**没送到**。没有"完成 80%"
- 没送完的件自动跟下一班车走（滞留结转），系统记录来源班次与**结转原因**（五枚举：需求变更/依赖阻塞/估算偏差/产能不足/优先级被挤）；结转后整班归档只读
- 连续两班都没送到？亮黄灯——是该拆得更小了，还是真有阻塞该升级了
- 每个快件直接标**稀有度**（五级 N/R/SR/SSR/UR，凭直觉定级）和**提出人**；稀有度只是颜色标记，不做拦截

v2.0 起（Phase 1）叠加一层**轻博弈机制**，全部是 v1 行为的叠加层（隐藏 UI = 回到 v1）：

- **签收二拍**：送达（承运人打勾）→ 签收（提出人一次点击）；无提出人的自驱件视同签收
- **链式审计日志**：一切写操作进 SHA256 hash 链，页头「我是谁」记操作人，周五把日志指纹抄进会议纪要锚定
- **统计三件套**：提出人记分卡、稀有度通胀报表、三方占比（客户/平台/探索）——全部自动推导，默认折叠不占主界面
- **昨日天气**：建议装载上限 = 上一班实际送达点数，只提示不拦截
- **徽章 v1**：🚚 整班准点、📦 送达连击，实时推导不落库

设计细节见 [`docs/周度发车机制设计方案.md`](docs/周度发车机制设计方案.md) 与 [`docs/doing/v2.0-博弈机制落地计划.md`](docs/doing/v2.0-博弈机制落地计划.md)。

## 班次编码

仿期货合约风格：`DV` + 2 位年 + 2 位月 + 字母序号。例：`DV2607A` = 2026 年 7 月第一班车。

班次由「发新车」**手动创建**，不绑定周五；编码锚定创建时所在的日历月份，**每个自然月从 A 重新计数**（跨月发新车不沿用旧月份字母），同月内 A–Z 递增（单月最多 26 班），当月到 Z 之后再发车跨月回 A。规则与测试见 `contracts/vans.ts`、`contracts/vans.test.ts`。

## 技术栈

| 层     | 技术                                                                            |
| ------ | ------------------------------------------------------------------------------- |
| 前端   | React 19 + react-router 7 + Vite 7，Tailwind CSS v3 + shadcn，AG Grid Community |
| 后端   | Hono + tRPC v11（superjson），zod v4 入参校验                                   |
| 数据库 | SQLite（better-sqlite3 + Drizzle ORM，WAL 模式）                                |
| 测试   | Vitest（单测）+ Playwright（E2E）                                               |

无账号无权限，小团队内部工具，靠公开透明自治。

## 快速开始

```bash
npm install
npm run dev        # http://localhost:3000，首次启动自动建表
```

数据库默认 `./data/delivery_van.db`，可用 `DATABASE_URL` 环境变量覆盖。

```bash
npm run db:seed    # 写入示例成员（可选）
```

## 验证与构建

```bash
npm test           # vitest：班次编码、多选纯函数、稀有度/统计纯函数、mock DB 与内存 SQLite 业务逻辑
npm run test:e2e   # Playwright E2E（先构建生产产物再起服务，独立测试库）
npm run check      # tsc -b 类型检查
npm run lint       # eslint
npm run format     # prettier --write .
npm run build      # 前端 dist/public + 服务端 dist/boot.js
npm start          # 生产模式（跨平台，首次启动自动建表）
```

CI（GitHub Actions）覆盖以上门禁、Playwright E2E 与 Docker 构建冒烟，见 `.github/workflows/ci.yml`。

## 部署

**方式一 · Docker**（镜像在 GitHub Container Registry，也可自行 `docker build`）：

```bash
docker pull ghcr.io/jiangfire/delivery_van:v1.2.0
docker run -p 3000:3000 -v delivery_van_data:/app/data ghcr.io/jiangfire/delivery_van:v1.2.0
```

⚠️ 务必挂载数据卷（`-v ...:/app/data`），否则容器重建后数据全部丢失。库文件路径可用 `-e DATABASE_URL=...` 覆盖。容器自动建表与「重建容器数据不丢」由 CI 的 docker job 持续验证。

**方式二 · zip 包**（无 Docker，需 Node >= 22）：从 [GitHub Release](https://github.com/jiangfire/delivery_van/releases) 下载 `delivery_van-vX.Y.Z.zip`（内含已构建的 `dist/`），解压后：

```bash
npm ci
npm start        # 生产模式，端口可用 PORT 覆盖
```

发版流程：CI 全绿后打 `v*` tag 推送，`.github/workflows/release.yml` 自动构建镜像推 GHCR 并创建带 zip 附件的 Release。

## 业务规则速查

- **半天点数制** 任务体量以点计，1 点 = 半天，只允许 1~10 整数（10 点 = 5 天），接口层 zod 强制；成员运力同口径（默认 10 点/周、上限 14 点）——粒度设限是故意的，估得越细争论越多
- **送达二值化** 没有"完成 80%"，打勾自动记日期，取消自动清空，日期可手工补录
- **多人负责** 一个任务可由多人共同负责（勾选式多选），运力仅做记录不做校验；成员是永久标签，不可删除
- **滞留结转** 未完成一键转下一班（仅紧邻班次，目标班不存在时自动创建），事务 + 幂等防重；`carryCount >= 2` 触发强制复盘**提示**（仅提示不拦截）；**结转后整班归档只读**，不可增/改/删
- **稀有度/提出人** 五级稀有度（N/R/SR/SSR/UR，抽卡风格英文缩写）直接标在快件上，整体文字着色（绿/蓝/紫，UR 彩虹动画）；提出人记录谁提的需求——都只是标记，系统不做拦截
- **签收制（v2）** done 拆两拍：送达 → 提出人签收（一次点击）；统计条提示未签收 N 件；归档班次不可签
- **结转原因（v2）** 结转确认时可选五枚举原因（默认未分类），统计面板出滞留原因瀑布
- **审计日志（v2）** 写操作全进 hash 链（自由文本以占位符进链）；日志指纹（链头前 8 位）周五锚定进会议纪要；「我是谁」单选记操作人
- **三方来源（v2）** 每件标客户/平台/探索（默认客户），统计条三方占比迷你条；v2.0 前历史件统一记客户件
- **昨日天气（v2）** 建议装载上限 = 上一班 done 点数合计，只提示不拦截
- **表头统计** 实时显示未送达 X / 共 Y 件、送达率、滞留率、强制复盘数、稀有度构成、未签收、建议装载上限、徽章角标、日志指纹

## 目录

```
api/        Hono + tRPC 薄后端（router / vanRouter / queries / ensureSchema；queries/audit.ts 链式审计日志）
contracts/  前后端共享：班次编码工具、v2 枚举与纯函数测试
db/         Drizzle schema、种子脚本
e2e/        Playwright E2E（核心动线 + 历史 bug 回归 + v2 动线）
scripts/    跨平台生产启动
src/        React 前端（pages/BoardPage 看板、components/*CellEditor 单元格编辑器、lib/actor 我是谁）
docs/       设计方案与发版计划（按 doing/archived 分类；会议纪要模板常驻）
```
