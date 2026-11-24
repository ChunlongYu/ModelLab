import React, { useState } from "react";
import { api, Obj } from "../api";
import { ModelPreview } from "./ModelPreview";

export function ExamplesView({
  examples,
  busy,
  onUseExample,
  onError,
}: {
  examples: Obj[];
  busy: boolean;
  onUseExample: (example: Obj) => void;
  onError: (msg: string) => void;
}) {
  return (
    <section>
      <div className="case-intro">
        <h2>从一个问题，理解一种建模方法</h2>
        <p className="muted">
          浏览数学表达与实例数据，或直接创建一份可编辑的个人模型副本。
        </p>
      </div>
      <div className="case-grid">
        {examples.map((e) => (
          <ExampleCard
            key={e.id}
            item={e}
            busy={busy}
            onError={onError}
            onUse={() => onUseExample(e)}
          />
        ))}
      </div>
    </section>
  );
}

function ExampleCard({
  item,
  busy,
  onUse,
  onError,
}: {
  item: Obj;
  busy: boolean;
  onUse: () => void;
  onError: (s: string) => void;
}) {
  const [detail, setDetail] = useState<Obj | null>(null);
  const [expanded, setExpanded] = useState(false);

  return (
    <article className="card example-card">
      <span className="badge-accent">{item.category}</span>
      <h3>{item.title}</h3>
      <p className="muted">{item.description}</p>
      <p className="fine">{item.hint}</p>
      <div className="inline-actions">
        <button
          className="btn-secondary btn-sm"
          disabled={busy}
          onClick={async () => {
            try {
              if (!detail) setDetail(await api("/examples/" + item.id));
              setExpanded(!expanded);
            } catch (e) {
              onError((e as Error).message);
            }
          }}
        >
          {expanded ? "收起模型" : "查看模型与数据"}
        </button>
        <button className="btn-primary btn-sm" disabled={busy} onClick={onUse}>
          以此开始建模 →
        </button>
      </div>
      {expanded && detail && (
        <div className="case-detail">
          <p className="case-problem">{detail.problem_text}</p>
          <ModelPreview model={detail.model} data={detail.data} />
        </div>
      )}
    </article>
  );
}
