import React, { useState } from "react";
import { Obj } from "../api";
import { formatWhereTex, formula, MathView } from "../math";

const escTex = (s: string) =>
  String(s).replace(/[\\{}_$%&#^~]/g, (x) => `\\${x}`);

const texIdent = (s: string) => `\\mathrm{${escTex(s)}}`;

export function ModelPreview({
  model,
  data,
  onJumpSection,
}: {
  model: Obj;
  data?: Obj;
  onJumpSection?: (section: number) => void;
}) {
  const [showParamsDetail, setShowParamsDetail] = useState(false);

  const senseTex = model.objective?.sense === "max" ? "\\max" : "\\min";
  const domainLabel = (d: string) =>
    d === "binary" ? "\\in \\{0, 1\\}" : d === "integer" ? "\\in \\mathbb{Z}" : "\\in \\mathbb{R}";

  const formatBound = (v: Obj) => {
    if (v.domain === "binary") return "";
    const lo = v.lower;
    const hi = v.upper;
    if (lo === null && hi === null) return "";
    const symTex = texIdent(v.symbol || v.id);
    const idxTex = v.sets?.length
      ? `_{${v.sets.map((s: string) => escTex(s)).join(",")}}`
      : "";
    const varTex = `${symTex}${idxTex}`;
    if (lo === undefined || hi === undefined) {
      const loStr = lo === undefined ? "?" : lo === null ? "-\\infty" : lo;
      const hiStr = hi === undefined ? "?" : hi === null ? "+\\infty" : hi;
      return `,\\; ${loStr} \\le ${varTex} \\le ${hiStr}`;
    }
    if (lo !== null && hi === null) return `,\\; ${varTex} \\ge ${lo}`;
    if (lo === null && hi !== null) return `,\\; ${varTex} \\le ${hi}`;
    return `,\\; ${lo} \\le ${varTex} \\le ${hi}`;
  };

  return (
    <div className="math-paper">
      <div
        className={`paper-block ${onJumpSection ? "clickable" : ""}`}
        onClick={() => onJumpSection?.(0)}
      >
        <div className="paper-label">集合 (Sets)</div>
        {(model.sets || []).length === 0 ? (
          <div className="paper-empty">无索引集合（标量模型）</div>
        ) : (
          <div className="paper-lines">
            {(model.sets || []).map((s: Obj) => (
              <div key={s.id} className="paper-line">
                {s.index_set ? (
                  <>
                    {(s.indexed_members || []).map((entry: Obj, eIdx: number) => (
                      <MathView
                        key={eIdx}
                        tex={`${texIdent(s.id)}_{${escTex(String(entry.index))}} = \\{${(entry.members || []).map((m: any) => texIdent(String(m))).join(",\\, ")}\\}`}
                      />
                    ))}
                  </>
                ) : (
                  <MathView
                    tex={`${texIdent(s.id)} = \\{${(s.members || []).map((m: any) => texIdent(String(m))).join(",\\, ")}\\}`}
                  />
                )}
                {s.description && (
                  <div className="paper-note">{s.description}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div
        className={`paper-block ${onJumpSection ? "clickable" : ""}`}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          onJumpSection?.(1);
        }}
      >
        <div className="paper-header-row">
          <div className="paper-label">参数 (Parameters)</div>
          {(model.parameters || []).length > 0 && (
            <button
              type="button"
              className="btn-link"
              onClick={() => setShowParamsDetail(!showParamsDetail)}
            >
              {showParamsDetail ? "收起数值" : "展开数值"}
            </button>
          )}
        </div>
        {(model.parameters || []).length === 0 ? (
          <div className="paper-empty">无参数</div>
        ) : (
          <div className="paper-lines">
            {(model.parameters || []).map((p: Obj) => {
              const count = p.sets?.length
                ? p.data_key
                  ? (data?.[p.data_key] || []).length
                  : (p.entries || []).length
                : 1;
              const displaySym = p.symbol || p.id;
              const symTex = `${texIdent(displaySym)}${p.sets?.length ? `_{${p.sets.map((s: string) => escTex(s)).join(",")}}` : ""}`;
              const hasAlias = p.symbol && p.symbol !== p.id;
              return (
                <div key={p.id} className="paper-param-item">
                  <span className="paper-param-main">
                    <span className="paper-param-sym">
                      <MathView tex={symTex} />
                    </span>
                    {hasAlias && (
                      <code className="muted" style={{ fontSize: 11.5 }}>
                        ({p.id})
                      </code>
                    )}
                    {p.description && (
                      <span className="paper-inline-note">
                        — {p.description}
                      </span>
                    )}
                  </span>
                  <span className="muted">
                    {p.sets?.length
                      ? `${count} 项${p.data_key ? ` (来自 ${p.data_key})` : ""}`
                      : `= ${p.value ?? "未填"}`}
                  </span>
                  {showParamsDetail && p.sets?.length > 0 && (
                    <div className="paper-param-detail">
                      {(p.data_key ? data?.[p.data_key] || [] : p.entries || [])
                        .slice(0, 12)
                        .map((entry: Obj, idx: number) => (
                          <span key={idx} className="mini-tag">
                            ({entry.indices.join(",")}): {entry.value}
                          </span>
                        ))}
                      {count > 12 && (
                        <span className="muted">…共 {count} 项</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div
        className={`paper-block ${onJumpSection ? "clickable" : ""}`}
        onClick={() => onJumpSection?.(2)}
      >
        <div className="paper-label">决策变量 (Variables)</div>
        {(model.variables || []).length === 0 ? (
          <div className="paper-empty">尚未定义变量</div>
        ) : (
          <div className="paper-lines">
            {(model.variables || []).map((v: Obj) => {
              const symTex = texIdent(v.symbol || v.id);
              const idxPart = v.sets?.length
                ? `_{${v.sets.map((s: string) => escTex(s)).join(",")}}`
                : "";
              const quantPart = v.sets?.length
                ? `\\quad \\forall (${v.sets.map((s: string) => texIdent(s)).join(",")}) \\in ${v.sets.map((s: string) => texIdent(s)).join(" \\times ")}`
                : "";
              return (
                <div key={v.id} className="paper-line">
                  <MathView
                    tex={`${symTex}${idxPart} ${domainLabel(v.domain)}${formatBound(v)}${quantPart}`}
                  />
                  {v.description && (
                    <div className="paper-note">{v.description}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div
        className={`paper-block ${onJumpSection ? "clickable" : ""}`}
        onClick={() => onJumpSection?.(3)}
      >
        <div className="paper-label">目标函数 (Objective)</div>
        <MathView
          displayMode
          tex={`${senseTex}\\quad ${formula(model.objective?.expr, model)}`}
        />
        {model.objective?.description && (
          <div className="paper-note" style={{ textAlign: "center" }}>
            {model.objective.description}
          </div>
        )}
      </div>

      <div
        className={`paper-block ${onJumpSection ? "clickable" : ""}`}
        onClick={() => onJumpSection?.(4)}
      >
        <div className="paper-label">约束条件 (Subject to)</div>
        {(model.constraints || []).length === 0 ? (
          <div className="paper-empty">暂无约束</div>
        ) : (
          <div className="paper-constraints">
            {(model.constraints || []).map((c: Obj) => {
              const op =
                ({ le: "\\leq", eq: "=", ge: "\\geq" }[c.sense as string]) ||
                "=";
              const whereTex = c.where?.trim()
                ? ` \\mid ${formatWhereTex(c.where)}`
                : "";
              const quant = (c.for_each || []).length
                ? `\\quad \\forall ${c.for_each
                    .map((q: Obj) => {
                      const sub = q.set_index
                        ? `_{${escTex(q.set_index.kind === "index" ? q.set_index.name : String(q.set_index.value))}}`
                        : "";
                      return `${texIdent(q.index)} \\in ${texIdent(q.set)}${sub}`;
                    })
                    .join(",\\, ")}${whereTex}`
                : "";
              return (
                <div key={c.id} className="paper-constraint-block">
                  <div className="paper-constraint-row">
                    <span className="constraint-tag">{c.id}</span>
                    <MathView
                      tex={`${formula(c.lhs, model)} ${op} ${formula(c.rhs, model)}${quant}`}
                    />
                  </div>
                  {c.description && (
                    <div className="paper-note paper-constraint-note">
                      {c.description}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
