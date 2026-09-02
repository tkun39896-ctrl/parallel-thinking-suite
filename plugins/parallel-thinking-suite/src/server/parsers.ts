import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { extname, join } from "node:path";
import mammoth from "mammoth";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import readExcelFile from "read-excel-file/node";
import { parse as parseYaml } from "yaml";
import type { ParsedDocument, ParserRecord } from "../shared/types.js";
import { assertInside, ensureGlobalHome, type ProjectPaths } from "./config.js";

interface ParserManifest {
  id: string;
  version: string;
  extensions: string[];
  entry: string;
}

interface ParserRuntimeRecord extends ParserRecord {
  entry?: string;
  root?: string;
}

const builtinDefinitions: Array<Pick<ParserRecord, "id" | "version" | "extensions">> = [
  { id: "plain-text", version: "1.0.0", extensions: [".txt", ".md", ".markdown", ".ts", ".tsx", ".js", ".jsx", ".css", ".py", ".java", ".go", ".rs", ".sql", ".xml", ".yaml", ".yml"] },
  { id: "json", version: "1.0.0", extensions: [".json"] },
  { id: "csv", version: "1.0.0", extensions: [".csv", ".tsv"] },
  { id: "html", version: "1.0.0", extensions: [".html", ".htm"] },
  { id: "pdf", version: "1.0.0", extensions: [".pdf"] },
  { id: "docx", version: "1.0.0", extensions: [".docx"] },
  { id: "xlsx", version: "1.0.0", extensions: [".xlsx"] },
];

function freshBuiltin(definition: Pick<ParserRecord, "id" | "version" | "extensions">): ParserRuntimeRecord {
  return {
    ...definition,
    kind: "builtin",
    status: "active",
    successCount: 0,
    failureCount: 0,
    cacheHits: 0,
    totalDurationMs: 0,
    extractedCharacters: 0,
    consecutiveHardFailures: 0,
  };
}

export class ParserRegistry {
  readonly root: string;
  readonly registryPath: string;
  private records = new Map<string, ParserRuntimeRecord>();

  constructor(root = join(ensureGlobalHome(), "parsers")) {
    this.root = root;
    this.registryPath = join(root, "registry.json");
    mkdirSync(root, { recursive: true });
    this.load();
    this.discover();
  }

  list(): ParserRecord[] {
    return [...this.records.values()]
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id) || b.version.localeCompare(a.version))
      .map(({ entry: _entry, root: _root, ...record }) => record);
  }

  discover(): void {
    const known = new Map(this.records);
    for (const definition of builtinDefinitions) {
      const key = this.key(definition.id, definition.version);
      this.records.set(key, { ...freshBuiltin(definition), ...known.get(key), status: "active", kind: "builtin" });
    }
    for (const idEntry of readdirSync(this.root, { withFileTypes: true })) {
      if (!idEntry.isDirectory()) continue;
      const idRoot = join(this.root, idEntry.name);
      for (const versionEntry of readdirSync(idRoot, { withFileTypes: true })) {
        if (!versionEntry.isDirectory()) continue;
        const versionRoot = join(idRoot, versionEntry.name);
        const manifestPath = join(versionRoot, "manifest.yaml");
        if (!existsSync(manifestPath)) continue;
        try {
          const manifest = this.readManifest(manifestPath);
          const key = this.key(manifest.id, manifest.version);
          const previous = known.get(key);
          this.records.set(key, {
            id: manifest.id,
            version: manifest.version,
            kind: "extension",
            extensions: manifest.extensions.map(normalizeExtension),
            status: previous?.status || "discovered",
            previousStableVersion: previous?.previousStableVersion,
            successCount: previous?.successCount || 0,
            failureCount: previous?.failureCount || 0,
            cacheHits: previous?.cacheHits || 0,
            totalDurationMs: previous?.totalDurationMs || 0,
            extractedCharacters: previous?.extractedCharacters || 0,
            consecutiveHardFailures: previous?.consecutiveHardFailures || 0,
            lastUsedAt: previous?.lastUsedAt,
            lastError: previous?.lastError,
            entry: assertInside(versionRoot, join(versionRoot, manifest.entry)),
            root: versionRoot,
          });
        } catch (error) {
          const key = this.key(idEntry.name, versionEntry.name);
          this.records.set(key, {
            id: idEntry.name,
            version: versionEntry.name,
            kind: "extension",
            extensions: [],
            status: "failed",
            successCount: 0,
            failureCount: 1,
            cacheHits: 0,
            totalDurationMs: 0,
            extractedCharacters: 0,
            consecutiveHardFailures: 1,
            lastError: error instanceof Error ? error.message : String(error),
            root: versionRoot,
          });
        }
      }
    }
    this.persist();
  }

  async validate(id: string, version: string): Promise<ParserRecord> {
    const record = this.required(id, version);
    if (record.kind === "builtin") return record;
    record.status = "validating";
    record.lastError = undefined;
    this.persist();
    try {
      if (!record.entry || !record.root || !existsSync(record.entry)) throw new Error("解析器入口文件不存在");
      if (!record.entry.endsWith(".mjs") && !record.entry.endsWith(".js")) throw new Error("解析器入口必须是 .js 或 .mjs");
      const runtimeRoot = realpathSync(record.root);
      const runtimeEntry = assertInside(runtimeRoot, realpathSync(record.entry));
      await this.checkSyntax(runtimeEntry);
      record.status = "discovered";
      record.consecutiveHardFailures = 0;
    } catch (error) {
      record.status = "failed";
      record.failureCount += 1;
      record.lastError = error instanceof Error ? error.message : String(error);
    }
    this.persist();
    return this.publicRecord(record);
  }

  async canaryAndActivate(id: string, version: string, candidateFiles: string[]): Promise<ParserRecord> {
    const record = this.required(id, version);
    if (record.kind === "builtin") return record;
    const validated = await this.validate(id, version);
    if (validated.status === "failed") return validated;
    record.status = "canary";
    this.persist();
    const eligible = candidateFiles.filter((file) => record.extensions.includes(normalizeExtension(extname(file)))).slice(0, 5);
    try {
      for (const file of eligible) {
        const baseline = await parseBuiltin(file);
        const candidate = await this.runExtension(record, file);
        if (!candidate.trim() && baseline?.text.trim()) {
          throw new Error(`灰度失败：${file} 的旧解析器有内容，新解析器返回空内容`);
        }
      }
      const previous = [...this.records.values()]
        .filter((item) => item.id === id && item.kind === "extension" && item.status === "active" && item.version !== version)
        .sort((a, b) => b.version.localeCompare(a.version))[0];
      if (previous) {
        previous.status = "deprecated";
        record.previousStableVersion = previous.version;
      }
      record.status = "active";
      record.lastError = undefined;
      record.consecutiveHardFailures = 0;
    } catch (error) {
      record.status = "rolled_back";
      record.failureCount += 1;
      record.lastError = error instanceof Error ? error.message : String(error);
    }
    this.persist();
    return this.publicRecord(record);
  }

  setStatus(id: string, version: string, status: "deprecated" | "disabled"): ParserRecord {
    const record = this.required(id, version);
    if (record.kind === "builtin") throw new Error("内置解析器不能停用");
    record.status = status;
    this.persist();
    return this.publicRecord(record);
  }

  activeFor(filePath: string): ParserRuntimeRecord | undefined {
    const extension = normalizeExtension(extname(filePath));
    const extensionParser = [...this.records.values()]
      .filter((record) => record.kind === "extension" && record.status === "active" && record.extensions.includes(extension))
      .sort((a, b) => b.version.localeCompare(a.version))[0];
    if (extensionParser) return extensionParser;
    return [...this.records.values()].find((record) =>
      record.kind === "builtin" && record.status === "active" && record.extensions.includes(extension)
    );
  }

  async parse(filePath: string, paths: ProjectPaths): Promise<ParsedDocument | undefined> {
    const parser = this.activeFor(filePath);
    if (!parser) return undefined;
    const bytes = readFileSync(filePath);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const cachePath = join(paths.cache, `${hash}-${parser.id}-${parser.version}.json`);
    if (existsSync(cachePath)) {
      parser.cacheHits += 1;
      parser.lastUsedAt = new Date().toISOString();
      this.persist();
      return { ...(JSON.parse(readFileSync(cachePath, "utf8")) as ParsedDocument), cached: true };
    }
    const started = Date.now();
    try {
      const result = parser.kind === "builtin"
        ? await parseBuiltin(filePath)
        : { text: await this.runExtension(parser, filePath), metadata: {} };
      if (!result) return undefined;
      const parsed: ParsedDocument = {
        sourcePath: filePath,
        parserId: parser.id,
        parserVersion: parser.version,
        text: result.text,
        metadata: result.metadata,
        hash,
        cached: false,
      };
      writeFileSync(cachePath, JSON.stringify(parsed), "utf8");
      parser.successCount += 1;
      parser.consecutiveHardFailures = 0;
      parser.extractedCharacters += parsed.text.length;
      return parsed;
    } catch (error) {
      parser.failureCount += 1;
      parser.consecutiveHardFailures += 1;
      parser.lastError = error instanceof Error ? error.message : String(error);
      if (parser.kind === "extension" && parser.consecutiveHardFailures >= 3) {
        parser.status = "rolled_back";
        const previous = parser.previousStableVersion
          ? this.records.get(this.key(parser.id, parser.previousStableVersion))
          : undefined;
        if (previous) previous.status = "active";
      }
      throw error;
    } finally {
      parser.totalDurationMs += Date.now() - started;
      parser.lastUsedAt = new Date().toISOString();
      this.persist();
    }
  }

  private async runExtension(record: ParserRuntimeRecord, filePath: string): Promise<string> {
    if (!record.entry || !record.root) throw new Error("解析器入口未配置");
    const runtimeRoot = realpathSync(record.root);
    const runtimeEntry = assertInside(runtimeRoot, realpathSync(record.entry));
    const runtimeFile = realpathSync(filePath);
    const args = [
      "--permission",
      `--allow-fs-read=${runtimeRoot}`,
      `--allow-fs-read=${runtimeFile}`,
      runtimeEntry,
      runtimeFile,
    ];
    const output = await new Promise<string>((resolveOutput, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: runtimeRoot,
        env: {
          PATH: process.env.PATH || "",
          SystemRoot: process.env.SystemRoot || "",
          TEMP: process.env.TEMP || "",
          TMP: process.env.TMP || "",
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => child.kill(), 15_000);
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error(`扩展解析器退出码 ${code}：${stderr.slice(0, 500)}`));
        else resolveOutput(stdout);
      });
    });
    let value: unknown;
    try {
      value = JSON.parse(output);
    } catch {
      throw new Error("扩展解析器必须向 stdout 输出 JSON");
    }
    if (!value || typeof value !== "object" || typeof (value as { text?: unknown }).text !== "string") {
      throw new Error("扩展解析器输出必须包含 text 字符串");
    }
    return (value as { text: string }).text;
  }

  private checkSyntax(entry: string): Promise<void> {
    return new Promise((resolveCheck, reject) => {
      const child = spawn(process.execPath, ["--check", entry], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolveCheck() : reject(new Error(stderr || "解析器语法检查失败")));
    });
  }

  private readManifest(path: string): ParserManifest {
    const value = parseYaml(readFileSync(path, "utf8")) as Partial<ParserManifest>;
    if (!value || !/^[a-z0-9-]+$/.test(value.id || "")) throw new Error("manifest.id 必须是 kebab-case");
    if (!/^\d+\.\d+\.\d+$/.test(value.version || "")) throw new Error("manifest.version 必须是 semver");
    if (!Array.isArray(value.extensions) || value.extensions.length === 0) throw new Error("manifest.extensions 不能为空");
    if (typeof value.entry !== "string" || !value.entry) throw new Error("manifest.entry 不能为空");
    return value as ParserManifest;
  }

  private required(id: string, version: string): ParserRuntimeRecord {
    const record = this.records.get(this.key(id, version));
    if (!record) throw new Error(`解析器不存在：${id}@${version}`);
    return record;
  }

  private key(id: string, version: string): string {
    return `${id}@${version}`;
  }

  private publicRecord(record: ParserRuntimeRecord): ParserRecord {
    const { entry: _entry, root: _root, ...value } = record;
    return value;
  }

  private load(): void {
    if (!existsSync(this.registryPath)) return;
    try {
      const values = JSON.parse(readFileSync(this.registryPath, "utf8")) as ParserRuntimeRecord[];
      for (const value of values) this.records.set(this.key(value.id, value.version), value);
    } catch {
      this.records.clear();
    }
  }

  private persist(): void {
    writeFileSync(this.registryPath, JSON.stringify([...this.records.values()], null, 2), "utf8");
  }
}

function normalizeExtension(extension: string): string {
  const lower = extension.toLowerCase();
  return lower.startsWith(".") ? lower : `.${lower}`;
}

async function parseBuiltin(filePath: string): Promise<{ text: string; metadata: Record<string, unknown> } | undefined> {
  const extension = normalizeExtension(extname(filePath));
  if ([".txt", ".md", ".markdown", ".ts", ".tsx", ".js", ".jsx", ".css", ".py", ".java", ".go", ".rs", ".sql", ".xml", ".yaml", ".yml", ".csv", ".tsv"].includes(extension)) {
    return { text: readFileSync(filePath, "utf8"), metadata: {} };
  }
  if (extension === ".json") {
    const value = JSON.parse(readFileSync(filePath, "utf8"));
    return { text: JSON.stringify(value, null, 2), metadata: { kind: Array.isArray(value) ? "array" : typeof value } };
  }
  if (extension === ".html" || extension === ".htm") {
    const html = readFileSync(filePath, "utf8");
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
    return { text, metadata: {} };
  }
  if (extension === ".pdf") {
    const result = await pdfParse(readFileSync(filePath));
    return { text: result.text, metadata: { pages: result.numpages, info: result.info } };
  }
  if (extension === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return { text: result.value, metadata: { messages: result.messages.length } };
  }
  if (extension === ".xlsx") {
    const sheets = await readExcelFile(filePath);
    const sheetNames = sheets.map((sheet) => sheet.sheet);
    const sections = sheets.map((sheet) => {
      const rows = sheet.data.map((row) => row.map(excelCellText).map(csvCell).join(","));
      return `# ${sheet.sheet}\n${rows.join("\n")}`;
    });
    return { text: sections.join("\n\n"), metadata: { sheets: sheetNames } };
  }
  return undefined;
}

function excelCellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return String(value);
  if ("result" in value && value.result !== undefined) return excelCellText(value.result);
  if ("text" in value && typeof value.text === "string") return value.text;
  if ("richText" in value && Array.isArray(value.richText)) {
    return value.richText.map((part: { text?: unknown }) => String(part.text || "")).join("");
  }
  return JSON.stringify(value);
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function collectFiles(roots: string[], limit = 500): string[] {
  const output: string[] = [];
  const ignored = new Set([".git", "node_modules", ".parallel-think"]);
  const visit = (path: string) => {
    if (output.length >= limit || !existsSync(path)) return;
    const stats = statSync(path);
    if (stats.isFile()) {
      output.push(path);
      return;
    }
    if (!stats.isDirectory()) return;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      visit(join(path, entry.name));
      if (output.length >= limit) break;
    }
  };
  for (const root of roots) visit(root);
  return output;
}
