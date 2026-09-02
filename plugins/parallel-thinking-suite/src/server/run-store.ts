import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { AgentRunResult, RunEvent, RunManifest, RunRequest } from "../shared/types.js";
import type { ProjectPaths } from "./config.js";

function secretValues(): string[] {
  return ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY"]
    .map((name) => process.env[name]?.trim())
    .filter((value): value is string => Boolean(value && value.length >= 8));
}

export function redactSecrets<T>(value: T): T {
  const serialized = JSON.stringify(value);
  let redacted = serialized;
  for (const secret of secretValues()) redacted = redacted.split(secret).join("[REDACTED]");
  redacted = redacted
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, "[REDACTED_KEY]")
    .replace(/(?:api[_-]?key)["'\s:=]+[A-Za-z0-9_-]{16,}/gi, "api-key=[REDACTED_KEY]");
  return JSON.parse(redacted) as T;
}

export class RunStore {
  constructor(readonly paths: ProjectPaths) {}

  create(manifest: RunManifest, request: RunRequest): void {
    const dir = this.runDir(manifest.id);
    mkdirSync(join(dir, "agents"), { recursive: true });
    this.writeManifest(manifest);
    this.atomicJson(join(dir, "request.json"), redactSecrets(request));
    writeFileSync(join(dir, "events.jsonl"), "", "utf8");
  }

  writeManifest(manifest: RunManifest): void {
    this.atomicJson(join(this.runDir(manifest.id), "manifest.json"), redactSecrets(manifest));
  }

  writeAgent(runId: string, result: AgentRunResult): void {
    this.atomicJson(join(this.runDir(runId), "agents", `${result.agentId}.json`), redactSecrets(result));
  }

  appendEvent(event: RunEvent): void {
    appendFileSync(
      join(this.runDir(event.runId), "events.jsonl"),
      JSON.stringify(redactSecrets(event)) + "\n",
      "utf8",
    );
  }

  get(runId: string): RunManifest {
    return JSON.parse(readFileSync(join(this.runDir(runId), "manifest.json"), "utf8")) as RunManifest;
  }

  getRequest(runId: string): RunRequest {
    return JSON.parse(readFileSync(join(this.runDir(runId), "request.json"), "utf8")) as RunRequest;
  }

  list(limit = 30): RunManifest[] {
    if (!existsSync(this.paths.runs)) return [];
    return readdirSync(this.paths.runs)
      .filter((name) => existsSync(join(this.paths.runs, name, "manifest.json")))
      .map((name) => this.get(name))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  resolveRunId(id: string): string {
    if (id !== "latest") {
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("无效的运行编号");
      if (!existsSync(join(this.paths.runs, id, "manifest.json"))) throw new Error(`运行不存在：${id}`);
      return id;
    }
    const latest = this.list(1)[0];
    if (!latest) throw new Error("当前项目还没有并行思考运行");
    return latest.id;
  }

  aggregationContext(id: string): {
    runId: string;
    query: string;
    status: string;
    agents: Array<Pick<AgentRunResult, "agentId" | "displayName" | "provider" | "model" | "status" | "output" | "error">>;
  } {
    const runId = this.resolveRunId(id);
    const manifest = this.get(runId);
    return redactSecrets({
      runId,
      query: manifest.query,
      status: manifest.status,
      agents: Object.values(manifest.agents).map((agent) => ({
        agentId: agent.agentId,
        displayName: agent.displayName,
        provider: agent.provider,
        model: agent.model,
        status: agent.status,
        output: agent.output,
        error: agent.error,
      })),
    });
  }

  private runDir(runId: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error("无效的运行编号");
    return join(this.paths.runs, runId);
  }

  private atomicJson(path: string, value: unknown): void {
    mkdirSync(join(path, ".."), { recursive: true });
    const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temp, JSON.stringify(value, null, 2), "utf8");
    const previous = path + ".previous";
    if (existsSync(path)) renameSync(path, previous);
    try {
      renameSync(temp, path);
      rmSync(previous, { force: true });
    } catch (error) {
      if (existsSync(previous) && !existsSync(path)) renameSync(previous, path);
      throw error;
    } finally {
      rmSync(temp, { force: true });
    }
  }
}
