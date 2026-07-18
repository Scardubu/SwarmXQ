"use client";

import { useCallback, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Film, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SeriesContextPanel } from "@/components/series/SeriesContextPanel";
import { EpisodeGrid } from "@/components/series/EpisodeGrid";
import { useSeriesStore } from "@/stores/series";
import type { SeriesJob } from "@swarmx/types/series-types";

// ─── Status badge ─────────────────────────────────────────────────────────────

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

// ─── Skeleton for planning state ──────────────────────────────────────────────

function PlanningProgressSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[1, 2].map((n) => (
        <div key={n} className="animate-pulse rounded border border-border bg-bg-surface p-3">
          <div className="mb-2 h-4 w-36 rounded bg-bg-input" />
          <div className="space-y-1.5">
            <div className="h-3 w-full rounded bg-bg-input" />
            <div className="h-3 w-4/5 rounded bg-bg-input" />
            <div className="h-3 w-3/5 rounded bg-bg-input" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 4_000;

export default function SeriesDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? "";

  const fetchSeriesDetail = useSeriesStore((s) => s.fetchSeriesDetail);
  const produceEpisode   = useSeriesStore((s) => s.produceEpisode);
  const prepareEpisode   = useSeriesStore((s) => s.prepareEpisode);
  const series = useSeriesStore((s) => s.series.get(id));

  // Initial fetch
  useEffect(() => {
    if (!id) return;
    void fetchSeriesDetail(id);
  }, [id, fetchSeriesDetail]);

  // Poll while planning is in progress
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!id) return;
    if (series?.status === "planning") {
      pollRef.current = setInterval(() => {
        void fetchSeriesDetail(id);
      }, POLL_INTERVAL_MS);
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [id, series?.status, fetchSeriesDetail]);

  const handleProduce = useCallback(
    async (episodeNumber: number) => {
      await produceEpisode(id, episodeNumber);
    },
    [id, produceEpisode],
  );

  const handlePrepare = useCallback(
    async (episodeNumber: number) => {
      await prepareEpisode(id, episodeNumber);
    },
    [id, prepareEpisode],
  );

  // Build jobStatuses map for EpisodeGrid
  const jobStatuses: Record<number, string> = {};

  if (!series) {
    return (
      <div className="flex h-full items-center justify-center" aria-busy="true" aria-label="Loading series">
        <div className="animate-pulse rounded border border-border bg-bg-elevated p-8 text-sm text-text-muted">
          Loading series…
        </div>
      </div>
    );
  }

  const statusStyle = STATUS_MAP[series.status];
  const isPlanning = series.status === "planning";
  const totalEpisodes = series.brief.seriesLength;
  const producedCount = Object.keys(series.videoJobIds).length;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border bg-bg-surface/95 px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => router.push("/series")}
              className="shrink-0"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Series
            </Button>
            <div className="flex min-w-0 items-center gap-2">
              <Film className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
              <span className="truncate text-sm font-semibold text-text-primary">
                {series.brief.storyTheme}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className={cn(
                "rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide",
                statusStyle.className,
              )}
              aria-label={`Status: ${statusStyle.label}`}
            >
              {statusStyle.label}
            </span>
            <span className="rounded border border-border px-2 py-0.5 font-mono text-[10px] uppercase text-text-muted">
              {series.brief.tone.replace(/_/g, " ")}
            </span>
            <span className="font-mono text-[10px] text-text-muted tabular-nums">
              {producedCount}/{totalEpisodes} eps
            </span>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-auto px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[320px_1fr]">

          {/* Left — Context panel */}
          <section aria-labelledby="context-panel-heading">
            <h2 id="context-panel-heading" className="mb-3 text-[10px] font-mono uppercase tracking-wider text-text-muted">
              Series Context
            </h2>
            {isPlanning ? (
              <PlanningProgressSkeleton />
            ) : (
              <SeriesContextPanel series={series} />
            )}
          </section>

          {/* Right — Episode grid */}
          <section aria-labelledby="episodes-heading">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="episodes-heading" className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
                Episodes
              </h2>
              {!isPlanning && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void fetchSeriesDetail(id)}
                  aria-label="Refresh series status"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Refresh
                </Button>
              )}
            </div>

            {series.status === "failed" && series.planningError && (
              <div
                className="mb-3 rounded border border-status-error/35 bg-status-error/10 px-3 py-2 text-xs text-status-error"
                role="alert"
              >
                Planning failed: {series.planningError}
              </div>
            )}

            {isPlanning ? (
              <div className="flex items-center gap-2 rounded border border-dashed border-border px-3 py-4 text-sm text-text-muted">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-status-reload" aria-hidden="true" />
                Generating episode roadmap…
              </div>
            ) : (
              <EpisodeGrid
                series={series}
                onProduce={handleProduce}
                onPrepare={handlePrepare}
                jobStatuses={jobStatuses}
              />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
