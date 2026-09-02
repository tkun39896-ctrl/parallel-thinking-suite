import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PARALLEL_THINK_PORT || 4317);
const origin = `http://127.0.0.1:${port}`;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function stdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function ensureServer(): Promise<void> {
  try {
    const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(800) });
    if (response.ok) return;
  } catch {
    // Start the packaged local service below.
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const serverPath = resolve(here, "server.mjs");
  const child = spawn(process.execPath, [serverPath], {
    cwd: process.cwd(),
    detached: true,
    windowsHide: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // Keep polling within the bounded startup window.
    }
  }
  throw new Error("本地并行思考服务启动失败");
}

async function requestJson(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(`${origin}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
  return body;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!["run", "plan-native", "record-native", "context", "aggregate"].includes(command || "")) {
    throw new Error("用法：cli.mjs run --stdin | plan-native --stdin | record-native --stdin | context --run <id> | aggregate --run <id>");
  }
  await ensureServer();
  if (command === "run") {
    const raw = await stdin();
    const input = JSON.parse(raw || "{}");
    const providerInput = { ...input, execution: { mode: "provider" } };
    const manifest = await requestJson("/api/runs", { method: "POST", body: JSON.stringify(providerInput) });
    const projectRoot = String(manifest.projectRoot || input.projectRoot || process.cwd());
    process.stdout.write(JSON.stringify({
      runId: manifest.id,
      url: `${origin}/runs/${manifest.id}?projectRoot=${encodeURIComponent(projectRoot)}`,
      selectedAgents: manifest.selectedAgents,
      taskStructure: Object.values(manifest.agents).map((agent: any) => ({
        agentId: agent.agentId,
        task: agent.task,
        provider: agent.provider,
      })),
    }, null, 2) + "\n");
    return;
  }
  if (command === "plan-native") {
    const raw = await stdin();
    const input = JSON.parse(raw || "{}");
    const host = String(input.execution?.host || argument("--host") || "").trim();
    if (!host) throw new Error("plan-native 需要 execution.host 或 --host");
    const plan = await requestJson("/api/runs/native", {
      method: "POST",
      body: JSON.stringify({ ...input, execution: { mode: "host-native", host } }),
    });
    const manifest = plan.manifest;
    const projectRoot = String(manifest.projectRoot || input.projectRoot || process.cwd());
    process.stdout.write(JSON.stringify({
      runId: manifest.id,
      url: `${origin}/runs/${manifest.id}?projectRoot=${encodeURIComponent(projectRoot)}`,
      executionMode: manifest.executionMode,
      executionHost: manifest.executionHost,
      selectedAgents: manifest.selectedAgents,
      tasks: plan.tasks,
    }, null, 2) + "\n");
    return;
  }
  if (command === "record-native") {
    const raw = await stdin();
    const input = JSON.parse(raw || "{}");
    const runId = String(input.runId || "").trim();
    if (!runId) throw new Error("record-native 需要 runId");
    if (!input.result) throw new Error("record-native 需要 result");
    const manifest = await requestJson(`/api/runs/${encodeURIComponent(runId)}/native-result`, {
      method: "POST",
      body: JSON.stringify({ projectRoot: input.projectRoot || process.cwd(), result: input.result }),
    });
    process.stdout.write(JSON.stringify({
      runId: manifest.id,
      status: manifest.status,
      agentId: input.result.agentId,
      agentStatus: manifest.agents?.[input.result.agentId]?.status,
    }, null, 2) + "\n");
    return;
  }
  const runId = argument("--run") || "latest";
  const root = argument("--project-root") || process.cwd();
  if (command === "context") {
    const body = await requestJson(`/api/runs/${encodeURIComponent(runId)}/context?projectRoot=${encodeURIComponent(root)}`);
    process.stdout.write(JSON.stringify(body, null, 2) + "\n");
    return;
  }
  const resolved = runId === "latest"
    ? (await requestJson(`/api/runs?projectRoot=${encodeURIComponent(root)}`))[0]?.id
    : runId;
  if (!resolved) throw new Error("没有可聚合的运行");
  const manifest = await requestJson(`/api/runs/${encodeURIComponent(resolved)}/aggregate`, {
    method: "POST",
    body: JSON.stringify({ projectRoot: root }),
  });
  process.stdout.write(JSON.stringify({ runId: manifest.id, synthesis: manifest.synthesis }, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
  process.exitCode = 1;
});
