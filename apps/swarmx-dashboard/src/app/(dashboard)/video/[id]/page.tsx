"use client";

import { useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Clapperboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVideoStore } from "../../../../stores/video";
import { VideoJobTimeline } from "../../../../components/video/VideoJobTimeline";
import { ViralityMeter } from "../../../../components/video/ViralityMeter";
import { CaptionEditor } from "../../../../components/video/CaptionEditor";
import { PlatformPublishPanel } from "../../../../components/video/PlatformPublishPanel";
import type { VideoExportPlatform } from "@swarmx/types/video-types";
import { getVideoPublishPlatform } from "../../../../lib/video-dashboard";
import VideoJobDetailLoading from "./loading";

export default function VideoJobDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? "";

  const {
    getJob,
    fetchJobDetail,
    selectJob,
    publishJob,
    recordJobSseStream,
  } = useVideoStore((s) => ({
    getJob: s.getJob,
    fetchJobDetail: s.fetchJobDetail,
    selectJob: s.selectJob,
    publishJob: s.publishJob,
    recordJobSseStream: s.recordJobSseStream,
  }));

  const job = getJob(id);

  useEffect(() => {
    if (!id) return;
    selectJob(id);
    void fetchJobDetail(id);
    const teardown = recordJobSseStream(id);
    return () => {
      teardown?.();
    };
  }, [id, selectJob, fetchJobDetail, recordJobSseStream]);

  const publishHistory = useMemo(
    () => job?.publishHistory ?? job?.outputArtifacts?.publishHistory ?? [],
    [job],
  );

  if (!job) {
    return (
      <main
        aria-busy="true"
        aria-label="Loading video job details"
        className="h-full min-h-0"
      >
        <VideoJobDetailLoading />
      </main>
    );
  }

  const selectedPlatform: VideoExportPlatform = getVideoPublishPlatform(job);

  return (
    <main className="h-full min-h-0 flex flex-col" aria-label="Video job details">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-bg-surface/95 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3 text-sm">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => router.push("/video")}
            className="shrink-0"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Queue
          </Button>
          <span className="truncate font-mono text-xs text-text-muted">Video / {job.id.slice(0, 8)}</span>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 overflow-y-auto p-4 sm:p-6 lg:grid-cols-[minmax(320px,55%)_minmax(280px,45%)]">
        <section className="space-y-4">
          <div className="rounded border border-border bg-bg-elevated p-3">
            {job.output?.publicUrl ? (
              <div className="mx-auto aspect-[9/16] max-h-[70vh] w-full max-w-[420px] overflow-hidden rounded bg-black">
                <video
                  src={job.output.publicUrl}
                  controls
                  aria-label={`Generated video: ${job.request.prompt.slice(0, 60)}`}
                  className="h-full w-full object-contain"
                />
              </div>
            ) : (
              <div className="mx-auto flex aspect-[9/16] max-h-[70vh] w-full max-w-[420px] items-center justify-center rounded border border-border bg-bg-surface text-sm text-text-muted">
                <div className="space-y-2 text-center">
                  <Clapperboard className="mx-auto h-7 w-7 text-text-muted" aria-hidden="true" />
                  <p>Generating preview</p>
                </div>
              </div>
            )}
          </div>

          <div className="rounded border border-border bg-bg-elevated p-4">
            <p className="text-[10px] text-text-muted font-mono uppercase tracking-wider">Metadata</p>
            <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-text-secondary sm:grid-cols-2">
              <div><span className="text-text-muted">ID:</span> {job.id.slice(0, 12)}...</div>
              <div><span className="text-text-muted">Mode:</span> {job.request.modelTier ?? "auto"}</div>
              <div><span className="text-text-muted">Tone:</span> {job.request.tone ?? "educational"}</div>
              <div><span className="text-text-muted">Style:</span> {(job.request.style ?? "faceless_broll").replace(/_/g, " ")}</div>
              <div><span className="text-text-muted">Captions:</span> {(job.request.captionStyle ?? "bold_center").replace(/_/g, " ")}</div>
              <div><span className="text-text-muted">Voice:</span> {job.request.voice ?? "default"}</div>
              {job.request.audience && (
                <div className="sm:col-span-2"><span className="text-text-muted">Audience:</span> {job.request.audience}</div>
              )}
              <div><span className="text-text-muted">Resolution:</span> {job.output ? `${job.output.widthPx}x${job.output.heightPx}` : "pending"}</div>
              <div><span className="text-text-muted">Created:</span> {new Date(job.createdAt).toLocaleString()}</div>
              {job.output && (
                <>
                  <div><span className="text-text-muted">Size:</span> {(job.output.fileSizeBytes / 1024 / 1024).toFixed(1)} MB</div>
                  <div><span className="text-text-muted">Duration:</span> {job.output.durationSeconds.toFixed(1)}s</div>
                </>
              )}
            </div>
          </div>

          {(job.output?.scriptText || job.output?.storyboardFrames?.length) && (
            <div className="rounded border border-border bg-bg-elevated p-4">
              <p className="text-[10px] text-text-muted font-mono uppercase tracking-wider">Creative Review</p>
              {job.output.scriptText && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-text-secondary">Script</p>
                  <p className="mt-1 whitespace-pre-wrap rounded border border-border bg-bg-surface p-3 text-xs leading-5 text-text-secondary">
                    {job.output.scriptText}
                  </p>
                </div>
              )}
              {job.output.storyboardFrames && job.output.storyboardFrames.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-text-secondary">Storyboard</p>
                  <ol className="mt-1 space-y-1 rounded border border-border bg-bg-surface p-3 text-xs leading-5 text-text-secondary">
                    {job.output.storyboardFrames.map((frame, index) => (
                      <li key={`${frame}-${index}`} className="flex gap-2">
                        <span className="font-mono text-text-muted">{index + 1}.</span>
                        <span>{frame}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}

          <div className="rounded border border-border bg-bg-elevated p-4">
            <VideoJobTimeline job={job} />
          </div>

          {job.operatorTrace && job.operatorTrace.length > 0 && (
            <div className="rounded border border-border bg-bg-elevated p-4">
              <p className="text-[10px] text-text-muted font-mono uppercase tracking-wider mb-2">Operator Trace</p>
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <caption className="sr-only">Operator trace for job {job.id.slice(0, 8)}</caption>
                  <thead>
                    <tr className="text-text-muted">
                      <th className="text-left py-1">Stage</th>
                      <th className="text-left py-1">Operator</th>
                      <th className="text-left py-1">Latency</th>
                      <th className="text-left py-1">Tokens</th>
                      <th className="text-left py-1">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {job.operatorTrace.map((entry, idx) => (
                      <tr key={`${entry.stage}-${idx}`} className="border-t border-border/60">
                        <td className="py-1 text-text-secondary">{String(entry.stage)}</td>
                        <td className="py-1 text-text-secondary">{entry.operator}</td>
                        <td className="py-1 text-text-muted">{entry.latencyMs ?? 0}ms</td>
                        <td className="py-1 text-text-muted">{entry.tokenCount ?? 0}</td>
                        <td className={entry.success === false ? "py-1 text-red-400" : "py-1 text-emerald-400"}>
                          {entry.success === false ? "failed" : "ok"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        <section className="space-y-4">
          {job.viralitySignal && (
            <div className="rounded border border-border bg-bg-elevated p-4">
              <ViralityMeter signal={job.viralitySignal} />
            </div>
          )}

          {job.viralitySignal?.captionDraft && (
            <div className="rounded border border-border bg-bg-elevated p-4">
              <CaptionEditor
                jobId={job.id}
                initialDraft={job.viralitySignal.captionDraft}
                platform={selectedPlatform}
              />
            </div>
          )}

          {job.status === "completed" && (
            <div className="rounded border border-border bg-bg-elevated p-4">
              <PlatformPublishPanel
                job={job}
                publishHistory={publishHistory}
                onPublish={async (platform, scheduledAt) => {
                  const result = await publishJob(job.id, {
                    platform,
                    ...(scheduledAt ? { scheduledAt } : {}),
                  });
                  await fetchJobDetail(job.id);
                  return result;
                }}
              />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
