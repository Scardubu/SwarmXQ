/**
 * apps/swarmx-dashboard/src/stores/video.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Zustand store for the video generation subsystem.
 *
 * Subscribes to video:progress SSE events from the existing events store.
 * Fetches full job details on demand via React Query (not stored here).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { create } from "zustand";

// ─── Types (mirrored from API types) ─────────────────────────────────────────

export type VideoJobStatus =
  | "queued" | "preflight" | "planning" | "scripting"
  | "storyboard" | "rendering" | "assembling" | "exporting"
  | "completed" | "failed" | "cancelled" | "degraded";

export type VideoDegradeMode =
  | "none" | "script_only" | "storyboard_only" | "render_deferred" | "intent_only";

export interface VideoJobSummary {
  jobId: string;
  correlationId: string;
  status: VideoJobStatus;
  degradeMode: VideoDegradeMode;
  progress: number;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  hasScript?: boolean;
  hasStoryboard?: boolean;
  hasRender?: boolean;
  error?: string;
}

// ─── Progress event from SSE ──────────────────────────────────────────────────

export interface VideoProgressEvent {
  jobId: string;
  correlationId: string;
  status: VideoJobStatus;
  degradeMode: VideoDegradeMode;
  progress: number;
  error?: string;
  timestamp: string;
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface VideoStore {
  /** Lightweight summaries keyed by jobId (updated via SSE) */
  jobs: Map<string, VideoJobSummary>;
  /** The jobId currently being viewed in detail */
  selectedJobId: string | null;
  /** True while the job list is loading from the API */
  loading: boolean;
  /** Store-level error (not job-level) */
  error: string | null;

  // Actions
  setSelectedJobId: (id: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  /** Bulk-load job list from API response */
  setJobs: (jobs: VideoJobSummary[]) => void;
  /** Apply a SSE progress event — upserts into the jobs map */
  applyProgressEvent: (event: VideoProgressEvent) => void;
  /** Remove a job from the local map (e.g., after cancel) */
  removeJob: (jobId: string) => void;
  /** Total active jobs (queued / running stages) */
  activeCount: () => number;
}

export const useVideoStore = create<VideoStore>((set, get) => ({
  jobs: new Map(),
  selectedJobId: null,
  loading: false,
  error: null,

  setSelectedJobId: (id) => set({ selectedJobId: id }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  setJobs: (incoming) => {
    const next = new Map<string, VideoJobSummary>(get().jobs);
    for (const job of incoming) {
      next.set(job.jobId, job);
    }
    set({ jobs: next });
  },

  applyProgressEvent: (event) => {
    const jobs = new Map(get().jobs);
    const existing = jobs.get(event.jobId);
    jobs.set(event.jobId, {
      jobId: event.jobId,
      correlationId: event.correlationId,
      status: event.status,
      degradeMode: event.degradeMode,
      progress: event.progress,
      prompt: existing?.prompt ?? "",
      createdAt: existing?.createdAt ?? event.timestamp,
      updatedAt: event.timestamp,
      completedAt: ["completed", "failed", "degraded", "cancelled"].includes(event.status)
        ? event.timestamp
        : existing?.completedAt,
      error: event.error,
      hasScript: existing?.hasScript,
      hasStoryboard: existing?.hasStoryboard,
      hasRender: existing?.hasRender,
    });
    set({ jobs });
  },

  removeJob: (jobId) => {
    const jobs = new Map(get().jobs);
    jobs.delete(jobId);
    const selectedJobId = get().selectedJobId === jobId ? null : get().selectedJobId;
    set({ jobs, selectedJobId });
  },

  activeCount: () => {
    const active: VideoJobStatus[] = ["queued", "preflight", "planning", "scripting", "storyboard", "rendering", "assembling", "exporting"];
    let count = 0;
    for (const job of get().jobs.values()) {
      if (active.includes(job.status)) count++;
    }
    return count;
  },
}));

// ─── Status helpers ───────────────────────────────────────────────────────────

export function isTerminal(status: VideoJobStatus): boolean {
  return ["completed", "failed", "cancelled", "degraded"].includes(status);
}

export function isRunning(status: VideoJobStatus): boolean {
  return !isTerminal(status);
}

export const STATUS_LABELS: Record<VideoJobStatus, string> = {
  queued: "Queued",
  preflight: "Preflight",
  planning: "Planning",
  scripting: "Writing Script",
  storyboard: "Building Storyboard",
  rendering: "Rendering",
  assembling: "Assembling",
  exporting: "Exporting",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  degraded: "Degraded",
};

export const DEGRADE_LABELS: Record<VideoDegradeMode, string> = {
  none: "Full pipeline",
  script_only: "Script only (no render)",
  storyboard_only: "Storyboard ready (no render)",
  render_deferred: "Render deferred",
  intent_only: "Intent only (models offline)",
};

export const PIPELINE_STAGES: VideoJobStatus[] = [
  "queued", "preflight", "planning", "scripting",
  "storyboard", "rendering", "assembling", "exporting", "completed",
];

export function stagePct(status: VideoJobStatus): number {
  const idx = PIPELINE_STAGES.indexOf(status);
  if (idx < 0) return 0;
  return Math.round((idx / (PIPELINE_STAGES.length - 1)) * 100);
}
