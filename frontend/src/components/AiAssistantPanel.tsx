import React, { useEffect, useRef, useState } from "react";
import { Obj } from "../api";
import { ModelPreview } from "./ModelPreview";

const QUICK_PROMPTS = [
  "逐项解释当前模型的变量与约束含义",
  "将决策变量改为整数类型",
  "检查是否遗漏了常见业务约束",
];

export function AiAssistantPanel({
  problemText,
  aiThread,
  jobs,
  dirty,
  editable,
  busy,
  health,
  onEditProblem,
  onGenerateDraft,
  onSendChat,
  onAdoptDraft,
  onClearThread,
  onCancelJob,
  onOpenSettings,
}: {
  problemText: string;
  aiThread: { draft: Obj | null; messages: Obj[] };
  jobs: Obj[];
  dirty: boolean;
  editable: boolean;
  busy: boolean;
  health: Obj;
  onEditProblem: () => void;
  onGenerateDraft: (provider: "remote" | "mock") => void;
  onSendChat: (message: string, provider: "remote" | "mock") => Promise<void>;
  onAdoptDraft: (draftObj: Obj) => void;
  onClearThread: () => void;
  onCancelJob: (jobId: string) => void;
  onOpenSettings: () => void;
}) {
  const aiDraft = aiThread?.draft || null;
  const messages: Obj[] = aiThread?.messages || [];

  const [chatInput, setChatInput] = useState("");
  const [draftOpen, setDraftOpen] = useState(true);
  const messagesBoxRef = useRef<HTMLDivElement | null>(null);

  const activeJobs = jobs.filter(
    (j) =>
      (j.kind === "generate_draft" || j.kind === "chat_draft") &&
      ["queued", "running"].includes(j.state),
  );
  const latestFailed = jobs.find(
    (j) =>
      (j.kind === "generate_draft" || j.kind === "chat_draft") &&
      j.state === "failed",
  );

  useEffect(() => {
    const el = messagesBoxRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, activeJobs.length]);

  const send = async (provider: "remote" | "mock") => {
    const text = chatInput.trim();
    if (!text) return;
    setChatInput("");
    await onSendChat(text, provider);
  };

  const canUseRemote = health.text_provider === "remote" && health.worker;
  const canUseMock = health.mock_available && health.worker;

  return (
    <div className="ai-workbench">
      {/* 1. Compact Generation Trigger Bar (linked to left problem description) */}
      <div className="ai-section-card">
        <div className="ai-section-head">
          <div className="ai-head-left">
            <span className="ai-section-title">根据左侧描述建模</span>
            <span className="ai-problem-snippet">
              {problemText.trim()
                ? problemText.trim()
                : "尚未填写，请先在左侧“问题描述”中说明需求"}
            </span>
            <button
              type="button"
              className="btn-link"
              onClick={onEditProblem}
            >
              编辑描述
            </button>
          </div>
          <div className="inline-actions" style={{ marginTop: 0, flexShrink: 0 }}>
            {health.mock_available && (
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={
                  busy ||
                  !editable ||
                  dirty ||
                  !problemText.trim() ||
                  !canUseMock ||
                  activeJobs.length > 0
                }
                onClick={() => onGenerateDraft("mock")}
              >
                模拟生成草稿（固定数据）
              </button>
            )}
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={
                busy ||
                !editable ||
                dirty ||
                !problemText.trim() ||
                !canUseRemote ||
                activeJobs.length > 0
              }
              onClick={() => onGenerateDraft("remote")}
            >
              {aiDraft ? "↻ 重新生成草稿" : "✨ 生成模型草稿"}
            </button>
          </div>
        </div>
        {dirty && (
          <p className="inline-hint warn" style={{ padding: "6px 14px" }}>
            左侧有未保存修改，请先点击“保存新版本”，再生成模型草稿。
          </p>
        )}
      </div>

      {health.text_provider !== "remote" && (
        <div className="ai-notice-bar">
          <span>尚未配置大模型连接（支持 DeepSeek、Qwen、OpenAI 等）。</span>
          <button type="button" className="btn-link" onClick={onOpenSettings}>
            前往模型设置 →
          </button>
        </div>
      )}

      {/* 2. Active Draft Sandbox */}
      {aiDraft && (
        <div className={`ai-draft-sandbox ${draftOpen ? "" : "is-collapsed"}`}>
          <div className="ai-sandbox-bar">
            <div className="ai-sandbox-title">
              <span className="status-badge ok">AI 草稿就绪</span>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setDraftOpen(!draftOpen)}
              >
                {draftOpen ? "折叠预览" : "展开预览"}
              </button>
            </div>
            <div className="ai-sandbox-actions">
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={busy || !editable}
                onClick={onClearThread}
              >
                清空
              </button>
              <button
                type="button"
                className="btn-primary btn-sm"
                disabled={busy || !editable}
                onClick={() => onAdoptDraft(aiDraft)}
              >
                采纳到左侧版本 →
              </button>
            </div>
          </div>

          {draftOpen && (
            <div className="ai-sandbox-preview">
              <ModelPreview
                model={aiDraft.symbolic_model_draft}
                data={aiDraft.data || {}}
              />
            </div>
          )}
        </div>
      )}

      {/* 3. Multi-turn Conversation */}
      <div className="ai-chat-card">
        <div className="ai-chat-header">
          <span className="ai-section-title">与 AI 讨论并微调</span>
          <span className="muted" style={{ fontSize: 11 }}>
            问答不改模型，修改指令将实时更新上方草稿
          </span>
        </div>

        <div className="ai-chat-messages" ref={messagesBoxRef}>
          {messages.length === 0 ? (
            <div className="ai-chat-empty">
              <p className="muted">
                {aiDraft
                  ? "你可以针对当前草稿提问，或直接要求调整变量、目标和约束："
                  : "生成草稿后，可在此针对每个变量/约束的含义进行提问与多轮修改。"}
              </p>
              <div className="ai-quick-prompts">
                {QUICK_PROMPTS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    className="ai-prompt-chip"
                    disabled={!editable || (!canUseRemote && !canUseMock)}
                    onClick={() => setChatInput(q)}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, idx) => (
              <div
                key={m.id || idx}
                className={`chat-bubble-row ${m.role === "user" ? "is-user" : "is-ai"}`}
              >
                <div className="chat-bubble">
                  <div className="chat-text preline">{m.content}</div>
                  {m.updated_draft && (m.changes || []).length > 0 && (
                    <div className="chat-changes">
                      <span className="chat-change-badge">已更新草稿</span>
                      <ul>
                        {m.changes.map((c: string, cIdx: number) => (
                          <li key={cIdx}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}

          {activeJobs.map((j) => (
            <div className="chat-bubble-row is-ai" key={j.id}>
              <div className="chat-bubble chat-thinking">
                <span>
                  {j.kind === "generate_draft"
                    ? "正在根据描述构建数学模型草稿…"
                    : "正在思考并检查草稿…"}
                </span>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => onCancelJob(j.id)}
                >
                  取消
                </button>
              </div>
            </div>
          ))}

          {latestFailed && activeJobs.length === 0 && (
            <div className="alert error" style={{ margin: "6px 0 0" }}>
              <span>{latestFailed.error}</span>
            </div>
          )}
        </div>

        <div className="ai-chat-composer">
          <textarea
            aria-label="与 AI 讨论草稿"
            rows={2}
            disabled={!editable || activeJobs.length > 0}
            value={chatInput}
            placeholder="提问（如：解释某条约束）或修改（如：把 x 改成整数）…"
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canUseRemote && chatInput.trim()) send("remote");
                else if (!canUseRemote && canUseMock && chatInput.trim())
                  send("mock");
              }
            }}
          />
          <div className="ai-composer-actions">
            {health.mock_available && (
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={
                  busy ||
                  !editable ||
                  !chatInput.trim() ||
                  !canUseMock ||
                  activeJobs.length > 0
                }
                onClick={() => send("mock")}
              >
                模拟发送
              </button>
            )}
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={
                busy ||
                !editable ||
                !chatInput.trim() ||
                !canUseRemote ||
                activeJobs.length > 0
              }
              onClick={() => send("remote")}
            >
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
