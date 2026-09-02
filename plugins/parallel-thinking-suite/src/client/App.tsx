import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentDraft,
  AgentSummary,
  ParserRecord,
  ProviderId,
  ProviderStatus,
  RunEvent,
  RunManifest,
  SelectionMode,
} from "../shared/types.js";

type Page = "run" | "agents" | "providers" | "knowledge" | "parsers";

const statusLabels: Record<string, string> = {
  queued: "排队",
  running: "生成中",
  completed: "已完成",
  partial: "部分完成",
  failed: "失败",
  cancelled: "已取消",
  discovered: "已发现",
  validating: "验证中",
  canary: "灰度中",
  active: "已启用",
  deprecated: "已弃用",
  disabled: "已停用",
  rolled_back: "已回滚",
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
  return body as T;
}

function useInitialRunId(): string | undefined {
  return location.pathname.match(/^\/runs\/([a-zA-Z0-9_-]+)$/)?.[1];
}

export function App() {
  const [page, setPage] = useState<Page>("run");
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [parsers, setParsers] = useState<ParserRecord[]>([]);
  const [runs, setRuns] = useState<RunManifest[]>([]);
  const [notice, setNotice] = useState<string>("");
  const initialRunId = useInitialRunId();

  const refresh = async () => {
    const [agentData, providerData, parserData, runData] = await Promise.all([
      api<AgentSummary[]>("/api/agents"),
      api<ProviderStatus[]>("/api/providers"),
      api<ParserRecord[]>("/api/parsers"),
      api<RunManifest[]>("/api/runs"),
    ]);
    setAgents(agentData);
    setProviders(providerData);
    setParsers(parserData);
    setRuns(runData);
  };

  useEffect(() => {
    void refresh().catch((error) => setNotice(error.message));
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setPage("run")} aria-label="返回运行页">
          <span className="brand-mark"><i /><i /><i /></span>
          <span><b>并行思考</b><small>Parallel desk</small></span>
        </button>
        <nav aria-label="主导航">
          <NavButton active={page === "run"} label="运行" hint="实时思考轨道" icon="↗" onClick={() => setPage("run")} />
          <NavButton active={page === "agents"} label="Agent 配置" hint="角色与模型" icon="◎" onClick={() => setPage("agents")} />
          <NavButton active={page === "providers"} label="API 连接" hint="三家厂商状态" icon="⌁" onClick={() => setPage("providers")} />
          <NavButton active={page === "knowledge"} label="知识库" hint="共享与私有资料" icon="▤" onClick={() => setPage("knowledge")} />
          <NavButton active={page === "parsers"} label="解析器" hint="类型与生命周期" icon="◇" onClick={() => setPage("parsers")} />
        </nav>
        <div className="sidebar-footer">
          <span className="local-dot" />仅在本机运行
          <small>密钥只读取服务端环境变量</small>
        </div>
      </aside>

      <main className="workspace">
        {notice && <div className="notice" role="status"><span>{notice}</span><button onClick={() => setNotice("")}>关闭</button></div>}
        {page === "run" && (
          <RunPage
            agents={agents}
            providers={providers}
            runs={runs}
            initialRunId={initialRunId}
            onRunsChanged={() => void refresh()}
            onNotice={setNotice}
          />
        )}
        {page === "agents" && <AgentsPage agents={agents} onChanged={refresh} onNotice={setNotice} />}
        {page === "providers" && <ProvidersPage providers={providers} onNotice={setNotice} />}
        {page === "knowledge" && <KnowledgePage agents={agents} onNotice={setNotice} />}
        {page === "parsers" && <ParsersPage parsers={parsers} onChanged={refresh} onNotice={setNotice} />}
      </main>
    </div>
  );
}

function NavButton(props: { active: boolean; label: string; hint: string; icon: string; onClick: () => void }) {
  return (
    <button className={props.active ? "nav-button active" : "nav-button"} onClick={props.onClick}>
      <span className="nav-icon">{props.icon}</span>
      <span><b>{props.label}</b><small>{props.hint}</small></span>
    </button>
  );
}

function PageTitle(props: { eyebrow: string; title: string; description: string; aside?: React.ReactNode }) {
  return (
    <header className="page-title">
      <div>
        <span className="eyebrow">{props.eyebrow}</span>
        <h1>{props.title}</h1>
        <p>{props.description}</p>
      </div>
      {props.aside}
    </header>
  );
}

function RunPage(props: {
  agents: AgentSummary[];
  providers: ProviderStatus[];
  runs: RunManifest[];
  initialRunId?: string;
  onRunsChanged: () => void;
  onNotice: (message: string) => void;
}) {
  const workerAgents = props.agents.filter((agent) => agent.extension.role === "worker");
  const [query, setQuery] = useState("");
  const [context, setContext] = useState("");
  const [contextMode, setContextMode] = useState<"summary" | "prompt-only" | "full">("summary");
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("auto");
  const [selectedIds, setSelectedIds] = useState<string[]>(workerAgents.filter((agent) => agent.extension.enabled).map((agent) => agent.id));
  const [decompose, setDecompose] = useState(false);
  const [run, setRun] = useState<RunManifest>();
  const [starting, setStarting] = useState(false);
  const eventSource = useRef<EventSource | null>(null);

  useEffect(() => {
    if (selectedIds.length === 0 && workerAgents.length > 0) {
      setSelectedIds(workerAgents.filter((agent) => agent.extension.enabled).map((agent) => agent.id));
    }
  }, [props.agents.length]);

  useEffect(() => {
    if (!props.initialRunId) return;
    void api<RunManifest>(`/api/runs/${props.initialRunId}`).then((value) => {
      setRun(value);
      if (value.status === "running" || value.status === "queued") subscribe(value.id);
    }).catch((error) => props.onNotice(error.message));
    return () => eventSource.current?.close();
  }, [props.initialRunId]);

  const subscribe = (runId: string) => {
    eventSource.current?.close();
    const source = new EventSource(`/api/runs/${runId}/events`);
    eventSource.current = source;
    source.addEventListener("snapshot", (message) => setRun(JSON.parse((message as MessageEvent).data)));
    const events: RunEvent["type"][] = [
      "agent_started", "text_delta", "usage", "agent_completed", "agent_failed",
      "agent_cancelled", "run_completed", "run_cancelled", "synthesis_completed",
    ];
    for (const type of events) {
      source.addEventListener(type, (message) => {
        const event = JSON.parse((message as MessageEvent).data) as RunEvent;
        if (event.type === "text_delta" && event.agentId && event.delta) {
          setRun((current) => current ? ({
            ...current,
            agents: {
              ...current.agents,
              [event.agentId!]: {
                ...current.agents[event.agentId!]!,
                status: "running",
                output: current.agents[event.agentId!]!.output + event.delta,
              },
            },
          }) : current);
          return;
        }
        void api<RunManifest>(`/api/runs/${runId}`).then((value) => {
          setRun(value);
          if (["completed", "partial", "failed", "cancelled"].includes(value.status)) {
            source.close();
            props.onRunsChanged();
          }
        });
      });
    }
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) props.onNotice("实时连接已关闭，可从最近运行重新打开。");
    };
  };

  const start = async () => {
    if (!query.trim()) {
      props.onNotice("先写下需要并行分析的问题。");
      return;
    }
    setStarting(true);
    try {
      const agentTasks = decompose
        ? Object.fromEntries(selectedIds.map((id) => {
            const agent = workerAgents.find((item) => item.id === id);
            return [id, `围绕“${query.trim()}”，以${agent?.extension.displayName || id}的职责进行专项分析。`];
          }))
        : undefined;
      const manifest = await api<RunManifest>("/api/runs", {
        method: "POST",
        body: JSON.stringify({
          query: query.trim(),
          context,
          contextMode,
          selection: { mode: selectionMode, agentIds: selectionMode === "explicit" ? selectedIds : undefined },
          agentTasks,
        }),
      });
      setRun(manifest);
      history.replaceState({}, "", `/runs/${manifest.id}`);
      subscribe(manifest.id);
    } catch (error) {
      props.onNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
    }
  };

  const configuredCount = props.providers.filter((provider) => provider.configured).length;
  const activeRun = run && ["queued", "running"].includes(run.status);
  return (
    <>
      <PageTitle
        eyebrow="Multi-agent reasoning"
        title="把一个问题，放上多条思考轨道"
        description="每个 Agent 独立作答。实时看见它们在哪里一致、在哪里分叉，再决定下一步。"
        aside={<div className="provider-summary"><b>{configuredCount}/3</b><span>API 已就绪</span></div>}
      />
      <section className="run-composer panel">
        <label className="field-label" htmlFor="query">这次要共同思考什么？</label>
        <textarea id="query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：请评估这个产品想法的价值、技术可行性与主要风险……" rows={4} />
        <details className="context-details">
          <summary>添加对话上下文 <span>可选</span></summary>
          <textarea value={context} onChange={(event) => setContext(event.target.value)} placeholder="粘贴只对本次运行有帮助的背景材料" rows={3} />
        </details>
        <div className="composer-options">
          <Segmented
            label="选择方式"
            value={selectionMode}
            onChange={(value) => setSelectionMode(value as SelectionMode)}
            options={[["auto", "自动匹配"], ["all", "全部并行"], ["explicit", "指定 Agent"]]}
          />
          <Segmented
            label="上下文"
            value={contextMode}
            onChange={(value) => setContextMode(value as typeof contextMode)}
            options={[["summary", "简明"], ["prompt-only", "仅问题"], ["full", "完整"]]}
          />
          <label className="check-row"><input type="checkbox" checked={decompose} onChange={(event) => setDecompose(event.target.checked)} />按角色拆解分工</label>
        </div>
        {selectionMode === "explicit" && (
          <div className="agent-picker">
            {workerAgents.map((agent) => (
              <label key={agent.id} className={selectedIds.includes(agent.id) ? "agent-choice selected" : "agent-choice"}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(agent.id)}
                  onChange={() => setSelectedIds((ids) => ids.includes(agent.id) ? ids.filter((id) => id !== agent.id) : [...ids, agent.id])}
                />
                <span className={`provider-glyph ${agent.extension.provider}`} />
                <span><b>{agent.extension.displayName}</b><small>{agent.extension.provider} · {agent.model.name}</small></span>
              </label>
            ))}
          </div>
        )}
        <div className="composer-actions">
          <div className="provider-pills">
            {props.providers.map((provider) => <span key={provider.id} className={provider.configured ? "ready" : "missing"}>{provider.label}</span>)}
          </div>
          <button className="primary-button" onClick={start} disabled={starting || Boolean(activeRun)}>
            {starting ? "正在创建…" : activeRun ? "运行进行中" : "开始并行思考"} <span>→</span>
          </button>
        </div>
      </section>

      {run && (
        <section className="run-board">
          <div className="run-heading">
            <div>
              <span className={`status-badge ${run.status}`}>{statusLabels[run.status]}</span>
              <h2>{run.query}</h2>
              <code>{run.id}</code>
            </div>
            <div className="inline-actions">
              {activeRun && <button className="secondary-button danger" onClick={() => void api(`/api/runs/${run.id}/cancel`, { method: "POST" })}>取消运行</button>}
              {!activeRun && <button className="secondary-button" onClick={() => void api<RunManifest>(`/api/runs/${run.id}/aggregate`, { method: "POST", body: "{}" }).then(setRun).catch((error) => props.onNotice(error.message))}>用聚合 Agent</button>}
            </div>
          </div>
          <div className="parallel-rail" aria-label="Agent 任务进度">
            {Object.values(run.agents).map((agent) => (
              <div key={agent.agentId} className={`rail-segment ${agent.status}`}>
                <span /><b>{agent.displayName}</b><small>{statusLabels[agent.status]}</small>
              </div>
            ))}
          </div>
          <div className="agent-grid">
            {Object.values(run.agents).map((agent) => <AgentResultCard key={agent.agentId} agent={agent} />)}
          </div>
          {run.synthesis && (
            <article className="synthesis-card">
              <span className="eyebrow">Aggregate answer</span>
              <h3>聚合答案</h3>
              <MarkdownLike text={run.synthesis.output} />
            </article>
          )}
        </section>
      )}

      <section className="recent-runs">
        <div className="section-heading"><h2>最近运行</h2><span>{props.runs.length} 条归档</span></div>
        <div className="run-list">
          {props.runs.length === 0 && <div className="empty-state">还没有运行。上面的第一个问题会在这里留下可复查的记录。</div>}
          {props.runs.slice(0, 8).map((item) => (
            <button key={item.id} onClick={() => { setRun(item); history.replaceState({}, "", `/runs/${item.id}`); }}>
              <span className={`run-dot ${item.status}`} />
              <span><b>{item.query}</b><small>{new Date(item.createdAt).toLocaleString("zh-CN")} · {item.selectedAgents.length} 个 Agent</small></span>
              <span className="run-status">{statusLabels[item.status]}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

function Segmented(props: { label: string; value: string; onChange: (value: string) => void; options: string[][] }) {
  return (
    <fieldset className="segmented">
      <legend>{props.label}</legend>
      <div>
        {props.options.map(([value, label]) => <button type="button" key={value} className={props.value === value ? "active" : ""} onClick={() => props.onChange(value!)}>{label}</button>)}
      </div>
    </fieldset>
  );
}

function AgentResultCard({ agent }: { agent: RunManifest["agents"][string] }) {
  return (
    <article className={`agent-result ${agent.status}`}>
      <header>
        <span className={`provider-glyph ${agent.provider}`} />
        <div><h3>{agent.displayName}</h3><small>{agent.provider} · {agent.model}</small></div>
        <span className="agent-state">{statusLabels[agent.status]}</span>
      </header>
      <div className="task-note"><b>任务</b>{agent.task}</div>
      <div className="agent-output">
        {agent.output ? <MarkdownLike text={agent.output} /> : agent.error ? <p className="error-text">{agent.error}</p> : <ThinkingPlaceholder status={agent.status} />}
      </div>
      {agent.error && agent.output && <p className="partial-error">已保留部分输出 · {agent.error}</p>}
      {agent.usage && <footer>{Object.entries(agent.usage).map(([key, value]) => <span key={key}>{key}: {value}</span>)}</footer>}
    </article>
  );
}

function ThinkingPlaceholder({ status }: { status: string }) {
  if (status === "failed") return <p className="error-text">该 Agent 未返回结果。</p>;
  return <div className="thinking-placeholder"><i /><i /><i /><span>{status === "queued" ? "等待轨道空闲" : "正在接收答案"}</span></div>;
}

function MarkdownLike({ text }: { text: string }) {
  return <div className="markdown-output">{text.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>;
}

function AgentsPage(props: { agents: AgentSummary[]; onChanged: () => Promise<void>; onNotice: (message: string) => void }) {
  const [selectedId, setSelectedId] = useState(props.agents[0]?.id);
  const selected = props.agents.find((agent) => agent.id === selectedId);
  const [draft, setDraft] = useState<AgentDraft | undefined>(selected);

  useEffect(() => {
    const value = props.agents.find((agent) => agent.id === selectedId) || props.agents[0];
    if (value) {
      setSelectedId(value.id);
      setDraft(structuredClone(value));
    }
  }, [props.agents, selectedId]);

  const newAgent = () => {
    const value: AgentDraft = {
      id: "new-agent",
      description: "说明这个 Agent 负责什么，以及何时应该选择它。",
      systemPrompt: "你是一个独立分析 Agent。明确事实、推断与不确定性，只输出最终答案。",
      model: { name: "gpt-5-mini", temperature: 0.4, maxTokens: 2400 },
      profile: "default",
      extension: {
        displayName: "新 Agent",
        enabled: true,
        provider: "openai",
        role: "worker",
        selection: { includeInParallel: true, tags: [], intents: [], negativeHints: [], priority: 50 },
        knowledge: { sharedMode: "auto", sharedCollections: [], privatePaths: [] },
        context: { defaultMode: "summary" },
        limits: { firstTokenTimeoutMs: 30000, totalTimeoutMs: 180000 },
      },
      valid: true,
      issues: [],
    };
    setSelectedId(value.id);
    setDraft(value);
  };

  const update = (recipe: (value: AgentDraft) => void) => {
    setDraft((current) => {
      if (!current) return current;
      const copy = structuredClone(current);
      recipe(copy);
      return copy;
    });
  };

  const save = async () => {
    if (!draft) return;
    try {
      await api<AgentSummary>(`/api/agents/${draft.id}`, { method: "PUT", body: JSON.stringify(draft) });
      props.onNotice(`已保存 ${draft.extension.displayName}`);
      await props.onChanged();
      setSelectedId(draft.id);
    } catch (error) {
      props.onNotice(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      <PageTitle
        eyebrow="Canonical agent library"
        title="每个 Agent，都是一份可追踪的配置"
        description=".agent.md 保存角色与模型；.agent.ext.yaml 保存选择、知识库和运行策略。界面直接编辑这两份真相源。"
        aside={<button className="secondary-button" onClick={newAgent}>＋ 新建 Agent</button>}
      />
      <div className="agents-layout">
        <aside className="agent-list panel">
          {props.agents.map((agent) => (
            <button key={agent.id} className={selectedId === agent.id ? "selected" : ""} onClick={() => setSelectedId(agent.id)}>
              <span className={`provider-glyph ${agent.extension.provider}`} />
              <span><b>{agent.extension.displayName}</b><small>{agent.id}</small></span>
              <i className={agent.valid ? "valid" : "invalid"} />
            </button>
          ))}
        </aside>
        {draft && (
          <section className="agent-editor panel">
            <div className="editor-title">
              <div><span className="eyebrow">Agent definition</span><h2>{draft.extension.displayName}</h2></div>
              <label className="switch"><input type="checkbox" checked={draft.extension.enabled} onChange={(event) => update((value) => { value.extension.enabled = event.target.checked; })} /><span />启用</label>
            </div>
            {!draft.valid && <div className="validation-box">{draft.issues.map((issue) => <p key={issue.code}>{issue.code} · {issue.message}</p>)}</div>}
            <div className="form-grid">
              <Field label="技术 ID"><input value={draft.id} onChange={(event) => update((value) => { value.id = event.target.value; })} disabled={Boolean(selected)} /></Field>
              <Field label="中文名称"><input value={draft.extension.displayName} onChange={(event) => update((value) => { value.extension.displayName = event.target.value; })} /></Field>
              <Field label="模型厂商">
                <select value={draft.extension.provider} onChange={(event) => update((value) => { value.extension.provider = event.target.value as ProviderId; })}>
                  <option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="deepseek">DeepSeek</option>
                </select>
              </Field>
              <Field label="模型名称"><input value={draft.model.name} onChange={(event) => update((value) => { value.model.name = event.target.value; })} /></Field>
              <Field label="角色类型">
                <select value={draft.extension.role} onChange={(event) => update((value) => { value.extension.role = event.target.value as "worker" | "synthesizer"; })}>
                  <option value="worker">普通并行 Agent</option><option value="synthesizer">聚合 Agent</option>
                </select>
              </Field>
              <Field label="优先级"><input type="number" value={draft.extension.selection.priority} onChange={(event) => update((value) => { value.extension.selection.priority = Number(event.target.value); })} /></Field>
              <Field label="Temperature"><input type="number" min="0" max="2" step="0.05" value={draft.model.temperature ?? ""} onChange={(event) => update((value) => { value.model.temperature = Number(event.target.value); })} /></Field>
              <Field label="最大输出 Tokens"><input type="number" min="1" value={draft.model.maxTokens ?? ""} onChange={(event) => update((value) => { value.model.maxTokens = Number(event.target.value); })} /></Field>
            </div>
            <Field label="职责说明"><textarea rows={2} value={draft.description} onChange={(event) => update((value) => { value.description = event.target.value; })} /></Field>
            <Field label="系统 Prompt"><textarea className="prompt-editor" rows={9} value={draft.systemPrompt} onChange={(event) => update((value) => { value.systemPrompt = event.target.value; })} /></Field>
            <div className="form-grid">
              <Field label="选择标签（逗号分隔）"><input value={draft.extension.selection.tags.join(", ")} onChange={(event) => update((value) => { value.extension.selection.tags = splitList(event.target.value); })} /></Field>
              <Field label="适用意图（逗号分隔）"><input value={draft.extension.selection.intents.join(", ")} onChange={(event) => update((value) => { value.extension.selection.intents = splitList(event.target.value); })} /></Field>
              <Field label="排除提示（逗号分隔）"><input value={draft.extension.selection.negativeHints.join(", ")} onChange={(event) => update((value) => { value.extension.selection.negativeHints = splitList(event.target.value); })} /></Field>
              <Field label="私有知识路径（逗号分隔）"><input value={draft.extension.knowledge.privatePaths.join(", ")} onChange={(event) => update((value) => { value.extension.knowledge.privatePaths = splitList(event.target.value); })} /></Field>
            </div>
            <div className="editor-footer">
              <span>保存前会经过 Harness 核心校验和扩展 Schema 校验；失败不会替换当前版本。</span>
              <button className="primary-button" onClick={save}>保存 Agent</button>
            </div>
          </section>
        )}
      </div>
    </>
  );
}

function Field(props: { label: string; children: React.ReactNode }) {
  return <label className="form-field"><span>{props.label}</span>{props.children}</label>;
}

function splitList(value: string): string[] {
  return value.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
}

function ProvidersPage(props: { providers: ProviderStatus[]; onNotice: (message: string) => void }) {
  const [testing, setTesting] = useState<ProviderId>();
  const test = async (id: ProviderId) => {
    setTesting(id);
    try {
      const result = await api<{ ok: boolean; latencyMs: number; message: string }>(`/api/providers/${id}/test`, { method: "POST" });
      props.onNotice(`${result.message}${result.latencyMs ? ` · ${result.latencyMs} ms` : ""}`);
    } finally {
      setTesting(undefined);
    }
  };
  return (
    <>
      <PageTitle eyebrow="Provider connections" title="API 连接" description="密钥永远不进入网页、Agent 文件、日志或运行归档。这里只检查服务端环境变量是否存在。" />
      <div className="provider-cards">
        {props.providers.map((provider) => (
          <article key={provider.id} className="provider-card panel">
            <header><span className={`provider-glyph large ${provider.id}`} /><div><h2>{provider.label}</h2><span className={provider.configured ? "connection ready" : "connection missing"}>{provider.configured ? "已配置" : "未配置"}</span></div></header>
            <dl>
              <div><dt>环境变量</dt><dd><code>{provider.envKey}</code></dd></div>
              <div><dt>模型</dt><dd>{provider.model}</dd></div>
              <div><dt>接口地址</dt><dd>{provider.baseUrl}</dd></div>
            </dl>
            <button className="secondary-button" disabled={!provider.configured || testing === provider.id} onClick={() => void test(provider.id)}>
              {testing === provider.id ? "正在测试…" : "测试连接"}
            </button>
          </article>
        ))}
      </div>
      <div className="security-note panel"><b>密钥边界</b><p>请在启动服务的终端中设置环境变量。连接测试只返回成功、延迟或经过截断的厂商错误，不回显密钥和请求头。</p></div>
    </>
  );
}

function KnowledgePage(props: { agents: AgentSummary[]; onNotice: (message: string) => void }) {
  const [data, setData] = useState<Array<{ agentId: string; files: Array<{ path: string; supported: boolean; parserId?: string; characters?: number; cached?: boolean; error?: string }> }>>([]);
  const [loading, setLoading] = useState(false);
  const scan = async () => {
    setLoading(true);
    try { setData(await api("/api/knowledge")); }
    catch (error) { props.onNotice(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  };
  const totalFiles = data.reduce((sum, item) => sum + item.files.length, 0);
  return (
    <>
      <PageTitle eyebrow="Knowledge routing" title="共享知识与 Agent 私有资料" description="共享目录可被多个 Agent 选择；私有目录只进入对应 Agent 的上下文。未知类型会明确跳过，不阻断整次运行。" aside={<button className="primary-button" onClick={() => void scan()}>{loading ? "扫描中…" : "扫描知识库"}</button>} />
      <div className="knowledge-summary">
        <div><b>{props.agents.length}</b><span>Agent</span></div><div><b>{totalFiles}</b><span>已发现文件</span></div><div><b>{data.reduce((sum, item) => sum + item.files.filter((file) => file.supported).length, 0)}</b><span>可解析</span></div>
      </div>
      <div className="knowledge-list">
        {data.length === 0 && <div className="empty-state panel">点击“扫描知识库”查看每个 Agent 实际会读取哪些文件和解析器。知识目录位于全局 .parallel-think 目录。</div>}
        {data.map((item) => {
          const agent = props.agents.find((value) => value.id === item.agentId);
          return (
            <article className="panel knowledge-agent" key={item.agentId}>
              <header><h2>{agent?.extension.displayName || item.agentId}</h2><span>{item.files.length} 个文件</span></header>
              {item.files.length === 0 ? <p className="muted">目录目前为空。</p> : (
                <div className="file-table">
                  {item.files.map((file) => <div key={file.path}><span className={file.error || !file.supported ? "file-state warning" : "file-state ok"}>{file.error ? "失败" : file.supported ? "可用" : "跳过"}</span><code title={file.path}>{file.path}</code><span>{file.parserId || "无解析器"}{file.cached ? " · 缓存" : ""}</span></div>)}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}

function ParsersPage(props: { parsers: ParserRecord[]; onChanged: () => Promise<void>; onNotice: (message: string) => void }) {
  const action = async (parser: ParserRecord, name: string) => {
    try {
      const result = await api<ParserRecord>(`/api/parsers/${parser.id}/${parser.version}/${name}`, { method: "POST" });
      props.onNotice(`${result.id}@${result.version}：${statusLabels[result.status]}`);
      await props.onChanged();
    } catch (error) {
      props.onNotice(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <>
      <PageTitle eyebrow="Parser governance" title="解析器完整生命周期" description="内置解析器覆盖常用文件；本地扩展必须先验证、再用最多 5 个真实文件灰度。连续 3 次硬失败会自动回滚。" />
      <div className="lifecycle-strip"><span>发现</span><i>→</i><span>验证</span><i>→</i><span>灰度</span><i>→</i><span>启用</span><i>→</i><span>弃用 / 停用</span></div>
      <div className="parser-table panel">
        <header><span>解析器</span><span>文件类型</span><span>运行指标</span><span>状态与操作</span></header>
        {props.parsers.map((parser) => (
          <div className="parser-row" key={`${parser.id}@${parser.version}`}>
            <div><b>{parser.id}</b><small>{parser.kind} · v{parser.version}</small></div>
            <div className="extension-list">{parser.extensions.map((extension) => <code key={extension}>{extension}</code>)}</div>
            <div className="parser-metrics"><span>成功 {parser.successCount}</span><span>失败 {parser.failureCount}</span><span>缓存 {parser.cacheHits}</span><span>字符 {parser.extractedCharacters}</span></div>
            <div className="parser-actions">
              <span className={`status-badge ${parser.status}`}>{statusLabels[parser.status]}</span>
              {parser.kind === "extension" && <>
                <button onClick={() => void action(parser, "validate")}>验证</button>
                <button onClick={() => void action(parser, "activate")}>灰度启用</button>
                <button onClick={() => void action(parser, "disable")}>停用</button>
              </>}
            </div>
          </div>
        ))}
      </div>
      <div className="security-note panel"><b>本地扩展边界</b><p>只发现全局 parsers 目录下的 manifest.yaml，不从网络下载代码。扩展在 Node 权限模式子进程运行，只可读取自身目录和当前输入文件，且不继承模型 API 密钥。</p></div>
    </>
  );
}
