"use client";

import { Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EpisodePreProductionStatus } from "@swarmx/types/series-types";

const STATUS_CONFIG: Record<
  EpisodePreProductionStatus,
  { label: string; className: string; spinning?: boolean }
> = {
  pending:     { label: "Pending",      className: "border-border text-text-muted" },
  scripting:   { label: "Scripting…",   className: "border-status-active/35 bg-status-active/10 text-status-active", spinning: true },
  prompting:   { label: "Prompting…",   className: "border-status-active/35 bg-status-active/10 text-status-active", spinning: true },
  audio_assets:{ label: "Audio…",       className: "border-status-active/35 bg-status-active/10 text-status-active", spinning: true },
  scoring:     { label: "Scoring…",     className: "border-status-active/35 bg-status-active/10 text-status-active", spinning: true },
  complete:    { label: "Ready",        className: "border-status-success/35 bg-status-success/10 text-status-success" },
  failed:      { label: "Prep Failed",  className: "border-status-error/35 bg-status-error/10 text-status-error" },
};

interface PreProductionStatusBadgeProps {
  status: EpisodePreProductionStatus;
  className?: string;
}

export function PreProductionStatusBadge({ status, className }: PreProductionStatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase",
        config.className,
        className,
      )}
      aria-label={`Pre-production status: ${config.label}`}
    >
      {config.spinning ? (
        <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden="true" />
      ) : status === "complete" ? (
        <CheckCircle2 className="h-2.5 w-2.5" aria-hidden="true" />
      ) : status === "failed" ? (
        <XCircle className="h-2.5 w-2.5" aria-hidden="true" />
      ) : (
        <Clock className="h-2.5 w-2.5" aria-hidden="true" />
      )}
      {config.label}
    </span>
  );
}
