import React, { useState } from "react";
import { Obj } from "../api";

function parseMemberToken(raw: string): string | number {
  const s = raw.trim();
  if (/^-?\d+$/.test(s)) return Number(s);
  return s;
}

function expandRange(expr: string): (string | number)[] | null {
  const m = expr.trim().match(/^([A-Za-z_]*)(-?\d+)\.\.\1?(-?\d+)$/);
  if (!m) return null;
  const [, prefix, startStr, endStr] = m;
  const start = Number(startStr);
  const end = Number(endStr);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start)
    return null;
  if (end - start > 500) return null;
  const out: (string | number)[] = [];
  for (let i = start; i <= end; i++) {
    out.push(prefix ? `${prefix}${i}` : i);
  }
  return out;
}

function parseTokenList(raw: string): (string | number)[] {
  const range = expandRange(raw);
  if (range) return range;
  return raw
    .split(/[,，\s\t\n]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map(parseMemberToken);
}

export function SetEditor({
  sets,
  editable,
  onChange,
}: {
  sets: Obj[];
  editable: boolean;
  onChange: (nextSets: Obj[]) => void;
}) {
  const [pasteIdx, setPasteIdx] = useState<number | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [memberInput, setMemberInput] = useState<Record<string, string>>({});

  const plainSets = sets.filter((s) => !s.index_set && s.id);

  const updateSet = (idx: number, patch: Obj) => {
    const next = [...sets];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const addMembersFromInput = (idx: number) => {
    const key = String(idx);
    const raw = (memberInput[key] || "").trim();
    if (!raw) return;
    const tokens = parseTokenList(raw);
    const existing = sets[idx].members || [];
    const seen = new Set(existing.map((m: any) => `${typeof m}:${m}`));
    const merged = [...existing];
    for (const t of tokens) {
      const k = `${typeof t}:${t}`;
      if (!seen.has(k)) {
        seen.add(k);
        merged.push(t);
      }
    }
    updateSet(idx, { members: merged });
    setMemberInput({ ...memberInput, [key]: "" });
  };

  const addIndexedMembers = (setIdx: number, parentKey: string | number) => {
    const inputKey = `${setIdx}:${String(parentKey)}`;
    const raw = (memberInput[inputKey] || "").trim();
    if (!raw) return;
    const tokens = parseTokenList(raw);
    const list: Obj[] = [...(sets[setIdx].indexed_members || [])];
    const existingIdx = list.findIndex(
      (e) =>
        String(e.index) === String(parentKey) &&
        typeof e.index === typeof parentKey,
    );
    const curMembers = existingIdx >= 0 ? list[existingIdx].members || [] : [];
    const seen = new Set(curMembers.map((m: any) => `${typeof m}:${m}`));
    const merged = [...curMembers];
    for (const t of tokens) {
      const k = `${typeof t}:${t}`;
      if (!seen.has(k)) {
        seen.add(k);
        merged.push(t);
      }
    }
    if (existingIdx >= 0) {
      list[existingIdx] = { index: parentKey, members: merged };
    } else {
      list.push({ index: parentKey, members: merged });
    }
    updateSet(setIdx, { indexed_members: list });
    setMemberInput({ ...memberInput, [inputKey]: "" });
  };

  const removeIndexedMember = (
    setIdx: number,
    parentKey: string | number,
    mIdx: number,
  ) => {
    const list: Obj[] = [...(sets[setIdx].indexed_members || [])];
    const existingIdx = list.findIndex(
      (e) =>
        String(e.index) === String(parentKey) &&
        typeof e.index === typeof parentKey,
    );
    if (existingIdx < 0) return;
    list[existingIdx] = {
      ...list[existingIdx],
      members: list[existingIdx].members.filter(
        (_: any, k: number) => k !== mIdx,
      ),
    };
    updateSet(setIdx, { indexed_members: list });
  };

  const applyPaste = (idx: number) => {
    const lines = pasteText
      .split(/[\n\r,，\t]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const members: (string | number)[] = [];
    for (const line of lines) {
      const range = expandRange(line);
      const items = range || [parseMemberToken(line)];
      for (const item of items) {
        const k = `${typeof item}:${item}`;
        if (!seen.has(k)) {
          seen.add(k);
          members.push(item);
        }
      }
    }
    updateSet(idx, { members });
    setPasteIdx(null);
    setPasteText("");
  };

  return (
    <div className="section-stack">
      <div className="section-toolbar">
        <div>
          <h3 className="section-title">索引集合 (Sets)</h3>
          <p className="section-desc">
            定义离散集合（支持 1..5 范围或 Excel 粘贴），也支持类似 AMPL 的“索引集合（集合字典）”（如每个订单 j 对应的可用设备子集 S[j]）。
          </p>
        </div>
        <button
          className="btn-secondary"
          disabled={!editable}
          onClick={() =>
            onChange([
              ...sets,
              { id: "I" + (sets.length ? sets.length + 1 : ""), members: [] },
            ])
          }
        >
          ＋ 添加集合
        </button>
      </div>

      {sets.length === 0 ? (
        <div className="empty-card">
          当前没有索引集合。若模型只包含标量变量，可直接跳过此步。
        </div>
      ) : (
        <div className="item-list">
          {sets.map((s, i) => {
            const isIndexed = Boolean(s.index_set);
            const parentObj = isIndexed
              ? sets.find((x) => x.id === s.index_set)
              : null;
            const parentMembers: (string | number)[] = parentObj?.members || [];

            return (
              <div className="item-card" key={i}>
                <div className="item-card-header">
                  <div className="field-inline">
                    <label className="compact-label">集合名称</label>
                    <input
                      aria-label="集合名称"
                      className="input-mono input-sm"
                      disabled={!editable}
                      value={s.id}
                      placeholder="如 I"
                      onChange={(e) => updateSet(i, { id: e.target.value })}
                    />
                  </div>

                  <select
                    aria-label={`集合 ${i} 类型`}
                    className="select-xs"
                    disabled={!editable}
                    value={isIndexed ? s.index_set : "__plain__"}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "__plain__") {
                        updateSet(i, {
                          index_set: null,
                          indexed_members: [],
                        });
                      } else {
                        const targetParent = sets.find((x) => x.id === val);
                        const initEntries = (targetParent?.members || []).map(
                          (m: any) => ({ index: m, members: [] }),
                        );
                        updateSet(i, {
                          index_set: val,
                          members: [],
                          indexed_members:
                            s.indexed_members?.length > 0
                              ? s.indexed_members
                              : initEntries,
                        });
                      }
                    }}
                  >
                    <option value="__plain__">普通集合</option>
                    {plainSets
                      .filter((p) => p.id !== s.id)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          索引集合 (按 {p.id} 分组)
                        </option>
                      ))}
                  </select>

                  {!isIndexed && (
                    <span className="badge-neutral">
                      {(s.members || []).length} 个成员
                    </span>
                  )}

                  <div className="item-actions">
                    {!isIndexed && (
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={!editable}
                        onClick={() => {
                          if (pasteIdx === i) {
                            setPasteIdx(null);
                          } else {
                            setPasteIdx(i);
                            setPasteText((s.members || []).join("\n"));
                          }
                        }}
                      >
                        {pasteIdx === i ? "收起批量导入" : "批量粘贴 / 范围"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-ghost-danger btn-sm"
                      disabled={!editable}
                      onClick={() =>
                        onChange(sets.filter((_, j) => j !== i))
                      }
                    >
                      删除
                    </button>
                  </div>
                </div>

                {!isIndexed ? (
                  <>
                    <div className="token-box">
                      {(s.members || []).map((m: any, mIdx: number) => (
                        <span className="token-chip" key={mIdx}>
                          <span>{String(m)}</span>
                          {editable && (
                            <button
                              type="button"
                              aria-label={`移除成员 ${m}`}
                              onClick={() =>
                                updateSet(i, {
                                  members: s.members.filter(
                                    (_: any, k: number) => k !== mIdx,
                                  ),
                                })
                              }
                            >
                              ×
                            </button>
                          )}
                        </span>
                      ))}
                      {editable && (
                        <input
                          className="token-input"
                          aria-label={`添加 ${s.id} 成员`}
                          placeholder="输入成员或 1..5，回车添加…"
                          value={memberInput[String(i)] || ""}
                          onChange={(e) =>
                            setMemberInput({
                              ...memberInput,
                              [String(i)]: e.target.value,
                            })
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === ",") {
                              e.preventDefault();
                              addMembersFromInput(i);
                            }
                          }}
                          onBlur={() => addMembersFromInput(i)}
                        />
                      )}
                    </div>

                    {pasteIdx === i && (
                      <div className="paste-drawer">
                        <label className="compact-label">
                          粘贴一列数据（换行、逗号或制表符分隔，或输入 1..10 / M1..M5）
                        </label>
                        <textarea
                          rows={4}
                          className="input-mono"
                          value={pasteText}
                          onChange={(e) => setPasteText(e.target.value)}
                          placeholder={"北京\n上海\n广州\n或 1..5"}
                        />
                        <div className="drawer-actions">
                          <button
                            type="button"
                            className="btn-primary btn-sm"
                            onClick={() => applyPaste(i)}
                          >
                            替换集合成员
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
                  </>
                ) : (
                  <div className="indexed-set-table">
                    {parentMembers.length === 0 ? (
                      <p className="inline-hint warn">
                        父集合 {s.index_set} 尚未添加成员，请先在 {s.index_set} 中添加成员。
                      </p>
                    ) : (
                      parentMembers.map((pm) => {
                        const entry = (s.indexed_members || []).find(
                          (e: Obj) =>
                            String(e.index) === String(pm) &&
                            typeof e.index === typeof pm,
                        );
                        const subMembers: any[] = entry?.members || [];
                        const inputKey = `${i}:${String(pm)}`;
                        return (
                          <div className="indexed-set-row" key={String(pm)}>
                            <span className="indexed-set-key">
                              {s.id}[{String(pm)}]
                            </span>
                            <div className="token-box" style={{ flex: 1 }}>
                              {subMembers.map((m, mIdx) => (
                                <span className="token-chip" key={mIdx}>
                                  <span>{String(m)}</span>
                                  {editable && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        removeIndexedMember(i, pm, mIdx)
                                      }
                                    >
                                      ×
                                    </button>
                                  )}
                                </span>
                              ))}
                              {editable && (
                                <input
                                  className="token-input"
                                  placeholder="输入子集成员，回车添加…"
                                  value={memberInput[inputKey] || ""}
                                  onChange={(e) =>
                                    setMemberInput({
                                      ...memberInput,
                                      [inputKey]: e.target.value,
                                    })
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === ",") {
                                      e.preventDefault();
                                      addIndexedMembers(i, pm);
                                    }
                                  }}
                                  onBlur={() => addIndexedMembers(i, pm)}
                                />
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
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
