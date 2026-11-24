import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, clone, downloadJson, Obj, setCsrf, when } from "./api";
import { SetEditor } from "./components/SetEditor";
import { ParameterEditor } from "./components/ParameterEditor";
import { VariableEditor } from "./components/VariableEditor";
import { ObjectiveEditor, ConstraintEditor } from "./components/FormulaInput";
import { ModelPreview } from "./components/ModelPreview";
import { AiAssistantPanel } from "./components/AiAssistantPanel";
import { DiagnosisPanel } from "./components/DiagnosisPanel";
import { ResultView } from "./components/ResultView";
import { ModelSettings } from "./components/ModelSettings";
import { ExamplesView } from "./components/ExamplesView";
import { JsonField } from "./components/JsonField";
import "./style.css";

const SECTION_TABS = [
  { id: 0, label: "1. 集合", key: "sets" },
  { id: 1, label: "2. 参数", key: "parameters" },
  { id: 2, label: "3. 决策变量", key: "variables" },
  { id: 3, label: "4. 目标函数", key: "objective" },
  { id: 4, label: "5. 约束条件", key: "constraints" },
];

function App() {
  const [session, setSession] = useState<Obj | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const [health, setHealth] = useState<Obj>({});
  const [submissions, setSubmissions] = useState<Obj[]>([]);
  const [examples, setExamples] = useState<Obj[]>([]);

  const [page, setPage] = useState<"workspace" | "examples" | "settings">(
    "workspace",
  );
  const [selected, setSelected] = useState<Obj | null>(null);
  const [draft, setDraft] = useState<Obj | null>(null);
  const [dirty, setDirty] = useState(false);
  const [step, setStep] = useState(0);
  const [modelSection, setModelSection] = useState(0);
  const [problemOpen, setProblemOpen] = useState(true);
  const [draggingData, setDraggingData] = useState(false);
  const [dataPreview, setDataPreview] = useState<Obj | null>(null);
  const [dataPreviewSheet, setDataPreviewSheet] = useState(0);
  const [rightPanel, setRightPanel] = useState<"preview" | "describe" | "diagnose">("preview");

  const [compiled, setCompiled] = useState<Obj | null>(null);
  const [review, setReview] = useState(false);
  const [solverName, setSolverName] = useState<"highs" | "gurobi" | "cplex">("highs");
  const [timeLimit, setTimeLimit] = useState(30);
  const [mipGap, setMipGap] = useState("");
  const [threads, setThreads] = useState(1);
  const [seed, setSeed] = useState(0);
  const [presolve, setPresolve] = useState<"auto" | "on" | "off">("auto");

  const [newOpen, setNewOpen] = useState(false);
  const [openModal, setOpenModal] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [exampleId, setExampleId] = useState("");
  const [template, setTemplate] = useState("production");
  const [historyId, setHistoryId] = useState("");
  const [baseVersion, setBaseVersion] = useState(0);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const dataFileInputRef = useRef<HTMLInputElement | null>(null);

  const perform = async (fn: () => Promise<any>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const overview = async () => {
    const [s, e, h] = await Promise.all([
      api("/submissions"),
      api("/examples"),
      api("/health"),
    ]);
    setSubmissions(s);
    setExamples(e);
    setHealth(h);
  };

  const open = async (id: string) => {
    const s = await api("/submissions/" + id);
    setSelected(s);
    setSubmissions((items) =>
      items.map((x) => (x.id === s.id ? { ...x, version: s.version } : x)),
    );
    const r = s.revisions[0];
    setBaseVersion(s.version);
    setDraft({
      problem_text: r.problem_text,
      model: clone(r.model),
      data: clone(r.data),
      assets: clone(r.assets),
    });
    setDirty(false);
    setStep(0);
    setCompiled(null);
    setReview(false);
    setHistoryId("");
    setPage("workspace");
  };

  useEffect(() => {
    api("/workspace")
      .then((u) => {
        setCsrf(u.csrf);
        setSession(u);
      })
      .catch((e) => setError(e.message))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (session) perform(overview);
  }, [session]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => {
      api("/health")
        .then(setHealth)
        .catch(() => {});
      if (selected)
        api("/submissions/" + selected.id)
          .then((s) => {
            setSelected((old) => (old?.id === s.id ? s : old));
          })
          .catch(() => {});
    }, 2500);
    return () => clearInterval(timer);
  }, [session, selected?.id]);

  const current =
    selected?.revisions.find((r: Obj) => r.number === baseVersion) ||
    selected?.revisions[0];
  const editable = !!draft && !selected?.readonly && !historyId;
  const confirmed =
    !!current?.confirmation &&
    !dirty &&
    !historyId &&
    baseVersion === selected?.version;

  const touch = (next: Obj) => {
    setDraft(next);
    setDirty(true);
    setReview(false);
    setCompiled(null);
  };

  const changeModel = (next: Obj) => draft && touch({ ...draft, model: next });

  const save = async () => {
    if (!selected || !draft) return;
    const r = await api("/submissions/" + selected.id + "/revisions", {
      ...draft,
      expected_version: baseVersion,
    });
    await open(selected.id);
    setNotice("已保存新版本；请重新确认数学模型与数据。");
    return r;
  };

  const loadExample = async () => {
    const model = await api("/fixtures/" + template);
    const data =
      template === "assignment" ? await api("/fixtures/assignment_data") : {};
    touch({ ...draft, model, data });
    setNotice("样例已载入编辑区，保存后可确认。");
  };

  const create = async () => {
    const s = await api("/submissions", {
      title: newTitle.trim() || "未命名模型",
      example_id: exampleId || null,
    });
    await overview();
    await open(s.id);
    setNewTitle("");
    setExampleId("");
    setNewOpen(false);
  };

  const exportSingleJson = () => {
    if (!selected || !draft) return;
    const payload = {
      schema: "modellab-model-v1",
      title: selected.title,
      problem_text: draft.problem_text || "",
      model: draft.model,
      data: draft.data || {},
    };
    const safeName = (selected.title || "model").replace(/[\\/:*?"<>|]/g, "_");
    downloadJson(`${safeName}.modellab.json`, JSON.stringify(payload, null, 2));
    setNotice("已导出单文件模型 JSON，可随时导入恢复或分享。");
  };

  const importSingleJson = async (file: File) => {
    const text = await file.text();
    const raw = JSON.parse(text);
    const defaultTitle = file.name.replace(/(\.modellab)?\.json$/i, "") || "导入模型";
    const body = raw.model
      ? {
          title: raw.title || defaultTitle,
          problem_text: raw.problem_text || "",
          model: raw.model,
          data: raw.data || {},
        }
      : {
          title: defaultTitle,
          problem_text: "",
          model: raw,
          data: {},
        };
    const s = await api("/submissions/import", body);
    await overview();
    await open(s.id);
    setNotice(`已导入模型“${body.title}”。`);
  };

  const saveAsModel = async () => {
    if (!selected || !draft) return;
    const nextTitle = window.prompt(
      "另存为新模型，请输入新名称：",
      `${selected.title} 副本`,
    );
    if (!nextTitle || !nextTitle.trim()) return;
    const s = await api("/submissions/import", {
      title: nextTitle.trim(),
      problem_text: draft.problem_text || "",
      model: draft.model,
      data: draft.data || {},
    });
    await overview();
    await open(s.id);
    setNotice(`已另存为“${nextTitle.trim()}”。`);
  };

  const renameCurrentModel = async () => {
    if (!selected) return;
    const nextTitle = window.prompt("修改模型名称：", selected.title);
    if (!nextTitle || !nextTitle.trim() || nextTitle.trim() === selected.title)
      return;
    await api("/submissions/" + selected.id, { title: nextTitle.trim() }, "PATCH");
    await overview();
    setSelected({ ...selected, title: nextTitle.trim() });
    setNotice("模型名称已更新。");
  };

  const deleteModelById = async (id: string, title: string) => {
    if (!window.confirm(`确定删除模型“${title}”及其所有版本？此操作不可恢复。`))
      return;
    await api("/submissions/" + id, undefined, "DELETE");
    if (selected?.id === id) {
      setSelected(null);
      setDraft(null);
      setDirty(false);
    }
    await overview();
    setNotice(`已删除模型“${title}”。`);
  };

  const deleteCurrentModel = async () => {
    if (!selected) return;
    await deleteModelById(selected.id, selected.title);
  };

  const uploadDataFiles = async (files: File[]) => {
    if (!selected || !draft || files.length === 0) return;
    if ((draft.assets || []).length + files.length > 4) {
      throw new Error("每个版本最多附加 4 个数据文件");
    }
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    const uploaded = await api(`/submissions/${selected.id}/data-files`, form);
    const nextAssets = [
      ...(draft.assets || []),
      ...uploaded.map((x: Obj) => ({
        id: x.id,
        name: x.name,
        kind: "data",
        sheet_count: x.sheet_count,
        rotation: 0,
      })),
    ];
    touch({ ...draft, assets: nextAssets });
    setSelected({ ...selected, assets: [...(selected.assets || []), ...uploaded] });
    setNotice(`已附加 ${uploaded.length} 个数据文件，请保存版本后供 AI 读取。`);
  };

  const checklistIssues: { label: string; section: number }[] = [];
  if (draft?.model) {
    (draft.model.variables || []).forEach((v: Obj) => {
      if (
        v.domain !== "binary" &&
        (v.lower === undefined || v.upper === undefined)
      ) {
        checklistIssues.push({
          label: `变量 ${v.id} 尚未声明完整上下界`,
          section: 2,
        });
      }
    });
    (draft.model.unresolved_items || []).forEach((u: Obj) => {
      if (!u.resolved || !u.resolution?.trim()) {
        checklistIssues.push({
          label: `识别疑点待核对：${u.question}`,
          section: -1,
        });
      }
    });
  }

  if (!ready) return <div className="loading">正在打开实验室…</div>;
  if (!session)
    return (
      <main className="loading">
        <h2>工作台暂时无法连接</h2>
        <p role="alert">{error}</p>
        <button className="btn-primary" onClick={() => location.reload()}>
          重新连接
        </button>
      </main>
    );

  return (
    <div className="shell-single">
      <div className="main-full">
        <header className="topbar">
          <div className="topbar-left">
            <div className="wordmark topbar-brand">
              <span className="brand-icon">M</span>
              <span className="brand-title">ModelLab</span>
            </div>

            <div className="segmented-control compact">
              <button
                type="button"
                className={page === "workspace" ? "active" : ""}
                onClick={() => setPage("workspace")}
              >
                建模工作区
              </button>
              <button
                type="button"
                className={page === "examples" ? "active" : ""}
                onClick={() => setPage("examples")}
              >
                参考案例
              </button>
              <button
                type="button"
                className={page === "settings" ? "active" : ""}
                onClick={() => setPage("settings")}
              >
                模型设置
              </button>
            </div>

            {page === "workspace" && selected && current && (
              <div className="topbar-doc">
                <span className="topbar-doc-title" title={selected.title}>
                  {selected.title}
                </span>
                <span
                  className={`status-badge ${dirty ? "warn" : confirmed ? "ok" : "neutral"}`}
                >
                  v{current.number} ·{" "}
                  {dirty ? "未保存" : confirmed ? "已确认" : "待确认"}
                </span>
              </div>
            )}
          </div>

          <div className="topbar-right">
            <span className="status-pill-inline" title="求解器运行环境状态">
              <span className={"status-dot " + (health.runner ? "online" : "")} />
              <span>
                {health.runner
                  ? health.runner_mode === "docker"
                    ? "Docker 就绪"
                    : "本机求解就绪"
                  : "求解器未就绪"}
              </span>
            </span>

            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) perform(() => importSingleJson(f));
                e.target.value = "";
              }}
            />
            {page === "workspace" && (
              <>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={busy}
                  onClick={() => {
                    setNewTitle("");
                    setExampleId("");
                    setNewOpen(true);
                  }}
                >
                  ＋ 新建
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={busy}
                  onClick={() => {
                    setModelSearch("");
                    setOpenModal(true);
                  }}
                >
                  打开 ({submissions.length})
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={busy}
                  onClick={() => importInputRef.current?.click()}
                >
                  导入 JSON
                </button>
                {selected && draft && (
                  <>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      disabled={busy}
                      onClick={exportSingleJson}
                    >
                      导出 JSON
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      disabled={busy}
                      onClick={() => perform(saveAsModel)}
                    >
                      另存为
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => perform(renameCurrentModel)}
                    >
                      重命名
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </header>

        <div className="toast-stack">
          {error && (
            <div role="alert" className="alert error toast-item">
              <span>{error}</span>
              <button onClick={() => setError("")}>×</button>
            </div>
          )}
          {notice && (
            <div role="status" className="alert success toast-item">
              <span>{notice}</span>
              <button onClick={() => setNotice("")}>×</button>
            </div>
          )}
        </div>

        <div className="content-wrap">

          {page === "settings" ? (
            <ModelSettings
              onSaved={async () => {
                setHealth(await api("/health"));
              }}
            />
          ) : page === "examples" ? (
            <ExamplesView
              examples={examples}
              busy={busy}
              onError={setError}
              onUseExample={(e) =>
                perform(async () => {
                  if (
                    dirty &&
                    !window.confirm("当前编辑未保存，是否打开新的案例模型？")
                  )
                    return;
                  const s = await api("/submissions", {
                    title: e.title,
                    example_id: e.id,
                  });
                  await overview();
                  await open(s.id);
                })
              }
            />
          ) : (
            <>
              {!selected || !draft ? (
                <section className="welcome card">
                  <span className="badge-accent">科研数学规划工作台</span>
                  <h1>ModelLab 建模工作台</h1>
                  <p className="muted">
                    从集合、参数、决策变量、目标函数到约束条件，逐层表达你的混合整数规划模型。
                    <br />
                    支持本地单文件 <code>.modellab.json</code> 保存与读取，并调用 HiGHS / Gurobi / CPLEX 求解与独立残差校验。
                  </p>
                  <div className="inline-actions" style={{ marginTop: 18 }}>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => {
                        setNewTitle("");
                        setExampleId("");
                        setNewOpen(true);
                      }}
                    >
                      ＋ 新建模型
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        setModelSearch("");
                        setOpenModal(true);
                      }}
                    >
                      打开已有模型 ({submissions.length})
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => importInputRef.current?.click()}
                    >
                      导入 .json 模型
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setPage("examples")}
                    >
                      浏览参考案例 →
                    </button>
                  </div>
                  <div className="welcome-steps">
                    <div className="welcome-step-card">
                      <strong>01 · 结构化建模</strong>
                      <span>集合 → 参数表格 → 变量范围 → 目标与约束</span>
                    </div>
                    <div className="welcome-step-card">
                      <strong>02 · 版本确认</strong>
                      <span>核对数学表达与数据边界，防止隐式假设</span>
                    </div>
                    <div className="welcome-step-card">
                      <strong>03 · 真实求解</strong>
                      <span>确定性编译 + HiGHS 求解 + 独立残差校验</span>
                    </div>
                  </div>
                </section>
              ) : (
                <>
                  {baseVersion !== selected.version && (
                    <div className="alert warning">
                      其他窗口已更新此模型；当前编辑基于旧版本，保存将被拒绝。请导出或另存需要保留的内容，再重新打开模型。
                    </div>
                  )}

                  <div className="workflow-bar">
                    <div className="segmented-control">
                      {[
                        "01 建模与数据",
                        "02 确认模型",
                        "03 生成与求解",
                        "04 结果与历史",
                      ].map((name, i) => (
                        <button
                          className={step === i ? "active" : ""}
                          key={i}
                          onClick={() => setStep(i)}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {step === 0 && (
                    <div className="modeling-layout">
                      <section className="card editor-pane">
                        <div
                          className={`problem-banner-card ${draggingData ? "is-dragging" : ""}`}
                          onDragOver={(e) => {
                            if (!editable) return;
                            e.preventDefault();
                            setDraggingData(true);
                          }}
                          onDragLeave={() => setDraggingData(false)}
                          onDrop={(e) => {
                            e.preventDefault();
                            setDraggingData(false);
                            if (!editable) return;
                            const files = Array.from(e.dataTransfer.files || []).filter(
                              (f) => /\.(xlsx|csv)$/i.test(f.name),
                            );
                            if (files.length === 0) {
                              setError("请拖入 .xlsx 或 .csv 格式的数据文件");
                              return;
                            }
                            perform(() => uploadDataFiles(files));
                          }}
                        >
                          <div
                            className="problem-banner-head"
                            onClick={() => setProblemOpen(!problemOpen)}
                          >
                            <div className="ai-head-left">
                              <span className="ai-section-title">
                                问题描述 / 案例说明
                              </span>
                              {!problemOpen && (
                                <span className="ai-problem-snippet">
                                  {draft.problem_text.trim() ||
                                    "点击展开填写问题描述或业务背景…"}
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              className="btn-ghost btn-sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setProblemOpen(!problemOpen);
                              }}
                            >
                              {problemOpen ? "收起" : "展开编辑"}
                            </button>
                          </div>
                          {problemOpen && (
                            <div className="problem-banner-body">
                              <textarea
                                aria-label="建模描述 / 问题背景"
                                disabled={!editable}
                                rows={3}
                                value={draft.problem_text}
                                onChange={(e) =>
                                  touch({
                                    ...draft,
                                    problem_text: e.target.value,
                                  })
                                }
                                placeholder="用自然语言描述你的优化问题、资源限制与业务背景；也可直接将 Excel (.xlsx) 或 CSV 拖入此处…"
                              />
                            </div>
                          )}
                          <div className="data-attach-bar">
                            <input
                              ref={dataFileInputRef}
                              type="file"
                              accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                              multiple
                              style={{ display: "none" }}
                              onChange={(e) => {
                                const files = Array.from(e.target.files || []);
                                if (files.length > 0)
                                  perform(() => uploadDataFiles(files));
                                e.target.value = "";
                              }}
                            />
                            <button
                              type="button"
                              className="btn-ghost btn-sm"
                              disabled={!editable || busy}
                              onClick={() => dataFileInputRef.current?.click()}
                            >
                              ＋ 拖入或选择 Excel / CSV 数据
                            </button>
                            {(draft.assets || []).map((a: Obj, aIdx: number) => {
                              const meta = selected.assets?.find(
                                (x: Obj) => x.id === a.id,
                              );
                              const fileName =
                                a.name || meta?.name || `数据文件 ${aIdx + 1}`;
                              return (
                                <span className="data-file-chip" key={a.id}>
                                  <span>📊 {fileName}</span>
                                  <button
                                    type="button"
                                    className="btn-link"
                                    onClick={() =>
                                      perform(async () => {
                                        const prev = await api(
                                          `/assets/${a.id}/preview`,
                                        );
                                        setDataPreview(prev);
                                        setDataPreviewSheet(0);
                                      })
                                    }
                                  >
                                    预览
                                  </button>
                                  {editable && (
                                    <button
                                      type="button"
                                      aria-label={`移除 ${fileName}`}
                                      onClick={() =>
                                        touch({
                                          ...draft,
                                          assets: draft.assets.filter(
                                            (_: any, j: number) => j !== aIdx,
                                          ),
                                        })
                                      }
                                    >
                                      ×
                                    </button>
                                  )}
                                </span>
                              );
                            })}
                          </div>
                        </div>

                        <div className="editor-top-bar">
                          <div className="section-pills">
                            {SECTION_TABS.map((tab) => {
                              const count =
                                tab.key === "objective"
                                  ? null
                                  : (draft.model[tab.key] || []).length;
                              return (
                                <button
                                  key={tab.id}
                                  type="button"
                                  className={`section-pill ${modelSection === tab.id ? "active" : ""}`}
                                  onClick={() => setModelSection(tab.id)}
                                >
                                  {tab.label}
                                  {count !== null && (
                                    <span className="pill-count">{count}</span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                          <div className="template-bar">
                            <select
                              aria-label="示例模型"
                              className="select-sm"
                              value={template}
                              onChange={(e) => setTemplate(e.target.value)}
                            >
                              <option value="production">生产计划 · 整数</option>
                              <option value="production_lp">
                                生产计划 · 连续
                              </option>
                              <option value="assignment">3 × 3 指派</option>
                              <option value="free_variable">自由变量</option>
                              <option value="infeasible">不可行模型</option>
                              <option value="unbounded">无界模型</option>
                            </select>
                            <button
                              type="button"
                              className="btn-secondary btn-sm"
                              disabled={!editable || busy}
                              onClick={() => perform(loadExample)}
                            >
                              载入示例
                            </button>
                          </div>
                        </div>

                        {checklistIssues.length > 0 && (
                          <div className="checklist-banner">
                            <strong>
                              待核对项（{checklistIssues.length}）：
                            </strong>
                            <div className="checklist-links">
                              {checklistIssues.map((item, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  className="btn-link"
                                  onClick={() => {
                                    if (item.section >= 0)
                                      setModelSection(item.section);
                                  }}
                                >
                                  {item.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {(draft.model.unresolved_items || []).length > 0 && (
                          <details className="unresolved-collapse" open>
                            <summary>
                              待核对疑点（
                              {
                                draft.model.unresolved_items.filter(
                                  (u: Obj) => !u.resolved,
                                ).length
                              }
                              ）
                            </summary>
                            <div className="unresolved-section">
                              {draft.model.unresolved_items.map(
                                (u: Obj, i: number) => (
                                  <div className="uncertainty" key={i}>
                                    <b>{u.question}</b>
                                    <small>
                                      来源：{u.source_id || "模型草稿"}
                                    </small>
                                    <label>
                                      核对记录
                                      <input
                                        disabled={!editable}
                                        value={u.resolution || ""}
                                        onChange={(e) => {
                                          const items = clone(
                                            draft.model.unresolved_items,
                                          );
                                          items[i] = {
                                            ...u,
                                            resolution: e.target.value,
                                            resolved: false,
                                          };
                                          changeModel({
                                            ...draft.model,
                                            unresolved_items: items,
                                          });
                                        }}
                                      />
                                    </label>
                                    <label className="check">
                                      <input
                                        type="checkbox"
                                        disabled={
                                          !editable || !u.resolution?.trim()
                                        }
                                        checked={!!u.resolved}
                                        onChange={(e) => {
                                          const items = clone(
                                            draft.model.unresolved_items,
                                          );
                                          items[i] = {
                                            ...u,
                                            resolved: e.target.checked,
                                          };
                                          changeModel({
                                            ...draft.model,
                                            unresolved_items: items,
                                          });
                                        }}
                                      />
                                      我已核对并修订该疑点
                                    </label>
                                  </div>
                                ),
                              )}
                            </div>
                          </details>
                        )}

                        <div className="editor-body">
                          {modelSection === 0 && (
                            <SetEditor
                              sets={draft.model.sets || []}
                              editable={editable}
                              onChange={(sets) =>
                                changeModel({ ...draft.model, sets })
                              }
                            />
                          )}

                          {modelSection === 1 && (
                            <ParameterEditor
                              parameters={draft.model.parameters || []}
                              sets={draft.model.sets || []}
                              data={draft.data || {}}
                              editable={editable}
                              onChangeParams={(parameters) =>
                                changeModel({ ...draft.model, parameters })
                              }
                              onChangeData={(data) => touch({ ...draft, data })}
                            />
                          )}

                          {modelSection === 2 && (
                            <VariableEditor
                              variables={draft.model.variables || []}
                              sets={draft.model.sets || []}
                              editable={editable}
                              onChange={(variables) =>
                                changeModel({ ...draft.model, variables })
                              }
                            />
                          )}

                          {modelSection === 3 && (
                            <ObjectiveEditor
                              model={draft.model}
                              editable={editable}
                              onError={setError}
                              onChangeObjective={(objective) =>
                                changeModel({ ...draft.model, objective })
                              }
                            />
                          )}

                          {modelSection === 4 && (
                            <ConstraintEditor
                              model={draft.model}
                              editable={editable}
                              onChangeConstraints={(constraints) =>
                                changeModel({ ...draft.model, constraints })
                              }
                            />
                          )}
                        </div>

                        <div className="section-nav-footer">
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            disabled={modelSection === 0}
                            onClick={() => setModelSection(modelSection - 1)}
                          >
                            ← 上一部分
                          </button>
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            disabled={modelSection === 4}
                            onClick={() => setModelSection(modelSection + 1)}
                          >
                            下一部分 →
                          </button>
                        </div>

                        <details className="advanced-collapse">
                          <summary>高级：原始 JSON 与实例数据绑定</summary>
                          <div className="adv-json-grid">
                            <JsonField
                              label="实例数据 JSON (data)"
                              value={draft.data}
                              disabled={!editable}
                              onChange={(v) => touch({ ...draft, data: v })}
                            />
                            <JsonField
                              label="完整模型结构 JSON (model)"
                              value={draft.model}
                              disabled={!editable}
                              onChange={(v) =>
                                api("/model/shape", v).then(changeModel)
                              }
                            />
                          </div>
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() =>
                              perform(async () => {
                                const v = await api("/fixtures/data_template");
                                downloadJson(
                                  "data-template.json",
                                  JSON.stringify(v, null, 2),
                                );
                              })
                            }
                          >
                            下载数据模板
                          </button>
                        </details>

                        <div className="editor-footer">
                          <span className="muted">
                            {dirty ? "尚有未保存的修改" : "当前版本已保存"}
                          </span>
                          <button
                            className="btn-primary"
                            disabled={busy || !dirty || !editable}
                            onClick={() => perform(save)}
                          >
                            保存新版本
                          </button>
                          <button
                            className="btn-secondary"
                            disabled={dirty}
                            onClick={() => setStep(1)}
                          >
                            前往确认 →
                          </button>
                        </div>
                      </section>

                      <aside className="card preview-pane">
                        <div className="preview-header">
                          <div className="segmented-control compact">
                            <button
                              type="button"
                              className={
                                rightPanel === "preview" ? "active" : ""
                              }
                              onClick={() => setRightPanel("preview")}
                            >
                              数学模型预览
                            </button>
                            <button
                              type="button"
                              className={
                                rightPanel === "describe" ? "active" : ""
                              }
                              onClick={() => setRightPanel("describe")}
                            >
                              AI 建模助手
                              {(selected.ai_thread?.draft ||
                                (draft.model.unresolved_items || []).some(
                                  (u: Obj) => !u.resolved,
                                )) && <span className="dot-indicator" />}
                            </button>
                            <button
                              type="button"
                              className={
                                rightPanel === "diagnose" ? "active" : ""
                              }
                              onClick={() => setRightPanel("diagnose")}
                            >
                              模型诊断
                            </button>
                          </div>
                        </div>

                        {rightPanel === "preview" ? (
                          <div className="preview-scroll">
                            <p className="fine">
                              点击任意公式区块可直接跳转到对应编辑章节。
                            </p>
                            <ModelPreview
                              model={draft.model}
                              data={draft.data}
                              onJumpSection={(sec) => setModelSection(sec)}
                            />
                          </div>
                        ) : rightPanel === "diagnose" ? (
                          <div className="preview-scroll">
                            <DiagnosisPanel
                              model={draft.model}
                              jobs={selected.jobs}
                              currentRevisionId={current.id}
                              dirty={dirty}
                              editable={editable}
                              busy={busy}
                              health={health}
                              onOpenSettings={() => setPage("settings")}
                              onCancelJob={(jid) =>
                                perform(() =>
                                  api("/jobs/" + jid + "/cancel", {}),
                                )
                              }
                              onRunDiagnose={(provider) =>
                                perform(async () => {
                                  await api(
                                    "/revisions/" + current.id + "/diagnoses",
                                    {
                                      request_key: crypto.randomUUID(),
                                      provider,
                                    },
                                  );
                                  setNotice("模型诊断已排队，正在分析中…");
                                })
                              }
                              onJumpTarget={(targetId) => {
                                if (
                                  (draft.model.sets || []).some(
                                    (x: Obj) => x.id === targetId,
                                  )
                                )
                                  setModelSection(0);
                                else if (
                                  (draft.model.parameters || []).some(
                                    (x: Obj) => x.id === targetId,
                                  )
                                )
                                  setModelSection(1);
                                else if (
                                  (draft.model.variables || []).some(
                                    (x: Obj) => x.id === targetId,
                                  )
                                )
                                  setModelSection(2);
                                else if (draft.model.objective?.id === targetId)
                                  setModelSection(3);
                                else if (
                                  (draft.model.constraints || []).some(
                                    (x: Obj) => x.id === targetId,
                                  )
                                )
                                  setModelSection(4);
                              }}
                            />
                          </div>
                        ) : (
                          <div className="preview-fixed-body">
                            <AiAssistantPanel
                              problemText={draft.problem_text}
                              aiThread={
                                selected.ai_thread || {
                                  draft: null,
                                  messages: [],
                                }
                              }
                              jobs={selected.jobs}
                              dirty={dirty}
                              editable={editable}
                              busy={busy}
                              health={health}
                              onEditProblem={() => setProblemOpen(true)}
                              onOpenSettings={() => setPage("settings")}
                              onCancelJob={(jid) =>
                                perform(() =>
                                  api("/jobs/" + jid + "/cancel", {}),
                                )
                              }
                              onGenerateDraft={(provider) =>
                                perform(async () => {
                                  await api(
                                    "/revisions/" + current.id + "/drafts",
                                    {
                                      request_key: crypto.randomUUID(),
                                      provider,
                                    },
                                  );
                                  setNotice("正在根据问题背景生成模型草稿…");
                                })
                              }
                              onSendChat={async (message, provider) => {
                                await perform(async () => {
                                  await api(
                                    "/revisions/" + current.id + "/ai-chat",
                                    {
                                      request_key: crypto.randomUUID(),
                                      message,
                                      provider,
                                    },
                                  );
                                  const s = await api(
                                    "/submissions/" + selected.id,
                                  );
                                  setSelected(s);
                                });
                              }}
                              onAdoptDraft={(draftObj) =>
                                perform(async () => {
                                  const resolvedById = new Map<string, Obj>(
                                    (draft.model.unresolved_items || [])
                                      .filter((u: Obj) => u.resolved && u.resolution?.trim())
                                      .map((u: Obj) => [u.id, u]),
                                  );
                                  const nextUnresolved = (
                                    draftObj.symbolic_model_draft
                                      ?.unresolved_items || []
                                  ).map((u: Obj) => {
                                    const prev = resolvedById.get(u.id);
                                    if (prev && prev.question === u.question) {
                                      return {
                                        ...u,
                                        resolved: true,
                                        resolution: prev.resolution,
                                      };
                                    }
                                    return u;
                                  });
                                  await api(
                                    "/submissions/" +
                                      selected.id +
                                      "/revisions",
                                    {
                                      ...draft,
                                      data:
                                        draftObj.data &&
                                        Object.keys(draftObj.data).length > 0
                                          ? draftObj.data
                                          : draft.data,
                                      model: {
                                        ...draftObj.symbolic_model_draft,
                                        unresolved_items: nextUnresolved,
                                        transcript: draftObj.summary || "",
                                      },
                                      expected_version: baseVersion,
                                    },
                                  );
                                  await open(selected.id);
                                  setRightPanel("preview");
                                  setNotice(
                                    "已采纳 AI 草稿为新版本，可在左侧继续编辑并确认。",
                                  );
                                })
                              }
                              onClearThread={() => {
                                if (
                                  !window.confirm(
                                    "清空当前 AI 草稿与对话记录？（不会影响左侧已保存的模型版本）",
                                  )
                                )
                                  return;
                                perform(async () => {
                                  await api(
                                    "/submissions/" +
                                      selected.id +
                                      "/ai-thread",
                                    undefined,
                                    "DELETE",
                                  );
                                  const s = await api(
                                    "/submissions/" + selected.id,
                                  );
                                  setSelected(s);
                                });
                              }}
                            />
                          </div>
                        )}
                      </aside>
                    </div>
                  )}

                  {step === 1 && (
                    <section className="card confirmation">
                      <h2 className="card-title">确认你要执行的数学模型</h2>
                      <p className="muted">
                        确认覆盖目标方向、全部约束、索引、变量范围和实例数据。模型可执行不代表它符合题意。
                      </p>
                      {dirty && (
                        <div className="alert warning">
                          有未保存修改，请先返回输入页保存。
                        </div>
                      )}
                      <ModelPreview model={draft.model} data={draft.data} />
                      <details>
                        <summary>查看完整实例数据 JSON</summary>
                        <pre>{JSON.stringify(draft.data, null, 2)}</pre>
                      </details>

                      <div className="confirm-review-box">
                        <div className="confirm-review-head">
                          <strong>AI 确认前把关（可选）</strong>
                          <span className="muted" style={{ fontSize: 12 }}>
                            {selected.jobs.some(
                              (j: Obj) =>
                                j.kind === "diagnose" &&
                                j.revision_id === current.id &&
                                j.state === "succeeded",
                            )
                              ? "已同步当前版本的 AI 诊断意见"
                              : "确认前可让 AI 检查是否漏掉隐藏约束、方向或界限"}
                          </span>
                        </div>
                        <DiagnosisPanel
                          model={draft.model}
                          jobs={selected.jobs.filter(
                            (j: Obj) => j.revision_id === current.id,
                          )}
                          currentRevisionId={current.id}
                          dirty={dirty}
                          editable={editable}
                          busy={busy}
                          health={health}
                          onOpenSettings={() => setPage("settings")}
                          onCancelJob={(jid) =>
                            perform(() => api("/jobs/" + jid + "/cancel", {}))
                          }
                          onRunDiagnose={(provider) =>
                            perform(async () => {
                              await api(
                                "/revisions/" + current.id + "/diagnoses",
                                {
                                  request_key: crypto.randomUUID(),
                                  provider,
                                },
                              );
                              setNotice("正在进行确认前 AI 审阅…");
                            })
                          }
                          onJumpTarget={(targetId) => {
                            setStep(0);
                            if (
                              (draft.model.sets || []).some(
                                (x: Obj) => x.id === targetId,
                              )
                            )
                              setModelSection(0);
                            else if (
                              (draft.model.parameters || []).some(
                                (x: Obj) => x.id === targetId,
                              )
                            )
                              setModelSection(1);
                            else if (
                              (draft.model.variables || []).some(
                                (x: Obj) => x.id === targetId,
                              )
                            )
                              setModelSection(2);
                            else if (draft.model.objective?.id === targetId)
                              setModelSection(3);
                            else if (
                              (draft.model.constraints || []).some(
                                (x: Obj) => x.id === targetId,
                              )
                            )
                              setModelSection(4);
                          }}
                        />
                      </div>

                      {(draft.model.unresolved_items || [])
                        .filter((x: Obj) => !x.resolved || !x.resolution)
                        .map((x: Obj) => (
                          <p className="alert warning" key={x.id}>
                            {x.question}
                          </p>
                        ))}
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={review}
                          disabled={!editable || dirty}
                          onChange={(e) => setReview(e.target.checked)}
                        />
                        我已逐项核对以上数学表达、变量范围、量词和数据。
                      </label>
                      <div className="inline-actions">
                        <button
                          className="btn-secondary"
                          disabled={busy || dirty}
                          onClick={() =>
                            perform(async () => {
                              const r = await api(
                                "/revisions/" + current.id + "/validate",
                                {},
                              );
                              setNotice(
                                `结构检查通过：${r.variables} 个展开变量，${r.constraints} 条约束`,
                              );
                            })
                          }
                        >
                          检查执行条件
                        </button>
                        <button
                          className="btn-primary"
                          disabled={busy || dirty || !review || !editable}
                          onClick={() =>
                            perform(async () => {
                              await api(
                                "/revisions/" + current.id + "/confirm",
                                {},
                              );
                              const s = await api("/submissions/" + selected.id);
                              setSelected(s);
                              setStep(2);
                              setNotice("当前版本已确认，可以生成代码。");
                            })
                          }
                        >
                          确认此版本 →
                        </button>
                      </div>
                    </section>
                  )}

                  {step === 2 && (
                    <section className="card confirmation">
                      <div className="section-toolbar">
                        <div>
                          <h2 className="card-title">生成与求解</h2>
                          <p className="muted">
                            {solverName.toUpperCase()} ·{" "}
                            {health.runner_mode === "docker"
                              ? "Docker 隔离"
                              : "本机求解"}{" "}
                            · LP / MILP
                          </p>
                        </div>
                      </div>
                      {!confirmed && (
                        <div className="alert warning">
                          请先保存并确认当前版本。
                        </div>
                      )}
                      {!health.runner && (
                        <div className="alert warning">
                          {health.runner_reason}
                        </div>
                      )}

                      <div className="solver-config-card">
                        <div className="solver-grid">
                          <label>
                            求解器 (Solver)
                            <select
                              aria-label="求解器"
                              value={solverName}
                              onChange={(e) =>
                                setSolverName(
                                  e.target.value as "highs" | "gurobi" | "cplex",
                                )
                              }
                            >
                              <option value="highs">
                                HiGHS（开源内置 ·{" "}
                                {health.solvers?.highs ? "已就绪" : "未就绪"}）
                              </option>
                              <option value="gurobi">
                                Gurobi（gurobipy ·{" "}
                                {health.solvers?.gurobi ? "已就绪" : "未安装"}）
                              </option>
                              <option value="cplex">
                                CPLEX（cplex ·{" "}
                                {health.solvers?.cplex ? "已就绪" : "未安装"}）
                              </option>
                            </select>
                          </label>
                          <label>
                            最大运行时间 (秒)
                            <input
                              aria-label="最大运行时间"
                              type="number"
                              min={1}
                              max={600}
                              value={timeLimit}
                              onChange={(e) =>
                                setTimeLimit(
                                  Math.max(1, Math.min(600, Number(e.target.value) || 30)),
                                )
                              }
                            />
                          </label>
                          <label>
                            MIPGap 容差（留空默认）
                            <input
                              aria-label="MIPGap"
                              type="number"
                              step="0.0001"
                              min={0}
                              max={1}
                              placeholder="如 0.0001"
                              value={mipGap}
                              onChange={(e) => setMipGap(e.target.value)}
                            />
                          </label>
                        </div>

                        {health.solvers && !health.solvers[solverName] && (
                          <p className="inline-hint warn" style={{ marginTop: 6 }}>
                            当前本机 Python 环境未检测到 {solverName.toUpperCase()}，点击运行将提示未安装；仍可导出标准 .lp 模型或复现代码。
                          </p>
                        )}

                        <details style={{ marginTop: 8 }}>
                          <summary>高级求解参数（线程数 / 随机种子 / 预处理）</summary>
                          <div className="solver-grid" style={{ marginTop: 8 }}>
                            <label>
                              线程数 (0 为自动)
                              <input
                                type="number"
                                min={0}
                                max={64}
                                value={threads}
                                onChange={(e) =>
                                  setThreads(Math.max(0, Number(e.target.value) || 0))
                                }
                              />
                            </label>
                            <label>
                              随机种子 (Seed)
                              <input
                                type="number"
                                min={0}
                                value={seed}
                                onChange={(e) =>
                                  setSeed(Math.max(0, Number(e.target.value) || 0))
                                }
                              />
                            </label>
                            <label>
                              预处理 (Presolve)
                              <select
                                value={presolve}
                                onChange={(e) =>
                                  setPresolve(
                                    e.target.value as "auto" | "on" | "off",
                                  )
                                }
                              >
                                <option value="auto">自动 (auto)</option>
                                <option value="on">开启 (on)</option>
                                <option value="off">关闭 (off)</option>
                              </select>
                            </label>
                          </div>
                        </details>
                      </div>

                      <div className="inline-actions">
                        <button
                          className="btn-secondary"
                          disabled={busy || !confirmed || !editable}
                          onClick={() =>
                            perform(async () =>
                              setCompiled(
                                await api(
                                  "/revisions/" + current.id + "/compile",
                                  {},
                                ),
                              ),
                            )
                          }
                        >
                          生成代码与规模预检
                        </button>
                        <button
                          className="btn-primary"
                          disabled={
                            busy || !confirmed || !editable || !health.runner
                          }
                          onClick={() =>
                            perform(async () => {
                              await api("/revisions/" + current.id + "/runs", {
                                request_key: crypto.randomUUID(),
                                solver: solverName,
                                time_limit: timeLimit,
                                mip_gap:
                                  mipGap.trim() === "" ? null : Number(mipGap),
                                threads,
                                seed,
                                presolve,
                              });
                              setNotice(
                                `已提交 ${solverName.toUpperCase()} 求解（限时 ${timeLimit} 秒）。`,
                              );
                              setStep(3);
                            })
                          }
                        >
                          运行已确认模型 →
                        </button>
                        {confirmed && (
                          <>
                            <a
                              className="btn-secondary button-link"
                              href={
                                "/api/revisions/" + current.id + "/export-lp"
                              }
                            >
                              下载 .lp 模型
                            </a>
                            <a
                              className="btn-secondary button-link"
                              href={
                                "/api/submissions/" +
                                selected.id +
                                "/export?revision_id=" +
                                current.id
                              }
                            >
                              下载复现 ZIP
                            </a>
                          </>
                        )}
                      </div>
                      {compiled && (
                        <div className="compiled-box">
                          {compiled.stats && (
                            <div className="stats-strip">
                              <div className="metric-tile">
                                <small>变量规模</small>
                                <strong className="num-tabular">
                                  {compiled.stats.variables}
                                </strong>
                                <small>
                                  连续 {compiled.stats.continuous} / 整数{" "}
                                  {compiled.stats.integer} / 二元{" "}
                                  {compiled.stats.binary}
                                </small>
                              </div>
                              <div className="metric-tile">
                                <small>展开约束 / 非零元</small>
                                <strong className="num-tabular">
                                  {compiled.stats.constraints} /{" "}
                                  {compiled.stats.nonzeros}
                                </strong>
                                <small>LP/MILP 稀疏矩阵规模</small>
                              </div>
                              <div className="metric-tile">
                                <small>系数跨度比 (max/min)</small>
                                <strong className="num-tabular">
                                  {compiled.stats.condition_ratio.toExponential(1)}
                                </strong>
                                <small>
                                  {compiled.stats.condition_ratio > 1e7
                                    ? "⚠ 跨度过大，存在数值病态风险"
                                    : "数值量级健康"}
                                </small>
                              </div>
                            </div>
                          )}
                          <h3>公式 → 实例 → 代码</h3>
                          <div className="table-scroll">
                            <table className="data-grid-table">
                              <thead>
                                <tr>
                                  <th>公式</th>
                                  <th>实例</th>
                                  <th>代码行</th>
                                </tr>
                              </thead>
                              <tbody>
                                {Object.entries(compiled.source_map).flatMap(
                                  ([id, rows]: [string, any]) =>
                                    rows.map((r: Obj, i: number) => (
                                      <tr key={id + i}>
                                        <td>{id}</td>
                                        <td className="input-mono">
                                          {r.instance_id || "目标"}{" "}
                                          {JSON.stringify(r.indices || [])}
                                        </td>
                                        <td className="num-tabular">
                                          {r.code_line}
                                        </td>
                                      </tr>
                                    )),
                                )}
                              </tbody>
                            </table>
                          </div>
                          {compiled.lp_text && (
                            <details>
                              <summary>标准 .lp 模型文本预览</summary>
                              <pre>{compiled.lp_text}</pre>
                            </details>
                          )}
                          <details open>
                            <summary>生成的 Python 代码</summary>
                            <pre className="code">{compiled.code}</pre>
                          </details>
                        </div>
                      )}
                    </section>
                  )}

                  {step === 3 && (
                    <div className="results-grid">
                      <section className="card">
                        <h2 className="card-title">求解结果</h2>
                        <p className="muted">
                          结果验证针对提交的数学模型，不等于证明模型符合业务题意。
                        </p>
                        {(() => {
                          const solveJobs = selected.jobs.filter(
                            (j: Obj) => j.kind === "solve",
                          );
                          const analysisJobs = selected.jobs.filter(
                            (j: Obj) => j.kind === "analyze_result",
                          );
                          if (solveJobs.length === 0) {
                            return (
                              <div className="empty-card">
                                尚未运行模型。完成确认后，可在“生成与求解”发起任务。
                              </div>
                            );
                          }
                          const [latestJob, ...olderJobs] = solveJobs;
                          const makeAnalyze = (solveJobId: string) => (
                            userRequest: string,
                            provider: "remote" | "mock",
                          ) =>
                            perform(async () => {
                              await api(`/jobs/${solveJobId}/analyze`, {
                                request_key: crypto.randomUUID(),
                                user_request: userRequest,
                                provider,
                              });
                              setNotice("正在解读求解结果并生成图表…");
                            });
                          return (
                            <>
                              <ResultView
                                key={latestJob.id}
                                job={latestJob}
                                model={selected.revisions.find(
                                  (r: Obj) => r.id === latestJob.revision_id,
                                )}
                                analysisJobs={analysisJobs}
                                health={health}
                                busy={busy}
                                onAnalyze={makeAnalyze(latestJob.id)}
                                onCancelAnalysis={(jid) =>
                                  perform(() =>
                                    api("/jobs/" + jid + "/cancel", {}),
                                  )
                                }
                                onOpenSettings={() => setPage("settings")}
                                cancel={() =>
                                  perform(() =>
                                    api("/jobs/" + latestJob.id + "/cancel", {}),
                                  )
                                }
                              />
                              {olderJobs.length > 0 && (
                                <details style={{ marginTop: 18 }}>
                                  <summary>
                                    历史求解记录（{olderJobs.length} 条）
                                  </summary>
                                  {olderJobs.map((j: Obj) => (
                                    <ResultView
                                      key={j.id}
                                      job={j}
                                      model={selected.revisions.find(
                                        (r: Obj) => r.id === j.revision_id,
                                      )}
                                      analysisJobs={analysisJobs}
                                      health={health}
                                      busy={busy}
                                      onAnalyze={makeAnalyze(j.id)}
                                      onCancelAnalysis={(jid) =>
                                        perform(() =>
                                          api("/jobs/" + jid + "/cancel", {}),
                                        )
                                      }
                                      onOpenSettings={() => setPage("settings")}
                                      cancel={() =>
                                        perform(() =>
                                          api("/jobs/" + j.id + "/cancel", {}),
                                        )
                                      }
                                    />
                                  ))}
                                </details>
                              )}
                            </>
                          );
                        })()}
                      </section>
                      <section className="card">
                        <h2 className="card-title">修订记录</h2>
                        {selected.revisions.map((r: Obj) => (
                          <div className="history-item" key={r.id}>
                            <span className="history-dot" />
                            <div className="history-content">
                              <div className="history-top">
                                <b>版本 {r.number}</b>
                                <small className="muted">
                                  {when(r.created)}
                                </small>
                              </div>
                              <p className="muted">
                                {r.source.startsWith("transcription")
                                  ? "采纳识别草稿"
                                  : "手动编辑"}{" "}
                                · {r.confirmation ? "已确认" : "待确认"}
                              </p>
                              <div className="inline-actions">
                                <button
                                  className="btn-ghost btn-sm"
                                  onClick={() => {
                                    setHistoryId(r.id);
                                    setDraft({
                                      model: clone(r.model),
                                      data: clone(r.data),
                                      assets: clone(r.assets),
                                      problem_text: r.problem_text,
                                    });
                                    setDirty(false);
                                  }}
                                >
                                  查看快照
                                </button>
                                {!selected.readonly && (
                                  <button
                                    className="btn-ghost btn-sm"
                                    onClick={() => {
                                      setDraft({
                                        model: clone(r.model),
                                        data: clone(r.data),
                                        assets: clone(r.assets),
                                        problem_text: r.problem_text,
                                      });
                                      setHistoryId("");
                                      setDirty(true);
                                      setStep(0);
                                      setReview(false);
                                    }}
                                  >
                                    复制为新草稿
                                  </button>
                                )}
                                {r.confirmation && (
                                  <a
                                    className="btn-link"
                                    href={
                                      "/api/submissions/" +
                                      selected.id +
                                      "/export?revision_id=" +
                                      r.id
                                    }
                                  >
                                    导出 ZIP
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                        {historyId && (
                          <div className="snapshot">
                            <h3>
                              历史快照 · v
                              {
                                selected.revisions.find(
                                  (r: Obj) => r.id === historyId,
                                )?.number
                              }
                            </h3>
                            <ModelPreview
                              model={draft.model}
                              data={draft.data}
                            />
                            <button
                              className="btn-secondary btn-sm"
                              onClick={() => perform(() => open(selected.id))}
                            >
                              返回当前版本
                            </button>
                          </div>
                        )}
                        <details>
                          <summary>审计事件</summary>
                          {selected.audit.map((e: Obj) => (
                            <p className="fine" key={e.id}>
                              {when(e.created)} · {e.event}
                            </p>
                          ))}
                        </details>
                      </section>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {newOpen && (
        <div className="modal-backdrop" onClick={() => setNewOpen(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label="新建模型"
            className="modal-sm card"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="card-title">新建模型</h2>
            <p className="muted">
              创建一个空白模型，或从内置参考案例初始化结构与数据。
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                perform(create);
              }}
            >
              <label>
                模型名称
                <input
                  aria-label="模型名称"
                  autoFocus
                  placeholder="例如：炼油厂生产计划"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                />
              </label>
              <label>
                初始模板
                <select
                  aria-label="初始模板"
                  value={exampleId}
                  onChange={(e) => setExampleId(e.target.value)}
                >
                  <option value="">空白模型</option>
                  {examples.map((a) => (
                    <option key={a.id} value={a.id}>
                      基于案例：{a.title}
                    </option>
                  ))}
                </select>
              </label>
              <div className="inline-actions" style={{ justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setNewOpen(false)}
                >
                  取消
                </button>
                <button type="submit" className="btn-primary" disabled={busy}>
                  创建模型
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {openModal && (
        <div className="modal-backdrop" onClick={() => setOpenModal(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label="打开已有模型"
            className="modal-md card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="section-toolbar">
              <div>
                <h2 className="card-title">打开已有模型</h2>
                <p className="muted" style={{ marginBottom: 0 }}>
                  选择历史模型继续编辑或求解；官方参考案例永久保留在“参考案例”页面。
                </p>
              </div>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setOpenModal(false)}
              >
                关闭
              </button>
            </div>
            <input
              aria-label="搜索模型"
              placeholder="输入模型名称过滤…"
              style={{ marginTop: 12 }}
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
            />
            <div className="open-model-list">
              {submissions.filter((s) =>
                s.title.toLowerCase().includes(modelSearch.trim().toLowerCase()),
              ).length === 0 ? (
                <div className="empty-card">暂无匹配的模型</div>
              ) : (
                submissions
                  .filter((s) =>
                    s.title
                      .toLowerCase()
                      .includes(modelSearch.trim().toLowerCase()),
                  )
                  .map((s) => (
                    <div
                      key={s.id}
                      className={`open-model-row ${selected?.id === s.id ? "is-current" : ""}`}
                    >
                      <div
                        className="open-model-info"
                        onClick={() => {
                          if (
                            dirty &&
                            !window.confirm(
                              "当前修改尚未保存，放弃修改并切换模型？",
                            )
                          )
                            return;
                          setOpenModal(false);
                          perform(() => open(s.id));
                        }}
                      >
                        <strong>{s.title}</strong>
                        <small className="muted">
                          v{s.version} · 创建于 {when(s.created)}
                        </small>
                      </div>
                      <div className="open-model-actions">
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          onClick={() => {
                            if (
                              dirty &&
                              !window.confirm(
                                "当前修改尚未保存，放弃修改并切换模型？",
                              )
                            )
                              return;
                            setOpenModal(false);
                            perform(() => open(s.id));
                          }}
                        >
                          打开
                        </button>
                        <button
                          type="button"
                          className="btn-ghost-danger btn-sm"
                          disabled={busy}
                          onClick={() =>
                            perform(() => deleteModelById(s.id, s.title))
                          }
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </section>
        </div>
      )}

      {dataPreview && (
        <div className="modal-backdrop" onClick={() => setDataPreview(null)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label="数据表格预览"
            className="modal card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="section-toolbar">
              <div>
                <h2 className="card-title">📊 {dataPreview.name}</h2>
                <p className="muted" style={{ marginBottom: 0 }}>
                  AI 生成模型草稿时会自动读取这些工作表中的集合成员与参数数值。
                </p>
              </div>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setDataPreview(null)}
              >
                关闭
              </button>
            </div>
            {(dataPreview.sheets || []).length > 1 && (
              <div className="segmented-control compact" style={{ marginTop: 10 }}>
                {dataPreview.sheets.map((sh: Obj, idx: number) => (
                  <button
                    key={sh.sheet_name}
                    type="button"
                    className={dataPreviewSheet === idx ? "active" : ""}
                    onClick={() => setDataPreviewSheet(idx)}
                  >
                    {sh.sheet_name}
                  </button>
                ))}
              </div>
            )}
            {(() => {
              const sheet = (dataPreview.sheets || [])[dataPreviewSheet];
              if (!sheet || !(sheet.rows || []).length) {
                return <div className="empty-card">工作表为空</div>;
              }
              return (
                <div className="table-scroll" style={{ marginTop: 12, maxHeight: "55vh" }}>
                  <table className="data-grid-table">
                    <tbody>
                      {sheet.rows.map((row: any[], rIdx: number) => (
                        <tr key={rIdx} className={rIdx === 0 ? "excel-header-row" : ""}>
                          {row.map((cell: any, cIdx: number) => (
                            <td
                              key={cIdx}
                              className={typeof cell === "number" ? "num-tabular" : ""}
                            >
                              {String(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {sheet.truncated && (
                    <p className="fine">
                      仅展示与传入 AI 前 120 行（共 {sheet.total_rows} 行）。
                    </p>
                  )}
                </div>
              );
            })()}
          </section>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
