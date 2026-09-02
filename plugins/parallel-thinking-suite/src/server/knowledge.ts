import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentSummary } from "../shared/types.js";
import { assertInside, ensureGlobalHome, type ProjectPaths } from "./config.js";
import { collectFiles, ParserRegistry } from "./parsers.js";

export interface KnowledgeFileStatus {
  path: string;
  supported: boolean;
  parserId?: string;
  characters?: number;
  cached?: boolean;
  error?: string;
}

export async function buildKnowledgePackage(
  agent: AgentSummary,
  paths: ProjectPaths,
  registry: ParserRegistry,
  limits = { maxFiles: 24, maxCharacters: 50_000 },
): Promise<{ text: string; files: KnowledgeFileStatus[] }> {
  const home = ensureGlobalHome();
  const roots: string[] = [];
  const knowledge = agent.extension.knowledge;
  if (knowledge.sharedMode !== "off") {
    const shared = join(home, "knowledge", "shared");
    if (knowledge.sharedCollections.length === 0) roots.push(shared);
    for (const collection of knowledge.sharedCollections) {
      const candidate = assertInside(shared, join(shared, collection));
      if (existsSync(candidate)) roots.push(candidate);
    }
  }
  for (const privatePath of knowledge.privatePaths) {
    const candidate = assertInside(home, resolve(home, privatePath));
    mkdirSync(candidate, { recursive: true });
    roots.push(candidate);
  }

  const statuses: KnowledgeFileStatus[] = [];
  const sections: string[] = [];
  let characters = 0;
  for (const file of collectFiles(roots, limits.maxFiles)) {
    try {
      const parsed = await registry.parse(file, paths);
      if (!parsed) {
        statuses.push({ path: file, supported: false });
        continue;
      }
      const remaining = limits.maxCharacters - characters;
      if (remaining <= 0) break;
      const text = parsed.text.slice(0, remaining);
      characters += text.length;
      sections.push(`## 来源：${file}\n${text}`);
      statuses.push({
        path: file,
        supported: true,
        parserId: parsed.parserId,
        characters: text.length,
        cached: parsed.cached,
      });
    } catch (error) {
      statuses.push({ path: file, supported: true, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { text: sections.join("\n\n"), files: statuses };
}

export async function inspectKnowledge(
  agents: AgentSummary[],
  paths: ProjectPaths,
  registry: ParserRegistry,
): Promise<Array<{ agentId: string; files: KnowledgeFileStatus[] }>> {
  const output = [];
  for (const agent of agents) {
    const result = await buildKnowledgePackage(agent, paths, registry, { maxFiles: 100, maxCharacters: 100_000 });
    output.push({ agentId: agent.id, files: result.files });
  }
  return output;
}
