export type ProviderId = "openai" | "anthropic" | "deepseek";
export type ContextMode = "summary" | "prompt-only" | "full";
export type SelectionMode = "auto" | "all" | "explicit";
export type AgentRole = "worker" | "synthesizer";
export type AgentRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type RunStatus = "queued" | "running" | "partial" | "completed" | "failed" | "cancelled";

export interface SelectionConfig {
  includeInParallel: boolean;
  tags: string[];
  intents: string[];
  negativeHints: string[];
  priority: number;
}

export interface AgentExtension {
  displayName: string;
  enabled: boolean;
  provider: ProviderId;
  role: AgentRole;
  selection: SelectionConfig;
  knowledge: {
    sharedMode: "auto" | "on" | "off";
    sharedCollections: string[];
    privatePaths: string[];
  };
  context: {
    defaultMode: ContextMode;
  };
  limits: {
    firstTokenTimeoutMs: number;
    totalTimeoutMs: number;
  };
}

export interface AgentSummary {
  id: string;
  description: string;
  version?: string;
  systemPrompt: string;
  model: {
    name: string;
    temperature?: number;
    maxTokens?: number;
  };
  profile?: string;
  extension: AgentExtension;
  valid: boolean;
  issues: Array<{ code: string; message: string; level: "error" | "warning"; path?: string }>;
}

export interface AgentDraft extends AgentSummary {
  id: string;
}

export interface RunRequest {
  query: string;
  context?: string;
  contextMode?: ContextMode;
  selection?: {
    mode: SelectionMode;
    agentIds?: string[];
  };
  agentTasks?: Record<string, string>;
  projectRoot?: string;
}

export interface AgentRunResult {
  agentId: string;
  displayName: string;
  provider: ProviderId;
  model: string;
  status: AgentRunStatus;
  task: string;
  output: string;
  error?: string;
  usage?: Record<string, number>;
  startedAt?: string;
  completedAt?: string;
}

export interface RunManifest {
  id: string;
  query: string;
  contextMode: ContextMode;
  selectionMode: SelectionMode;
  selectedAgents: string[];
  projectRoot: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  agents: Record<string, AgentRunResult>;
  synthesis?: {
    agentId: string;
    output: string;
    createdAt: string;
  };
}

export interface RunEvent {
  runId: string;
  sequence: number;
  type:
    | "run_started"
    | "agent_started"
    | "text_delta"
    | "usage"
    | "agent_completed"
    | "agent_failed"
    | "agent_cancelled"
    | "run_completed"
    | "run_cancelled"
    | "synthesis_completed";
  at: string;
  agentId?: string;
  delta?: string;
  usage?: Record<string, number>;
  message?: string;
  data?: unknown;
}

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  configured: boolean;
  envKey: string;
  model: string;
  baseUrl: string;
}

export interface ParsedDocument {
  sourcePath: string;
  parserId: string;
  parserVersion: string;
  text: string;
  metadata: Record<string, unknown>;
  hash: string;
  cached: boolean;
}

export interface ParserRecord {
  id: string;
  version: string;
  kind: "builtin" | "extension";
  extensions: string[];
  status:
    | "discovered"
    | "validating"
    | "canary"
    | "active"
    | "deprecated"
    | "disabled"
    | "failed"
    | "rolled_back";
  previousStableVersion?: string;
  successCount: number;
  failureCount: number;
  cacheHits: number;
  totalDurationMs: number;
  extractedCharacters: number;
  consecutiveHardFailures: number;
  lastUsedAt?: string;
  lastError?: string;
}
