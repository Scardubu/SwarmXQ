"use client";

import { Film, Clock, Radio } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { SeriesJob } from "@swarmx/types/series-types";

interface SeriesCardProps {
  series: SeriesJob;
}

const STATUS_MAP: Record<SeriesJob["status"], { label: string; className: string }> = {
  planning: {
    label: "Planning",
    className: "border-status-reload/35 bg-status-reload/10 text-status-reload animate-pulse",
  },
  planned: {
    label: "Planned",
    className: "border-status-queued/35 bg-status-queued/10 text-status-queued",
  },
  producing: {
    label: "Producing",
    className: "border-status-active/35 bg-status-active/10 text-status-active animate-pulse",
  },
  completed: {
    label: "Completed",
    className: "border-status-success/35 bg-status-success/10 text-status-success",
  },
  failed: {
    label: "Failed",
    className: "border-status-error/35 bg-status-error/10 text-status-error",
  },
};

export function SeriesCard({ series }: SeriesCardProps) {
  const statusStyle = STATUS_MAP[series.status];
  const producedCount = Object.keys(series.videoJobIds).length;
  const totalEpisodes = series.brief.seriesLength;
  const progress = totalEpisodes > 0 ? Math.round((producedCount / totalEpisodes) * 100) : 0;

  return (
    <Link
      href={`/series/${series.id}`}
      className={cn(
        "group flex flex-col gap-3 rounded border border-border bg-bg-surface p-4",
        "transition-colors duration-(--duration-micro)",
        "hover:border-border-accent hover:bg-bg-elevated",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
      )}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Film className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <span className="truncate text-sm font-medium text-text-primary">
            {series.brief.storyTheme}
          </span>
        </div>
        <span
          className={cn(
            "shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide",
            statusStyle.className,
          )}
          aria-label={`Status: ${statusStyle.label}`}
        >
          {statusStyle.label}
        </span>
      </div>

      {/* Core message */}
      {series.brief.coreMessage && (
        <p className="line-clamp-2 text-xs text-text-muted">
          {series.brief.coreMessage}
        </p>
      )}

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-text-muted">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" aria-hidden="true" />
          {totalEpisodes} eps × {series.brief.episodeDurationSeconds}s
        </span>
        <span className="flex items-center gap-1">
          <Radio className="h-3 w-3" aria-hidden="true" />
          {series.brief.platformPrimary}
        </span>
        <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase text-text-muted">
          {series.brief.tone}
        </span>
      </div>

      {/* Production progress bar */}
      {producedCount > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] text-text-muted">
            <span>{producedCount}/{totalEpisodes} episodes produced</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-bg-base">
            <div
              className="h-full rounded-full bg-accent transition-all duration-500"
              style={{ width: `${progress}%` }}
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        </div>
      )}

      {/* Planning error */}
      {series.status === "failed" && series.planningError && (
        <p className="truncate text-[11px] text-status-error" role="alert">
          {series.planningError}
        </p>
      )}
    </Link>
  );
}
