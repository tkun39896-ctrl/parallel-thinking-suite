import { copyFileSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { beforeAll, describe, expect, it } from "vitest";
import { AgentDefinitionRepository, selectAgents } from "../src/server/agents.js";
import { ensureGlobalHome, pluginRoot } from "../src/server/config.js";

let home: string;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "parallel-thinking-agents-"));
  process.env.PARALLEL_THINK_HOME = home;
  ensureGlobalHome();
});

function seedExampleAgents(): void {
  const source = join(pluginRoot, "templates", "global", "agents");
  for (const file of readdirSync(source)) copyFileSync(join(source, file), join(home, "agents", file));
}

describe("Harness Agent canonical repository", () => {
  it("starts with an empty Agent directory", () => {
    const repository = new AgentDefinitionRepository(join(home, "agents"));
    expect(repository.listAgents()).toEqual([]);
  });

  it("loads canonical examples when they are explicitly seeded", () => {
    seedExampleAgents();
    const repository = new AgentDefinitionRepository(join(home, "agents"));
    const agents = repository.listAgents();
    expect(agents).toHaveLength(4);
    expect(agents.every((agent) => agent.valid)).toBe(true);
    expect(agents.find((agent) => agent.id === "product-strategist")?.extension.provider).toBe("openrouter");
    expect(agents.find((agent) => agent.id === "product-strategist")?.model).toMatchObject({ name: "openai/gpt-5-mini" });
    expect(agents.find((agent) => agent.id === "product-strategist")?.model.temperature).toBeUndefined();
    expect(agents.find((agent) => agent.id === "technology-architect")?.extension.provider).toBe("openrouter");
    expect(agents.find((agent) => agent.id === "technology-architect")?.model.name).toBe("deepseek/deepseek-v4-pro-0813");
    expect(repository.buildProductionSnapshot("technology-architect").definition.activeProfile).toBe("analysis");
  });

  it("round-trips nested sidecar YAML and preserves profile/model fields", () => {
    seedExampleAgents();
    const repository = new AgentDefinitionRepository(join(home, "agents"));
    const original = repository.getAgent("technology-architect");
    const saved = repository.saveAgent({
      ...original,
      extension: {
        ...original.extension,
        selection: {
          ...original.extension.selection,
          tags: ["技术", "深层 YAML", "API"],
        },
        knowledge: {
          ...original.extension.knowledge,
          privatePaths: ["knowledge/technology", "knowledge/nested/research"],
        },
      },
    });
    expect(saved.valid).toBe(true);
    expect(saved.extension.selection.tags).toContain("深层 YAML");
    expect(saved.extension.avatar).toEqual({ kind: "provider", provider: "openrouter" });
    const sidecar = parseYaml(readFileSync(join(home, "agents", "technology-architect.agent.ext.yaml"), "utf8"));
    expect(sidecar.parallelThinking.knowledge.privatePaths).toEqual([
      "knowledge/technology",
      "knowledge/nested/research",
    ]);
    const markdown = readFileSync(join(home, "agents", "technology-architect.agent.md"), "utf8");
    expect(markdown).toContain('version: 1.0.0');
    expect(markdown).toContain("deepseek/deepseek-v4-pro-0813");
    expect(markdown).toContain("maxTokens: 2600");
  });

  it("marks an invalid extension inactive instead of silently accepting it", () => {
    seedExampleAgents();
    const repository = new AgentDefinitionRepository(join(home, "agents"));
    writeFileSync(join(home, "agents", "broken.agent.md"), "---\nname: broken\ndescription: broken agent\n---\nPrompt\n");
    writeFileSync(join(home, "agents", "broken.agent.ext.yaml"), "parallelThinking:\n  provider: unknown\n");
    const broken = repository.listAgents().find((agent) => agent.id === "broken");
    expect(broken?.valid).toBe(false);
    expect(broken?.issues.some((issue) => issue.code === "E_PT_PROVIDER")).toBe(true);
  });

  it("round-trips an OpenRouter provider with an independent model slug", () => {
    seedExampleAgents();
    const repository = new AgentDefinitionRepository(join(home, "agents"));
    const original = repository.getAgent("critical-reviewer");
    const saved = repository.saveAgent({
      ...original,
      model: { ...original.model, name: "anthropic/claude-sonnet-test" },
      extension: { ...original.extension, provider: "openrouter" },
    });
    expect(saved.valid).toBe(true);
    expect(saved.extension.provider).toBe("openrouter");
    expect(saved.model.name).toBe("anthropic/claude-sonnet-test");
    expect(readFileSync(join(home, "agents", "critical-reviewer.agent.ext.yaml"), "utf8")).toContain("provider: openrouter");

    const synthesizer = repository.getAgent("synthesis-lead");
    const savedSynthesizer = repository.saveAgent({
      ...synthesizer,
      model: { ...synthesizer.model, name: "openai/gpt-test" },
      extension: { ...synthesizer.extension, provider: "openrouter" },
    });
    expect(savedSynthesizer.valid).toBe(true);
    expect(savedSynthesizer.extension.role).toBe("synthesizer");
    expect(savedSynthesizer.extension.provider).toBe("openrouter");
    expect(savedSynthesizer.model.name).toBe("openai/gpt-test");
  });

  it("normalizes the new-Agent default profile into a valid named profile", () => {
    const repository = new AgentDefinitionRepository(join(home, "agents"));
    const saved = repository.saveAgent({
      id: "new-agent",
      description: "new",
      systemPrompt: "Answer independently.",
      model: { name: "openrouter/auto" },
      profile: "default",
      extension: {
        displayName: "New Agent",
        enabled: true,
        provider: "openrouter",
        modelId: "openrouter-auto",
        avatar: { kind: "provider", provider: "openrouter" },
        role: "worker",
        selection: { includeInParallel: false, tags: [], intents: [], negativeHints: [], priority: 50 },
        knowledge: { sharedMode: "auto", sharedCollections: [], privatePaths: [] },
        context: { defaultMode: "summary" },
        limits: { firstTokenTimeoutMs: 30_000, totalTimeoutMs: 180_000 },
      },
      valid: true,
      issues: [],
    });
    expect(saved.valid).toBe(true);
    expect(saved.profile).toBe("standard");
  });
});

describe("Agent selection", () => {
  it("supports all, explicit, and automatic intent matching", () => {
    seedExampleAgents();
    const repository = new AgentDefinitionRepository(join(home, "agents"));
    const agents = repository.listAgents();
    expect(selectAgents(agents, "任意问题", "all").map((agent) => agent.id).sort()).toEqual([
      "critical-reviewer",
      "product-strategist",
      "technology-architect",
    ]);
    expect(selectAgents(agents, "技术问题", "explicit", ["critical-reviewer"]).map((agent) => agent.id)).toEqual(["critical-reviewer"]);
    const automatic = selectAgents(agents, "请做系统架构和 API 技术方案", "auto");
    expect(automatic.map((agent) => agent.id)).toEqual(["technology-architect"]);
    expect(selectAgents(agents, "请评估产品需求与技术架构", "auto").map((agent) => agent.id).sort()).toEqual([
      "product-strategist",
      "technology-architect",
    ]);
    expect(selectAgents(agents, "一个没有命中标签的开放问题", "auto")).toHaveLength(3);
    expect(automatic.every((agent) => agent.extension.role === "worker")).toBe(true);
  });
});
