import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSummary, ProviderId } from "../src/shared/types.js";
import { providerStatuses, streamAgent, testProvider } from "../src/server/providers.js";

function agent(provider: ProviderId): AgentSummary {
  return {
    id: `${provider}-agent`,
    description: "test",
    systemPrompt: "Test prompt",
    model: { name: provider === "deepseek" ? "deepseek-chat" : provider === "openrouter" ? "anthropic/claude-test" : "test-model", maxTokens: 20 },
    extension: {
      displayName: provider,
      enabled: true,
      provider,
      avatar: { kind: "provider", provider },
      role: "worker",
      selection: { includeInParallel: true, tags: [], intents: [], negativeHints: [], priority: 50 },
      knowledge: { sharedMode: "off", sharedCollections: [], privatePaths: [] },
      context: { defaultMode: "summary" },
      limits: { firstTokenTimeoutMs: 1000, totalTimeoutMs: 3000 },
    },
    valid: true,
    issues: [],
  };
}

function sse(blocks: Array<{ event?: string; data: unknown }>): Response {
  const encoder = new TextEncoder();
  const content = blocks.map((block) =>
    `${block.event ? `event: ${block.event}\n` : ""}data: ${typeof block.data === "string" ? block.data : JSON.stringify(block.data)}\n\n`
  ).join("");
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(content));
      controller.close();
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
}

function chunkedSse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
}

beforeEach(() => {
  process.env.PARALLEL_THINK_DISABLE_KEYCHAIN = "1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_MODEL;
  delete process.env.OPENROUTER_BASE_URL;
  delete process.env.OPENROUTER_HTTP_REFERER;
  delete process.env.OPENROUTER_APP_TITLE;
  delete process.env.PARALLEL_THINK_DISABLE_KEYCHAIN;
});

describe("provider streaming adapters", () => {
  it("normalizes OpenAI Responses API deltas and usage", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key-00000000";
    vi.stubGlobal("fetch", vi.fn(async () => sse([
      { data: { type: "response.output_text.delta", delta: "Open" } },
      { data: { type: "response.output_text.delta", delta: "AI" } },
      { data: { type: "response.completed", response: { usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 } } } },
    ])));
    let output = "";
    let usage = {};
    await streamAgent({ agent: agent("openai"), task: "test", contextPackage: "", signal: new AbortController().signal, onDelta: (value) => { output += value; }, onUsage: (value) => { usage = value; } });
    expect(output).toBe("OpenAI");
    expect(usage).toMatchObject({ totalTokens: 5 });
  });

  it("normalizes Anthropic message events", async () => {
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key-000000";
    vi.stubGlobal("fetch", vi.fn(async () => sse([
      { event: "message_start", data: { type: "message_start", message: { usage: { input_tokens: 4 } } } },
      { event: "content_block_delta", data: { type: "content_block_delta", delta: { text: "Claude" } } },
      { event: "message_delta", data: { type: "message_delta", usage: { output_tokens: 1 } } },
    ])));
    let output = "";
    await streamAgent({ agent: agent("anthropic"), task: "test", contextPackage: "", signal: new AbortController().signal, onDelta: (value) => { output += value; }, onUsage: () => undefined });
    expect(output).toBe("Claude");
  });

  it("normalizes DeepSeek chat completion events", async () => {
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key-000000";
    vi.stubGlobal("fetch", vi.fn(async () => sse([
      { data: { choices: [{ delta: { content: "Deep" } }] } },
      { data: { choices: [{ delta: { content: "Seek" } }], usage: { total_tokens: 6 } } },
      { data: "[DONE]" },
    ])));
    let output = "";
    await streamAgent({ agent: agent("deepseek"), task: "test", contextPackage: "", signal: new AbortController().signal, onDelta: (value) => { output += value; }, onUsage: () => undefined });
    expect(output).toBe("DeepSeek");
  });

  it("uses the native OpenRouter URL, bearer header, per-Agent model slug, deltas, and usage", async () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key-000000";
    process.env.OPENROUTER_BASE_URL = "https://router.example/api/v1/";
    process.env.OPENROUTER_MODEL = "openrouter/default-model";
    process.env.OPENROUTER_HTTP_REFERER = "https://parallel-thinking.example";
    process.env.OPENROUTER_APP_TITLE = "Parallel Thinking Suite";
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => chunkedSse([
      ": OPENROUTER PROCESSING\r",
      "\n\r\n",
      `data: ${JSON.stringify({ model: "anthropic/claude-sonnet-4.5", choices: [{ delta: { content: "Open" } }] })}\r`,
      "\n\r\n",
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Router" } }] })}\r\n\r\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "" }, finish_reason: "stop" }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } })}\r\n\r\n`,
      "data: [DONE]\r\n\r\n",
    ]));
    vi.stubGlobal("fetch", fetchMock);
    let output = "";
    let usage = {};
    let resolvedModel = "";
    await streamAgent({ agent: agent("openrouter"), task: "test", contextPackage: "", signal: new AbortController().signal, onDelta: (value) => { output += value; }, onModel: (value) => { resolvedModel = value; }, onUsage: (value) => { usage = value; } });
    expect(output).toBe("OpenRouter");
    expect(resolvedModel).toBe("anthropic/claude-sonnet-4.5");
    expect(usage).toEqual({ inputTokens: 4, outputTokens: 2, totalTokens: 6 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://router.example/api/v1/chat/completions");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer test-openrouter-key-000000");
    expect(headers.get("HTTP-Referer")).toBe("https://parallel-thinking.example");
    expect(headers.get("X-OpenRouter-Title")).toBe("Parallel Thinking Suite");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "anthropic/claude-test",
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it("does not call OpenRouter when its API key is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(streamAgent({ agent: agent("openrouter"), task: "test", contextPackage: "", signal: new AbortController().signal, onDelta: () => undefined, onUsage: () => undefined }))
      .rejects.toThrow("OPENROUTER_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([429, 502])("retries an OpenRouter HTTP %i response once before text", async (status) => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key-000000";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: status, message: "temporary" } }), { status }))
      .mockResolvedValueOnce(sse([{ data: { choices: [{ delta: { content: "recovered" } }] } }, { data: "[DONE]" }]));
    vi.stubGlobal("fetch", fetchMock);
    let output = "";
    await streamAgent({ agent: agent("openrouter"), task: "test", contextPackage: "", signal: new AbortController().signal, onDelta: (value) => { output += value; }, onUsage: () => undefined });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(output).toBe("recovered");
  });

  it("preserves partial OpenRouter text and does not retry a mid-stream error", async () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key-000000";
    const fetchMock = vi.fn(async () => sse([
      { data: { choices: [{ delta: { content: "partial" } }] } },
      { data: { error: { code: 429, message: "rate limited" } } },
    ]));
    vi.stubGlobal("fetch", fetchMock);
    let output = "";
    await expect(streamAgent({ agent: agent("openrouter"), task: "test", contextPackage: "", signal: new AbortController().signal, onDelta: (value) => { output += value; }, onUsage: () => undefined }))
      .rejects.toThrow("429");
    expect(output).toBe("partial");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("publishes only OpenRouter configuration metadata and redacts echoed keys from connection errors", async () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key-000000";
    process.env.OPENROUTER_MODEL = "google/gemini-test";
    const status = providerStatuses().find((item) => item.id === "openrouter");
    expect(status).toEqual({
      id: "openrouter",
      label: "OpenRouter",
      configured: true,
      credentialSource: "environment",
      envKey: "OPENROUTER_API_KEY",
      model: "google/gemini-test",
      baseUrl: "https://openrouter.ai/api/v1",
    });
    expect(JSON.stringify(status)).not.toContain("test-openrouter-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`bad key ${process.env.OPENROUTER_API_KEY}`, { status: 401 })));
    const result = await testProvider("openrouter");
    expect(result.ok).toBe(false);
    expect(result.message).not.toContain("test-openrouter-key");
    expect(result.message).toContain("[REDACTED]");
  });

  it("retries a transient failure only before text is emitted", async () => {
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key-000000";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(sse([{ data: { choices: [{ delta: { content: "ok" } }] } }, { data: "[DONE]" }]));
    vi.stubGlobal("fetch", fetchMock);
    let output = "";
    await streamAgent({ agent: agent("deepseek"), task: "test", contextPackage: "", signal: new AbortController().signal, onDelta: (value) => { output += value; }, onUsage: () => undefined });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(output).toBe("ok");
  });
});
