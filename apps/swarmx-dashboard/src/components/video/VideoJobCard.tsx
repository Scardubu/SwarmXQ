"use client";

/**
 * apps/swarmx-dashboard/src/components/video/VideoJobCard.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Displays a single video job with progress bar, stage timeline, output
 * previews, and retry/cancel controls.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState } from "react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useVideoStore,
  STATUS_LABELS,
  DEGRADE_LABELS,
  PIPELINE_STAGES,
  isTerminal,
  type VideoJobStatus,
  type VideoDegradeMode,
} from "@/stores/video";
import { cn } from "@/lib/utils";
import {
  Film,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  RefreshCw,
  X,
  ChevronDown,
  ChevronRight,
  FileText,
  Image,
  Video,
  Loader2,
} from "lucide-react";

interface VideoJobDetailProps {
  jobId: string;
  fullDetail?: VideoJobDetail | null;
  onRetry: (jobId: string) => void;
  onCancel: (jobId: string) => void;
  onSelect: (jobId: string) => void;
}

// Full API response shape
interface VideoJobDetail {
  jobId: string;
  status: VideoJobStatus;
  degradeMode: VideoDegradeMode;
  progress: number;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  intent?: { topic: string; style: string; aspect: string; length: string; targetPlatform?: string };
  script?: { title: string; hook: string; body: string; cta: string; narrationText: string; estimatedDurationSec: number };
  storyboard?: { shots: { index: number; visualDescription: string; narrationSegment: string; comfyPrompt?: string }[]; totalDurationSec: number; renderNotes: string };
  render?: { rendererUsed?: string; outputDir?: string; clips?: { shotIndex: number; status: string }[] };
  warnings: string[];
  stages: { stage: string; startedAt: string; completedAt?: string; durationMs?: number; success: boolean; error?: string }[];
  error?: string;
}

const STATUS_COLORS: Record<VideoJobStatus, string> = {
  queued:     "bg-text-muted/20 text-text-muted",
  preflight:  "bg-blue-500/20 text-blue-400",
  planning:   "bg-blue-500/20 text-blue-400",
  scripting:  "bg-purple-500/20 text-purple-400",
  storyboard: "bg-purple-500/20 text-purple-400",
  rendering:  "bg-orange-500/20 text-orange-400",
  assembling: "bg-orange-500/20 text-orange-400",
  exporting:  "bg-yellow-500/20 text-yellow-400",
  completed:  "bg-green-500/20 text-green-400",
  failed:     "bg-destructive/20 text-destructive",
  cancelled:  "bg-text-muted/20 text-text-muted",
  degraded:   "bg-warning/20 text-warning",
};

export function VideoJobCard({ jobId, fullDetail, onRetry, onCancel, onSelect }: VideoJobDetailProps) {
  const summary = useVideoStore((s) => s.jobs.get(jobId));
  const [expanded, setExpanded] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  if (!summary) return null;

  const running = !isTerminal(summary.status);
  const canRetry = ["failed", "degraded", "cancelled"].includes(summary.status);
  const canCancel = !isTerminal(summary.status);

  async function handleRetry() {
    setActionBusy(true);
    try { await onRetry(jobId); } finally { setActionBusy(false); }
  }

  async function handleCancel() {
    setActionBusy(true);
    try { await onCancel(jobId); } finally { setActionBusy(false); }
  }

  return (
    <article
      className="rounded-xl border border-border-subtle bg-bg-elevated overflow-hidden"
      aria-label={`Video job: ${summary.prompt.slice(0, 60)}`}
    >
      {/* Header row */}
      <div className="flex items-start gap-3 p-4">
        <div className="mt-0.5 flex-shrink-0">
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin text-text-accent" aria-label="Running" />
          ) : summary.status === "completed" ? (
            <CheckCircle2 className="h-4 w-4 text-green-400" aria-label="Completed" />
          ) : summary.status === "failed" ? (
            <XCircle className="h-4 w-4 text-destructive" aria-label="Failed" />
          ) : summary.status === "degraded" ? (
            <AlertTriangle className="h-4 w-4 text-warning" aria-label="Degraded" />
          ) : (
            <Clock className="h-4 w-4 text-text-muted" aria-label="Cancelled" />
          )}
        </div>

        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-sm font-medium text-text-primary truncate" title={summary.prompt}>
            {summary.prompt.slice(0, 80)}
            {summary.prompt.length > 80 ? "…" : ""}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={cn("text-[10px] px-1.5 py-0 rounded-md font-medium", STATUS_COLORS[summary.status])}>
              {STATUS_LABELS[summary.status]}
            </Badge>
            {summary.degradeMode !== "none" && (
              <Badge className="text-[10px] px-1.5 py-0 rounded-md bg-warning/20 text-warning font-medium">
                {DEGRADE_LABELS[summary.degradeMode]}
              </Badge>
            )}
            <span className="text-[11px] text-text-muted">
              {new Date(summary.createdAt).toLocaleTimeString()}
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 ml-2">
          {canRetry && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => void handleRetry()}
              disabled={actionBusy}
              aria-label="Retry job"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          )}
          {canCancel && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-text-muted hover:text-destructive"
              onClick={() => void handleCancel()}
              disabled={actionBusy}
              aria-label="Cancel job"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => {
              setExpanded(!expanded);
              onSelect(jobId);
            }}
            aria-label={expanded ? "Collapse detail" : "Expand detail"}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {/* Progress bar */}
      {running && (
        <div className="px-4 pb-2">
          <Progress
            value={summary.progress}
            className="h-1"
            aria-label={`Progress: ${summary.progress}%`}
          />
          <p className="mt-1 text-[10px] text-text-muted">{summary.progress}% — {STATUS_LABELS[summary.status]}</p>
        </div>
      )}

      {/* Pipeline stage dots */}
      <div className="px-4 pb-3">
        <PipelineTrack current={summary.status} />
      </div>

      {/* Error message */}
      {summary.error && (
        <div className="mx-4 mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {summary.error}
        </div>
      )}

      {/* Expanded detail panel */}
      {expanded && fullDetail && (
        <div className="border-t border-border-subtle bg-bg-surface">
          <ScrollArea className="max-h-96 p-4 space-y-4">
            {/* Warnings */}
            {fullDetail.warnings.length > 0 && (
              <div className="space-y-1">
                {fullDetail.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Script */}
            {fullDetail.script && (
              <section>
                <h3 className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary mb-2">
                  <FileText className="h-3.5 w-3.5" /> Script — {fullDetail.script.title}
                </h3>
                <div className="rounded-lg border border-border-subtle bg-bg-elevated p-3 space-y-2 text-xs">
                  <div><span className="text-text-muted">Hook: </span><span className="text-text-primary">{fullDetail.script.hook}</span></div>
                  <div className="text-text-secondary whitespace-pre-wrap leading-relaxed">{fullDetail.script.body}</div>
                  <div><span className="text-text-muted">CTA: </span><span className="text-text-primary">{fullDetail.script.cta}</span></div>
                  <div className="text-text-muted">~{fullDetail.script.estimatedDurationSec}s • {fullDetail.script.narrationText.split(/\s+/).length} words</div>
                </div>
              </section>
            )}

            {/* Storyboard shots */}
            {fullDetail.storyboard && (
              <section>
                <h3 className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary mb-2">
                  <Image className="h-3.5 w-3.5" /> Storyboard — {fullDetail.storyboard.shots.length} shots
                </h3>
                <div className="space-y-1.5">
                  {fullDetail.storyboard.shots.map((shot) => (
                    <div key={shot.index} className="rounded-lg border border-border-subtle bg-bg-elevated p-2.5 text-xs">
                      <div className="flex items-start gap-2">
                        <span className="rounded bg-bg-surface px-1.5 py-0.5 text-[10px] text-text-muted font-mono">#{shot.index + 1}</span>
                        <div className="flex-1 space-y-0.5">
                          <p className="text-text-primary">{shot.visualDescription}</p>
                          <p className="text-text-muted italic">"{shot.narrationSegment}"</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {fullDetail.storyboard.renderNotes && (
                  <p className="mt-2 text-[11px] text-text-muted">
                    <span className="font-medium">Render notes:</span> {fullDetail.storyboard.renderNotes}
                  </p>
                )}
              </section>
            )}

            {/* Render info */}
            {fullDetail.render && (
              <section>
                <h3 className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary mb-2">
                  <Video className="h-3.5 w-3.5" /> Render
                </h3>
                <div className="text-xs text-text-secondary space-y-0.5">
                  <p>Renderer: <span className="text-text-primary">{fullDetail.render.rendererUsed ?? "none"}</span></p>
                  {fullDetail.render.outputDir && (
                    <p>Output: <span className="font-mono text-text-muted">{fullDetail.render.outputDir}</span></p>
                  )}
                  {fullDetail.render.clips && (
                    <p>{fullDetail.render.clips.length} clips queued</p>
                  )}
                </div>
              </section>
            )}

            {/* Stage log */}
            {fullDetail.stages.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold text-text-secondary mb-2">Stage Log</h3>
                <div className="space-y-1">
                  {fullDetail.stages.map((stage, i) => (
                    <div key={i} className="flex items-center gap-2 text-[11px]">
                      <span className={cn("h-1.5 w-1.5 rounded-full flex-shrink-0",
                        stage.success ? "bg-green-400" : stage.error ? "bg-destructive" : "bg-text-muted")} />
                      <span className="text-text-muted w-24 truncate">{stage.stage}</span>
                      {stage.durationMs && <span className="text-text-muted">{(stage.durationMs / 1000).toFixed(1)}s</span>}
                      {stage.error && <span className="text-destructive truncate">{stage.error}</span>}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </ScrollArea>
        </div>
      )}
    </article>
  );
}

// ─── Pipeline track dots ──────────────────────────────────────────────────────

function PipelineTrack({ current }: { current: VideoJobStatus }) {
  const terminal = isTerminal(current);
  const currentIdx = PIPELINE_STAGES.indexOf(current);
  const stages = PIPELINE_STAGES.filter((s) => s !== "queued");

  return (
    <div className="flex items-center gap-1" aria-label="Pipeline progress">
      {stages.map((stage, i) => {
        const stageIdx = PIPELINE_STAGES.indexOf(stage);
        const done = terminal ? current === "completed" && stageIdx <= PIPELINE_STAGES.length - 1
          : stageIdx < currentIdx;
        const active = stageIdx === currentIdx;
        const failed = terminal && current !== "completed";

        return (
          <React.Fragment key={stage}>
            <div
              title={STATUS_LABELS[stage]}
              className={cn(
                "h-1.5 w-1.5 rounded-full transition-colors",
                failed && stageIdx <= currentIdx ? "bg-destructive"
                  : done ? "bg-green-400"
                  : active ? "bg-text-accent animate-pulse"
                  : "bg-border-subtle",
              )}
            />
            {i < stages.length - 1 && (
              <div className={cn("h-px flex-1 max-w-3 transition-colors",
                done ? "bg-green-400/40" : "bg-border-subtle")} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
