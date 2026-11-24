import React, { useEffect, useRef, useState } from "react";
import { api, numberExpr, Obj } from "../api";
import { Expr, formatWhereTex, formula, MathView, notation } from "../math";

function splitConstraintText(
  raw: string,
): { lhs: string; sense: "le" | "eq" | "ge"; rhs: string } | null {
  // Match <=, >=, or single =
  const match = raw.match(/^(.+?)(<=|>=|=)(.+)$/);
  if (!match) return null;
  const [, lhs, op, rhs] = match;
  if (rhs.includes("<=") || rhs.includes(">=") || rhs.includes("=")) {
    return null;
  }
  const sense = op === "<=" ? "le" : op === ">=" ? "ge" : "eq";
  return { lhs: lhs.trim(), sense, rhs: rhs.trim() };
}

function SymbolQuickBar({
  model,
  onInsert,
  disabled,
}: {
  model: Obj;
  onInsert: (snippet: string) => void;
  disabled: boolean;
}) {
  const vars = model.variables || [];
  const params = model.parameters || [];
  const sets = model.sets || [];

  return (
    <div className="quick-insert-bar">
      <span className="quick-label">快捷插入：</span>
      {vars.map((v: Obj) => (
        <button
          type="button"
          key={"v_" + v.id}
          disabled={disabled}
          className="quick-chip quick-var"
          onClick={() =>
            onInsert(
              v.sets?.length
                ? `${v.id}[${v.sets.map((s: string) => s.toLowerCase()).join(", ")}]`
                : v.id,
            )
          }
        >
          {v.id}
        </button>
      ))}
      {params.map((p: Obj) => (
        <button
          type="button"
          key={"p_" + p.id}
          disabled={disabled}
          className="quick-chip quick-param"
          onClick={() =>
            onInsert(
              p.sets?.length
                ? `${p.id}[${p.sets.map((s: string) => s.toLowerCase()).join(", ")}]`
                : p.id,
            )
          }
        >
          {p.id}
        </button>
      ))}
      {sets.length > 0 && (
        <button
          type="button"
          disabled={disabled}
          className="quick-chip quick-sum"
          onClick={() => {
            const s = sets[0].id;
            const idx = s.toLowerCase().slice(0, 1) || "i";
            onInsert(`sum(${idx}, ${s}, )`);
          }}
        >
          ∑ 求和 sum(...)
        </button>
      )}
    </div>
  );
}

export function ObjectiveEditor({
  model,
  editable,
  onChangeObjective,
  onError,
}: {
  model: Obj;
  editable: boolean;
  onChangeObjective: (nextObj: Obj) => void;
  onError: (msg: string) => void;
}) {
  const obj = model.objective;
  const [text, setText] = useState(notation(obj.expr));
  const [parseErr, setParseErr] = useState("");
  const [parsing, setParsing] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setText(notation(obj.expr));
    setParseErr("");
  }, [JSON.stringify(obj.expr)]);

  const parseAndApply = async (rawText: string) => {
    setParsing(true);
    setParseErr("");
    try {
      const r = await api("/parse", { text: rawText, model });
      onChangeObjective({ ...obj, expr: r.expr });
    } catch (e) {
      setParseErr((e as Error).message);
    } finally {
      setParsing(false);
    }
  };

  const insertSnippet = (snippet: string) => {
    const el = inputRef.current;
    if (!el) {
      setText(text + snippet);
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + snippet + text.slice(end);
    setText(next);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + snippet.length, start + snippet.length);
    }, 0);
  };

  return (
    <div className="section-stack">
      <div className="section-toolbar">
        <div>
          <h3 className="section-title">目标函数 (Objective)</h3>
          <p className="section-desc">
            选择优化方向并输入目标表达式。支持四则运算与 sum(i, I, 表达式)。
          </p>
        </div>
        <div className="segmented-control">
          <button
            type="button"
            disabled={!editable}
            className={obj.sense === "min" ? "active" : ""}
            onClick={() => onChangeObjective({ ...obj, sense: "min" })}
          >
            最小化 (min)
          </button>
          <button
            type="button"
            disabled={!editable}
            className={obj.sense === "max" ? "active" : ""}
            onClick={() => onChangeObjective({ ...obj, sense: "max" })}
          >
            最大化 (max)
          </button>
        </div>
      </div>

      <div className="item-card">
        <div className="formula-preview-box">
          <MathView
            displayMode
            tex={`\\${obj.sense}\\quad ${formula(obj.expr, model)}`}
          />
        </div>

        <SymbolQuickBar
          model={model}
          disabled={!editable}
          onInsert={insertSnippet}
        />

        <div className="expression-input-wrap">
          <textarea
            ref={inputRef}
            aria-label="目标表达式"
            className="input-mono formula-textarea"
            rows={2}
            disabled={!editable}
            value={text}
            placeholder="例如：3*x + 5*y 或 sum(i, I, c[i]*x[i])"
            onChange={(e) => {
              setText(e.target.value);
              setParseErr("");
            }}
          />
          <div className="formula-actions">
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={!editable || parsing}
              onClick={() => parseAndApply(text)}
            >
              {parsing ? "解析中…" : "解析并更新公式"}
            </button>
            <span className="muted">
              当前语法提示：乘法用 *，索引如 x[i, j]
            </span>
          </div>
          {parseErr && <p className="inline-hint error">{parseErr}</p>}
        </div>
      </div>
    </div>
  );
}

export function ConstraintEditor({
  model,
  editable,
  onChangeConstraints,
}: {
  model: Obj;
  editable: boolean;
  onChangeConstraints: (nextConstraints: Obj[]) => void;
}) {
  const constraints: Obj[] = model.constraints || [];
  const sets: Obj[] = model.sets || [];
  const [expandedSet, setExpandedSet] = useState<Set<number>>(() =>
    constraints.length <= 2
      ? new Set(constraints.map((_, i) => i))
      : new Set([0]),
  );
  const [focusIdx, setFocusIdx] = useState<number | null>(null);

  const updateConstraint = (idx: number, nextC: Obj) => {
    const next = [...constraints];
    next[idx] = nextC;
    onChangeConstraints(next);
  };

  const toggleExpand = (idx: number) => {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const addConstraint = () => {
    const nextIdx = constraints.length;
    onChangeConstraints([
      ...constraints,
      {
        id: "c" + (nextIdx + 1),
        for_each: [],
        lhs: numberExpr(0),
        sense: "le",
        rhs: numberExpr(0),
      },
    ]);
    setExpandedSet(new Set([nextIdx]));
    setFocusIdx(nextIdx);
  };

  const allExpanded =
    constraints.length > 0 && expandedSet.size === constraints.length;

  return (
    <div className="section-stack">
      <div className="section-toolbar">
        <div>
          <h3 className="section-title">约束条件 (Constraints)</h3>
          <p className="section-desc">
            点击某条约束即可展开编辑；直接输入完整不等式或等式（如 sum(j, J, x[i, j]) &lt;= cap[i]）。
          </p>
        </div>
        <div className="inline-actions" style={{ marginTop: 0 }}>
          {constraints.length > 1 && (
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() =>
                setExpandedSet(
                  allExpanded
                    ? new Set()
                    : new Set(constraints.map((_, i) => i)),
                )
              }
            >
              {allExpanded ? "全部收起" : "全部展开"}
            </button>
          )}
          <button
            className="btn-secondary"
            disabled={!editable}
            onClick={addConstraint}
          >
            ＋ 添加约束
          </button>
        </div>
      </div>

      {constraints.length === 0 ? (
        <div className="empty-card">暂无约束条件，点击右上角添加。</div>
      ) : (
        <div className="item-list">
          {constraints.map((c, i) => (
            <ConstraintCard
              key={i}
              c={c}
              index={i}
              model={model}
              sets={sets}
              editable={editable}
              expanded={expandedSet.has(i)}
              autoFocus={focusIdx === i}
              onFocusDone={() => setFocusIdx(null)}
              onToggle={() => toggleExpand(i)}
              onChange={(nextC) => updateConstraint(i, nextC)}
              onDelete={() => {
                onChangeConstraints(constraints.filter((_, j) => j !== i));
                setExpandedSet((prev) => {
                  const next = new Set<number>();
                  prev.forEach((v) => {
                    if (v < i) next.add(v);
                    else if (v > i) next.add(v - 1);
                  });
                  return next;
                });
              }}
            />
          ))}
        </div>
      )}

      {constraints.length > 2 && editable && (
        <div className="add-bottom-bar">
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={addConstraint}
          >
            ＋ 添加新约束
          </button>
        </div>
      )}
    </div>
  );
}

function ConstraintCard({
  c,
  index,
  model,
  sets,
  editable,
  expanded,
  autoFocus,
  onFocusDone,
  onToggle,
  onChange,
  onDelete,
}: {
  c: Obj;
  index: number;
  model: Obj;
  sets: Obj[];
  editable: boolean;
  expanded: boolean;
  autoFocus: boolean;
  onFocusDone: () => void;
  onToggle: () => void;
  onChange: (nextC: Obj) => void;
  onDelete: () => void;
}) {
  const opStr = c.sense === "le" ? "<=" : c.sense === "ge" ? ">=" : "=";
  const combinedText = `${notation(c.lhs)} ${opStr} ${notation(c.rhs)}`;
  const [text, setText] = useState(combinedText);
  const [parseErr, setParseErr] = useState("");
  const [parsing, setParsing] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setText(`${notation(c.lhs)} ${opStr} ${notation(c.rhs)}`);
    setParseErr("");
  }, [JSON.stringify(c.lhs), c.sense, JSON.stringify(c.rhs)]);

  useEffect(() => {
    if (expanded && autoFocus && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
      onFocusDone();
    }
  }, [expanded, autoFocus]);

  const parseAndApply = async () => {
    const parts = splitConstraintText(text);
    if (!parts) {
      setParseErr("请包含唯一的关系符：<=、= 或 >=");
      return;
    }
    setParsing(true);
    setParseErr("");
    try {
      const [lRes, rRes] = await Promise.all([
        api("/parse", { text: parts.lhs, model }),
        api("/parse", { text: parts.rhs, model }),
      ]);
      onChange({
        ...c,
        lhs: lRes.expr,
        sense: parts.sense,
        rhs: rRes.expr,
      });
    } catch (e) {
      setParseErr((e as Error).message);
    } finally {
      setParsing(false);
    }
  };

  const insertSnippet = (snippet: string) => {
    const el = inputRef.current;
    if (!el) {
      setText(text + snippet);
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + snippet + text.slice(end);
    setText(next);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + snippet.length, start + snippet.length);
    }, 0);
  };

  const quantifiers: Obj[] = c.for_each || [];
  const opTex = ({ le: "\\leq", eq: "=", ge: "\\geq" }[c.sense as string]) || "=";
  const esc = (s: string) =>
    String(s).replace(/[\\{}_$%&#^~]/g, (x) => `\\${x}`);
  const whereTex = c.where?.trim() ? ` \\mid ${formatWhereTex(c.where)}` : "";
  const quantTex = quantifiers.length
    ? `\\quad \\forall ${quantifiers
        .map((q) => {
          const sub = q.set_index
            ? `_{${esc(q.set_index.kind === "index" ? q.set_index.name : String(q.set_index.value))}}`
            : "";
          return `${esc(q.index)} \\in \\mathrm{${esc(q.set)}}${sub}`;
        })
        .join(",\\, ")}${whereTex}`
    : "";

  if (!expanded) {
    return (
      <div className="constraint-compact-row" onClick={onToggle}>
        <span className="constraint-tag">{c.id}</span>
        <div className="constraint-compact-math">
          <MathView
            tex={`${formula(c.lhs, model)} ${opTex} ${formula(c.rhs, model)}${quantTex}`}
          />
        </div>
        <div
          className="constraint-compact-actions"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={onToggle}
          >
            编辑
          </button>
          <button
            type="button"
            className="btn-ghost-danger btn-sm"
            disabled={!editable}
            onClick={onDelete}
          >
            删除
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="item-card">
      <div className="item-card-header">
        <div className="field-inline">
          <label className="compact-label">约束名称</label>
          <input
            aria-label={"约束 " + index + " 编号"}
            className="input-mono input-sm"
            disabled={!editable}
            value={c.id}
            onChange={(e) => onChange({ ...c, id: e.target.value })}
          />
        </div>
        <div className="quantifier-bar">
          <span className="compact-label">适用范围 ∀：</span>
          {quantifiers.map((q, qIdx) => (
            <span className="token-chip" key={qIdx}>
              <input
                aria-label={`约束 ${index} 量词 ${qIdx} 索引名`}
                className="quant-index-input"
                style={{
                  width: `${Math.max(2.5, (q.index || "").length + 1.2)}ch`,
                }}
                disabled={!editable}
                value={q.index}
                onChange={(e) => {
                  const next = [...quantifiers];
                  next[qIdx] = { ...q, index: e.target.value };
                  onChange({ ...c, for_each: next });
                }}
              />
              <span>
                ∈ {q.set}
                {q.set_index
                  ? `[${q.set_index.kind === "index" ? q.set_index.name : JSON.stringify(q.set_index.value)}]`
                  : ""}
              </span>
              {editable && (
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...c,
                      for_each: quantifiers.filter((_, k) => k !== qIdx),
                    })
                  }
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {editable && sets.length > 0 && (
            <select
              aria-label={"约束 " + index + " 添加量词"}
              className="select-xs"
              value=""
              onChange={(e) => {
                const sname = e.target.value;
                if (!sname) return;
                const setObj = sets.find((x) => x.id === sname);
                const defaultIdx = sname.toLowerCase().slice(0, 1) || "i";
                const used = new Set(quantifiers.map((x) => x.index));
                let idxName = defaultIdx;
                let n = 1;
                while (used.has(idxName)) {
                  idxName = defaultIdx + n++;
                }
                let set_index: Obj | undefined = undefined;
                if (setObj?.index_set) {
                  const parentQuant = quantifiers.find(
                    (q) => q.set === setObj.index_set,
                  );
                  set_index = {
                    kind: "index",
                    name:
                      parentQuant?.index ||
                      setObj.index_set.toLowerCase().slice(0, 1) ||
                      "j",
                  };
                }
                onChange({
                  ...c,
                  for_each: [
                    ...quantifiers,
                    set_index
                      ? { index: idxName, set: sname, set_index }
                      : { index: idxName, set: sname },
                  ],
                });
              }}
            >
              <option value="">＋ 添加集合范围</option>
              {sets.map((s) => (
                <option key={s.id} value={s.id}>
                  ∀ {s.id.toLowerCase().slice(0, 1)} ∈ {s.id}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="item-actions">
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={onToggle}
          >
            收起
          </button>
          <button
            type="button"
            className="btn-ghost-danger btn-sm"
            disabled={!editable}
            onClick={onDelete}
          >
            删除
          </button>
        </div>
      </div>

      {(quantifiers.length > 0 || (c.where && c.where.trim())) && (
        <div className="where-row">
          <label className="compact-label" htmlFor={`where-${index}`}>
            条件筛选 (where)
          </label>
          <input
            id={`where-${index}`}
            aria-label={`约束 ${index} 条件筛选`}
            className="input-mono input-sm"
            style={{ flex: 1, width: "auto" }}
            disabled={!editable}
            value={c.where || ""}
            placeholder="可选，如：i != j、t > 1、a[i, j] > 0"
            onChange={(e) => onChange({ ...c, where: e.target.value })}
          />
        </div>
      )}

      <div className="formula-preview-box">
        <MathView
          tex={`${formula(c.lhs, model)} ${opTex} ${formula(c.rhs, model)}${quantTex}`}
        />
      </div>

      <SymbolQuickBar
        model={model}
        disabled={!editable}
        onInsert={insertSnippet}
      />

      <div className="expression-input-wrap">
        <textarea
          ref={inputRef}
          aria-label={`约束 ${c.id} 表达式`}
          className="input-mono formula-textarea"
          rows={2}
          disabled={!editable}
          value={text}
          placeholder="例如：sum(j, J, x[i, j]) <= cap[i]"
          onChange={(e) => {
            setText(e.target.value);
            setParseErr("");
          }}
        />
        <div className="formula-actions">
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={!editable || parsing}
            onClick={parseAndApply}
          >
            {parsing ? "解析中…" : "解析并更新约束"}
          </button>
          <span className="muted">
            直接输入完整不等式或等式，如 2*x + y &lt;= 10
          </span>
        </div>
        {parseErr && <p className="inline-hint error">{parseErr}</p>}
      </div>
    </div>
  );
}
