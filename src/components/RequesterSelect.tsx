import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * 提出人下拉选择：单选成员，支持就地添加新成员。
 * 使用 Portal 渲染到 body。
 */
export default function RequesterSelect({
  initial,
  members,
  onAddMember,
  onChange,
  onClose,
  pos,
}: {
  initial: string;
  members: string[];
  onAddMember?: (name: string) => void;
  onChange: (v: string) => void;
  onClose: (finalValue?: string) => void;
  pos: { top: number; left: number };
}) {
  const [value, setValue] = useState(initial);
  const [newName, setNewName] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onChange(value);
  }, [value, onChange]);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose(value);
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose, value]);

  // Escape 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(value);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, value]);

  const submitNew = useCallback(() => {
    const trimmed = newName.trim();
    // 半角逗号与服务端负责人聚合分隔符冲突，直接不添加（服务端 zod 也会拦截）
    if (!trimmed || trimmed.includes(",")) return;
    if (!members.includes(trimmed)) {
      onAddMember?.(trimmed);
    }
    // 添加后直接选中并关闭编辑器
    setValue(trimmed);
    setNewName("");
    onClose(trimmed);
  }, [newName, members, onAddMember, onClose]);

  const selectAndClose = useCallback(
    (v: string) => {
      setValue(v);
      onClose(v);
    },
    [onClose],
  );

  const panel = (
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        minWidth: 160,
        background: "rgba(255,255,255,0.97)",
        border: "1px solid rgba(0,0,0,0.1)",
        borderRadius: 12,
        boxShadow: "0 12px 40px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.06)",
        padding: "4px 0",
        overflow: "hidden",
        zIndex: 99999,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <label
        style={{
          display: "flex",
          alignItems: "center",
          padding: "6px 14px",
          cursor: "pointer",
          fontSize: 13,
          color: "#94a3b8",
          background: value === "" ? "rgba(14,165,233,0.06)" : "transparent",
        }}
        onMouseEnter={(e) => {
          if (value !== "")
            e.currentTarget.style.background = "rgba(0,0,0,0.02)";
        }}
        onMouseLeave={(e) => {
          if (value !== "") e.currentTarget.style.background = "transparent";
        }}
      >
        <input
          type="radio"
          name="requester"
          checked={value === ""}
          onChange={() => selectAndClose("")}
          style={{ accentColor: "#0ea5e9", marginRight: 8 }}
        />
        <span>无</span>
      </label>
      <div style={{ maxHeight: 200, overflowY: "auto" }}>
        {members.map((m) => (
          <label
            key={m}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "6px 14px",
              cursor: "pointer",
              fontSize: 13,
              background: value === m ? "rgba(14,165,233,0.06)" : "transparent",
            }}
            onMouseEnter={(e) => {
              if (value !== m)
                e.currentTarget.style.background = "rgba(0,0,0,0.02)";
            }}
            onMouseLeave={(e) => {
              if (value !== m) e.currentTarget.style.background = "transparent";
            }}
          >
            <input
              type="radio"
              name="requester"
              checked={value === m}
              onChange={() => selectAndClose(m)}
              style={{ accentColor: "#0ea5e9", marginRight: 8 }}
            />
            <span>{m}</span>
          </label>
        ))}
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
