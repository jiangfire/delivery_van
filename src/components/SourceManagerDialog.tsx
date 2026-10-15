import { useState } from "react";
import type { SourceOption } from "../../api/queries/sources";
import { SOURCE_PALETTE } from "@/lib/sources";

/* ── 需求类型管理弹层（v2.7）：新增自定义类型 / 改显示名（code 永不变）/
 * 删除（内置不可删、有快件引用不可删——守卫在服务端，失败以 toast 呈现）。
 * 与 CarryDialog 同款轻量弹层（遮罩 + glass-card），数据与 mutation 都在 BoardPage ── */

export function SourceManagerDialog({
  sources,
  pending,
  onAdd,
  onRename,
  onRemove,
  onClose,
}: {
  sources: SourceOption[];
  /** 任一管理 mutation 进行中（统一禁用操作，避免并发改名/删除交错） */
  pending: boolean;
  /** 返回 mutation promise：Dialog 等成功才清空草稿，失败（onError 已 toast）保留输入 */
  onAdd: (label: string) => Promise<unknown>;
  onRename: (code: string, label: string) => Promise<unknown>;
  onRemove: (code: string) => void;
  onClose: () => void;
}) {
  const [newLabel, setNewLabel] = useState("");
  /** 行内改名：正在改的 code 与草稿（组件条件渲染，挂载即新实例，无需重置态） */
  const [editing, setEditing] = useState<{
    code: string;
    draft: string;
  } | null>(null);

  const submitNew = async () => {
    const label = newLabel.trim();
    if (!label) return;
    try {
      await onAdd(label);
      setNewLabel("");
    } catch {
      /* 失败保留输入：onError 已 toast 原因，用户改个名就能重试 */
    }
  };

  const submitRename = async (code: string) => {
    const label = editing?.draft.trim();
    if (!editing || editing.code !== code || !label) {
      setEditing(null);
      return;
    }
    try {
      await onRename(code, label);
      setEditing(null);
    } catch {
      /* 失败保留编辑态：onError 已 toast 原因 */
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4"
      role="dialog"
      aria-label="管理需求类型"
    >
      <div className="glass-card w-full max-w-md p-5">
        <h3 className="mb-1 text-sm font-bold">管理需求类型（快件来源）</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          改名只改显示名，历史快件零迁移；内置类型与仍有快件在用的类型不可删除。
        </p>
        <ul className="mb-3 space-y-1.5">
          {sources.map((s, i) => (
            <li
              key={s.code}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm"
              style={{ background: "rgba(0,0,0,0.03)" }}
            >
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{
                  background: SOURCE_PALETTE[i % SOURCE_PALETTE.length],
                }}
              />
              {editing?.code === s.code ? (
                <>
                  <input
                    autoFocus
                    className="input-liquid min-w-0 flex-1 px-2 py-1 text-sm"
                    maxLength={16}
                    value={editing.draft}
                    onChange={(e) =>
                      setEditing({ code: s.code, draft: e.target.value })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitRename(s.code);
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                  <button
                    className="btn btn-primary px-2 py-0.5 text-xs"
                    disabled={pending || !editing.draft.trim()}
                    onClick={() => submitRename(s.code)}
                  >
                    确定
                  </button>
                  <button
                    className="btn btn-ghost px-2 py-0.5 text-xs"
                    onClick={() => setEditing(null)}
                  >
                    取消
                  </button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate">
                    {s.label}
                    <span className="ml-1.5 text-[10px] text-muted-foreground/60">
                      {s.builtIn ? "内置" : ""}
                    </span>
                  </span>
                  <button
                    className="btn btn-glass px-2 py-0.5 text-xs"
                    disabled={pending}
                    title={`改显示名（存储值 ${s.code} 不变）`}
                    onClick={() => setEditing({ code: s.code, draft: s.label })}
                  >
                    改名
                  </button>
                  <button
                    className="btn btn-danger px-2 py-0.5 text-xs"
                    disabled={pending || s.builtIn}
                    title={
                      s.builtIn
                        ? "内置类型不可删除"
                        : "删除（仍有快件在用时会被拒绝）"
                    }
                    onClick={() => {
                      if (window.confirm(`删除需求类型「${s.label}」？`)) {
                        onRemove(s.code);
                      }
                    }}
                  >
                    删除
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <input
            className="input-liquid min-w-0 flex-1 px-2 py-1.5 text-sm"
            placeholder="新类型名（如：运营 / 技术债）"
            maxLength={16}
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitNew();
            }}
          />
          <button
            className="btn btn-primary px-3 py-1.5 text-xs"
            disabled={pending || !newLabel.trim()}
            onClick={submitNew}
          >
            新增
          </button>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            className="btn btn-ghost px-3 py-1.5 text-sm"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
