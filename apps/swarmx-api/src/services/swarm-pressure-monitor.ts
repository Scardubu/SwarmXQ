/**
 * swarm-pressure-monitor.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * SwarmX Swarm Pressure Monitor — Architecture Review §9 Implementation
 * Version : v2026.5.20-apex17-r3
 * Hardware : HP EliteBook 850 G3 · 8 GB RAM · CPU-only · 4 cores · WSL2
 *
 * Purpose (arch review §9):
 *   The swarm is "logically correct but not yet fully resource-aware."
 *   This module tracks real-time swarm health metrics and:
 *     - Exposes a swarmPressure() snapshot for the orchestrator
 *     - Recommends topology downgrade: triad → duo → supervisor-only → rules
 *     - Signals evolver to reduce mutation breadth under memory pressure
 *     - Feeds the SSE dashboard with live swarm health events
 *     - Integrates with adaptive-timeout-config for unified pressure awareness
 *
 * Metrics tracked per arch review §9:
 *   RAM · swap · zRAM · active models · token throughput · queue depth ·
 *   average latency · timeout rate · eviction frequency
 *
 * File location: apps/swarmx-api/src/services/swarm-pressure-monitor.ts
 *
 * Integration:
 *   import { getSwarmPressure, recommendedTopology, startSwarmMonitor }
 *     from "./swarm-pressure-monitor.js";
 *
 *   // In model-orchestrator.ts — before topology decisions:
 *   const pressure = getSwarmPressure();
 *   const topology = recommendedTopology(pressure);
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from "node:fs";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SwarmTopology =
  | "full_triad"       // router + specialist + critic (normal)
  | "duo"              // router + specialist only
  | "supervisor_only"  // supervisor handles everything
  | "rule_engine";     // no model — rule-based fallback only

export type SwarmPhase =
  | "idle"
  | "routing"
  | "execution"
  | "planning"
  | "reasoning"
  | "critique"
  | "evolving";

export interface MemorySnapshot {
  totalMb: number;
  usedMb: number;
  freeMb: number;
  availableMb: number;
  swapUsedMb: number;
  swapTotalMb: number;
  zramUsedMb: number;
  pressureScore: number;  // 0.0 (idle) → 1.0 (critical)
}

export interface SwarmMetrics {
  tokenThroughputPerSec: number;    // running 30s average
  averageLatencyMs: number;         // rolling average of last N calls
  queueDepth: number;               // pending model calls
  timeoutRate: number;              // 0.0–1.0 (fraction of calls timing out)
  evictionCount: number;            // model evictions in last 5 minutes
  activeModel: string | null;       // currently loaded model tag
  loadedModelCount: number;         // 0–2
  maxLoadedModels: number;          // from OLLAMA env
}

export interface SwarmPressureSnapshot {
  ts: number;
  memory: MemorySnapshot;
  metrics: SwarmMetrics;
  phase: SwarmPhase;
  topology: SwarmTopology;
  degraded: boolean;
  degradeReasons: string[];
  evolverConstraints: EvolverConstraints;
}

export interface EvolverConstraints {
  reduceMutationBreadth: boolean;
  reduceIterations: boolean;
  summarizeTraces: boolean;
  skipValidatePhase: boolean;
  maxMutationsPerRun: number;
}

// ─── In-memory ring buffers for rolling metrics ───────────────────────────────

const LATENCY_RING_SIZE  = 50;
const TIMEOUT_RING_SIZE  = 100;
const TOKEN_RING_WINDOW  = 30_000; // 30-second window

interface LatencyRecord {
  ms: number;
  ts: number;
}

interface TokenRecord {
  count: number;
  ts: number;
}

interface TimeoutRecord {
  timedOut: boolean;
  ts: number;
}

const latencyRing: LatencyRecord[]  = [];
const tokenRing: TokenRecord[]      = [];
const timeoutRing: TimeoutRecord[]  = [];
let   evictionLog: number[]         = [];  // timestamps of evictions
let   currentPhase: SwarmPhase      = "idle";
let   activeModel: string | null    = null;
let   loadedModelCount              = 0;
let   queueDepth                    = 0;

// ─── Metric recording API ─────────────────────────────────────────────────────

export function recordLatency(ms: number): void {
  latencyRing.push({ ms, ts: Date.now() });
  if (latencyRing.length > LATENCY_RING_SIZE) latencyRing.shift();
}

export function recordTokens(count: number): void {
  tokenRing.push({ count, ts: Date.now() });
  // Prune records outside 30s window
  const cutoff = Date.now() - TOKEN_RING_WINDOW;
  while (tokenRing.length > 0 && tokenRing[0]!.ts < cutoff) tokenRing.shift();
}

export function recordTimeout(timedOut: boolean): void {
  timeoutRing.push({ timedOut, ts: Date.now() });
  if (timeoutRing.length > TIMEOUT_RING_SIZE) timeoutRing.shift();
}

export function recordEviction(): void {
  const now = Date.now();
  evictionLog.push(now);
  // Keep only last 5 minutes
  const cutoff = now - 5 * 60_000;
  evictionLog = evictionLog.filter((t) => t > cutoff);
}

export function setPhase(phase: SwarmPhase): void {
  currentPhase = phase;
}

export function setActiveModel(tag: string | null): void {
  activeModel = tag;
}

export function setLoadedModelCount(count: number): void {
  loadedModelCount = count;
}

export function setQueueDepth(depth: number): void {
  queueDepth = depth;
}

// ─── Memory reading (WSL2 /proc/meminfo) ─────────────────────────────────────

function readMemInfo(): Partial<Record<string, number>> {
  try {
    const content = readFileSync("/proc/meminfo", "utf8");
    const result: Record<string, number> = {};
    for (const line of content.split("\n")) {
      const match = line.match(/^(\w+):\s+(\d+)\s+kB/);
      if (match) result[match[1]!] = Number(match[2]) / 1024; // → MB
    }
    return result;
  } catch {
    return {};
  }
}

function readZramUsedMb(): number {
  try {
    const content = readFileSync("/sys/block/zram0/mm_stat", "utf8");
    const bytes = Number(content.trim().split(/\s+/)[1] ?? "0");
    return Math.floor(bytes / 1_048_576);
  } catch {
    // Try sysfs alternative or return 0
    try {
      const stat = readFileSync("/proc/swaps", "utf8");
      const zramLine = stat.split("\n").find((l) => l.includes("zram"));
      if (zramLine) {
        const usedKb = Number(zramLine.split(/\s+/)[3] ?? "0");
        return Math.floor(usedKb / 1024);
      }
    } catch { /* ignore */ }
    return 0;
  }
}

function buildMemorySnapshot(): MemorySnapshot {
  const info = readMemInfo();
  const totalMb     = info["MemTotal"]     ?? 7_820;
  const freeMb      = info["MemFree"]      ?? 2_000;
  const availableMb = info["MemAvailable"] ?? 2_500;
  const usedMb      = totalMb - freeMb;
  const swapTotal   = info["SwapTotal"]    ?? 17_000;
  const swapFree    = info["SwapFree"]     ?? 17_000;
  const swapUsedMb  = swapTotal - swapFree;
  const zramUsedMb  = readZramUsedMb();

  // Pressure score: 0.0 = plenty of headroom, 1.0 = critical
  // Weighted: available RAM (60%), swap pressure (25%), zRAM (15%)
  const ramScore  = Math.max(0, 1.0 - availableMb / 4_000);
  const swapScore = swapTotal > 0 ? Math.min(1.0, swapUsedMb / (swapTotal * 0.4)) : 0;
  const zramScore = Math.min(1.0, zramUsedMb / 3_000);
  const pressureScore = Math.min(1.0, ramScore * 0.60 + swapScore * 0.25 + zramScore * 0.15);

  return { totalMb, usedMb, freeMb, availableMb, swapUsedMb, swapTotalMb: swapTotal, zramUsedMb, pressureScore };
}

// ─── Rolling metric calculations ─────────────────────────────────────────────

function calcAverageLatencyMs(): number {
  if (latencyRing.length === 0) return 0;
  const sum = latencyRing.reduce((acc, r) => acc + r.ms, 0);
  return Math.round(sum / latencyRing.length);
}

function calcTokenThroughput(): number {
  if (tokenRing.length < 2) return 0;
  const now     = Date.now();
  const cutoff  = now - TOKEN_RING_WINDOW;
  const recent  = tokenRing.filter((r) => r.ts > cutoff);
  if (recent.length === 0) return 0;
  const total   = recent.reduce((acc, r) => acc + r.count, 0);
  const windowS = Math.min(TOKEN_RING_WINDOW, now - recent[0]!.ts) / 1000;
  return windowS > 0 ? Math.round(total / windowS) : 0;
}

function calcTimeoutRate(): number {
  if (timeoutRing.length === 0) return 0;
  const timedOut = timeoutRing.filter((r) => r.timedOut).length;
  return timedOut / timeoutRing.length;
}

function calcEvictionCount(): number {
  return evictionLog.length;
}

function buildSwarmMetrics(): SwarmMetrics {
  const maxLoaded = Number.parseInt(process.env["OLLAMA_MAX_LOADED_MODELS"] ?? "1", 10);
  return {
    tokenThroughputPerSec: calcTokenThroughput(),
    averageLatencyMs:      calcAverageLatencyMs(),
    queueDepth,
    timeoutRate:           calcTimeoutRate(),
    evictionCount:         calcEvictionCount(),
    activeModel,
    loadedModelCount,
    maxLoadedModels:       maxLoaded,
  };
}

// ─── Topology recommendation — arch review §9 ────────────────────────────────
//
// Under pressure: triad → duo → supervisor_only → rule_engine

export function recommendedTopology(snap: SwarmPressureSnapshot): SwarmTopology {
  const { memory, metrics } = snap;

  // Rule engine: extreme pressure or Ollama unreachable
  if (memory.availableMb < 800 || metrics.timeoutRate > 0.6) {
    return "rule_engine";
  }

  // Supervisor only: high pressure with frequent evictions
  if (memory.availableMb < 1_400 || metrics.evictionCount > 8) {
    return "supervisor_only";
  }

  // Duo: moderate pressure (save critic overhead)
  if (memory.pressureScore > 0.65 || metrics.queueDepth > 5) {
    return "duo";
  }

  // Full triad: system healthy
  return "full_triad";
}

// ─── Evolver constraints under pressure — arch review §9 ─────────────────────

function buildEvolverConstraints(memory: MemorySnapshot, topology: SwarmTopology): EvolverConstraints {
  const pressure = memory.pressureScore;

  if (topology === "rule_engine" || pressure > 0.85) {
    return {
      reduceMutationBreadth: true,
      reduceIterations:      true,
      summarizeTraces:       true,
      skipValidatePhase:     true,
      maxMutationsPerRun:    1,
    };
  }

  if (topology === "supervisor_only" || pressure > 0.65) {
    return {
      reduceMutationBreadth: true,
      reduceIterations:      true,
      summarizeTraces:       true,
      skipValidatePhase:     false,
      maxMutationsPerRun:    2,
    };
  }

  if (topology === "duo" || pressure > 0.45) {
    return {
      reduceMutationBreadth: false,
      reduceIterations:      true,
      summarizeTraces:       false,
      skipValidatePhase:     false,
      maxMutationsPerRun:    3,
    };
  }

  return {
    reduceMutationBreadth: false,
    reduceIterations:      false,
    summarizeTraces:       false,
    skipValidatePhase:     false,
    maxMutationsPerRun:    5,
  };
}

// ─── Degrade reason accumulator ───────────────────────────────────────────────

function buildDegradeReasons(memory: MemorySnapshot, metrics: SwarmMetrics, topology: SwarmTopology): string[] {
  const reasons: string[] = [];

  if (memory.availableMb < 1_500) reasons.push(`low_ram: ${memory.availableMb}MB available`);
  if (memory.swapUsedMb > 2_000)  reasons.push(`high_swap: ${memory.swapUsedMb}MB used`);
  if (memory.zramUsedMb > 2_000)  reasons.push(`high_zram: ${memory.zramUsedMb}MB used`);
  if (metrics.timeoutRate > 0.2)  reasons.push(`timeout_rate: ${(metrics.timeoutRate * 100).toFixed(0)}%`);
  if (metrics.evictionCount > 4)  reasons.push(`evictions: ${metrics.evictionCount} in 5min`);
  if (metrics.queueDepth > 3)     reasons.push(`queue_depth: ${metrics.queueDepth}`);
  if (topology !== "full_triad")  reasons.push(`topology_downgrade: ${topology}`);

  return reasons;
}

// ─── Primary API: get current swarm pressure snapshot ────────────────────────

let _lastSnapshot: SwarmPressureSnapshot | null = null;
let _lastSnapshotTs = 0;
const SNAPSHOT_TTL_MS = 3_000;

export function getSwarmPressure(forceRefresh = false): SwarmPressureSnapshot {
  const now = Date.now();
  if (!forceRefresh && _lastSnapshot && now - _lastSnapshotTs < SNAPSHOT_TTL_MS) {
    return _lastSnapshot;
  }

  const memory  = buildMemorySnapshot();
  const metrics = buildSwarmMetrics();

  // Bootstrap topology from metrics before degrade reasons
  const preliminary: SwarmPressureSnapshot = {
    ts:                now,
    memory,
    metrics,
    phase:             currentPhase,
    topology:          "full_triad",
    degraded:          false,
    degradeReasons:    [],
    evolverConstraints: buildEvolverConstraints(memory, "full_triad"),
  };
  const topology = recommendedTopology(preliminary);
  const degradeReasons = buildDegradeReasons(memory, metrics, topology);
  const evolverConstraints = buildEvolverConstraints(memory, topology);

  _lastSnapshot = {
    ts:                now,
    memory,
    metrics,
    phase:             currentPhase,
    topology,
    degraded:          topology !== "full_triad",
    degradeReasons,
    evolverConstraints,
  };
  _lastSnapshotTs = now;
  return _lastSnapshot;
}

// ─── Background poller ────────────────────────────────────────────────────────
//
// Polls every 10s and emits to SSE broadcaster if pressure changes.

type BroadcastFn = (event: string, data: unknown) => void;

let _pollerInterval: ReturnType<typeof setInterval> | null = null;
let _lastTopology: SwarmTopology | null = null;

export function startSwarmMonitor(
  broadcastFn?: BroadcastFn,
  pollIntervalMs = 10_000,
): () => void {
  if (_pollerInterval) clearInterval(_pollerInterval);

  _pollerInterval = setInterval(() => {
    try {
      const snap = getSwarmPressure(true);

      // Broadcast topology changes immediately
      if (snap.topology !== _lastTopology) {
        console.info(
          `[swarm-monitor] TOPOLOGY_CHANGE ${_lastTopology ?? "init"} → ${snap.topology}` +
          (snap.degradeReasons.length ? ` reasons=[${snap.degradeReasons.join(", ")}]` : ""),
        );
        _lastTopology = snap.topology;
        broadcastFn?.("swarm:topology_change", {
          topology: snap.topology,
          degraded: snap.degraded,
          reasons:  snap.degradeReasons,
          memory: {
            availableMb:   snap.memory.availableMb,
            pressureScore: snap.memory.pressureScore,
          },
        });
      }

      // Broadcast periodic health snapshot (for dashboard)
      broadcastFn?.("swarm:health", {
        ts:             snap.ts,
        topology:       snap.topology,
        degraded:       snap.degraded,
        phase:          snap.phase,
        availableMb:    snap.memory.availableMb,
        pressureScore:  snap.memory.pressureScore,
        swapUsedMb:     snap.memory.swapUsedMb,
        zramUsedMb:     snap.memory.zramUsedMb,
        timeoutRate:    snap.metrics.timeoutRate,
        evictionCount:  snap.metrics.evictionCount,
        queueDepth:     snap.metrics.queueDepth,
        avgLatencyMs:   snap.metrics.averageLatencyMs,
        tokenThroughput:snap.metrics.tokenThroughputPerSec,
        activeModel:    snap.metrics.activeModel,
      });
    } catch (err) {
      console.error("[swarm-monitor] poll error:", err);
    }
  }, pollIntervalMs);

  // Return stop function
  return () => {
    if (_pollerInterval) {
      clearInterval(_pollerInterval);
      _pollerInterval = null;
    }
  };
}

// ─── Dashboard-ready summary ─────────────────────────────────────────────────

export function getSwarmHealthSummary(): {
  status:        "healthy" | "degraded" | "critical";
  topology:      SwarmTopology;
  phase:         SwarmPhase;
  availableRamMb:number;
  pressureScore: number;
  activeModel:   string | null;
  timeoutRate:   number;
  queueDepth:    number;
  degradeReasons:string[];
  evolverReduceBreadth: boolean;
} {
  const snap = getSwarmPressure();
  let status: "healthy" | "degraded" | "critical" = "healthy";
  if (snap.topology === "rule_engine" || snap.memory.availableMb < 800) {
    status = "critical";
  } else if (snap.degraded) {
    status = "degraded";
  }

  return {
    status,
    topology:       snap.topology,
    phase:          snap.phase,
    availableRamMb: snap.memory.availableMb,
    pressureScore:  snap.memory.pressureScore,
    activeModel:    snap.metrics.activeModel,
    timeoutRate:    snap.metrics.timeoutRate,
    queueDepth:     snap.metrics.queueDepth,
    degradeReasons: snap.degradeReasons,
    evolverReduceBreadth: snap.evolverConstraints.reduceMutationBreadth,
  };
}

// ─── Exports summary ─────────────────────────────────────────────────────────
//
//  getSwarmPressure(forceRefresh?)  → SwarmPressureSnapshot
//  recommendedTopology(snap)        → SwarmTopology
//  getSwarmHealthSummary()          → health object for dashboard
//  startSwarmMonitor(broadcastFn?)  → stop() function
//  recordLatency(ms)                → void
//  recordTokens(count)              → void
//  recordTimeout(timedOut)          → void
//  recordEviction()                 → void
//  setPhase(phase)                  → void
//  setActiveModel(tag)              → void
//  setLoadedModelCount(count)       → void
//  setQueueDepth(depth)             → void
