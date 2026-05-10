/**
 * SwarmX V6.1 — Resilient Ollama Service
 *
 * Centralizes Ollama endpoint resolution and model discovery with:
 * - Multi-endpoint failover (localhost, 127.0.0.1, configured)
 * - Graceful degradation (HTTP → subprocess fallback)
 * - Cached model lists with TTL
 * - Structured health reporting
 *
 * [V6.1-FIX-13] Replaces brittle per-route Ollama discovery with robust service.
 */
import { execSync } from "node:child_process";

export interface OllamaServiceConfig {
  baseUrl: string;
  // [V6.1-FIX-17] Health means HTTP reachability of the configured endpoint.
  // Subprocess fallback can discover model tags, but cannot satisfy API calls.
  isHealthy: boolean;
  modelListMethod: "http" | "subprocess" | "static";
  cachedModels: string[];
  configuredModels: string[];
  lastCheckTime: number;
  lastError?: string;
}

function getDefaultEndpoints(): string[] {
  // [V6.1-FIX-17] Resolve endpoints per discovery cycle so runtime env changes
  // (restart scripts, port remaps) are honored without module reload.
  const ordered = [
    process.env["OLLAMA_HOST"]?.trim() || "",
    process.env["SWARMX_OLLAMA_URL"]?.trim() || "",
    process.env["SWARMX_OLLAMA_BASE_URL"]?.trim() || "",
    "http://127.0.0.1:11434",
    "http://localhost:11434",
  ].filter(Boolean);

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const endpoint of ordered) {
    const normalized = normalizeEndpoint(endpoint);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
  }
  return deduped;
}

const CACHE_TTL_MS = 15_000; // 15 seconds

let cachedConfig: OllamaServiceConfig | null = null;
let lastDiscoveryTime = 0;

/**
 * Normalize an Ollama endpoint URL.
 */
function normalizeEndpoint(raw: string): string {
  if (!raw) return "http://127.0.0.1:11434";
  const trimmed = raw.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed.replace(/\/+$/, "");
  }
  // Assume http if no scheme
  return `http://${trimmed.replace(/\/+$/, "")}`;
}

/**
 * Probe HTTP endpoint for Ollama /api/tags.
 */
async function probeHttpModels(
  baseUrl: string,
  timeoutMs: number = 3000,
): Promise<{ reachable: boolean; models: string[] }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) return { reachable: false, models: [] };
      const json = (await res.json()) as { models?: Array<{ name?: string }> };
      const names = (json.models ?? [])
        .map((m) => m.name?.trim())
        .filter((n): n is string => Boolean(n));
      return { reachable: true, models: [...new Set(names)].sort() };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    return { reachable: false, models: [] };
  }
}

/**
 * Subprocess fallback: `ollama list | grep -v 'NAME' | awk '{print $1}'`
 */
function probeSubprocessModels(): string[] {
  try {
    const output = execSync("ollama list 2>/dev/null || true", {
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    const lines = output.split("\n").slice(1); // Skip header
    const names = lines
      .map((line) => line.split(/\s+/)[0]?.trim())
      .filter((n): n is string => Boolean(n) && n !== "NAME");
    return [...new Set(names)].sort();
  } catch {
    return [];
  }
}

/**
 * Static fallback: return configured model names from env.
 */
function getStaticModels(): string[] {
  const models = [
    process.env["SWARMX_COMPOSER_MODEL"]?.trim() || "",
    process.env["SWARMX_MODEL_FAST"]?.trim() || "",
    process.env["SWARMX_MODEL_CODE"]?.trim() || "",
    process.env["SWARMX_MODEL_REASON"]?.trim() || "",
    "phi4-fast:latest",
    "qwen-worker:latest",
    "deepseek-reasoner:latest",
  ].filter(Boolean);
  return [...new Set(models)].sort();
}

/**
 * Main discovery: try HTTP, then subprocess, then static.
 */
async function discoverModels(
  endpoints: string[],
): Promise<{
  models: string[];
  configuredModels: string[];
  httpReachable: boolean;
  method: "http" | "subprocess" | "static";
  endpoint: string;
}> {
  const primaryEndpoint = normalizeEndpoint(endpoints[0] ?? "http://127.0.0.1:11434");
  const configuredModels = getStaticModels();

  // Try each HTTP endpoint
  for (const endpoint of endpoints) {
    const normalized = normalizeEndpoint(endpoint);
    const httpProbe = await probeHttpModels(normalized, 3000);
    if (httpProbe.reachable) {
      return {
        models: httpProbe.models,
        configuredModels,
        httpReachable: true,
        method: "http",
        endpoint: normalized,
      };
    }
  }

  // Fallback: subprocess
  const subprocessModels = probeSubprocessModels();
  if (subprocessModels.length > 0) {
    return {
      models: subprocessModels,
      configuredModels,
      httpReachable: false,
      method: "subprocess",
      endpoint: primaryEndpoint,
    };
  }

  // Final fallback: static config candidates only (no verified installed models).
  return {
    models: [],
    configuredModels,
    httpReachable: false,
    method: "static",
    endpoint: primaryEndpoint,
  };
}

/**
 * Get cached or discover Ollama configuration.
 */
export async function getOllamaConfig(): Promise<OllamaServiceConfig> {
  const now = Date.now();

  // Return cached config if fresh
  if (cachedConfig && now - lastDiscoveryTime < CACHE_TTL_MS) {
    return cachedConfig;
  }

  const endpoints = getDefaultEndpoints();
  const discovery = await discoverModels(endpoints);

  cachedConfig = {
    baseUrl: normalizeEndpoint(discovery.endpoint),
    isHealthy: discovery.httpReachable,
    modelListMethod: discovery.method,
    cachedModels: discovery.models,
    configuredModels: discovery.configuredModels,
    lastCheckTime: now,
  };

  lastDiscoveryTime = now;
  return cachedConfig;
}

/**
 * Get Ollama base URL (for API calls).
 */
export async function getOllamaBaseUrl(): Promise<string> {
  const config = await getOllamaConfig();
  return config.baseUrl;
}

/**
 * Get available model list (with fallbacks).
 */
export async function getAvailableModels(): Promise<string[]> {
  const config = await getOllamaConfig();
  return config.cachedModels;
}

/**
 * Get configured model candidates from environment/static defaults.
 */
export async function getConfiguredModels(): Promise<string[]> {
  const config = await getOllamaConfig();
  return config.configuredModels;
}

/**
 * Check Ollama health (works even if model list is unavailable).
 */
export async function checkOllamaHealth(): Promise<{
  reachable: boolean;
  endpoint: string;
  methodUsed: string;
}> {
  const config = await getOllamaConfig();
  return {
    reachable: config.isHealthy,
    endpoint: config.baseUrl,
    methodUsed: config.modelListMethod,
  };
}

/**
 * Invalidate cache (call after model changes).
 */
export function invalidateOllamaCache(): void {
  cachedConfig = null;
  lastDiscoveryTime = 0;
}
