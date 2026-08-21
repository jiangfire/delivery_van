import { useState, useRef, useEffect, type KeyboardEvent } from "react";

/** 标签输入内部组件（多人负责） */
export default function TagEditorInner({
  initial,
  onChange,
  members,
}: {
  initial: string[];
  onChange: (v: string[]) => void;
  members: string[];
}) {
  const [tags, setTags] = useState<string[]>(initial);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => onChange(tags), [tags, onChange]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const addTag = (name: string) => {
    const trimmed = name.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
    }
    setInput("");
  };

  const removeTag = (name: string) => {
    setTags(tags.filter((t) => t !== name));
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && input.trim()) {
      e.preventDefault();
      addTag(input);
    } else if (e.key === "Backspace" && !input && tags.length > 0) {
      setTags(tags.slice(0, -1));
    }
  };

  const suggestions = members.filter(
    (m) => !tags.includes(m) && m.toLowerCase().includes(input.toLowerCase()),
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        width: "100%",
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {tags.map((t) => (
          <span
            key={t}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              padding: "2px 6px",
              borderRadius: 4,
              background: "var(--primary)",
              color: "var(--primary-foreground)",
              fontSize: 12,
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
              }}
              onClick={() => removeTag(t)}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder={tags.length === 0 ? "输入后回车添加" : ""}
          style={{
            flex: 1,
            minWidth: 80,
            border: "none",
            outline: "none",
            background: "transparent",
            fontSize: 13,
          }}
        />
      </div>
      {suggestions.length > 0 && input && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            borderTop: "1px solid var(--border)",
            paddingTop: 4,
          }}
        >
          {suggestions.slice(0, 6).map((m) => (
            <button
              key={m}
              style={{
                padding: "1px 6px",
                borderRadius: 4,
                border: "1px solid var(--border)",
                background: "var(--muted)",
                fontSize: 12,
                cursor: "pointer",
              }}
              onClick={() => addTag(m)}
            >
              + {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
