/**
 * Shared event types for the SwarmX SSE stream.
 * These must stay in sync with the frontend @swarmx/types package.
 */

export type AgentStatus =
  | "idle"
  | "queued"
  | "running"
  | "activating"
  | "active"
  | "deactivating"
  | "success"
  | "error"
  | "fatal"
  | "failed"
  | "failed_permanent"
  | "oom_killed"
  | "oom"
  | "killed"
  | "throttled"
  | "reloading"
  | "reload"
  | "paused";

export interface AgentResources {
  cpuPercent: number;
  memoryMb: number;
  cpuThrottledPercent?: number;
  oomEvents?: number;
  ioReadBytes?: number;
  ioWriteBytes?: number;
}

export interface AgentState {
  id: string;
  name?: string;
  role?: string;
  model?: string;
  status: AgentStatus;
  currentTask?: string;
  lastError?: string;
  startedAt?: string;
  pid?: number;
  cgroupPath?: string;
  resources?: AgentResources;
}

export interface SystemCpuMetrics {
  load1m: number;
  load5m: number;
  load15m: number;
  coreCount: number;
  perCorePercent: number[];
}

export interface SystemMemoryMetrics {
  totalMb: number;
  usedMb: number;
  availableMb: number;
  swarmxSliceMb: number;
}

export interface SystemDiskMetrics {
  readBytesPerSec: number;
  writeBytesPerSec: number;
  utilizationPercent: number;
}

export interface SystemNetworkMetrics {
  rxBytesPerSec: number;
  txBytesPerSec: number;
}

export interface SystemMetricsSnapshot {
  timestamp: string;
  cpu: SystemCpuMetrics;
  memory: SystemMemoryMetrics;
  disk: SystemDiskMetrics;
  network: SystemNetworkMetrics;
}

export interface CgroupScopeMetrics {
  path: string;
  cpuPercent: number;
  memoryCurrentMb: number;
  cpuThrottledPct?: number;
  oomEvents: number;
  ioReadBytesPerSec?: number;
  ioWriteBytesPerSec?: number;
}

export interface QueueMetrics {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
}

export type LogLevel =
  | "debug"
  | "info"
  | "notice"
  | "warn"
  | "error"
  | "critical"
  | "alert"
  | "emergency";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  unit?: string;
  agentId?: string;
  traceId?: string;
}

export interface ScsSnapshot {
  score: number;
  history: number[];
  timestamp: string;
}

// [V5.9-ENH-05] Runtime governor snapshot — pressure level, concurrency, token ceilings
export type PressureLevel = "normal" | "high" | "critical";

export interface RuntimeGovernorSnapshot {
  pressureLevel: PressureLevel;
  availableMb: number;
  zramUsedPct: number;
  concurrencyLimit: number;
  observeOnly: boolean;
  tokenCeilings: Record<string, number>;
  timestamp: string;
}

// [V6.1-ENH-01] Startup autopilot summary — emitted once per process launch.
export interface StartupSummary {
  /** ISO-8601 UTC timestamp of autopilot completion */
  timestamp: string;
  /** Overall startup status */
  status: "ready" | "degraded" | "critical";
  /** Warm user-facing narrative */
  narrative: string;
  pressureLevel: PressureLevel;
  availableMb: number;
  zramUsedPct: number;
  concurrencyLimit: number;
  ollamaReachable: boolean;
  warmupDone: boolean;
  evolverSynced: boolean;
  evolverProposals: number;
  durationMs: number;
}

export type WorkflowEventStatus = "running" | "success" | "failed" | "cancelled";

export interface WorkflowEventData {
  id: string;
  workflowId: string;
  correlationId: string;
  status: WorkflowEventStatus;
  timestamp: string;
  name?: string;
  exitCode?: number;
  error?: string;
}

// [V5.9-FIX-05] Python lifecycle event payloads — bridged from swarmx journal to SSE.
// Aligned with EventKind constants added in event_bus.py.

export interface RunStartedData {
  jobId: string;
  repo: string;
  target: string;
  timestamp: string;
}

export interface RunCompletedData {
  jobId: string;
  runId: string;
  status: "success" | "partial" | "failed" | "error";
  timestamp: string;
}

export interface MissionCreatedData {
  missionId: string;
  repo: string;
  target: string;
  timestamp: string;
}

export interface TaskEventData {
  goal: string;
  stepIndex?: number;
  runId?: string;
  timestamp: string;
}

export interface EvolutionEventData {
  jobId: string;
  repo?: string;
  proposalCount?: number;
  timestamp: string;
}

export interface WorkerJobEventData {
  jobId: string;
  kind?: string;
  repo?: string;
  target?: string;
  error?: string;
  timestamp: string;
}

export type SwarmXEvent =
  | { type: "agent:update"; data: AgentState }
  | { type: "agent:remove"; data: { id: string } }
  | { type: "system:metrics"; data: SystemMetricsSnapshot }
  | { type: "system:scs"; data: ScsSnapshot }
  // [V5.9-ENH-05] Runtime governor: pressure level, concurrency, token ceilings
  | { type: "system:governor"; data: RuntimeGovernorSnapshot }
  // [V6.1-ENH-01] Startup autopilot summary — emitted once per process launch
  | { type: "system:startup"; data: StartupSummary }
  | { type: "system:alert"; data: { severity: "warn" | "critical"; message: string; source: string; timestamp: number } }
  | { type: "cgroup:metrics"; data: CgroupScopeMetrics }
  | { type: "queue:metrics"; data: QueueMetrics }
  | { type: "log:entry"; data: LogEntry }
  // [V5.9-ENH-02] Workflow lifecycle events share one typed payload with correlation metadata.
  | { type: "workflow:started"; data: WorkflowEventData }
  | { type: "workflow:completed"; data: WorkflowEventData }
  | { type: "workflow:failed"; data: WorkflowEventData }
  | { type: "workflow:cancelled"; data: WorkflowEventData }
  | { type: "queue:drained"; data: { name: string } }
  | { type: "system:oom"; data: { agentId: string; cgroupPath: string; count: number } }
  | { type: "control:pause"; data: Record<string, never> }
  | { type: "control:resume"; data: Record<string, never> }
  // [V5.9-FIX-05] Python event bridge — run, task, mission, evolution, worker job events
  | { type: "run:started";     data: RunStartedData }
  | { type: "run:completed";   data: RunCompletedData }
  | { type: "mission:created"; data: MissionCreatedData }
  | { type: "task:start";      data: TaskEventData }
  | { type: "task:complete";   data: TaskEventData }
  | { type: "task:failed";     data: TaskEventData }
  | { type: "evolution:started";   data: EvolutionEventData }
  | { type: "evolution:completed"; data: EvolutionEventData }
  | { type: "worker:job_started"; data: WorkerJobEventData }
  | { type: "worker:job_done";    data: WorkerJobEventData }
  | { type: "worker:job_error";   data: WorkerJobEventData };
