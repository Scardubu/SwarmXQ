"use client";

import { useState } from "react";
import { Play, Loader2, ExternalLink, CheckCircle2, XCircle, Clapperboard } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { PreProductionStatusBadge } from "./PreProductionStatusBadge";
import type { EpisodeRoadmapEntry, EpisodePreProduction } from "@swarmx/types/series-types";

interface EpisodeCardProps {
  episode: EpisodeRoadmapEntry;
  seriesId: string;
  jobId?: string;
  jobStatus?: string;
  onProduce: (episodeNumber: number) => Promise<void>;
  onPrepare: (episodeNumber: number) => Promise<void>;
  isProducing: boolean;
  preProduction?: EpisodePreProduction;
}

function jobStatusBadge(status: string | undefined): { label: string; className: string } | null {
  if (!status) return null;
  const MAP: Record<string, { label: string; className: string }> = {
    queued:      { label: "Queued",      className: "border-status-queued/35 bg-status-queued/10 text-status-queued" },
    running:     { label: "Running",     className: "border-status-active/35 bg-status-active/10 text-status-active animate-pulse" },
    completed:   { label: "Done",        className: "border-status-success/35 bg-status-success/10 text-status-success" },
    done:        { label: "Done",        className: "border-status-success/35 bg-status-success/10 text-status-success" },
    failed:      { label: "Failed",      className: "border-status-error/35 bg-status-error/10 text-status-error" },
    cancelled:   { label: "Cancelled",   className: "border-status-warning/35 bg-status-warning/10 text-status-warning" },
  };
  return MAP[status] ?? { label: status, className: "border-border text-text-muted" };
}

const IN_PROGRESS_PRE: ReadonlySet<string> = new Set(["scripting", "prompting", "audio_assets", "scoring"]);

export function EpisodeCard({
  episode,
  seriesId,
  jobId,
  jobStatus,
  onProduce,
  onPrepare,
  isProducing,
  preProduction,
}: EpisodeCardProps) {
  const [localProducing, setLocalProducing] = useState(false);
  const [localPreparing, setLocalPreparing] = useState(false);

  const badge = jobStatusBadge(jobStatus);
  const isTerminal  = jobStatus === "completed" || jobStatus === "done";
  const hasFailed   = jobStatus === "failed" || jobStatus === "cancelled";
  const isPending   = !jobId || hasFailed;

  const preStatus      = preProduction?.status;
  const preInProgress  = !!preStatus && IN_PROGRESS_PRE.has(preStatus);
  const preComplete    = preStatus === "complete";
  const preIsFailed    = preStatus === "failed";
  const needsPrepare   = !preStatus || preIsFailed;

  const virality = preComplete ? preProduction?.viralityScore : undefined;

  async function handleProduce() {
    setLocalProducing(true);
    try { await onProduce(episode.episodeNumber); }
    finally { setLocalProducing(false); }
  }

  async function handlePrepare() {
    setLocalPreparing(true);
    try { await onPrepare(episode.episodeNumber); }
    finally { setLocalPreparing(false); }
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 rounded border bg-bg-surface p-3.5",
        isTerminal ? "border-status-success/25" : "border-border",
      )}
    >
      {/* Episode number + title */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
            EP {episode.episodeNumber}
          </span>
          <Link
            href={`/series/${seriesId}/episodes/${episode.episodeNumber}`}
            className="truncate text-sm font-medium text-text-primary hover:text-accent transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded"
          >
            {episode.title}
          </Link>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {preStatus && <PreProductionStatusBadge status={preStatus} />}
          {badge && (
            <span className={cn("rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase", badge.className)}>
              {badge.label}
            </span>
          )}
        </div>
      </div>

      {/* Summary */}
      <p className="text-[11px] leading-relaxed text-text-muted line-clamp-2">
        {episode.summary}
      </p>

      {/* Chekhov gun indicator */}
      {episode.chekhovGun && (
        <p className="text-[10px] text-accent/70 italic">
          Plant: {episode.chekhovGun}
          {episode.chekhovPayoffEpisode ? ` (pays off Ep ${episode.chekhovPayoffEpisode})` : ""}
        </p>
      )}

      {/* Virality score when pre-production complete */}
      {virality && (
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] text-text-muted">Virality</span>
          <span
            className={cn(
              "font-mono text-[11px] font-semibold tabular-nums",
              virality.overall >= 0.7 ? "text-emerald-400" :
              virality.overall >= 0.4 ? "text-amber-400" : "text-red-400",
            )}
          >
            {Math.round(virality.overall * 100)}
          </span>
          {preProduction?.qualityGateResult && (
            <span
              className={cn(
                "rounded px-1 py-0.5 font-mono text-[9px] uppercase border",
                preProduction.qualityGateResult.passed
                  ? "border-status-success/35 text-status-success"
                  : "border-status-error/35 text-status-error",
              )}
            >
              {preProduction.qualityGateResult.passed ? "Gate ✓" : "Gate ✗"}
            </span>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {/* Prepare button — shown when no pre-production or it failed */}
          {needsPrepare && (
            <button
              type="button"
              onClick={handlePrepare}
              disabled={localPreparing}
              className={cn(
                "flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5",
                "text-[11px] font-medium text-text-secondary transition-colors",
                "hover:border-border-accent hover:text-text-primary",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
              aria-label={`${preIsFailed ? "Retry" : "Start"} pre-production for episode ${episode.episodeNumber}`}
            >
              {localPreparing
                ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                : <Clapperboard className="h-3 w-3" aria-hidden="true" />
              }
              {preIsFailed ? "Re-prepare" : "Prepare"}
            </button>
          )}

          {/* Produce button / status */}
          {isPending ? (
            <button
              type="button"
              onClick={handleProduce}
              disabled={isProducing || localProducing}
              className={cn(
                "flex items-center gap-1.5 rounded border border-border-accent bg-[var(--color-accent-dim)] px-3 py-1.5",
                "text-[11px] font-medium text-accent transition-colors",
                "hover:border-accent hover:bg-accent/20",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
              aria-label={`Produce episode ${episode.episodeNumber}: ${episode.title}`}
            >
              {localProducing || isProducing
                ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                : <Play className="h-3 w-3" aria-hidden="true" />
              }
              {hasFailed ? "Retry" : "Produce"}
            </button>
          ) : isTerminal ? (
            <span className="flex items-center gap-1 text-[11px] text-status-success">
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              Complete
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[11px] text-status-reload">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              {preInProgress ? "Preparing…" : "In progress"}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {hasFailed && (
            <XCircle className="h-3.5 w-3.5 text-status-error" aria-hidden="true" />
          )}
          {jobId && (
            <Link
              href={`/video/${jobId}`}
              className={cn(
                "flex items-center gap-1 text-[11px] text-text-muted hover:text-text-secondary",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded",
              )}
              aria-label={`View job details for episode ${episode.episodeNumber}`}
            >
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
              Job
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
