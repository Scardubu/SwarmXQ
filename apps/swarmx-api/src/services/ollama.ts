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
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

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
 * Subprocess fallback: `ollama list` — async to avoid blocking the event loop.
 * [V6.1-FIX-18] Replaced execSync (event-loop-blocking) with promisified exec.
 */
async function probeSubprocessModels(): Promise<string[]> {
  try {
    const { stdout } = await Promise.race([
      execAsync("ollama list 2>/dev/null || true", { timeout: 3000 }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("subprocess timeout")), 3500),
      ),
    ]);
    const lines = stdout.trim().split("\n").slice(1); // Skip header
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
 * Main discovery: probe all HTTP endpoints in parallel, then subprocess, then static.
 * [V6.1-FIX-18] Replaced sequential per-endpoint await (could block 3s × N) with
 * Promise.allSettled() fan-out capped by a 4 s global race to prevent event-loop stall.
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
  const GLOBAL_HTTP_TIMEOUT_MS = 4_000;
  const primaryEndpoint = normalizeEndpoint(endpoints[0] ?? "http://127.0.0.1:11434");
  const configuredModels = getStaticModels();

  // Probe all endpoints in parallel, capped at 4 s total.
  type ProbeResult = PromiseSettledResult<{ reachable: boolean; models: string[] }>;
  const httpResults: ProbeResult[] = await Promise.race([
    Promise.allSettled(
      endpoints.map((e) => probeHttpModels(normalizeEndpoint(e), 2500)),
    ),
    new Promise<ProbeResult[]>((resolve) =>
      setTimeout(() => resolve([]), GLOBAL_HTTP_TIMEOUT_MS),
    ),
  ]);

  // Return the first successful HTTP result, preserving endpoint order priority.
  for (let i = 0; i < httpResults.length; i++) {
    const result = httpResults[i];
    if (result?.status === "fulfilled" && result.value.reachable) {
      return {
        models: result.value.models,
        configuredModels,
        httpReachable: true,
        method: "http",
        endpoint: normalizeEndpoint(endpoints[i] ?? primaryEndpoint),
      };
    }
  }

  // Fallback: subprocess (async — no event-loop block).
  const subprocessModels = await probeSubprocessModels();
  if (subprocessModels.length > 0) {
    return {
      models: subprocessModels,
      configuredModels,
      httpReachable: false,
      method: "subprocess",
      endpoint: primaryEndpoint,
    };
  }

  // Final fallback: static config candidates only.
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

/**
 * Fast health probe — single endpoint check with 2 s timeout.
 * [V6.1-FIX-18] Used by /health route so it never blocks on full discovery.
 * Returns result directly without touching the discovery cache.
 */
export async function fastHealthProbe(): Promise<{
  reachable: boolean;
  endpoint: string;
  latencyMs: number;
}> {
  const endpoints = getDefaultEndpoints();
  const primary = endpoints[0] ?? "http://127.0.0.1:11434";
  const t0 = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${primary}/api/version`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return { reachable: res.ok, endpoint: primary, latencyMs: Date.now() - t0 };
  } catch {
    return { reachable: false, endpoint: primary, latencyMs: Date.now() - t0 };
  }
}
