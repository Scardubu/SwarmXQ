/**
 * apps/swarmx-dashboard/src/components/video/VideoJobTimeline.tsx
 *
 * FIX: Previously defined but never consumed — VideoJobCard duplicated
 * equivalent inline logic. This file is now the canonical timeline renderer.
 * VideoJobCard imports and uses this component; no inline duplication.
 */

"use client";

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
      <svg className="w-3.5 h-3.5 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  if (state === "error") {
    return (
      <svg className="w-3.5 h-3.5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  if (state === "active") {
    return (
      <span className="relative flex h-3.5 w-3.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-amber-500" />
      </span>
    );
  }
  return (
    <span className="h-3.5 w-3.5 rounded-full border-2 border-zinc-600 bg-zinc-800" />
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
    <div className="h-0.5 w-full bg-zinc-700 rounded-full overflow-hidden">
      <div
        className="h-full bg-gradient-to-r from-amber-500 to-emerald-400 rounded-full transition-all duration-500"
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
          <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ease-out ${
                job.status === "completed"
                  ? "bg-emerald-500"
                  : job.status === "failed"
                  ? "bg-red-500"
                  : job.status === "cancelled"
                  ? "bg-zinc-500"
                  : "bg-gradient-to-r from-amber-500 via-orange-400 to-emerald-400"
              }`}
              style={{ width: `${job.overallProgress}%` }}
            />
          </div>
        </div>
        <span className="text-xs font-mono text-zinc-400 tabular-nums w-8 text-right">
          {job.overallProgress}%
        </span>
      </div>

      {/* Stage list */}
      {!compact && (
        <ol className="relative ml-2 border-l border-zinc-800 space-y-3 py-1">
          {VIDEO_JOB_STAGE_ORDER.map((stage) => {
            const state = resolveState(job, stage);
            const stageData = job.stages[stage];
            const label = VIDEO_JOB_STAGE_LABELS[stage];

            return (
              <li key={stage} className="ml-4 group">
                {/* Connector dot */}
                <span className="absolute -left-[9px] flex items-center justify-center">
                  <StageIcon state={state} />
                </span>

                <div className="flex items-baseline justify-between gap-4">
                  <p
                    className={`text-xs font-medium leading-tight ${
                      state === "complete"
                        ? "text-zinc-400 line-through decoration-zinc-600"
                        : state === "active"
                        ? "text-amber-300"
                        : state === "error"
                        ? "text-red-400"
                        : "text-zinc-600"
                    }`}
                  >
                    {label}
                  </p>
                  {stageData?.durationMs != null && (
                    <span className="shrink-0 text-[10px] font-mono text-zinc-600">
                      {(stageData.durationMs / 1000).toFixed(1)}s
                    </span>
                  )}
                </div>

                {/* Per-stage progress bar (only when active) */}
                {state === "active" && stageData && stageData.stageProgress < 100 && (
                  <div className="mt-1">
                    <StageProgressBar progress={stageData.stageProgress} />
                    {stageData.message && (
                      <p className="mt-0.5 text-[10px] text-zinc-500 truncate">
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
        <p className="text-[10px] text-amber-400 font-medium truncate">
          ↳ {VIDEO_JOB_STAGE_LABELS[job.currentStage]}
          {job.stages[job.currentStage]?.stageProgress != null &&
            ` (${job.stages[job.currentStage]!.stageProgress}%)`}
        </p>
      )}

      {/* Error message */}
      {job.status === "failed" && job.error && (
        <div className="mt-1 rounded-md bg-red-950/50 border border-red-900/50 px-2.5 py-1.5">
          <p className="text-xs text-red-400 font-mono leading-snug">
            {job.error.code}: {job.error.message}
          </p>
          {job.error.retryable && (
            <p className="text-[10px] text-red-500/70 mt-0.5">Will retry automatically</p>
          )}
        </div>
      )}
    </div>
  );
}