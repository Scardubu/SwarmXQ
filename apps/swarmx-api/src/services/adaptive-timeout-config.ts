/**
 * apps/swarmx-api/src/services/adaptive-timeout-config.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * SwarmX Adaptive Timeout Matrix — APEX-17 r8
 * Version : v2026.6.28-apex17-r8
 * Hardware : HP EliteBook 850 G3 · 8 GB RAM · CPU-only · 4 cores · WSL2
 *
 * Adaptive timeouts, circuit breakers, jittered retries, and memory-aware
 * model overrides keyed to dual-layer naming.
 *
 * Operator → Operation mapping (informational):
 *   Relay     → intent_classify, routing, health_probe
 *   Pilot     → fast_chat
 *   Architect → supervisor_planning
 *   Forge     → code_generation, tool_execution
 *   Oracle    → deep_reasoning
 *   Auditor   → critic_audit
 *   Lab       → evolver_observe, evolver_critique, evolver_mutate, evolver_validate
 *
 * APEX-17 r7 changes from r5:
 *   [ATC-r7-01] OperationKey comments updated from legacy tag names to Operator names
 *   [ATC-r7-02] MODEL_BASE_PROFILES rebuilt with canonical keys + legacy aliases
 *               so model lookups work with EITHER name during migration
 *   [ATC-r7-03] getModelOverrides() resolves through operator-map first
 *   [ATC-r7-04] adaptiveCallConfig() includes operator label for log readability
 *
 * APEX-17 r8 changes from r7:
 *   [ATC-r8-01] `OperationKey` and the local `PressureLevel` type are no
 *               longer defined here. Both are now imported from
 *               packages/swarmx-types/src/operation-types.ts (the timeout-
 *               domain pressure scale is exported there as
 *               `TimeoutPressureLevel`; this file aliases it back to the
 *               local name `PressureLevel` on import so nothing else in this
 *               file needs to change). model-orchestrator.ts imports the
 *               exact same two types — see that file's ORCH-r8-02 note.
 *   [ATC-r8-02] operator-map import switched from a four-level relative path
 *               into another package's src/ to the proper `@swarmx/types/
 *               operator-map` workspace alias (now that
 *               packages/swarmx-types/package.json exposes that subpath and
 *               apps/swarmx-api depends on @swarmx/types — see this
 *               integration's Phase 3 package.json / tsconfig.json patches).
 *               No behavioural change.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from "node:fs";
import {
  resolveCanonicalTag,
  resolveOperatorName,
} from "@swarmx/types/operator-map";
import type {
  OperationKey,
  TimeoutPressureLevel as PressureLevel,
} from "@swarmx/types/operation-types";

export type { OperationKey, PressureLevel };

// ─── Adaptive timeout matrix (ms) ────────────────────────────────────────────

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

const PRESSURE_THRESHOLDS_MB = {
  low:      4_000,
  normal:   2_500,
  high:     1_500,
  critical: 0,
};

function readAvailableRamMb(): number {
  try {
    const content = readFileSync("/proc/meminfo", "utf8");
    const match = content.match(/MemAvailable:\s+(\d+)\s+kB/);
    if (match?.[1]) return Math.floor(Number(match[1]) / 1024);
  } catch {
    // Not on Linux/WSL2 — return conservative estimate
  }
  return 2_000;
}

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
  if (availMb > PRESSURE_THRESHOLDS_MB.low)         level = "low";
  else if (availMb > PRESSURE_THRESHOLDS_MB.normal) level = "normal";
  else if (availMb > PRESSURE_THRESHOLDS_MB.high)   level = "high";
  else                                              level = "critical";
  _cachedPressure = level;
  _pressureCacheTs = now;
  return level;
}

export function getAvailableRamMb(): number {
  return readAvailableRamMb();
}

export function getTimeout(op: OperationKey, pressure?: PressureLevel): number {
  const p = pressure ?? currentPressureLevel();
  return TIMEOUT_MATRIX[op][p];
}

// ─── withTimeout ──────────────────────────────────────────────────────────────

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
        if (!softFired && (label.includes("classify") || label.includes("routing"))) {
          console.debug(`[adaptive-timeout] OK op=${label} within=${timeoutMs}ms`);
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

// ─── createStreamGuard ────────────────────────────────────────────────────────

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
  reset();
  return { resetTimer: reset, cancel: () => clearTimeout(timerId) };
}

// ─── Circuit Breaker ──────────────────────────────────────────────────────────

export type CircuitState = "closed" | "open" | "half-open";

interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  lastFailureTs: number;
  tripTs: number;
  successAfterHalfOpen: number;
}

const CIRCUIT_FAILURE_THRESHOLD = Number.parseInt(
  process.env["SWARMX_CB_FAILURE_THRESHOLD"] ?? "3", 10);
const CIRCUIT_WINDOW_MS = Number.parseInt(
  process.env["SWARMX_CB_WINDOW_MS"] ?? "90000", 10);
const CIRCUIT_OPEN_DURATION_MS = Number.parseInt(
  process.env["SWARMX_CB_OPEN_DURATION_MS"] ?? "30000", 10);
const CIRCUIT_HALFOPEN_SUCCESS_THRESHOLD = 2;

const circuits = new Map<string, CircuitBreakerState>();

function getCircuit(key: string): CircuitBreakerState {
  // [ATC-r7-03] Normalize key through canonical tag so legacy aliases share state
  const normKey = resolveCanonicalTag(key);
  if (!circuits.has(normKey)) {
    circuits.set(normKey, {
      state: "closed", failures: 0, lastFailureTs: 0, tripTs: 0,
      successAfterHalfOpen: 0,
    });
  }
  return circuits.get(normKey)!;
}

export function circuitState(modelKey: string): CircuitState {
  const c = getCircuit(modelKey);
  const now = Date.now();
  if (c.state === "open" && now - c.tripTs >= CIRCUIT_OPEN_DURATION_MS) {
    c.state = "half-open";
    c.successAfterHalfOpen = 0;
    const operator = resolveOperatorName(modelKey);
    console.info(`[circuit-breaker] HALF_OPEN ${operator} (${resolveCanonicalTag(modelKey)})`);
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
      const operator = resolveOperatorName(modelKey);
      console.info(`[circuit-breaker] CLOSED ${operator} (${resolveCanonicalTag(modelKey)}) recovered`);
    }
  } else if (c.state === "closed") {
    c.failures = 0;
  }
}

export function recordFailure(modelKey: string): void {
  const c = getCircuit(modelKey);
  const now = Date.now();
  if (now - c.lastFailureTs > CIRCUIT_WINDOW_MS) c.failures = 0;
  c.failures++;
  c.lastFailureTs = now;
  if (c.state === "closed" && c.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    c.state = "open";
    c.tripTs = now;
    const operator = resolveOperatorName(modelKey);
    console.error(
      `[circuit-breaker] TRIPPED ${operator} (${resolveCanonicalTag(modelKey)}) ` +
      `failures=${c.failures} window=${CIRCUIT_WINDOW_MS}ms → fallback`
    );
  } else if (c.state === "half-open") {
    c.state = "open";
    c.tripTs = now;
    const operator = resolveOperatorName(modelKey);
    console.warn(`[circuit-breaker] RE_TRIPPED ${operator} failed in half-open state`);
  }
}

// ─── Jittered retry delay ─────────────────────────────────────────────────────

export async function jitteredDelay(
  attemptIndex: number, baseMs = 500, maxMs = 8_000,
): Promise<void> {
  const delay = getJitteredDelayMs(attemptIndex, baseMs, maxMs);
  await new Promise((r) => setTimeout(r, delay));
}

export function getJitteredDelayMs(
  attemptIndex: number, baseMs = 500, maxMs = 8_000,
): number {
  const exponential = Math.min(baseMs * Math.pow(2, attemptIndex), maxMs);
  const jitter = exponential * 0.25 * (Math.random() * 2 - 1);
  return Math.max(100, Math.floor(exponential + jitter));
}

// ─── Memory-aware ctx/predict downgrade ──────────────────────────────────────

export interface ModelCallOverrides {
  num_ctx?: number;
  num_predict?: number;
  temperature?: number;
}

interface BaseModelProfile {
  num_ctx: number;
  num_predict: number;
}

// [ATC-r7-02] MODEL_BASE_PROFILES keyed by canonical tags.
// Legacy aliases are resolved through resolveCanonicalTag() at lookup time.
const MODEL_BASE_PROFILES: Record<string, BaseModelProfile> = {
  // Relay
  "route-phi4-lite-q4km-prod":         { num_ctx: 2048, num_predict: 96   },
  // Pilot
  "instruct-phi4-pro-q8-prod":         { num_ctx: 2048, num_predict: 256  },
  // Architect (phi4)
  "plan-phi4-pro-q8-prod":             { num_ctx: 4096, num_predict: 512  },
  // Architect (qwen25)
  "plan-qwen25-pro-q5km-prod":         { num_ctx: 6144, num_predict: 640  },
  // Architect (deepseekr1)
  "plan-deepseekr1-pro-q5km-prod":     { num_ctx: 6144, num_predict: 1024 },
  // Forge
  "code-qwen25-pro-q5km-prod":         { num_ctx: 6144, num_predict: 4096 },
  // Oracle
  "reason-deepseekr1-pro-q5km-prod":   { num_ctx: 6144, num_predict: 2048 },
  // Auditor
  "critique-deepseekr1-pro-q5km-prod": { num_ctx: 8192, num_predict: 1024 },
  // Lab
  "synth-phi4-exp-q8-dev":             { num_ctx: 6144, num_predict: 1024 },
  "synth-qwen25-exp-q5km-dev":         { num_ctx: 6144, num_predict: 1024 },
  "synth-deepseekr1-exp-q5km-dev":     { num_ctx: 6144, num_predict: 1024 },
};

const PRESSURE_CTX_SCALE: Record<PressureLevel, number>     = { low: 1.0, normal: 1.0, high: 0.75, critical: 0.5 };
const PRESSURE_PREDICT_SCALE: Record<PressureLevel, number> = { low: 1.0, normal: 1.0, high: 0.65, critical: 0.5 };

export function getModelOverrides(modelTag: string, pressure?: PressureLevel): ModelCallOverrides {
  const p = pressure ?? currentPressureLevel();
  // [ATC-r7-03] Resolve legacy tags to canonical before lookup
  const canonicalTag = resolveCanonicalTag(modelTag);
  const base = MODEL_BASE_PROFILES[canonicalTag];
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
    overrides.temperature = 0.0;
  }
  return overrides;
}

// ─── Convenience: full call config for a model at current pressure ────────────

export interface AdaptiveCallConfig {
  timeoutMs:      number;
  overrides:      ModelCallOverrides;
  pressure:       PressureLevel;
  availableRamMb: number;
  circuitOpen:    boolean;
  /** [ATC-r7-04] Dual-layer naming for log readability. */
  modelTag:       string;
  operator:       string;
}

export function getAdaptiveCallConfig(
  modelTag: string,
  operation: OperationKey,
): AdaptiveCallConfig {
  const canonicalTag = resolveCanonicalTag(modelTag);
  const pressure     = currentPressureLevel();
  const ramMb        = getAvailableRamMb();
  const timeoutMs    = getTimeout(operation, pressure);
  const overrides    = getModelOverrides(canonicalTag, pressure);
  const cbState      = circuitState(canonicalTag);

  return {
    timeoutMs,
    overrides,
    pressure,
    availableRamMb: ramMb,
    circuitOpen: cbState === "open",
    modelTag: canonicalTag,
    operator: resolveOperatorName(canonicalTag),
  };
}
