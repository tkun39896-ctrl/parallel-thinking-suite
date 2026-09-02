import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ensureGlobalHome } from "../src/server/config.js";
import { ModelCatalogRepository } from "../src/server/models.js";

describe("Model catalog", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "parallel-thinking-models-"));
    process.env.PARALLEL_THINK_HOME = home;
    ensureGlobalHome();
  });

  it("loads one independently addressable Model per supported provider", () => {
    const models = new ModelCatalogRepository().listModels();
    expect(models.map((model) => model.id)).toEqual([
      "openai-flagship",
      "anthropic-flagship",
      "deepseek-flagship",
      "openrouter-auto",
    ]);
    expect(new Set(models.map((model) => model.provider)).size).toBe(4);
    expect(models.every((model) => model.sourceUrl.startsWith("https://"))).toBe(true);
  });

  it("rejects duplicate Model IDs", () => {
    const path = join(home, "models.yaml");
    writeFileSync(path, `models:\n  - id: duplicate\n    displayName: One\n    provider: openai\n    model: gpt-test\n    description: test\n    verifiedAt: "2026-09-02"\n    sourceUrl: https://example.com/model\n  - id: duplicate\n    displayName: Two\n    provider: anthropic\n    model: claude-test\n    description: test\n    verifiedAt: "2026-09-02"\n    sourceUrl: https://example.com/model\n`, "utf8");
    expect(() => new ModelCatalogRepository(path).listModels()).toThrow("重复的 Model ID");
  });
});
