import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

/**
 * 自定义送达日期编辑器：
 * 使用 Portal 渲染日历弹框，点击外部或选日期后自动关闭。
 * 遵循 ag-custom-component-popup 规范，让 AG Grid 正确检测弹框外部点击。
 */
export default function DateCellEditor({
  initial,
  onClose,
  pos,
}: {
  initial: string;
  onClose: (value: string | null) => void;
  pos: { top: number; left: number };
}) {
  const [value, setValue] = useState(initial);
  const panelRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose(value || null);
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
      if (e.key === "Escape") onClose(value || null);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, value]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      setValue(v);
      // 选择日期后立即关闭
      onClose(v || null);
    },
    [onClose],
  );

  const handleClear = useCallback(() => {
    onClose(null);
  }, [onClose]);

  const panel = (
    <div
      ref={panelRef}
      className="ag-custom-component-popup"
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        minWidth: 220,
        background: "rgba(255,255,255,0.97)",
        border: "1px solid rgba(0,0,0,0.1)",
        borderRadius: 12,
        boxShadow: "0 12px 40px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.06)",
        padding: "10px 14px",
        zIndex: 99999,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>
        选择送达日期
      </div>
      <input
        type="date"
        value={value}
        onChange={handleChange}
        style={{
          width: "100%",
          padding: "6px 8px",
          border: "1px solid rgba(0,0,0,0.1)",
          borderRadius: 8,
          fontSize: 13,
          outline: "none",
          background: "rgba(255,255,255,0.6)",
        }}
        autoFocus
      />
      <button
        onClick={handleClear}
        style={{
          marginTop: 6,
          width: "100%",
          padding: "4px 0",
          borderRadius: 8,
          border: "1px solid rgba(0,0,0,0.1)",
          background: "rgba(255,255,255,0.6)",
          fontSize: 12,
          color: "#94a3b8",
          cursor: "pointer",
        }}
      >
        清除日期
      </button>
    </div>
  );

  return createPortal(panel, document.body);
}
