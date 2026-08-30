import { CARRY_REASONS, CARRY_REASON_LABELS } from "@contracts/enums";

/* ── 结转确认弹层（WP5：原因下拉，默认未分类；替代原生 confirm） ── */

export function CarryDialog({
  ask,
  reason,
  pending,
  onReasonChange,
  onCancel,
  onConfirm,
}: {
  ask: { fromVan: string; toVan: string };
  reason: string;
  pending: boolean;
  onReasonChange: (reason: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4"
      role="dialog"
      aria-label="结转确认"
    >
      <div className="glass-card w-full max-w-sm p-5">
        <h3 className="mb-1 text-sm font-bold">滞留件转下一班</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          把 {ask.fromVan} 的滞留件转到 {ask.toVan}
          ？结转后本班归档只读。
        </p>
        <label className="label-caps" htmlFor="carry-reason">
          结转原因（可选，喂滞留瀑布与可控性分层）
        </label>
        <select
          id="carry-reason"
          className="select-liquid mt-1 w-full px-3 py-2 text-sm"
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
        >
          <option value="">未分类</option>
          {CARRY_REASONS.map((r) => (
            <option key={r} value={r}>
              {CARRY_REASON_LABELS[r]}
            </option>
          ))}
        </select>
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="btn btn-ghost px-3 py-1.5 text-sm"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            className="btn btn-primary px-4 py-1.5 text-sm"
            disabled={pending}
            onClick={onConfirm}
          >
            确认结转
          </button>
        </div>
      </div>
    </div>
  );
}
