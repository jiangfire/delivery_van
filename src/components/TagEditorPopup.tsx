import { useState, useRef, useEffect, useCallback } from "react";

/** 弹出式标签编辑器：带搜索、建议列表、已选标签 */
export default function TagEditorPopup({
  initial,
  members,
  onChange,
}: {
  initial: string[];
  members: string[];
  onChange: (v: string[]) => void;
}) {
  const [tags, setTags] = useState(initial);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    onChange(tags);
  }, [tags, onChange]);

  const addTag = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (trimmed && !tags.includes(trimmed)) {
        setTags((prev) => [...prev, trimmed]);
      }
      setInput("");
    },
    [tags],
  );

  const removeTag = useCallback((name: string) => {
    setTags((prev) => prev.filter((t) => t !== name));
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && input.trim()) {
      e.preventDefault();
      addTag(input);
    } else if (e.key === "Backspace" && !input && tags.length > 0) {
      e.preventDefault();
      setTags((prev) => prev.slice(0, -1));
    }
  };

  const suggestions = members.filter(
    (m) => !tags.includes(m) && m.toLowerCase().includes(input.toLowerCase()),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* 已选标签 */}
      {tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {tags.map((t) => (
            <span
              key={t}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 10px",
                borderRadius: 8,
                background: "linear-gradient(135deg, #0ea5e9, #0284c7)",
                color: "#fff",
                fontSize: 12,
                fontWeight: 600,
                lineHeight: "18px",
                boxShadow: "0 1px 4px rgba(14, 165, 233, 0.25)",
                transition: "transform 0.15s ease, box-shadow 0.15s ease",
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
                  fontSize: 14,
                  opacity: 0.75,
                  transition: "opacity 0.15s ease",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.75")}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  removeTag(t);
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {/* 搜索输入 */}
      <input
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKey}
        placeholder={tags.length === 0 ? "搜索成员，回车添加" : "继续添加…"}
        style={{
          width: "100%",
          padding: "6px 10px",
          border: "1px solid rgba(0, 0, 0, 0.08)",
          borderRadius: 10,
          outline: "none",
          fontSize: 13,
          background: "rgba(255, 255, 255, 0.6)",
          boxSizing: "border-box",
          transition: "border-color 0.2s ease, box-shadow 0.2s ease",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "rgba(14, 165, 233, 0.4)";
          e.currentTarget.style.boxShadow = "0 0 0 3px rgba(14, 165, 233, 0.1)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "rgba(0, 0, 0, 0.08)";
          e.currentTarget.style.boxShadow = "none";
        }}
      />
      {/* 建议列表：输入时过滤 */}
      {input && suggestions.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            maxHeight: 160,
            overflowY: "auto",
          }}
        >
          {suggestions.map((m) => (
            <button
              key={m}
              style={{
                padding: "5px 10px",
                borderRadius: 8,
                border: "none",
                background: "transparent",
                fontSize: 13,
                cursor: "pointer",
                textAlign: "left",
                transition: "background 0.15s ease",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "rgba(14, 165, 233, 0.06)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                addTag(m);
              }}
            >
              {m}
            </button>
          ))}
        </div>
      )}
      {/* 空搜索时显示全部未选成员 */}
      {!input && members.filter((m) => !tags.includes(m)).length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 5,
            borderTop: "1px solid rgba(0, 0, 0, 0.06)",
            paddingTop: 8,
          }}
        >
          {members
            .filter((m) => !tags.includes(m))
            .map((m) => (
              <button
                key={m}
                style={{
                  padding: "3px 10px",
                  borderRadius: 8,
                  border: "1px solid rgba(0, 0, 0, 0.08)",
                  background: "rgba(255, 255, 255, 0.5)",
                  fontSize: 12,
                  cursor: "pointer",
                  transition:
                    "background 0.15s ease, border-color 0.15s ease, transform 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(14, 165, 233, 0.06)";
                  e.currentTarget.style.borderColor =
                    "rgba(14, 165, 233, 0.25)";
                  e.currentTarget.style.transform = "scale(1.03)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.5)";
                  e.currentTarget.style.borderColor = "rgba(0, 0, 0, 0.08)";
                  e.currentTarget.style.transform = "scale(1)";
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  addTag(m);
                }}
              >
                + {m}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
