import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";
import type { ProviderId } from "../shared/types.js";

export type CredentialSource = "environment" | "macos-keychain";

export interface ProviderCredential {
  value: string;
  source?: CredentialSource;
}

const envKeys: Record<ProviderId, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

const defaultOpenRouterService = "parallel-thinking-suite.openrouter";
let cachedKeychainValue = "";
let lastKeychainLookupAt = 0;

function readOpenRouterKeychain(): string {
  if (process.platform !== "darwin" || process.env.PARALLEL_THINK_DISABLE_KEYCHAIN === "1") return "";
  const now = Date.now();
  if (now - lastKeychainLookupAt < 5_000) return cachedKeychainValue;
  lastKeychainLookupAt = now;
  const service = process.env.PARALLEL_THINK_OPENROUTER_KEYCHAIN_SERVICE?.trim() || defaultOpenRouterService;
  const account = process.env.PARALLEL_THINK_OPENROUTER_KEYCHAIN_ACCOUNT?.trim() || userInfo().username;
  try {
    cachedKeychainValue = execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-a", account, "-s", service, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3_000 },
    ).trim();
  } catch {
    cachedKeychainValue = "";
  }
  return cachedKeychainValue;
}

export function providerCredential(id: ProviderId): ProviderCredential {
  const environmentValue = process.env[envKeys[id]]?.trim() || "";
  if (environmentValue) return { value: environmentValue, source: "environment" };
  if (id === "openrouter") {
    const keychainValue = readOpenRouterKeychain();
    if (keychainValue) return { value: keychainValue, source: "macos-keychain" };
  }
  return { value: "" };
}

export function configuredSecretValues(): string[] {
  return (Object.keys(envKeys) as ProviderId[])
    .map((id) => providerCredential(id).value)
    .filter((value) => value.length >= 8);
}
