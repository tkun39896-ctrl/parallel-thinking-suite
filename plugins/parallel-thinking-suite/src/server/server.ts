import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { URL } from "node:url";
import type { AgentDraft, NativeAgentResultSubmission, ProviderId, RunRequest } from "../shared/types.js";
import { AgentDefinitionRepository } from "./agents.js";
import { assertInside, ensureGlobalHome, ensureProject, pluginRoot } from "./config.js";
import { inspectKnowledge } from "./knowledge.js";
import { ModelCatalogRepository } from "./models.js";
import { Orchestrator } from "./orchestrator.js";
import { collectFiles, ParserRegistry } from "./parsers.js";
import { providerStatuses, testProvider } from "./providers.js";

const host = "127.0.0.1";
const port = Number(process.env.PARALLEL_THINK_PORT || 4317);
const home = ensureGlobalHome();
const agents = new AgentDefinitionRepository();
const models = new ModelCatalogRepository();
const parsers = new ParserRegistry();
const orchestrator = new Orchestrator({ agents, parsers });

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > 2_000_000) throw new Error("请求体超过 2 MB");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {} as T;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function projectRoot(url: URL): string | undefined {
  return url.searchParams.get("projectRoot") || undefined;
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url || "/", `http://${host}:${port}`);
  const method = request.method || "GET";

  if (method === "GET" && url.pathname === "/api/health") {
    json(response, 200, { ok: true, service: "parallel-thinking-suite", home, version: "0.1.0" });
    return;
  }
  if (method === "GET" && url.pathname === "/api/providers") {
    json(response, 200, providerStatuses());
    return;
  }
  if (method === "GET" && url.pathname === "/api/models") {
    json(response, 200, models.listModels());
    return;
  }
  const providerTest = url.pathname.match(/^\/api\/providers\/(openai|anthropic|deepseek|openrouter)\/test$/);
  if (method === "POST" && providerTest) {
    json(response, 200, await testProvider(providerTest[1] as ProviderId));
    return;
  }

  if (method === "GET" && url.pathname === "/api/agents") {
    json(response, 200, agents.listAgents());
    return;
  }
  const agentMatch = url.pathname.match(/^\/api\/agents\/([a-z0-9-]+)$/);
  if (method === "PUT" && agentMatch) {
    const draft = await readJson<AgentDraft>(request);
    if (draft.id !== agentMatch[1]) throw new Error("URL 中的 Agent ID 与请求体不一致");
    json(response, 200, agents.saveAgent(draft));
    return;
  }
  const restoreMatch = url.pathname.match(/^\/api\/agents\/([a-z0-9-]+)\/restore$/);
  if (method === "POST" && restoreMatch) {
    const body = await readJson<{ revision: string }>(request);
    json(response, 200, agents.restoreAgentRevision(restoreMatch[1]!, body.revision));
    return;
  }

  if (method === "GET" && url.pathname === "/api/runs") {
    json(response, 200, orchestrator.listRuns(projectRoot(url)));
    return;
  }
  if (method === "POST" && url.pathname === "/api/runs/native") {
    const body = await readJson<RunRequest>(request);
    json(response, 202, await orchestrator.createNativeRun(body));
    return;
  }
  if (method === "POST" && url.pathname === "/api/runs") {
    const body = await readJson<RunRequest>(request);
    json(response, 202, orchestrator.createRun(body));
    return;
  }
  const runMatch = url.pathname.match(/^\/api\/runs\/([a-zA-Z0-9_-]+)$/);
  if (method === "GET" && runMatch) {
    json(response, 200, orchestrator.getRun(runMatch[1]!, projectRoot(url)));
    return;
  }
  const eventsMatch = url.pathname.match(/^\/api\/runs\/([a-zA-Z0-9_-]+)\/events$/);
  if (method === "GET" && eventsMatch) {
    const runId = eventsMatch[1]!;
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    response.write(`event: snapshot\ndata: ${JSON.stringify(orchestrator.getRun(runId, projectRoot(url)))}\n\n`);
    const unsubscribe = orchestrator.subscribe(runId, (event) => {
      response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15_000);
    request.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
    return;
  }
  const cancelMatch = url.pathname.match(/^\/api\/runs\/([a-zA-Z0-9_-]+)\/cancel$/);
  if (method === "POST" && cancelMatch) {
    json(response, 200, orchestrator.cancel(cancelMatch[1]!));
    return;
  }
  const retryMatch = url.pathname.match(/^\/api\/runs\/([a-zA-Z0-9_-]+)\/retry$/);
  if (method === "POST" && retryMatch) {
    const body = await readJson<{ projectRoot?: string }>(request);
    json(response, 202, orchestrator.retryFailed(retryMatch[1]!, body.projectRoot));
    return;
  }
  const nativeResultMatch = url.pathname.match(/^\/api\/runs\/([a-zA-Z0-9_-]+)\/native-result$/);
  if (method === "POST" && nativeResultMatch) {
    const body = await readJson<{ projectRoot?: string; result: NativeAgentResultSubmission }>(request);
    if (!body.result) throw new Error("result 不能为空");
    json(response, 200, orchestrator.recordNativeResult(nativeResultMatch[1]!, body.projectRoot, body.result));
    return;
  }
  const contextMatch = url.pathname.match(/^\/api\/runs\/([a-zA-Z0-9_-]+)\/context$/);
  if (method === "GET" && contextMatch) {
    json(response, 200, orchestrator.aggregationContext(contextMatch[1]!, projectRoot(url)));
    return;
  }
  const aggregateMatch = url.pathname.match(/^\/api\/runs\/([a-zA-Z0-9_-]+)\/aggregate$/);
  if (method === "POST" && aggregateMatch) {
    const body = await readJson<{ projectRoot?: string }>(request);
    json(response, 200, await orchestrator.aggregateWithAgent(aggregateMatch[1]!, body.projectRoot));
    return;
  }

  if (method === "GET" && url.pathname === "/api/knowledge") {
    const paths = ensureProject(projectRoot(url));
    json(response, 200, await inspectKnowledge(agents.listAgents(), paths, parsers));
    return;
  }
  if (method === "GET" && url.pathname === "/api/parsers") {
    parsers.discover();
    json(response, 200, parsers.list());
    return;
  }
  const parserAction = url.pathname.match(/^\/api\/parsers\/([a-z0-9-]+)\/([0-9.]+)\/(validate|activate|deprecate|disable)$/);
  if (method === "POST" && parserAction) {
    const [, id, version, action] = parserAction;
    if (action === "validate") json(response, 200, await parsers.validate(id!, version!));
    if (action === "activate") {
      const files = collectFiles([join(home, "knowledge")], 500);
      json(response, 200, await parsers.canaryAndActivate(id!, version!, files));
    }
    if (action === "deprecate") json(response, 200, parsers.setStatus(id!, version!, "deprecated"));
    if (action === "disable") json(response, 200, parsers.setStatus(id!, version!, "disabled"));
    return;
  }

  if (method === "GET" && !url.pathname.startsWith("/api/")) {
    serveStatic(url.pathname, response);
    return;
  }
  json(response, 404, { error: { code: "NOT_FOUND", message: "接口不存在" } });
}

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
};

function serveStatic(pathname: string, response: ServerResponse): void {
  const publicRoot = join(pluginRoot, "dist", "public");
  const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  let path: string;
  try {
    path = assertInside(publicRoot, normalize(join(publicRoot, relative)));
  } catch {
    json(response, 403, { error: { code: "FORBIDDEN", message: "静态文件路径越界" } });
    return;
  }
  if (!existsSync(path) || statSync(path).isDirectory()) path = join(publicRoot, "index.html");
  if (!existsSync(path)) {
    json(response, 503, { error: { code: "UI_NOT_BUILT", message: "请先运行 npm run build" } });
    return;
  }
  response.writeHead(200, {
    "content-type": contentTypes[extname(path)] || "application/octet-stream",
    "cache-control": path.endsWith("index.html") ? "no-cache" : "public, max-age=3600",
  });
  createReadStream(path).pipe(response);
}

const server = createServer((request, response) => {
  void route(request, response).catch((error) => {
    if (response.headersSent) {
      response.end();
      return;
    }
    json(response, 400, {
      error: {
        code: "REQUEST_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  });
});

server.listen(port, host, () => {
  process.stdout.write(`并行思考已启动：http://${host}:${port}\n`);
});

function shutdown(): void {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
