# 博弈机制科研探索：让 PM 与开发之间的博弈显性化、可治理

> **状态：** 科研探索（调研 + 提案，未立项实施）｜ **日期：** 2026-08-27 ｜ **触发：** 领导提出"要增加更多博弈，尤其是产品经理和开发之间的博弈"
>
> **注：** 2026-08-27 同步半天点数制口径——任务体量以点计（1 点 = 半天，1~10 点，10 点 = 5 天），替代旧三档 1/3/5 天；文中档位/运力均已按新口径表述。
>
> **一句话结论：** 博弈不是要不要"增加"的问题——它已经天天在发生，只是当前机制让它**免费、无痕、不担责**。科研上正确的做法不是制造对抗，而是用机制设计（mechanism design）把五个隐性博弈**显性化、规则化、定价化**，让"说真话"比"喊得响"更划算，并让博弈向合作均衡收敛。反面案例（微软堆栈排名、富国银行）证明：把博弈设计成零和竞争会摧毁协作，那是领导想要的结果的反面。

---

## 一、问题界定：把领导的需求翻译成科研问题

"增加 PM 和开发之间的博弈"，在组织科学里有三种可能的解读：

| 解读                            | 含义                                    | 科研评价                                                                                    |
| ------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------- |
| A. 制造更多冲突/竞争            | 让两边互相斗，看谁赢                    | **反效果**。竞争框架滋生破坏行为（Lazear 1989；微软"失去的十年"）                           |
| B. 增加谈判轮次                 | 更多会议、更多拉扯                      | **浪费**。Sayre 定律：赌注越低斗争越激烈，纯耗散                                            |
| C. **把已有博弈显性化、规则化** | 隐性博弈 → 有规则、有代价、有记录的博弈 | **本文采纳**。机制设计的本意：让个体理性与集体理性一致（2007 诺奖：Hurwicz/Maskin/Myerson） |

关键洞察（信息经济学）：PM 与开发之间的核心矛盾是**信息不对称**——

- PM 私有信息：需求的价值、紧急度的真实排序（他有一百个"都很急"）；
- 开发私有信息：真实成本、风险、档位余量（他有动机报高）。

当前发车台对这两类私有信息**都没有任何定价机制**：稀有度随便标（[cheap talk](https://en.wikipedia.org/wiki/Cheap_talk)，Crawford–Sobel 1982）、提出人无追责、档位改了不留痕、运力超载只提示。结果是经典的"公地悲剧"式通胀：**当表达优先级是免费的，所有需求都会变成 UR**。

机制设计给出的解法方向只有一个：**让表达强度付出代价（costly signaling），让各方说真话成为占优策略（incentive compatibility）**。

## 二、现状诊断：一周节奏里隐藏的五个博弈

对照《周度发车机制设计方案》与 v1.0 实现（tasks 表：rarity / requester / size / acceptance / carryCount）：

| #   | 博弈点       | 现状规则                                    | 缺陷（理论诊断）                                                                                                                      |
| --- | ------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **上车博弈** | 发车会上 PM 逐条讲，谁声大谁上车            | 稀有度/紧急度是免费声明（cheap talk）→ 定级通胀 → 信号失效（Akerlof 柠檬市场的优先级版本）                                            |
| 2   | **估算博弈** | 负责人自报点数（1~10 点），他人可质疑       | 先报价者锚定（anchoring，Tversky–Kahneman）；质疑无结构 → 要么和气不说，要么当场对喷；档位改动不留痕                                  |
| 3   | **承诺博弈** | 周四锁版"原则上不改"；打勾 done 即记送达    | "原则上"无强制；**验收人（提出人）无需签收**——快递送到了但没人签字，完成与否由送货方说了算（单边验收）                                |
| 4   | **结转博弈** | 未完成结转下一班，carryCount≥2 强制复盘提示 | 结转对团队免费、对提出人无责；隐性激励是"多提快提、反正结转不疼"→ 需求侧无节制；连续结转=承诺升级的苗头无人叫停（Staw 1976 升级承诺） |
| 5   | **声誉博弈** | 无                                          | 提出人（PM 侧）没有任何历史记录聚合——谁提的件滞留率最高、UR 命中率如何，系统一无所知；声誉机制缺位 = 不合作行为不被记忆               |

另有一个**结构性资源博弈**：班次运力（每人 10 点 = 5 天）是公共池资源（commons，Ostrom），当前超载仅提示、加塞规则（等量换出）只存在于纸面，未工具化。

## 三、理论工具箱与实证证据（调研摘要）

### 3.1 机制设计 / 拍卖理论（怎么让两边说真话）

| 理论                                                                                                                                                                                                           | 一句话                                                              | 对发车台的映射                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **二次方投票 QV**（[Lalley & Weyl 2012](https://radicalxchange.org/wiki/colorado-qv/)）                                                                                                                        | n 票花费 n² 积分，表达偏好强度而非方向                              | 每人每班 100"发言权积分"，为想上车的快件投票；想独占一个 UR 件？代价平方级增长 |
| **最终报价仲裁**（final-offer arbitration，[Farber 1980](https://www.dir.ca.gov/chswc/basebalarbffinal.htm)；[MLB 实践](https://www.cozen.com/templates/media/files/baseball_arbitration_an_adr_success.pdf)） | 仲裁人只能在双方终局报价中**二选一**，不能折中 → 双方被迫向中间收敛 | 档位争议：PM 报期望档、承运人报价，随机第三方只能整取其一                      |
| **维克里拍卖 / VCG**（第二价格）                                                                                                                                                                               | 按临界价支付 → 真实报价是占优策略                                   | 超载时的上车截断：中标者按"第 N+1 名的出价"支付积分                            |
| **昂贵信号**（Spence 1977；Zahavi 障碍原理）                                                                                                                                                                   | 信号可信度来自成本                                                  | UR 定级要押注积分，结转则沉没                                                  |
| **Myerson–Satterthwaite 不可能性**（1983）                                                                                                                                                                     | 双边私有信息下，效率+预算平衡+激励相容不可兼得                      | 论证"积分必须是软货币（可增发、不兑现）"：放弃预算平衡换取真实披露             |

### 3.2 行为心理学（怎么让人自愿守约）

- **Ariely & Wertenbroch 2002**（[PubMed](https://pubmed.ncbi.nlm.nih.gov/12009041/)）：自设截止+自设罚则显著改善履约，但间距劣于外部均匀设置——**每周五班次节奏保留（外部节律），允许成员在班内自报承诺日期（自主承诺）**。
- **新起点效应**（Dai, Milkman & Riis 2014，[Management Science](https://pubsonline.informs.org/doi/10.1287/mnsc.2014.1901)）：时间地标激发目标重启——**每班积分清零重发、结转件换新卡片**，天然契合"一周一班车"。
- **损失厌恶与押金合约**（Kahneman–Tversky 前景理论；[stickK 类承诺设备的实证](https://freakonomics.com/2008/01/prediction-markets-at-google-a-guest-post/)同族逻辑）：押注沉没比奖励兑现更能约束行为。
- **实施意向**（Gollwitzer 1999）：把"下次注意"改成"如果 X 则做 Y"——结转复盘的结构化模板。
- **程序公正**（Tyler）：人们对规则的接受度更多取决于**过程是否透明、可申诉**，而非结果是否有利于自己——规则参数由复盘会共同调，不由管理员拍板。

### 3.3 治理与组织案例（正反两面）

**正面案例：**

1. **Google 内部预测市场**（2005 起；[Cowgill, Wolfers & Zitzewitz 2009](https://link.springer.com/chapter/10.1007/978-3-642-03821-1_2)；[Cowgill & Zitzewitz 2015, RES](https://www.jstor.org/stable/43869468)）：员工用游戏币对产品发布日期等下注，**市场预测跑赢官方排期**，且揭示了信息在组织内的流动路径。教训：市场稀薄、激励弱时要靠娱乐性维持参与。
2. **Rite-Solutions "Mutual Fun"**（[NYT 2006](https://www.nytimes.com/2006/03/26/business/yourmoney/heres-an-idea-let-everyone-have-ideas.html)；[斯坦福 GSB 案例](https://www.gsb.stanford.edu/faculty-research/case-studies/rite-solutions-mavericks-unleashing-quiet-genius-employees)）：员工给内部创意"股票"投游戏币，胜出创意获得真实资源与自愿组队的员工——**软货币 + 群众筛需求**的完整先例。
3. **科罗拉多州议会二次方投票**（[Wired 报道](https://www.wired.com/story/quadratic-voting/)；[RadicalxChange 记录](https://www.radicalxchange.org/wiki/colorado-qv/)）：100 语音积分分配法案优先级，逼出真实偏好强度。后因匿名性被诉讼叫停——**留痕透明是制度合法性的一部分**。
4. **MLB 最终报价仲裁**：双方报价被迫向预期裁决值收敛，绝大多数争议和解。
5. **晨星食品 CLOU**（[Corporate Rebels](https://www.corporate-rebels.com/blog/morning-star)）：无老板组织靠"同事谅解书"——人人与其他人**双边协商书面承诺**代替行政指令。签收制的组织学原型。
6. **韩都衣舍产品小组制**（[浙大案例](http://www.som.zju.edu.cn/2020/0904/c63540a2191891/page.htm)；[中欧案例](https://cn.ceibs.edu/emba/views/12845)）：小组获得资金额度（上月销售额 70%），内部市场+自负盈亏，300+ 小组裂变。
7. **关键链 CCPM**（Goldratt；[热度图实践](https://www.marris-consulting.com/en/videos/critical-chain-project-management/the-fever-chart-explained-in-4-minutes)）：针对学生综合征与帕金森定律，**砍掉单任务安全垫、集中为项目缓冲**，用红黄绿热度图监控——与"周五二值验收+全班次共用一周缓冲"的结构同构，说明当前机制骨架是对的，缺的是缓冲消耗的可视化与加塞定价。
8. **Ostrom 公共池治理八原则**（2009 诺奖；[团队应用](https://www.innovativehumancapital.com/article/applying-elinor-ostrom-s-principles-of-common-pool-resources-self-governance-to-improve-your-team)）：清晰边界、集体抉择规则、分级制裁、低成本冲突解决——**团队运力就是公共池**，本方案整体遵循该框架。

**反面案例（红线来源）：**

1. **微软堆栈排名**（[Vanity Fair "Microsoft's Lost Decade" 2012](https://en.wikipedia.org/wiki/Vitality_curve)；[HackerNoon 复盘](https://hackernoon.com/how-microsofts-ruthless-employee-ranking-system-annihilated-team-collaboration)）：强制分布的锦标赛 → 员工互相拆台而非做产品，2013 废除。**锦标赛+大奖差 = 破坏协作**（Lazear 1989 [JPE](https://www.jstor.org/stable/1830455) 的理论预测被完整验证）。
2. **富国银行假账户**（[斯坦福 GSB 案例](https://www.gsb.stanford.edu/faculty-research/publications/wells-fargo-cross-selling-scandal)）：交叉销售指标进考核 → ~350 万假账户。**Goodhart 定律的企业级演示**。
3. **故事点通胀**（[Scrum.org：Gaming Velocity](https://www.scrum.org/resources/blog/gaming-velocity-how-not-measure-success-and-what-avoid)；[Mountain Goat：估算通胀](https://www.mountaingoatsoftware.com/agile/how-to-prevent-estimate-inflation)）：速度一旦成为目标，点数全体膨胀。**发车台设计文档第八节早已写明"指标不挂钩绩效，一旦挂钩……机制作废"——本方案全程沿用此纪律**。
4. **海尔人单合一的内部市场化代价**（[《商学院》：小微自由扩张带来发展无序、竞争内耗](http://www.bmronline.com.cn/index.php?m=content&c=index&a=show&catid=23&id=12980)；[利弊分析](https://zhuanlan.zhihu.com/p/68589270)）：内部市场不是免费的——边界划得太碎，市场机制本身的管理成本吃掉收益。**小团队要做"最薄的一层市场化"**。
5. **Valve 扁平化的隐藏层级**（[Guardian 评论](https://www.theguardian.com/commentisfree/2018/jul/30/no-bosses-managers-flat-hierachy-workplace-tech-hollywood)）：去掉正式权力后非正式权力更不受问责——**无权限设计 + 透明记录**是配套，不能只取其一。

### 3.4 政治学 / 社会心理学的两条元原则

- **Deutsch 粗糙法则**（Morton Deutsch，合作与竞争理论；其 1960 卡车博弈实验）：合作催生合作，竞争催生竞争，且威胁手段使双方总收益下降。**机制的目标结构（goal structure）决定一切**——必须把 PM 与开发放在同一辆车（共同目标：班次准点率），而非两个阵营。
- **谢里夫罗伯斯山洞实验 / 超级目标**（Sherif 1961）：组间冲突靠共同上位目标化解，不靠劝解。"这班的件送没送到"就是现成的超级目标，统计条应把它放在最显眼处。

---

## 四、机制修改提案（分三层，可独立立项）

设计约束（继承自现有机制，**不改**）：半天点数制 1~10 点（粒度设限本身就是反估算博弈的设计）；二值送达；成员永久标签；无账号无鉴权；结转归档只读；**积分永不兑换现金、永不进绩效考评**。

### Tier 0 —— 不动表结构，先把"隐性博弈"照出来（1~2 个班次见效）

**T0.1 提出人记分卡（requester scorecard）**

- 改什么：统计区新增"按提出人聚合"面板：提出数、送达数、滞留率、UR/SSR 占比、平均在车班数。
- 落地：`requesterStatsOf()` 纯函数（与 `rarityStatsOf` 并列，配单测），前端 BoardPage 加一栏。`tasks.requester` 字段已存在，零 schema 变更。
- 理论：声誉机制（Nowak 间接互惠）——不合作行为被系统"记住"。
- 博弈效果：PM 第一次为自己的需求滞留率负责。**这是双向问责的第一块砖，也是政治上最温和的起点**——先只展示，不设任何门槛。

**T0.2 稀有度通胀报表**

- 改什么：稀有度 × 结果（done/carried）交叉表，重点暴露"UR 件滞留率是否高于 N 件"。
- 理由：cheap talk 的通胀率必须先被度量，才有资格谈治理。若 UR 滞留率 ≈ N，稀有度列已经是噪声，后续定价机制（T1.2）就有数据支撑。

**T0.3 结转复盘结构化模板**

- 改什么：carryCount≥2 的强制复盘，从"提示"升级为固定三问并写入 note：① 阻塞在哪；② 下一班的 if-then 计划（实施意向）；③ 当时谁为它背书。
- 理论：升级承诺的"停止规则"（Staw 1976）；Gollwitzer 实施意向。

### Tier 1 —— 引入"发言权积分"：给博弈定价（核心层，加一张流水表）

**T1.1 上车竞投：二次方计价的优先权表达**

- 改什么：每人每班发 100 积分（班次清零重发，新起点效应）；对候选快件投票，n 票花费 n² 积分；发车会按票数辅助排序取舍。
- 落地：新表 `points_ledger(vanCode, memberName, taskId, kind, amount, createdAt)`，kind ∈ allocate/vote/pledge/forfeit/penalty/reward；vanRouter 加 vote/pledge 端点（zod 校验防负数与超支）。
- 理论：QV 表达强度、压制多数暴政与富人效应（同额配给 + 平方定价）。
- 案例：科罗拉多议会、Rite-Solutions（货币不同，逻辑同源）。
- 风险与反制：参与率低（Google 教训）→ 与抽卡稀有度动效绑定做轻娱乐化；投票集中度过高 → 单件票数上限。

**T1.2 稀有度押注（定级定价）**

- 改什么：定 SSR 押 10 分、UR 押 25 分（参数进规则表）；该件结转则押注沉没并计入提出人记分卡，送达则全额返还。
- 理论：昂贵信号 + 损失厌恶押金合约。定级从"喊话"变成"下注"，UR 回到它该有的稀缺度。
- 反制副作用：PM 可能反向全定 N → N 不押注但排序靠后，加上记分卡的 UR 命中率展示，形成自然均衡。

**T1.3 档位争议：棒球仲裁**

- 改什么：保留"负责人自报点数"；当 PM 质疑且双方预期差 >2 点（1 天）时，进入仲裁流程——双方秘密报点（1~10），系统随机抽一名非当事在册成员，**只能在两个报价中整取其一**（不能折中）。仲裁结果即最终点数，双方名字留痕。
- 理论：final-offer arbitration 的收敛激励——报极端者更可能全输，双方被迫向合理区间靠拢。
- 落地：档位变更留痕（`size_history` 或 note 结构化），仲裁记录入 ledger。
- 保留：设计文档"估错不改档、备注估偏、周五校准"的规则不动——仲裁只发生在**发车会上车前**，不是事后改档。

**T1.4 提出人签收制（双边验收）**⭐ 隐喻最贴身、建议最先做

- 改什么：done 拆成两拍——承运人勾"送达"（记 doneAt，规则不变）→ 提出人"签收"确认；周五验收会前未签收的件按未送达处理（进结转流程）。无提出人的件（自驱任务）跳过签收。
- 落地：`tasks.confirmedBy` / `confirmedAt` 两列（try ALTER 幂等补列，参考 rarity 列写法）；完成率统计改按签收口径（结转判定仍按周五二值，不引入百分比——二值红线不动）。
- 理论：双边承诺（晨星 CLOU 的最小化版本）；把"完成"的定义权（剩余控制权，Grossman–Hart–Moore）分置：承运人声明送达，提出人认定合格，验收标准（acceptance 字段，已有）是事前契约。
- 博弈效果：PM 不再能当甩手掌柜（不签收=自己的件结转，滞留率上自己记分卡），开发也不能"做完=做完"（质量争议回到事前写好的验收标准上）。

### Tier 2 —— 结构性市场（Tier 1 稳定后再评估）

**T2.1 装载锁 + 加急通道（把纸面规则工具化）**

- 改什么：发车会后班次进入"在途"状态；周中加塞必须：① 等量换出（设计文档第七节已有此规则，目前靠自觉）② 提出人支付双倍积分罚金入公共池。归档班次照旧全锁（isVanArchived 不动）。
- 理论：Coase——变更可以谈判，但谈判要有对价与留痕；CCPM——缓冲是全班次共享资源，偷缓冲要付出可见代价。

**T2.2 班次预测市场（Futarchy-lite）**

- 改什么：班次发出后开放"本班送达率 ≥ X%"合约交易，周五按 done 数据自动结算。
- 理论：Hayek 知识问题 / Condorcet 聚合；比"进行中=没问题"的汇报诚实。
- 风险与反制（必须写进实现）：承运人做空自己（限额+延迟公示）；市场稀薄（参与率不足时自动降级为简单投票）；操纵动机（结算只认客观数据，人工不可覆写 done——现有规则恰好满足）。

**T2.3 苦差补贴与难度加权**

- 承接 carryCount≥2 滞留件获额外积分；个人记分按件均稀有度/滞留史加权，避免"抢 1~2 点小件刷分"（Lazear 教训：不做裸排行榜，只做加权后的贡献展示）。

**T2.4 规则版本化治理（Ostrom 集体选择层）**

- 积分总额、押注率、罚金倍数等参数存 `rulebook` 表（版本 + 生效班次 + 变更记录），**只有复盘会多数同意才能改**。机制参数本身成为共同治理的对象——这是防止"管理员悄悄改规则"式信任崩塌的制度保险（程序公正，Tyler）。

## 五、反博弈护栏（红线清单，先于一切实施）

1. **积分是发言权，不是钱**：永不兑换、永不进绩效、永不跨人转让。一旦兑现，Goodhart 定律接管一切（富国银行、故事点通胀、微软堆栈排名三部曲）。设计文档第八节已有此纪律，直接沿用并扩写。
2. **统计做传感器，不做目标**：所有面板服务复盘对齐；不做个人排行榜、不做强制分布。
3. **共同目标置顶**：统计条首行放"本班准点率"（全员共享指标），个人视图一律次之——超级目标结构压住阵营叙事（Sherif/Deutsch）。
4. **非线性定价**：表达强度的成本平方增长，通胀在机制内被自动征税。
5. **透明 + 留痕**：所有积分流向、仲裁、规则变更可查（无权限设计的安全前提是记录公开）。
6. **退出阀**：任何机制上线满 4 个班次必须复盘去留；预注册毒性信号——拆单避结转、集体压级、签收扯皮时长 > 会议 20%、参与率 < 50% → 触发即回退。

## 六、实验设计（既然是"科研探索"，就按科研来跑）

- **设计**：小团队无法 A/B，采用单组前后对照 + 阶梯引入。每个 Tier 跑 ≥4 个班次（一个月），复盘会决定保留/调参/回退。
- **基线（立即开始采集，Tier 0 即基线工具）**：结转率、稀有度通胀指数（UR+SSR 占比）、提出人滞留率分布（基尼/方差）、档位估偏率（文档已有）、周中加塞次数、参与率。
- **假设**（可证伪）：
  - H1：T0.1+T0.2 上线 4 班后 UR 占比下降（cheap talk 通胀被声誉约束）；
  - H2：T1.2 上线后 UR 件滞留率下降（押注筛选出真 UR）；
  - H3：T1.4 上线后结转争议中"验收标准模糊"类占比下降（事前契约效应）；
  - H4（安全假设，期望证伪失败才对）：签收不显著增加周五会议时长。
- **伦理边界**：所有数据仅团队内部可见；记分卡用于机制校准，永不用于个人评价（写进 rulebook v1 的第一条）。

## 七、落地映射（代码层面）

| 提案      | schema 变更                                           | 逻辑位置                                   | 测试                                |
| --------- | ----------------------------------------------------- | ------------------------------------------ | ----------------------------------- |
| T0.1/T0.2 | 无                                                    | `api/queries/van.ts` 新纯函数 + stats 端点 | vitest 纯函数单测                   |
| T1.1/T1.2 | 新表 `points_ledger`（schema.ts + ensureSchema 双写） | vanRouter 新 procedure（zod 全量校验）     | mock DB 单测（仿 van.mock.test.ts） |
| T1.3      | 档位历史（note 结构化或新表）                         | 仲裁流程纯函数                             | 纯函数单测                          |
| T1.4      | `tasks.confirmedBy/confirmedAt`（try ALTER 幂等补列） | carry/统计口径调整                         | 归档只读回归（e2e board.spec 扩展） |
| T2.1      | vans 加状态列（或按时间推导）                         | 加塞校验（保持 isVanArchived 兼容）        | e2e                                 |
| T2.4      | 新表 `rulebook`                                       | 参数读取层                                 | 幂等迁移测试                        |

**不动的东西（与现有核心规则同样重要）**：半天点数制、二值送达、结转只能转紧邻下一班、结转归档只读、成员不可删除、无鉴权。

## 八、结论与建议路线

1. **本周即可做**：Tier 0 三件套（纯统计聚合，不动 schema，一次前端迭代可完成）——先让博弈现形。
2. **下个迭代**：T1.4 签收制（最小 schema 变更、隐喻天然、双向问责落地）+ T1.1/T1.2 积分（一张 ledger 表）。
3. **观察一个月（4 个班次）**：复盘会按第六节指标裁决，之后决定是否进入 Tier 2。
4. **对领导汇报的口径**：我们没有"增加对抗"，我们把 PM 与开发之间原本在会议室里免费消耗的谈判，变成了**有价格、有记录、有共同目标**的制度化博弈——这是 2007 年诺贝尔经济学奖（机制设计）与 2009 年诺贝尔经济学奖（公共池治理）给出的标准答案，也是 Google、科罗拉多议会验证过的工程实践。

## 参考资料（调研来源）

- 机制设计/投票：[RadicalxChange：科罗拉多 QV](https://www.radicalxchange.org/wiki/colorado-qv/) ｜ [Wired：Colorado tried a new way to vote](https://www.wired.com/story/quadratic-voting/) ｜ [Lazear 1989, JPE](https://www.jstor.org/stable/1830455)
- 预测市场：[Cowgill, Wolfers & Zitzewitz 2009](https://link.springer.com/chapter/10.1007/978-3-642-03821-1_2) ｜ [Cowgill & Zitzewitz 2015, RES](https://www.jstor.org/stable/43869468) ｜ [Fung Institute PDF](https://funginstitute.berkeley.edu/wp-content/uploads/2014/04/CorporatePredictionMarkets.pdf)
- 内部创意市场：[NYT: Here's an Idea — Let Everyone Have Ideas](https://www.nytimes.com/2006/03/26/business/yourmoney/heres-an-idea-let-everyone-have-ideas.html) ｜ [Stanford GSB: Rite-Solutions 案例](https://www.gsb.stanford.edu/faculty-research/case-studies/rite-solutions-mavericks-unleashing-quiet-genius-employees)
- 行为科学：[Ariely & Wertenbroch 2002, Psych Science](https://pubmed.ncbi.nlm.nih.gov/12009041/) ｜ [Dai, Milkman & Riis 2014, Management Science](https://pubsonline.informs.org/doi/10.1287/mnsc.2014.1901) ｜ [PMC 因果证据](https://pmc.ncbi.nlm.nih.gov/articles/PMC4839284/)
- 反面案例：[Vitality curve（微软堆栈排名）](https://en.wikipedia.org/wiki/Vitality_curve) ｜ [HackerNoon 复盘](https://hackernoon.com/how-microsofts-ruthless-employee-ranking-system-annihilated-team-collaboration) ｜ [Stanford GSB: Wells Fargo](https://www.gsb.stanford.edu/faculty-research/publications/wells-fargo-cross-selling-scandal) ｜ [Scrum.org: Gaming Velocity](https://www.scrum.org/resources/blog/gaming-velocity-how-not-measure-success-and-what-avoid) ｜ [Mountain Goat: Estimate Inflation](https://www.mountaingoatsoftware.com/agile/how-to-prevent-estimate-inflation)
- 仲裁：[加州 DIR：Final Offer Arbitration 文献综述](https://www.dir.ca.gov/chswc/basebalarbffinal.htm) ｜ [Cozen：棒球仲裁为何促成和解](https://www.cozen.com/templates/media/files/baseball_arbitration_an_adr_success.pdf)
- 治理/自组织：[Ostrom 原则的团队应用](https://www.innovativehumancapital.com/article/applying-elinor-ostrom-s-principles-of-common-pool-resources-self-governance-to-improve-your-team) ｜ [Corporate Rebels: Morning Star](https://www.corporate-rebels.com/blog/morning-star) ｜ [SMI 自管理模型](https://www.morningstarco.com/interactive-smi-model/) ｜ [Guardian: 无老板组织的隐藏层级](https://www.theguardian.com/commentisfree/2018/jul/30/no-bosses-managers-flat-hierachy-workplace-tech-hollywood)
- 中国案例：[《商学院》：海尔从人单合一到链群合约（内部市场化的问题）](http://www.bmronline.com.cn/index.php?m=content&c=index&a=show&catid=23&id=12980) ｜ [浙大：韩都衣舍产品小组制案例](http://www.som.zju.edu.cn/2020/0904/c63540a2191891/page.htm) ｜ [中欧：韩都衣舍供应链](https://cn.ceibs.edu/emba/views/12845)
- 项目管理：[CCPM 热度图（Marris Consulting）](https://www.marris-consulting.com/en/videos/critical-chain-project-management/the-fever-chart-explained-in-4-minutes) ｜ [Aurora：学生综合征与帕金森定律](https://www.aurorascheduling.com/blogs/critical-chain-project-management-motivation-and-overview/)
