import React, { useState } from "react";
import { Obj } from "../api";

function entryKey(indices: (string | number)[]): string {
  return JSON.stringify(indices);
}

function parseCellValue(raw: string): number | null {
  const s = raw.trim();
  if (s === "" || s === "-" || s.toLowerCase() === "null") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function splitPasteLine(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((c) => c.trim());
  if (line.includes(",")) return line.split(",").map((c) => c.trim());
  return line.trim().split(/\s+/);
}

export function ParameterEditor({
  parameters,
  sets,
  data,
  editable,
  onChangeParams,
  onChangeData,
}: {
  parameters: Obj[];
  sets: Obj[];
  data: Obj;
  editable: boolean;
  onChangeParams: (nextParams: Obj[]) => void;
  onChangeData: (nextData: Obj) => void;
}) {
  const [pasteIdx, setPasteIdx] = useState<number | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [hasHeader, setHasHeader] = useState(false);
  const [showAdv, setShowAdv] = useState<Record<number, boolean>>({});

  const setMap: Record<string, (string | number)[]> = {};
  for (const s of sets) {
    if (s.id) setMap[s.id] = s.members || [];
  }
  const setNames = Object.keys(setMap);

  const updateParam = (idx: number, patch: Obj) => {
    const next = [...parameters];
    next[idx] = { ...next[idx], ...patch };
    onChangeParams(next);
  };

  const getEntries = (p: Obj): Obj[] => {
    if (p.data_key) return Array.isArray(data?.[p.data_key]) ? data[p.data_key] : [];
    return Array.isArray(p.entries) ? p.entries : [];
  };

  const setEntries = (idx: number, entries: Obj[]) => {
    const p = parameters[idx];
    if (p.data_key) {
      onChangeData({ ...data, [p.data_key]: entries });
    } else {
      updateParam(idx, { entries });
    }
  };

  const setCellValue = (
    idx: number,
    indices: (string | number)[],
    raw: string,
  ) => {
    const p = parameters[idx];
    const list = [...getEntries(p)];
    const k = entryKey(indices);
    const existingIdx = list.findIndex((e) => entryKey(e.indices) === k);
    const trimmed = raw.trim();
    if (trimmed === "") {
      if (existingIdx >= 0) {
        list.splice(existingIdx, 1);
        setEntries(idx, list);
      }
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return;
    if (existingIdx >= 0) {
      list[existingIdx] = { indices, value: n };
    } else {
      list.push({ indices, value: n });
    }
    setEntries(idx, list);
  };

  const toggleIndexSet = (idx: number, setName: string) => {
    const p = parameters[idx];
    const current = p.sets || [];
    const nextSets = current.includes(setName)
      ? current.filter((x: string) => x !== setName)
      : [...current, setName];
    updateParam(idx, { sets: nextSets });
  };

  const parsePastedGrid = (p: Obj) => {
    const dims = p.sets || [];
    const lines = pasteText
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter((l) => l.trim().length > 0);
    if (lines.length === 0) return { entries: [], warnings: ["没有检测到数据行"] };

    const grid = lines.map(splitPasteLine);
    const warnings: string[] = [];
    const entries: Obj[] = [];

    if (dims.length === 1) {
      const members = setMap[dims[0]] || [];
      if (hasHeader) {
        // 2 columns: [member, value] or header row
        grid.forEach((row, rIdx) => {
          if (rIdx === 0 && parseCellValue(row[1] ?? "") === null) return;
          const m = members.find((x) => String(x) === String(row[0]));
          const val = parseCellValue(row[1] ?? "");
          if (m !== undefined && val !== null) {
            entries.push({ indices: [m], value: val });
          }
        });
      } else {
        // Single column or single row of numbers
        const flat =
          grid.length === 1 && grid[0].length > 1
            ? grid[0]
            : grid.map((r) => r[0]);
        members.forEach((m, i) => {
          const val = parseCellValue(flat[i] ?? "");
          if (val !== null) entries.push({ indices: [m], value: val });
        });
        if (flat.length !== members.length) {
          warnings.push(
            `粘贴了 ${flat.length} 个值，集合 ${dims[0]} 有 ${members.length} 个成员；将按顺序对齐，空值保留为缺失。`,
          );
        }
      }
    } else if (dims.length === 2) {
      const rows = setMap[dims[0]] || [];
      const cols = setMap[dims[1]] || [];
      if (hasHeader) {
        const colHeaders = grid[0].slice(1);
        const colTargets = colHeaders.map((h) =>
          cols.find((c) => String(c) === String(h)),
        );
        for (let r = 1; r < grid.length; r++) {
          const rowName = grid[r][0];
          const rowMember = rows.find((x) => String(x) === String(rowName));
          if (rowMember === undefined) {
            warnings.push(`第 ${r + 1} 行标签 "${rowName}" 不在集合 ${dims[0]} 中，已跳过`);
            continue;
          }
          for (let c = 1; c < grid[r].length; c++) {
            const colMember = colTargets[c - 1];
            if (colMember === undefined) continue;
            const val = parseCellValue(grid[r][c] ?? "");
            if (val !== null) {
              entries.push({ indices: [rowMember, colMember], value: val });
            }
          }
        }
      } else {
        rows.forEach((rMem, rIdx) => {
          const rowCells = grid[rIdx] || [];
          cols.forEach((cMem, cIdx) => {
            const val = parseCellValue(rowCells[cIdx] ?? "");
            if (val !== null) {
              entries.push({ indices: [rMem, cMem], value: val });
            }
          });
        });
        if (grid.length !== rows.length) {
          warnings.push(
            `粘贴了 ${grid.length} 行，集合 ${dims[0]} 有 ${rows.length} 个成员。`,
          );
        }
      }
    }
    return { entries, warnings };
  };

  return (
    <div className="section-stack">
      <div className="section-toolbar">
        <div>
          <h3 className="section-title">模型参数 (Parameters)</h3>
          <p className="section-desc">
            先选择参数关联的集合：无集合为标量，1 个集合自动生成向量表，2 个集合自动生成矩阵表，支持从 Excel 直接复制粘贴。
          </p>
        </div>
        <button
          className="btn-secondary"
          disabled={!editable}
          onClick={() =>
            onChangeParams([
              ...parameters,
              {
                id: "p" + (parameters.length ? parameters.length + 1 : ""),
                sets: [],
                value: 0,
              },
            ])
          }
        >
          ＋ 添加参数
        </button>
      </div>

      {parameters.length === 0 ? (
        <div className="empty-card">
          暂无参数。若公式中所有系数都直接写死为数字，可以不添加参数。
        </div>
      ) : (
        <div className="item-list">
          {parameters.map((p, i) => {
            const dims: string[] = p.sets || [];
            const entries = getEntries(p);
            const lookup = new Map<string, number>();
            entries.forEach((e) => lookup.set(entryKey(e.indices), e.value));

            const rowMembers = dims[0] ? setMap[dims[0]] || [] : [];
            const colMembers = dims[1] ? setMap[dims[1]] || [] : [];
            const expectedCount =
              dims.length === 0
                ? 1
                : dims.reduce((acc, d) => acc * (setMap[d]?.length || 0), 1);
            const missingCount =
              dims.length > 0 && p.default == null
                ? Math.max(0, expectedCount - entries.length)
                : 0;

            const previewPaste =
              pasteIdx === i ? parsePastedGrid(p) : { entries: [], warnings: [] };

            return (
              <div className="item-card" key={i}>
                <div className="item-card-header">
                  <div className="field-inline">
                    <label className="compact-label">参数名</label>
                    <input
                      aria-label={`参数 ${i} 名称`}
                      className="input-mono input-sm"
                      disabled={!editable}
                      value={p.id}
                      onChange={(e) => updateParam(i, { id: e.target.value })}
                    />
                  </div>
                  <div className="index-selector">
                    <span className="compact-label">索引维度：</span>
                    {setNames.length > 0 && (
                      <div className="chip-group">
                        {setNames.map((sname) => {
                          const active = dims.includes(sname);
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
                    )}
                    <input
                      aria-label={`参数 ${i} 索引集合`}
                      className="input-mono input-xs"
                      disabled={!editable}
                      value={dims.join(",")}
                      placeholder="标量留空，或输入 I,J"
                      onChange={(e) =>
                        updateParam(i, {
                          sets: e.target.value
                            ? e.target.value.split(",").map((s) => s.trim())
                            : [],
                        })
                      }
                    />
                  </div>
                  <div className="item-actions">
                    {(dims.length === 1 || dims.length === 2) && (
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={!editable}
                        onClick={() => {
                          if (pasteIdx === i) setPasteIdx(null);
                          else {
                            setPasteIdx(i);
                            setPasteText("");
                          }
                        }}
                      >
                        {pasteIdx === i ? "收起粘贴" : "从表格/Excel 粘贴"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() =>
                        setShowAdv({ ...showAdv, [i]: !showAdv[i] })
                      }
                    >
                      {showAdv[i] ? "收起高级" : "高级"}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost-danger btn-sm"
                      disabled={!editable}
                      onClick={() =>
                        onChangeParams(parameters.filter((_, j) => j !== i))
                      }
                    >
                      删除
                    </button>
                  </div>
                </div>

                {/* 0D Scalar */}
                {dims.length === 0 && (
                  <div className="scalar-row">
                    <label className="compact-label">标量数值</label>
                    <input
                      type="number"
                      className="input-sm input-mono"
                      disabled={!editable}
                      value={p.value ?? ""}
                      placeholder="请输入数值"
                      onChange={(e) =>
                        updateParam(i, {
                          value:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        })
                      }
                    />
                  </div>
                )}

                {/* 1D Vector Table */}
                {dims.length === 1 && (
                  <div className="param-grid-wrap">
                    {rowMembers.length === 0 ? (
                      <p className="inline-hint warn">
                        集合 {dims[0]} 尚未定义成员，请先在“集合”中添加成员。
                      </p>
                    ) : (
                      <table className="data-grid-table">
                        <thead>
                          <tr>
                            <th>{dims[0]}</th>
                            <th>{p.id} 数值</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rowMembers.map((m) => {
                            const val = lookup.get(entryKey([m]));
                            return (
                              <tr key={String(m)}>
                                <td className="row-header-cell">{String(m)}</td>
                                <td>
                                  <input
                                    type="number"
                                    className="cell-input"
                                    disabled={!editable}
                                    placeholder={
                                      p.default != null
                                        ? `默认 ${p.default}`
                                        : "缺失"
                                    }
                                    value={val ?? ""}
                                    onChange={(e) =>
                                      setCellValue(i, [m], e.target.value)
                                    }
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

                {/* 2D Matrix Table */}
                {dims.length === 2 && (
                  <div className="param-grid-wrap">
                    {rowMembers.length === 0 || colMembers.length === 0 ? (
                      <p className="inline-hint warn">
                        请先确保集合 {dims[0]} 与 {dims[1]} 均已添加成员。
                      </p>
                    ) : (
                      <div className="table-scroll">
                        <table className="data-grid-table matrix-table">
                          <thead>
                            <tr>
                              <th>
                                {dims[0]} \ {dims[1]}
                              </th>
                              {colMembers.map((c) => (
                                <th key={String(c)}>{String(c)}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {rowMembers.map((r) => (
                              <tr key={String(r)}>
                                <td className="row-header-cell">{String(r)}</td>
                                {colMembers.map((c) => {
                                  const val = lookup.get(entryKey([r, c]));
                                  return (
                                    <td key={String(c)}>
                                      <input
                                        type="number"
                                        className="cell-input"
                                        disabled={!editable}
                                        placeholder={
                                          p.default != null
                                            ? String(p.default)
                                            : "—"
                                        }
                                        value={val ?? ""}
                                        onChange={(e) =>
                                          setCellValue(
                                            i,
                                            [r, c],
                                            e.target.value,
                                          )
                                        }
                                      />
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* 3D+ High-dimensional List */}
                {dims.length >= 3 && (
                  <div className="param-grid-wrap">
                    <p className="inline-hint">
                      高维参数（{dims.length} 维）共 {entries.length} 条记录，可在下方查看或通过 JSON 批量编辑。
                    </p>
                    <table className="data-grid-table">
                      <thead>
                        <tr>
                          {dims.map((d) => (
                            <th key={d}>{d}</th>
                          ))}
                          <th>数值</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entries.slice(0, 30).map((e, eIdx) => (
                          <tr key={eIdx}>
                            {e.indices.map((idxVal: any, k: number) => (
                              <td key={k}>{String(idxVal)}</td>
                            ))}
                            <td>{e.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {missingCount > 0 && (
                  <p className="inline-hint warn">
                    当前还有 {missingCount} 个条目未填值（系统不会自动补零；若稀疏矩阵其余项为 0，可在“高级”中设置缺失默认值）。
                  </p>
                )}

                {/* Paste Drawer */}
                {pasteIdx === i && (
                  <div className="paste-drawer">
                    <div className="paste-header">
                      <label className="compact-label">
                        从 Excel / CSV 直接粘贴数值（支持 Tab、逗号或空格分隔）
                      </label>
                      <label className="check-inline">
                        <input
                          type="checkbox"
                          checked={hasHeader}
                          onChange={(e) => setHasHeader(e.target.checked)}
                        />
                        首行/首列包含集合成员名称
                      </label>
                    </div>
                    <textarea
                      rows={5}
                      className="input-mono"
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      placeholder={
                        dims.length === 2
                          ? "例如：\n10\t20\t30\n15\t25\t35"
                          : "例如：\n10\n20\n30"
                      }
                    />
                    {previewPaste.warnings.map((w, wIdx) => (
                      <p key={wIdx} className="inline-hint warn">
                        {w}
                      </p>
                    ))}
                    <div className="drawer-actions">
                      <span className="muted">
                        已识别 {previewPaste.entries.length} 个有效数值
                      </span>
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        disabled={previewPaste.entries.length === 0}
                        onClick={() => {
                          setEntries(i, previewPaste.entries);
                          setPasteIdx(null);
                          setPasteText("");
                        }}
                      >
                        应用到参数表
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => setPasteIdx(null)}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}

                {/* Advanced Settings */}
                {showAdv[i] && (
                  <div className="adv-drawer">
                    <div className="adv-grid">
                      <label>
                        显示符号
                        <input
                          disabled={!editable}
                          value={p.symbol || ""}
                          placeholder="如 c"
                          onChange={(e) =>
                            updateParam(i, { symbol: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        缺失项默认值（留空表示不默认补零）
                        <input
                          type="number"
                          disabled={!editable}
                          value={p.default ?? ""}
                          placeholder="留空"
                          onChange={(e) =>
                            updateParam(i, {
                              default:
                                e.target.value === ""
                                  ? null
                                  : Number(e.target.value),
                            })
                          }
                        />
                      </label>
                      <label>
                        绑定外部数据键 (data_key)
                        <input
                          className="input-mono"
                          disabled={!editable}
                          value={p.data_key || ""}
                          placeholder="可选，留空则直接内联"
                          onChange={(e) =>
                            updateParam(i, {
                              data_key: e.target.value || null,
                            })
                          }
                        />
                      </label>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
