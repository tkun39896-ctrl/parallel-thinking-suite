import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type {
  AgentRunResult,
  AgentSummary,
  ExecutionMode,
  NativeAgentResultSubmission,
  NativeRunPlan,
  ProviderId,
  RunEvent,
  RunManifest,
  RunRequest,
} from "../shared/types.js";
import { AgentDefinitionRepository, selectAgents } from "./agents.js";
import { ensureProject, type ProjectPaths } from "./config.js";
import { buildKnowledgePackage } from "./knowledge.js";
import { ParserRegistry } from "./parsers.js";
import { streamAgent } from "./providers.js";
import { RunStore } from "./run-store.js";

type EventListener = (event: RunEvent) => void;

class Semaphore {
  private active = 0;
  private waiters: Array<() => void> = [];
  constructor(private readonly limit: number) {}

  async use<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
}

interface ActiveRun {
  manifest: RunManifest;
  request: RunRequest;
  paths: ProjectPaths;
  store: RunStore;
  controller: AbortController;
  sequence: number;
}

export class Orchestrator {
  private readonly agents: AgentDefinitionRepository;
  private readonly parsers: ParserRegistry;
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly listeners = new Map<string, Set<EventListener>>();

  constructor(options: { agents?: AgentDefinitionRepository; parsers?: ParserRegistry } = {}) {
    this.agents = options.agents || new AgentDefinitionRepository();
    this.parsers = options.parsers || new ParserRegistry();
  }

  createRun(request: RunRequest): RunManifest {
    const { run, selected } = this.prepareRun(request, "provider");
    this.activeRuns.set(run.manifest.id, run);
    queueMicrotask(() => void this.execute(run, selected));
    return run.manifest;
  }

  async createNativeRun(request: RunRequest): Promise<NativeRunPlan> {
    const host = request.execution?.host?.trim();
    if (!host) throw new Error("host-native 运行必须声明 execution.host");
    const { run, selected } = this.prepareRun(request, "host-native", host);
    run.manifest.status = "running";
    run.manifest.updatedAt = new Date().toISOString();
    run.store.writeManifest(run.manifest);
    this.emit(run, "run_started", {
      data: { selectedAgents: run.manifest.selectedAgents, executionMode: "host-native", executionHost: host },
    });
    const tasks = await Promise.all(selected.map(async (agent) => ({
      agentId: agent.id,
      displayName: agent.extension.displayName,
      task: run.manifest.agents[agent.id]!.task,
      systemPrompt: [
        "你是“并行思考”中的一个独立 Agent。请独立作答，不假装知道其他 Agent 的答案。",
        "明确区分事实、推断和不确定性。只输出可公开的最终答案，不输出隐藏思维链。",
        agent.systemPrompt,
      ].join("\n\n"),
      contextPackage: await this.contextForAgent(run, agent),
      fallbackProvider: agent.extension.provider,
      fallbackModel: run.manifest.agents[agent.id]!.model,
    })));
    return { manifest: run.manifest, tasks };
  }

  recordNativeResult(
    runId: string,
    projectRoot: string | undefined,
    submission: NativeAgentResultSubmission,
  ): RunManifest {
    const paths = ensureProject(projectRoot);
    const store = new RunStore(paths);
    const resolved = store.resolveRunId(runId);
    const manifest = store.get(resolved);
    if (manifest.executionMode !== "host-native") throw new Error("该运行不是宿主原生运行");
    const result = manifest.agents[submission.agentId];
    if (!result) throw new Error(`运行中不存在 Agent：${submission.agentId}`);
    if (result.completedAt && ["completed", "failed", "cancelled"].includes(result.status)) return manifest;

    result.executor = "host-native";
    result.status = submission.status;
    result.startedAt = submission.startedAt || result.startedAt || new Date().toISOString();
    result.completedAt = submission.completedAt || new Date().toISOString();
    result.output = submission.output || "";
    result.error = submission.error;
    result.resolvedModel = submission.resolvedModel;
    result.usage = submission.usage;

    this.emitForManifest(store, manifest, "agent_started", {
      agentId: result.agentId,
      data: { task: result.task, executionMode: "host-native", executionHost: manifest.executionHost },
    });
    if (result.resolvedModel) {
      this.emitForManifest(store, manifest, "model_resolved", {
        agentId: result.agentId,
        data: { model: result.resolvedModel },
      });
    }
    if (result.output) this.emitForManifest(store, manifest, "text_delta", { agentId: result.agentId, delta: result.output });
    if (result.usage) this.emitForManifest(store, manifest, "usage", { agentId: result.agentId, usage: result.usage });
    const terminalEvent = result.status === "completed"
      ? "agent_completed"
      : result.status === "cancelled" ? "agent_cancelled" : "agent_failed";
    this.emitForManifest(store, manifest, terminalEvent, { agentId: result.agentId, message: result.error });
    store.writeAgent(manifest.id, result);

    const values = Object.values(manifest.agents);
    const allTerminal = values.every((value) => ["completed", "failed", "cancelled"].includes(value.status));
    if (allTerminal) {
      if (values.every((value) => value.status === "completed")) manifest.status = "completed";
      else if (values.some((value) => value.status === "completed")) manifest.status = "partial";
      else if (values.every((value) => value.status === "cancelled")) manifest.status = "cancelled";
      else manifest.status = "failed";
    } else {
      manifest.status = "running";
    }
    manifest.updatedAt = new Date().toISOString();
    store.writeManifest(manifest);
    if (allTerminal) {
      this.emitForManifest(store, manifest, manifest.status === "cancelled" ? "run_cancelled" : "run_completed", {
        data: { status: manifest.status, executionMode: "host-native", executionHost: manifest.executionHost },
      });
    }
    return manifest;
  }

  private prepareRun(
    request: RunRequest,
    executionMode: ExecutionMode,
    executionHost?: string,
  ): { run: ActiveRun; selected: AgentSummary[] } {
    const query = request.query?.trim();
    if (!query) throw new Error("query 不能为空");
    const paths = ensureProject(request.projectRoot);
    const store = new RunStore(paths);
    const mode = request.selection?.mode || "auto";
    const selected = selectAgents(this.agents.listAgents(), query, mode, request.selection?.agentIds);
    if (selected.length === 0) throw new Error("没有符合条件且配置有效的 Agent");
    const now = new Date().toISOString();
    const id = `${now.replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
    const agentResults = Object.fromEntries(selected.map((agent) => {
      const model = agent.model.name === "inherited" ? "provider-default" : agent.model.name;
      const task = request.agentTasks?.[agent.id]?.trim() || query;
      return [agent.id, {
        agentId: agent.id,
        displayName: agent.extension.displayName,
        provider: agent.extension.provider,
        avatar: agent.extension.avatar,
        model,
        executor: executionMode,
        status: "queued",
        task,
        output: "",
      } satisfies AgentRunResult];
    }));
    const manifest: RunManifest = {
      id,
      query,
      contextMode: request.contextMode || "summary",
      selectionMode: mode,
      executionMode,
      executionHost,
      selectedAgents: selected.map((agent) => agent.id),
      projectRoot: paths.root,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      agents: agentResults,
    };
    const normalizedRequest: RunRequest = {
      ...request,
      query,
      execution: { mode: executionMode, ...(executionHost ? { host: executionHost } : {}) },
      projectRoot: paths.root,
    };
    store.create(manifest, normalizedRequest);
    const run: ActiveRun = {
      manifest,
      request: normalizedRequest,
      paths,
      store,
      controller: new AbortController(),
      sequence: 0,
    };
    return { run, selected };
  }

  getRun(runId: string, projectRoot?: string): RunManifest {
    const active = this.activeRuns.get(runId);
    if (active) return active.manifest;
    return new RunStore(ensureProject(projectRoot)).get(runId);
  }

  listRuns(projectRoot?: string): RunManifest[] {
    return new RunStore(ensureProject(projectRoot)).list();
  }

  cancel(runId: string): RunManifest {
    const run = this.activeRuns.get(runId);
    if (!run) throw new Error("运行不在执行中");
    run.controller.abort(new Error("用户取消"));
    return run.manifest;
  }

  subscribe(runId: string, listener: EventListener): () => void {
    const set = this.listeners.get(runId) || new Set<EventListener>();
    set.add(listener);
    this.listeners.set(runId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(runId);
    };
  }

  aggregationContext(runId: string, projectRoot?: string) {
    return new RunStore(ensureProject(projectRoot)).aggregationContext(runId);
  }

  retryFailed(runId: string, projectRoot?: string): RunManifest {
    const paths = ensureProject(projectRoot);
    const store = new RunStore(paths);
    const resolved = store.resolveRunId(runId);
    const old = store.get(resolved);
    if (old.executionMode === "host-native") throw new Error("宿主原生运行请由当前宿主重新规划失败 Agent");
    const request = store.getRequest(resolved);
    const failed = Object.values(old.agents)
      .filter((agent) => agent.status === "failed" || agent.status === "cancelled")
      .map((agent) => agent.agentId);
    if (failed.length === 0) throw new Error("没有可重试的失败 Agent");
    return this.createRun({ ...request, selection: { mode: "explicit", agentIds: failed }, projectRoot: paths.root });
  }

  async aggregateWithAgent(runId: string, projectRoot?: string): Promise<RunManifest> {
    const paths = ensureProject(projectRoot);
    const store = new RunStore(paths);
    const resolved = store.resolveRunId(runId);
    const manifest = this.getRun(resolved, paths.root);
    const synthesizer = this.agents.listAgents().find((agent) =>
      agent.valid && agent.extension.enabled && agent.extension.role === "synthesizer"
    );
    if (!synthesizer) throw new Error("没有已启用的聚合 Agent");
    const context = store.aggregationContext(resolved);
    let output = "";
    await streamAgent({
      agent: synthesizer,
      task: "聚合以下并行回答，输出共识、分歧、风险、建议和待决问题，并标注来源 Agent。",
      contextPackage: JSON.stringify(context, null, 2),
      signal: AbortSignal.timeout(synthesizer.extension.limits.totalTimeoutMs),
      onDelta: (delta) => { output += delta; },
      onUsage: () => undefined,
    });
    manifest.synthesis = {
      agentId: synthesizer.id,
      output,
      createdAt: new Date().toISOString(),
    };
    manifest.updatedAt = new Date().toISOString();
    store.writeManifest(manifest);
    this.emitForManifest(store, manifest, "synthesis_completed", { agentId: synthesizer.id, data: manifest.synthesis });
    return manifest;
  }

  private async execute(run: ActiveRun, agents: AgentSummary[]): Promise<void> {
    run.manifest.status = "running";
    run.manifest.updatedAt = new Date().toISOString();
    run.store.writeManifest(run.manifest);
    this.emit(run, "run_started", { data: { selectedAgents: run.manifest.selectedAgents } });

    const projectConfig = parseYaml(readFileSync(run.paths.config, "utf8")) as {
      concurrency?: { global?: number; perProvider?: number };
    };
    const globalSemaphore = new Semaphore(projectConfig.concurrency?.global || 6);
    const perProvider = new Map<ProviderId, Semaphore>();
    for (const provider of ["openai", "anthropic", "deepseek", "openrouter"] as ProviderId[]) {
      perProvider.set(provider, new Semaphore(projectConfig.concurrency?.perProvider || 2));
    }

    await Promise.all(agents.map((agent) => globalSemaphore.use(() =>
      perProvider.get(agent.extension.provider)!.use(() => this.executeAgent(run, agent))
    )));

    const values = Object.values(run.manifest.agents);
    if (run.controller.signal.aborted) run.manifest.status = "cancelled";
    else if (values.every((value) => value.status === "completed")) run.manifest.status = "completed";
    else if (values.some((value) => value.status === "completed")) run.manifest.status = "partial";
    else run.manifest.status = "failed";
    run.manifest.updatedAt = new Date().toISOString();
    run.store.writeManifest(run.manifest);
    this.emit(run, run.manifest.status === "cancelled" ? "run_cancelled" : "run_completed", {
      data: { status: run.manifest.status },
    });
    this.activeRuns.delete(run.manifest.id);
  }

  private async executeAgent(run: ActiveRun, agent: AgentSummary): Promise<void> {
    const result = run.manifest.agents[agent.id]!;
    if (run.controller.signal.aborted) {
      result.status = "cancelled";
      result.completedAt = new Date().toISOString();
      run.store.writeAgent(run.manifest.id, result);
      this.emit(run, "agent_cancelled", { agentId: agent.id });
      return;
    }
    result.status = "running";
    result.startedAt = new Date().toISOString();
    this.emit(run, "agent_started", { agentId: agent.id, data: { task: result.task } });
    try {
      const contextPackage = await this.contextForAgent(run, agent);
      await streamAgent({
        agent,
        task: result.task,
        contextPackage,
        signal: run.controller.signal,
        onDelta: (delta) => {
          result.output += delta;
          this.emit(run, "text_delta", { agentId: agent.id, delta });
        },
        onModel: (resolvedModel) => {
          if (result.resolvedModel === resolvedModel) return;
          result.resolvedModel = resolvedModel;
          this.emit(run, "model_resolved", { agentId: agent.id, data: { model: resolvedModel } });
        },
        onUsage: (usage) => {
          result.usage = { ...result.usage, ...usage };
          this.emit(run, "usage", { agentId: agent.id, usage });
        },
      });
      result.status = "completed";
      result.completedAt = new Date().toISOString();
      this.emit(run, "agent_completed", { agentId: agent.id });
    } catch (error) {
      result.completedAt = new Date().toISOString();
      if (run.controller.signal.aborted) {
        result.status = "cancelled";
        result.error = "请求已取消";
        this.emit(run, "agent_cancelled", { agentId: agent.id });
      } else {
        result.status = "failed";
        result.error = error instanceof Error ? error.message : String(error);
        this.emit(run, "agent_failed", { agentId: agent.id, message: result.error });
      }
    } finally {
      run.manifest.updatedAt = new Date().toISOString();
      run.store.writeAgent(run.manifest.id, result);
      run.store.writeManifest(run.manifest);
    }
  }

  private async contextForAgent(run: ActiveRun, agent: AgentSummary): Promise<string> {
    const knowledge = await buildKnowledgePackage(agent, run.paths, this.parsers);
    const conversation = run.manifest.contextMode === "prompt-only" ? "" : (run.request.context || "");
    return [
      conversation ? `## 对话上下文\n${conversation}` : "",
      knowledge.text ? `## Agent 知识库\n${knowledge.text}` : "",
    ].filter(Boolean).join("\n\n");
  }

  private emit(
    run: ActiveRun,
    type: RunEvent["type"],
    partial: Omit<Partial<RunEvent>, "runId" | "sequence" | "type" | "at"> = {},
  ): void {
    const event: RunEvent = {
      runId: run.manifest.id,
      sequence: ++run.sequence,
      type,
      at: new Date().toISOString(),
      ...partial,
    };
    run.store.appendEvent(event);
    for (const listener of this.listeners.get(run.manifest.id) || []) listener(event);
  }

  private emitForManifest(
    store: RunStore,
    manifest: RunManifest,
    type: RunEvent["type"],
    partial: Omit<Partial<RunEvent>, "runId" | "sequence" | "type" | "at">,
  ): void {
    const event: RunEvent = {
      runId: manifest.id,
      sequence: Date.now(),
      type,
      at: new Date().toISOString(),
      ...partial,
    };
    store.appendEvent(event);
    for (const listener of this.listeners.get(manifest.id) || []) listener(event);
  }
}
