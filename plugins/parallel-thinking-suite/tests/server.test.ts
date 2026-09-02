import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const pluginRoot = join(import.meta.dirname, "..");
let child: ChildProcess;
let origin: string;
let home: string;
let projectA: string;
let projectB: string;
let childOutput = "";

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法分配测试端口");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`测试服务提前退出：${childOutput}`);
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(250) });
      if (response.ok) return;
    } catch {
      // Continue within the bounded startup window.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`测试服务启动超时：${childOutput}`);
}

beforeAll(async () => {
  const port = await availablePort();
  origin = `http://127.0.0.1:${port}`;
  home = mkdtempSync(join(tmpdir(), "parallel-thinking-server-home-"));
  projectA = mkdtempSync(join(tmpdir(), "parallel-thinking-server-project-a-"));
  projectB = mkdtempSync(join(tmpdir(), "parallel-thinking-server-project-b-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PARALLEL_THINK_PORT: String(port),
    PARALLEL_THINK_HOME: home,
    PARALLEL_THINK_DISABLE_KEYCHAIN: "1",
  };
  for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY", "OPENROUTER_API_KEY"]) delete env[key];
  child = spawn(process.execPath, ["--import", "tsx", "src/server/server.ts"], {
    cwd: pluginRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => { childOutput += String(chunk); });
  child.stderr?.on("data", (chunk) => { childOutput += String(chunk); });
  await waitForServer();
});

afterAll(async () => {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
  ]);
});

describe("local HTTP service", () => {
  it("reports health without initializing project history in the global home", async () => {
    const response = await fetch(`${origin}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, service: "parallel-thinking-suite", home });
    expect(existsSync(join(home, "runs"))).toBe(false);
  });

  it("exposes provider metadata with every real credential source disabled", async () => {
    const response = await fetch(`${origin}/api/providers`);
    expect(response.status).toBe(200);
    const providers = await response.json() as Array<{ id: string; configured: boolean; credentialSource?: string }>;
    expect(providers.map((provider) => provider.id)).toEqual(["openai", "anthropic", "deepseek", "openrouter"]);
    expect(providers.every((provider) => provider.configured === false)).toBe(true);
    expect(providers.every((provider) => provider.credentialSource === undefined)).toBe(true);
  });

  it("exposes the independent flagship Model catalog without making model requests", async () => {
    const response = await fetch(`${origin}/api/models`);
    expect(response.status).toBe(200);
    const models = await response.json() as Array<{ id: string; provider: string; model: string }>;
    expect(models).toEqual([
      expect.objectContaining({ id: "openai-flagship", provider: "openai", model: "gpt-5.6-sol" }),
      expect.objectContaining({ id: "anthropic-flagship", provider: "anthropic", model: "claude-fable-5-1" }),
      expect.objectContaining({ id: "deepseek-flagship", provider: "deepseek", model: "deepseek-v4-pro" }),
      expect.objectContaining({ id: "openrouter-auto", provider: "openrouter", model: "openrouter/auto" }),
    ]);
  });

  it("starts with no Agent presets and isolates run lists by project root", async () => {
    const agents = await fetch(`${origin}/api/agents`);
    expect(agents.status).toBe(200);
    expect(await agents.json()).toEqual([]);

    for (const project of [projectA, projectB]) {
      const response = await fetch(`${origin}/api/runs?projectRoot=${encodeURIComponent(project)}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([]);
      expect(existsSync(join(project, ".parallel-think", "runs"))).toBe(true);
    }
  });

  it("rejects a native run with no configured Agents without calling a Provider", async () => {
    const response = await fetch(`${origin}/api/runs/native`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "test",
        projectRoot: projectA,
        selection: { mode: "auto" },
        execution: { mode: "host-native", host: "codex" },
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "REQUEST_FAILED" } });
  });

  it("returns structured errors for malformed JSON and unknown API routes", async () => {
    const malformed = await fetch(`${origin}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: "REQUEST_FAILED" } });

    const missing = await fetch(`${origin}/api/not-found`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: { code: "NOT_FOUND", message: "接口不存在" } });
  });
});
