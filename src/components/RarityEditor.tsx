import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";

const RARITIES = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
  "mythic",
] as const;

const RARITY_LABEL: Record<string, string> = {
  common: "普通",
  uncommon: "优秀",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
};

/**
 * 稀有度下拉编辑器组件：显示中文标签，返回英文值。
 * 使用 Portal 渲染到 body，逃出 backdrop-filter 层叠上下文。
 */
export default function RarityEditor({
  initial,
  onChange,
  onClose,
  pos,
}: {
  initial: string;
  onChange: (v: string) => void;
  onClose: (finalValue?: string) => void;
  pos: { top: number; left: number };
}) {
  const [value, setValue] = useState(initial);
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

  const select = useCallback(
    (v: string) => {
      setValue(v);
      // 单选：选择后立即关闭，直接传值避免 effect 时序问题
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
        minWidth: 120,
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
      {RARITIES.map((r) => (
        <label
          key={r}
          style={{
            display: "flex",
            alignItems: "center",
            padding: "6px 14px",
            cursor: "pointer",
            fontSize: 13,
            background: value === r ? "rgba(14,165,233,0.06)" : "transparent",
          }}
          onMouseEnter={(e) => {
            if (value !== r)
              e.currentTarget.style.background = "rgba(0,0,0,0.02)";
          }}
          onMouseLeave={(e) => {
            if (value !== r) e.currentTarget.style.background = "transparent";
          }}
        >
          <input
            type="radio"
            name="rarity"
            checked={value === r}
            onChange={() => select(r)}
            style={{ accentColor: "#0ea5e9", marginRight: 8 }}
          />
          <span>{RARITY_LABEL[r] ?? r}</span>
        </label>
      ))}
    </div>
  );

  return createPortal(panel, document.body);
}
