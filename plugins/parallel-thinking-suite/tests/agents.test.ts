import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { beforeAll, describe, expect, it } from "vitest";
import { AgentDefinitionRepository, selectAgents } from "../src/server/agents.js";
import { ensureGlobalHome } from "../src/server/config.js";

let home: string;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "parallel-thinking-agents-"));
  process.env.PARALLEL_THINK_HOME = home;
  ensureGlobalHome();
});

describe("Harness Agent canonical repository", () => {
  it("loads the four canonical .agent.md definitions with extensions", () => {
    const repository = new AgentDefinitionRepository(join(home, "agents"));
    const agents = repository.listAgents();
    expect(agents).toHaveLength(4);
    expect(agents.every((agent) => agent.valid)).toBe(true);
    expect(agents.find((agent) => agent.id === "technology-architect")?.extension.provider).toBe("deepseek");
    expect(repository.buildProductionSnapshot("technology-architect").definition.activeProfile).toBe("analysis");
  });

  it("round-trips nested sidecar YAML and preserves profile/model fields", () => {
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
    const sidecar = parseYaml(readFileSync(join(home, "agents", "technology-architect.agent.ext.yaml"), "utf8"));
    expect(sidecar.parallelThinking.knowledge.privatePaths).toEqual([
      "knowledge/technology",
      "knowledge/nested/research",
    ]);
    const markdown = readFileSync(join(home, "agents", "technology-architect.agent.md"), "utf8");
    expect(markdown).toContain('version: 1.0.0');
    expect(markdown).toContain("maxTokens: 2600");
  });

  it("marks an invalid extension inactive instead of silently accepting it", () => {
    const repository = new AgentDefinitionRepository(join(home, "agents"));
    writeFileSync(join(home, "agents", "broken.agent.md"), "---\nname: broken\ndescription: broken agent\n---\nPrompt\n");
    writeFileSync(join(home, "agents", "broken.agent.ext.yaml"), "parallelThinking:\n  provider: unknown\n");
    const broken = repository.listAgents().find((agent) => agent.id === "broken");
    expect(broken?.valid).toBe(false);
    expect(broken?.issues.some((issue) => issue.code === "E_PT_PROVIDER")).toBe(true);
  });
});

describe("Agent selection", () => {
  it("supports all, explicit, and automatic intent matching", () => {
    const repository = new AgentDefinitionRepository(join(home, "agents"));
    const agents = repository.listAgents();
    expect(selectAgents(agents, "任意问题", "all").map((agent) => agent.id).sort()).toEqual([
      "critical-reviewer",
      "product-strategist",
      "technology-architect",
    ]);
    expect(selectAgents(agents, "技术问题", "explicit", ["critical-reviewer"]).map((agent) => agent.id)).toEqual(["critical-reviewer"]);
    const automatic = selectAgents(agents, "请做系统架构和 API 技术方案", "auto");
    expect(automatic[0]?.id).toBe("technology-architect");
    expect(automatic.every((agent) => agent.extension.role === "worker")).toBe(true);
  });
});
