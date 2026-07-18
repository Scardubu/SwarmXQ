"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { EpisodeCard } from "./EpisodeCard";
import type { SeriesJob } from "@swarmx/types/series-types";

interface EpisodeGridProps {
  series: SeriesJob;
  onProduce: (episodeNumber: number) => Promise<void>;
  onPrepare: (episodeNumber: number) => Promise<void>;
  jobStatuses?: Record<number, string>; // episodeNumber → job status string
}

export function EpisodeGrid({ series, onProduce, onPrepare, jobStatuses = {} }: EpisodeGridProps) {
  const [producingEpisode, setProducingEpisode] = useState<number | null>(null);
  const roadmap = series.episodeRoadmap ?? [];
  const preProductionMap = series.preProduction ?? {};

  if (roadmap.length === 0) {
    return (
      <div className="flex items-center justify-center rounded border border-dashed border-border py-8 text-sm text-text-muted">
        Episode roadmap is being generated…
      </div>
    );
  }

  async function handleProduce(episodeNumber: number) {
    setProducingEpisode(episodeNumber);
    try {
      await onProduce(episodeNumber);
    } finally {
      setProducingEpisode(null);
    }
  }

  return (
    <div
      className={cn(
        "grid gap-3",
        "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
      )}
      aria-label={`Episode list: ${roadmap.length} episodes`}
    >
      {roadmap.map((episode) => {
        const jobId = series.videoJobIds[episode.episodeNumber];
        const jobStatus = jobStatuses[episode.episodeNumber];
        return (
          <EpisodeCard
            key={episode.episodeNumber}
            episode={episode}
            seriesId={series.id}
            {...(jobId !== undefined ? { jobId } : {})}
            {...(jobStatus !== undefined ? { jobStatus } : {})}
            onProduce={handleProduce}
            onPrepare={onPrepare}
            isProducing={producingEpisode === episode.episodeNumber}
            {...(preProductionMap[episode.episodeNumber] !== undefined
              ? { preProduction: preProductionMap[episode.episodeNumber] }
              : {})}
          />
        );
      })}
    </div>
  );
}
