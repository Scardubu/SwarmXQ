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
  isHealthy: boolean;
  modelListMethod: "http" | "subprocess" | "static";
  cachedModels: string[];
  lastCheckTime: number;
  lastError?: string;
}

const DEFAULT_ENDPOINTS = [
  process.env["OLLAMA_HOST"]?.trim() || "",
  process.env["SWARMX_OLLAMA_URL"]?.trim() || "",
  process.env["SWARMX_OLLAMA_BASE_URL"]?.trim() || "",
  "http://127.0.0.1:11434",
  "http://localhost:11434",
].filter(Boolean);

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
async function probeHttpModels(baseUrl: string, timeoutMs: number = 3000): Promise<string[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) return [];
      const json = (await res.json()) as { models?: Array<{ name?: string }> };
      const names = (json.models ?? [])
        .map((m) => m.name?.trim())
        .filter((n): n is string => Boolean(n));
      return [...new Set(names)].sort();
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    return [];
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
): Promise<{ models: string[]; method: "http" | "subprocess" | "static"; endpoint: string }> {
  const primaryEndpoint = normalizeEndpoint(endpoints[0] ?? "http://127.0.0.1:11434");

  // Try each HTTP endpoint
  for (const endpoint of endpoints) {
    const normalized = normalizeEndpoint(endpoint);
    const models = await probeHttpModels(normalized, 3000);
    if (models.length > 0) {
      return { models, method: "http", endpoint: normalized };
    }
  }

  // Fallback: subprocess
  const subprocessModels = probeSubprocessModels();
  if (subprocessModels.length > 0) {
    return { models: subprocessModels, method: "subprocess", endpoint: primaryEndpoint };
  }

  // Final fallback: static list
  return { models: getStaticModels(), method: "static", endpoint: primaryEndpoint };
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

  const endpoints = DEFAULT_ENDPOINTS;
  const discovery = await discoverModels(endpoints);

  cachedConfig = {
    baseUrl: normalizeEndpoint(discovery.endpoint),
    isHealthy: discovery.method !== "static",
    modelListMethod: discovery.method,
    cachedModels: discovery.models,
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
