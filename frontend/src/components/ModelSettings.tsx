import React, { useEffect, useState } from "react";
import { api, Obj } from "../api";

type ProviderPreset = {
  id: string;
  name: string;
  connection: "compatible" | "local";
  endpoint: string;
  note: string;
  models: { id: string; label: string; vision: boolean; jsonMode: boolean }[];
};

const PROVIDERS: ProviderPreset[] = [
  {
    id: "dashscope",
    name: "阿里云百炼 (Qwen)",
    connection: "compatible",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    note: "推荐用于手写公式识别，需在百炼控制台获取 API Key。",
    models: [
      { id: "qwen-vl-max", label: "qwen-vl-max（推荐 · 支持图像）", vision: true, jsonMode: true },
      { id: "qwen-vl-plus", label: "qwen-vl-plus（支持图像）", vision: true, jsonMode: true },
      { id: "qwen2.5-vl-72b-instruct", label: "qwen2.5-vl-72b-instruct（支持图像）", vision: true, jsonMode: false },
      { id: "qwen-plus", label: "qwen-plus（仅文本）", vision: false, jsonMode: true },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    connection: "compatible",
    endpoint: "https://api.openai.com/v1",
    note: "支持多模态图像识别与结构化 JSON 输出。",
    models: [
      { id: "gpt-4o", label: "gpt-4o（推荐 · 支持图像）", vision: true, jsonMode: true },
      { id: "gpt-4.1", label: "gpt-4.1（支持图像）", vision: true, jsonMode: true },
      { id: "gpt-4o-mini", label: "gpt-4o-mini（轻量 · 支持图像）", vision: true, jsonMode: true },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    connection: "compatible",
    endpoint: "https://api.deepseek.com/v1",
    note: "注意：DeepSeek 官方接口暂不支持图片输入，仅可用于文本连通测试。",
    models: [
      { id: "deepseek-chat", label: "deepseek-chat（仅文本）", vision: false, jsonMode: true },
      { id: "deepseek-reasoner", label: "deepseek-reasoner（仅文本）", vision: false, jsonMode: false },
    ],
  },
  {
    id: "zhipu",
    name: "智谱 AI (GLM)",
    connection: "compatible",
    endpoint: "https://open.bigmodel.cn/api/paas/v4",
    note: "GLM-4V 系列支持手写公式图像识别。",
    models: [
      { id: "glm-4v-plus", label: "glm-4v-plus（支持图像）", vision: true, jsonMode: false },
      { id: "glm-4v-flash", label: "glm-4v-flash（免费/轻量 · 支持图像）", vision: true, jsonMode: false },
      { id: "glm-4-plus", label: "glm-4-plus（仅文本）", vision: false, jsonMode: false },
    ],
  },
  {
    id: "siliconflow",
    name: "硅基流动 (SiliconFlow)",
    connection: "compatible",
    endpoint: "https://api.siliconflow.cn/v1",
    note: "国内聚合平台，支持 Qwen2.5-VL 等开源视觉模型。",
    models: [
      { id: "Qwen/Qwen2.5-VL-72B-Instruct", label: "Qwen2.5-VL-72B-Instruct（支持图像）", vision: true, jsonMode: false },
      { id: "Pro/Qwen/Qwen2.5-VL-7B-Instruct", label: "Qwen2.5-VL-7B-Instruct（支持图像）", vision: true, jsonMode: false },
      { id: "deepseek-ai/DeepSeek-V3", label: "DeepSeek-V3（仅文本）", vision: false, jsonMode: true },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    connection: "compatible",
    endpoint: "https://openrouter.ai/api/v1",
    note: "统一接入多家云端视觉模型。",
    models: [
      { id: "openai/gpt-4o", label: "openai/gpt-4o（支持图像）", vision: true, jsonMode: true },
      { id: "anthropic/claude-3.7-sonnet", label: "anthropic/claude-3.7-sonnet（支持图像）", vision: true, jsonMode: false },
      { id: "qwen/qwen2.5-vl-72b-instruct", label: "qwen/qwen2.5-vl-72b-instruct（支持图像）", vision: true, jsonMode: false },
    ],
  },
  {
    id: "ollama",
    name: "本机 Ollama",
    connection: "local",
    endpoint: "http://127.0.0.1:11434/v1",
    note: "本机运行无需 API Key，需先拉取视觉模型（如 ollama pull qwen2.5vl:7b）。",
    models: [
      { id: "qwen2.5vl:7b", label: "qwen2.5vl:7b（推荐 · 支持图像）", vision: true, jsonMode: false },
      { id: "llama3.2-vision", label: "llama3.2-vision（支持图像）", vision: true, jsonMode: false },
      { id: "llava", label: "llava（支持图像）", vision: true, jsonMode: false },
    ],
  },
  {
    id: "lmstudio",
    name: "本机 LM Studio",
    connection: "local",
    endpoint: "http://127.0.0.1:1234/v1",
    note: "本机开启 Local Server 后无需填写 API Key。",
    models: [],
  },
  {
    id: "custom",
    name: "自定义（兼容 OpenAI 接口）",
    connection: "compatible",
    endpoint: "",
    note: "手动填写任意兼容 Chat Completions 的服务商地址与模型名称。",
    models: [],
  },
];

function detectProviderId(endpoint: string, connection: string): string {
  const clean = (endpoint || "").trim().replace(/\/+$/, "");
  if (!clean) return "custom";
  const found = PROVIDERS.find(
    (p) => p.endpoint && p.endpoint.replace(/\/+$/, "") === clean,
  );
  if (found) return found.id;
  if (connection === "local") return "lmstudio";
  return "custom";
}

export function ModelSettings({ onSaved }: { onSaved: () => Promise<void> }) {
  const [saved, setSaved] = useState<Obj | null>(null);
  const [providerId, setProviderId] = useState("custom");
  const [form, setForm] = useState<Obj>({
    connection: "compatible",
    endpoint: "",
    model: "",
    vision: true,
    json_mode: false,
  });
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    api("/settings/model")
      .then((c) => {
        setSaved(c);
        setForm(c);
        setProviderId(detectProviderId(c.endpoint, c.connection));
      })
      .catch((e) => setError(e.message));
  }, []);

  const currentProvider =
    PROVIDERS.find((p) => p.id === providerId) || PROVIDERS[PROVIDERS.length - 1];

  const update = (patch: Obj) => {
    setForm({ ...form, ...patch });
    setChanged(true);
    setMessage("");
  };

  const handleProviderChange = (pid: string) => {
    setProviderId(pid);
    const preset = PROVIDERS.find((p) => p.id === pid);
    if (!preset) return;
    const firstModel = preset.models[0];
    setForm({
      ...form,
      connection: preset.connection,
      endpoint: preset.id === "custom" ? form.endpoint : preset.endpoint,
      model: firstModel ? firstModel.id : form.model,
      vision: firstModel ? firstModel.vision : form.vision,
      json_mode: firstModel ? firstModel.jsonMode : form.json_mode,
    });
    setChanged(true);
    setMessage("");
  };

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const isPresetModel = currentProvider.models.some((m) => m.id === form.model);

  return (
    <div className="settings-layout">
      <section className="card">
        <h2 className="card-title">连接你的大模型</h2>
        <p className="muted">
          选择常用模型服务商并填写 API Key 即可使用，无需手动查找接口地址；也支持自定义兼容接口。
        </p>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        {message && (
          <div className="alert success" role="status">
            {message}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act(async () => {
              const body = {
                connection: form.connection,
                endpoint: form.endpoint,
                model: form.model,
                vision: form.vision,
                json_mode: form.json_mode,
                ...(key.trim() ? { api_key: key.trim() } : {}),
              };
              const c = await api("/settings/model", body, "PUT");
              setSaved(c);
              setForm(c);
              setProviderId(detectProviderId(c.endpoint, c.connection));
              setKey("");
              setChanged(false);
              await onSaved();
              setMessage(
                c.vision_ready
                  ? "连接配置已保存，可以返回工作区识别图片。"
                  : "连接配置已保存；启用图像输入后可识别手写模型。",
              );
            });
          }}
        >
          <label>
            模型服务商 (API Provider)
            <select
              disabled={busy || !saved}
              value={providerId}
              onChange={(e) => handleProviderChange(e.target.value)}
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <p className="fine">{currentProvider.note}</p>

          <label>
            API Key
            <input
              disabled={busy || !saved}
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              placeholder={
                saved?.key_configured
                  ? "已保存；留空保留，输入新值替换"
                  : form.connection === "local"
                    ? "本机服务不需要密钥时可留空"
                    : "粘贴服务商提供的 API Key"
              }
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setChanged(true);
              }}
            />
          </label>
          <p className="fine">
            {saved?.key_configured
              ? "密钥状态：已保存。"
              : "密钥状态：未保存。"}{" "}
            更换 API 地址时需重新输入对应密钥。
          </p>

          {currentProvider.models.length > 0 && (
            <label>
              选择预设模型
              <select
                disabled={busy || !saved}
                value={isPresetModel ? form.model : "__custom__"}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "__custom__") {
                    update({ model: "" });
                  } else {
                    const m = currentProvider.models.find((x) => x.id === val);
                    update({
                      model: val,
                      vision: m ? m.vision : form.vision,
                      json_mode: m ? m.jsonMode : form.json_mode,
                    });
                  }
                }}
              >
                {currentProvider.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
                <option value="__custom__">手动输入其他模型名…</option>
              </select>
            </label>
          )}

          <label>
            模型名称
            <input
              disabled={busy || !saved}
              required
              className="input-mono"
              placeholder="填写或微调模型名称，如 qwen-vl-max"
              value={form.model}
              onChange={(e) => update({ model: e.target.value })}
            />
          </label>

          <details
            className="advanced-collapse"
            open={providerId === "custom" || !form.endpoint}
          >
            <summary>
              接口地址与高级参数（{form.endpoint || "点击填写 API 地址"}）
            </summary>
            <div style={{ marginTop: 8 }}>
              <label>
                连接方式
                <select
                  disabled={busy || !saved}
                  value={form.connection}
                  onChange={(e) => update({ connection: e.target.value })}
                >
                  <option value="compatible">
                    兼容 Chat Completions 的云端 API
                  </option>
                  <option value="local">本机模型服务（兼容接口）</option>
                </select>
              </label>
              <label>
                API 地址
                <input
                  disabled={busy || !saved}
                  type="url"
                  required
                  className="input-mono"
                  placeholder={
                    form.connection === "local"
                      ? "http://127.0.0.1:1234/v1"
                      : "https://your-provider.example/v1"
                  }
                  value={form.endpoint}
                  onChange={(e) => {
                    const val = e.target.value;
                    update({ endpoint: val });
                    setProviderId(detectProviderId(val, form.connection));
                  }}
                />
              </label>
              <p className="fine">
                已按所选服务商自动填写 Base URL，一般无需修改；也支持自定义中转地址。
              </p>
            </div>
          </details>

          <label className="check">
            <input
              disabled={busy || !saved}
              type="checkbox"
              checked={form.vision}
              onChange={(e) => update({ vision: e.target.checked })}
            />
            该模型支持图像输入，用于识别手写模型
          </label>
          <label className="check">
            <input
              disabled={busy || !saved}
              type="checkbox"
              checked={form.json_mode}
              onChange={(e) => update({ json_mode: e.target.checked })}
            />
            启用 JSON 模式（服务支持时使用）
          </label>

          <div className="inline-actions">
            <button className="btn-primary" disabled={busy || !saved}>
              保存连接
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || changed || !saved?.configured}
              onClick={() =>
                act(async () => {
                  const r = await api("/settings/model/test", {});
                  setMessage(r.message);
                })
              }
            >
              测试连接
            </button>
            <button
              type="button"
              className="btn-ghost-danger"
              disabled={busy || !saved}
              onClick={() => {
                if (
                  !window.confirm(
                    "确定删除本机配置文件中所有已保存的 API Key 和模型连接？打包分发前请务必执行此操作。",
                  )
                )
                  return;
                act(async () => {
                  const c = await api("/settings/model", undefined, "DELETE");
                  setSaved(c);
                  setForm(c);
                  setProviderId("custom");
                  setKey("");
                  setChanged(false);
                  await onSaved();
                  setMessage("已清空所有已保存的 API Key 与连接配置。");
                });
              }}
            >
              删除所有已保存 API Key
            </button>
          </div>
          <p className="fine">
            测试连接会发送一条简短文本请求，可能产生少量 API
            用量；图像能力需通过实际识别验证。
          </p>
        </form>
      </section>
      <aside className="card">
        <h2 className="card-title">AI 能力使用步骤</h2>
        <ol className="settings-steps">
          <li>在左侧选择模型服务商并填写 API Key（支持 DeepSeek、Qwen、OpenAI 及本机 Ollama）。</li>
          <li>保存连接后可点击“测试连接”验证连通性。</li>
          <li>回到工作区右侧，在“建模描述与 AI 建模”输入问题描述并一键生成草稿。</li>
          <li>在“模型诊断”中检查模型是否漏约束、方向错误或界限缺失。</li>
        </ol>
        <p className="fine">
          <strong>安全与打包提醒：</strong>API Key 仅保存在本机{" "}
          <code>.runtime/model-service.json</code>（0600 权限）中，不会写入数据库、浏览器存储或模型导出 ZIP。打包为
          Windows 可执行文件发给学生前，请点击左侧{" "}
          <strong>“删除所有已保存 API Key”</strong>，并确保不要将{" "}
          <code>.runtime/</code> 或 <code>.env</code> 一起打包分发。
        </p>
      </aside>
    </div>
  );
}
