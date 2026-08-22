# delivery_van · 快递发车台

> 每周五，这班的件送到了吗？

## 这是什么

一个给小团队用的周度发车管理工具。

隐喻很简单：团队每周五发一班**厢式快递车**（京东/顺丰路上跑的那种），任务是快件，周五验收只看一件事——**这班的件送没送到**（最后一公里）。没送完的滞留件跟下一班车走，装多了就是超载。

这个隐喻不是装饰，是机制本身：

- 快件只有两种状态：**送到**或**没送到**。没有"完成 80%"
- 没送完的件自动跟下一班车走（滞留结转），系统记录来源班次；结转后整班归档只读
- 连续两班都没送到？亮黄灯——是该拆得更小了，还是真有阻塞该升级了
- 每个快件直接标**稀有度**（五级 N/R/SR/SSR/UR，凭直觉定级）和**提出人**；稀有度只是颜色标记，不做拦截

设计细节见 [`docs/周度发车机制设计方案.md`](docs/周度发车机制设计方案.md)。

## 班次编码

仿期货合约风格：`DV` + 2 位年 + 2 位月 + 字母序号。例：`DV2607A` = 2026 年 7 月第一班车。

班次由「发新车」**手动创建**，不绑定周五；字母 = 当月第几班车（A–Z），Z 之后跨月回 A。规则与测试见 `contracts/vans.ts`、`contracts/vans.test.ts`。

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
npm test           # vitest：班次编码、多选纯函数、稀有度/统计纯函数、mock DB 业务逻辑
npm run test:e2e   # Playwright E2E（先构建生产产物再起服务，独立测试库）
npm run check      # tsc -b 类型检查
npm run lint       # eslint
npm run format     # prettier --write .
npm run build      # 前端 dist/public + 服务端 dist/boot.js
npm start          # 生产模式（跨平台，首次启动自动建表）
```

CI（GitHub Actions）覆盖以上门禁、Playwright E2E 与 Docker 构建冒烟，见 `.github/workflows/ci.yml`。

## 部署（Docker）

```bash
docker build -t delivery_van .
docker run -p 3000:3000 -v delivery_van_data:/app/data delivery_van
```

⚠️ 务必挂载数据卷（`-v ...:/app/data`），否则容器重建后数据全部丢失。库文件路径可用 `-e DATABASE_URL=...` 覆盖。

## 业务规则速查

- **三档粒度** 1/3/5 天，接口层强制（不接受 2/4 天）——粗粒度是故意的，估得越细争论越多
- **送达二值化** 没有"完成 80%"，打勾自动记日期，取消自动清空，日期可手工补录
- **多人负责** 一个任务可由多人共同负责（勾选式多选），运力仅做记录不做校验；成员是永久标签，不可删除
- **滞留结转** 未完成一键转下一班（仅紧邻班次，目标班不存在时自动创建），事务 + 幂等防重；`carryCount >= 2` 触发强制复盘**提示**（仅提示不拦截）；**结转后整班归档只读**，不可增/改/删
- **稀有度/提出人** 五级稀有度（N/R/SR/SSR/UR，抽卡风格英文缩写）直接标在快件上，整体文字着色（绿/蓝/紫，UR 彩虹动画）；提出人记录谁提的需求——都只是标记，系统不做拦截
- **表头统计** 实时显示未送达 X / 共 Y 件、送达率、滞留率、强制复盘数、稀有度构成

## 目录

```
api/        Hono + tRPC 薄后端（router / vanRouter / queries / ensureSchema）
contracts/  前后端共享：班次编码工具与纯函数测试
db/         Drizzle schema、种子脚本
e2e/        Playwright E2E（核心动线 + 历史 bug 回归）
scripts/    跨平台生产启动
src/        React 前端（pages/BoardPage 看板、components/*CellEditor 单元格编辑器）
docs/       设计方案与发版计划（按 doing/archived 分类）
```
