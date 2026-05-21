"use client";

/**
* apps/swarmx-dashboard/src/app/(dashboard)/video/page.tsx
* ─────────────────────────────────────────────────────────────────────────────
* Video Generation dashboard page.
*
* Uses React Query for data fetching + Zustand store for SSE-driven updates.
* Subscribes to video:progress events from the existing useEventsStore hook.
* ─────────────────────────────────────────────────────────────────────────────
*/

import React, {
    useEffect,
    useCallback
} from "react";
import {
    useQuery,
    useMutation,
    useQueryClient
} from "@tanstack/react-query";
import {
    useVideoStore
} from "@/stores/video";
import {
    useEventsStore
} from "@/stores/events";
import {
    VideoJobForm
} from "@/components/video/VideoJobForm";
import {
    VideoJobCard
} from "@/components/video/VideoJobCard";
import {
    Badge
} from "@/components/ui/badge";
import {
    Button
} from "@/components/ui/button";
import {
    ScrollArea
} from "@/components/ui/scroll-area";
import {
    Separator
} from "@/components/ui/separator";
import {
    Film,
    RefreshCw,
    Zap,
    AlertTriangle,
    Wifi,
    WifiOff
} from "lucide-react";
import type {
    VideoProgressEvent,
    VideoJobSummary
} from "@/stores/video";

const API_BASE = process.env["NEXT_PUBLIC_API_BASE"] ?? "http://localhost:3001";

interface VideoHealth {
    ollama: {
        reachable: boolean; models: string[]
    };
    comfyui: {
        reachable: boolean; baseUrl: string
    };
    pressure: string;
    renderCapable: boolean;
    timestamp: string;
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function fetchJobs(): Promise < VideoJobSummary[] > {
    const res = await fetch(`${API_BASE}/api/video/jobs?limit=50`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as {
        jobs: VideoJobSummary[]
    };
    return data.jobs;
}

async function fetchJobDetail(jobId: string) {
    const res = await fetch(`${API_BASE}/api/video/jobs/${jobId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function fetchHealth(): Promise < VideoHealth > {
    const res = await fetch(`${API_BASE}/api/video/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise < VideoHealth >;
}

async function cancelJobFetch(jobId: string): Promise < void > {
    const res = await fetch(`${API_BASE}/api/video/jobs/${jobId}`, {
        method: "DELETE"
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function retryJobFetch(jobId: string): Promise < {
    jobId: string
} > {
    const res = await fetch(`${API_BASE}/api/video/jobs/${jobId}/retry`, {
        method: "POST"
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise < {
        jobId: string
    } >;
}

// ─── Page component ───────────────────────────────────────────────────────────

export default function VideoPage() {
    const qc = useQueryClient();
    const {
        jobs,
        setJobs,
        applyProgressEvent,
        selectedJobId,
        setSelectedJobId
    } = useVideoStore();

    // ── SSE subscription: listen for video:progress events ───────────────────
    // The existing useEventsStore receives all SSE events from /api/events.
    // We tap into it by subscribing to the raw events Map.
    // (A hook approach keeps this component clean without coupling stores.)
    const rawEvents = useEventsStore((s) => s.latestEvent);

    useEffect(() => {
        if (!rawEvents) return;
        const ev = rawEvents as {
            type: string; data: unknown
        };
        if (ev.type === "video:progress" || ev.type === "video:completed" || ev.type === "video:failed") {
            applyProgressEvent(ev.data as VideoProgressEvent);
            void qc.invalidateQueries({
                queryKey: ["video-jobs"]
            });
        }
    },
        [rawEvents,
            applyProgressEvent,
            qc]);

    // ── React Query: job list ──────────────────────────────────────────────────
    const {
        data: jobList, isLoading: jobsLoading, refetch: refetchJobs
    } = useQuery({
            queryKey: ["video-jobs"],
            queryFn: fetchJobs,
            refetchInterval: 8_000,
            retry: 2,
        });

    useEffect(() => {
        if (jobList) setJobs(jobList);
    },
        [jobList,
            setJobs]);

    // ── React Query: health probe ──────────────────────────────────────────────
    const {
        data: health
    } = useQuery({
            queryKey: ["video-health"],
            queryFn: fetchHealth,
            refetchInterval: 30_000,
            retry: 1,
        });

    // ── React Query: selected job detail ──────────────────────────────────────
    const {
        data: jobDetail
    } = useQuery({
            queryKey: ["video-job-detail",
                selectedJobId],
            queryFn: () => fetchJobDetail(selectedJobId!),
            enabled: !!selectedJobId,
            refetchInterval: selectedJobId ? 5_000: false,
            retry: 1,
        });

    // ── Mutations ──────────────────────────────────────────────────────────────
    const cancelMut = useMutation({
        mutationFn: cancelJobFetch,
        onSuccess: () => {
            void refetchJobs();
        },
    });

    const retryMut = useMutation({
        mutationFn: retryJobFetch,
        onSuccess: () => {
            void refetchJobs();
        },
    });

    const handleJobCreated = useCallback((jobId: string) => {
        void refetchJobs();
        setSelectedJobId(jobId);
    },
        [refetchJobs,
            setSelectedJobId]);

    // ── Derived state ──────────────────────────────────────────────────────────
    const sortedJobs = [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const activeJobs = sortedJobs.filter((j) => !["completed",
        "failed",
        "cancelled",
        "degraded"].includes(j.status));
    const completedJobs = sortedJobs.filter((j) => ["completed",
        "degraded"].includes(j.status));
    const failedJobs = sortedJobs.filter((j) => ["failed",
        "cancelled"].includes(j.status));

    return (
        <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto">
      {/* Page header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Film className="h-6 w-6 text-text-accent" aria-hidden />
          <div>
            <h1 className="text-lg font-semibold text-text-primary">Video Generation</h1>
            <p className="text-xs text-text-muted">
AI-powered faceless video pipeline
        </p>
        </div>
        </div>
        <div className="flex items-center gap-2">
          <HealthIndicator health={health ?? null} />
          <Button
                variant="ghost"
                size="sm"
                onClick={() => void refetchJobs()}
                disabled={jobsLoading}
                aria-label="Refresh job list"
                >
            <RefreshCw className={`h-3.5 w-3.5 ${jobsLoading ? "animate-spin": ""}`} />
          </Button>
        </div>
        </header>

      {/* Degraded mode notice when health is poor */}
      {health && !health.ollama.reachable && (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div className="space-y-0.5">
            <p className="font-medium">
Ollama is offline
            </p>
            <p className="text-xs text-warning/80">
              Script and storyboard generation require a running Ollama instance.
              Jobs created now will produce intent-only output until Ollama comes back online.
            </p>
            </div>
            </div>
        )}

      {health && health.ollama.reachable && !health.renderCapable && (
            <div role="status" className="flex items-start gap-2 rounded-xl border border-border-subtle bg-bg-elevated px-4 py-3 text-sm text-text-secondary">
          <Zap className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <div className="space-y-0.5">
            <p className="font-medium text-text-primary">
ComfyUI not detected
            </p>
            <p className="text-xs">
              Script and storyboard generation will work. Video rendering requires ComfyUI at{" "}
              <code className="font-mono text-xs">{health.comfyui.baseUrl}</code>.
              Start ComfyUI with <code className="font-mono text-xs">--lowvram --force-fp16</code> to enable rendering.
            </p>
            </div>
            </div>
        )}

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 items-start">
        {/* Left: Job creation form */}
        <aside>
          <VideoJobForm onJobCreated={handleJobCreated} />
            </aside>

        {/* Right: Job list */}
        <main>
          <ScrollArea className="h-[70vh]">
            <div className="space-y-6 pr-2">
              {/* Active jobs */}
              {activeJobs.length > 0 && (
                    <section>
                  <SectionHeader
                        title="Active"
                        count={activeJobs.length}
                        dotColor="bg-text-accent animate-pulse"
                        />
                  <div className="space-y-3">
                    {activeJobs.map((job) => (
                            <VideoJobCard
                                key={job.jobId}
                                jobId={job.jobId}
                                fullDetail={selectedJobId === job.jobId ? jobDetail: null}
                                onRetry={(id) => void retryMut.mutateAsync(id)}
                                onCancel={(id) => void cancelMut.mutateAsync(id)}
                                onSelect={setSelectedJobId}
                                />
                        ))}
                    </div>
                    </section>
                )}

              {/* Completed */}
              {completedJobs.length > 0 && (
                    <section>
                  <SectionHeader
                        title="Completed"
                        count={completedJobs.length}
                        dotColor="bg-green-400"
                        />
                  <div className="space-y-3">
                    {completedJobs.map((job) => (
                            <VideoJobCard
                                key={job.jobId}
                                jobId={job.jobId}
                                fullDetail={selectedJobId === job.jobId ? jobDetail: null}
                                onRetry={(id) => void retryMut.mutateAsync(id)}
                                onCancel={(id) => void cancelMut.mutateAsync(id)}
                                onSelect={setSelectedJobId}
                                />
                        ))}
                    </div>
                    </section>
                )}

              {/* Failed / Cancelled */}
              {failedJobs.length > 0 && (
                    <section>
                  <SectionHeader
                        title="Failed / Cancelled"
                        count={failedJobs.length}
                        dotColor="bg-destructive"
                        />
                  <div className="space-y-3">
                    {failedJobs.map((job) => (
                            <VideoJobCard
                                key={job.jobId}
                                jobId={job.jobId}
                                fullDetail={selectedJobId === job.jobId ? jobDetail: null}
                                onRetry={(id) => void retryMut.mutateAsync(id)}
                                onCancel={(id) => void cancelMut.mutateAsync(id)}
                                onSelect={setSelectedJobId}
                                />
                        ))}
                    </div>
                    </section>
                )}

              {/* Empty state */}
              {sortedJobs.length === 0 && !jobsLoading && (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                  <Film className="mb-3 h-10 w-10 text-text-muted opacity-40" aria-hidden />
                  <p className="text-sm font-medium text-text-secondary">
No video jobs yet
                    </p>
                  <p className="mt-1 text-xs text-text-muted">
                    Describe your video in the form and hit Generate.
                    </p>
                    </div>
                )}
                </div>
          </ScrollArea>
        </main>
        </div>
        </div>
    );
}

    // ─── Sub-components ───────────────────────────────────────────────────────────

    function SectionHeader({
        title,
        count,
        dotColor
    }: {
        title: string; count: number; dotColor: string
    }) {
        return (
            <div className="flex items-center gap-2 mb-3">
      <span className={`h-2 w-2 rounded-full ${dotColor}`} aria-hidden />
      <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">{title}</h2>
      <Badge className="text-[10px] px-1.5 py-0 rounded-full bg-bg-surface text-text-muted">{count}</Badge>
      <Separator className="flex-1" />
            </div>
        );
    }

    function HealthIndicator({
        health
    }: {
        health: VideoHealth | null
    }) {
        if (!health) return (
            <span className="text-[11px] text-text-muted">Checking…</span>
        );

        const ok = health.ollama.reachable;
        return (
            <div className="flex items-center gap-1.5 text-[11px]">
      {ok
                ? <Wifi className="h-3 w-3 text-green-400" aria-hidden />: <WifiOff className="h-3 w-3 text-destructive" aria-hidden />
                }
      <span className={ok ? "text-green-400": "text-destructive"}>
        {ok ? "Ollama online": "Ollama offline"}
      </span>
      {health.renderCapable && (
                    <span className="text-text-muted">· Render ready</span>
                )}
            </div>
        );
    }