import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { stringify } from "yaml";
import {
  loadAgent,
  loadAgentFromDisk,
  validateRichAgent,
  type ModelConfig,
  type RichAgentDocument,
  type ValidationIssue,
} from "subagent-harness";
import type { AgentDraft, AgentExtension, AgentSummary, ProviderId } from "../shared/types.js";
import { ensureGlobalHome } from "./config.js";

const providers = new Set<ProviderId>(["openai", "anthropic", "deepseek"]);
const contextModes = new Set(["summary", "prompt-only", "full"]);

function defaultExtension(id: string): AgentExtension {
  return {
    displayName: id,
    enabled: true,
    provider: "openai",
    role: "worker",
    selection: {
      includeInParallel: true,
      tags: [],
      intents: [],
      negativeHints: [],
      priority: 50,
    },
    knowledge: {
      sharedMode: "auto",
      sharedCollections: [],
      privatePaths: [],
    },
    context: { defaultMode: "summary" },
    limits: {
      firstTokenTimeoutMs: 30_000,
      totalTimeoutMs: 180_000,
    },
  };
}

function arrayOfStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function validateParallelThinkingExtension(
  extensions: Record<string, unknown>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const value = extensions.parallelThinking;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [{
      code: "E_PT_EXTENSION",
      message: "parallelThinking extension is required",
      level: "error",
      path: "parallelThinking",
    }];
  }
  const ext = value as Record<string, unknown>;
  if (typeof ext.displayName !== "string" || !ext.displayName.trim()) {
    issues.push({ code: "E_PT_DISPLAY_NAME", message: "displayName is required", level: "error", path: "parallelThinking.displayName" });
  }
  if (!providers.has(ext.provider as ProviderId)) {
    issues.push({ code: "E_PT_PROVIDER", message: "provider must be openai, anthropic, or deepseek", level: "error", path: "parallelThinking.provider" });
  }
  if (ext.role !== "worker" && ext.role !== "synthesizer") {
    issues.push({ code: "E_PT_ROLE", message: "role must be worker or synthesizer", level: "error", path: "parallelThinking.role" });
  }
  const selection = ext.selection as Record<string, unknown> | undefined;
  for (const key of ["tags", "intents", "negativeHints"]) {
    if (!selection || !arrayOfStrings(selection[key])) {
      issues.push({ code: "E_PT_SELECTION", message: `${key} must be a string array`, level: "error", path: `parallelThinking.selection.${key}` });
    }
  }
  const context = ext.context as Record<string, unknown> | undefined;
  if (!context || !contextModes.has(String(context.defaultMode))) {
    issues.push({ code: "E_PT_CONTEXT", message: "defaultMode is invalid", level: "error", path: "parallelThinking.context.defaultMode" });
  }
  const limits = ext.limits as Record<string, unknown> | undefined;
  if (!limits || !Number.isInteger(limits.firstTokenTimeoutMs) || !Number.isInteger(limits.totalTimeoutMs)) {
    issues.push({ code: "E_PT_LIMITS", message: "timeouts must be integer milliseconds", level: "error", path: "parallelThinking.limits" });
  }
  return issues;
}

function normalizeExtension(doc: RichAgentDocument): AgentExtension {
  const raw = doc.extensions.parallelThinking as Partial<AgentExtension> | undefined;
  const base = defaultExtension(doc.frontmatter.name);
  return {
    ...base,
    ...raw,
    selection: { ...base.selection, ...raw?.selection },
    knowledge: { ...base.knowledge, ...raw?.knowledge },
    context: { ...base.context, ...raw?.context },
    limits: { ...base.limits, ...raw?.limits },
  };
}

function summaryFromDocument(doc: RichAgentDocument): AgentSummary {
  const result = validateRichAgent(doc, { extensionValidator: validateParallelThinkingExtension });
  const profile = doc.frontmatter.profiles?.default;
  const loaded = loadAgent(doc, profile);
  const model = loaded.model === "inherited" ? { name: "inherited" } : loaded.model;
  return {
    id: loaded.name,
    description: loaded.description,
    version: loaded.version,
    systemPrompt: loaded.prompt,
    model,
    profile,
    extension: normalizeExtension(doc),
    valid: result.ok,
    issues: result.issues,
  };
}

export class AgentDefinitionRepository {
  readonly root: string;
  readonly revisionsRoot: string;

  constructor(root = join(ensureGlobalHome(), "agents")) {
    this.root = root;
    this.revisionsRoot = join(ensureGlobalHome(), "revisions", "agents");
    mkdirSync(this.root, { recursive: true });
    mkdirSync(this.revisionsRoot, { recursive: true });
  }

  listAgents(): AgentSummary[] {
    return readdirSync(this.root)
      .filter((name) => name.endsWith(".agent.md"))
      .sort()
      .map((name) => {
        try {
          return summaryFromDocument(loadAgentFromDisk(join(this.root, name)));
        } catch (error) {
          const id = name.replace(/\.agent\.md$/, "");
          return {
            id,
            description: "",
            systemPrompt: "",
            model: { name: "inherited" },
            extension: defaultExtension(id),
            valid: false,
            issues: [{ code: "E_PARSE", message: error instanceof Error ? error.message : String(error), level: "error" }],
          };
        }
      });
  }

  getAgent(id: string): AgentSummary {
    const safeId = this.validateId(id);
    const path = join(this.root, `${safeId}.agent.md`);
    if (!existsSync(path)) throw new Error(`Agent 不存在：${safeId}`);
    return summaryFromDocument(loadAgentFromDisk(path));
  }

  buildProductionSnapshot(id: string, profile?: string) {
    const safeId = this.validateId(id);
    const doc = loadAgentFromDisk(join(this.root, `${safeId}.agent.md`));
    const chosen = profile || doc.frontmatter.profiles?.default;
    const summary = summaryFromDocument(doc);
    if (!summary.valid) throw new Error(`Agent 配置无效：${summary.issues.map((item) => item.message).join("；")}`);
    return { definition: loadAgent(doc, chosen), summary };
  }

  saveAgent(draft: AgentDraft): AgentSummary {
    const id = this.validateId(draft.id);
    const model: ModelConfig = {
      name: draft.model.name,
      ...(draft.model.temperature === undefined ? {} : { temperature: draft.model.temperature }),
      ...(draft.model.maxTokens === undefined ? {} : { maxTokens: draft.model.maxTokens }),
    };
    const frontmatter: Record<string, unknown> = {
      schemaVersion: "1",
      version: draft.version || "1.0.0",
      name: id,
      description: draft.description,
      model,
      profiles: {
        default: draft.profile || "default",
        [draft.profile || "default"]: { skills: [] },
      },
    };
    const md = `---\n${stringify(frontmatter).trim()}\n---\n\n${draft.systemPrompt.trim()}\n`;
    const ext = stringify({ parallelThinking: draft.extension });
    const finalMd = join(this.root, `${id}.agent.md`);
    const finalExt = join(this.root, `${id}.agent.ext.yaml`);
    const tempId = `.${id}.${process.pid}.${Date.now()}`;
    const tempMd = join(this.root, `${tempId}.agent.md`);
    const tempExt = join(this.root, `${tempId}.agent.ext.yaml`);
    writeFileSync(tempMd, md, "utf8");
    writeFileSync(tempExt, ext, "utf8");
    try {
      const parsed = loadAgentFromDisk(tempMd);
      const validation = validateRichAgent(parsed, { extensionValidator: validateParallelThinkingExtension });
      if (!validation.ok) {
        throw new Error(validation.issues.map((item) => item.message).join("；"));
      }
      this.archiveCurrent(id, finalMd, finalExt);
      const oldMd = finalMd + ".replace";
      const oldExt = finalExt + ".replace";
      if (existsSync(finalMd)) renameSync(finalMd, oldMd);
      if (existsSync(finalExt)) renameSync(finalExt, oldExt);
      try {
        renameSync(tempMd, finalMd);
        renameSync(tempExt, finalExt);
        rmSync(oldMd, { force: true });
        rmSync(oldExt, { force: true });
      } catch (error) {
        if (existsSync(oldMd) && !existsSync(finalMd)) renameSync(oldMd, finalMd);
        if (existsSync(oldExt) && !existsSync(finalExt)) renameSync(oldExt, finalExt);
        throw error;
      }
    } finally {
      rmSync(tempMd, { force: true });
      rmSync(tempExt, { force: true });
    }
    return this.getAgent(id);
  }

  restoreAgentRevision(id: string, revision: string): AgentSummary {
    const safeId = this.validateId(id);
    if (!/^[0-9T.-]+$/.test(revision)) throw new Error("无效的版本标识");
    const dir = join(this.revisionsRoot, safeId, revision);
    const md = join(dir, `${safeId}.agent.md`);
    const ext = join(dir, `${safeId}.agent.ext.yaml`);
    if (!existsSync(md) || !existsSync(ext)) throw new Error("Agent 历史版本不存在");
    const current = this.getAgent(safeId);
    const restored = summaryFromDocument(loadAgentFromDisk(md));
    return this.saveAgent({ ...current, ...restored, id: safeId });
  }

  private archiveCurrent(id: string, md: string, ext: string): void {
    if (!existsSync(md)) return;
    const stamp = new Date().toISOString().replace(/[:]/g, "-");
    const dir = join(this.revisionsRoot, id, stamp);
    mkdirSync(dir, { recursive: true });
    copyFileSync(md, join(dir, basename(md)));
    if (existsSync(ext)) copyFileSync(ext, join(dir, basename(ext)));
  }

  private validateId(id: string): string {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error("Agent ID 必须是小写 kebab-case");
    return id;
  }
}

export function selectAgents(
  agents: AgentSummary[],
  query: string,
  mode: "auto" | "all" | "explicit",
  explicitIds: string[] = [],
): AgentSummary[] {
  const eligible = agents.filter((agent) =>
    agent.valid &&
    agent.extension.enabled &&
    agent.extension.role === "worker" &&
    agent.extension.selection.includeInParallel
  );
  if (mode === "all") return eligible;
  if (mode === "explicit") {
    const wanted = new Set(explicitIds);
    return eligible.filter((agent) => wanted.has(agent.id));
  }
  const lower = query.toLowerCase();
  const scored = eligible.map((agent) => {
    const selection = agent.extension.selection;
    const positive = [...selection.tags, ...selection.intents]
      .reduce((score, keyword) => score + (lower.includes(keyword.toLowerCase()) ? 20 : 0), 0);
    const negative = selection.negativeHints
      .reduce((score, keyword) => score + (lower.includes(keyword.toLowerCase()) ? 30 : 0), 0);
    return { agent, score: selection.priority + positive - negative };
  }).sort((a, b) => b.score - a.score);
  const selected = scored.filter((item) => item.score >= 50).slice(0, 6).map((item) => item.agent);
  return selected.length > 0 ? selected : eligible.slice(0, 3);
}
