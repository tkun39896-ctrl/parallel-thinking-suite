import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentRunResult, RunManifest, RunRequest } from "../src/shared/types.js";
import { assertInside, ensureGlobalHome, ensureProject, globalHome } from "../src/server/config.js";
import { RunStore } from "../src/server/run-store.js";

let home: string;
let projectA: string;
let projectB: string;

function manifest(id: string, projectRoot: string, createdAt: string): RunManifest {
  return {
    id,
    query: `query for ${id}`,
    contextMode: "prompt-only",
    selectionMode: "explicit",
    executionMode: "host-native",
    executionHost: "codex",
    selectedAgents: ["reviewer"],
    projectRoot,
    status: "completed",
    createdAt,
    updatedAt: createdAt,
    agents: {},
  };
}

function request(query: string, projectRoot: string): RunRequest {
  return {
    query,
    projectRoot,
    selection: { mode: "explicit", agentIds: ["reviewer"] },
    execution: { mode: "host-native", host: "codex" },
  };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "parallel-thinking-global-"));
  projectA = mkdtempSync(join(tmpdir(), "parallel-thinking-project-a-"));
  projectB = mkdtempSync(join(tmpdir(), "parallel-thinking-project-b-"));
  process.env.PARALLEL_THINK_HOME = home;
  process.env.PARALLEL_THINK_DISABLE_KEYCHAIN = "1";
});

afterEach(() => {
  delete process.env.PARALLEL_THINK_HOME;
  delete process.env.PARALLEL_THINK_DISABLE_KEYCHAIN;
});

describe("configuration storage boundaries", () => {
  it("keeps global configuration separate from project run archives", () => {
    const global = ensureGlobalHome();
    const first = ensureProject(projectA);
    const second = ensureProject(projectB);

    expect(globalHome()).toBe(resolve(home));
    expect(global).toBe(resolve(home));
    expect(readdirSync(join(global, "agents"))).toEqual([]);
    expect(existsSync(join(global, "providers.yaml"))).toBe(true);
    expect(existsSync(join(global, "models.yaml"))).toBe(true);
    expect(existsSync(join(global, "knowledge", "shared"))).toBe(true);
    expect(existsSync(join(global, "runs"))).toBe(false);

    expect(first.state).toBe(join(resolve(projectA), ".parallel-think"));
    expect(second.state).toBe(join(resolve(projectB), ".parallel-think"));
    expect(first.runs).not.toBe(second.runs);
    expect(existsSync(first.config)).toBe(true);
    expect(existsSync(second.config)).toBe(true);
  });

  it("rejects paths outside an allowed root", () => {
    expect(assertInside(projectA, join(projectA, "nested", "file.txt"))).toBe(join(projectA, "nested", "file.txt"));
    expect(() => assertInside(projectA, join(projectA, "..", "outside.txt"))).toThrow("路径越界");
  });
});

describe("project-local run archives", () => {
  it("lists and resolves runs only inside the selected project", () => {
    const first = new RunStore(ensureProject(projectA));
    const second = new RunStore(ensureProject(projectB));
    first.create(manifest("run-a-old", projectA, "2026-01-01T00:00:00.000Z"), request("old", projectA));
    first.create(manifest("run-a-new", projectA, "2026-01-02T00:00:00.000Z"), request("new", projectA));
    second.create(manifest("run-b", projectB, "2026-01-03T00:00:00.000Z"), request("other", projectB));

    expect(first.list().map((run) => run.id)).toEqual(["run-a-new", "run-a-old"]);
    expect(second.list().map((run) => run.id)).toEqual(["run-b"]);
    expect(first.resolveRunId("latest")).toBe("run-a-new");
    expect(second.resolveRunId("latest")).toBe("run-b");
    expect(() => first.get("run-b")).toThrow();
  });

  it("persists public Agent results and events without mixing archive files", () => {
    const paths = ensureProject(projectA);
    const store = new RunStore(paths);
    const run = manifest("run-complete", projectA, "2026-01-01T00:00:00.000Z");
    store.create(run, request("test", projectA));
    const result: AgentRunResult = {
      agentId: "reviewer",
      displayName: "Reviewer",
      provider: "openrouter",
      model: "openrouter/auto",
      executor: "host-native",
      status: "completed",
      task: "review",
      output: "public result",
    };
    run.agents.reviewer = result;
    store.writeAgent(run.id, result);
    store.writeManifest(run);
    store.appendEvent({
      runId: run.id,
      sequence: 1,
      type: "agent_completed",
      at: "2026-01-01T00:00:01.000Z",
      agentId: "reviewer",
    });

    const runRoot = join(paths.runs, run.id);
    expect(JSON.parse(readFileSync(join(runRoot, "request.json"), "utf8"))).toMatchObject({ query: "test", projectRoot: projectA });
    expect(JSON.parse(readFileSync(join(runRoot, "agents", "reviewer.json"), "utf8"))).toMatchObject({ output: "public result" });
    expect(readFileSync(join(runRoot, "events.jsonl"), "utf8")).toContain("agent_completed");
    expect(store.aggregationContext(run.id).agents).toEqual([
      expect.objectContaining({ agentId: "reviewer", output: "public result", executor: "host-native" }),
    ]);
  });

  it("rejects unsafe run identifiers and an empty latest lookup", () => {
    const store = new RunStore(ensureProject(projectA));
    expect(() => store.resolveRunId("latest")).toThrow("还没有并行思考运行");
    expect(() => store.get("../escape")).toThrow("无效的运行编号");
  });
});
