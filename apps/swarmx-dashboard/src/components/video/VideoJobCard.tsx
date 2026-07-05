/**
 * apps/swarmx-dashboard/src/components/video/VideoJobCard.tsx
 *
 * FIX: Previously duplicated VideoJobTimeline logic inline.
 * Now imports and renders <VideoJobTimeline compact /> correctly.
 * VideoJobTimeline is no longer defined-but-never-used dead code.
 */

"use client";

import { useState, useEffect } from "react";
import { useVideoStore } from "../../stores/video";
import { VideoJobTimeline } from "./VideoJobTimeline";
import type { VideoJob } from "../../lib/video-dashboard";

// ─── Props ────────────────────────────────────────────────────────────────────

interface VideoJobCardProps {
  job: VideoJob;
  onSelect?: (jobId: string) => void;
  isSelected?: boolean;
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: VideoJob["status"] }) {
  const map: Record<VideoJob["status"], { label: string; class: string }> = {
    queued: { label: "Queued", class: "bg-zinc-800 text-zinc-400 border-zinc-700" },
    classifying: {
      label: "Classifying",
      class: "bg-blue-950/60 text-blue-400 border-blue-800/50 animate-pulse",
    },
    scripting: {
      label: "Scripting",
      class: "bg-indigo-950/60 text-indigo-400 border-indigo-800/50 animate-pulse",
    },
    staging: {
      label: "Staging",
      class: "bg-cyan-950/60 text-cyan-400 border-cyan-800/50 animate-pulse",
    },
    generating: {
      label: "Generating",
      class: "bg-amber-950/60 text-amber-400 border-amber-800/50 animate-pulse",
    },
    interpolating: {
      label: "Interpolating",
      class: "bg-orange-950/60 text-orange-400 border-orange-800/50 animate-pulse",
    },
    encoding: {
      label: "Encoding",
      class: "bg-teal-950/60 text-teal-400 border-teal-800/50 animate-pulse",
    },
    reviewing: {
      label: "Reviewing",
      class: "bg-violet-950/60 text-violet-400 border-violet-800/50 animate-pulse",
    },
    publishing: {
      label: "Publishing",
      class: "bg-fuchsia-950/60 text-fuchsia-400 border-fuchsia-800/50 animate-pulse",
    },
    running: {
      label: "Running",
      class: "bg-amber-950/60 text-amber-400 border-amber-800/50 animate-pulse",
    },
    done: {
      label: "Done",
      class: "bg-emerald-950/60 text-emerald-400 border-emerald-800/50",
    },
    completed: {
      label: "Done",
      class: "bg-emerald-950/60 text-emerald-400 border-emerald-800/50",
    },
    failed: { label: "Failed", class: "bg-red-950/60 text-red-400 border-red-800/50" },
    cancelled: {
      label: "Cancelled",
      class: "bg-zinc-900 text-zinc-500 border-zinc-700",
    },
  };

  const { label, class: cls } = map[status];
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${cls}`}
    >
      {label}
    </span>
  );
}

// ─── Platform Icon ────────────────────────────────────────────────────────────

function PlatformTag({ platform }: { platform?: string }) {
  if (!platform || platform === "generic") return null;
  const labels: Record<string, string> = {
    tiktok: "TikTok",
    youtube_shorts: "YT Shorts",
    reels: "Reels",
  };
  return (
    <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">
      {labels[platform] ?? platform}
    </span>
  );
}

function PublishSummary({ job }: { job: VideoJob }) {
  const history = job.publishHistory ?? job.outputArtifacts?.publishHistory ?? [];
  if (history.length === 0) return null;

  const latest = history[0];
  if (!latest) return null;

  const labelMap: Record<string, string> = {
    pending_review: "Pending review",
    scheduled: "Scheduled",
    published: "Published",
    failed: "Publish failed",
  };

  return (
    <div className="rounded-lg border border-fuchsia-900/40 bg-fuchsia-950/20 px-2.5 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] uppercase tracking-wider text-fuchsia-300">Publish</span>
        <span className="text-[10px] font-medium text-zinc-400">{history.length} event{history.length === 1 ? "" : "s"}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-zinc-200">{labelMap[latest.status] ?? latest.status}</span>
        <span className="uppercase tracking-wider text-zinc-500">{latest.platform}</span>
      </div>
    </div>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export function VideoJobCard({ job, onSelect, isSelected }: VideoJobCardProps) {
  const cancelJob = useVideoStore((s) => s.cancelJob);

  const canCancel = job.status === "queued" || job.status === "running";
  const isComplete = job.status === "completed";

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    void cancelJob(job.id);
  };

  // [V5.9-FIX-10] Avoid impure Date.now() during render (React Compiler rule).
  // Track current time in state, updating every second while the job is running.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (job.status !== "running" || !job.startedAt) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [job.status, job.startedAt]);

  const elapsed = job.startedAt
    ? Math.round((nowMs - Date.parse(job.startedAt)) / 1000)
    : null;

  return (
    <article
      className={`
        group relative flex flex-col gap-3 rounded-xl border bg-zinc-900/80 p-4
        cursor-pointer transition-all duration-200
        hover:border-zinc-600 hover:bg-zinc-900
        ${isSelected
          ? "border-amber-700/60 ring-1 ring-amber-700/30 bg-zinc-900"
          : "border-zinc-800"
        }
      `}
      onClick={() => onSelect?.(job.id)}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={job.status} />
            <PlatformTag {...(job.request.platform !== undefined ? { platform: job.request.platform } : {})} />
            {job.request.niche && (
              <span className="text-[10px] text-zinc-600 font-medium">
                #{job.request.niche}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-sm text-zinc-200 font-medium leading-snug line-clamp-2">
            {job.request.prompt}
          </p>
        </div>

        {/* Actions */}
        <div className="shrink-0 flex items-center gap-1.5">
          {canCancel && (
            <button
              onClick={handleCancel}
              className="
                p-1 rounded-md text-zinc-500 hover:text-red-400 hover:bg-red-950/40
                transition-colors duration-150 opacity-0 group-hover:opacity-100
              "
              title="Cancel job"
              aria-label="Cancel video job"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          {isComplete && job.output?.publicUrl && (
            <a
              href={job.output.publicUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="
                p-1 rounded-md text-zinc-500 hover:text-emerald-400 hover:bg-emerald-950/40
                transition-colors duration-150 opacity-0 group-hover:opacity-100
              "
              title="Download video"
              aria-label="Download generated video"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </a>
          )}
        </div>
      </div>

      {/* Timeline — uses VideoJobTimeline (compact mode) */}
      {/* FIX: No more duplicated inline stage rendering logic here */}
      <VideoJobTimeline job={job} compact />

      <PublishSummary job={job} />

      {/* Footer metadata */}
      <div className="flex items-center gap-3 text-[10px] text-zinc-600 font-mono">
        <span title="Job ID" className="truncate max-w-[8rem]">
          {job.id.slice(0, 8)}…
        </span>
        {job.retryCount > 0 && (
          <span className="text-amber-700">retry #{job.retryCount}</span>
        )}
        {elapsed != null && job.status === "running" && (
          <span className="ml-auto">{elapsed}s elapsed</span>
        )}
        {job.completedAt && (
          <span className="ml-auto">
            {new Date(job.completedAt).toLocaleTimeString()}
          </span>
        )}
        {job.output && (
          <span>
            {(job.output.fileSizeBytes / 1024 / 1024).toFixed(1)} MB ·{" "}
            {job.output.durationSeconds.toFixed(0)}s
          </span>
        )}
      </div>
    </article>
  );
}