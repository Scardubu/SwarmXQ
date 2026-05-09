"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { useEventsStore } from "@/stores/events";
import { useUIStore } from "@/stores/ui";
import { Terminal, PanelRight } from "lucide-react";
import type { PressureLevel, StartupSummary } from "@swarmx/types";

/** Live WAT clock (UTC+1 / Africa/Lagos). */
function useWATClock() {
  const formatWATTime = React.useCallback(
    () =>
      new Date().toLocaleTimeString("en-NG", {
        timeZone: "Africa/Lagos",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }),
    []
  );

  const [time, setTime] = React.useState(() => formatWATTime());

  React.useEffect(() => {
    const id = setInterval(() => {
      setTime(formatWATTime());
    }, 1000);
    return () => clearInterval(id);
  }, [formatWATTime]);

  return time;
}

function useWATDateTitle() {
  return React.useMemo(
    () =>
      `West Africa Time (UTC+1) — ${new Date().toLocaleDateString("en-NG", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Africa/Lagos",
      })}`,
    []
  );
}

/** Health aggregate: SCS score takes precedence, then agent errors + CPU/mem. */
function useSystemHealth(): "healthy" | "degraded" | "critical" {
  const errorCount = useEventsStore((s) => s.errorAgentCount);
  const metrics = useEventsStore((s) => s.systemMetrics);
  const scsScore = useEventsStore((s) => s.scsScore);
  const governorState = useEventsStore((s) => s.governorState);

  if (governorState?.pressureLevel === "critical") return "critical";

  // SCS is the authoritative health signal when available
  if (scsScore !== null) {
    if (scsScore < 0.5) return "critical";
    if (scsScore < 0.7 || governorState?.pressureLevel === "high") return "degraded";
    if (errorCount > 0) return "degraded";
    return "healthy";
  }

  // Fallback: CPU/memory heuristics
  if (errorCount > 0 || governorState?.pressureLevel === "high") return "degraded";
  const cpuLoad = metrics?.cpu.load1m ?? 0;
  const memPct = metrics
    ? (metrics.memory.usedMb / (metrics.memory.totalMb || 1)) * 100
    : 0;
  if (cpuLoad > 8 || memPct > 85) return "critical";
  if (cpuLoad > 4 || memPct > 70 || errorCount > 0) return "degraded";
  return "healthy";
}

function getScsColorClass(score: number): string {
  if (score < 0.5) return "text-status-error";
  if (score < 0.7) return "text-status-warning";
  return "text-status-success";
}

// [V5.9-ENH-05] Map pressure level → badge colour class and label
function getPressureBadge(level: PressureLevel): { label: string; cls: string } {
  if (level === "critical") return { label: "MEM CRITICAL", cls: "text-status-error" };
  if (level === "high")     return { label: "MEM HIGH",     cls: "text-status-warning" };
  return                           { label: "MEM OK",       cls: "text-text-muted" };
}

function getStartupBadge(summary: StartupSummary): { label: string; cls: string } {
  if (summary.status === "critical") {
    return { label: "BOOT CRITICAL", cls: "border-status-error/35 bg-status-error/8 text-status-error" };
  }
  if (summary.status === "degraded") {
    return { label: "BOOT DEGRADED", cls: "border-status-warning/35 bg-status-warning/8 text-status-warning" };
  }
  return { label: "BOOT READY", cls: "border-status-success/35 bg-status-success/8 text-status-success" };
}

interface CommandBarProps {
  readonly breadcrumb?: string;
}

export function CommandBar({ breadcrumb = "Overview" }: CommandBarProps) {
  const health = useSystemHealth();
  let healthStatus: "active" | "queued" | "error" = "active";
  if (health === "degraded") {
    healthStatus = "queued";
  } else if (health === "critical") {
    healthStatus = "error";
  }
  const isStale = useEventsStore((s) => s.isStale);
  const connectionStatus = useEventsStore((s) => s.connectionStatus);
  const openCommandPalette = useUIStore((s) => s.openCommandPalette);
  const errorCount = useEventsStore((s) => s.errorAgentCount);
  const scsScore = useEventsStore((s) => s.scsScore);
  const governorState = useEventsStore((s) => s.governorState);
  // [V6.1-ENH-01] Startup narrative for health dot tooltip
  const startupSummary = useEventsStore((s) => s.startupSummary);
  const toggleTerminal = useUIStore((s) => s.toggleTerminal);
  const terminalVisible = useUIStore((s) => s.terminalVisible);
  const toggleTelemetryRail = useUIStore((s) => s.toggleTelemetryRail);
  const telemetryRailVisible = useUIStore((s) => s.telemetryRailVisible);
  const startupBadge = startupSummary ? getStartupBadge(startupSummary) : null;

  const watTime = useWATClock();
  const watDateTitle = useWATDateTitle();
  const isMac = typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");
  let staleLabel = "stale";
  if (connectionStatus === "disconnected") {
    staleLabel = "disconnected";
  }
  let errorLabel = "errors";
  if (errorCount === 1) {
    errorLabel = "error";
  }

  // [V6.1-ENH-01] Enrich health title with startup narrative when available
  const healthTitle =
    startupSummary != null
      ? `${startupSummary.narrative} · SCS ${scsScore != null ? (scsScore * 100).toFixed(0) + "%" : "—"}`
      : scsScore === null
      ? `System ${health}`
      : `System ${health} · SCS ${(scsScore * 100).toFixed(0)}%`;

  return (
    <header
      className={cn(
        "col-span-3 row-start-1",
        "flex items-center justify-between px-4 gap-3",
        "bg-bg-base border-b border-border",
        "z-40 h-(--command-bar-height)"
      )}
      role="banner"
    >
      {/* Left — Logo + breadcrumb */}
      <div className="flex items-center gap-3 min-w-0">
        <SwarmXLogo />
        <span className="text-text-muted text-xs font-mono select-none">▸</span>
        <span className="text-text-secondary text-xs font-mono truncate">
          {breadcrumb}
        </span>
      </div>

      {/* Center — Command palette trigger */}
      <button
        onClick={openCommandPalette}
        className={cn(
          "hidden md:flex items-center gap-2 px-3 h-7 rounded min-w-48",
          "bg-bg-surface border border-border text-text-muted",
          "text-xs font-mono",
          "hover:border-border-active hover:text-text-secondary hover:bg-bg-elevated",
          "transition-colors duration-(--duration-micro)",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        )}
        aria-label="Open command palette"
      >
        <Terminal className="h-3 w-3 shrink-0" />
        <span className="flex-1 text-left">{errorCount > 0 ? `Triage ${errorCount} error${errorCount > 1 ? "s" : ""} →` : "Run command…"}</span>
        <kbd className="ml-1 rounded bg-bg-elevated px-1 text-[10px] border border-border shrink-0">
          {isMac ? "⌘K" : "Ctrl+K"}
        </kbd>
      </button>

      {/* Right — System health + notifications + controls */}
      <div className="flex items-center gap-3">
        {/* SSE stale indicator */}
        {(isStale || connectionStatus === "disconnected") && (
          <span className="text-[10px] font-mono text-status-warning" role="status" aria-live="polite">
            ⚠ {staleLabel}
          </span>
        )}

        {/* Error badge */}
        {errorCount > 0 && (
          <span className="flex items-center gap-1 text-[10px] font-mono text-status-error">
            <span className="status-dot" data-status="error" />
            {errorCount} {errorLabel}
          </span>
        )}

        {/* SCS score chip */}
        {scsScore !== null && (
          <span
            className={cn(
              "text-[10px] font-mono tabular-nums",
              getScsColorClass(scsScore)
            )}
            title="V5 Swarm Coherence Score"
            aria-label={`SCS: ${(scsScore * 100).toFixed(0)}%`}
          >
            SCS {(scsScore * 100).toFixed(0)}%
          </span>
        )}

        {/* [V5.9-ENH-05] Runtime pressure badge */}
        {governorState && (
          <span
            className={cn(
              "text-[10px] font-mono tabular-nums",
              getPressureBadge(governorState.pressureLevel).cls
            )}
            title={`Memory pressure: ${governorState.pressureLevel} · ${governorState.availableMb} MB available · ZRAM ${(governorState.zramUsedPct * 100).toFixed(0)}% used`}
            aria-label={`Memory pressure: ${governorState.pressureLevel}`}
          >
            {getPressureBadge(governorState.pressureLevel).label}
          </span>
        )}

        {startupSummary && startupBadge && (
          <span
            className={cn(
              "hidden xl:inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wide",
              startupBadge.cls,
            )}
            title={`${startupSummary.narrative} · ${startupSummary.durationMs} ms`}
            aria-label={`Startup status: ${startupSummary.status}`}
          >
            {startupBadge.label}
          </span>
        )}

        {/* Live WAT clock */}
        <time
          className="hidden lg:block text-[10px] font-mono text-text-muted tabular-nums select-none"
          aria-label="Current time (WAT)"
          title={watDateTitle}
          role="timer"
          aria-live="off"
        >
          {watTime} <span className="text-text-muted/50">WAT</span>
        </time>

        {/* Separator */}
        <span className="h-3.5 w-px bg-border hidden lg:block" aria-hidden />

        {/* Telemetry rail toggle */}
        <button
          type="button"
          onClick={toggleTelemetryRail}
          title={telemetryRailVisible ? "Hide telemetry rail (⌘⇧T)" : "Show telemetry rail (⌘⇧T)"}
          aria-label={telemetryRailVisible ? "Hide telemetry panel" : "Show telemetry panel"}
          aria-pressed={telemetryRailVisible}
          className={cn(
            "flex items-center justify-center h-5 w-5 rounded",
            "transition-colors duration-(--duration-micro)",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
            telemetryRailVisible
              ? "text-accent hover:text-accent/80"
              : "text-text-muted hover:text-text-secondary"
          )}
        >
          <PanelRight className="h-3 w-3" />
        </button>

        {/* Terminal toggle */}
        <button
          type="button"
          onClick={toggleTerminal}
          title={terminalVisible ? "Hide terminal (⌘`)" : "Show terminal (⌘`)"}
          aria-label={terminalVisible ? "Hide terminal strip" : "Show terminal strip"}
          aria-pressed={terminalVisible}
          className={cn(
            "flex items-center justify-center h-5 w-5 rounded",
            "transition-colors duration-(--duration-micro)",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
            terminalVisible
              ? "text-accent hover:text-accent/80"
              : "text-text-muted hover:text-text-secondary"
          )}
        >
          <Terminal className="h-3 w-3" />
        </button>

        {/* System health pulse dot */}
        <div
          className="status-dot h-2 w-2"
          data-status={healthStatus}
          title={healthTitle}
          aria-label={healthTitle}
        />
      </div>
    </header>
  );
}

function SwarmXLogo() {
  return (
    <div className="flex items-center gap-2 select-none" aria-label="SwarmX OS">
      <svg
        className="swarm-logo-mark"
        width="24"
        height="24"
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <polygon
          points="18,2 33,10 33,26 18,34 3,26 3,10"
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
        />
        {/* Outer ring — subtle pulse */}
        <circle cx="18" cy="18" r="7" stroke="currentColor" strokeWidth="0.5" opacity="0.15" />
        {/* Center dot — animated breathe */}
        <circle
          cx="18"
          cy="18"
          r="4"
          fill="currentColor"
          opacity="0.9"
          style={{ transformOrigin: "18px 18px", animation: "logo-breathe 3s ease-in-out infinite" }}
        />
        <line x1="18" y1="2" x2="18" y2="8" stroke="currentColor" strokeWidth="1" opacity="0.5" />
        <line x1="33" y1="10" x2="27.5" y2="13" stroke="currentColor" strokeWidth="1" opacity="0.5" />
        <line x1="33" y1="26" x2="27.5" y2="23" stroke="currentColor" strokeWidth="1" opacity="0.5" />
        <line x1="18" y1="34" x2="18" y2="28" stroke="currentColor" strokeWidth="1" opacity="0.5" />
        <line x1="3" y1="26" x2="8.5" y2="23" stroke="currentColor" strokeWidth="1" opacity="0.5" />
        <line x1="3" y1="10" x2="8.5" y2="13" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      </svg>
      <div className="flex flex-col leading-none gap-0.5">
        <span className="text-text-primary text-sm font-mono font-semibold tracking-tight">
          SwarmX
        </span>
        <span className="text-[8px] font-mono text-text-muted/60 tracking-widest uppercase">
          OS v6
        </span>
      </div>
    </div>
  );
}
