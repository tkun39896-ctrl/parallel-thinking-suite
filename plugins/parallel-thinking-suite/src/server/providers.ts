import type { AgentSummary, ProviderId, ProviderStatus } from "../shared/types.js";
import { redactSecrets } from "./run-store.js";
import { providerCredential } from "./secrets.js";

interface ProviderDefinition {
  id: ProviderId;
  label: string;
  keyEnv: string;
  modelEnv: string;
  defaultModel: string;
  baseUrlEnv: string;
  defaultBaseUrl: string;
}

const providerDefinitions: Record<ProviderId, ProviderDefinition> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    keyEnv: "OPENAI_API_KEY",
    modelEnv: "OPENAI_MODEL",
    defaultModel: "gpt-5.6-sol",
    baseUrlEnv: "OPENAI_BASE_URL",
    defaultBaseUrl: "https://api.openai.com",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    keyEnv: "ANTHROPIC_API_KEY",
    modelEnv: "ANTHROPIC_MODEL",
    defaultModel: "claude-fable-5-1",
    baseUrlEnv: "ANTHROPIC_BASE_URL",
    defaultBaseUrl: "https://api.anthropic.com",
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    keyEnv: "DEEPSEEK_API_KEY",
    modelEnv: "DEEPSEEK_MODEL",
    defaultModel: "deepseek-v4-pro",
    baseUrlEnv: "DEEPSEEK_BASE_URL",
    defaultBaseUrl: "https://api.deepseek.com",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    keyEnv: "OPENROUTER_API_KEY",
    modelEnv: "OPENROUTER_MODEL",
    defaultModel: "openrouter/auto",
    baseUrlEnv: "OPENROUTER_BASE_URL",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
  },
};

function definition(id: ProviderId): ProviderDefinition {
  return providerDefinitions[id];
}

function apiKey(id: ProviderId): string {
  return providerCredential(id).value;
}

function baseUrl(id: ProviderId): string {
  const config = definition(id);
  return (process.env[config.baseUrlEnv]?.trim() || config.defaultBaseUrl).replace(/\/+$/, "");
}

function endpoint(id: ProviderId, path: string): string {
  return `${baseUrl(id)}/${path.replace(/^\/+/, "")}`;
}

function openRouterHeaders(): Record<string, string> {
  const referer = process.env.OPENROUTER_HTTP_REFERER?.trim();
  const title = process.env.OPENROUTER_APP_TITLE?.trim();
  return {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey("openrouter")}`,
    ...(referer ? { "HTTP-Referer": referer } : {}),
    ...(title ? { "X-OpenRouter-Title": title } : {}),
  };
}

export function providerStatuses(): ProviderStatus[] {
  return Object.values(providerDefinitions).map((config) => {
    const credential = providerCredential(config.id);
    return {
      id: config.id,
      label: config.label,
      configured: Boolean(credential.value),
      credentialSource: credential.source,
      envKey: config.keyEnv,
      model: process.env[config.modelEnv]?.trim() || config.defaultModel,
      baseUrl: baseUrl(config.id),
    };
  });
}

export class ProviderError extends Error {
  readonly transient: boolean;
  readonly status?: number;

  constructor(message: string, options: { transient?: boolean; status?: number; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ProviderError";
    this.transient = Boolean(options.transient);
    this.status = options.status;
  }
}

interface StreamAgentOptions {
  agent: AgentSummary;
  task: string;
  contextPackage: string;
  signal: AbortSignal;
  onDelta: (delta: string) => void;
  onModel?: (model: string) => void;
  onUsage: (usage: Record<string, number>) => void;
}

function promptParts(options: StreamAgentOptions): { system: string; user: string } {
  const system = [
    "你是“并行思考”中的一个独立 Agent。请独立作答，不假装知道其他 Agent 的答案。",
    "明确区分事实、推断和不确定性。只输出可公开的最终答案，不输出隐藏思维链。",
    options.agent.systemPrompt,
  ].join("\n\n");
  const user = [
    `任务：${options.task}`,
    options.contextPackage ? `\n上下文与知识资料：\n${options.contextPackage}` : "",
  ].join("\n");
  return { system, user };
}

function modelFor(agent: AgentSummary): string {
  if (agent.model.name && agent.model.name !== "inherited") return agent.model.name;
  const config = definition(agent.extension.provider);
  return process.env[config.modelEnv]?.trim() || config.defaultModel;
}

async function parseSse(
  body: ReadableStream<Uint8Array> | null,
  onEvent: (eventName: string | undefined, data: string) => void,
): Promise<void> {
  if (!body) throw new ProviderError("上游没有返回可读取的数据流");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const dispatch = (block: string) => {
    let eventName: string | undefined;
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (data.length > 0) onEvent(eventName, data.join("\n"));
  };
  const drain = () => {
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      dispatch(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");
    drain();
  }
  buffer += decoder.decode();
  buffer = buffer.replace(/\r\n/g, "\n");
  drain();
  if (buffer.trim()) dispatch(buffer);
}

function transientStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

async function checkedFetch(url: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ProviderError("无法连接模型厂商 API", { transient: true, cause: error });
  }
  if (!response.ok) {
    const requestId = response.headers.get("request-id") || response.headers.get("x-request-id") || response.headers.get("x-generation-id");
    const detail = redactSecrets((await response.text()).slice(0, 600));
    throw new ProviderError(
      `模型厂商返回 HTTP ${response.status}${requestId ? `（request-id: ${requestId}）` : ""}：${detail || response.statusText}`,
      { transient: transientStatus(response.status), status: response.status },
    );
  }
  return response;
}

async function streamOpenAI(options: StreamAgentOptions, signal: AbortSignal): Promise<void> {
  const { system, user } = promptParts(options);
  const body: Record<string, unknown> = {
    model: modelFor(options.agent),
    stream: true,
    input: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_output_tokens: options.agent.model.maxTokens || 2600,
  };
  const response = await checkedFetch(endpoint("openai", "v1/responses"), {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey("openai")}`,
    },
    body: JSON.stringify(body),
  });
  await parseSse(response.body, (_event, data) => {
    if (data === "[DONE]") return;
    const value = JSON.parse(data) as Record<string, any>;
    if (value.type === "response.output_text.delta" && typeof value.delta === "string") {
      options.onDelta(value.delta);
    }
    if (value.type === "response.completed" && value.response?.usage) {
      options.onUsage({
        inputTokens: Number(value.response.usage.input_tokens || 0),
        outputTokens: Number(value.response.usage.output_tokens || 0),
        totalTokens: Number(value.response.usage.total_tokens || 0),
      });
    }
    if (value.type === "response.failed") {
      throw new ProviderError(String(value.response?.error?.message || "OpenAI 生成失败"));
    }
  });
}

async function streamAnthropic(options: StreamAgentOptions, signal: AbortSignal): Promise<void> {
  const { system, user } = promptParts(options);
  const response = await checkedFetch(endpoint("anthropic", "v1/messages"), {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey("anthropic"),
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelFor(options.agent),
      stream: true,
      system,
      messages: [{ role: "user", content: user }],
      max_tokens: options.agent.model.maxTokens || 2600,
      temperature: options.agent.model.temperature,
    }),
  });
  await parseSse(response.body, (eventName, data) => {
    const value = JSON.parse(data) as Record<string, any>;
    if ((eventName === "content_block_delta" || value.type === "content_block_delta") && typeof value.delta?.text === "string") {
      options.onDelta(value.delta.text);
    }
    if (value.type === "message_start" && value.message?.usage) {
      options.onUsage({ inputTokens: Number(value.message.usage.input_tokens || 0) });
    }
    if (value.type === "message_delta" && value.usage) {
      options.onUsage({ outputTokens: Number(value.usage.output_tokens || 0) });
    }
    if (value.type === "error") throw new ProviderError(String(value.error?.message || "Anthropic 生成失败"));
  });
}

async function streamDeepSeek(options: StreamAgentOptions, signal: AbortSignal): Promise<void> {
  const { system, user } = promptParts(options);
  const response = await checkedFetch(endpoint("deepseek", "chat/completions"), {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey("deepseek")}`,
    },
    body: JSON.stringify({
      model: modelFor(options.agent),
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: options.agent.model.maxTokens || 2600,
      temperature: options.agent.model.temperature,
    }),
  });
  await parseSse(response.body, (_event, data) => {
    if (data === "[DONE]") return;
    const value = JSON.parse(data) as Record<string, any>;
    const delta = value.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta) options.onDelta(delta);
    if (value.usage) {
      options.onUsage({
        inputTokens: Number(value.usage.prompt_tokens || 0),
        outputTokens: Number(value.usage.completion_tokens || 0),
        totalTokens: Number(value.usage.total_tokens || 0),
      });
    }
  });
}

async function streamOpenRouter(options: StreamAgentOptions, signal: AbortSignal): Promise<void> {
  const { system, user } = promptParts(options);
  let observedModel: string | undefined;
  const response = await checkedFetch(endpoint("openrouter", "chat/completions"), {
    method: "POST",
    signal,
    headers: openRouterHeaders(),
    body: JSON.stringify({
      model: modelFor(options.agent),
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: options.agent.model.maxTokens || 2600,
      temperature: options.agent.model.temperature,
    }),
  });
  await parseSse(response.body, (_event, data) => {
    if (data === "[DONE]") return;
    const value = JSON.parse(data) as Record<string, any>;
    if (value.error) {
      const status = Number(value.error.code);
      throw new ProviderError(
        `OpenRouter 生成失败${Number.isFinite(status) ? `（${status}）` : ""}：${redactSecrets(String(value.error.message || "未知错误"))}`,
        { status: Number.isFinite(status) ? status : undefined, transient: Number.isFinite(status) && transientStatus(status) },
      );
    }
    if (typeof value.model === "string" && value.model && value.model !== observedModel) {
      observedModel = value.model;
      options.onModel?.(value.model);
    }
    const delta = value.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta) options.onDelta(delta);
    if (value.usage) {
      options.onUsage({
        inputTokens: Number(value.usage.prompt_tokens || 0),
        outputTokens: Number(value.usage.completion_tokens || 0),
        totalTokens: Number(value.usage.total_tokens || 0),
      });
    }
  });
}

export async function streamAgent(options: StreamAgentOptions): Promise<void> {
  const provider = options.agent.extension.provider;
  if (!apiKey(provider)) {
    throw new ProviderError(`${definition(provider).label} 未配置。请在服务端环境变量 ${definition(provider).keyEnv} 中设置 API Key。`);
  }
  let emittedText = false;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const signal = AbortSignal.any([options.signal, controller.signal]);
    const firstTokenMs = options.agent.extension.limits.firstTokenTimeoutMs;
    const totalMs = options.agent.extension.limits.totalTimeoutMs;
    const firstTimer = setTimeout(() => controller.abort(new Error("等待首个响应超时")), firstTokenMs);
    const totalTimer = setTimeout(() => controller.abort(new Error("模型总响应超时")), totalMs);
    const wrapped: StreamAgentOptions = {
      ...options,
      signal,
      onDelta: (delta) => {
        emittedText = true;
        clearTimeout(firstTimer);
        options.onDelta(delta);
      },
    };
    try {
      if (provider === "openai") await streamOpenAI(wrapped, signal);
      if (provider === "anthropic") await streamAnthropic(wrapped, signal);
      if (provider === "deepseek") await streamDeepSeek(wrapped, signal);
      if (provider === "openrouter") await streamOpenRouter(wrapped, signal);
      return;
    } catch (error) {
      lastError = error;
      const transient = error instanceof ProviderError ? error.transient : signal.aborted && !options.signal.aborted;
      if (attempt === 0 && !emittedText && transient) continue;
      if (options.signal.aborted) throw new ProviderError("请求已取消");
      if (signal.aborted) throw new ProviderError(String(signal.reason?.message || "模型请求超时"), { transient: true });
      throw error;
    } finally {
      clearTimeout(firstTimer);
      clearTimeout(totalTimer);
    }
  }
  throw lastError;
}

export async function testProvider(id: ProviderId): Promise<{ ok: boolean; latencyMs: number; message: string }> {
  if (!apiKey(id)) {
    return { ok: false, latencyMs: 0, message: `未配置 ${definition(id).keyEnv}` };
  }
  const started = Date.now();
  const model = process.env[definition(id).modelEnv]?.trim() || definition(id).defaultModel;
  const controller = AbortSignal.timeout(20_000);
  try {
    if (id === "openai") {
      await checkedFetch(endpoint(id, "v1/responses"), {
        method: "POST",
        signal: controller,
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey(id)}` },
        body: JSON.stringify({ model, input: "Reply with OK.", max_output_tokens: 8 }),
      });
    } else if (id === "anthropic") {
      await checkedFetch(endpoint(id, "v1/messages"), {
        method: "POST",
        signal: controller,
        headers: { "content-type": "application/json", "x-api-key": apiKey(id), "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 8, messages: [{ role: "user", content: "Reply with OK." }] }),
      });
    } else if (id === "deepseek") {
      await checkedFetch(endpoint(id, "chat/completions"), {
        method: "POST",
        signal: controller,
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey(id)}` },
        body: JSON.stringify({ model, max_tokens: 8, messages: [{ role: "user", content: "Reply with OK." }] }),
      });
    } else {
      await checkedFetch(endpoint(id, "chat/completions"), {
        method: "POST",
        signal: controller,
        headers: openRouterHeaders(),
        body: JSON.stringify({ model, max_tokens: 8, messages: [{ role: "user", content: "Reply with OK." }] }),
      });
    }
    return { ok: true, latencyMs: Date.now() - started, message: "连接成功" };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, message: redactSecrets(error instanceof Error ? error.message : String(error)) };
  }
}
