"use client";

import React, { useMemo } from "react";
import {
  RadialBarChart,
  RadialBar,
  AreaChart,
  Area,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { cn, formatPct, formatBps } from "@/lib/utils";
import { useEventsStore } from "@/stores/events";

type AgentStatus = ReturnType<typeof useEventsStore.getState>["agents"] extends Map<string, infer T>
  ? T extends { status: infer S }
    ? S
    : never
  : never;

function agentDataStatus(status: AgentStatus): string {
  if (status === "running") return "active";
  if (status === "idle") return "idle";
  if (status === "queued") return "queued";
  if (status === "error" || status === "fatal") return "error";
  if (status === "success") return "success";
  if (status === "throttled") return "throttled";
  return "idle";
}

function layerDataStatus(status: string): string {
  if (status === "healthy") return "active";
  if (status === "degraded") return "queued";
  if (status === "critical") return "error";
  return "idle";
}

function logTimestampColor(level: string): string {
  if (level === "error" || level === "critical") return "text-status-error";
  if (level === "warn") return "text-status-warning";
  return "text-text-muted";
}

function logMessageColor(level: string): string {
  if (level === "error" || level === "critical") return "text-status-error";
  if (level === "warn") return "text-status-warning";
  return "text-text-secondary";
}

function resourceMeterClass(pct: number, warn: number, critical: number): string {
  if (pct >= critical) return "swarm-meter swarm-meter--error";
  if (pct >= warn) return "swarm-meter swarm-meter--warn";
  return "swarm-meter swarm-meter--good";
}

function formatErrorCount(errors: number): string {
  return `${errors} ${errors === 1 ? "error" : "errors"}`;
}

function metricsOrNull<T,>(value: T | null | undefined): T | null {
  return value ?? null;
}

// ── Section shell ─────────────────────────────────────────────────────────────

function Panel({
  title,
  children,
  className,
  loading,
  live,
  variant,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly loading?: boolean;
  readonly live?: boolean;
  readonly variant?: "default" | "warn" | "danger";
}) {
  return (
    <section
      className={cn(
        "flex flex-col bg-bg-surface border border-border rounded-lg overflow-hidden panel-enter",
        live && "live-panel-edge",
        variant === "danger" && "panel-variant-danger",
        variant === "warn" && "panel-variant-warn",
        className
      )}
    >
      <header className="px-4 py-2.5 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          {live && (
            <span
              className="status-dot h-1.5 w-1.5 shrink-0"
              data-status="active"
              aria-label="Live data"
            />
          )}
          {variant === "danger" && !live && (
            <span
              className="status-dot h-1.5 w-1.5 shrink-0"
              data-status="error"
              aria-label="Error state"
            />
          )}
          <span className="text-[11px] font-mono font-semibold text-text-muted uppercase tracking-widest">
            {title}
          </span>
        </div>
        {loading && (
          <span className="text-[9px] font-mono text-text-muted animate-pulse">loading…</span>
        )}
      </header>
      <div className="flex-1 p-4">
        {children}
      </div>
    </section>
  );
}

// ── Status dot matrix — all agents ────────────────────────────────────────────

function AgentStatusMatrix() {
  const agents = useEventsStore((s) => [...s.agents.values()]);
  const total = useEventsStore((s) => s.totalAgentCount);
  const active = useEventsStore((s) => s.activeAgentCount);
  const errors = useEventsStore((s) => s.errorAgentCount);
  const visibleAgents = agents.slice(0, 64);
  const extraAgents = Math.max(0, agents.length - visibleAgents.length);

  if (agents.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-baseline gap-2">
          <div className="h-8 w-12 skeleton rounded" />
          <div className="h-4 w-20 skeleton rounded" />
        </div>
        <div className="grid grid-cols-8 gap-1.5">
          {Array.from({ length: 16 }).map((_, index) => (
            <div key={`agent-skeleton-${index + 1}`} className="h-4 w-4 skeleton rounded-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary numbers */}
      <div className="flex items-baseline gap-3">
        <span className="text-2xl font-mono font-semibold text-text-primary tabular-nums" data-metric>
          {active}
        </span>
        <span className="text-xs font-mono text-text-muted">/ {total} running</span>
        {errors > 0 && <span className="ml-auto text-xs font-mono text-status-error">{formatErrorCount(errors)}</span>}
      </div>

      {/* Dot matrix */}
      <ul className="flex flex-wrap gap-1.5" aria-label="Agent statuses">
        {visibleAgents.map((agent) => (
          <li
            key={agent.id}
            className="status-dot h-3 w-3 rounded-full"
            data-status={agentDataStatus(agent.status)}
            title={`${agent.name ?? agent.id}: ${agent.status}`}
          />
        ))}
        {extraAgents > 0 && (
          <li className="text-[10px] font-mono text-text-muted self-center list-none">
            +{extraAgents}
          </li>
        )}
      </ul>
    </div>
  );
}

// ── Control plane layer health ────────────────────────────────────────────────

const CONTROL_PLANE_LAYERS = [
  { id: "intake",    label: "Intake",    description: "Goal parsing + validation" },
  { id: "planning",  label: "Planning",  description: "Task decomposition + DAG" },
  { id: "dispatch",  label: "Dispatch",  description: "Agent selection + routing" },
  { id: "execution", label: "Execution", description: "Agent task runner" },
  { id: "synthesis", label: "Synthesis", description: "Result aggregation" },
  { id: "eval",      label: "Eval",      description: "Quality gate + scoring" },
  { id: "memory",    label: "Memory",    description: "Context + RAG persistence" },
] as const;

function ControlPlaneHealth() {
  const layers = useEventsStore((s) => s.controlPlaneLayers);

  if (layers.size === 0) {
    return (
      <div className="space-y-1.5">
        {CONTROL_PLANE_LAYERS.map((layer) => (
          <div key={layer.id} className="flex items-center gap-2.5">
            <div className="h-2 w-2 rounded-full skeleton shrink-0" />
            <span className="text-xs font-mono text-text-muted w-20 shrink-0">{layer.label}</span>
            <div className="flex-1 h-3 skeleton rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {CONTROL_PLANE_LAYERS.map((layer) => {
        const state = layers.get(layer.id);
        const status = state?.status ?? "unknown";
        return (
          <div key={layer.id} className="flex items-center gap-2.5">
            <span
              className="status-dot h-2 w-2 shrink-0"
              data-status={layerDataStatus(status)}
            />
            <span className="text-xs font-mono text-text-secondary w-20 shrink-0">
              {layer.label}
            </span>
            <div className="flex-1 h-px bg-border" />
            <span className="text-[10px] font-mono text-text-muted capitalize">
              {status}
            </span>
            {state?.latencyP50Ms != null && (
              <span className="text-[10px] font-mono text-text-muted tabular-nums" data-metric>
                {state.latencyP50Ms}ms
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── System resource gauges ────────────────────────────────────────────────────

function ResourceGauge({ label, value, max, unit, warn, critical }: {
  readonly label: string;
  readonly value: number;
  readonly max: number;
  readonly unit: string;
  readonly warn: number;
  readonly critical: number;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-text-muted uppercase tracking-wide">
          {label}
        </span>
        <span className="text-xs font-mono text-text-secondary tabular-nums" data-metric>
          {Math.round(pct)}%
          <span className="text-text-muted ml-1 text-[9px]">
            {Math.round(value)}/{Math.round(max)}{unit}
          </span>
        </span>
      </div>
      <progress
        className={resourceMeterClass(pct, warn, critical)}
        max={100}
        value={Math.min(100, pct)}
        aria-label={`${label} ${Math.round(pct)}%`}
      />
    </div>
  );
}

function SystemResourcePanel() {
  const metrics = useEventsStore((s) => s.systemMetrics);

  if (!metrics) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((item) => (
          <div key={`resource-skeleton-${item}`} className="space-y-1">
            <div className="h-3 skeleton rounded w-full" />
            <div className="h-1.5 skeleton rounded-full w-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ResourceGauge
        label="CPU"
        value={metrics.cpu.load1m * 100 / (metrics.cpu.coreCount ?? metrics.cpu.perCore?.length ?? 1)}
        max={100}
        unit="%"
        warn={60}
        critical={85}
      />
      <ResourceGauge
        label="Memory"
        value={metrics.memory.usedMb / 1024}
        max={metrics.memory.totalMb / 1024}
        unit=" GB"
        warn={70}
        critical={85}
      />
      <ResourceGauge
        label="SwarmX Slice"
        value={metrics.memory.swarmxSliceMb}
        max={metrics.memory.totalMb * 0.5}
        unit=" MB"
        warn={60}
        critical={80}
      />
      <div className="pt-1 grid grid-cols-2 gap-x-4 gap-y-0.5">
        <MetricCell label="Disk R" value={formatBps(metrics.disk.readBytesPerSec)} />
        <MetricCell label="Disk W" value={formatBps(metrics.disk.writeBytesPerSec)} />
        <MetricCell label="Net RX" value={formatBps(metrics.network.rxBytesPerSec)} />
        <MetricCell label="Net TX" value={formatBps(metrics.network.txBytesPerSec)} />
      </div>
    </div>
  );
}

function MetricCell({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[10px] font-mono text-text-muted">{label}</span>
      <span className="text-[10px] font-mono text-text-secondary tabular-nums" data-metric>{value}</span>
    </div>
  );
}

// ── Queue depth table ─────────────────────────────────────────────────────────

function QueueDepthPanel() {
  const queues = useEventsStore((s) => s.queues);

  if (queues.size === 0) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((item) => <div key={`queue-skeleton-${item}`} className="h-5 skeleton rounded" />)}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[9px] font-mono text-text-muted uppercase tracking-wide pb-1 border-b border-border">
        <span>Queue</span>
        <div className="flex gap-4">
          <span className="w-8 text-right">Wait</span>
          <span className="w-8 text-right">Act</span>
          <span className="w-8 text-right">Del</span>
          <span className="w-8 text-right">Fail</span>
        </div>
      </div>
      {[...queues.entries()].map(([name, q]) => (
        <div key={name} className="flex items-center justify-between py-0.5">
          <span className="text-[10px] font-mono text-text-secondary truncate max-w-25">
            {name}
          </span>
          <div className="flex gap-4">
            <span className={cn("text-[10px] font-mono tabular-nums w-8 text-right", q.waiting > 0 ? "text-status-queued" : "text-text-muted")} data-metric>
              {q.waiting}
            </span>
            <span className={cn("text-[10px] font-mono tabular-nums w-8 text-right", q.active > 0 ? "text-status-active" : "text-text-muted")} data-metric>
              {q.active}
            </span>
            <span className="text-[10px] font-mono tabular-nums w-8 text-right text-text-muted" data-metric>
              {q.delayed}
            </span>
            <span className={cn("text-[10px] font-mono tabular-nums w-8 text-right", q.failed > 0 ? "text-status-error" : "text-text-muted")} data-metric>
              {q.failed}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Recent events feed ────────────────────────────────────────────────────────

function RecentEventsFeed() {
  const logs = useEventsStore((s) => s.logs.slice(-8));
  const reversed = useMemo(() => [...logs].reverse(), [logs]);

  if (reversed.length === 0) {
    return (
      <div className="flex items-center justify-center h-20">
        <span className="text-xs font-mono text-text-muted">No events yet</span>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {reversed.map((log, i) => (
        <div key={(log as { id?: string }).id ?? `${log.timestamp}-${i}`} className="flex items-start gap-2">
          <span
            className={cn(
              "text-[9px] font-mono shrink-0 mt-0.5 tabular-nums",
              logTimestampColor(log.level)
            )}
          >
            {new Date(log.timestamp).toLocaleTimeString("en-NG", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              timeZone: "Africa/Lagos",
            })}
          </span>
          <span
            className={cn(
              "text-[10px] font-mono truncate",
              logMessageColor(log.level)
            )}
          >
            {log.message}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── OOM event log ─────────────────────────────────────────────────────────────

function OOMEvents() {
  const agents = useEventsStore((s) => [...s.agents.values()]);
  // Normalise resource/resources alias — mirrors agents/page.tsx normalization
  const oomAgents = agents.filter((a) => {
    const res = (a as { resources?: { oomEvents?: number }; resource?: { oomEvents?: number } }).resources
      ?? (a as { resource?: { oomEvents?: number } }).resource
      ?? null;
    return (res?.oomEvents ?? (a as { oomCount?: number }).oomCount ?? 0) > 0;
  });

  if (oomAgents.length === 0) {
    return (
      <div className="flex items-center gap-2 py-1">
        <span className="status-dot h-1.5 w-1.5" data-status="active" />
        <span className="text-xs font-mono text-status-success">No OOM events detected</span>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {oomAgents.map((a) => {
        const res = (a as { resources?: { oomEvents?: number }; resource?: { oomEvents?: number } }).resources
          ?? (a as { resource?: { oomEvents?: number } }).resource
          ?? null;
        const count = res?.oomEvents ?? (a as { oomCount?: number }).oomCount;
        return (
          <div key={a.id} className="flex items-center justify-between py-0.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="status-dot h-1.5 w-1.5 shrink-0" data-status="fatal" />
              <span className="text-[10px] font-mono text-status-error truncate max-w-35">
                {a.name ?? a.id}
              </span>
            </div>
            <span className="text-[10px] font-mono text-text-muted tabular-nums shrink-0" data-metric>
              {count}× OOM
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Health radar ─────────────────────────────────────────────────────────────

/**
 * Composite health score (0–100) synthesised from:
 *   - agent error ratio (40 pts)
 *   - CPU load (30 pts)
 *   - memory pressure (30 pts)
 */
function useHealthScore() {
  const active = useEventsStore((s) => s.activeAgentCount);
  const errors = useEventsStore((s) => s.errorAgentCount);
  const total  = useEventsStore((s) => s.totalAgentCount);
  const metrics = useEventsStore((s) => s.systemMetrics);

  return useMemo(() => {
    const agentScore = total > 0
      ? Math.round(40 * (1 - errors / Math.max(total, 1)))
      : 40;

    const cpuLoad = metrics?.cpu.load1m ?? 0;
    const cpuCores = metrics?.cpu.coreCount ?? metrics?.cpu.perCore?.length ?? 1;
    const cpuScore = Math.round(30 * Math.max(0, 1 - (cpuLoad / cpuCores) / 0.9));

    const memPct = metrics && metrics.memory.totalMb > 0
      ? metrics.memory.usedMb / metrics.memory.totalMb
      : 0;
    const memScore = Math.round(30 * Math.max(0, 1 - memPct / 0.9));

    const total_score = agentScore + cpuScore + memScore;

    let grade = "Critical";
    let tone = "tone-critical";
    let fill = "var(--color-status-fatal)";

    if (total_score >= 90) {
      grade = "Optimal";
      tone = "tone-optimal";
      fill = "var(--color-status-active)";
    } else if (total_score >= 70) {
      grade = "Healthy";
      tone = "tone-healthy";
      fill = "var(--color-status-success)";
    } else if (total_score >= 50) {
      grade = "Degraded";
      tone = "tone-degraded";
      fill = "var(--color-status-queued)";
    }

    return { score: total_score, grade, tone, fill, agentScore, cpuScore, memScore, hasData: metrics != null || active > 0 };
  }, [active, errors, total, metrics]);
}

function HealthRadar() {
  const h = useHealthScore();

  const chartData = [
    { name: "Health", value: h.score, fill: h.fill },
  ];

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0 health-radar-frame">
        <ResponsiveContainer width={84} height={84}>
          <RadialBarChart
            cx="50%"
            cy="50%"
            innerRadius={28}
            outerRadius={40}
            startAngle={90}
            endAngle={-270}
            data={chartData}
          >
            <RadialBar
              dataKey="value"
              cornerRadius={4}
              background={{ fill: "var(--color-bg-elevated)" }}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn("text-lg font-mono font-bold tabular-nums leading-none", h.tone)} data-metric>
            {h.score}
          </span>
        </div>
      </div>
      <div className="space-y-1.5 min-w-0">
        <div className={cn("text-sm font-mono font-semibold", h.tone)}>
          {h.grade}
        </div>
        <div className="space-y-0.5">
          <ScoreLine label="Agents"  pts={h.agentScore} max={40} />
          <ScoreLine label="CPU"     pts={h.cpuScore}   max={30} />
          <ScoreLine label="Memory"  pts={h.memScore}   max={30} />
        </div>
      </div>
    </div>
  );
}

function meterClassForPct(pct: number): string {
  if (pct >= 80) return "swarm-meter swarm-meter--good";
  if (pct >= 50) return "swarm-meter swarm-meter--warn";
  return "swarm-meter swarm-meter--error";
}

function ScoreLine({ label, pts, max }: { readonly label: string; readonly pts: number; readonly max: number }) {
  const pct = max > 0 ? (pts / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] font-mono text-text-muted w-12 shrink-0">{label}</span>
      <progress className={meterClassForPct(pct)} max={100} value={pct} />
      <span className="text-[9px] font-mono text-text-muted tabular-nums w-8 text-right" data-metric>
        {pts}/{max}
      </span>
    </div>
  );
}

// ── Queue pressure chart ──────────────────────────────────────────────────────

/**
 * Samples queue depth every 10 s and keeps the last 30 readings for a sparkline.
 */
function useQueuePressureHistory(sampleMs = 10_000, maxPoints = 30) {
  const queues = useEventsStore((s) => s.queues);
  const [history, setHistory] = React.useState<{ t: number; waiting: number; active: number }[]>([]);

  React.useEffect(() => {
    const sample = () => {
      const entries = [...queues.values()];
      const waiting = entries.reduce((a, q) => a + q.waiting, 0);
      const active  = entries.reduce((a, q) => a + q.active, 0);
      setHistory((prev) => [...prev.slice(-(maxPoints - 1)), { t: Date.now(), waiting, active }]);
    };
    sample();
    const id = setInterval(sample, sampleMs);
    return () => clearInterval(id);

  }, [queues, sampleMs, maxPoints]);

  return history;
}

function QueuePressureChart() {
  const history = useQueuePressureHistory();

  if (history.length < 2) {
    return (
      <div className="flex items-center justify-center h-20">
        <span className="text-xs font-mono text-text-muted">Collecting samples…</span>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={72}>
      <AreaChart data={history} margin={{ top: 2, right: 2, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="grad-waiting" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-status-queued)" stopOpacity={0.4} />
            <stop offset="100%" stopColor="var(--color-status-queued)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="grad-active" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.4} />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <Tooltip
          contentStyle={{
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border)",
            borderRadius: "4px",
            fontSize: "10px",
            fontFamily: "JetBrains Mono, monospace",
            color: "var(--color-text-secondary)",
          }}
          labelFormatter={(_, payload) => {
            const t = (payload?.[0]?.payload as { t?: number } | undefined)?.t;
            if (!t) return "";
            return new Date(t).toLocaleTimeString("en-NG", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              timeZone: "Africa/Lagos",
            });
          }}
          formatter={(value: number, name: string) => [value, name === "waiting" ? "Queued" : "Active"]}
        />
        <Area
          type="monotone"
          dataKey="waiting"
          stroke="var(--color-status-queued)"
          strokeWidth={1.5}
          fill="url(#grad-waiting)"
          dot={false}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="active"
          stroke="var(--color-accent)"
          strokeWidth={1.5}
          fill="url(#grad-active)"
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function OOMPanel() {
  const agents = useEventsStore((s) => [...s.agents.values()]);
  const hasOOM = agents.some((a) => {
    const res = (a as { resources?: { oomEvents?: number }; resource?: { oomEvents?: number } }).resources
      ?? (a as { resource?: { oomEvents?: number } }).resource
      ?? null;
    return (res?.oomEvents ?? (a as { oomCount?: number }).oomCount ?? 0) > 0;
  });

  return (
    <Panel title="OOM Events" variant={hasOOM ? "danger" : "default"} className="stagger-3">
      <OOMEvents />
    </Panel>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OverviewPage() {
  return (
    <div className="p-4 space-y-4">
      {/* Bento top strip: Health Radar + 4 quick stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <div className="md:col-span-1 bg-bg-surface border border-border rounded-lg px-4 py-3">
          <div className="text-[10px] font-mono text-text-muted uppercase tracking-wide mb-2">
            System Health
          </div>
          <HealthRadar />
        </div>
        <div className="md:col-span-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <QuickStatCard />
        </div>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-4">
          {/* Agent fleet matrix */}
          <Panel title="Agent Fleet" live className="stagger-1">
            <AgentStatusMatrix />
          </Panel>

          {/* Control plane health */}
          <Panel title="Control Plane" live className="stagger-2">
            <ControlPlaneHealth />
          </Panel>

          {/* Queue depth table + pressure chart */}
          <Panel title="Job Queues — BullMQ" live className="stagger-3">
            <QueueDepthPanel />
            <div className="mt-4 pt-3 border-t border-border">
              <div className="text-[9px] font-mono text-text-muted uppercase tracking-wide mb-1">
                Queue Pressure (30 s window)
              </div>
              <QueuePressureChart />
            </div>
          </Panel>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* System resources */}
          <Panel title="System Resources" live className="stagger-2">
            <SystemResourcePanel />
          </Panel>

          {/* OOM events */}
          <OOMPanel />

          {/* Recent events */}
          <Panel title="Recent Events" live className="stagger-4">
            <RecentEventsFeed />
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ── Quick stat cards ──────────────────────────────────────────────────────────

function QuickStatCard() {
  const active = useEventsStore((s) => s.activeAgentCount);
  const total = useEventsStore((s) => s.totalAgentCount);
  const errors = useEventsStore((s) => s.errorAgentCount);
  const metrics = useEventsStore((s) => s.systemMetrics);
  const queues = useEventsStore((s) => s.queues);

  const cpuLoad = metricsOrNull(metrics?.cpu.load1m);
  const memPct = metrics == null || metrics.memory.totalMb <= 0
    ? null
    : (metrics.memory.usedMb / metrics.memory.totalMb) * 100;
  const totalWaiting = [...(queues?.values() ?? [])].reduce((a, q) => a + q.waiting, 0);

  const cards = [
    {
      label: "Active Agents",
      value: active.toString(),
      sub: `${total} total`,
      alert: errors > 0,
      alertText: `${errors} errors`,
    },
    {
      label: "CPU Load",
      value: cpuLoad == null ? "–" : formatPct((cpuLoad * 100) / (metrics?.cpu.coreCount ?? metrics?.cpu.perCore?.length ?? 1)),
      sub: metrics ? `${metrics.cpu.coreCount ?? metrics.cpu.perCore?.length ?? "?"} cores` : undefined,
      alert: cpuLoad != null && cpuLoad > 0.8,
    },
    {
      label: "Memory",
      value: memPct == null ? "–" : formatPct(memPct),
      sub: metrics ? `${Math.round(metrics.memory.usedMb / 1024)} / ${Math.round(metrics.memory.totalMb / 1024)} GB` : undefined,
      alert: memPct != null && memPct > 85,
    },
    {
      label: "Queued Jobs",
      value: totalWaiting.toString(),
      sub: `${queues.size} queues`,
      alert: false,
    },
  ] as const;

  const staggerClass = ["stagger-1", "stagger-2", "stagger-3", "stagger-4"] as const;

  return (
    <>
      {cards.map((card, idx) => (
        <div
          key={card.label}
          className={cn(
            "bg-bg-surface border border-border rounded-lg px-4 py-3 panel-enter",
            staggerClass[idx],
            card.alert && "panel-variant-warn"
          )}
        >
          <div className="text-[10px] font-mono text-text-muted uppercase tracking-wide mb-1">
            {card.label}
          </div>
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                "text-xl font-mono font-semibold tabular-nums count-enter",
                card.alert ? "text-status-warning" : "text-text-primary"
              )}
              data-metric
            >
              {card.value}
            </span>
            {"sub" in card && card.sub && (
              <span className="text-[10px] font-mono text-text-muted">{card.sub}</span>
            )}
          </div>
          {"alertText" in card && card.alert && card.alertText && (
            <div className="text-[9px] font-mono text-status-error mt-0.5 alert-wiggle">{card.alertText}</div>
          )}
        </div>
      ))}
    </>
  );
}
