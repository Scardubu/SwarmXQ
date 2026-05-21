"use client";

/**
 * apps/swarmx-dashboard/src/components/video/VideoJobTimeline.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Detailed stage-by-stage timeline for a single video job.
 *
 * Two rendering modes:
 *   - Compact: horizontal dot-and-bar track (used inline in VideoJobCard)
 *   - Full: vertical timeline with timestamps and durations (used in detail view)
 *
 * Accepts either a job summary (from the Zustand store) or a full job detail
 * object (from React Query). When a full detail is present the stage log
 * timestamps are used; otherwise the current status drives the indicator only.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React from "react";
import {
  CheckCircle2,
  Circle,
  XCircle,
  Loader2,
  Clock,
  AlertTriangle,
} from "lucide-react";
import {
  PIPELINE_STAGES,
  STATUS_LABELS,
  isTerminal,
  isRunning,
  type VideoJobStatus,
} from "@/stores/video";
import { cn } from "@/lib/utils";

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface StageLogEntry {
  stage: VideoJobStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  success: boolean;
  notes?: string;
  error?: string;
}

interface VideoJobTimelineProps {
  /** Current status of the job — drives which stage is highlighted. */
  status: VideoJobStatus;
  /** 0–100 overall progress value. */
  progress: number;
  /**
   * Optional full stage log from the API response.
   * When present, timestamps and durations are rendered per stage.
   */
  stages?: StageLogEntry[];
  /** Compact horizontal mode (default: false = full vertical timeline). */
  compact?: boolean;
  className?: string;
}

// ─── Stage metadata ───────────────────────────────────────────────────────────

const STAGE_DESCRIPTIONS: Partial<Record<VideoJobStatus, string>> = {
  queued:     "Waiting in queue",
  preflight:  "Checking Ollama and system pressure",
  planning:   "Analysing topic and narrative structure",
  scripting:  "Writing narration script",
  storyboard: "Generating shot-by-shot visual plan",
  rendering:  "Dispatching render to ComfyUI",
  assembling: "Compositing clips into sequence",
  exporting:  "Writing final output file",
  completed:  "Pipeline complete",
};

// Active pipeline stages (excludes terminal states)
const ACTIVE_STAGES = PIPELINE_STAGES.filter(
  (s) => !["failed", "cancelled", "degraded"].includes(s)
);

// ─── Stage icon helpers ───────────────────────────────────────────────────────

function StageIcon({
  stageStatus,
  isActive,
  isFailed,
}: {
  stageStatus: "done" | "active" | "pending" | "failed";
  isActive: boolean;
  isFailed: boolean;
}) {
  if (stageStatus === "done") {
    return <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" aria-hidden />;
  }
  if (stageStatus === "failed") {
    return <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" aria-hidden />;
  }
  if (isActive) {
    return <Loader2 className="h-3.5 w-3.5 text-text-accent animate-spin shrink-0" aria-hidden />;
  }
  return <Circle className="h-3.5 w-3.5 text-border-subtle shrink-0" aria-hidden />;
}

// ─── Duration formatter ───────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1_000)}s`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

// ─── Compact mode: horizontal dot track ──────────────────────────────────────

export function CompactTimeline({
  status,
  className,
}: {
  status: VideoJobStatus;
  className?: string;
}) {
  const currentIdx = ACTIVE_STAGES.indexOf(status);
  const terminal = isTerminal(status);
  const failed = terminal && status !== "completed";

  return (
    <div
      className={cn("flex items-center gap-1", className)}
      role="list"
      aria-label="Pipeline stages"
    >
      {ACTIVE_STAGES.map((stage, i) => {
        const stageIdx = i;
        const done = terminal
          ? status === "completed"
          : stageIdx < currentIdx;
        const active = stageIdx === currentIdx && !terminal;

        return (
          <React.Fragment key={stage}>
            <div
              role="listitem"
              title={STATUS_LABELS[stage]}
              aria-label={`${STATUS_LABELS[stage]}: ${
                done ? "complete" : active ? "in progress" : "pending"
              }`}
              className={cn(
                "h-1.5 w-1.5 rounded-full transition-colors duration-300",
                failed && stageIdx <= currentIdx
                  ? "bg-destructive"
                  : done
                  ? "bg-green-400"
                  : active
                  ? "bg-text-accent animate-pulse"
                  : "bg-border-subtle"
              )}
            />
            {i < ACTIVE_STAGES.length - 1 && (
              <div
                aria-hidden
                className={cn(
                  "h-px flex-1 max-w-4 transition-colors duration-300",
                  done ? "bg-green-400/40" : "bg-border-subtle"
                )}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Full mode: vertical timeline ─────────────────────────────────────────────

function FullTimeline({
  status,
  progress,
  stages,
  className,
}: Omit<VideoJobTimelineProps, "compact">) {
  const currentIdx = ACTIVE_STAGES.indexOf(status);
  const terminal = isTerminal(status);
  const failed = terminal && status !== "completed";

  // Build a lookup from stage log if provided
  const stageLogByName = React.useMemo(() => {
    const map = new Map<string, StageLogEntry>();
    for (const entry of stages ?? []) {
      map.set(entry.stage, entry);
    }
    return map;
  }, [stages]);

  return (
    <div className={cn("space-y-1", className)} role="list" aria-label="Video pipeline timeline">
      {ACTIVE_STAGES.map((stage, i) => {
        const stageIdx = i;
        const isLast = stageIdx === ACTIVE_STAGES.length - 1;
        const done = terminal
          ? status === "completed"
          : stageIdx < currentIdx;
        const active = stageIdx === currentIdx && !terminal;
        const stageFailed = failed && stageIdx === currentIdx;
        const log = stageLogByName.get(stage);

        type StageStatusType = "done" | "active" | "pending" | "failed";
        const stageStatus: StageStatusType =
          stageFailed ? "failed" : done ? "done" : active ? "active" : "pending";

        return (
          <div key={stage} role="listitem" className="flex items-start gap-3">
            {/* Connector column */}
            <div className="flex flex-col items-center" aria-hidden>
              <StageIcon
                stageStatus={stageStatus}
                isActive={active}
                isFailed={stageFailed}
              />
              {!isLast && (
                <div
                  className={cn(
                    "w-px flex-1 mt-1 min-h-4",
                    done ? "bg-green-400/30" : "bg-border-subtle"
                  )}
                />
              )}
            </div>

            {/* Content column */}
            <div className={cn("flex-1 pb-3", isLast && "pb-0")}>
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className={cn(
                    "text-xs font-medium",
                    stageFailed
                      ? "text-destructive"
                      : done
                      ? "text-text-secondary"
                      : active
                      ? "text-text-primary"
                      : "text-text-muted"
                  )}
                >
                  {STATUS_LABELS[stage]}
                </span>

                {/* Duration badge */}
                {log?.durationMs != null && (
                  <span className="text-[10px] font-mono text-text-muted shrink-0">
                    {formatDuration(log.durationMs)}
                  </span>
                )}

                {/* Timestamp when started */}
                {log?.startedAt && !log.durationMs && (
                  <span className="text-[10px] font-mono text-text-muted shrink-0 flex items-center gap-0.5">
                    <Clock className="h-2.5 w-2.5" aria-hidden />
                    {formatTime(log.startedAt)}
                  </span>
                )}
              </div>

              {/* Stage description */}
              {active && STAGE_DESCRIPTIONS[stage] && (
                <p className="mt-0.5 text-[11px] text-text-muted">
                  {STAGE_DESCRIPTIONS[stage]}
                </p>
              )}

              {/* Inline progress for active stage */}
              {active && progress > 0 && (
                <div className="mt-1.5 h-0.5 rounded-full bg-bg-elevated overflow-hidden">
                  <div
                    className="h-full rounded-full bg-text-accent transition-[width] duration-500 ease-out"
                    style={{ width: `${progress}%` }}
                    role="progressbar"
                    aria-valuenow={progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${STATUS_LABELS[stage]} progress`}
                  />
                </div>
              )}

              {/* Stage notes */}
              {log?.notes && done && (
                <p className="mt-0.5 text-[11px] text-text-muted truncate">{log.notes}</p>
              )}

              {/* Stage error */}
              {(log?.error ?? (stageFailed && status === stage)) && (
                <p className="mt-1 text-[11px] text-destructive flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                  {log?.error ?? "Stage failed"}
                </p>
              )}
            </div>
          </div>
        );
      })}

      {/* Terminal state indicators */}
      {failed && (
        <div className="flex items-center gap-3 pt-1">
          <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" aria-hidden />
          <span className="text-xs font-medium text-destructive">
            {status === "cancelled" ? "Cancelled by user" : "Pipeline failed"}
          </span>
        </div>
      )}
      {status === "degraded" && (
        <div className="flex items-center gap-3 pt-1">
          <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" aria-hidden />
          <span className="text-xs font-medium text-warning">
            Completed in degraded mode
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Public export ─────────────────────────────────────────────────────────────

/**
 * VideoJobTimeline — renders either a compact horizontal dot-track
 * or a full vertical stage breakdown depending on the `compact` prop.
 *
 * @example Compact (inside a card header):
 *   <VideoJobTimeline status={job.status} progress={job.progress} compact />
 *
 * @example Full (inside an expanded detail panel):
 *   <VideoJobTimeline
 *     status={job.status}
 *     progress={job.progress}
 *     stages={jobDetail.stages}
 *   />
 */
export function VideoJobTimeline({
  status,
  progress,
  stages,
  compact = false,
  className,
}: VideoJobTimelineProps) {
  if (compact) {
    return <CompactTimeline status={status} className={className} />;
  }

  return (
    <FullTimeline
      status={status}
      progress={progress}
      stages={stages}
      className={className}
    />
  );
}
