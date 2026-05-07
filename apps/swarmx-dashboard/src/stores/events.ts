"use client";

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type {
  AgentState,
  AgentStatus,
  ControlPlaneLayer,
  LogEntry,
  QueueMetrics,
  SystemMetricsSnapshot,
  SwarmXEvent,
  CgroupScopeMetrics,
  WorkflowEventData,
  WorkflowRunState,
  RuntimeGovernorSnapshot,
  StartupSummary,
} from "@swarmx/types";

const MAX_LOG_ENTRIES = 10_000;
const STALE_THRESHOLD_MS = 5_000;
// [V5.9-ENH-08] Map size caps — prevent unbounded growth in long-running sessions
const MAX_AGENTS = 500;
const MAX_WORKFLOW_RUNS = 200;
const MAX_CGROUP_SCOPES = 200;

type SSEConnectionStatus = "connecting" | "connected" | "disconnected";

interface SparklinePoint {
  value: number;
  timestamp: number;
}

interface EventsState {
  // Connection
  connectionStatus: SSEConnectionStatus;
  lastEventAt: number | null;
  isStale: boolean;

  // Agent fleet
  agents: Map<string, AgentState>;

  // System metrics (latest snapshot)
  systemMetrics: SystemMetricsSnapshot | null;

  // Metric history for sparklines (last 60 points @ 1s interval)
  cpuHistory: SparklinePoint[];
  memHistory: SparklinePoint[];
  diskReadHistory: SparklinePoint[];
  diskWriteHistory: SparklinePoint[];
  netRxHistory: SparklinePoint[];
  netTxHistory: SparklinePoint[];

  // BullMQ queues
  queues: Map<string, QueueMetrics>;

  // Control plane layers
  controlPlaneLayers: Map<string, ControlPlaneLayer>;

  // cgroup scopes
  cgroupScopes: Map<string, CgroupScopeMetrics>;

  // Unified log stream
  logs: LogEntry[];

  // Workflow lifecycle
  workflowRuns: Map<string, WorkflowRunState>;

  // V5 Swarm Coherence Score
  scsScore: number | null;
  scsHistory: number[];

  // [V5.9-ENH-05] Runtime governor: pressure level, concurrency, token ceilings
  governorState: RuntimeGovernorSnapshot | null;

  // [V6.1-ENH-01] Startup autopilot summary — populated once per process launch
  startupSummary: StartupSummary | null;

  // Derived
  errorAgentCount: number;
  activeAgentCount: number;
  totalAgentCount: number;
}

interface EventsActions {
  handleEvent: (event: SwarmXEvent) => void;
  setConnectionStatus: (status: SSEConnectionStatus) => void;
  checkStale: () => void;
}

type EventsPatch = Partial<EventsState> & Pick<EventsState, "lastEventAt" | "isStale">;
type ScsEventData = Extract<SwarmXEvent, { type: "system:scs" }>["data"];
type LogEventData = Extract<SwarmXEvent, { type: "log:entry" }>["data"];

const LIFECYCLE_LOG_UNIT = "swarmx-runtime";

function logFingerprint(entry: Pick<LogEntry, "level" | "message" | "timestamp"> & { unit?: string; agentId?: string | null }): string {
  return [
    entry.timestamp,
    entry.level,
    entry.unit ?? "",
    entry.agentId ?? "",
    entry.message,
  ].join("|");
}

function appendLog(state: EventsState, entry: LogEntry): EventsPatch {
  const fingerprint = logFingerprint(entry);
  const isDuplicate = state.logs.slice(-200).some((existing) => logFingerprint(existing) === fingerprint);
  if (isDuplicate) {
    return freshPatch({});
  }

  const logs =
    state.logs.length >= MAX_LOG_ENTRIES
      ? [...state.logs.slice(1), entry]
      : [...state.logs, entry];

  return freshPatch({ logs });
}

function lifecycleLogData(event: SwarmXEvent): LogEventData | null {
  switch (event.type) {
    case "mission:created":
      return {
        timestamp: event.data.timestamp,
        level: "info",
        unit: LIFECYCLE_LOG_UNIT,
        message: `mission created · ${event.data.target}`,
      };
    case "run:started":
      return {
        timestamp: event.data.timestamp,
        level: "info",
        unit: LIFECYCLE_LOG_UNIT,
        message: `run started · ${event.data.target}`,
      };
    case "run:completed":
      return {
        timestamp: event.data.timestamp,
        level: event.data.status === "success" || event.data.status === "partial" ? "notice" : "error",
        unit: LIFECYCLE_LOG_UNIT,
        message: `run ${event.data.status} · ${event.data.runId}`,
      };
    case "task:start":
      return {
        timestamp: event.data.timestamp,
        level: "info",
        unit: LIFECYCLE_LOG_UNIT,
        message: `task start${event.data.stepIndex != null ? ` #${event.data.stepIndex}` : ""} · ${event.data.goal}`,
      };
    case "task:complete":
      return {
        timestamp: event.data.timestamp,
        level: "notice",
        unit: LIFECYCLE_LOG_UNIT,
        message: `task complete${event.data.stepIndex != null ? ` #${event.data.stepIndex}` : ""} · ${event.data.goal}`,
      };
    case "task:failed":
      return {
        timestamp: event.data.timestamp,
        level: "error",
        unit: LIFECYCLE_LOG_UNIT,
        message: `task failed${event.data.stepIndex != null ? ` #${event.data.stepIndex}` : ""} · ${event.data.goal}`,
      };
    case "evolution:started":
      return {
        timestamp: event.data.timestamp,
        level: "info",
        unit: LIFECYCLE_LOG_UNIT,
        message: `evolution started${event.data.repo ? ` · ${event.data.repo}` : ""}`,
      };
    case "evolution:completed":
      return {
        timestamp: event.data.timestamp,
        level: "notice",
        unit: LIFECYCLE_LOG_UNIT,
        message: `evolution completed${event.data.proposalCount != null ? ` · ${event.data.proposalCount} proposal${event.data.proposalCount === 1 ? "" : "s"}` : ""}`,
      };
    case "worker:job_started":
      return {
        timestamp: event.data.timestamp,
        level: "info",
        unit: LIFECYCLE_LOG_UNIT,
        message: `worker job started · ${event.data.kind ?? "task"}${event.data.target ? ` · ${event.data.target}` : ""}`,
      };
    case "worker:job_done":
      return {
        timestamp: event.data.timestamp,
        level: "notice",
        unit: LIFECYCLE_LOG_UNIT,
        message: `worker job done · ${event.data.jobId}`,
      };
    case "worker:job_error":
      return {
        timestamp: event.data.timestamp,
        level: "error",
        unit: LIFECYCLE_LOG_UNIT,
        message: `worker job error · ${event.data.jobId}${event.data.error ? ` · ${event.data.error}` : ""}`,
      };
    default:
      return null;
  }
}

function applyWorkflowEvent(state: EventsState, data: WorkflowEventData): EventsPatch {
  const workflowRuns = new Map(state.workflowRuns);
  const previous = workflowRuns.get(data.workflowId);

  workflowRuns.set(data.workflowId, {
    runId: data.id,
    workflowId: data.workflowId,
    correlationId: data.correlationId,
    status: data.status,
    createdAt: previous?.createdAt ?? data.timestamp,
    updatedAt: data.timestamp,
    error: data.error ?? null,
    result: previous?.result,
    ...(previous?.target !== undefined ? { target: previous.target } : {}),
  });

  // [V5.9-ENH-08] Cap workflow run Map size by updatedAt (handles ISO string or numeric)
  const pruned = pruneMap(workflowRuns, MAX_WORKFLOW_RUNS, (r) => new Date(r.updatedAt).getTime() || 0);
  return freshPatch({ workflowRuns: pruned });
}

function pushHistory(
  history: SparklinePoint[],
  value: number,
  timestamp: number,
  maxLen = 60
): SparklinePoint[] {
  const next = [...history, { value, timestamp }];
  return next.length > maxLen ? next.slice(next.length - maxLen) : next;
}

function countsByStatus(agents: Map<string, AgentState>) {
  let error = 0;
  let active = 0;
  for (const a of agents.values()) {
    if (a.status === "error" || a.status === "fatal" || a.status === "failed" || a.status === "failed_permanent" || a.status === "oom_killed" || a.status === "oom" || a.status === "killed") error++;
    if (a.status === "active" || a.status === "running") active++;
  }
  return { error, active, total: agents.size };
}

function freshPatch(patch: Partial<EventsState>): EventsPatch {
  return {
    lastEventAt: Date.now(),
    isStale: false,
    ...patch,
  };
}

// [V5.9-ENH-08] Generic Map pruning: if size > max, remove the oldest entries by a
// timestamp accessor. Falls back to removing the first-inserted keys when no ts accessor.
function pruneMap<V>(
  map: Map<string, V>,
  max: number,
  tsAccessor?: (v: V) => number
): Map<string, V> {
  if (map.size <= max) return map;
  const entries = [...map.entries()];
  const sorted = tsAccessor
    ? entries.sort((a, b) => tsAccessor(a[1]) - tsAccessor(b[1]))
    : entries;
  const trimmed = sorted.slice(entries.length - max);
  return new Map(trimmed);
}

function applyAgentUpdate(state: EventsState, incoming: AgentState): EventsPatch {
  const agents = new Map(state.agents);
  const existing = agents.get(incoming.id);
  agents.set(incoming.id, {
    ...existing,
    ...incoming,
    systemdState: statusToSystemdState(incoming.status),
    systemdUnit: existing?.systemdUnit ?? `swarmx-agent-${incoming.id}.service`,
    cgroupPath: existing?.cgroupPath ?? `/sys/fs/cgroup/swarmx.slice/agent-${incoming.id}.scope`,
    resource: incoming.resource ?? incoming.resources ?? existing?.resource ?? null,
    oomCount: incoming.oomCount ?? existing?.oomCount ?? 0,
    skillTags: incoming.skillTags ?? existing?.skillTags ?? [],
    outputs: incoming.outputs ?? existing?.outputs ?? [],
  });
  // [V5.9-ENH-08] Prune by last-seen timestamp to cap agent Map size
  const pruned = pruneMap(agents, MAX_AGENTS, (a) => a.lastActive ?? 0);
  const { error, active, total } = countsByStatus(pruned);
  return freshPatch({ agents: pruned, errorAgentCount: error, activeAgentCount: active, totalAgentCount: total });
}

function applyAgentRemoval(state: EventsState, agentId: string): EventsPatch {
  const agents = new Map(state.agents);
  agents.delete(agentId);
  const { error, active, total } = countsByStatus(agents);
  return freshPatch({ agents, errorAgentCount: error, activeAgentCount: active, totalAgentCount: total });
}

function applyQueueMetrics(state: EventsState, queue: QueueMetrics): EventsPatch {
  const queues = new Map(state.queues);
  queues.set(queue.name, queue);
  return freshPatch({ queues });
}

function applyQueueDrained(state: EventsState, queueName: string): EventsPatch {
  const queues = new Map(state.queues);
  const existing = queues.get(queueName);
  if (existing) {
    queues.set(queueName, { ...existing, waiting: 0, active: 0 });
  }
  return freshPatch({ queues });
}

function applySystemMetrics(state: EventsState, snap: SystemMetricsSnapshot): EventsPatch {
  const ts = typeof snap.timestamp === "number" ? snap.timestamp : Date.now();
  const perCore = snap.cpu.perCorePercent ?? snap.cpu.perCore ?? [];
  const avgCpu =
    perCore.length > 0
      ? perCore.reduce((left: number, right: number) => left + right, 0) / perCore.length
      : snap.cpu.load1m;
  const memPct = snap.memory.totalMb > 0 ? (snap.memory.usedMb / snap.memory.totalMb) * 100 : 0;
  const metrics: SystemMetricsSnapshot = {
    ...snap,
    timestamp: ts,
    cpu: {
      load1m: snap.cpu.load1m,
      load5m: snap.cpu.load5m,
      load15m: snap.cpu.load15m,
      perCore,
      // [V5.9-FIX-02] Parenthesize fallback chain so esbuild accepts mixed nullish/or logic.
      coreCount: snap.cpu.coreCount ?? (perCore.length || 1),
      temperatureCelsius: snap.cpu.temperatureCelsius ?? null,
    },
    memory: {
      totalMb: snap.memory.totalMb,
      usedMb: snap.memory.usedMb,
      swarmxSliceMb: snap.memory.swarmxSliceMb,
      swarmxSliceLimitMb: snap.memory.swarmxSliceLimitMb ?? null,
    },
    disk: {
      readBytesPerSec: snap.disk.readBytesPerSec,
      writeBytesPerSec: snap.disk.writeBytesPerSec,
      usedPercent: snap.disk.usedPercent ?? snap.disk.utilizationPercent ?? 0,
    },
    network: {
      rxBytesPerSec: snap.network.rxBytesPerSec,
      txBytesPerSec: snap.network.txBytesPerSec,
      interfaceName: snap.network.interfaceName ?? "eth0",
    },
  };

  return freshPatch({
    systemMetrics: metrics,
    cpuHistory: pushHistory(state.cpuHistory, avgCpu, ts),
    memHistory: pushHistory(state.memHistory, memPct, ts),
    diskReadHistory: pushHistory(state.diskReadHistory, snap.disk.readBytesPerSec, ts),
    diskWriteHistory: pushHistory(state.diskWriteHistory, snap.disk.writeBytesPerSec, ts),
    netRxHistory: pushHistory(state.netRxHistory, snap.network.rxBytesPerSec, ts),
    netTxHistory: pushHistory(state.netTxHistory, snap.network.txBytesPerSec, ts),
  });
}

function applyScsSnapshot(state: EventsState, scs: ScsEventData): EventsPatch {
  const score = typeof scs.score === "number" ? scs.score : 0;
  return freshPatch({
    scsScore: score,
    scsHistory: scs.history ?? [...state.scsHistory, score].slice(-20),
  });
}

// [V5.9-ENH-05] Governor snapshot reducer
function applyGovernorSnapshot(_state: EventsState, snap: RuntimeGovernorSnapshot): EventsPatch {
  return freshPatch({ governorState: snap });
}

// [V6.1-ENH-01] Startup summary reducer
function applyStartupSummary(_state: EventsState, data: StartupSummary): EventsPatch {
  return freshPatch({ startupSummary: data });
}

function applySystemOom(state: EventsState, agentId: string, count: number): EventsPatch {
  const agents = new Map(state.agents);
  const existing = agents.get(agentId);
  if (existing) {
    agents.set(agentId, {
      ...existing,
      oomCount: count,
      status: "oom_killed",
    });
  }
  const { error, active, total } = countsByStatus(agents);
  return freshPatch({ agents, errorAgentCount: error, activeAgentCount: active, totalAgentCount: total });
}

function applyCgroupMetrics(state: EventsState, scope: CgroupScopeMetrics): EventsPatch {
  const cgroupScopes = new Map(state.cgroupScopes);
  cgroupScopes.set(scope.agentId ?? scope.path, scope);
  // [V5.9-ENH-08] Cap cgroup scope Map size
  const pruned = pruneMap(cgroupScopes, MAX_CGROUP_SCOPES);
  return freshPatch({ cgroupScopes: pruned });
}

function applyLogEntry(state: EventsState, data: LogEventData): EventsPatch {
  const entry: LogEntry = {
    id: `log-${String(data.timestamp)}-${data.level}-${data.message}`,
    level: data.level,
    message: data.message,
    timestamp: data.timestamp,
    pid: null,
    raw: data.message,
  };
  if (data.agentId) {
    entry.agentId = data.agentId;
  }
  if (data.unit) {
    entry.unit = data.unit;
  }
  if (data.agentId) {
    entry.agentId = data.agentId;
  }
  return appendLog(state, entry);
}

function reduceEvent(state: EventsState, event: SwarmXEvent): EventsPatch {
  switch (event.type) {
    case "agent:update":
      return applyAgentUpdate(state, event.data);
    case "agent:remove":
      return applyAgentRemoval(state, event.data.id);
    case "queue:metrics":
      return applyQueueMetrics(state, event.data);
    case "queue:drained":
      return applyQueueDrained(state, event.data.name);
    case "system:metrics":
      return applySystemMetrics(state, event.data);
    case "system:scs":
      return applyScsSnapshot(state, event.data);
    case "system:governor":
      return applyGovernorSnapshot(state, event.data);
    case "system:startup":
      return applyStartupSummary(state, event.data);
    case "system:oom":
      return applySystemOom(state, event.data.agentId, event.data.count);
    case "cgroup:metrics":
      return applyCgroupMetrics(state, event.data);
    case "log:entry":
      return applyLogEntry(state, event.data);
    case "mission:created":
    case "run:started":
    case "run:completed":
    case "task:start":
    case "task:complete":
    case "task:failed":
    case "evolution:started":
    case "evolution:completed":
    case "worker:job_started":
    case "worker:job_done":
    case "worker:job_error": {
      const logData = lifecycleLogData(event);
      return logData ? applyLogEntry(state, logData) : freshPatch({});
    }
    case "workflow:started":
    case "workflow:completed":
    case "workflow:failed":
    case "workflow:cancelled":
      return applyWorkflowEvent(state, event.data);
    case "control:pause":
    case "control:resume":
    default:
      return freshPatch({});
  }
}

export const useEventsStore = create<EventsState & EventsActions>()(
  subscribeWithSelector((set, get) => ({
    connectionStatus: "connecting",
    lastEventAt: null,
    isStale: false,
    agents: new Map(),
    systemMetrics: null,
    cpuHistory: [],
    memHistory: [],
    diskReadHistory: [],
    diskWriteHistory: [],
    netRxHistory: [],
    netTxHistory: [],
    queues: new Map(),
    controlPlaneLayers: new Map(),
    cgroupScopes: new Map(),
    logs: [],
    workflowRuns: new Map(),
    errorAgentCount: 0,
    activeAgentCount: 0,
    totalAgentCount: 0,
    scsScore: null,
    scsHistory: [],
    governorState: null,
    startupSummary: null,

    setConnectionStatus: (status) => set({ connectionStatus: status }),

    checkStale: () => {
      const { lastEventAt } = get();
      const stale =
        lastEventAt !== null && Date.now() - lastEventAt > STALE_THRESHOLD_MS;
      set({ isStale: stale });
    },

    handleEvent: (event) => {
      set((state) => reduceEvent(state, event));
    },
  }))
);

function statusToSystemdState(status: AgentStatus): import("@swarmx/types").SystemdUnitState {
  switch (status) {
    case "active": return "active";
    case "activating": return "activating";
    case "deactivating": return "deactivating";
    case "idle": return "inactive";
    case "failed":
    case "failed_permanent":
    case "oom_killed":
      return "failed";
    case "reloading": return "reloading";
    default: return "inactive";
  }
}
