import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { OWNER_POINTS_MAX, type OwnerAlloc } from "@contracts/points";

/**
 * 负责人编辑器（v2.5 每人点数制）：成员多选 + **每个被选中的人各自设置自己的点数**。
 *
 * 三条交互约定（见 docs/archived/负责人点数制设计方案.md）：
 * 1. **勾选负责人 ≠ 设置完成**（D5）：点数输入框默认空着，只要还有人没设置就不能确定；
 * 2. **在这里就能看见运力**：每行右侧显示该成员"本周已装（不含这件）/ 上限"，
 *    填了点数还会即时预览加上这件之后是多少、有没有压超载——不必滚到页面底部才知道；
 * 3. **放弃要说话**：没填满就点外部 / Esc 视为放弃，把原值送回并**明确提示**——
 *    静默回滚会让人以为存上了。
 *
 * 用 Portal 渲染到 body，逃出 backdrop-filter 层叠上下文。
 */

/** 某人本周已装（不含当前这件）与周运力上限 */
export type MemberLoad = { assigned: number; capacity: number };

/** 编辑器草稿：名字 + 点数 + 逐人完成日期（v2.6，null = 未交付） */
export type OwnerDraft = OwnerAlloc & { doneAt: string | null };

/** 本地当天 YYYY-MM-DD（不用 toISOString——那是 UTC，会偏移） */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function MultiSelectEditor({
  initial,
  members,
  loadByMember,
  onAddMember,
  onChange,
  onClose,
  pos,
}: {
  initial: OwnerDraft[];
  members: string[];
  loadByMember?: Record<string, MemberLoad>;
  onAddMember?: (name: string) => void;
  onChange: (v: OwnerDraft[]) => void;
  onClose: (finalValue?: OwnerDraft[]) => void;
  pos: { top: number; left: number };
}) {
  const [selected, setSelected] = useState<string[]>(() =>
    initial.map((o) => o.name),
  );
  /** 输入框原文："" = 还没设置（空着不算 0 点） */
  const [raw, setRaw] = useState<Record<string, string>>(() =>
    Object.fromEntries(initial.map((o) => [o.name, String(o.points)])),
  );
  /** 逐人完成日期：有值 = 已交付（空字符串不存在，取消勾选即删除） */
  const [doneMap, setDoneMap] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initial.filter((o) => o.doneAt).map((o) => [o.name, o.doneAt!]),
    ),
  );
  const [newName, setNewName] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  /** 原文 → 点数；不是 0~上限的整数一律当作"还没设置" */
  const pointsOf = useCallback(
    (name: string): number | null => {
      const t = raw[name] ?? "";
      if (!/^\d+$/.test(t)) return null;
      const n = Number(t);
      return n >= 0 && n <= OWNER_POINTS_MAX ? n : null;
    },
    [raw],
  );

  const complete = selected.every((n) => pointsOf(n) != null);
  const unset = selected.filter((n) => pointsOf(n) == null);
  const total = selected.reduce((s, n) => s + (pointsOf(n) ?? 0), 0);

  /**
   * 列表里的成员 = 成员表 ∪ 本件现有的负责人。
   * 后者可能不是成员表里的人（只有 API / MCP 直写才会出现），不列出来的话
   * 他们就成了"看不见但还在"的负责人。
   */
  const rows = (() => {
    const known = new Set(members);
    const extra = initial.map((o) => o.name).filter((n) => !known.has(n));
    return extra.length > 0 ? [...members, ...extra] : members;
  })();

  const alloc = useCallback(
    (): OwnerDraft[] =>
      selected.map((name) => ({
        name,
        points: pointsOf(name) ?? 0,
        doneAt: doneMap[name] ?? null,
      })),
    [selected, pointsOf, doneMap],
  );

  // 只有全部设置完毕才向上同步（没设置完的值不上屏、也不落库）
  useEffect(() => {
    if (complete) onChange(alloc());
  }, [complete, alloc, onChange]);

  const commit = useCallback(() => onClose(alloc()), [onClose, alloc]);

  /** 放弃编辑：送回原值，并明确告诉用户"这次改动没保存" */
  const abort = useCallback(() => {
    if (unset.length > 0) {
      toast.warning("已放弃修改", {
        description: `还有 ${unset.length} 人没设置点数，每个人都要有自己的点数`,
      });
    }
    onClose(initial);
  }, [onClose, initial, unset.length]);

  // 点击外部关闭：设置完毕即提交，否则放弃（且会提示）
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        if (complete) commit();
        else abort();
      }
    };
    // 延迟绑定，避免当前点击触发关闭
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [complete, commit, abort]);

  // Escape 关闭（同上：没设置完 = 放弃）
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        if (complete) commit();
        else abort();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [complete, commit, abort]);

  const toggle = useCallback((name: string) => {
    setSelected((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
    // 取消勾选负责人时一并清掉他的完成状态（重新勾上视为未交付）
    setDoneMap((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setSelected([]);
    setRaw({});
    setDoneMap({});
  }, []);

  /** 勾选完成：默认今天（可手改）；取消勾选 = 未交付 */
  const toggleDone = useCallback((name: string) => {
    setDoneMap((prev) => {
      if (name in prev) {
        const next = { ...prev };
        delete next[name];
        return next;
      }
      return { ...prev, [name]: todayLocal() };
    });
  }, []);

  const setDoneDate = useCallback((name: string, v: string) => {
    setDoneMap((prev) => {
      if (!v) {
        const next = { ...prev };
        delete next[name];
        return next;
      }
      return { ...prev, [name]: v };
    });
  }, []);

  /** 只收数字，最多两位（挡住 150 这类越界输入） */
  const setPoints = useCallback((name: string, v: string) => {
    setRaw((prev) => ({ ...prev, [name]: v.replace(/\D/g, "").slice(0, 2) }));
  }, []);

  /** 回车：填满了就提交；没填满就跳到下一个还没设置的人 */
  const onPointsKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>, name: string) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (complete) {
        commit();
        return;
      }
      const next = unset.find((n) => n !== name);
      if (next) inputRefs.current[next]?.focus();
    },
    [complete, commit, unset],
  );

  const submitNew = useCallback(() => {
    const trimmed = newName.trim();
    // 半角逗号与服务端负责人标签约束冲突，直接不添加（服务端 zod 也会拦截）
    if (!trimmed || trimmed.includes(",")) return;
    if (!members.includes(trimmed)) {
      onAddMember?.(trimmed);
    }
    setSelected((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    setNewName("");
    // 新加的人也要设置点数：焦点直接送到他的输入框
    setTimeout(() => inputRefs.current[trimmed]?.focus(), 0);
  }, [newName, members, onAddMember]);

  const panel = (
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width: 430,
        // 面板不超出视口：底部「确定」始终可见（成员多时列表内部滚动）
        maxHeight: Math.max(240, window.innerHeight - pos.top - 8),
        display: "flex",
        flexDirection: "column",
        background: "rgba(255,255,255,0.97)",
        border: "1px solid rgba(0,0,0,0.1)",
        borderRadius: 12,
        boxShadow: "0 12px 40px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.06)",
        padding: 0,
        overflow: "hidden",
        zIndex: 99999,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "8px 12px 6px",
          borderBottom: "1px solid rgba(0,0,0,0.05)",
          fontSize: 11,
          color: "#64748b",
        }}
      >
        <span>勾选负责人，给每个人设点数与完成日期</span>
        {selected.length > 0 && (
          <button
            style={{
              background: "none",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: 11,
              padding: 0,
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              clearAll();
            }}
          >
            清空
          </button>
        )}
      </div>
      <div
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          overflowY: "auto",
          padding: "4px 0",
        }}
      >
        {members.length === 0 && (
          <div
            style={{ padding: "6px 12px 2px", fontSize: 12, color: "#94a3b8" }}
          >
            暂无成员，可直接添加 ↓
          </div>
        )}
        {rows.map((m) => {
          const checked = selected.includes(m);
          const load = loadByMember?.[m];
          const p = pointsOf(m);
          const after = load && p != null ? load.assigned + p : null;
          const over = load != null && after != null && after > load.capacity;
          return (
            <div
              key={m}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 12px",
                fontSize: 13,
                background: checked ? "rgba(14,165,233,0.06)" : "transparent",
              }}
            >
              <input
                type="checkbox"
                id={`dv-owner-${m}`}
                checked={checked}
                onChange={() => toggle(m)}
                style={{
                  accentColor: "#0ea5e9",
                  width: 14,
                  height: 14,
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              />
              <label
                htmlFor={`dv-owner-${m}`}
                style={{ flex: 1, cursor: "pointer" }}
              >
                {m}
              </label>
              {/* 本周已装（不含这件）/ 上限：选人时就看得出谁还有余量 */}
              <span
                title="本周已装（不含这件）/ 周运力上限"
                style={{
                  fontSize: 11,
                  color: "#94a3b8",
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                }}
              >
                {load ? `${load.assigned}/${load.capacity}` : ""}
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: 4,
                  width: 92,
                  flexShrink: 0,
                }}
              >
                {checked && (
                  <input
                    ref={(el) => {
                      inputRefs.current[m] = el;
                    }}
                    aria-label={`${m} 的点数`}
                    inputMode="numeric"
                    placeholder="点"
                    value={raw[m] ?? ""}
                    onChange={(e) => setPoints(m, e.target.value)}
                    onKeyDown={(e) => onPointsKeyDown(e, m)}
                    style={{
                      width: 42,
                      padding: "2px 4px",
                      textAlign: "center",
                      fontSize: 12,
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      border: `1px solid ${p == null ? "#fbbf24" : "rgba(0,0,0,0.15)"}`,
                      background: p == null ? "#fffbeb" : "#fff",
                      borderRadius: 6,
                      outline: "none",
                    }}
                  />
                )}
                {checked && after != null && load && (
                  <span
                    title={`加上这件后：${after}/${load.capacity}`}
                    style={{
                      width: 44,
                      textAlign: "right",
                      fontSize: 11,
                      fontWeight: 700,
                      color: over ? "#dc2626" : "#0ea5e9",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    →{after}
                    {over && " ⚠"}
                  </span>
                )}
              </span>
              {/* 逐人完成（v2.6）：勾 = 已交付并记日期（默认今天，可手改）；0 点的人也能勾 */}
              {checked && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    flexShrink: 0,
                  }}
                >
                  <input
                    type="checkbox"
                    aria-label={`${m} 已完成`}
                    checked={doneMap[m] !== undefined}
                    onChange={() => toggleDone(m)}
                    title="已完成（0 点的人也能勾，不参与整件闭环判定）"
                    style={{
                      accentColor: "#16a34a",
                      width: 14,
                      height: 14,
                      cursor: "pointer",
                    }}
                  />
                  {doneMap[m] !== undefined && (
                    <input
                      type="date"
                      aria-label={`${m} 完成日期`}
                      value={doneMap[m]}
                      onChange={(e) => setDoneDate(m, e.target.value)}
                      style={{
                        width: 120,
                        padding: "1px 3px",
                        fontSize: 11,
                        border: "1px solid rgba(0,0,0,0.15)",
                        borderRadius: 6,
                        outline: "none",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    />
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {onAddMember && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px 8px",
            borderTop: "1px solid rgba(0,0,0,0.06)",
          }}
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitNew();
              }
            }}
            placeholder="新成员名称"
            style={{
              flex: 1,
              padding: "4px 8px",
              border: "1px solid rgba(0,0,0,0.1)",
              borderRadius: 8,
              fontSize: 12,
              outline: "none",
              background: "rgba(255,255,255,0.6)",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "rgba(14,165,233,0.4)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "rgba(0,0,0,0.1)";
            }}
          />
          <button
            style={{
              padding: "4px 10px",
              borderRadius: 8,
              border: "none",
              background: newName.trim()
                ? "linear-gradient(135deg, #0ea5e9, #0284c7)"
                : "#e2e8f0",
              color: newName.trim() ? "#fff" : "#94a3b8",
              fontSize: 12,
              fontWeight: 600,
              cursor: newName.trim() ? "pointer" : "default",
              whiteSpace: "nowrap",
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (newName.trim()) submitNew();
            }}
          >
            添加
          </button>
        </div>
      )}
      {/* 合计与确定：还有人没设置点数就不许确定（D5） */}
      <div
        style={{
          padding: "6px 10px 8px",
          borderTop: "1px solid rgba(0,0,0,0.06)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 6,
            fontSize: 11,
          }}
        >
          <span style={{ color: "#0f172a", fontWeight: 600 }}>
            合计 {total} 点
          </span>
          {selected.length > 0 && (
            <span style={{ color: "#0f172a" }}>
              {selected.filter((n) => doneMap[n] !== undefined).length}/
              {selected.length} 人已交
            </span>
          )}
          {unset.length > 0 && (
            <span style={{ color: "#b45309" }}>
              {unset.length} 人还没设置点数
            </span>
          )}
        </div>
        <button
          disabled={!complete}
          title={
            complete
              ? "回车也可提交"
              : "每个负责人都要设置自己的点数（敲数字后回车可跳到下一个人）"
          }
          style={{
            width: "100%",
            padding: "6px 0",
            borderRadius: 8,
            border: "none",
            background: complete
              ? "linear-gradient(135deg, #0ea5e9, #0284c7)"
              : "#e2e8f0",
            color: complete ? "#fff" : "#94a3b8",
            fontSize: 12,
            fontWeight: 600,
            cursor: complete ? "pointer" : "not-allowed",
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (complete) commit();
          }}
        >
          确定
        </button>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
