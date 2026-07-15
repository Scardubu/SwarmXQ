/**
 * apps/swarmx-dashboard/src/components/video/VideoJobTimeline.tsx
 *
 * FIX: Previously defined but never consumed — VideoJobCard duplicated
 * equivalent inline logic. This file is now the canonical timeline renderer.
 * VideoJobCard imports and uses this component; no inline duplication.
 */

"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import type { VideoJob, VideoJobStage } from "../../lib/video-dashboard";
import { VIDEO_JOB_STAGE_ORDER, VIDEO_JOB_STAGE_LABELS } from "../../lib/video-dashboard";

// ─── Props ────────────────────────────────────────────────────────────────────

interface VideoJobTimelineProps {
  job: VideoJob;
  /** Compact mode — fewer labels, tighter spacing. Used in list cards. */
  compact?: boolean;
}

// ─── Stage Icon ───────────────────────────────────────────────────────────────

function StageIcon({ state }: { state: "complete" | "active" | "pending" | "error" }) {
  if (state === "complete") {
    return (
      <>
        <CheckCircle2 className="h-3.5 w-3.5 text-status-success" aria-hidden="true" />
        <span className="sr-only">complete</span>
      </>
    );
  }
  if (state === "error") {
    return (
      <>
        <XCircle className="h-3.5 w-3.5 text-status-error" aria-hidden="true" />
        <span className="sr-only">failed</span>
      </>
    );
  }
  if (state === "active") {
    return (
      <>
        <span className="relative flex h-3.5 w-3.5" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-accent" />
        </span>
        <span className="sr-only">in progress</span>
      </>
    );
  }
  return (
    <>
      <span className="h-3.5 w-3.5 rounded-full border-2 border-border-active bg-bg-input" aria-hidden="true" />
      <span className="sr-only">pending</span>
    </>
  );
}

// ─── Stage State Resolver ─────────────────────────────────────────────────────

function resolveState(
  job: VideoJob,
  stage: VideoJobStage
): "complete" | "active" | "pending" | "error" {
  const stageData = job.stages[stage];
  const isCurrent = job.currentStage === stage;

  if (job.status === "failed" && job.error?.stage === stage) return "error";
  if (stageData?.stageProgress === 100) return "complete";
  if (isCurrent) return "active";
  if (stageData) return "active";
  return "pending";
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function StageProgressBar({ progress }: { progress: number }) {
  return (
    <div className="h-0.5 w-full overflow-hidden rounded-full bg-bg-input">
      <div
        className="h-full rounded-full bg-accent transition-all duration-500"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function VideoJobTimeline({ job, compact = false }: VideoJobTimelineProps) {
  const isTerminal =
    job.status === "completed" ||
    job.status === "failed" ||
    job.status === "cancelled";

  return (
    <div className={compact ? "space-y-1.5" : "space-y-2"}>
      {/* Overall progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="h-1 w-full overflow-hidden rounded-full bg-bg-input">
            <div
              className={`h-full rounded-full transition-all duration-700 ease-out ${
                job.status === "completed"
                  ? "bg-status-success"
                  : job.status === "failed"
                  ? "bg-status-error"
                  : job.status === "cancelled"
                  ? "bg-status-idle"
                  : "bg-accent"
              }`}
              style={{ width: `${job.overallProgress}%` }}
            />
          </div>
        </div>
        <span className="w-8 text-right font-mono text-xs tabular-nums text-text-secondary">
          {job.overallProgress}%
        </span>
      </div>

      {/* Stage list */}
      {!compact && (
        <ol className="relative ml-2 space-y-3 border-l border-border py-1" aria-label="Video job processing stages">
          {VIDEO_JOB_STAGE_ORDER.map((stage) => {
            const state = resolveState(job, stage);
            const stageData = job.stages[stage];
            const label = VIDEO_JOB_STAGE_LABELS[stage];

            return (
              <li
                key={stage}
                className="ml-4 group"
                aria-current={state === "active" ? "step" : undefined}
                aria-label={`Stage ${label}: ${state}`}
              >
                {/* Connector dot */}
                <span className="absolute -left-[9px] flex items-center justify-center">
                  <StageIcon state={state} />
                </span>

                <div className="flex items-baseline justify-between gap-4">
                  <p
                    className={`text-xs font-medium leading-tight ${
                      state === "complete"
                        ? "text-text-muted line-through decoration-border-active"
                        : state === "active"
                        ? "text-accent"
                        : state === "error"
                        ? "text-status-error"
                        : "text-text-muted"
                    }`}
                  >
                    {label}
                  </p>
                  {stageData?.durationMs != null && (
                    <span className="shrink-0 font-mono text-[10px] text-text-muted">
                      {(stageData.durationMs / 1000).toFixed(1)}s
                    </span>
                  )}
                </div>

                {/* Per-stage progress bar (only when active) */}
                {state === "active" && stageData && stageData.stageProgress < 100 && (
                  <div className="mt-1">
                    <StageProgressBar progress={stageData.stageProgress} />
                    {stageData.message && (
                      <p className="mt-0.5 truncate text-[10px] text-text-muted">
                        {stageData.message}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {/* Compact: just show current stage label */}
      {compact && job.currentStage && !isTerminal && (
        <p className="truncate text-[10px] font-medium text-accent">
          {VIDEO_JOB_STAGE_LABELS[job.currentStage]}
          {job.stages[job.currentStage]?.stageProgress != null &&
            ` (${job.stages[job.currentStage]!.stageProgress}%)`}
        </p>
      )}

      {/* Error message */}
      {job.status === "failed" && job.error && (
        <div className="mt-1 rounded border border-status-error/35 bg-status-error/10 px-2.5 py-1.5">
          <p className="font-mono text-xs leading-snug text-status-error">
            {job.error.code}: {job.error.message}
          </p>
          {job.error.retryable && (
            <p className="mt-0.5 text-[10px] text-status-error/75">Will retry automatically</p>
          )}
        </div>
      )}
    </div>
  );
}
