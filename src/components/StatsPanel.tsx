import { useState } from "react";
import {
  CARRY_REASON_LABELS,
  SOURCE_LABELS,
  type CarryReason,
} from "@contracts/enums";
import { RARITY_CLASS, SOURCE_COLOR, fmtRate } from "@/lib/display";
import type { VanStats } from "@/lib/trpc";

/* ── 统一统计面板：同一批快件按维度切片（measure × slice）——
 * 负责人（默认，日常看运力）/ 提出人记分卡 / 稀有度通胀 / 滞留原因瀑布 / 三方来源明细。
 * 行式统一骨架：维度值 + 主条形 + 数字组；复盘维度收进页签，默认不主动展示
 * （v2.0 隐形预算：统计不占主界面、不制造日常 KPI 压力）。各视图标题常驻、
 * 空态放标题下（空班也知道这一页在看什么）。设计见 docs/doing/统计面板统一设计方案.md ── */

type Dimension = "owner" | "requester" | "rarity" | "carryReason" | "source";

const TABS: { key: Dimension; label: string }[] = [
  { key: "owner", label: "负责人" },
  { key: "requester", label: "提出人" },
  { key: "rarity", label: "稀有度" },
  { key: "carryReason", label: "结转原因" },
  { key: "source", label: "来源" },
];

export function StatsPanel({
  stats,
  onRemoveMember,
}: {
  stats: VanStats | undefined;
  /** 负责人视图行内「删除成员」入口（确认弹窗与守卫提示逻辑留在 BoardPage） */
  onRemoveMember: (name: string) => void;
}) {
  const [dim, setDim] = useState<Dimension>("owner");

  return (
    <section className="glass-card p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-bold">统计</h2>
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`btn px-3 py-1 text-xs ${dim === t.key ? "btn-glass border-sky-200/80 text-sky-600" : "btn-ghost text-muted-foreground"}`}
              aria-pressed={dim === t.key}
              onClick={() => setDim(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {dim === "owner" && (
        <OwnerView stats={stats} onRemoveMember={onRemoveMember} />
      )}
      {dim === "requester" && <RequesterView stats={stats} />}
      {dim === "rarity" && <RarityView stats={stats} />}
      {dim === "carryReason" && <CarryReasonView stats={stats} />}
      {dim === "source" && <SourceView stats={stats} />}
      <p className="mt-4 text-xs text-muted-foreground">
        口径说明：三方占比与来源自 v2.0 起采集，历史快件统一记为客户件；
        记分卡「送达」为签收口径，滞留率/完成率仍为 v1 口径（基线连续）。
      </p>
    </section>
  );
}

/** 行式主条形：轨道 + 填充（ratio 截断到 0~1），各维度视图共用 */
function Bar({
  ratio,
  color,
  title,
}: {
  ratio: number;
  color: string;
  title?: string;
}) {
  const pct = Math.max(0, Math.min(ratio, 1)) * 100;
  return (
    <span className="block h-2 flex-1 overflow-hidden rounded-full bg-black/5">
      <span
        className="block h-full rounded-full"
        style={{ width: `${pct}%`, background: color }}
        title={title}
      />
    </span>
  );
}

/** 负责人（原成员运力）：运力条 assigned/capacity，超载整条变红 */
function OwnerView({
  stats,
  onRemoveMember,
}: {
  stats: VanStats | undefined;
  onRemoveMember: (name: string) => void;
}) {
  const members = stats?.members ?? [];
  const streaks = stats?.badges.streaks ?? [];
  return (
    <div>
      <h3 className="mb-2 text-xs font-bold text-muted-foreground">
        成员运力（按标签自动统计）
      </h3>
      {members.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          还没有成员，快件表「负责人」编辑器里可即时新增
        </p>
      ) : (
        <ul className="space-y-2.5">
          {members.map((m) => {
            const overloaded = m.assigned > m.capacity;
            const ratio =
              m.capacity > 0 ? m.assigned / m.capacity : m.assigned > 0 ? 1 : 0;
            return (
              <li key={m.name} className="flex items-center gap-3 text-sm">
                <span className="flex w-24 shrink-0 items-center gap-1 font-semibold">
                  <span className="truncate" title={m.name}>
                    {m.name}
                  </span>
                  {streaks.includes(m.name) && (
                    <span title="送达连击：连续 2 个班次负责快件零滞留">
                      📦
                    </span>
                  )}
                </span>
                <Bar
                  ratio={ratio}
                  color={overloaded ? "#ef4444" : "rgba(14, 165, 233, 0.75)"}
                />
                <span
                  className={`shrink-0 text-xs tabular-nums ${overloaded ? "font-bold text-red-500" : "text-muted-foreground"}`}
                >
                  {m.assigned}/{m.capacity} 点{overloaded && "（超载）"}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {m.taskCount} 件 · 送达 {m.done} · 滞留 {m.carriedIn}
                </span>
                <button
                  className="btn btn-danger shrink-0 px-2 py-0.5 text-xs"
                  title="删除成员（有快件记录的成员不可删除）"
                  onClick={() => onRemoveMember(m.name)}
                >
                  删除
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** 提出人记分卡（送达 = 签收口径） */
function RequesterView({ stats }: { stats: VanStats | undefined }) {
  const rows = stats?.requester ?? [];
  return (
    <div>
      <h3 className="mb-2 text-xs font-bold text-muted-foreground">
        提出人记分卡（送达 = 签收口径）
      </h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">本班暂无快件</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.requester} className="flex items-center gap-3 text-sm">
              <span
                className="w-24 shrink-0 truncate font-semibold"
                title={r.requester}
              >
                {r.requester}
              </span>
              <Bar
                ratio={r.total > 0 ? r.delivered / r.total : 0}
                color="rgba(16, 185, 129, 0.75)"
              />
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                提出 {r.total} · 送达 {r.delivered} · 滞留 {r.stranded} · UR+SSR{" "}
                {Math.round(r.urSsrRate * 100)}% · 在车 {r.avgVans} 班
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 稀有度构成 + 通胀（主条 = 滞留/总数：滞留越多条越高，直接暴露通胀；
 * 「占 N%」= 构成占比——v1 统计条的稀有度构成自 v2.0 起在此安家） */
function RarityView({ stats }: { stats: VanStats | undefined }) {
  const rows = stats?.inflation.byRarity ?? [];
  const allTotal = rows.reduce((s, r) => s + r.total, 0);
  return (
    <div>
      <h3 className="mb-2 text-xs font-bold text-muted-foreground">
        稀有度通胀（done × 滞留交叉）
      </h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">本班暂无快件</p>
      ) : (
        <>
          <ul className="space-y-2.5">
            {rows.map((r) => (
              <li key={r.rarity} className="flex items-center gap-3 text-sm">
                <span
                  className={`w-24 shrink-0 font-bold ${RARITY_CLASS[r.rarity]}`}
                >
                  {r.rarity.toUpperCase()}
                </span>
                <Bar
                  ratio={r.total > 0 ? r.stranded / r.total : 0}
                  color="rgba(245, 158, 11, 0.6)"
                />
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  共 {r.total} · 送达 {r.done} · 滞留 {r.stranded} · 占{" "}
                  {allTotal > 0 ? Math.round((r.total / allTotal) * 100) : 0}%
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            UR 滞留率 {fmtRate(stats!.inflation.urStrandRate)} vs N 滞留率{" "}
            {fmtRate(stats!.inflation.nStrandRate)}
            （UR 显著更高 = 集体压级/定级通胀信号）
          </p>
        </>
      )}
    </div>
  );
}

/** 滞留原因瀑布（本班结转出去的件） */
function CarryReasonView({ stats }: { stats: VanStats | undefined }) {
  const rows = stats?.carryReasons ?? [];
  const max = rows.length > 0 ? Math.max(...rows.map((x) => x.count)) : 0;
  return (
    <div>
      <h3 className="mb-2 text-xs font-bold text-muted-foreground">
        滞留原因瀑布（本班结转出去的件，无人名排序）
      </h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          本班暂无结转出去的滞留件
        </p>
      ) : (
        <ul className="max-w-xl space-y-1.5">
          {rows.map((r) => (
            <li
              key={r.reason ?? "unclassified"}
              className="flex items-center gap-3 text-sm"
            >
              <span className="w-24 shrink-0 text-xs">
                {r.reason
                  ? CARRY_REASON_LABELS[r.reason as CarryReason]
                  : "未分类"}
              </span>
              <Bar
                ratio={max > 0 ? r.count / max : 0}
                color="rgba(245, 158, 11, 0.6)"
              />
              <span className="w-6 shrink-0 text-right text-xs text-muted-foreground">
                {r.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 三方来源明细（StatsBar 速览迷你条的同口径展开） */
function SourceView({ stats }: { stats: VanStats | undefined }) {
  const rows = stats?.source ?? [];
  const total = rows.reduce((s, x) => s + x.total, 0);
  return (
    <div>
      <h3 className="mb-2 text-xs font-bold text-muted-foreground">
        三方占比（统计条迷你条的同口径明细）
      </h3>
      {total === 0 ? (
        <p className="text-xs text-muted-foreground">本班暂无快件</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((s) => (
            <li key={s.source} className="flex items-center gap-3 text-sm">
              <span className="flex w-24 shrink-0 items-center gap-1.5 font-semibold">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: SOURCE_COLOR[s.source] }}
                />
                {SOURCE_LABELS[s.source]}
              </span>
              <Bar ratio={s.total / total} color={SOURCE_COLOR[s.source]} />
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {s.total} 件 · {Math.round((s.total / total) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
