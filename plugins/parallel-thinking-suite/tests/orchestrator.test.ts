import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentDefinitionRepository } from "../src/server/agents.js";
import { ensureGlobalHome, ensureProject } from "../src/server/config.js";
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
  ensureGlobalHome();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
});

describe("parallel orchestration", () => {
  it("preserves successful agents and archives a partial run when one provider fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/v1/responses")) return new Response("invalid test key", { status: 401 });
      if (url.includes("/v1/messages")) return sse([
        { type: "content_block_delta", delta: { text: "Anthropic answer" } },
      ]);
      return sse([
        { choices: [{ delta: { content: "DeepSeek answer" } }] },
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
    expect(finished.agents["critical-reviewer"]?.output).toContain("Anthropic answer");
    expect(finished.agents["product-strategist"]?.status).toBe("failed");
    const paths = ensureProject(project);
    const events = readFileSync(join(paths.runs, created.id, "events.jsonl"), "utf8");
    expect(events).toContain("text_delta");
    expect(events).toContain("agent_failed");
    expect(events).toContain("run_completed");
    expect(events).not.toContain("sk-openai-test-secret");
    expect(readFileSync(join(paths.runs, created.id, "manifest.json"), "utf8")).not.toContain("anthropic-test-secret");
  });

  it("retries only the failed Agent in a new archived run", async () => {
    let openAiFails = true;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/v1/responses") && openAiFails) return new Response("temporary", { status: 400 });
      if (url.includes("/v1/responses")) return sse([
        { type: "response.output_text.delta", delta: "Recovered" },
        { type: "response.completed", response: { usage: {} } },
      ]);
      if (url.includes("/v1/messages")) return sse([{ type: "content_block_delta", delta: { text: "ok" } }]);
      return sse([{ choices: [{ delta: { content: "ok" } }] }, "[DONE]"]);
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
});
