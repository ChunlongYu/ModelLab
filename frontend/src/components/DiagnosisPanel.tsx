import React from "react";
import { Obj, when } from "../api";

const SEVERITY_LABEL: Record<string, string> = {
  high: "高风险",
  medium: "建议核对",
  low: "提示",
};

const CATEGORY_LABEL: Record<string, string> = {
  missing_constraint: "可能遗漏约束",
  sense_or_direction: "方向 / 不等号",
  variable_domain: "变量类型 / 界限",
  data_or_scale: "参数 / 量级",
  other: "其他建议",
};

export function DiagnosisPanel({
  model,
  jobs,
  currentRevisionId,
  dirty,
  editable,
  busy,
  health,
  onRunDiagnose,
  onCancelJob,
  onOpenSettings,
  onJumpTarget,
}: {
  model: Obj;
  jobs: Obj[];
  currentRevisionId: string;
  dirty: boolean;
  editable: boolean;
  busy: boolean;
  health: Obj;
  onRunDiagnose: (provider: "remote" | "mock") => void;
  onCancelJob: (jobId: string) => void;
  onOpenSettings: () => void;
  onJumpTarget: (targetId: string) => void;
}) {
  const diagJobs = jobs.filter((j) => j.kind === "diagnose");
  const latest = diagJobs[0];

  const hasTarget = (id: string) => {
    if (!id) return false;
    return (
      (model.sets || []).some((x: Obj) => x.id === id) ||
      (model.parameters || []).some((x: Obj) => x.id === id) ||
      (model.variables || []).some((x: Obj) => x.id === id) ||
      model.objective?.id === id ||
      (model.constraints || []).some((x: Obj) => x.id === id)
    );
  };

  return (
    <div className="diag-panel">
      <p className="fine">
        AI 将结合“问题背景”与当前数学模型，独立检查是否漏约束、不等号写反或变量界限不合理。诊断不会自动修改模型。
      </p>

      <div className="inline-actions" style={{ marginTop: 4 }}>
        <button
          type="button"
          className="btn-primary btn-sm"
          disabled={
            busy ||
            !editable ||
            dirty ||
            health.text_provider !== "remote" ||
            !health.worker
          }
          onClick={() => onRunDiagnose("remote")}
        >
          🔍 AI 检查当前模型
        </button>
        {health.mock_available && (
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={busy || !editable || dirty || !health.worker}
            onClick={() => onRunDiagnose("mock")}
          >
            模拟诊断（固定数据）
          </button>
        )}
      </div>

      {dirty && (
        <p className="inline-hint warn" style={{ marginTop: 8 }}>
          当前有未保存修改，请先点击“保存新版本”，再进行模型诊断。
        </p>
      )}

      {health.text_provider !== "remote" && (
        <p className="fine" style={{ marginTop: 8 }}>
          尚未配置大模型连接（支持 DeepSeek、Qwen、OpenAI 等）。{" "}
          <button type="button" className="btn-link" onClick={onOpenSettings}>
            前往模型设置 →
          </button>
        </p>
      )}

      {diagJobs.length === 0 ? (
        <div className="empty-card" style={{ marginTop: 12 }}>
          尚未运行模型诊断。保存版本后点击上方按钮开始检查。
        </div>
      ) : (
        <div className="diag-list">
          {diagJobs.map((j) => {
            const isCurrent = j.revision_id === currentRevisionId;
            return (
              <div className="diag-job-card" key={j.id}>
                <div className="diag-job-header">
                  <strong>
                    {j.state === "succeeded"
                      ? "诊断报告"
                      : j.state === "failed"
                        ? "诊断失败"
                        : `诊断中 · ${j.state}`}
                  </strong>
                  <span className="muted" style={{ fontSize: 11 }}>
                    {isCurrent ? "当前版本" : "历史版本"} · {when(j.created)}
                  </span>
                </div>

                {["queued", "running"].includes(j.state) && (
                  <div className="inline-actions">
                    <span className="muted">正在分析数学模型…</span>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => onCancelJob(j.id)}
                    >
                      取消
                    </button>
                  </div>
                )}

                {j.error && <p className="error-text">{j.error}</p>}

                {j.state === "succeeded" && j.result && (
                  <div className="diag-result">
                    <p className="diag-summary">{j.result.summary}</p>
                    {(j.result.issues || []).length === 0 ? (
                      <div className="alert success" style={{ marginBottom: 0 }}>
                        未发现明显建模结构或逻辑问题。
                      </div>
                    ) : (
                      <div className="diag-issues">
                        {j.result.issues.map((issue: Obj, idx: number) => (
                          <div
                            key={idx}
                            className={`diag-issue-card sev-${issue.severity}`}
                          >
                            <div className="diag-issue-top">
                              <span className={`sev-badge sev-${issue.severity}`}>
                                {SEVERITY_LABEL[issue.severity] || issue.severity}
                              </span>
                              <span className="cat-badge">
                                {CATEGORY_LABEL[issue.category] || issue.category}
                              </span>
                              {issue.target_id && hasTarget(issue.target_id) && (
                                <button
                                  type="button"
                                  className="btn-link"
                                  style={{ marginLeft: "auto" }}
                                  onClick={() => onJumpTarget(issue.target_id)}
                                >
                                  定位到 {issue.target_id} →
                                </button>
                              )}
                            </div>
                            <div className="diag-issue-title">{issue.title}</div>
                            <p className="diag-issue-detail">{issue.detail}</p>
                            <p className="diag-issue-suggestion">
                              <strong>建议：</strong>
                              {issue.suggestion}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                    {j.id === latest?.id && (
                      <p className="fine" style={{ marginTop: 8, marginBottom: 0 }}>
                        模型：{j.result.model} · 建议仅供参考，请在左侧手动修改并保存新版本。
                      </p>
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
