import React from "react";
import { Obj } from "../api";

type RangePreset = "unconfirmed" | "nonneg" | "free" | "binary" | "custom";

function detectPreset(v: Obj): RangePreset {
  if (v.domain === "binary") return "binary";
  if (v.lower === undefined && v.upper === undefined) return "unconfirmed";
  if (v.lower === 0 && v.upper === null) return "nonneg";
  if (v.lower === null && v.upper === null) return "free";
  return "custom";
}

function BoundInput({
  value,
  onChange,
  label,
  disabled,
}: {
  value: number | null | undefined;
  onChange: (v: number | null | undefined) => void;
  label: string;
  disabled: boolean;
}) {
  const show = (v: number | null | undefined) =>
    v === null ? "无界" : v === undefined ? "" : String(v);
  const [text, setText] = React.useState(show(value));
  React.useEffect(() => setText(show(value)), [value]);
  return (
    <input
      aria-label={label}
      disabled={disabled}
      value={text}
      placeholder="必填 / 无界"
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        if (t === "") onChange(undefined);
        else if (t === "无界" || t === "null") onChange(null);
        else if (t !== "-" && t !== "+" && Number.isFinite(Number(t)))
          onChange(Number(t));
      }}
      onBlur={() => setText(show(value))}
    />
  );
}

export function VariableEditor({
  variables,
  sets,
  editable,
  onChange,
}: {
  variables: Obj[];
  sets: Obj[];
  editable: boolean;
  onChange: (nextVars: Obj[]) => void;
}) {
  const setNames = sets.map((s) => s.id).filter(Boolean);

  const updateVar = (idx: number, nextVar: Obj) => {
    const next = [...variables];
    next[idx] = nextVar;
    onChange(next);
  };

  const applyPreset = (idx: number, preset: RangePreset) => {
    const v = { ...variables[idx] };
    if (preset === "binary") {
      v.domain = "binary";
      v.lower = 0;
      v.upper = 1;
    } else if (preset === "nonneg") {
      if (v.domain === "binary") v.domain = "continuous";
      v.lower = 0;
      v.upper = null;
    } else if (preset === "free") {
      if (v.domain === "binary") v.domain = "continuous";
      v.lower = null;
      v.upper = null;
    } else if (preset === "unconfirmed") {
      if (v.domain === "binary") v.domain = "continuous";
      delete v.lower;
      delete v.upper;
    } else {
      if (v.domain === "binary") v.domain = "continuous";
      if (v.lower === undefined) v.lower = 0;
      if (v.upper === undefined) v.upper = null;
    }
    updateVar(idx, v);
  };

  const toggleIndexSet = (idx: number, setName: string) => {
    const v = variables[idx];
    const current = v.sets || [];
    const exists = current.includes(setName);
    const nextSets = exists
      ? current.filter((x: string) => x !== setName)
      : [...current, setName];
    updateVar(idx, { ...v, sets: nextSets });
  };

  return (
    <div className="section-stack">
      <div className="section-toolbar">
        <div>
          <h3 className="section-title">决策变量 (Decision Variables)</h3>
          <p className="section-desc">
            声明变量符号、索引维度、变量类型与取值范围。空白界限表示“待确认”，系统不会默认补零。
          </p>
        </div>
        <button
          className="btn-secondary"
          disabled={!editable}
          onClick={() =>
            onChange([
              ...variables,
              {
                id: "x" + (variables.length ? variables.length + 1 : ""),
                domain: "continuous",
                sets: [],
              },
            ])
          }
        >
          ＋ 添加变量
        </button>
      </div>

      {variables.length === 0 ? (
        <div className="empty-card">还没有决策变量，点击右上角添加。</div>
      ) : (
        <div className="item-list">
          {variables.map((v, i) => {
            const preset = detectPreset(v);
            const unconfirmed =
              v.domain !== "binary" &&
              (v.lower === undefined || v.upper === undefined);
            return (
              <div
                className={`item-card ${unconfirmed ? "item-card-warn" : ""}`}
                key={i}
              >
                <div className="var-grid">
                  <div>
                    <label className="compact-label">标识符</label>
                    <input
                      aria-label={"变量 " + i + " 标识符"}
                      className="input-mono"
                      disabled={!editable}
                      value={v.id}
                      onChange={(e) =>
                        updateVar(i, { ...v, id: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label className="compact-label">显示符号</label>
                    <input
                      aria-label={"变量 " + i + " 显示符号"}
                      placeholder="可选，如 x"
                      disabled={!editable}
                      value={v.symbol || ""}
                      onChange={(e) =>
                        updateVar(i, { ...v, symbol: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label className="compact-label">变量类型</label>
                    <select
                      aria-label={"变量 " + i + " 类型"}
                      disabled={!editable}
                      value={v.domain}
                      onChange={(e) => {
                        const domain = e.target.value;
                        if (domain === "binary") {
                          updateVar(i, { ...v, domain, lower: 0, upper: 1 });
                        } else {
                          updateVar(i, { ...v, domain });
                        }
                      }}
                    >
                      <option value="continuous">连续 (Continuous)</option>
                      <option value="integer">整数 (Integer)</option>
                      <option value="binary">二元 (Binary 0/1)</option>
                    </select>
                  </div>
                  <div>
                    <label className="compact-label">范围快捷设置</label>
                    <select
                      aria-label={"变量 " + i + " 范围预设"}
                      disabled={!editable}
                      value={preset}
                      onChange={(e) =>
                        applyPreset(i, e.target.value as RangePreset)
                      }
                    >
                      <option value="unconfirmed">待声明（需确认）</option>
                      <option value="nonneg">非负 (≥ 0)</option>
                      <option value="free">自由变量 (−∞, +∞)</option>
                      <option value="binary">二元 (0 或 1)</option>
                      <option value="custom">自定义上下界</option>
                    </select>
                  </div>
                  <div className="var-remove">
                    <button
                      type="button"
                      title="删除变量"
                      className="btn-ghost-danger btn-sm"
                      disabled={!editable}
                      onClick={() =>
                        onChange(variables.filter((_, j) => j !== i))
                      }
                    >
                      删除
                    </button>
                  </div>
                </div>

                <div className="var-subrow">
                  <div className="index-selector">
                    <span className="compact-label">索引集合：</span>
                    {setNames.length > 0 ? (
                      <div className="chip-group">
                        {setNames.map((sname) => {
                          const active = (v.sets || []).includes(sname);
                          return (
                            <button
                              type="button"
                              key={sname}
                              disabled={!editable}
                              className={`chip-toggle ${active ? "active" : ""}`}
                              onClick={() => toggleIndexSet(i, sname)}
                            >
                              {sname}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                    <input
                      aria-label={"变量 " + i + " 索引集合"}
                      className="input-mono input-xs"
                      disabled={!editable}
                      value={(v.sets || []).join(",")}
                      placeholder="无索引或输入 I,J"
                      onChange={(e) =>
                        updateVar(i, {
                          ...v,
                          sets: e.target.value
                            ? e.target.value.split(",").map((s) => s.trim())
                            : [],
                        })
                      }
                    />
                  </div>

                  {v.domain !== "binary" && (
                    <div className="bounds-row">
                      <div className="bound-pair">
                        <span className="compact-label">下界</span>
                        <BoundInput
                          label={"变量 " + i + " 下界"}
                          disabled={!editable}
                          value={v.lower}
                          onChange={(n) => {
                            const next = { ...v };
                            if (n === undefined) delete next.lower;
                            else next.lower = n;
                            updateVar(i, next);
                          }}
                        />
                        <button
                          type="button"
                          className="btn-link"
                          disabled={!editable}
                          onClick={() => updateVar(i, { ...v, lower: null })}
                        >
                          −∞
                        </button>
                      </div>
                      <div className="bound-pair">
                        <span className="compact-label">上界</span>
                        <BoundInput
                          label={"变量 " + i + " 上界"}
                          disabled={!editable}
                          value={v.upper}
                          onChange={(n) => {
                            const next = { ...v };
                            if (n === undefined) delete next.upper;
                            else next.upper = n;
                            updateVar(i, next);
                          }}
                        />
                        <button
                          type="button"
                          className="btn-link"
                          disabled={!editable}
                          onClick={() => updateVar(i, { ...v, upper: null })}
                        >
                          +∞
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                {unconfirmed && (
                  <p className="inline-hint warn">
                    尚未声明完整的上下界，确认前请选择“非负”、“自由变量”或填写具体数值。
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
