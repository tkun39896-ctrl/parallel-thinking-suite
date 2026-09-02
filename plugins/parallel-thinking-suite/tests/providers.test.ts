import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSummary, ProviderId } from "../src/shared/types.js";
import { streamAgent } from "../src/server/providers.js";

function agent(provider: ProviderId): AgentSummary {
  return {
    id: `${provider}-agent`,
    description: "test",
    systemPrompt: "Test prompt",
    model: { name: provider === "deepseek" ? "deepseek-chat" : "test-model", maxTokens: 20 },
    extension: {
      displayName: provider,
      enabled: true,
      provider,
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

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
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
