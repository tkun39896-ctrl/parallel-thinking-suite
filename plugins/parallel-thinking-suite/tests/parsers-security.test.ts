import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ensureProject } from "../src/server/config.js";
import { ParserRegistry } from "../src/server/parsers.js";
import { redactSecrets, RunStore } from "../src/server/run-store.js";

let home: string;
let project: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "parallel-thinking-parsers-"));
  project = mkdtempSync(join(tmpdir(), "parallel-thinking-project-"));
  process.env.PARALLEL_THINK_HOME = home;
});

describe("parser registry lifecycle", () => {
  it("parses and caches built-in text files", async () => {
    const paths = ensureProject(project);
    const registry = new ParserRegistry(join(home, "parsers"));
    const file = join(project, "note.md");
    writeFileSync(file, "# 测试\n内容", "utf8");
    const first = await registry.parse(file, paths);
    const second = await registry.parse(file, paths);
    expect(first?.text).toContain("内容");
    expect(first?.cached).toBe(false);
    expect(second?.cached).toBe(true);
    expect(registry.list().find((parser) => parser.id === "plain-text")?.cacheHits).toBe(1);
  });

  it("extracts workbook sheets with the audited XLSX parser", async () => {
    const paths = ensureProject(project);
    const registry = new ParserRegistry(join(home, "parsers"));
    const file = join(project, "sample.xlsx");
    const fixture = readFileSync(join(import.meta.dirname, "fixtures", "sample.xlsx.base64"), "utf8");
    writeFileSync(file, Buffer.from(fixture.trim(), "base64"));
    const parsed = await registry.parse(file, paths);
    expect(parsed?.parserId).toBe("xlsx");
    expect(parsed?.text).toContain("# 决策表");
    expect(parsed?.text).toContain("方案,评分");
    expect(parsed?.text).toContain("A,9");
  });

  it("validates and canary-activates a local parser without inheriting API keys", async () => {
    process.env.OPENAI_API_KEY = "sk-secret-must-not-reach-child";
    process.env.OPENROUTER_API_KEY = "openrouter-secret-must-not-reach-child";
    const parserRoot = join(home, "parsers", "uppercase", "1.0.0");
    mkdirSync(parserRoot, { recursive: true });
    writeFileSync(join(parserRoot, "manifest.yaml"), "id: uppercase\nversion: 1.0.0\nextensions: [.txt]\nentry: index.mjs\n", "utf8");
    writeFileSync(join(parserRoot, "index.mjs"), [
      'import { readFileSync } from "node:fs";',
      'if (process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY) throw new Error("secret inherited");',
      'const text = readFileSync(process.argv[2], "utf8").toUpperCase();',
      'process.stdout.write(JSON.stringify({ text }));',
    ].join("\n"), "utf8");
    const file = join(project, "sample.txt");
    writeFileSync(file, "hello", "utf8");
    const registry = new ParserRegistry(join(home, "parsers"));
    const active = await registry.canaryAndActivate("uppercase", "1.0.0", [file]);
    expect(active.status, active.lastError).toBe("active");
    const parsed = await registry.parse(file, ensureProject(project));
    expect(parsed?.text).toBe("HELLO");
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
  });
});

describe("run archive secret redaction", () => {
  it("redacts configured keys and key-like strings before persistence", () => {
    process.env.OPENAI_API_KEY = "sk-test-secret-123456789012345";
    process.env.OPENROUTER_API_KEY = "openrouter-test-secret-123456789";
    const paths = ensureProject(project);
    const store = new RunStore(paths);
    const now = new Date().toISOString();
    store.create({
      id: "test-run",
      query: "test",
      contextMode: "summary",
      selectionMode: "auto",
      selectedAgents: [],
      projectRoot: project,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      agents: {},
    }, { query: `keys are ${process.env.OPENAI_API_KEY} and ${process.env.OPENROUTER_API_KEY}` });
    const archive = readFileSync(join(paths.runs, "test-run", "request.json"), "utf8");
    expect(archive).not.toContain("sk-test-secret");
    expect(archive).not.toContain("openrouter-test-secret");
    expect(archive).toContain("[REDACTED]");
    expect(redactSecrets({ token: "sk-another-secret-12345678" }).token).toContain("[REDACTED");
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
  });
});
