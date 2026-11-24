import React from "react";
import { fmt, Obj, when } from "../api";
import { ResultAnalysisPanel } from "./ResultAnalysisPanel";

export function ResultView({
  job,
  model,
  analysisJobs,
  health,
  busy,
  cancel,
  onAnalyze,
  onCancelAnalysis,
  onOpenSettings,
}: {
  job: Obj;
  model: Obj;
  analysisJobs: Obj[];
  health: Obj;
  busy: boolean;
  cancel: () => void;
  onAnalyze: (userRequest: string, provider: "remote" | "mock") => void;
  onCancelAnalysis: (jobId: string) => void;
  onOpenSettings: () => void;
}) {
  const r = job.result;
  const names: Obj = {
    optimal: "已证明所提交模型的最优解",
    infeasible: "所提交模型在当前数据下不可行",
    unbounded: "所提交模型无界",
    infeasible_or_unbounded: "不可行或无界，尚未区分",
    time_limit: "达到求解时限",
    iteration_limit: "达到迭代上限",
    numerical_error: "数值求解错误",
    unknown: "求解状态未知",
  };

  return (
    <article className="result-card">
      <div className="section-toolbar">
        <div>
          <h3 className="result-title">
            版本 {model?.number} ·{" "}
            {r ? r.warning || names[r.termination] || r.termination : job.state}
          </h3>
          <small className="muted">{when(job.created)}</small>
        </div>
        {["queued", "running"].includes(job.state) && (
          <button className="btn-secondary btn-sm" onClick={cancel}>
            取消任务
          </button>
        )}
      </div>

      {job.error && <p className="alert error">{job.error}</p>}

      {r && (
        <>
          <div className="metrics">
            <div className="metric-tile">
              <small>原目标值</small>
              <strong className="num-tabular">{fmt(r.objective_value)}</strong>
            </div>
            <div className="metric-tile">
              <small>已取得可行解</small>
              <strong>{r.has_incumbent ? "是" : "否"}</strong>
            </div>
            <div className="metric-tile">
              <small>证明最优</small>
              <strong>{r.proven_optimal ? "是" : "否"}</strong>
            </div>
            <div className="metric-tile">
              <small>求解耗时</small>
              <strong className="num-tabular">
                {typeof r.wall_time === "number"
                  ? r.wall_time.toFixed(3)
                  : fmt(r.wall_time)}{" "}
                s
              </strong>
            </div>
          </div>

          <p className="fine">
            {r.execution_mode === "local"
              ? "本机求解"
              : r.execution_mode === "docker"
                ? "Docker 求解"
                : "求解结果"}{" "}
            · 最优界 {fmt(r.best_bound)} · MIP gap {fmt(r.relative_gap)} ·{" "}
            {r.size?.variables} 个变量 / {r.size?.constraints} 条约束
          </p>

          <div
            className={
              "alert " + (r.validation?.passed ? "success" : "warning")
            }
          >
            {r.validation?.passed
              ? "独立可行性与目标值校验通过"
              : r.validation?.message || "平台校验未通过"}
          </div>

          {job.state === "succeeded" && (
            <ResultAnalysisPanel
              solveJobId={job.id}
              analysisJobs={analysisJobs}
              health={health}
              busy={busy}
              onAnalyze={onAnalyze}
              onCancel={onCancelAnalysis}
              onOpenSettings={onOpenSettings}
            />
          )}

          {r.variables ? (
            <div className="table-scroll">
              <table className="data-grid-table">
                <thead>
                  <tr>
                    <th>变量实例</th>
                    <th>数值</th>
                    <th>界限残差</th>
                    <th>整数残差</th>
                  </tr>
                </thead>
                <tbody>
                  {r.validation?.variables?.map((v: Obj) => (
                    <tr key={v.id}>
                      <td className="input-mono">
                        {v.label ||
                          `${v.source_id}${v.indices?.length ? `[${v.indices.join(", ")}]` : ""}`}
                      </td>
                      <td className="num-tabular font-semibold">
                        {fmt(v.value)}
                      </td>
                      <td className="num-tabular muted">{fmt(v.violation)}</td>
                      <td className="num-tabular muted">
                        {fmt(v.integer_violation)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">变量值：无</p>
          )}

          <details>
            <summary>约束活动值与残差</summary>
            <div className="table-scroll">
              <table className="data-grid-table">
                <thead>
                  <tr>
                    <th>公式</th>
                    <th>活动值</th>
                    <th>违反量</th>
                    <th>校验</th>
                  </tr>
                </thead>
                <tbody>
                  {r.validation?.rows?.map((v: Obj) => (
                    <tr key={v.id}>
                      <td className="input-mono">
                        {v.source_id}
                        {v.indices?.length
                          ? `[${v.indices.join(", ")}]`
                          : ""}
                      </td>
                      <td className="num-tabular">{fmt(v.activity)}</td>
                      <td className="num-tabular">{fmt(v.violation)}</td>
                      <td>{v.passed ? "通过" : "失败"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <details>
            <summary>求解日志与原始状态</summary>
            <pre>{r.raw_status + "\n" + (r.log || "")}</pre>
          </details>
        </>
      )}
    </article>
  );
}
