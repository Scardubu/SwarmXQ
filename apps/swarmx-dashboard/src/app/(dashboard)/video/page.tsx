/**
 * apps/swarmx-dashboard/src/app/(dashboard)/video/page.tsx
 *
 * FIX 1: Removed redundant useEffect that was re-applying SSE progress events.
 *         The video Zustand store's ingestEvent() already handles all video:*
 *         events. Adding a second useEffect that called store.ingestEvent()
 *         or manually merged events caused double-application of progress.
 *
 * FIX 2: Sub-component nesting corrected — VideoJobTimeline and VideoJobCard
 *         are imported at module level and rendered as JSX elements, not defined
 *         as functions inside the page component (which breaks hooks rules and
 *         causes remounting on every render).
 */

"use client";

import { useEffect, useCallback, useMemo, useState } from "react";
import { useVideoStore } from "../../../stores/video";
import { VideoJobForm } from "../../../components/video/VideoJobForm";
import { VideoJobCard } from "../../../components/video/VideoJobCard";
import { VideoJobTimeline } from "../../../components/video/VideoJobTimeline";

// ─── Detail Panel ─────────────────────────────────────────────────────────────
// FIX: Defined at module scope — not nested inside VideoPage

function VideoJobDetailPanel() {
  const { selectedJob, selectJob, fetchJobDetail, publishJob } = useVideoStore((s) => ({
    selectedJob: s.selectedJob(),
    selectJob: s.selectJob,
    fetchJobDetail: s.fetchJobDetail,
    publishJob: s.publishJob,
  }));
  const [publishPlatform, setPublishPlatform] = useState<"tiktok" | "reels" | "shorts" | "generic">("tiktok");
  const [publishState, setPublishState] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedJob) return;
    void fetchJobDetail(selectedJob.id);
  }, [fetchJobDetail, selectedJob]);

  const viralityMetrics = useMemo(() => {
    if (!selectedJob?.viralitySignal) return [];
    return [
      { label: "Hook", value: selectedJob.viralitySignal.hookStrength },
      { label: "Completion", value: selectedJob.viralitySignal.completionProxy },
      { label: "Shareability", value: selectedJob.viralitySignal.shareability },
      { label: "SEO", value: selectedJob.viralitySignal.seoScore },
      { label: "Overall", value: selectedJob.viralitySignal.overall },
    ];
  }, [selectedJob]);

  const handlePublish = useCallback(async () => {
    if (!selectedJob) return;
    setPublishState("Publishing request sent…");
    const result = await publishJob(selectedJob.id, { platform: publishPlatform });
    setPublishState(
      result
        ? `${result.platform} → ${result.status.replace(/_/g, " ")}`
        : "Publish request failed",
    );
  }, [publishJob, publishPlatform, selectedJob]);

  const publishHistory = useMemo(
    () => selectedJob?.publishHistory ?? selectedJob?.outputArtifacts?.publishHistory ?? [],
    [selectedJob],
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

  return (
    <div className="flex flex-col gap-5 p-5">
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

      {/* Full timeline — VideoJobTimeline is properly imported, not duplicated */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
          Stage Timeline
        </h3>
        {/* FIX: VideoJobTimeline imported at module level — not defined inside this component */}
        <VideoJobTimeline job={selectedJob} compact={false} />
      </div>

      {/* Output preview */}
      {selectedJob.status === "completed" && selectedJob.output && (
        <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/30 p-4 flex flex-col gap-3">
          <h3 className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">
            Output
          </h3>
          <video
            src={selectedJob.output.publicUrl}
            controls
            playsInline
            className="w-full rounded-lg bg-black max-h-64 object-contain"
          />
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              {
                label: "Duration",
                value: `${selectedJob.output.durationSeconds.toFixed(0)}s`,
              },
              {
                label: "Size",
                value: `${(selectedJob.output.fileSizeBytes / 1024 / 1024).toFixed(1)} MB`,
              },
              {
                label: "Resolution",
                value: `${selectedJob.output.widthPx}×${selectedJob.output.heightPx}`,
              },
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

      {selectedJob.viralitySignal && (
        <section className="rounded-xl border border-amber-900/40 bg-gradient-to-br from-amber-950/35 to-zinc-900/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-semibold text-amber-300 uppercase tracking-wider">Virality Signal</h3>
              <p className="mt-1 text-xs text-zinc-500">Scored by {selectedJob.viralitySignal.scoredBy}</p>
            </div>
            <div className="rounded-full border border-amber-700/50 bg-amber-900/40 px-3 py-1 text-sm font-semibold text-amber-200">
              {selectedJob.viralitySignal.overall}/100
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {viralityMetrics.map((metric) => (
              <div key={metric.label} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                <p className="text-[10px] uppercase tracking-wider text-zinc-500">{metric.label}</p>
                <p className="mt-1 text-lg font-semibold text-zinc-100">{metric.value}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500">Recommendations</p>
            <ul className="mt-2 space-y-2 text-sm text-zinc-300">
              {selectedJob.viralitySignal.recommendations.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden="true" className="text-amber-400">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {selectedJob.viralitySignal?.captionDraft && (
        <section className="rounded-xl border border-cyan-900/40 bg-cyan-950/20 p-4">
          <h3 className="text-xs font-semibold text-cyan-300 uppercase tracking-wider">Caption Draft</h3>
          <div className="mt-3 space-y-3 text-sm text-zinc-200">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">Hook Line</p>
              <p className="mt-1 font-medium">{selectedJob.viralitySignal.captionDraft.firstLine}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">Body</p>
              <p className="mt-1 whitespace-pre-wrap text-zinc-300">{selectedJob.viralitySignal.captionDraft.body}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">CTA</p>
              <p className="mt-1 text-zinc-300">{selectedJob.viralitySignal.captionDraft.cta}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                ...selectedJob.viralitySignal.captionDraft.hashtags.broad,
                ...selectedJob.viralitySignal.captionDraft.hashtags.niche,
                ...selectedJob.viralitySignal.captionDraft.hashtags.trending,
              ].map((tag) => (
                <span key={tag} className="rounded-full border border-cyan-800/50 bg-cyan-950/40 px-2.5 py-1 text-xs text-cyan-200">
                  #{tag.replace(/^#/, "")}
                </span>
              ))}
            </div>
          </div>
        </section>
      )}

      {selectedJob.status === "completed" && (
        <section className="rounded-xl border border-fuchsia-900/40 bg-fuchsia-950/20 p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-xs font-semibold text-fuchsia-300 uppercase tracking-wider">Publish</h3>
              <p className="mt-1 text-xs text-zinc-500">Platform adapters persist approval-aware publish attempts onto the job record.</p>
            </div>
            <div className="flex flex-col gap-2 sm:min-w-[220px]">
              <label htmlFor="publish-platform" className="text-[10px] uppercase tracking-wider text-zinc-500">
                Target Platform
              </label>
              <select
                id="publish-platform"
                value={publishPlatform}
                onChange={(event) => setPublishPlatform(event.target.value as typeof publishPlatform)}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-fuchsia-600/60"
              >
                <option value="tiktok">TikTok</option>
                <option value="reels">Reels</option>
                <option value="shorts">Shorts</option>
                <option value="generic">Generic</option>
              </select>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => void handlePublish()}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-fuchsia-700/50 bg-fuchsia-800/40 px-4 py-2 text-sm font-semibold text-fuchsia-100 transition-colors hover:bg-fuchsia-800/60 focus:outline-none focus:ring-2 focus:ring-fuchsia-500"
            >
              Publish to {publishPlatform}
            </button>
            {publishState && <p className="text-xs text-zinc-400">{publishState}</p>}
          </div>

          {selectedJob.outputArtifacts?.exportPathByPlatform && Object.keys(selectedJob.outputArtifacts.exportPathByPlatform).length > 0 && (
            <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">Published Targets</p>
              <dl className="mt-2 space-y-2 text-xs text-zinc-300">
                {Object.entries(selectedJob.outputArtifacts.exportPathByPlatform).map(([platform, value]) => (
                  <div key={platform} className="flex items-center justify-between gap-4">
                    <dt className="uppercase tracking-wider text-zinc-500">{platform}</dt>
                    <dd className="truncate text-right font-mono text-zinc-300">{String(value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {publishHistory.length > 0 && (
            <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">Publish History</p>
              <div className="mt-3 space-y-3">
                {publishHistory.map((entry) => (
                  <div key={entry.publishId} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">{entry.platform}</p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {entry.accountLabel ?? "Publisher"} · {entry.deliveryMode?.replace(/_/g, " ") ?? "manual handoff"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-medium text-fuchsia-200">{entry.status.replace(/_/g, " ")}</p>
                        <p className="mt-1 text-[10px] uppercase tracking-wider text-zinc-500">Approval: {entry.approvalState.replace(/_/g, " ")}</p>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-2 text-[11px] text-zinc-400 sm:grid-cols-2">
                      <p>Requested: {new Date(entry.requestedAt).toLocaleString()}</p>
                      <p>Updated: {new Date(entry.updatedAt).toLocaleString()}</p>
                      {entry.scheduledAt && <p>Scheduled: {new Date(entry.scheduledAt).toLocaleString()}</p>}
                      {entry.platformUrl && <p className="truncate">Target: {entry.platformUrl}</p>}
                      {entry.failureReason && <p className="text-red-400">Failure: {entry.failureReason}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
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

      {/* Models used */}
      {selectedJob.output?.modelsUsed && Object.keys(selectedJob.output.modelsUsed).length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
            Models Used
          </h3>
          <dl className="space-y-1">
            {Object.entries(selectedJob.output.modelsUsed).map(([stage, model]) => (
              <div key={stage} className="flex items-center justify-between gap-4">
                <dt className="text-[10px] text-zinc-600 capitalize">
                  {stage.replace(/_/g, " ")}
                </dt>
                <dd className="text-[10px] font-mono text-zinc-400">{model as string}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────
// FIX: Module-scope component — not nested inside VideoPage

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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function VideoPage() {
  const {
    fetchJobs,
    listJobs,
    isLoading,
    listError,
    selectJob,
    selectedJobId,
  } = useVideoStore();

  // Load job list once on mount.
  // FIX: No useEffect that subscribes to SSE and re-applies video events —
  // the store's ingestEvent() (called by the top-level SSE hook) is the
  // single authoritative event application path.
  useEffect(() => {
    void fetchJobs();
  }, [fetchJobs]);

  const handleSubmitted = useCallback(
    (jobId: string) => {
      selectJob(jobId);
    },
    [selectJob]
  );

  const jobs = listJobs();
  const hasJobs = jobs.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-0">
      {/* Page header */}
      <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-zinc-100 tracking-tight">
            Video Generation
          </h1>
          <p className="text-xs text-zinc-600 mt-0.5">
            Faceless short-form video pipeline · ComfyUI + LTX/Wan · local 8GB
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
        {/* Left column: form + list */}
        <div className="flex flex-col gap-4 w-full max-w-xl border-r border-zinc-800 overflow-y-auto p-5">
          <VideoJobForm onSubmitted={handleSubmitted} />

          {/* Job list */}
          <div className="flex flex-col gap-2">
            {isLoading && (
              <div className="flex items-center gap-2 py-4 px-2">
                <svg className="w-4 h-4 animate-spin text-zinc-600" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-xs text-zinc-600">Loading jobs…</span>
              </div>
            )}

            {listError && (
              <div className="rounded-lg bg-red-950/40 border border-red-900/40 px-3 py-2">
                <p className="text-xs text-red-400">{listError}</p>
              </div>
            )}

            {!isLoading && !hasJobs && <EmptyJobList />}

            {jobs.map((job) => (
              <VideoJobCard
                key={job.id}
                job={job}
                onSelect={selectJob}
                isSelected={selectedJobId === job.id}
              />
            ))}
          </div>
        </div>

        {/* Right column: detail panel */}
        <div className="flex-1 overflow-y-auto min-w-0">
          <VideoJobDetailPanel />
        </div>
      </div>
    </div>
  );
}