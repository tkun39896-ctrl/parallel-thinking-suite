import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pluginRoot = join(import.meta.dirname, "..");

describe("CLI project routing", () => {
  it.each(["run", "plan-native"])("%s sends its caller project to a previously running local service", async command => {
    const project = mkdtempSync(join(tmpdir(), "parallel-thinking-cli-project-"));
    const home = mkdtempSync(join(tmpdir(), "parallel-thinking-cli-home-"));
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    const server = createServer(async (request, response) => {
      let raw = "";
      for await (const chunk of request) raw += String(chunk);
      response.setHeader("content-type", "application/json");
      if (request.url === "/api/health") { response.end(JSON.stringify({ ok: true, service: "parallel-thinking-suite" })); return; }
      const body = JSON.parse(raw);
      requests.push({ path: request.url!, body });
      const manifest = { id: "synthetic", projectRoot: body.projectRoot, selectedAgents: [], agents: {} };
      response.end(JSON.stringify(command === "plan-native" ? { manifest, tasks: [] } : manifest));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");
    const env = { ...process.env, PARALLEL_THINK_HOME: home, PARALLEL_THINK_PORT: String(address.port), PARALLEL_THINK_DISABLE_KEYCHAIN: "1" };
    for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY", "OPENROUTER_API_KEY"]) delete (env as NodeJS.ProcessEnv)[key];
    try {
      const result = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
        const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), join(pluginRoot, "src/server/cli.ts"), command, "--stdin"], { cwd: project, env, stdio: ["pipe", "ignore", "pipe"] });
        let stderr = "";
        child.stderr.on("data", chunk => { stderr += String(chunk); });
        child.on("error", reject);
        child.on("exit", code => resolve({ code, stderr }));
        child.stdin.end(JSON.stringify({ query: "synthetic", execution: { host: "codex" } }));
      });
      expect(result, result.stderr).toMatchObject({ code: 0 });
      expect(requests).toHaveLength(1);
      expect(requests[0]!.body.projectRoot).toBe(realpathSync(project));
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
