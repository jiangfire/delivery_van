import { useState, useEffect, useCallback, useRef } from "react";

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
 */
export default function RarityEditor({
  initial,
  onChange,
}: {
  initial: string;
  onChange: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onChange(value);
  }, [value, onChange]);

  const select = useCallback((v: string) => {
    setValue(v);
  }, []);

  return (
    <div
      ref={panelRef}
      style={{
        minWidth: 120,
        background: "rgba(255,255,255,0.95)",
        backdropFilter: "blur(16px) saturate(180%)",
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 14,
        boxShadow: "0 8px 32px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.04)",
        padding: "4px 0",
        overflow: "hidden",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {RARITIES.map((r) => (
        <label
          key={r}
          style={{
            display: "flex",
            alignItems: "center",
            padding: "6px 12px",
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
}
