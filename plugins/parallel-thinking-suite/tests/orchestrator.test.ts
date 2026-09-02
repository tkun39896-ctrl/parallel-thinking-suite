import { copyFileSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentDefinitionRepository } from "../src/server/agents.js";
import { ensureGlobalHome, ensureProject, pluginRoot } from "../src/server/config.js";
import { Orchestrator } from "../src/server/orchestrator.js";
import { ParserRegistry } from "../src/server/parsers.js";

function sse(data: unknown[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(data.map((value) => `data: ${typeof value === "string" ? value : JSON.stringify(value)}\n\n`).join("")));
      controller.close();
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function waitForTerminal(orchestrator: Orchestrator, id: string, project: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const run = orchestrator.getRun(id, project);
    if (["completed", "partial", "failed", "cancelled"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("run did not finish");
}

let home: string;
let project: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "parallel-thinking-orchestrator-"));
  project = mkdtempSync(join(tmpdir(), "parallel-thinking-run-"));
  process.env.PARALLEL_THINK_HOME = home;
  process.env.OPENAI_API_KEY = "sk-openai-test-secret-00000000";
  process.env.ANTHROPIC_API_KEY = "anthropic-test-secret-000000";
  process.env.DEEPSEEK_API_KEY = "deepseek-test-secret-0000000";
  process.env.OPENROUTER_API_KEY = "openrouter-test-secret-0000000";
  ensureGlobalHome();
  const examples = join(pluginRoot, "templates", "global", "agents");
  for (const file of readdirSync(examples)) copyFileSync(join(examples, file), join(home, "agents", file));
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
});

describe("parallel orchestration", () => {
  it("plans host-native Agent tasks without calling providers and archives submitted results", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const orchestrator = new Orchestrator({
      agents: new AgentDefinitionRepository(join(home, "agents")),
      parsers: new ParserRegistry(join(home, "parsers")),
    });
    const plan = await orchestrator.createNativeRun({
      query: "评估一个产品设计与技术方案",
      contextMode: "prompt-only",
      selection: { mode: "auto" },
      execution: { mode: "host-native", host: "codex" },
      projectRoot: project,
    });
    expect(plan.manifest.executionMode).toBe("host-native");
    expect(plan.manifest.executionHost).toBe("codex");
    expect(new Set(plan.manifest.selectedAgents)).toEqual(new Set(["product-strategist", "technology-architect"]));
    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks.find((task) => task.agentId === "product-strategist")).toEqual(expect.objectContaining({
      agentId: "product-strategist",
      fallbackProvider: "openrouter",
      fallbackModel: "openai/gpt-5-mini",
    }));
    expect(plan.tasks.find((task) => task.agentId === "product-strategist")?.systemPrompt).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    const afterFirst = orchestrator.recordNativeResult(plan.manifest.id, project, {
      agentId: "product-strategist",
      status: "completed",
      output: "Native product answer",
      resolvedModel: "codex/inherited",
    });
    expect(afterFirst.status).toBe("running");
    const finished = orchestrator.recordNativeResult(plan.manifest.id, project, {
      agentId: "technology-architect",
      status: "completed",
      output: "Native architecture answer",
      resolvedModel: "codex/inherited",
    });
    expect(finished.status).toBe("completed");
    expect(finished.agents["product-strategist"]?.executor).toBe("host-native");
    expect(finished.agents["technology-architect"]?.provider).toBe("openrouter");
    expect(fetchMock).not.toHaveBeenCalled();

    const context = orchestrator.aggregationContext(plan.manifest.id, project);
    expect(context.executionMode).toBe("host-native");
    expect(context.executionHost).toBe("codex");
    expect(new Set(context.agents.map((agent) => agent.output))).toEqual(new Set([
      "Native product answer",
      "Native architecture answer",
    ]));
    const paths = ensureProject(project);
    const events = readFileSync(join(paths.runs, plan.manifest.id, "events.jsonl"), "utf8");
    expect(events).toContain("host-native");
    expect(events).toContain("run_completed");
  });

  it("preserves successful agents and archives a partial run when one provider fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/messages")) return sse([
        { type: "content_block_delta", delta: { text: "Anthropic answer" } },
      ]);
      const model = JSON.parse(String(init?.body || "{}")).model;
      if (model === "openai/gpt-5-mini") return new Response("invalid test key", { status: 401 });
      return sse([
        { model, choices: [{ delta: { content: "DeepSeek answer" } }] },
        "[DONE]",
      ]);
    }));
    const orchestrator = new Orchestrator({
      agents: new AgentDefinitionRepository(join(home, "agents")),
      parsers: new ParserRegistry(join(home, "parsers")),
    });
    const created = orchestrator.createRun({
      query: "评估一个产品与技术方案",
      selection: { mode: "all" },
      projectRoot: project,
    });
    const finished = await waitForTerminal(orchestrator, created.id, project);
    expect(finished.status).toBe("partial");
    expect(finished.agents["technology-architect"]?.output).toContain("DeepSeek answer");
    expect(finished.agents["technology-architect"]?.resolvedModel).toBe("deepseek/deepseek-v4-pro-0813");
    expect(finished.agents["critical-reviewer"]?.output).toContain("Anthropic answer");
    expect(finished.agents["product-strategist"]?.status).toBe("failed");
    const paths = ensureProject(project);
    const events = readFileSync(join(paths.runs, created.id, "events.jsonl"), "utf8");
    expect(events).toContain("text_delta");
    expect(events).toContain("model_resolved");
    expect(events).toContain("agent_failed");
    expect(events).toContain("run_completed");
    expect(events).not.toContain("sk-openai-test-secret");
    expect(readFileSync(join(paths.runs, created.id, "manifest.json"), "utf8")).not.toContain("anthropic-test-secret");
  });

  it("retries only the failed Agent in a new archived run", async () => {
    let openAiFails = true;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/messages")) return sse([{ type: "content_block_delta", delta: { text: "ok" } }]);
      const model = JSON.parse(String(init?.body || "{}")).model;
      if (model === "openai/gpt-5-mini" && openAiFails) return new Response("temporary", { status: 400 });
      return sse([{ model, choices: [{ delta: { content: model === "openai/gpt-5-mini" ? "Recovered" : "ok" } }] }, "[DONE]"]);
    }));
    const orchestrator = new Orchestrator({
      agents: new AgentDefinitionRepository(join(home, "agents")),
      parsers: new ParserRegistry(join(home, "parsers")),
    });
    const first = orchestrator.createRun({ query: "test", selection: { mode: "all" }, projectRoot: project });
    const firstDone = await waitForTerminal(orchestrator, first.id, project);
    expect(firstDone.status).toBe("partial");
    openAiFails = false;
    const retried = orchestrator.retryFailed(first.id, project);
    expect(retried.selectedAgents).toEqual(["product-strategist"]);
    const retryDone = await waitForTerminal(orchestrator, retried.id, project);
    expect(retryDone.status).toBe("completed");
    expect(retryDone.agents["product-strategist"]?.output).toBe("Recovered");
  });

  it("keeps direct-provider results when an OpenRouter Agent fails and redacts its key", async () => {
    process.env.OPENROUTER_API_KEY = "openrouter-orchestrator-secret-000000";
    const repository = new AgentDefinitionRepository(join(home, "agents"));
    const architect = repository.getAgent("technology-architect");
    repository.saveAgent({
      ...architect,
      model: { ...architect.model, name: "deepseek-chat" },
      extension: { ...architect.extension, provider: "deepseek" },
    });
    const strategist = repository.getAgent("product-strategist");
    repository.saveAgent({
      ...strategist,
      model: { name: "gpt-5-mini", maxTokens: strategist.model.maxTokens },
      extension: { ...strategist.extension, provider: "openai" },
    });
    const reviewer = repository.getAgent("critical-reviewer");
    repository.saveAgent({
      ...reviewer,
      model: { ...reviewer.model, name: "anthropic/claude-test" },
      extension: { ...reviewer.extension, provider: "openrouter" },
    });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("openrouter.ai")) {
        return new Response(JSON.stringify({ error: { code: 503, message: `unavailable ${process.env.OPENROUTER_API_KEY}` } }), { status: 503 });
      }
      if (url.includes("/v1/responses")) return sse([
        { type: "response.output_text.delta", delta: "OpenAI answer" },
        { type: "response.completed", response: { usage: { total_tokens: 2 } } },
      ]);
      return sse([
        { choices: [{ delta: { content: "DeepSeek answer" } }] },
        "[DONE]",
      ]);
    }));
    const orchestrator = new Orchestrator({
      agents: repository,
      parsers: new ParserRegistry(join(home, "parsers")),
    });
    const created = orchestrator.createRun({ query: "test", selection: { mode: "all" }, projectRoot: project });
    const finished = await waitForTerminal(orchestrator, created.id, project);
    expect(finished.status).toBe("partial");
    expect(finished.agents["critical-reviewer"]?.provider).toBe("openrouter");
    expect(finished.agents["critical-reviewer"]?.status).toBe("failed");
    expect(finished.agents["product-strategist"]?.output).toBe("OpenAI answer");
    expect(finished.agents["technology-architect"]?.output).toBe("DeepSeek answer");
    const paths = ensureProject(project);
    const archive = [
      readFileSync(join(paths.runs, created.id, "manifest.json"), "utf8"),
      readFileSync(join(paths.runs, created.id, "events.jsonl"), "utf8"),
      readFileSync(join(paths.runs, created.id, "agents", "critical-reviewer.json"), "utf8"),
    ].join("\n");
    expect(archive).not.toContain("openrouter-orchestrator-secret");
    expect(archive).toContain("[REDACTED]");
  });
});
