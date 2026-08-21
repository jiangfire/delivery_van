import { useState, useRef, useEffect, useCallback } from "react";

/**
 * 多选下拉编辑器：成员多选，勾选式操作，已选显示为标签。
 * 支持就地添加新成员（onAddMember 回调）。
 */
export default function MultiSelectEditor({
  initial,
  members,
  onAddMember,
  onChange,
}: {
  initial: string[];
  members: string[];
  onAddMember?: (name: string) => void;
  onChange: (v: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(initial);
  const [newName, setNewName] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onChange(selected);
  }, [selected, onChange]);

  const toggle = useCallback((name: string) => {
    setSelected((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }, []);

  const clearAll = useCallback(() => {
    setSelected([]);
  }, []);

  const submitNew = useCallback(() => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    // 去重：已在列表中的不重复添加
    if (!members.includes(trimmed)) {
      onAddMember?.(trimmed);
    }
    // 无论新旧，直接选中
    setSelected((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    setNewName("");
  }, [newName, members, onAddMember]);

  return (
    <div
      ref={panelRef}
      style={{
        minWidth: 220,
        background: "rgba(255,255,255,0.95)",
        backdropFilter: "blur(16px) saturate(180%)",
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 14,
        boxShadow: "0 8px 32px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.04)",
        padding: 0,
        overflow: "hidden",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* 头部：已选标签 + 清空 */}
      <div
        style={{
          padding: "8px 10px 6px",
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
          borderBottom:
            selected.length > 0 ? "1px solid rgba(0,0,0,0.05)" : "none",
          minHeight: selected.length > 0 ? 32 : 0,
        }}
      >
        {selected.map((t) => (
          <span
            key={t}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              padding: "2px 8px",
              borderRadius: 6,
              background: "linear-gradient(135deg, #0ea5e9, #0284c7)",
              color: "#fff",
              fontSize: 11,
              fontWeight: 600,
              lineHeight: "16px",
            }}
          >
            {t}
            <button
              style={{
                background: "none",
                border: "none",
                color: "inherit",
                cursor: "pointer",
                padding: 0,
                lineHeight: 1,
                fontSize: 12,
                opacity: 0.8,
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggle(t);
              }}
            >
              ×
            </button>
          </span>
        ))}
        {selected.length > 0 && (
          <button
            style={{
              background: "none",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: 11,
              padding: "0 4px",
              lineHeight: "16px",
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
      {/* 成员列表 */}
      <div style={{ maxHeight: 200, overflowY: "auto", padding: "4px 0" }}>
        {members.length === 0 && (
          <div
            style={{
              padding: "6px 12px 2px",
              fontSize: 12,
              color: "#94a3b8",
            }}
          >
            暂无成员，可直接添加 ↓
          </div>
        )}
        {members.map((m) => {
          const checked = selected.includes(m);
          return (
            <label
              key={m}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "5px 12px",
                cursor: "pointer",
                fontSize: 13,
                background: checked ? "rgba(14,165,233,0.06)" : "transparent",
                transition: "background 0.12s ease",
              }}
              onMouseEnter={(e) => {
                if (!checked)
                  e.currentTarget.style.background = "rgba(0,0,0,0.02)";
              }}
              onMouseLeave={(e) => {
                if (!checked) e.currentTarget.style.background = "transparent";
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(m)}
                style={{
                  accentColor: "#0ea5e9",
                  width: 14,
                  height: 14,
                  cursor: "pointer",
                }}
              />
              <span style={{ flex: 1 }}>{m}</span>
              {checked && (
                <span style={{ color: "#0ea5e9", fontSize: 12 }}>✓</span>
              )}
            </label>
          );
        })}
      </div>
      {/* 底部：添加新成员 */}
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
    </div>
  );
}
