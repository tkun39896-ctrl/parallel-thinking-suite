import { useEffect, useRef, useState } from "react";
import type {
  AgentDraft,
  AgentSummary,
  ModelDefinition,
  ParserRecord,
  ProviderId,
  ProviderStatus,
  RunEvent,
  RunManifest,
  SelectionMode,
} from "../shared/types.js";

type Page = "run" | "agents" | "settings";
type SettingsPageId = "providers" | "models" | "knowledge" | "parsers";

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

function currentProjectRoot(): string | undefined {
  return new URLSearchParams(location.search).get("projectRoot") || undefined;
}

function projectRootQuery(): string {
  const projectRoot = currentProjectRoot();
  return projectRoot ? `?projectRoot=${encodeURIComponent(projectRoot)}` : "";
}

function runApiPath(runId: string, suffix = ""): string {
  return `/api/runs/${runId}${suffix}${projectRootQuery()}`;
}

export function App() {
  const [page, setPage] = useState<Page>("run");
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [models, setModels] = useState<ModelDefinition[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [parsers, setParsers] = useState<ParserRecord[]>([]);
  const [runs, setRuns] = useState<RunManifest[]>([]);
  const [notice, setNotice] = useState<string>("");
  const initialRunId = useInitialRunId();

  const refresh = async () => {
    const [agentData, modelData, providerData, parserData, runData] = await Promise.all([
      api<AgentSummary[]>("/api/agents"),
      api<ModelDefinition[]>("/api/models"),
      api<ProviderStatus[]>("/api/providers"),
      api<ParserRecord[]>("/api/parsers"),
      api<RunManifest[]>(`/api/runs${projectRootQuery()}`),
    ]);
    setAgents(agentData);
    setModels(modelData);
    setProviders(providerData);
    setParsers(parserData);
    setRuns(runData);
  };

  useEffect(() => {
    void refresh().catch((error) => setNotice(error.message));
  }, []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="brand" onClick={() => setPage("run")} aria-label="返回运行页">
          <span className="brand-mark"><i /><i /><i /></span>
          <span><b>并行思考</b><small>Parallel Thinking</small></span>
        </button>
        <nav aria-label="主导航">
          <NavButton active={page === "run"} label="问答" hint="发起与查看运行" icon="01" onClick={() => setPage("run")} />
          <NavButton active={page === "agents"} label="Agent" hint="角色与模型" icon="02" onClick={() => setPage("agents")} />
          <NavButton active={page === "settings"} label="设置" hint="连接、知识与解析" icon="03" onClick={() => setPage("settings")} />
        </nav>
        <div className="local-status">
          <span className="local-dot" />
          <span>本机编排</span>
        </div>
      </header>

      <main className={page === "run" ? "workspace run-workspace" : "workspace"}>
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
        {page === "agents" && <AgentsPage agents={agents} models={models} onChanged={refresh} onNotice={setNotice} />}
        {page === "settings" && <SettingsPage agents={agents} models={models} providers={providers} parsers={parsers} onChanged={refresh} onNotice={setNotice} />}
      </main>
    </div>
  );
}

function SettingsPage(props: {
  agents: AgentSummary[];
  models: ModelDefinition[];
  providers: ProviderStatus[];
  parsers: ParserRecord[];
  onChanged: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [section, setSection] = useState<SettingsPageId>("providers");
  return (
    <div className="settings-shell">
      <nav className="settings-nav" aria-label="设置分类">
        <button className={section === "providers" ? "active" : ""} onClick={() => setSection("providers")}><b>连接</b><span>模型服务与密钥状态</span></button>
        <button className={section === "models" ? "active" : ""} onClick={() => setSection("models")}><b>模型</b><span>Agent 可选择的模型目录</span></button>
        <button className={section === "knowledge" ? "active" : ""} onClick={() => setSection("knowledge")}><b>知识库</b><span>Agent 可读取的本地资料</span></button>
        <button className={section === "parsers" ? "active" : ""} onClick={() => setSection("parsers")}><b>文件解析</b><span>把资料转换成可读文本</span></button>
      </nav>
      <section className="settings-content">
        {section === "providers" && <ProvidersPage providers={props.providers} onNotice={props.onNotice} />}
        {section === "models" && <ModelsPage models={props.models} />}
        {section === "knowledge" && <KnowledgePage agents={props.agents} onNotice={props.onNotice} />}
        {section === "parsers" && <ParsersPage parsers={props.parsers} onChanged={props.onChanged} onNotice={props.onNotice} />}
      </section>
    </div>
  );
}

function NavButton(props: { active: boolean; label: string; hint: string; icon: string; onClick: () => void }) {
  return (
    <button className={props.active ? "nav-button active" : "nav-button"} onClick={props.onClick} title={props.hint}>
      <span className="nav-icon">{props.icon}</span>
      <span>{props.label}</span>
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

const providerIconPaths: Record<ProviderId, string> = {
  openai: "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z",
  anthropic: "M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z",
  deepseek: "M23.748 4.651c-.254-.124-.364.113-.512.233-.051.04-.094.09-.137.137-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.155-.708-.311-.955-.65-.172-.24-.219-.509-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.094.172.187.129.323-.082.28-.18.553-.266.833-.055.179-.137.218-.328.14a5.5 5.5 0 0 1-1.737-1.179c-.857-.828-1.631-1.743-2.597-2.46a12 12 0 0 0-.689-.47c-.985-.957.13-1.743.387-1.836.27-.098.094-.433-.778-.428-.872.003-1.67.295-2.687.685a3 3 0 0 1-.465.136 9.6 9.6 0 0 0-2.883-.101c-1.885.21-3.39 1.1-4.497 2.622C.082 8.776-.231 10.854.152 13.02c.403 2.284 1.568 4.175 3.36 5.653 1.857 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.132-.284 4.994-1.86.47.234.962.328 1.78.398.629.058 1.235-.031 1.705-.129.735-.155.684-.836.418-.961-2.155-1.004-1.682-.595-2.112-.926 1.095-1.295 2.768-3.598 3.284-6.733.05-.346.115-.834.108-1.114-.004-.171.035-.238.23-.257a4.2 4.2 0 0 0 1.545-.475c1.397-.763 1.96-2.016 2.093-3.517.02-.23-.004-.467-.247-.588M11.58 18.168c-2.088-1.642-3.101-2.183-3.52-2.16-.39.024-.32.472-.234.763.09.288.207.487.371.74.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.168-1.361-.801-2.5-1.86-3.301-3.306-.775-1.393-1.225-2.888-1.299-4.482-.02-.385.094-.522.477-.592a4.7 4.7 0 0 1 1.53-.038c2.131.311 3.946 1.264 5.467 2.774.868.86 1.525 1.887 2.202 2.89.72 1.066 1.494 2.082 2.48 2.915.348.291.626.513.892.677-.802.09-2.14.109-3.055-.615zm1.001-6.44a.306.306 0 0 1 .415-.287.3.3 0 0 1 .113.074.3.3 0 0 1 .086.214c0 .17-.136.307-.308.307a.303.303 0 0 1-.306-.307m3.11 1.596c-.2.081-.4.151-.591.16a1.25 1.25 0 0 1-.798-.254c-.274-.23-.47-.358-.551-.758a1.7 1.7 0 0 1 .015-.588c.07-.327-.007-.537-.238-.727-.188-.156-.426-.199-.689-.199a.6.6 0 0 1-.254-.078.253.253 0 0 1-.114-.358 1 1 0 0 1 .192-.21c.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.392.451.462.576.685.915.176.264.336.536.446.848.066.194-.02.353-.25.45",
  openrouter: "M16.778 1.844v1.919q-.569-.026-1.138-.032-.708-.008-1.415.037c-1.93.126-4.023.728-6.149 2.237-2.911 2.066-2.731 1.95-4.14 2.75-.396.223-1.342.574-2.185.798-.841.225-1.753.333-1.751.333v4.229s.768.108 1.61.333c.842.224 1.789.575 2.185.799 1.41.798 1.228.683 4.14 2.75 2.126 1.509 4.22 2.11 6.148 2.236.88.058 1.716.041 2.555.005v1.918l7.222-4.168-7.222-4.17v2.176c-.86.038-1.611.065-2.278.021-1.364-.09-2.417-.357-3.979-1.465-2.244-1.593-2.866-2.027-3.68-2.508.889-.518 1.449-.906 3.822-2.59 1.56-1.109 2.614-1.377 3.978-1.466.667-.044 1.418-.017 2.278.02v2.176L24 6.014Z",
};

function ProviderIcon(props: { provider: ProviderId; size?: "small" | "medium" | "large"; hostNative?: boolean; label?: string }) {
  return (
    <span className={`provider-avatar ${props.provider} ${props.size || "medium"}${props.hostNative ? " host-native" : ""}`} role="img" aria-label={props.label || props.provider}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d={providerIconPaths[props.provider]} /></svg>
    </span>
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
  const [sessionsCollapsed, setSessionsCollapsed] = useState(false);
  const eventSource = useRef<EventSource | null>(null);

  useEffect(() => {
    if (selectedIds.length === 0 && workerAgents.length > 0) {
      setSelectedIds(workerAgents.filter((agent) => agent.extension.enabled).map((agent) => agent.id));
    }
  }, [props.agents.length]);

  useEffect(() => {
    if (!props.initialRunId) return;
    void api<RunManifest>(runApiPath(props.initialRunId)).then((value) => {
      setRun(value);
      if (value.status === "running" || value.status === "queued") subscribe(value.id);
    }).catch((error) => props.onNotice(error.message));
    return () => eventSource.current?.close();
  }, [props.initialRunId]);

  const subscribe = (runId: string) => {
    eventSource.current?.close();
    const source = new EventSource(runApiPath(runId, "/events"));
    eventSource.current = source;
    source.addEventListener("snapshot", (message) => setRun(JSON.parse((message as MessageEvent).data)));
    const events: RunEvent["type"][] = [
      "agent_started", "model_resolved", "text_delta", "usage", "agent_completed", "agent_failed",
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
        void api<RunManifest>(runApiPath(runId)).then((value) => {
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
          projectRoot: currentProjectRoot(),
        }),
      });
      setRun(manifest);
      history.replaceState({}, "", `/runs/${manifest.id}${location.search}`);
      subscribe(manifest.id);
    } catch (error) {
      props.onNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
    }
  };

  const configuredCount = props.providers.filter((provider) => provider.configured).length;
  const activeRun = run && ["queued", "running"].includes(run.status);
  const resetRun = () => {
    eventSource.current?.close();
    setRun(undefined);
    setQuery("");
    history.replaceState({}, "", `/${location.search}`);
  };
  const openRun = (item: RunManifest) => {
    setRun(item);
    history.replaceState({}, "", `/runs/${item.id}${location.search}`);
    if (["queued", "running"].includes(item.status)) subscribe(item.id);
  };

  const composer = (
    <section className={run ? "question-composer compact" : "question-composer"} aria-label="提出问题">
      <div className="composer-input-row">
        <textarea
          id="query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void start();
            }
          }}
          placeholder="写下一个值得从多个角度回答的问题……"
          rows={run ? 2 : 4}
        />
        <button className="send-button" onClick={() => void start()} disabled={starting || Boolean(activeRun) || !query.trim() || workerAgents.length === 0} aria-label="开始并行思考">
          <span>{starting ? "创建中" : activeRun ? "运行中" : "开始"}</span><i aria-hidden="true">↗</i>
        </button>
      </div>
      <details className="advanced-options">
        <summary>运行设置 <span>Agent、上下文与分工</span></summary>
        <div className="advanced-options-body">
          <textarea value={context} onChange={(event) => setContext(event.target.value)} placeholder="补充只对本次运行有帮助的背景材料（可选）" rows={3} />
          <div className="composer-options">
            <Segmented
              label="Agent"
              value={selectionMode}
              onChange={(value) => setSelectionMode(value as SelectionMode)}
              options={[["auto", "智能"], ["all", "全部"], ["explicit", "指定"]]}
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
                  <ProviderIcon provider={agent.extension.avatar.provider} size="small" label={`${agent.extension.displayName} 头像`} />
                  <span><b>{agent.extension.displayName}</b><small>{agent.extension.provider} · {modelDisplayName(agent.extension.provider, agent.model.name)}</small></span>
                </label>
              ))}
            </div>
          )}
        </div>
      </details>
      <div className="composer-footnote">
        <span>⌘ Enter 提交</span>
        <span>网页直启使用 Provider API；从 Codex / Claude Code 调用时优先宿主原生</span>
        <span>{workerAgents.length === 0 ? "先创建 Agent" : `${configuredCount}/${props.providers.length} 连接就绪`}</span>
      </div>
    </section>
  );

  return (
    <div className={`conversation-layout${sessionsCollapsed ? " sessions-collapsed" : ""}`}>
      <aside className={`session-sidebar${sessionsCollapsed ? " collapsed" : ""}`} aria-label="会话列表">
        <div className="session-sidebar-head">
          <div className="session-sidebar-title"><span className="eyebrow">Local archive</span><h2>会话</h2></div>
          <div className="session-sidebar-actions">
            <button className="session-sidebar-action new" onClick={resetRun} aria-label="新建会话" title="新建会话">＋</button>
          </div>
        </div>
        <div className="session-list" id="session-list" aria-hidden={sessionsCollapsed}>
          {props.runs.length === 0 && <div className="session-empty">还没有会话</div>}
          {props.runs.map((item) => (
            <button key={item.id} className={run?.id === item.id ? "active" : ""} onClick={() => openRun(item)}>
              <span className={`run-dot ${item.status}`} />
              <span><b>{item.query}</b><small>{new Date(item.createdAt).toLocaleString("zh-CN")} · {item.selectedAgents.length} Agent</small></span>
            </button>
          ))}
        </div>
        <button
          className="session-edge-toggle"
          onClick={() => setSessionsCollapsed((current) => !current)}
          aria-label={sessionsCollapsed ? "展开会话列表" : "收起会话列表"}
          aria-expanded={!sessionsCollapsed}
          aria-controls="session-list"
          title={sessionsCollapsed ? "展开会话列表" : "收起会话列表"}
        >
          <span className="session-edge-icon desktop" aria-hidden="true">{sessionsCollapsed ? "›" : "‹"}</span>
          <span className="session-edge-icon mobile" aria-hidden="true">{sessionsCollapsed ? "⌄" : "⌃"}</span>
        </button>
      </aside>

      <section className="conversation-main">
        {!run ? (
          <div className="conversation-empty">
            <div>
              <span className="eyebrow">Parallel thinking</span>
              <h1>问一个问题。</h1>
              <p>不同 Agent 会在同一条回答流中依次展开。</p>
            </div>
            {composer}
          </div>
        ) : (
          <>
            <header className="conversation-header">
              <div className="run-identity">
                <span className={`status-badge ${run.status}`}>{statusLabels[run.status]}</span>
                <span>{executionLabel(run.executionMode, run.executionHost)}</span>
                <span>{contextModeLabel(run.contextMode)}</span>
              </div>
              <div className="inline-actions">
                {activeRun && run.executionMode !== "host-native" && <button className="text-button danger" onClick={() => void api(runApiPath(run.id, "/cancel"), { method: "POST" })}>取消</button>}
                {!activeRun && <button className="text-button" onClick={() => void api<RunManifest>(runApiPath(run.id, "/aggregate"), { method: "POST", body: "{}" }).then(setRun).catch((error) => props.onNotice(error.message))}>聚合</button>}
                <button className="new-question-button" onClick={resetRun}>＋ 新问题</button>
              </div>
            </header>

            <div className="message-stream" aria-label="回答序列">
              <article className="message user-message">
                <header><span className="message-avatar">你</span><div><b>问题</b><small>{new Date(run.createdAt).toLocaleString("zh-CN")}</small></div></header>
                <div className="message-body question-message">{run.query}</div>
              </article>
              {run.selectedAgents.map((agentId, index) => run.agents[agentId] ? (
                <AgentResultCard key={agentId} agent={run.agents[agentId]!} executionHost={run.executionHost} />
              ) : null)}
              {run.synthesis && (
                <article className="message synthesis-message">
                  <header><span className="message-avatar">Σ</span><div><b>聚合答案</b><small>{run.synthesis.agentId}</small></div></header>
                  <div className="message-body"><MarkdownLike text={run.synthesis.output} /></div>
                </article>
              )}
            </div>
            <div className="conversation-composer">{composer}</div>
          </>
        )}
      </section>
    </div>
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

function AgentResultCard({ agent, executionHost }: { agent: RunManifest["agents"][string]; executionHost?: string }) {
  const hostNative = agent.executor === "host-native";
  return (
    <article className={`message agent-message ${agent.status}`}>
      <header>
        <ProviderIcon provider={agent.avatar?.provider || agent.provider} hostNative={hostNative} label={`${agent.displayName} 头像`} />
        <div>
          <b>{agent.displayName}</b>
          <small>{hostNative ? `宿主原生 · ${executionHost || "native"}` : `Provider · ${agent.provider}`}</small>
        </div>
        <span className={`agent-state ${agent.status}`}><i />{statusLabels[agent.status]}</span>
      </header>
      <div className="message-source">{hostNative
          ? `${agent.resolvedModel ? `实际模型 ${agent.resolvedModel}` : "模型由宿主继承"} · 备用 ${agent.provider}/${modelDisplayName(agent.provider, agent.model)}`
          : `请求 ${modelDisplayName(agent.provider, agent.model)}${agent.resolvedModel ? ` · 实际 ${agent.resolvedModel}` : ""}`}</div>
      <details className="agent-task-details">
        <summary>查看专项分工</summary>
        <p>{agent.task}</p>
      </details>
      <div className="message-body">
        {agent.output ? <MarkdownLike text={agent.output} /> : agent.error ? <p className="error-text">{agent.error}</p> : <ThinkingPlaceholder status={agent.status} />}
      </div>
      {agent.error && agent.output && <p className="partial-error">已保留部分输出 · {agent.error}</p>}
      {agent.usage && <footer>{Object.entries(agent.usage).map(([key, value]) => <span key={key}>{key}: {value}</span>)}</footer>}
    </article>
  );
}

function executionLabel(mode?: RunManifest["executionMode"], host?: string): string {
  return mode === "host-native" ? `宿主原生${host ? ` · ${host}` : ""}` : "Provider API";
}

function contextModeLabel(mode: RunManifest["contextMode"]): string {
  return mode === "full" ? "完整上下文" : mode === "prompt-only" ? "仅当前问题" : "简明上下文";
}

function modelDisplayName(provider: ProviderId, model: string): string {
  return provider === "openrouter" && model === "openrouter/auto" ? "OpenRouter 自动选模" : model;
}

function ThinkingPlaceholder({ status }: { status: string }) {
  if (status === "failed") return <p className="error-text">该 Agent 未返回结果。</p>;
  return <div className="thinking-placeholder"><i /><i /><i /><span>{status === "queued" ? "等待轨道空闲" : "正在接收答案"}</span></div>;
}

function MarkdownLike({ text }: { text: string }) {
  return <div className="markdown-output">{text.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>;
}

function AgentsPage(props: { agents: AgentSummary[]; models: ModelDefinition[]; onChanged: () => Promise<void>; onNotice: (message: string) => void }) {
  const [selectedId, setSelectedId] = useState<string>();
  const selected = props.agents.find((agent) => agent.id === selectedId);
  const [draft, setDraft] = useState<AgentDraft>();
  const [savingAvailability, setSavingAvailability] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!selectedId) return;
    const value = props.agents.find((agent) => agent.id === selectedId);
    if (value) {
      setDraft((current) => current?.id === selectedId ? current : structuredClone(value));
    }
  }, [props.agents, selectedId]);

  const newAgent = () => {
    const id = `agent-${Date.now().toString(36)}`;
    const defaultModel = props.models.find((model) => model.id === "openrouter-auto") || props.models[0];
    const value: AgentDraft = {
      id,
      description: "",
      systemPrompt: "独立回答用户问题，区分事实、判断与不确定性，只输出最终答案。",
      model: { name: defaultModel?.model || "openrouter/auto" },
      profile: "default",
      extension: {
        displayName: "",
        enabled: true,
        provider: defaultModel?.provider || "openrouter",
        modelId: defaultModel?.id,
        avatar: { kind: "provider", provider: defaultModel?.provider || "openrouter" },
        role: "worker",
        selection: { includeInParallel: true, tags: [], intents: [], negativeHints: [], priority: 50 },
        knowledge: { sharedMode: "auto", sharedCollections: [], privatePaths: [] },
        context: { defaultMode: "summary" },
        limits: { firstTokenTimeoutMs: 30000, totalTimeoutMs: 180000 },
      },
      valid: true,
      issues: [],
    };
    setSelectedId(id);
    setDraft(value);
  };

  const openAgent = (agent: AgentSummary) => {
    setSelectedId(agent.id);
    setDraft(structuredClone(agent));
  };

  const update = (recipe: (value: AgentDraft) => void) => {
    setDraft((current) => {
      if (!current) return current;
      const copy = structuredClone(current);
      recipe(copy);
      return copy;
    });
  };

  const setAvailability = async (agent: AgentSummary, enabled: boolean) => {
    setSavingAvailability((current) => ({ ...current, [agent.id]: enabled }));
    try {
      const saved = await api<AgentSummary>(`/api/agents/${agent.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...agent, extension: { ...agent.extension, enabled } }),
      });
      if (selectedId === agent.id) {
        setDraft((current) => current?.id === agent.id
          ? { ...current, extension: { ...current.extension, enabled: saved.extension.enabled } }
          : current);
      }
      await props.onChanged();
      props.onNotice(`${agent.extension.displayName} 已${enabled ? "设为可选择" : "停止参与回答"}`);
    } catch (error) {
      props.onNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingAvailability((current) => {
        const next = { ...current };
        delete next[agent.id];
        return next;
      });
    }
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

  if (!draft) {
    return (
      <>
        <PageTitle
          eyebrow="Agents"
          title="Agent 列表"
          description="直接选择谁可以参与回答；职责、模型与类型保持一眼可见，详细配置进入二级页面。"
          aside={<button className="primary-button" onClick={newAgent}>＋ 新建 Agent</button>}
        />
        <section className="agent-directory panel" aria-label="Agent 列表">
          <header className="agent-directory-head">
            <div><b>全部 Agent</b><span>点击一行查看并编辑完整配置</span></div>
            <small>{props.agents.filter((agent) => agent.extension.enabled).length}/{props.agents.length} 可参与</small>
          </header>
          {props.agents.length === 0 && <div className="agent-list-empty"><b>还没有 Agent</b><span>从名称和职责开始，复杂配置可以稍后补充。</span><button onClick={newAgent}>创建第一个 Agent</button></div>}
          {props.agents.length > 0 && (
            <div className="agent-list-columns" aria-hidden="true">
              <span>Agent</span><span>模型</span><span>类型</span><span>参与回答</span><span />
            </div>
          )}
          <div className="agent-list-items" role="list">
            {props.agents.map((agent) => {
              const isSaving = Object.hasOwn(savingAvailability, agent.id);
              const isEnabled = isSaving ? savingAvailability[agent.id]! : agent.extension.enabled;
              const model = props.models.find((item) => item.id === agent.extension.modelId);
              return (
                <div key={agent.id} className={`agent-list-item${agent.valid ? "" : " invalid"}`} role="listitem">
                  <button className="agent-open-button" onClick={() => openAgent(agent)}>
                    <ProviderIcon provider={agent.extension.avatar.provider} size="medium" label={`${agent.extension.displayName} 头像`} />
                    <span className="agent-list-copy">
                      <b>{agent.extension.displayName}</b>
                      <small>{agent.description || "尚未填写职责描述"}</small>
                      {!agent.valid && <em>配置需要修复</em>}
                    </span>
                  </button>
                  <span className="agent-model-summary"><b>{model?.displayName || modelDisplayName(agent.extension.provider, agent.model.name)}</b><small>{agent.extension.provider}</small></span>
                  <span className="agent-role-label">{agent.extension.role === "synthesizer" ? "聚合" : "回答"}</span>
                  <label className="agent-availability">
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      disabled={!agent.valid || isSaving}
                      onChange={(event) => void setAvailability(agent, event.target.checked)}
                      aria-label={`${agent.extension.displayName} 可用于回答`}
                    />
                    <span>{isSaving ? "保存中" : isEnabled ? "可选择" : "不参与"}</span>
                  </label>
                  <button className="agent-edit-button" onClick={() => openAgent(agent)} aria-label={`配置 ${agent.extension.displayName}`}>配置 <span aria-hidden="true">›</span></button>
                </div>
              );
            })}
          </div>
        </section>
      </>
    );
  }

  return (
    <div className="agent-editor-view">
      <PageTitle
        eyebrow="Agent detail"
        title={draft.extension.displayName || "新建 Agent"}
        description="先完成名称和职责；模型、提示词与自动选择规则按需展开。"
        aside={<button className="secondary-button" onClick={() => { setSelectedId(undefined); setDraft(undefined); }}>← 返回列表</button>}
      />
      <section className="agent-editor panel" aria-label={`${draft.extension.displayName || "未命名 Agent"} 详细配置`}>
        <div className="editor-title">
          <div className="agent-editor-identity"><ProviderIcon provider={draft.extension.avatar.provider} size="large" label={`${draft.extension.displayName || "未命名 Agent"} 头像`} /><div><span className="eyebrow">详细配置</span><h2>{draft.extension.displayName || "未命名 Agent"}</h2></div></div>
        </div>
        {!draft.valid && <div className="validation-box">{draft.issues.map((issue) => <p key={issue.code}>{issue.code} · {issue.message}</p>)}</div>}
        <div className="agent-basic-fields">
          <Field label="名称"><input autoFocus value={draft.extension.displayName} placeholder="例如：技术顾问" onChange={(event) => update((value) => { value.extension.displayName = event.target.value; })} /></Field>
          <Field label="它负责什么"><textarea rows={3} value={draft.description} placeholder="一句话说明它应该回答哪类问题" onChange={(event) => update((value) => { value.description = event.target.value; })} /></Field>
        </div>
        <details className="agent-advanced">
          <summary>高级设置 <span>模型、提示词与自动选择</span></summary>
          <div className="agent-config-stack">
            <Field label="模型">
              <select value={draft.extension.modelId || "__custom"} onChange={(event) => update((value) => {
                if (event.target.value === "__custom") {
                  value.extension.modelId = undefined;
                  return;
                }
                const model = props.models.find((item) => item.id === event.target.value);
                if (!model) return;
                value.extension.modelId = model.id;
                value.extension.provider = model.provider;
                value.extension.avatar = { kind: "provider", provider: model.provider };
                value.model.name = model.model;
              })}>
                {props.models.map((model) => <option key={model.id} value={model.id}>{model.displayName} · {model.provider}</option>)}
                <option value="__custom">目录外模型…</option>
              </select>
              {draft.extension.modelId && <span className="model-reference">引用“设置 → 模型” · {draft.extension.provider} / {draft.model.name}</span>}
            </Field>
            {!draft.extension.modelId && (
              <details className="custom-model-settings" open>
                <summary>目录外模型 <span>仅在目录没有目标模型时使用</span></summary>
                <div className="custom-model-fields">
                  <Field label="Provider">
                    <select value={draft.extension.provider} onChange={(event) => update((value) => {
                      const provider = event.target.value as ProviderId;
                      value.extension.provider = provider;
                      value.extension.avatar = { kind: "provider", provider };
                    })}>
                      <option value="openrouter">OpenRouter</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="deepseek">DeepSeek</option>
                    </select>
                  </Field>
                  <Field label="模型 ID"><input placeholder="openrouter/auto" value={draft.model.name} onChange={(event) => update((value) => { value.model.name = event.target.value; })} /></Field>
                </div>
              </details>
            )}
            <Field label="类型">
              <select value={draft.extension.role} onChange={(event) => update((value) => { value.extension.role = event.target.value as "worker" | "synthesizer"; })}>
                <option value="worker">回答 Agent</option><option value="synthesizer">聚合 Agent</option>
              </select>
            </Field>
            <Field label="技术 ID"><input value={draft.id} onChange={(event) => update((value) => { value.id = event.target.value; })} disabled={Boolean(selected)} /></Field>
          </div>
          <Field label="系统提示词"><textarea className="prompt-editor" rows={6} value={draft.systemPrompt} onChange={(event) => update((value) => { value.systemPrompt = event.target.value; })} /></Field>
          <Field label="自动选择关键词（逗号分隔）"><input value={draft.extension.selection.intents.join(", ")} onChange={(event) => update((value) => { value.extension.selection.intents = splitList(event.target.value); value.extension.selection.tags = splitList(event.target.value); })} /></Field>
        </details>
        <div className="editor-footer">
          <span>其余安全与运行参数使用稳定默认值。</span>
          <button className="primary-button" onClick={save}>保存 Agent</button>
        </div>
      </section>
    </div>
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
            <header><ProviderIcon provider={provider.id} size="large" label={`${provider.label} 品牌`} /><div><h2>{provider.label}</h2><span className={provider.configured ? "connection ready" : "connection missing"}>{provider.configured ? `已配置${provider.credentialSource === "macos-keychain" ? " · macOS Keychain" : " · 环境变量"}` : "未配置"}</span></div></header>
            <dl>
              <div><dt>环境变量</dt><dd><code>{provider.envKey}</code></dd></div>
              <div><dt>Provider 默认模型</dt><dd>{modelDisplayName(provider.id, provider.model)}</dd></div>
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

function ModelsPage(props: { models: ModelDefinition[] }) {
  return (
    <>
      <PageTitle eyebrow="Model catalog" title="模型目录" description="Agent 引用这里的 Model；Provider、官方模型 ID 与来源独立保存。模型不会在此页面发起请求。" />
      <div className="model-list panel">
        {props.models.map((model) => (
          <article key={model.id} className="model-row">
            <ProviderIcon provider={model.provider} size="large" label={`${model.provider} 品牌`} />
            <div className="model-copy">
              <span className="eyebrow">{model.provider}</span>
              <h2>{model.displayName}</h2>
              <p>{model.description}</p>
            </div>
            <dl>
              <div><dt>Model ID</dt><dd><code>{model.model}</code></dd></div>
              <div><dt>确认日期</dt><dd>{model.verifiedAt}</dd></div>
            </dl>
            <a href={model.sourceUrl} target="_blank" rel="noreferrer">官方资料 ↗</a>
          </article>
        ))}
      </div>
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
      <PageTitle eyebrow="File parsing" title="文件解析" description="把 PDF、Word、表格和文本资料转换成 Agent 可以读取的内容。内置解析器会自动工作，通常不需要手动配置。" />
      <div className="parser-summary panel">
        <div><b>{props.parsers.filter((parser) => parser.kind === "builtin").length}</b><span>内置解析器</span></div>
        <div><b>{props.parsers.filter((parser) => parser.status === "active").length}</b><span>正在工作</span></div>
        <p>只有安装本地扩展解析器时，才需要进入下面的高级维护。</p>
      </div>
      <details className="parser-maintenance panel">
        <summary><span>高级维护</span><small>扩展解析器的验证、灰度、启用和停用</small></summary>
        <div className="parser-maintenance-body">
          <div className="lifecycle-strip"><span>发现</span><i>→</i><span>验证</span><i>→</i><span>灰度</span><i>→</i><span>启用</span><i>→</i><span>弃用 / 停用</span></div>
          <div className="parser-table">
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
          <div className="security-note"><b>本地扩展边界</b><p>只发现全局 parsers 目录下的 manifest.yaml，不从网络下载代码。扩展在 Node 权限模式子进程运行，只可读取自身目录和当前输入文件，且不继承模型 API 密钥。</p></div>
        </div>
      </details>
    </>
  );
}
