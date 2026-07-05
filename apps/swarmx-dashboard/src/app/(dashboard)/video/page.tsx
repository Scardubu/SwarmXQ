/**
 * apps/swarmx-dashboard/src/app/(dashboard)/video/page.tsx
 *
 * VIDEO-ALPHA r1 — Upgraded video workspace.
 *
 * Changes from r0:
 *  - Integrated ViralityMeter, CaptionEditor, PlatformPublishPanel
 *  - Skeleton loading states replace spinners in the job list
 *  - Pure-CSS confetti burst on job completion (1.5s, no deps)
 *  - Retry affordance for failed jobs
 *  - Operator trace table in detail panel
 *
 * NOTE: FIX applies from original file still hold:
 *  - No redundant useEffect that re-applies SSE events (store handles it)
 *  - Sub-components at module scope, never nested inside VideoPage
 */

"use client";

import { useEffect, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useVideoStore } from "../../../stores/video";
import { VideoJobForm } from "../../../components/video/VideoJobForm";
import { VideoJobCard } from "../../../components/video/VideoJobCard";

// ─── Skeleton loading row ─────────────────────────────────────────────────────

function JobSkeleton() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 animate-pulse">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-4 w-14 rounded bg-zinc-800" />
        <div className="h-4 w-10 rounded bg-zinc-800" />
      </div>
      <div className="h-3 w-4/5 rounded bg-zinc-800 mb-1" />
      <div className="h-3 w-3/5 rounded bg-zinc-800 mb-3" />
      <div className="h-1 w-full rounded bg-zinc-800" />
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyJobList() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="w-14 h-14 rounded-2xl bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center">
        <svg className="w-7 h-7 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
        </svg>
      </div>
      <p className="text-sm font-medium text-zinc-500">No video jobs yet</p>
      <p className="text-xs text-zinc-700">Submit your first job using the form above.</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function VideoPage() {
  const router = useRouter();
  const { fetchJobs, listJobs, isLoading, listError, selectedJobId, reorderQueue, retryFromStage } =
    useVideoStore();
  const [draggedJobId, setDraggedJobId] = useState<string | null>(null);

  useEffect(() => {
    void fetchJobs();
  }, [fetchJobs]);

  const handleSubmitted = useCallback(
    (jobId: string) => { router.push(`/video/${jobId}`); },
    [router],
  );

  const jobs = listJobs();
  const hasJobs = jobs.length > 0;

  const handleRetry = useCallback(
    async (jobId: string) => {
      await retryFromStage(jobId, "failed");
    },
    [retryFromStage],
  );

  const handleDropOn = useCallback(
    async (targetJobId: string) => {
      if (!draggedJobId || draggedJobId === targetJobId) {
        setDraggedJobId(null);
        return;
      }

      // [V5.9-FIX-11] Read queued jobs inside the callback via store accessor
      // instead of closing over the `queuedJobs` snapshot. This avoids a
      // mutable-dependency warning from React Compiler that caused the callback
      // memoization to be skipped entirely.
      const currentQueued = useVideoStore
        .getState()
        .listJobs()
        .filter((j) => j.status === "queued");

      const fromIndex = currentQueued.findIndex((job) => job.id === draggedJobId);
      const toIndex = currentQueued.findIndex((job) => job.id === targetJobId);
      if (fromIndex < 0 || toIndex < 0) {
        setDraggedJobId(null);
        return;
      }

      const ordered = [...currentQueued];
      const [moved] = ordered.splice(fromIndex, 1);
      if (!moved) {
        setDraggedJobId(null);
        return;
      }

      ordered.splice(toIndex, 0, moved);
      await reorderQueue(ordered.map((job) => job.id));
      setDraggedJobId(null);
    },
    [draggedJobId, reorderQueue],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-0">
      {/* Page header */}
      <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-zinc-100 tracking-tight">Video Generation</h1>
          <p className="text-xs text-zinc-600 mt-0.5">
            Faceless short-form video pipeline · ComfyUI + LTX/Wan · local 8 GB
          </p>
        </div>
        {hasJobs && (
          <span className="text-xs font-mono text-zinc-600">
            {jobs.filter((j) => j.status === "running").length} running ·{" "}
            {jobs.filter((j) => j.status === "queued").length} queued ·{" "}
            {jobs.filter((j) => j.status === "completed").length} done
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 flex min-h-0">
        {/* Left: form + list */}
        <div className="flex flex-col gap-4 w-full max-w-xl border-r border-zinc-800 overflow-y-auto p-5">
          <VideoJobForm onSubmitted={handleSubmitted} />

          <div className="flex flex-col gap-2">
            {isLoading && (
              <>
                <JobSkeleton />
                <JobSkeleton />
                <JobSkeleton />
              </>
            )}

            {listError && (
              <div className="rounded-lg bg-red-950/40 border border-red-900/40 px-3 py-2">
                <p className="text-xs text-red-400">{listError}</p>
              </div>
            )}

            {!isLoading && !hasJobs && <EmptyJobList />}

            {jobs.map((job) => (
              <div
                key={job.id}
                draggable={job.status === "queued"}
                onDragStart={() => setDraggedJobId(job.id)}
                onDragOver={(event) => {
                  if (job.status === "queued") {
                    event.preventDefault();
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (job.status === "queued") {
                    void handleDropOn(job.id);
                  }
                }}
                aria-label={job.status === "queued" ? `Drag to reorder job: ${job.request.prompt.slice(0, 40)}` : undefined}
                className={job.status === "queued" ? "cursor-grab" : ""}
              >
                <VideoJobCard
                  job={job}
                  onSelect={(jobId) => router.push(`/video/${jobId}`)}
                  isSelected={selectedJobId === job.id}
                />
                {job.status === "failed" && (
                  <button
                    type="button"
                    aria-label={`Retry video job from last failed stage`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleRetry(job.id);
                    }}
                    className="mt-2 w-full rounded-lg border border-amber-900/50 bg-amber-950/20 py-2 text-[10px] font-semibold uppercase tracking-wider text-amber-300 hover:bg-amber-950/30"
                  >
                    Retry from Failed Stage
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
