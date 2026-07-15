/**
 * swarm-pressure-monitor.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * SwarmX Swarm Pressure Monitor — Architecture Review §9 Implementation
 * Version : v2026.5.24-apex17-r4
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
 * Fixes in r4:
 *   [SPM-01] readMemInfo() and readZramUsedMb() converted from readFileSync
 *            to fs/promises.readFile. The previous synchronous reads blocked
 *            the Node.js event loop on every poll cycle inside setInterval.
 *            On a CPU-bound 4-core system, each /proc/meminfo read (typically
 *            < 100μs) adds a synchronous pause that delays in-flight request
 *            handlers and SSE flush operations. The async variants are used
 *            only from the background poller; getSwarmPressure() retains its
 *            synchronous TTL-cached public API so callers do not need changes.
 *            Implementation: _refreshCacheAsync() is a new private async
 *            function that reads procfs and updates _lastSnapshot. The poller
 *            calls this via an async IIFE inside setInterval; getSwarmPressure()
 *            returns the last cached snapshot synchronously, falling back to
 *            a safe "normal" defaults snapshot if called before the first
 *            async refresh completes.
 *   [SPM-02] setInterval interval timer now calls .unref() so the Node.js
 *            event loop does not hold the process open if server.close() is
 *            called but stop() is not. Previously, if shutdown sequencing
 *            failed to call stopSwarmMonitor() before process.exit(), the
 *            interval kept the process alive past its intended lifetime.
 *            unref() is safe here: the poller is a non-critical background
 *            task and process.exit(0) is called explicitly on shutdown anyway.
 *   [SPM-03] stop() now clears _lastSnapshot and resets _lastSnapshotTs to 0.
 *            Previously, a stopped monitor would serve its last snapshot
 *            indefinitely through getSwarmPressure()'s TTL cache, meaning
 *            any code reading pressure after a restart (e.g. in tests or
 *            after a server hot-reload) would see stale data until TTL expired.
 *            After stop(), the next getSwarmPressure() call builds a fresh
 *            synchronous snapshot from procfs immediately.
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

import { readFileSync }        from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";

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

// ─── Memory reading — SYNC (used by sync getSwarmPressure fallback path) ──────
//
// [SPM-01] These sync variants are retained for the synchronous cold-start
// path only (first call to getSwarmPressure() before async cache is warm).
// The poller exclusively uses _readMemInfoAsync / _readZramUsedMbAsync below.

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

// ─── Memory reading — ASYNC (used by background poller) ──────────────────────
//
// [SPM-01] Async variants avoid blocking the event loop during the periodic
// cache refresh. /proc/meminfo and /sys/block/zram0/mm_stat are virtual
// procfs/sysfs files — readFile returns immediately after a kernel copy,
// so these are safe to issue concurrently via Promise.all.

async function _readMemInfoAsync(): Promise<Partial<Record<string, number>>> {
  try {
    const content = await readFileAsync("/proc/meminfo", "utf8");
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

async function _readZramUsedMbAsync(): Promise<number> {
  try {
    const content = await readFileAsync("/sys/block/zram0/mm_stat", "utf8");
    const bytes = Number(content.trim().split(/\s+/)[1] ?? "0");
    return Math.floor(bytes / 1_048_576);
  } catch {
    try {
      const stat = await readFileAsync("/proc/swaps", "utf8");
      const zramLine = stat.split("\n").find((l) => l.includes("zram"));
      if (zramLine) {
        const usedKb = Number(zramLine.split(/\s+/)[3] ?? "0");
        return Math.floor(usedKb / 1024);
      }
    } catch { /* ignore */ }
    return 0;
  }
}

// ─── Memory snapshot builders ─────────────────────────────────────────────────

function _makeMemorySnapshot(
  info:       Partial<Record<string, number>>,
  zramUsedMb: number,
): MemorySnapshot {
  const totalMb     = info["MemTotal"]     ?? 7_820;
  const freeMb      = info["MemFree"]      ?? 2_000;
  const availableMb = info["MemAvailable"] ?? 2_500;
  const usedMb      = totalMb - freeMb;
  const swapTotal   = info["SwapTotal"]    ?? 17_000;
  const swapFree    = info["SwapFree"]     ?? 17_000;
  const swapUsedMb  = swapTotal - swapFree;

  // Pressure score: 0.0 = plenty of headroom, 1.0 = critical
  // Weighted: available RAM (60%), swap pressure (25%), zRAM (15%)
  const ramScore  = Math.max(0, 1.0 - availableMb / 4_000);
  const swapScore = swapTotal > 0 ? Math.min(1.0, swapUsedMb / (swapTotal * 0.4)) : 0;
  const zramScore = Math.min(1.0, zramUsedMb / 3_000);
  const pressureScore = Math.min(1.0, ramScore * 0.60 + swapScore * 0.25 + zramScore * 0.15);

  return { totalMb, usedMb, freeMb, availableMb, swapUsedMb, swapTotalMb: swapTotal, zramUsedMb, pressureScore };
}

/** Synchronous — used only on cold-start before async poller warms the cache. */
function buildMemorySnapshot(): MemorySnapshot {
  return _makeMemorySnapshot(readMemInfo(), readZramUsedMb());
}

/** [SPM-01] Async — used exclusively by the background poller. */
async function buildMemorySnapshotAsync(): Promise<MemorySnapshot> {
  const [info, zramUsedMb] = await Promise.all([
    _readMemInfoAsync(),
    _readZramUsedMbAsync(),
  ]);
  return _makeMemorySnapshot(info, zramUsedMb);
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

// ─── Cache & snapshot builder ─────────────────────────────────────────────────

let _lastSnapshot: SwarmPressureSnapshot | null = null;
let _lastSnapshotTs = 0;
const SNAPSHOT_TTL_MS = 3_000;

function _buildSnapshotFromMemory(memory: MemorySnapshot): SwarmPressureSnapshot {
  const metrics    = buildSwarmMetrics();
  const preliminary: SwarmPressureSnapshot = {
    ts:                  Date.now(),
    memory,
    metrics,
    phase:               currentPhase,
    topology:            "full_triad",
    degraded:            false,
    degradeReasons:      [],
    evolverConstraints:  buildEvolverConstraints(memory, "full_triad"),
  };
  const topology          = recommendedTopology(preliminary);
  const degradeReasons    = buildDegradeReasons(memory, metrics, topology);
  const evolverConstraints = buildEvolverConstraints(memory, topology);

  return {
    ts:                  Date.now(),
    memory,
    metrics,
    phase:               currentPhase,
    topology,
    degraded:            topology !== "full_triad",
    degradeReasons,
    evolverConstraints,
  };
}

/**
 * [SPM-01] Async cache refresh — called exclusively by the background poller.
 * Reads procfs asynchronously and updates the module-level cached snapshot.
 * Never throws — all errors produce safe defaults.
 */
async function _refreshCacheAsync(): Promise<void> {
  try {
    const memory    = await buildMemorySnapshotAsync();
    const snapshot  = _buildSnapshotFromMemory(memory);
    _lastSnapshot   = snapshot;
    _lastSnapshotTs = snapshot.ts;
  } catch {
    // Leave _lastSnapshot unchanged; TTL-based stale reads are acceptable
    // for a few seconds until the next poll cycle.
  }
}

// ─── Primary API: get current swarm pressure snapshot ────────────────────────

/**
 * Returns the latest cached pressure snapshot synchronously.
 *
 * [SPM-01] Public API is sync to avoid breaking callers (getSwarmHealthSummary,
 * routes, composer). The background poller replenishes the cache via
 * _refreshCacheAsync(). On first call (before poller has run), falls back to
 * a synchronous procfs read to guarantee a non-null return value.
 *
 * TTL: 3 seconds. forceRefresh=true bypasses TTL and does a synchronous
 * rebuild from the last procfs read (cheap; uses in-memory ring data).
 */
export function getSwarmPressure(forceRefresh = false): SwarmPressureSnapshot {
  const now = Date.now();
  if (
    !forceRefresh &&
    _lastSnapshot !== null &&
    now - _lastSnapshotTs < SNAPSHOT_TTL_MS
  ) {
    return _lastSnapshot;
  }

  // Cold-start path or forceRefresh: build synchronously from procfs.
  // After the first async poll cycle, this path is never hit under normal ops.
  const memory   = buildMemorySnapshot();
  const snapshot = _buildSnapshotFromMemory(memory);
  _lastSnapshot   = snapshot;
  _lastSnapshotTs = snapshot.ts;
  return _lastSnapshot;
}

// ─── Background poller ────────────────────────────────────────────────────────
//
// Polls every pollIntervalMs (default 10s) using async I/O and emits to SSE
// broadcaster if pressure-relevant state changes.

type BroadcastFn = (event: string, data: unknown) => void;

let _pollerInterval: ReturnType<typeof setInterval> | null = null;
let _lastTopology: SwarmTopology | null = null;

/**
 * Start the background pressure monitor.
 * Returns a stop() function for use in server shutdown handlers.
 *
 * [SPM-01] setInterval callback is an async IIFE so procfs reads are
 *           non-blocking. Errors inside the IIFE are caught and logged.
 * [SPM-02] The interval is unref()'d so it does not hold the process open
 *           if server.close() is called and stop() is not explicitly invoked.
 * [SPM-03] stop() clears _lastSnapshot so the next getSwarmPressure() call
 *           builds a fresh snapshot rather than serving stale data.
 */
export function startSwarmMonitor(
  broadcastFn?: BroadcastFn,
  pollIntervalMs = 10_000,
): () => void {
  if (_pollerInterval) clearInterval(_pollerInterval);

  _pollerInterval = setInterval(() => {
    // [SPM-01] Async IIFE: procfs reads do not block the event loop
    (async () => {
      try {
        await _refreshCacheAsync();
        const snap = _lastSnapshot;
        if (!snap) return;

        // Broadcast topology changes immediately
        if (snap.topology !== _lastTopology) {
          console.info(
            `[swarm-monitor] TOPOLOGY_CHANGE ${_lastTopology ?? "init"} → ${snap.topology}` +
            (snap.degraded && snap.degradeReasons.length ? ` reasons=[${snap.degradeReasons.join(", ")}]` : ""),
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
    })();
  }, pollIntervalMs);

  // [SPM-02] unref() — poller does not hold the process open after server.close()
  _pollerInterval.unref();

  // Return stop function
  return () => {
    if (_pollerInterval) {
      clearInterval(_pollerInterval);
      _pollerInterval = null;
    }
    // [SPM-03] Reset snapshot so next getSwarmPressure() gets fresh data
    _lastSnapshot   = null;
    _lastSnapshotTs = 0;
    _lastTopology   = null;
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
//  getSwarmPressure(forceRefresh?)  → SwarmPressureSnapshot   (sync, TTL-cached)
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