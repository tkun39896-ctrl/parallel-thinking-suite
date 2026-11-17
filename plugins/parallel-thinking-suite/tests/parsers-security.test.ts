import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ensureProject } from "../src/server/config.js";
import { collectFiles, ParserRegistry } from "../src/server/parsers.js";
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


it("redacts structured api_key fields without corrupting JSON", () => {
  expect(redactSecrets({ api_key: "abcdefghijklmnopqrstuv", nested: ["api_key=abcdefghijklmnopqrstuv"] })).toEqual({ api_key: "[REDACTED_KEY]", nested: ["api-key=[REDACTED_KEY]"] });
});

it("keeps the requested source path when identical files share a parse cache", async () => {
  const registry = new ParserRegistry(join(home, "parsers"));
  const first = join(project, "first.md"), second = join(project, "second.md");
  writeFileSync(first, "identical"); writeFileSync(second, "identical");
  await registry.parse(first, ensureProject(project));
  const result = await registry.parse(second, ensureProject(project));
  expect(result?.cached).toBe(true);
  expect(result?.sourcePath).toBe(second);
});

it("selects numeric semantic versions rather than lexical order", async () => {
  for (const [id, version] of [["older", "1.9.0"], ["newer", "1.10.0"]]) {
    const root = join(home, "parsers", id!, version!); mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "manifest.yaml"), `id: ${id}\nversion: ${version}\nextensions: [.txt]\nentry: index.mjs\n`);
    writeFileSync(join(root, "index.mjs"), `console.log(JSON.stringify({text: ${JSON.stringify(version)}}));`);
  }
  const registry = new ParserRegistry(join(home, "parsers"));
  await registry.canaryAndActivate("older", "1.9.0", []);
  await registry.canaryAndActivate("newer", "1.10.0", []);
  expect(registry.activeFor("sample.txt")?.id).toBe("newer");
});


it("does not follow directory symlinks outside knowledge roots or into cycles", () => {
  const root = join(project, "knowledge"); mkdirSync(root);
  writeFileSync(join(root, "allowed.md"), "allowed");
  const outside = join(project, "outside"); mkdirSync(outside);
  writeFileSync(join(outside, "private.md"), "outside configured roots");
  symlinkSync(outside, join(root, "linked")); symlinkSync(root, join(root, "cycle"));
  expect(collectFiles([root])).toEqual([join(root, "allowed.md")]);
});
