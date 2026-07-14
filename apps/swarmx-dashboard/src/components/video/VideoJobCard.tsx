/**
 * apps/swarmx-dashboard/src/components/video/VideoJobCard.tsx
 *
 * FIX: Previously duplicated VideoJobTimeline logic inline.
 * Now imports and renders <VideoJobTimeline compact /> correctly.
 * VideoJobTimeline is no longer defined-but-never-used dead code.
 */

"use client";

import { useState, useEffect } from "react";
import { Download, X } from "lucide-react";
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

const STATUS_MAP: Record<VideoJob["status"], { label: string; className: string }> = {
  queued: { label: "Queued", className: "border-status-queued/35 bg-status-queued/10 text-status-queued" },
  classifying: {
    label: "Classifying",
    className: "border-status-reload/35 bg-status-reload/10 text-status-reload animate-pulse",
  },
  scripting: {
    label: "Scripting",
    className: "border-status-throttled/35 bg-status-throttled/10 text-status-throttled animate-pulse",
  },
  staging: {
    label: "Staging",
    className: "border-status-reload/35 bg-status-reload/10 text-status-reload animate-pulse",
  },
  generating: {
    label: "Generating",
    className: "border-status-active/35 bg-status-active/10 text-status-active animate-pulse",
  },
  interpolating: {
    label: "Interpolating",
    className: "border-status-warning/35 bg-status-warning/10 text-status-warning animate-pulse",
  },
  encoding: {
    label: "Encoding",
    className: "border-status-active/35 bg-status-active/10 text-status-active animate-pulse",
  },
  reviewing: {
    label: "Reviewing",
    className: "border-status-throttled/35 bg-status-throttled/10 text-status-throttled animate-pulse",
  },
  publishing: {
    label: "Publishing",
    className: "border-status-throttled/35 bg-status-throttled/10 text-status-throttled animate-pulse",
  },
  running: {
    label: "Running",
    className: "border-status-active/35 bg-status-active/10 text-status-active animate-pulse",
  },
  done: {
    label: "Done",
    className: "border-status-success/35 bg-status-success/10 text-status-success",
  },
  completed: {
    label: "Done",
    className: "border-status-success/35 bg-status-success/10 text-status-success",
  },
  failed: { label: "Failed", className: "border-status-error/35 bg-status-error/10 text-status-error" },
  cancelled: {
    label: "Cancelled",
    className: "border-border bg-bg-surface text-text-muted",
  },
};

function StatusBadge({ status }: { status: VideoJob["status"] }) {
  const { label, className } = STATUS_MAP[status];
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${className}`}
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
    <span className="font-mono text-[10px] font-medium uppercase tracking-wide text-text-muted">
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
    <div className="rounded border border-status-throttled/35 bg-status-throttled/10 px-2.5 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-wide text-status-throttled">Publish</span>
        <span className="text-[10px] font-medium text-text-muted">{history.length} event{history.length === 1 ? "" : "s"}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-text-primary">{labelMap[latest.status] ?? latest.status}</span>
        <span className="font-mono uppercase tracking-wide text-text-muted">{latest.platform}</span>
      </div>
    </div>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export function VideoJobCard({ job, onSelect, isSelected }: VideoJobCardProps) {
  const cancelJob = useVideoStore((s) => s.cancelJob);

  const canCancel = job.status === "queued" || job.status === "running";
  const isComplete = job.status === "completed";

  const handleCancel = () => {
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
        group relative rounded border bg-bg-elevated/80 transition-all duration-200
        hover:border-border-active hover:bg-bg-elevated
        ${isSelected
          ? "border-border-accent ring-1 ring-accent/25 bg-bg-elevated"
          : "border-border"
        }
      `}
    >
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
        {canCancel && (
          <button
            type="button"
            onClick={handleCancel}
            className="
              rounded p-1 text-text-muted hover:bg-status-error/10 hover:text-status-error
              transition-colors duration-150 opacity-0 group-hover:opacity-100 focus-visible:opacity-100
              focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-status-error
            "
            title="Cancel job"
            aria-label={`Cancel job: ${job.request.prompt.slice(0, 40)}`}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
        {isComplete && job.output?.publicUrl && (
          <a
            href={job.output.publicUrl}
            target="_blank"
            rel="noreferrer"
            className="
              rounded p-1 text-text-muted hover:bg-status-success/10 hover:text-status-success
              transition-colors duration-150 opacity-0 group-hover:opacity-100 focus-visible:opacity-100
              focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-status-success
            "
            title="Download video"
            aria-label={`Download video: ${job.request.prompt.slice(0, 40)}`}
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
      </div>

      <button
        type="button"
        aria-label={`Open video job: ${job.request.prompt.slice(0, 60)}`}
        className="
          flex w-full cursor-pointer flex-col gap-3 rounded p-4 pr-14 text-left
          focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent
        "
        onClick={() => onSelect?.(job.id)}
      >
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={job.status} />
              <PlatformTag {...(job.request.platform !== undefined ? { platform: job.request.platform } : {})} />
              {job.request.niche && (
                <span className="text-[10px] font-medium text-text-muted">
                  #{job.request.niche}
                </span>
              )}
            </div>
            <p className="mt-1.5 line-clamp-2 text-sm font-medium leading-snug text-text-primary">
              {job.request.prompt}
            </p>
          </div>
        </div>

        {/* Timeline — uses VideoJobTimeline (compact mode) */}
        {/* FIX: No more duplicated inline stage rendering logic here */}
        <VideoJobTimeline job={job} compact />

        <PublishSummary job={job} />

        {/* Footer metadata */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-text-muted">
          <span title="Job ID" className="max-w-[8rem] truncate">
            {job.id.slice(0, 8)}…
          </span>
          {job.retryCount > 0 && (
            <span className="text-status-warning">retry #{job.retryCount}</span>
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
      </button>
    </article>
  );
}
