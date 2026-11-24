import React, { useState } from "react";
import { fmt, Obj, when } from "../api";

const PALETTE = [
  "#0071e3",
  "#34c759",
  "#ff9500",
  "#af52de",
  "#5ac8fa",
  "#ff2d55",
  "#5856d6",
  "#ffcc00",
];

const QUICK_ANALYSES = [
  "解读最优方案、关键紧平衡约束与富余资源",
  "生成决策变量对比表与柱状图",
  "按业务类别汇总成本/产量占比饼图",
];

function SvgChart({ chart }: { chart: Obj }) {
  const data: { label: string; value: number }[] = chart.data || [];
  if (data.length === 0) return null;
  const unit = chart.unit ? ` (${chart.unit})` : "";

  if (chart.type === "pie") {
    const total = data.reduce((s, d) => s + Math.max(0, d.value), 0) || 1;
    let angle = -Math.PI / 2;
    const cx = 80;
    const cy = 80;
    const rOuter = 66;
    const rInner = 38;

    return (
      <div className="chart-card">
        <div className="chart-title">
          {chart.title}
          {unit}
        </div>
        <div className="pie-layout">
          <svg width="160" height="160" viewBox="0 0 160 160">
            {data.map((d, i) => {
              const val = Math.max(0, d.value);
              const slice = (val / total) * Math.PI * 2;
              if (slice <= 0.001) return null;
              if (slice >= Math.PI * 2 - 0.001) {
                return (
                  <circle
                    key={i}
                    cx={cx}
                    cy={cy}
                    r={(rOuter + rInner) / 2}
                    fill="none"
                    stroke={PALETTE[i % PALETTE.length]}
                    strokeWidth={rOuter - rInner}
                  />
                );
              }
              const x1 = cx + rOuter * Math.cos(angle);
              const y1 = cy + rOuter * Math.sin(angle);
              const x2 = cx + rOuter * Math.cos(angle + slice);
              const y2 = cy + rOuter * Math.sin(angle + slice);
              const ix2 = cx + rInner * Math.cos(angle + slice);
              const iy2 = cy + rInner * Math.sin(angle + slice);
              const ix1 = cx + rInner * Math.cos(angle);
              const iy1 = cy + rInner * Math.sin(angle);
              const large = slice > Math.PI ? 1 : 0;
              const dPath = [
                `M ${x1} ${y1}`,
                `A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2}`,
                `L ${ix2} ${iy2}`,
                `A ${rInner} ${rInner} 0 ${large} 0 ${ix1} ${iy1}`,
                "Z",
              ].join(" ");
              angle += slice;
              return (
                <path
                  key={i}
                  d={dPath}
                  fill={PALETTE[i % PALETTE.length]}
                  stroke="#fff"
                  strokeWidth="1.5"
                />
              );
            })}
          </svg>
          <div className="pie-legend">
            {data.map((d, i) => {
              const pct = ((Math.max(0, d.value) / total) * 100).toFixed(1);
              return (
                <div className="pie-legend-row" key={i}>
                  <span
                    className="pie-dot"
                    style={{ background: PALETTE[i % PALETTE.length] }}
                  />
                  <span className="pie-label">{d.label}</span>
                  <span className="pie-val num-tabular">
                    {fmt(d.value)} ({pct}%)
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (chart.type === "line") {
    const W = 440;
    const H = 190;
    const padL = 44;
    const padR = 18;
    const padT = 22;
    const padB = 34;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const vals = data.map((d) => d.value);
    const minV = Math.min(0, ...vals);
    const maxV = Math.max(...vals, minV + 1);
    const span = maxV - minV || 1;
    const pts = data.map((d, i) => {
      const x =
        padL + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
      const y = padT + innerH - ((d.value - minV) / span) * innerH;
      return { x, y, ...d };
    });
    const poly = pts.map((p) => `${p.x},${p.y}`).join(" ");
    const area =
      pts.length > 0
        ? `${pts[0].x},${padT + innerH} ${poly} ${pts[pts.length - 1].x},${padT + innerH}`
        : "";

    return (
      <div className="chart-card">
        <div className="chart-title">
          {chart.title}
          {unit}
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg">
          <line
            x1={padL}
            y1={padT + innerH}
            x2={W - padR}
            y2={padT + innerH}
            stroke="rgba(0,0,0,0.12)"
          />
          {area && <polygon points={area} fill="rgba(0,113,227,0.1)" />}
          <polyline
            fill="none"
            stroke="#0071e3"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={poly}
          />
          {pts.map((p, i) => (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r="4" fill="#0071e3" stroke="#fff" strokeWidth="1.5" />
              <text
                x={p.x}
                y={p.y - 8}
                textAnchor="middle"
                fontSize="10"
                fill="#1d1d1f"
              >
                {fmt(p.value)}
              </text>
              <text
                x={p.x}
                y={H - 12}
                textAnchor="middle"
                fontSize="10"
                fill="#6e6e73"
              >
                {p.label.length > 10 ? p.label.slice(0, 9) + "…" : p.label}
              </text>
            </g>
          ))}
        </svg>
      </div>
    );
  }

  // Default: Bar Chart
  const W = 440;
  const H = 190;
  const padL = 24;
  const padR = 24;
  const padT = 24;
  const padB = 34;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const maxV = Math.max(...data.map((d) => Math.max(0, d.value)), 1);
  const slotW = innerW / data.length;
  const barW = Math.min(44, slotW * 0.58);

  return (
    <div className="chart-card">
      <div className="chart-title">
        {chart.title}
        {unit}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg">
        <line
          x1={padL}
          y1={padT + innerH}
          x2={W - padR}
          y2={padT + innerH}
          stroke="rgba(0,0,0,0.12)"
        />
        {data.map((d, i) => {
          const val = Math.max(0, d.value);
          const barH = (val / maxV) * innerH;
          const x = padL + i * slotW + (slotW - barW) / 2;
          const y = padT + innerH - barH;
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(2, barH)}
                rx="5"
                fill={PALETTE[i % PALETTE.length]}
              />
              <text
                x={x + barW / 2}
                y={y - 6}
                textAnchor="middle"
                fontSize="10"
                fontWeight="600"
                fill="#1d1d1f"
              >
                {fmt(d.value)}
              </text>
              <text
                x={x + barW / 2}
                y={H - 12}
                textAnchor="middle"
                fontSize="10"
                fill="#6e6e73"
              >
                {d.label.length > 10 ? d.label.slice(0, 9) + "…" : d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function ResultAnalysisPanel({
  solveJobId,
  analysisJobs,
  health,
  busy,
  onAnalyze,
  onCancel,
  onOpenSettings,
}: {
  solveJobId: string;
  analysisJobs: Obj[];
  health: Obj;
  busy: boolean;
  onAnalyze: (userRequest: string, provider: "remote" | "mock") => void;
  onCancel: (jobId: string) => void;
  onOpenSettings: () => void;
}) {
  const [reqText, setReqText] = useState("");
  const running = analysisJobs.find((j) =>
    ["queued", "running"].includes(j.state),
  );
  const completed = analysisJobs.filter(
    (j) =>
      j.state === "succeeded" &&
      j.result?.solve_job_id === solveJobId,
  );
  const latest = completed[0];
  const failed = analysisJobs.find((j) => j.state === "failed");

  const canRemote = health.text_provider === "remote" && health.worker;
  const canMock = health.mock_available && health.worker;

  return (
    <div className="analysis-box">
      <div className="analysis-head">
        <div>
          <strong>AI 结果解读与图表总结</strong>
          <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
            翻译业务方案、排查无解原因，或按你的要求生成汇总表格与图表
          </span>
        </div>
      </div>

      <div className="analysis-quick-row">
        {QUICK_ANALYSES.map((q) => (
          <button
            key={q}
            type="button"
            className="ai-prompt-chip"
            onClick={() => setReqText(q)}
          >
            {q}
          </button>
        ))}
      </div>

      <div className="analysis-input-row">
        <input
          aria-label="结果分析要求"
          placeholder="可选：输入定制总结要求，如“按原油种类画采购量柱状图和成本表”（留空则全面解读）"
          value={reqText}
          onChange={(e) => setReqText(e.target.value)}
        />
        {health.mock_available && (
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={busy || !canMock || !!running}
            onClick={() => onAnalyze(reqText, "mock")}
          >
            模拟解读
          </button>
        )}
        <button
          type="button"
          className="btn-primary btn-sm"
          disabled={busy || !canRemote || !!running}
          onClick={() => onAnalyze(reqText, "remote")}
        >
          {running ? "分析中…" : latest ? "↻ 重新解读与制图" : "✨ AI 解读结果"}
        </button>
      </div>

      {health.text_provider !== "remote" && (
        <p className="fine" style={{ margin: "6px 0 0" }}>
          尚未配置大模型连接。{" "}
          <button type="button" className="btn-link" onClick={onOpenSettings}>
            前往模型设置 →
          </button>
        </p>
      )}

      {running && (
        <div className="inline-actions" style={{ marginTop: 8 }}>
          <span className="muted">正在解读求解数据并生成图表…</span>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => onCancel(running.id)}
          >
            取消
          </button>
        </div>
      )}

      {failed && !running && (
        <p className="error-text" style={{ marginTop: 8 }}>
          {failed.error}
        </p>
      )}

      {latest?.result && (
        <div className="analysis-result">
          <div className="analysis-meta">
            <span className="badge-accent" style={{ marginBottom: 0 }}>
              AI 决策摘要
            </span>
            <small className="muted">{when(latest.created)}</small>
          </div>
          <p className="analysis-summary">{latest.result.summary}</p>

          {(latest.result.highlights || []).length > 0 && (
            <ul className="analysis-highlights">
              {latest.result.highlights.map((h: string, i: number) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          )}

          {(latest.result.charts || []).length > 0 && (
            <div className="charts-grid">
              {latest.result.charts.map((c: Obj, i: number) => (
                <SvgChart key={i} chart={c} />
              ))}
            </div>
          )}

          {(latest.result.tables || []).length > 0 && (
            <div className="analysis-tables">
              {latest.result.tables.map((t: Obj, tIdx: number) => (
                <div className="analysis-table-card" key={tIdx}>
                  <div className="chart-title">{t.title}</div>
                  <div className="table-scroll">
                    <table className="data-grid-table">
                      <thead>
                        <tr>
                          {(t.columns || []).map((col: string, cIdx: number) => (
                            <th key={cIdx}>{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(t.rows || []).map((row: any[], rIdx: number) => (
                          <tr key={rIdx}>
                            {row.map((cell: any, cIdx: number) => (
                              <td
                                key={cIdx}
                                className={
                                  typeof cell === "number" ? "num-tabular" : ""
                                }
                              >
                                {typeof cell === "number" ? fmt(cell) : String(cell)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
