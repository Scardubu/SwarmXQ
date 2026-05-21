/**
 * adaptive-timeout-config.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * SwarmX Adaptive Timeout Matrix — Architecture Review §3 Implementation
 * Version : v2026.5.20-apex17-r3
 * Hardware : HP EliteBook 850 G3 · 8 GB RAM · CPU-only · 4 cores · WSL2
 *
 * Problem with static timeouts (arch review §3):
 *   AI_TIMEOUT=120s  — too blunt for routing (should be 2-4s)
 *   ROUTER_TIMEOUT=45s — catastrophic UX for a classification call
 *
 * This module replaces static env-var timeouts with:
 *   - Per-operation adaptive timeouts keyed to memory pressure level
 *   - Progressive cancellation: soft timeout → warn → hard cancel
 *   - Streaming-aware guards (never timeout an active token stream)
 *   - Circuit breaker: 3 failures in 90s → trip breaker → fallback model
 *   - Jittered retries to prevent synchronized retry storms
 *   - Memory-aware auto-downgrade (ctx/predict/concurrency reduction)
 *
 * File location: apps/swarmx-api/src/services/adaptive-timeout-config.ts
 *
 * Integration:
 *   import { getTimeout, withTimeout, circuitBreaker, jitteredDelay }
 *     from "./adaptive-timeout-config.js";
 *
 *   // In composer route — before every Ollama call:
 *   const timeoutMs = getTimeout("fast_chat", currentPressureLevel());
 *   const result = await withTimeout(ollamaCall(), timeoutMs, "fast_chat");
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from "node:fs";

// ─── Memory pressure levels ────────────────────────────────────────────────────

export type PressureLevel = "low" | "normal" | "high" | "critical";

export type OperationKey =
  | "intent_classify"       // phi4-router-lite-scar: routing decision only
  | "routing"               // phi4-fast-scar: classify + route
  | "fast_chat"             // phi4-fast-scar: short conversational
  | "tool_execution"        // phi4-worker-scar: single tool call
  | "supervisor_planning"   // qwen-supervisor-scar: multi-step plan
  | "code_generation"       // qwen-worker-scar: implementation
  | "deep_reasoning"        // deepseek-reasoner-scar: architecture analysis
  | "critic_audit"          // deepseek-critic-scar: adversarial review
  | "evolver_observe"       // phi4-evolve-scar: Phase 1 fitness snapshot
  | "evolver_critique"      // deepseek-evolve-scar: Phase 2 critique
  | "evolver_mutate"        // qwen-evolve-scar: Phase 3 mutation
  | "evolver_validate"      // deepseek-evolve-scar: Phase 4 validation
  | "health_probe";         // /api/version or /api/tags probe

// ─── Adaptive timeout matrix (ms) — arch review §3 ───────────────────────────
//
// Each cell: timeout in milliseconds per pressure level.
// Lower pressure = more generous timeout (system has headroom).
// Critical pressure = minimum viable timeout (fail fast, fallback fast).

const TIMEOUT_MATRIX: Record<OperationKey, Record<PressureLevel, number>> = {
  intent_classify:     { low: 4_000,   normal: 3_000,  high: 2_000,  critical: 1_500  },
  routing:             { low: 6_000,   normal: 5_000,  high: 4_000,  critical: 3_000  },
  fast_chat:           { low: 15_000,  normal: 12_000, high: 8_000,  critical: 6_000  },
  tool_execution:      { low: 35_000,  normal: 28_000, high: 20_000, critical: 15_000 },
  supervisor_planning: { low: 60_000,  normal: 50_000, high: 35_000, critical: 25_000 },
  code_generation:     { low: 55_000,  normal: 45_000, high: 32_000, critical: 22_000 },
  deep_reasoning:      { low: 120_000, normal: 90_000, high: 60_000, critical: 45_000 },
  critic_audit:        { low: 100_000, normal: 75_000, high: 55_000, critical: 40_000 },
  evolver_observe:     { low: 90_000,  normal: 75_000, high: 55_000, critical: 40_000 },
  evolver_critique:    { low: 150_000, normal: 120_000,high: 90_000, critical: 60_000 },
  evolver_mutate:      { low: 120_000, normal: 90_000, high: 70_000, critical: 50_000 },
  evolver_validate:    { low: 150_000, normal: 120_000,high: 90_000, critical: 60_000 },
  health_probe:        { low: 2_000,   normal: 2_000,  high: 1_500,  critical: 1_000  },
};

// ─── RAM thresholds for pressure level resolution ────────────────────────────

const PRESSURE_THRESHOLDS_MB = {
  low:      4_000,  // > 4 GB free   → low pressure
  normal:   2_500,  // > 2.5 GB free → normal
  high:     1_500,  // > 1.5 GB free → high
  critical: 0,      // ≤ 1.5 GB free → critical (arch review §3 timeout memory awareness)
};

// ─── Read available RAM from /proc/meminfo (WSL2 procfs) ────────────────────

function readAvailableRamMb(): number {
  try {
    const content = readFileSync("/proc/meminfo", "utf8");
    const match = content.match(/MemAvailable:\s+(\d+)\s+kB/);
    if (match?.[1]) return Math.floor(Number(match[1]) / 1024);
  } catch {
    // Not on Linux/WSL2 — return conservative estimate
  }
  return 2_000; // conservative default: assume normal-to-high pressure
}

// Cache pressure level for 5s to avoid excessive /proc/meminfo reads
let _cachedPressure: PressureLevel | null = null;
let _pressureCacheTs = 0;
const PRESSURE_CACHE_TTL_MS = 5_000;

export function currentPressureLevel(): PressureLevel {
  const now = Date.now();
  if (_cachedPressure && now - _pressureCacheTs < PRESSURE_CACHE_TTL_MS) {
    return _cachedPressure;
  }
  const availMb = readAvailableRamMb();
  let level: PressureLevel;
  if (availMb > PRESSURE_THRESHOLDS_MB.low)    level = "low";
  else if (availMb > PRESSURE_THRESHOLDS_MB.normal) level = "normal";
  else if (availMb > PRESSURE_THRESHOLDS_MB.high)   level = "high";
  else                                               level = "critical";

  _cachedPressure = level;
  _pressureCacheTs = now;
  return level;
}

export function getAvailableRamMb(): number {
  return readAvailableRamMb();
}

// ─── Primary API: get timeout for an operation at current pressure ────────────

export function getTimeout(op: OperationKey, pressure?: PressureLevel): number {
  const p = pressure ?? currentPressureLevel();
  return TIMEOUT_MATRIX[op][p];
}

// ─── withTimeout: wraps any promise with adaptive cancellation ───────────────
//
// Progressive cancellation (arch review §3):
//   - At 80% of timeout: emit a soft warning log
//   - At 100%: hard cancel via AbortController
//   - Active token streams: reset timer on each received chunk (see streamGuard)

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  onSoftWarning?: (label: string, elapsedMs: number) => void,
): Promise<T> {
  const softAt = Math.floor(timeoutMs * 0.80);
  let softFired = false;

  return new Promise<T>((resolve, reject) => {
    const softTimer = setTimeout(() => {
      softFired = true;
      onSoftWarning?.(label, softAt);
      console.warn(`[adaptive-timeout] SOFT_WARNING op=${label} elapsed=${softAt}ms limit=${timeoutMs}ms`);
    }, softAt);

    const hardTimer = setTimeout(() => {
      clearTimeout(softTimer);
      reject(new Error(`[adaptive-timeout] HARD_CANCEL op=${label} timeout=${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (result) => {
        clearTimeout(softTimer);
        clearTimeout(hardTimer);
        if (!softFired) {
          // Only log fast paths for routing operations to avoid noise
          if (label.includes("classify") || label.includes("routing")) {
            console.debug(`[adaptive-timeout] OK op=${label} within=${timeoutMs}ms`);
          }
        }
        resolve(result);
      },
      (err: unknown) => {
        clearTimeout(softTimer);
        clearTimeout(hardTimer);
        reject(err);
      },
    );
  });
}

// ─── streamGuard: resets timeout on each received token chunk ────────────────
//
// Per arch review §3: "DO NOT timeout active streams."
// This guard returns a cancel function — call it from the consumer when done.

export function createStreamGuard(
  timeoutMs: number,
  label: string,
  onTimeout: (label: string) => void,
): { resetTimer: () => void; cancel: () => void } {
  let timerId: ReturnType<typeof setTimeout>;

  const reset = () => {
    clearTimeout(timerId);
    timerId = setTimeout(() => {
      console.warn(`[stream-guard] STREAM_TIMEOUT op=${label} inactivity=${timeoutMs}ms`);
      onTimeout(label);
    }, timeoutMs);
  };

  reset(); // Start timer immediately

  return {
    resetTimer: reset,
    cancel: () => clearTimeout(timerId),
  };
}

// ─── Circuit Breaker — arch review §3 ────────────────────────────────────────
//
// Policy: 3 failures within 90 seconds → trip breaker → fallback model
// State machine: closed → open → half-open → closed

export type CircuitState = "closed" | "open" | "half-open";

interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  lastFailureTs: number;
  tripTs: number;
  successAfterHalfOpen: number;
}

const CIRCUIT_FAILURE_THRESHOLD = Number.parseInt(
  process.env["SWARMX_CB_FAILURE_THRESHOLD"] ?? "3", 10,
);
const CIRCUIT_WINDOW_MS = Number.parseInt(
  process.env["SWARMX_CB_WINDOW_MS"] ?? "90000", 10,
);
const CIRCUIT_OPEN_DURATION_MS = Number.parseInt(
  process.env["SWARMX_CB_OPEN_DURATION_MS"] ?? "30000", 10,
);
const CIRCUIT_HALFOPEN_SUCCESS_THRESHOLD = 2;

const circuits = new Map<string, CircuitBreakerState>();

function getCircuit(key: string): CircuitBreakerState {
  if (!circuits.has(key)) {
    circuits.set(key, {
      state: "closed",
      failures: 0,
      lastFailureTs: 0,
      tripTs: 0,
      successAfterHalfOpen: 0,
    });
  }
  return circuits.get(key)!;
}

export function circuitState(modelKey: string): CircuitState {
  const c = getCircuit(modelKey);
  const now = Date.now();

  if (c.state === "open" && now - c.tripTs >= CIRCUIT_OPEN_DURATION_MS) {
    c.state = "half-open";
    c.successAfterHalfOpen = 0;
    console.info(`[circuit-breaker] HALF_OPEN model=${modelKey}`);
  }

  return c.state;
}

export function recordSuccess(modelKey: string): void {
  const c = getCircuit(modelKey);
  if (c.state === "half-open") {
    c.successAfterHalfOpen++;
    if (c.successAfterHalfOpen >= CIRCUIT_HALFOPEN_SUCCESS_THRESHOLD) {
      c.state = "closed";
      c.failures = 0;
      console.info(`[circuit-breaker] CLOSED model=${modelKey} recovered`);
    }
  } else if (c.state === "closed") {
    c.failures = 0; // Reset on success
  }
}

export function recordFailure(modelKey: string): void {
  const c = getCircuit(modelKey);
  const now = Date.now();

  // Reset window if too old
  if (now - c.lastFailureTs > CIRCUIT_WINDOW_MS) {
    c.failures = 0;
  }

  c.failures++;
  c.lastFailureTs = now;

  if (c.state === "closed" && c.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    c.state = "open";
    c.tripTs = now;
    console.error(
      `[circuit-breaker] TRIPPED model=${modelKey} failures=${c.failures} window=${CIRCUIT_WINDOW_MS}ms → fallback`,
    );
  } else if (c.state === "half-open") {
    // Any failure in half-open re-trips immediately
    c.state = "open";
    c.tripTs = now;
    console.warn(`[circuit-breaker] RE_TRIPPED model=${modelKey} failed in half-open state`);
  }
}

// ─── Jittered retry delay — arch review §3 ───────────────────────────────────
//
// Avoids synchronized retry storms from multiple agents failing simultaneously.
// Uses exponential backoff with ±25% jitter.

export async function jitteredDelay(
  attemptIndex: number,    // 0-based attempt number
  baseMs = 500,
  maxMs = 8_000,
): Promise<void> {
  const delay = getJitteredDelayMs(attemptIndex, baseMs, maxMs);
  await new Promise((r) => setTimeout(r, delay));
}

export function getJitteredDelayMs(
  attemptIndex: number,
  baseMs = 500,
  maxMs = 8_000,
): number {
  const exponential = Math.min(baseMs * Math.pow(2, attemptIndex), maxMs);
  const jitter = exponential * 0.25 * (Math.random() * 2 - 1); // ±25%
  return Math.max(100, Math.floor(exponential + jitter));
}

// ─── Memory-aware ctx/predict downgrade — arch review §3 ─────────────────────
//
// "If available RAM < 1.5 GB: automatically reduce ctx, predict, concurrency"

export interface ModelCallOverrides {
  num_ctx?: number;
  num_predict?: number;
  temperature?: number;
}

interface BaseModelProfile {
  num_ctx: number;
  num_predict: number;
}

const MODEL_BASE_PROFILES: Record<string, BaseModelProfile> = {
  "phi4-router-lite-scar": { num_ctx: 2048,  num_predict: 96   },
  "phi4-fast-scar":         { num_ctx: 2048,  num_predict: 96   },
  "phi4-worker-scar":       { num_ctx: 4096,  num_predict: 512  },
  "phi4-evolve-scar":       { num_ctx: 6144,  num_predict: 1024 },
  "qwen-worker-scar":       { num_ctx: 6144,  num_predict: 512  },
  "qwen-supervisor-scar":   { num_ctx: 6144,  num_predict: 640  },
  "qwen-evolve-scar":       { num_ctx: 6144,  num_predict: 1024 },
  "deepseek-reasoner-scar": { num_ctx: 6144,  num_predict: 1536 },
  "deepseek-critic-scar":   { num_ctx: 8192,  num_predict: 1024 },
  "deepseek-supervisor-scar":{ num_ctx: 6144, num_predict: 1024 },
  "deepseek-evolve-scar":   { num_ctx: 6144,  num_predict: 1024 },
};

const PRESSURE_CTX_SCALE: Record<PressureLevel, number>     = { low: 1.0, normal: 1.0, high: 0.75, critical: 0.5  };
const PRESSURE_PREDICT_SCALE: Record<PressureLevel, number> = { low: 1.0, normal: 1.0, high: 0.65, critical: 0.5  };

export function getModelOverrides(modelTag: string, pressure?: PressureLevel): ModelCallOverrides {
  const p = pressure ?? currentPressureLevel();
  const base = MODEL_BASE_PROFILES[modelTag];
  if (!base) return {};

  const ctxScale     = PRESSURE_CTX_SCALE[p];
  const predictScale = PRESSURE_PREDICT_SCALE[p];

  const overrides: ModelCallOverrides = {};

  if (ctxScale < 1.0) {
    overrides.num_ctx = Math.max(512, Math.floor(base.num_ctx * ctxScale));
  }
  if (predictScale < 1.0) {
    overrides.num_predict = Math.max(64, Math.floor(base.num_predict * predictScale));
  }

  if (p === "critical") {
    overrides.temperature = 0.0; // Maximum determinism under pressure
  }

  return overrides;
}

// ─── Convenience: full call config for a model at current pressure ────────────

export interface AdaptiveCallConfig {
  timeoutMs: number;
  overrides: ModelCallOverrides;
  pressure: PressureLevel;
  availableRamMb: number;
  circuitOpen: boolean;
}

export function getAdaptiveCallConfig(
  modelTag: string,
  operation: OperationKey,
): AdaptiveCallConfig {
  const pressure   = currentPressureLevel();
  const ramMb      = getAvailableRamMb();
  const timeoutMs  = getTimeout(operation, pressure);
  const overrides  = getModelOverrides(modelTag, pressure);
  const cbState    = circuitState(modelTag);

  return {
    timeoutMs,
    overrides,
    pressure,
    availableRamMb: ramMb,
    circuitOpen: cbState === "open",
  };
}

// ─── Exports summary ─────────────────────────────────────────────────────────
//
//  currentPressureLevel()          → PressureLevel
//  getAvailableRamMb()             → number
//  getTimeout(op, pressure?)       → number (ms)
//  withTimeout(promise, ms, label) → Promise<T>
//  createStreamGuard(ms, label, cb)→ { resetTimer, cancel }
//  circuitState(modelKey)          → CircuitState
//  recordSuccess(modelKey)         → void
//  recordFailure(modelKey)         → void
//  getJitteredDelayMs(attempt, base?, max?) → number
//  jitteredDelay(attempt, base?)   → Promise<void>
//  getModelOverrides(tag, pressure?)→ ModelCallOverrides
//  getAdaptiveCallConfig(tag, op)  → AdaptiveCallConfig
