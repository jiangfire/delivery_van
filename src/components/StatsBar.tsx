import { SOURCE_LABELS } from "@contracts/enums";
import { SOURCE_COLOR } from "@/lib/display";
import type { VanStats } from "@/lib/trpc";

/* ── 统计条（看板表头下的核心指标一览）：
 * 基础四项 + 未签收/昨日天气（v2）+ 三方占比迷你条 + 徽章角标 + 日志指纹 + 快捷操作 ── */

export function StatsBar({
  stats,
  curVan,
  vanArchived,
  vanReadonly,
  addPending,
  onAddTask,
  onOpenCarry,
  onCopyFingerprint,
}: {
  stats: VanStats | undefined;
  curVan: string | null;
  vanArchived: boolean;
  vanReadonly: boolean;
  addPending: boolean;
  onAddTask: () => void;
  onOpenCarry: () => void;
  onCopyFingerprint: (fp: string) => void;
}) {
  const badges = stats?.badges;
  const sourceTotal = stats?.source.reduce((s, x) => s + x.total, 0) ?? 0;

  return (
    <div className="glass-card mb-6 flex flex-wrap items-center gap-8 px-6 py-5">
      <Stat
        label="未送达 / 共"
        value={stats ? `${stats.remaining} / ${stats.total} 件` : "–"}
      />
      <Stat
        label="送达率"
        value={
          stats?.completionRate == null
            ? "–"
            : `${Math.round(stats.completionRate * 100)}%`
        }
      />
      <Stat
        label="滞留率"
        value={
          stats?.carryRate == null
            ? "–"
            : `${Math.round(stats.carryRate * 100)}%`
        }
      />
      <Stat
        label="强制复盘"
        value={stats ? `${stats.reviewNeeded} 个` : "–"}
        tone={stats && stats.reviewNeeded > 0 ? "warn" : undefined}
      />
      {/* 未签收提示（WP3）：周五验收会前看这里，是否结转仍由人决定 */}
      {stats && stats.unconfirmed > 0 && (
        <Stat label="未签收" value={`${stats.unconfirmed} 件`} tone="warn" />
      )}
      {/* 昨日天气（WP4）：建议装载上限 = 上一班实际送达点数，只提示不拦截 */}
      {stats?.suggestedLoad != null && (
        <Stat label="建议装载上限" value={`${stats.suggestedLoad} 点`} />
      )}
      {/* 三方占比迷你条（WP1）：一眼看快件结构 */}
      <div>
        <div className="label-caps">三方占比</div>
        {sourceTotal > 0 ? (
          <div className="mt-1.5">
            <div className="flex h-2 w-44 overflow-hidden rounded-full border border-white/60">
              {stats!.source
                .filter((s) => s.total > 0)
                .map((s) => (
                  <span
                    key={s.source}
                    title={`${SOURCE_LABELS[s.source]} ${s.total} 件`}
                    style={{
                      width: `${(s.total / sourceTotal) * 100}%`,
                      background: SOURCE_COLOR[s.source],
                    }}
                  />
                ))}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {stats!.source
                .map(
                  (s) =>
                    `${SOURCE_LABELS[s.source]} ${Math.round((s.total / sourceTotal) * 100)}%`,
                )
                .join(" · ")}
            </div>
          </div>
        ) : (
          <div className="text-base font-bold">–</div>
        )}
      </div>
      {/* 徽章角标（WP6）：实时推导不落库 */}
      {badges && (badges.teamPunctual || badges.streaks.length > 0) && (
        <div className="flex items-center gap-1">
          {badges.teamPunctual && (
            <span
              className="badge-chip badge-green"
              title="整班准点：本班快件全部送达"
            >
              🚚 整班准点
            </span>
          )}
          {badges.streaks.length > 0 && (
            <span
              className="badge-chip"
              title={`${badges.streaks.join("、")}：连续 2 个班次负责快件零滞留`}
            >
              📦 送达连击 ×{badges.streaks.length}
            </span>
          )}
        </div>
      )}
      {/* 日志指纹（WP2）：链头 hash 前 8 位，周五锚定仪式抄进会议纪要 */}
      {stats?.auditFingerprint && (
        <button
          className="btn btn-ghost font-mono text-xs"
          title="链式审计日志指纹（点击复制，周五复盘会抄进纪要锚定）"
          onClick={() => onCopyFingerprint(stats.auditFingerprint!)}
        >
          日志指纹 {stats.auditFingerprint}
        </button>
      )}
      {/* 快捷操作 */}
      <div className="ml-auto flex items-center gap-2">
        <button
          className="btn btn-glass px-4 py-2 text-sm"
          disabled={curVan === null || vanReadonly || addPending}
          title={
            vanArchived
              ? "班次已结转归档，不可新增快件"
              : "在本班次末尾新增一行快件"
          }
          onClick={onAddTask}
        >
          + 快件
        </button>
        <button
          className="btn btn-glass px-4 py-2 text-sm"
          disabled={curVan === null || vanReadonly}
          title={vanArchived ? "本班次已结转过，请勿重复操作" : undefined}
          onClick={onOpenCarry}
        >
          滞留件转下一班
        </button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div>
      <div className="label-caps">{label}</div>
      <div
        className={`text-base font-bold ${tone === "warn" ? "text-amber-500" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}
