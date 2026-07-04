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
import { useVideoStore } from "../../../stores/video";
import { VideoJobForm } from "../../../components/video/VideoJobForm";
import { VideoJobCard } from "../../../components/video/VideoJobCard";
import { VideoJobTimeline } from "../../../components/video/VideoJobTimeline";
import { ViralityMeter } from "../../../components/video/ViralityMeter";
import { CaptionEditor } from "../../../components/video/CaptionEditor";
import { PlatformPublishPanel } from "../../../components/video/PlatformPublishPanel";
import type { ViralitySignal, VideoExportPlatform } from "@swarmx/types/video-types";

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

// ─── Detail Panel ─────────────────────────────────────────────────────────────
// Module-scope: not nested inside VideoPage

function VideoJobDetailPanel() {
  const { selectedJob, selectJob, fetchJobDetail, publishJob } = useVideoStore((s) => ({
    selectedJob: s.selectedJob(),
    selectJob: s.selectJob,
    fetchJobDetail: s.fetchJobDetail,
    publishJob: s.publishJob,
  }));

  const [viralityOverride, setViralityOverride] = useState<ViralitySignal | null>(null);
  const [showCaptionEditor, setShowCaptionEditor] = useState(false);

  useEffect(() => {
    if (!selectedJob) return;
    void fetchJobDetail(selectedJob.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchJobDetail, selectedJob?.id]);

  useEffect(() => {
    setShowCaptionEditor(false);
    setViralityOverride(null);
  }, [selectedJob?.id]);

  const viralitySignal = viralityOverride ?? selectedJob?.viralitySignal ?? null;
  const captionDraft = viralitySignal?.captionDraft ?? null;
  const publishHistory = selectedJob?.publishHistory ?? selectedJob?.outputArtifacts?.publishHistory ?? [];

  const handlePublish = useCallback(
    async (platform: VideoExportPlatform, scheduledAt?: string) => {
      if (!selectedJob) return null;
      return publishJob(selectedJob.id, {
        platform,
        ...(scheduledAt ? { scheduledAt } : {}),
      });
    },
    [publishJob, selectedJob],
  );

  if (!selectedJob) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8 py-12">
        <div className="w-12 h-12 rounded-2xl bg-zinc-800/60 border border-zinc-700 flex items-center justify-center">
          <svg className="w-6 h-6 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.362a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </div>
        <p className="text-sm text-zinc-600">Select a job to view details</p>
      </div>
    );
  }

  const isDone = selectedJob.status === "completed";
  const isFailed = selectedJob.status === "failed";

  return (
    <div className="relative flex flex-col gap-5 p-5">
      {/* Completion confetti (pure CSS, 1.5s, no external deps) */}
      {isDone && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          {Array.from({ length: 18 }, (_, i) => (
            <span
              key={i}
              className="absolute rounded-full opacity-70"
              style={{
                width: `${6 + (i % 5) * 2}px`,
                height: `${6 + (i % 4) * 2}px`,
                left: `${5 + (i * 5.3) % 90}%`,
                top: `${5 + (i * 7.1) % 50}%`,
                background: ["#f59e0b","#10b981","#6366f1","#ec4899","#3b82f6","#f97316"][i % 6],
                animation: `confettiFall ${0.8 + (i % 4) * 0.2}s ease-out forwards`,
                animationDelay: `${(i % 5) * 0.1}s`,
              }}
            />
          ))}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start gap-3">
        <button
          onClick={() => selectJob(null)}
          className="mt-0.5 p-1 rounded-md text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          aria-label="Close detail"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-mono text-zinc-600 truncate">{selectedJob.id}</p>
          <p className="mt-0.5 text-sm font-medium text-zinc-200 leading-snug line-clamp-3">
            {selectedJob.request.prompt}
          </p>
        </div>
      </div>

      {/* Stage timeline */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
          Stage Timeline
        </h3>
        <VideoJobTimeline job={selectedJob} compact={false} />
      </div>

      {/* Failure notice */}
      {isFailed && (
        <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-red-300">Job failed</p>
            {selectedJob.error && (
              <p className="text-[10px] font-mono text-zinc-500 mt-0.5">
                {selectedJob.error.code}: {selectedJob.error.message}
              </p>
            )}
          </div>
          {selectedJob.error?.retryable && (
            <span className="text-[10px] text-amber-500 border border-amber-700/40 rounded px-2 py-0.5">
              Will retry automatically
            </span>
          )}
        </div>
      )}

      {/* Output preview */}
      {isDone && selectedJob.output && (
        <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/30 p-4 flex flex-col gap-3">
          <h3 className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Output</h3>
          <video
            src={selectedJob.output.publicUrl}
            controls
            playsInline
            className="w-full rounded-lg bg-black max-h-64 object-contain"
          />
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Duration", value: `${selectedJob.output.durationSeconds.toFixed(0)}s` },
              { label: "Size", value: `${(selectedJob.output.fileSizeBytes / 1024 / 1024).toFixed(1)} MB` },
              { label: "Resolution", value: `${selectedJob.output.widthPx}×${selectedJob.output.heightPx}` },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-lg bg-zinc-900/60 px-2 py-2">
                <p className="text-[10px] text-zinc-600">{label}</p>
                <p className="text-xs font-semibold text-zinc-300 font-mono">{value}</p>
              </div>
            ))}
          </div>
          <a
            href={selectedJob.output.publicUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 rounded-lg bg-emerald-800/50 border border-emerald-700/50 text-emerald-300 text-xs font-semibold py-2.5 hover:bg-emerald-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download
          </a>
        </div>
      )}

      {/* Virality meter */}
      {viralitySignal && (
        <ViralityMeter
          signal={viralitySignal}
          {...(captionDraft ? { onImprove: () => setShowCaptionEditor(true) } : {})}
        />
      )}

      {/* Caption editor toggle */}
      {captionDraft && !showCaptionEditor && (
        <button
          type="button"
          onClick={() => setShowCaptionEditor(true)}
          className="w-full rounded-xl border border-cyan-900/40 bg-cyan-950/10 py-3 text-xs font-semibold text-cyan-300 hover:bg-cyan-950/20 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-500"
        >
          Edit Caption Draft
        </button>
      )}

      {/* Caption editor */}
      {captionDraft && showCaptionEditor && (
        <CaptionEditor
          jobId={selectedJob.id}
          initialDraft={captionDraft}
          {...(selectedJob.request.platform && selectedJob.request.platform !== "youtube_shorts"
            ? { platform: selectedJob.request.platform as VideoExportPlatform }
            : selectedJob.request.platform === "youtube_shorts"
            ? { platform: "shorts" as VideoExportPlatform }
            : {})}
          onSignalUpdate={(sig) => setViralityOverride(sig)}
        />
      )}

      {/* Publish panel */}
      {isDone && (
        <PlatformPublishPanel
          jobId={selectedJob.id}
          publishHistory={publishHistory}
          onPublish={handlePublish}
        />
      )}

      {/* Operator trace */}
      {selectedJob.operatorTrace && selectedJob.operatorTrace.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
            Operator Trace
          </h3>
          <div className="space-y-1">
            {selectedJob.operatorTrace.map((entry, idx) => (
              <div key={idx} className="flex items-center justify-between gap-4 text-[10px]">
                <span className="text-zinc-500 capitalize">
                  {String(entry.stage).replace(/_/g, " ")}
                </span>
                <span className="text-zinc-600 font-mono truncate max-w-[10rem]">{entry.operator}</span>
                <span className="text-zinc-600 font-mono shrink-0">{((entry.latencyMs ?? 0) / 1000).toFixed(1)}s</span>
                <span className="text-zinc-700 font-mono shrink-0">{entry.tokenCount ?? 0}t</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Models used */}
      {selectedJob.output?.modelsUsed && Object.keys(selectedJob.output.modelsUsed).length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
            Models Used
          </h3>
          <dl className="space-y-1">
            {Object.entries(selectedJob.output.modelsUsed).map(([stage, model]) => (
              <div key={stage} className="flex items-center justify-between gap-4">
                <dt className="text-[10px] text-zinc-600 capitalize">{stage.replace(/_/g, " ")}</dt>
                <dd className="text-[10px] font-mono text-zinc-400">{model as string}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* Script */}
      {selectedJob.output?.scriptText && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
            Generated Script
          </h3>
          <pre className="text-xs text-zinc-400 leading-relaxed whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">
            {selectedJob.output.scriptText}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function VideoPage() {
  const { fetchJobs, listJobs, isLoading, listError, selectJob, selectedJobId, reorderQueue, retryFromStage } =
    useVideoStore();
  const [draggedJobId, setDraggedJobId] = useState<string | null>(null);

  useEffect(() => {
    void fetchJobs();
  }, [fetchJobs]);

  const handleSubmitted = useCallback(
    (jobId: string) => { selectJob(jobId); },
    [selectJob],
  );

  const jobs = listJobs();
  const hasJobs = jobs.length > 0;
  const queuedJobs = jobs.filter((job) => job.status === "queued");

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

      const ordered = [...queuedJobs];
      const fromIndex = ordered.findIndex((job) => job.id === draggedJobId);
      const toIndex = ordered.findIndex((job) => job.id === targetJobId);
      if (fromIndex < 0 || toIndex < 0) {
        setDraggedJobId(null);
        return;
      }

      const [moved] = ordered.splice(fromIndex, 1);
      if (!moved) {
        setDraggedJobId(null);
        return;
      }

      ordered.splice(toIndex, 0, moved);
      await reorderQueue(ordered.map((job) => job.id));
      setDraggedJobId(null);
    },
    [draggedJobId, queuedJobs, reorderQueue],
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
                className={job.status === "queued" ? "cursor-grab" : ""}
              >
                <VideoJobCard
                  job={job}
                  onSelect={selectJob}
                  isSelected={selectedJobId === job.id}
                />
                {job.status === "failed" && (
                  <button
                    type="button"
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

        {/* Right: detail panel */}
        <div className="flex-1 overflow-y-auto min-w-0">
          <VideoJobDetailPanel />
        </div>
      </div>
    </div>
  );
}
