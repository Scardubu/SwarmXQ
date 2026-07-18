"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Film, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SeriesCard } from "@/components/series/SeriesCard";
import { useSeriesStore } from "@/stores/series";

function SeriesListSkeleton() {
  return (
    <>
      {Array.from({ length: 3 }, (_, i) => (
        <div
          key={i}
          className="animate-pulse rounded border border-border bg-bg-elevated/60 p-4"
          role="status"
          aria-label="Loading series"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="h-4 w-40 rounded bg-bg-input" />
            <div className="h-4 w-16 rounded bg-bg-input" />
          </div>
          <div className="mb-3 h-3 w-3/5 rounded bg-bg-input" />
          <div className="h-1.5 w-full rounded bg-bg-input" />
        </div>
      ))}
    </>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded border border-dashed border-border bg-bg-surface/50 px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded border border-border bg-bg-elevated">
        <Film className="h-7 w-7 text-text-muted" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-text-secondary">No series yet</p>
        <p className="max-w-72 text-xs leading-5 text-text-muted">
          Create a series to generate a character bible, world guide, and multi-episode roadmap from a single story brief.
        </p>
      </div>
      <Button asChild variant="accent" size="lg">
        <Link href="/series/new">
          <Plus className="h-4 w-4" aria-hidden="true" />
          New Series
        </Link>
      </Button>
    </div>
  );
}

export default function SeriesListPage() {
  const { fetchSeries, listSeries, isLoading, listError } = useSeriesStore((s) => ({
    fetchSeries: s.fetchSeries,
    listSeries: s.listSeries,
    isLoading: s.isLoading,
    listError: s.listError,
  }));

  useEffect(() => {
    void fetchSeries();
  }, [fetchSeries]);

  const series = listSeries();

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border bg-bg-surface/80 px-4 py-4 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Film className="h-5 w-5 text-accent" aria-hidden="true" />
              <h1 className="text-base font-semibold tracking-tight text-text-primary">Series</h1>
            </div>
            <p className="mt-1 text-xs leading-5 text-text-secondary">
              Multi-episode AI series — one brief generates a character bible, world guide, and full episode roadmap.
            </p>
          </div>
          <Button asChild variant="accent" size="default">
            <Link href="/series/new">
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">New Series</span>
            </Link>
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-4 py-5 sm:px-6">
        {listError && (
          <div
            className="mb-4 rounded border border-status-error/35 bg-status-error/10 px-3 py-2 text-xs text-status-error"
            role="alert"
          >
            {listError}
          </div>
        )}

        {isLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SeriesListSkeleton />
          </div>
        ) : series.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {series.map((s) => (
              <SeriesCard key={s.id} series={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
