"use client";

import React from "react";
import { useRuntimeCapabilities } from "@/hooks/useRuntimeCapabilities";
import { cn } from "@/lib/utils";

interface CapabilityCardProps {
  label: string;
  value: string;
  status: "ok" | "warn" | "err" | "unknown";
  hint?: string;
}

function statusClass(status: CapabilityCardProps["status"]): string {
  switch (status) {
    case "ok":
      return "border-status-success/40 bg-status-success/6 text-status-success";
    case "warn":
      return "border-status-warning/40 bg-status-warning/6 text-status-warning";
    case "err":
      return "border-status-error/40 bg-status-error/6 text-status-error";
    default:
      return "border-border bg-bg-panel text-text-muted";
  }
}

function CapabilityCard({ label, value, status, hint }: CapabilityCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded border px-3 py-2 min-w-[9rem]",
        statusClass(status),
      )}
      title={hint}
    >
      <div className="text-[10px] font-mono uppercase tracking-wider opacity-70">
        {label}
      </div>
      <div className="text-xs font-mono truncate">{value}</div>
    </div>
  );
}

/**
 * Consolidated runtime capability strip for the system page.
 * Shows Ollama/model residency, RAM, warmup, and voice benchmark status at a glance.
 * Falls back gracefully when API is unreachable.
 */
export function RuntimeCapabilityStrip() {
  const caps = useRuntimeCapabilities();

  if (!caps) {
    return (
      <div
        className="grid grid-cols-2 md:grid-cols-4 gap-2 px-4 py-3 border-b border-border bg-bg-base"
        aria-live="polite"
        aria-atomic="true"
      >
        <CapabilityCard label="Runtime" value="probing…" status="unknown" />
      </div>
    );
  }

  // Ollama status
  const ollamaStatus: CapabilityCardProps["status"] = !caps.ollama.reachable
    ? "err"
    : caps.models.length === 0
      ? "warn"
      : "ok";
  const ollamaValue = !caps.ollama.reachable
    ? "unreachable"
    : caps.models.length === 0
      ? "cold (no models loaded)"
      : `${caps.models.length} model${caps.models.length === 1 ? "" : "s"}`;

  // Memory status — mirrors backend threshold FULL_PIPELINE_MIN_AVAILABLE_MB=6170
  const availMb = caps.memory.availableGb * 1024;
  const memStatus: CapabilityCardProps["status"] =
    availMb < 4000 ? "err" : availMb < 6170 ? "warn" : "ok";

  // Voice benchmark status
  const bench = caps.voice.benchmark;
  const voiceStatus: CapabilityCardProps["status"] = !bench
    ? "warn"
    : bench.stale
      ? "warn"
      : bench.recommendedProviderId === "espeak"
        ? "warn"
        : "ok";
  const voiceValue = bench
    ? `${bench.recommendedProviderId}${bench.stale ? " (stale)" : ""}`
    : "no benchmark";

  // Warmup status
  const warmupStatus: CapabilityCardProps["status"] = !caps.warmup
    ? "unknown"
    : caps.warmup.done
      ? "ok"
      : "warn";
  const warmupValue = caps.warmup
    ? caps.warmup.done
      ? "ready"
      : `cold (~${caps.warmup.coldStartEtaSecs}s ETA)`
    : "unknown";

  return (
    <div
      className="grid grid-cols-2 md:grid-cols-4 gap-2 px-4 py-3 border-b border-border bg-bg-base"
      role="region"
      aria-label="Runtime capabilities"
    >
      <CapabilityCard
        label="Ollama"
        value={ollamaValue}
        status={ollamaStatus}
        hint={caps.ollama.reachable ? `${caps.ollama.url} · ${caps.ollama.latencyMs ?? "?"}ms` : "endpoint not reachable"}
      />
      <CapabilityCard
        label="RAM Available"
        value={`${caps.memory.availableGb.toFixed(1)} / ${caps.memory.totalGb.toFixed(1)} GB`}
        status={memStatus}
        hint="Full pipeline threshold: 6.17 GB available"
      />
      <CapabilityCard
        label="Warmup"
        value={warmupValue}
        status={warmupStatus}
        hint={caps.warmup?.source === "file" ? "startup-enhanced.sh active" : "no warmup marker file"}
      />
      <CapabilityCard
        label="Voice Benchmark"
        value={voiceValue}
        status={voiceStatus}
        hint={bench?.recommendationReason ?? "run voice-benchmark.ts to populate"}
      />
    </div>
  );
}
