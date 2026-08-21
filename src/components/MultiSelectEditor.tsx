import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

/**
 * 多选下拉编辑器：成员多选，勾选式操作，已选显示为标签。
 * 使用 React Portal 渲染到 body，逃出 backdrop-filter 层叠上下文。
 */
export default function MultiSelectEditor({
  initial,
  members,
  onAddMember,
  onChange,
  pos,
}: {
  initial: string[];
  members: string[];
  onAddMember?: (name: string) => void;
  onChange: (v: string[]) => void;
  pos: { top: number; left: number };
}) {
  const [selected, setSelected] = useState<string[]>(initial);
  const [newName, setNewName] = useState("");

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
    if (!members.includes(trimmed)) {
      onAddMember?.(trimmed);
    }
    setSelected((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    setNewName("");
  }, [newName, members, onAddMember]);

  const panel = (
    <div
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        minWidth: 220,
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
      {selected.length > 0 && (
        <div
          style={{
            padding: "8px 10px 6px",
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            borderBottom: "1px solid rgba(0,0,0,0.05)",
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
        </div>
      )}
      <div style={{ maxHeight: 200, overflowY: "auto", padding: "4px 0" }}>
        {members.length === 0 && (
          <div
            style={{ padding: "6px 12px 2px", fontSize: 12, color: "#94a3b8" }}
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

  return createPortal(panel, document.body);
}
