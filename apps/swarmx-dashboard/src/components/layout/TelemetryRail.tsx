"use client";

import React, { useMemo } from "react";
import { cn, formatBps, formatPct } from "@/lib/utils";
import { useEventsStore } from "@/stores/events";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Cpu, MemoryStick, HardDrive, Network, Bot, AlertCircle, Zap } from "lucide-react";

// ── Micro sparkline (bar chart) ───────────────────────────────────────────────

interface SparklineProps {
  readonly data: number[];
  readonly color?: string;
  readonly height?: number;
  readonly maxValue?: number;
}

function Sparkline({ data, color = "var(--color-accent)", height = 28, maxValue }: SparklineProps) {
  const chartHeight = Math.max(8, height);
  const max = maxValue ?? Math.max(...data, 1);
  const bars = data.slice(-30); // last 30 samples

  return (
    <div className="flex items-end gap-px" aria-label="Sparkline chart">
      <svg
        className="h-full w-full"
        height={chartHeight}
        viewBox={`0 0 ${Math.max(1, bars.length)} ${chartHeight}`}
        preserveAspectRatio="none"
      >
      {bars.map((v, i) => (
        <rect
          key={`spark-${i}-${Math.round(v * 100)}`}
          x={i + 0.1}
          y={chartHeight - Math.max(2, (v / max) * chartHeight)}
          width={0.8}
          height={Math.max(2, (v / max) * chartHeight)}
          fill={color}
          fillOpacity={0.6 + (i / bars.length) * 0.4}
          rx={0.2}
        />
      ))}
      </svg>
    </div>
  );
}

// ── Per-core CPU bars ─────────────────────────────────────────────────────────

function CoreBars({ cores }: { readonly cores: number[] }) {
  if (cores.length === 0) return <div className="h-5 skeleton w-full rounded" />;
  const chartHeight = 20;
  return (
    <svg
      className="h-5 w-full"
      viewBox={`0 0 ${Math.max(1, cores.length)} ${chartHeight}`}
      preserveAspectRatio="none"
      aria-label="CPU core utilization"
    >
      {cores.map((pct, i) => {
        let color = "var(--color-resource-safe)";
        if (pct >= 85) {
          color = "var(--color-resource-critical)";
        } else if (pct >= 60) {
          color = "var(--color-resource-warn)";
        }
        const barHeight = Math.max(2, (pct / 100) * chartHeight);
        return (
          <g key={`core-${i}-${Math.round(pct)}`}>
            <title>{`Core ${i}: ${formatPct(pct)}`}</title>
            <rect
              x={i + 0.1}
              y={chartHeight - barHeight}
              width={0.8}
              height={barHeight}
              fill={color}
              rx={0.2}
            />
          </g>
        );
      })}
    </svg>
  );
}

// ── Metric row ────────────────────────────────────────────────────────────────

interface MetricRowProps {
  readonly label: string;
  readonly value: string;
  readonly icon?: React.ElementType;
  readonly sublabel?: string;
  readonly sparkData?: number[];
  readonly sparkColor?: string;
  readonly alert?: boolean;
}

function MetricRow({ label, value, icon: Icon, sublabel, sparkData, sparkColor, alert }: MetricRowProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {Icon && (
            <Icon
              className={cn("h-3 w-3 shrink-0", alert ? "text-status-warning" : "text-text-muted")}
            />
          )}
          <span className="text-[10px] font-mono text-text-muted uppercase tracking-wide">
            {label}
          </span>
        </div>
        <span
          className={cn(
            "text-xs font-mono tabular-nums",
            alert ? "text-status-warning" : "text-text-secondary"
          )}
          data-metric
        >
          {value}
        </span>
      </div>
      {sublabel && (
        <span className="text-[9px] font-mono text-text-muted">{sublabel}</span>
      )}
      {sparkData && sparkData.length > 0 && (
        <Sparkline data={sparkData} {...(sparkColor !== undefined && { color: sparkColor })} height={20} />
      )}
    </div>
  );
}

// ── Agent fleet summary ring ──────────────────────────────────────────────────

function AgentFleetSummary() {
  const total = useEventsStore((s) => s.totalAgentCount);
  const active = useEventsStore((s) => s.activeAgentCount);
  const errors = useEventsStore((s) => s.errorAgentCount);

  if (total === 0) {
    return <div className="h-6 skeleton w-full rounded" />;
  }

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-xl font-mono font-semibold text-text-primary tabular-nums" data-metric>
          {active}
        </span>
        <span className="text-[10px] font-mono text-text-muted">
          / {total} active
        </span>
      </div>
      {errors > 0 && (
        <span className="flex items-center gap-1 text-[10px] font-mono text-status-error">
          <AlertCircle className="h-3 w-3" />
          {errors}
        </span>
      )}
    </div>
  );
}

// ── Queue depth rows ──────────────────────────────────────────────────────────

function QueueSummary() {
  const queues = useEventsStore((s) => s.queues);

  if (queues.size === 0) {
    return (
      <div className="space-y-1">
        {[1, 2].map((i) => (
          <div key={i} className="h-4 skeleton rounded" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {[...queues.entries()].slice(0, 4).map(([name, q]) => (
        <div key={name} className="flex items-center justify-between">
          <span className="text-[10px] font-mono text-text-muted truncate max-w-[100px]">
            {name}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-status-queued tabular-nums" data-metric>
              {q.waiting}
            </span>
            <span className="text-[9px] font-mono text-text-muted">wait</span>
            {q.failed > 0 && (
              <span className="text-[10px] font-mono text-status-error tabular-nums" data-metric>
                {q.failed}✗
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main TelemetryRail ────────────────────────────────────────────────────────

export function TelemetryRail() {
  const metrics = useEventsStore((s) => s.systemMetrics);
  const cpuHistory = useEventsStore((s) => s.cpuHistory);
  const memHistory = useEventsStore((s) => s.memHistory);
  const diskReadHistory = useEventsStore((s) => s.diskReadHistory);
  const netRxHistory = useEventsStore((s) => s.netRxHistory);
  const isStale = useEventsStore((s) => s.isStale);
  const lastEventAt = useEventsStore((s) => s.lastEventAt);

  const lastUpdated = React.useMemo(() => {
    if (!lastEventAt) return null;
    return new Date(lastEventAt).toLocaleTimeString("en-NG", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "Africa/Lagos",
    });
  }, [lastEventAt]);

  const cpuAvg = useMemo(() => {
    const cores = metrics?.cpu.perCore ?? [];
    if (cores.length === 0) return metrics?.cpu.load1m ?? 0;
    return cores.reduce((a, b) => a + b, 0) / cores.length;
  }, [metrics]);

  const memPct = metrics && metrics.memory.totalMb > 0
    ? (metrics.memory.usedMb / metrics.memory.totalMb) * 100
    : 0;

  let cpuSparkColor = "var(--color-resource-safe)";
  if (cpuAvg >= 85) {
    cpuSparkColor = "var(--color-resource-critical)";
  } else if (cpuAvg >= 60) {
    cpuSparkColor = "var(--color-resource-warn)";
  }

  let memSparkColor = "var(--color-resource-safe)";
  if (memPct >= 85) {
    memSparkColor = "var(--color-resource-critical)";
  } else if (memPct >= 60) {
    memSparkColor = "var(--color-resource-warn)";
  }

  return (
    <aside
      className={cn(
        "row-start-2 col-start-3 flex flex-col",
        "bg-bg-surface border-l border-border",
        "w-(--telemetry-width) overflow-hidden",
        "z-20 rail-enter"
      )}
      aria-label="Live telemetry"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-[10px] font-mono text-text-muted uppercase tracking-widest">
          Telemetry
        </span>
        <div className="flex items-center gap-2">
          {isStale ? (
            <span className="text-[9px] font-mono text-status-warning flex items-center gap-1">
              <span className="status-dot h-1 w-1" data-status="queued" />
              stale
            </span>
          ) : lastUpdated ? (
            <span className="text-[9px] font-mono text-text-muted tabular-nums" title="Last telemetry received">
              {lastUpdated}
            </span>
          ) : null}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className={cn("px-3 py-3 space-y-4 transition-[opacity,filter] duration-500", isStale && "stale-dim")}>

          {/* Agent Fleet */}
          <section>
            <SectionLabel icon={Bot} label="Agent Fleet" />
            <div className="mt-1.5">
              <AgentFleetSummary />
            </div>
          </section>

          <Separator />

          {/* CPU */}
          <section>
            <SectionLabel icon={Cpu} label="CPU" />
            <div className="mt-1.5 space-y-2">
              <MetricRow
                label="Load avg"
                value={formatPct(cpuAvg)}
                {...(metrics?.cpu.coreCount != null
                  ? { sublabel: `${metrics.cpu.coreCount} cores` }
                  : {})}
                alert={cpuAvg > 85}
              />
              {metrics?.cpu.temperatureCelsius != null && (
                <MetricRow
                  label="Temp"
                  value={`${metrics.cpu.temperatureCelsius.toFixed(0)}°C`}
                  alert={metrics.cpu.temperatureCelsius > 80}
                />
              )}
              {metrics?.cpu.perCore && <CoreBars cores={metrics.cpu.perCore} />}
              {cpuHistory.length > 0 && (
                <Sparkline
                  data={cpuHistory.map((p) => p.value)}
                  color={cpuSparkColor}
                />
              )}
            </div>
          </section>

          <Separator />

          {/* Memory */}
          <section>
            <SectionLabel icon={MemoryStick} label="Memory" />
            <div className="mt-1.5 space-y-2">
              <MetricRow
                label="System"
                value={metrics ? `${Math.round(metrics.memory.usedMb)} MB` : "…"}
                {...(metrics ? { sublabel: `${Math.round(memPct)}% of ${Math.round(metrics.memory.totalMb / 1024)} GB` } : {})}
                alert={memPct > 85}
              />
              <MetricRow
                label="swarmx.slice"
                value={metrics ? `${Math.round(metrics.memory.swarmxSliceMb)} MB` : "…"}
                {...(metrics?.memory.swarmxSliceLimitMb != null
                  ? { sublabel: `limit: ${Math.round(metrics.memory.swarmxSliceLimitMb)} MB` }
                  : {})}
              />
              {memHistory.length > 0 && (
                <Sparkline
                  data={memHistory.map((p) => p.value)}
                  color={memSparkColor}
                />
              )}
            </div>
          </section>

          <Separator />

          {/* BullMQ Queues */}
          <section>
            <SectionLabel icon={Zap} label="Queues" />
            <div className="mt-1.5">
              <QueueSummary />
            </div>
          </section>

          <Separator />

          {/* Disk I/O */}
          <section>
            <SectionLabel icon={HardDrive} label="Disk I/O" />
            <div className="mt-1.5 space-y-1">
              <MetricRow
                label="Read"
                value={metrics ? formatBps(metrics.disk.readBytesPerSec) : "…"}
                sparkData={diskReadHistory.map((p) => p.value)}
                sparkColor="var(--color-status-active)"
              />
              <MetricRow
                label="Write"
                value={metrics ? formatBps(metrics.disk.writeBytesPerSec) : "…"}
              />
            </div>
          </section>

          <Separator />

          {/* Network I/O */}
          <section>
            <SectionLabel icon={Network} label="Network" />
            <div className="mt-1.5 space-y-1">
              <MetricRow
                label="RX"
                value={metrics ? formatBps(metrics.network.rxBytesPerSec) : "…"}
                sparkData={netRxHistory.map((p) => p.value)}
                sparkColor="var(--color-status-reload)"
              />
              <MetricRow
                label="TX"
                value={metrics ? formatBps(metrics.network.txBytesPerSec) : "…"}
              />
            </div>
          </section>

          {/* Bottom padding */}
          <div className="h-2" />
        </div>
      </ScrollArea>
    </aside>
  );
}

function SectionLabel({ icon: Icon, label }: { readonly icon: React.ElementType; readonly label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="h-3 w-3 text-text-muted" />
      <span className="text-[10px] font-mono text-text-muted uppercase tracking-widest">
        {label}
      </span>
    </div>
  );
}
