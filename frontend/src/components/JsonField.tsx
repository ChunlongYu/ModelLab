import React, { useEffect, useState } from "react";

export function JsonField({
  label,
  value,
  onChange,
  disabled,
  compact = false,
}: {
  label: string;
  value: any;
  onChange: (v: any) => void;
  disabled: boolean;
  compact?: boolean;
}) {
  const serialize = (v: any) => JSON.stringify(v, null, compact ? 0 : 2);
  const [text, setText] = useState(serialize(value));
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setText(serialize(value));
    setDirty(false);
    setError("");
  }, [JSON.stringify(value)]);

  return (
    <div className="json-field">
      <label>
        {label}
        <textarea
          rows={compact ? 1 : 5}
          className="input-mono"
          disabled={disabled}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setDirty(true);
            setError("");
          }}
        />
      </label>
      {dirty && (
        <div className="drawer-actions">
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={disabled}
            onClick={async () => {
              try {
                const v = JSON.parse(text);
                if (
                  Array.isArray(value) !== Array.isArray(v) ||
                  typeof v !== typeof value
                )
                  throw new Error("JSON 类型不匹配");
                await onChange(v);
                setDirty(false);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            应用 JSON
          </button>
        </div>
      )}
      {error && <small className="error-text">{error}</small>}
    </div>
  );
}
