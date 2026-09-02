import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { ModelDefinition, ProviderId } from "../shared/types.js";
import { ensureGlobalHome } from "./config.js";

const providers = new Set<ProviderId>(["openai", "anthropic", "deepseek", "openrouter"]);

interface ModelsFile {
  models?: unknown;
}

function modelDefinition(value: unknown, index: number): ModelDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`models.yaml 第 ${index + 1} 项必须是对象`);
  }
  const model = value as Record<string, unknown>;
  const id = String(model.id || "").trim();
  const displayName = String(model.displayName || "").trim();
  const provider = String(model.provider || "") as ProviderId;
  const modelName = String(model.model || "").trim();
  const description = String(model.description || "").trim();
  const verifiedAt = String(model.verifiedAt || "").trim();
  const sourceUrl = String(model.sourceUrl || "").trim();
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`无效的 Model ID：${id || "(空)"}`);
  if (!displayName) throw new Error(`Model ${id} 缺少 displayName`);
  if (!providers.has(provider)) throw new Error(`Model ${id} 的 Provider 无效`);
  if (!modelName) throw new Error(`Model ${id} 缺少模型名称`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(verifiedAt)) throw new Error(`Model ${id} 的 verifiedAt 必须是 YYYY-MM-DD`);
  if (!/^https:\/\//.test(sourceUrl)) throw new Error(`Model ${id} 的 sourceUrl 必须是 HTTPS 地址`);
  return { id, displayName, provider, model: modelName, description, verifiedAt, sourceUrl };
}

export class ModelCatalogRepository {
  readonly path: string;

  constructor(path = join(ensureGlobalHome(), "models.yaml")) {
    this.path = path;
  }

  listModels(): ModelDefinition[] {
    const parsed = parseYaml(readFileSync(this.path, "utf8")) as ModelsFile | undefined;
    if (!parsed || !Array.isArray(parsed.models)) throw new Error("models.yaml 必须包含 models 数组");
    const models = parsed.models.map(modelDefinition);
    const ids = new Set<string>();
    for (const model of models) {
      if (ids.has(model.id)) throw new Error(`重复的 Model ID：${model.id}`);
      ids.add(model.id);
    }
    return models;
  }

  getModel(id: string): ModelDefinition {
    const model = this.listModels().find((item) => item.id === id);
    if (!model) throw new Error(`Model 不存在：${id}`);
    return model;
  }
}
