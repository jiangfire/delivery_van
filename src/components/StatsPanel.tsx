import { CARRY_REASON_LABELS, type CarryReason } from "@contracts/enums";
import { RARITY_CLASS, fmtRate } from "@/lib/display";
import type { VanStats } from "@/lib/trpc";

/* ── 统计面板（v2.0 隐形预算：默认折叠，不占主界面）：
 * 提出人记分卡 / 稀有度通胀报表 / 滞留原因瀑布 ── */

export function StatsPanel({ stats }: { stats: VanStats | undefined }) {
  return (
    <details className="glass-card mt-6 p-5">
      <summary className="cursor-pointer text-sm font-bold select-none">
        统计面板（v2）
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          提出人记分卡 · 稀有度通胀 · 滞留原因瀑布
        </span>
      </summary>
      <div className="mt-4 grid gap-8 lg:grid-cols-2">
        {/* 提出人记分卡（WP1） */}
        <section>
          <h3 className="mb-2 text-xs font-bold text-muted-foreground">
            提出人记分卡（送达 = 签收口径）
          </h3>
          {stats && stats.requester.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-muted-foreground">
                  <th className="py-1 pr-4 font-semibold">提出人</th>
                  <th className="py-1 pr-4 font-semibold">提出</th>
                  <th className="py-1 pr-4 font-semibold">送达</th>
                  <th className="py-1 pr-4 font-semibold">滞留</th>
                  <th className="py-1 pr-4 font-semibold">UR+SSR</th>
                  <th className="py-1 font-semibold">在车班数</th>
                </tr>
              </thead>
              <tbody>
                {stats.requester.map((r) => (
                  <tr key={r.requester} className="border-t border-black/5">
                    <td className="py-1.5 pr-4 font-medium">{r.requester}</td>
                    <td className="py-1.5 pr-4">{r.total}</td>
                    <td className="py-1.5 pr-4">{r.delivered}</td>
                    <td className="py-1.5 pr-4">{r.stranded}</td>
                    <td className="py-1.5 pr-4">
                      {Math.round(r.urSsrRate * 100)}%
                    </td>
                    <td className="py-1.5">{r.avgVans}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-muted-foreground">本班暂无快件</p>
          )}
        </section>
        {/* 稀有度通胀报表（WP1） */}
        <section>
          <h3 className="mb-2 text-xs font-bold text-muted-foreground">
            稀有度通胀（done × 滞留交叉）
          </h3>
          {stats && stats.inflation.byRarity.length > 0 ? (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-muted-foreground">
                    <th className="py-1 pr-4 font-semibold">稀有度</th>
                    <th className="py-1 pr-4 font-semibold">总数</th>
                    <th className="py-1 pr-4 font-semibold">送达</th>
                    <th className="py-1 font-semibold">滞留</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.inflation.byRarity.map((r) => (
                    <tr key={r.rarity} className="border-t border-black/5">
                      <td
                        className={`py-1.5 pr-4 font-medium ${RARITY_CLASS[r.rarity]}`}
                      >
                        {r.rarity.toUpperCase()}
                      </td>
                      <td className="py-1.5 pr-4">{r.total}</td>
                      <td className="py-1.5 pr-4">{r.done}</td>
                      <td className="py-1.5">{r.stranded}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-muted-foreground">
                UR 滞留率 {fmtRate(stats.inflation.urStrandRate)} vs N 滞留率{" "}
                {fmtRate(stats.inflation.nStrandRate)}
                （UR 显著更高 = 集体压级/定级通胀信号）
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">本班暂无快件</p>
          )}
        </section>
        {/* 滞留原因瀑布（WP5） */}
        <section className="lg:col-span-2">
          <h3 className="mb-2 text-xs font-bold text-muted-foreground">
            滞留原因瀑布（本班结转出去的件，无人名排序）
          </h3>
          {stats && stats.carryReasons.length > 0 ? (
            <ul className="max-w-xl space-y-1.5">
              {stats.carryReasons.map((r) => {
                const max = Math.max(...stats.carryReasons.map((x) => x.count));
                return (
                  <li
                    key={r.reason ?? "unclassified"}
                    className="flex items-center gap-3 text-sm"
                  >
                    <span className="w-20 shrink-0 text-xs">
                      {r.reason
                        ? CARRY_REASON_LABELS[r.reason as CarryReason]
                        : "未分类"}
                    </span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-black/5">
                      <span
                        className="block h-full rounded-full bg-amber-500/60"
                        style={{ width: `${(r.count / max) * 100}%` }}
                      />
                    </span>
                    <span className="w-6 text-right text-xs text-muted-foreground">
                      {r.count}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              本班暂无结转出去的滞留件
            </p>
          )}
          <p className="mt-4 text-xs text-muted-foreground">
            口径说明：三方占比与来源自 v2.0 起采集，历史快件统一记为客户件；
            记分卡「送达」为签收口径，滞留率/完成率仍为 v1 口径（基线连续）。
          </p>
        </section>
      </div>
    </details>
  );
}
