"use client";

import { useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useVideoStore } from "../../../../stores/video";
import { VideoJobTimeline } from "../../../../components/video/VideoJobTimeline";
import { ViralityMeter } from "../../../../components/video/ViralityMeter";
import { CaptionEditor } from "../../../../components/video/CaptionEditor";
import { PlatformPublishPanel } from "../../../../components/video/PlatformPublishPanel";
import type { VideoExportPlatform } from "@swarmx/types/video-types";
import { getVideoPublishPlatform } from "../../../../lib/video-dashboard";

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
      <div className="p-6 text-sm text-text-muted">
        Loading job details...
      </div>
    );
  }

  const selectedPlatform: VideoExportPlatform = getVideoPublishPlatform(job);

  return (
    <div className="h-full min-h-0 flex flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-bg-surface px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => router.push("/video")}
            className="text-text-muted hover:text-text-primary"
          >
            {"<- Back to Queue"}
          </button>
          <span className="text-text-muted">{"Video -> "}{job.id.slice(0, 8)}</span>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[55%_45%] gap-5 p-6 overflow-y-auto">
        <section className="space-y-4">
          <div className="rounded-xl border border-border bg-bg-elevated p-3">
            {job.output?.publicUrl ? (
              <video
                src={job.output.publicUrl}
                controls
                className="w-full rounded-lg bg-black aspect-video object-contain"
              />
            ) : (
              <div className="aspect-video rounded-lg bg-bg-surface border border-border flex items-center justify-center text-text-muted text-sm">
                Generating...
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border bg-bg-elevated p-4">
            <p className="text-[10px] text-text-muted font-mono uppercase tracking-wider">Metadata</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-text-secondary">
              <div>ID: {job.id.slice(0, 12)}...</div>
              <div>Mode: {job.request.modelTier ?? "auto"}</div>
              <div>Resolution: {job.output ? `${job.output.widthPx}x${job.output.heightPx}` : "pending"}</div>
              <div>Created: {new Date(job.createdAt).toLocaleString()}</div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-bg-elevated p-4">
            <VideoJobTimeline job={job} />
          </div>

          {job.operatorTrace && job.operatorTrace.length > 0 && (
            <div className="rounded-xl border border-border bg-bg-elevated p-4">
              <p className="text-[10px] text-text-muted font-mono uppercase tracking-wider mb-2">Operator Trace</p>
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
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
            <div className="rounded-xl border border-border bg-bg-elevated p-4">
              <ViralityMeter signal={job.viralitySignal} />
            </div>
          )}

          {job.viralitySignal?.captionDraft && (
            <div className="rounded-xl border border-border bg-bg-elevated p-4">
              <CaptionEditor
                jobId={job.id}
                initialDraft={job.viralitySignal.captionDraft}
                platform={selectedPlatform}
              />
            </div>
          )}

          {job.status === "completed" && (
            <div className="rounded-xl border border-border bg-bg-elevated p-4">
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
    </div>
  );
}
