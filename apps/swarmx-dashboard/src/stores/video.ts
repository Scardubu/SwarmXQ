/**
 * apps/swarmx-dashboard/src/stores/video.ts
 * SwarmXQ Dashboard — Video Zustand Store
 *
 * Single source of truth for video jobs. The store subscribes to the global SSE
 * stream and applies video job events directly — no secondary useEffect needed
 * in page components. Components should read from this store only.
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type {
  VideoJob,
  VideoJobRequest,
  VideoJobStage,
  VideoStageProgress,
} from "../../../swarmx-api/src/types/video";
import type { SwarmXEvent } from "../../../swarmx-api/src/types/events";

// ─── State ────────────────────────────────────────────────────────────────────

export interface VideoState {
  /** All known jobs, keyed by id. */
  jobs: Map<string, VideoJob>;
  /** Currently selected job for detail view. */
  selectedJobId: string | null;
  /** True while the initial job list is loading. */
  isLoading: boolean;
  /** True while a new job is being submitted. */
  isSubmitting: boolean;
  /** Non-null when the list fetch failed. */
  listError: string | null;
  /** Non-null when job submission failed. */
  submitError: string | null;
}

export interface VideoActions {
  // ── Remote ──────────────────────────────────────────────────────────────────
  fetchJobs: () => Promise<void>;
  submitJob: (request: VideoJobRequest) => Promise<string | null>;
  cancelJob: (jobId: string) => Promise<void>;

  // ── SSE ingestion ───────────────────────────────────────────────────────────
  /** Called by the top-level SSE hook to route events into the store. */
  ingestEvent: (event: SwarmXEvent) => void;

  // ── Selection ───────────────────────────────────────────────────────────────
  selectJob: (jobId: string | null) => void;

  // ── Derived helpers ─────────────────────────────────────────────────────────
  getJob: (jobId: string) => VideoJob | undefined;
  listJobs: () => VideoJob[];
  selectedJob: () => VideoJob | undefined;

  // ── Reset ────────────────────────────────────────────────────────────────────
  clearErrors: () => void;
}

type VideoStore = VideoState & VideoActions;

// ─── API helpers ──────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:7380";

async function apiFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`API ${path} → ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useVideoStore = create<VideoStore>()(
  devtools(
    (set, get) => ({
      // ── Initial state ────────────────────────────────────────────────────────
      jobs: new Map(),
      selectedJobId: null,
      isLoading: false,
      isSubmitting: false,
      listError: null,
      submitError: null,

      // ── fetchJobs ─────────────────────────────────────────────────────────────
      fetchJobs: async () => {
        set({ isLoading: true, listError: null }, false, "video/fetchJobs/start");
        try {
          const data = await apiFetch<{ jobs: VideoJob[] }>("/api/video/jobs");
          const jobs = new Map<string, VideoJob>();
          for (const job of data.jobs) {
            jobs.set(job.id, job);
          }
          set({ jobs, isLoading: false }, false, "video/fetchJobs/done");
        } catch (err) {
          set(
            {
              isLoading: false,
              listError: err instanceof Error ? err.message : "Failed to fetch jobs",
            },
            false,
            "video/fetchJobs/error"
          );
        }
      },

      // ── submitJob ────────────────────────────────────────────────────────────
      submitJob: async (request) => {
        set({ isSubmitting: true, submitError: null }, false, "video/submit/start");
        try {
          const data = await apiFetch<{ jobId: string; status: string; createdAt: string }>(
            "/api/video/jobs",
            { method: "POST", body: JSON.stringify(request) }
          );

          // Seed the store with a pending job so the UI updates immediately.
          const seedJob: VideoJob = {
            id: data.jobId,
            status: "queued",
            request,
            stages: {},
            overallProgress: 0,
            retryCount: 0,
            createdAt: data.createdAt,
            updatedAt: data.createdAt,
          };
          set(
            (state) => {
              const jobs = new Map(state.jobs);
              jobs.set(data.jobId, seedJob);
              return { jobs, isSubmitting: false, selectedJobId: data.jobId };
            },
            false,
            "video/submit/done"
          );
          return data.jobId;
        } catch (err) {
          set(
            {
              isSubmitting: false,
              submitError: err instanceof Error ? err.message : "Failed to submit job",
            },
            false,
            "video/submit/error"
          );
          return null;
        }
      },

      // ── cancelJob ────────────────────────────────────────────────────────────
      cancelJob: async (jobId) => {
        try {
          await apiFetch(`/api/video/jobs/${jobId}/cancel`, { method: "POST" });
          // Optimistic update — SSE will confirm.
          set(
            (state) => {
              const jobs = new Map(state.jobs);
              const job = jobs.get(jobId);
              if (job) {
                jobs.set(jobId, {
                  ...job,
                  status: "cancelled",
                  updatedAt: new Date().toISOString(),
                });
              }
              return { jobs };
            },
            false,
            "video/cancel"
          );
        } catch (err) {
          console.error("[VideoStore] cancelJob failed:", err);
        }
      },

      // ── ingestEvent ───────────────────────────────────────────────────────────
      /**
       * Route SSE events into the store.
       *
       * IMPORTANT: This is the ONLY place video events are applied to state.
       * Components must NOT have their own useEffect that listens to the SSE
       * stream and re-applies video events — that causes double-application.
       * Subscribe to this store's derived state instead.
       */
      ingestEvent: (event) => {
        if (!event.type.startsWith("video:")) return;

        set(
          (state) => {
            const jobs = new Map(state.jobs);

            switch (event.type) {
              case "video:created": {
                // If we don't have this job yet (e.g. submitted from another tab),
                // seed a minimal record.
                if (!jobs.has(event.payload.jobId)) {
                  const seed: VideoJob = {
                    id: event.payload.jobId,
                    status: "queued",
                    request: { prompt: event.payload.prompt },
                    stages: {},
                    overallProgress: 0,
                    retryCount: 0,
                    createdAt: event.timestamp,
                    updatedAt: event.timestamp,
                  };
                  jobs.set(seed.id, seed);
                }
                break;
              }

              case "video:queued": {
                const job = jobs.get(event.payload.jobId);
                if (job) {
                  jobs.set(job.id, {
                    ...job,
                    status: "queued",
                    updatedAt: event.timestamp,
                  });
                }
                break;
              }

              case "video:stage_started": {
                const job = jobs.get(event.payload.jobId);
                if (job) {
                  const stage = event.payload.stage as VideoJobStage;
                  const stageProgress: VideoStageProgress = {
                    stage,
                    stageProgress: 0,
                    overallProgress: job.overallProgress,
                    startedAt: event.timestamp,
                    message: `${stage.replace(/_/g, " ")} started`,
                  };
                  jobs.set(job.id, {
                    ...job,
                    status: "running",
                    currentStage: stage,
                    stages: { ...job.stages, [stage]: stageProgress },
                    updatedAt: event.timestamp,
                  });
                }
                break;
              }

              case "video:progress": {
                const job = jobs.get(event.payload.jobId);
                if (job) {
                  const { stage, stageProgress, overallProgress } = event.payload;
                  jobs.set(job.id, {
                    ...job,
                    status: "running",
                    currentStage: stage as VideoJobStage,
                    overallProgress,
                    stages: {
                      ...job.stages,
                      [stage]: stageProgress,
                    },
                    updatedAt: event.timestamp,
                  });
                }
                break;
              }

              case "video:completed": {
                const job = jobs.get(event.payload.jobId);
                if (job) {
                  jobs.set(job.id, {
                    ...job,
                    status: "completed",
                    overallProgress: 100,
                    currentStage: undefined,
                    completedAt: event.timestamp,
                    updatedAt: event.timestamp,
                    output: job.output ?? {
                      relativePath: "",
                      absolutePath: "",
                      publicUrl: event.payload.outputPublicUrl,
                      fileSizeBytes: event.payload.fileSizeBytes,
                      durationSeconds: event.payload.durationSeconds,
                      widthPx: 720,
                      heightPx: 1280,
                      fps: 24,
                      format: "mp4",
                      checksum: "",
                      generatedAt: event.timestamp,
                      modelsUsed: event.payload.modelsUsed,
                    },
                  });
                }
                break;
              }

              case "video:failed": {
                const job = jobs.get(event.payload.jobId);
                if (job) {
                  jobs.set(job.id, {
                    ...job,
                    status: job.retryCount < event.payload.retryCount ? "queued" : "failed",
                    retryCount: event.payload.retryCount,
                    error: event.payload.error,
                    currentStage: undefined,
                    updatedAt: event.timestamp,
                  });
                }
                break;
              }

              case "video:cancelled": {
                const job = jobs.get(event.payload.jobId);
                if (job) {
                  jobs.set(job.id, {
                    ...job,
                    status: "cancelled",
                    currentStage: undefined,
                    completedAt: event.timestamp,
                    updatedAt: event.timestamp,
                  });
                }
                break;
              }

              case "video:snapshot": {
                jobs.set(event.payload.job.id, event.payload.job);
                break;
              }
            }

            return { jobs };
          },
          false,
          `video/sse/${event.type}`
        );
      },

      // ── Selection ─────────────────────────────────────────────────────────────
      selectJob: (jobId) => {
        set({ selectedJobId: jobId }, false, "video/select");
      },

      // ── Derived ───────────────────────────────────────────────────────────────
      getJob: (jobId) => get().jobs.get(jobId),
      listJobs: () =>
        [...get().jobs.values()].sort(
          (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
        ),
      selectedJob: () => {
        const { selectedJobId, jobs } = get();
        return selectedJobId ? jobs.get(selectedJobId) : undefined;
      },

      // ── Reset ─────────────────────────────────────────────────────────────────
      clearErrors: () => {
        set({ listError: null, submitError: null }, false, "video/clearErrors");
      },
    }),
    { name: "VideoStore" }
  )
);