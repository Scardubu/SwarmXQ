/**
 * PlatformPublishPanel — scheduling-aware publish panel.
 *
 * Wraps the publish action in a cohesive UI:
 * - Platform selector
 * - Optional scheduled-time input
 * - Approval-aware status display
 * - Publish history table
 */

"use client";

import { useState, useCallback } from "react";
import type { PublishResult, VideoExportPlatform } from "@swarmx/types/video-types";
import type { VideoJob } from "../../../../swarmx-api/src/types/video";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlatformPublishPanelProps {
  job: VideoJob;
  publishHistory: PublishResult[];
  publishResult?: PublishResult;
  onPublish: (platform: VideoExportPlatform, scheduledAt?: string) => Promise<PublishResult | null>;
  disabled?: boolean;
}

// ─── Platform meta ────────────────────────────────────────────────────────────

const PLATFORM_META: Record<
  VideoExportPlatform,
  { label: string; requiresApproval: boolean; colour: string }
> = {
  tiktok: { label: "TikTok", requiresApproval: true, colour: "text-pink-400" },
  reels: { label: "Reels", requiresApproval: true, colour: "text-fuchsia-400" },
  shorts: { label: "Shorts", requiresApproval: false, colour: "text-red-400" },
  generic: { label: "Generic", requiresApproval: false, colour: "text-zinc-300" },
};

// ─── Status badge ─────────────────────────────────────────────────────────────

function PublishStatusBadge({ status }: { status: PublishResult["status"] }) {
  const config = {
    published: "bg-emerald-950/60 text-emerald-300 border-emerald-800/50",
    scheduled: "bg-blue-950/60 text-blue-300 border-blue-800/50",
    pending_review: "bg-amber-950/60 text-amber-300 border-amber-800/50",
    failed: "bg-red-950/60 text-red-300 border-red-800/50",
  }[status];

  const label = {
    published: "Published",
    scheduled: "Scheduled",
    pending_review: "Pending Review",
    failed: "Failed",
  }[status];

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${config}`}
    >
      {label}
    </span>
  );
}

// ─── History row ──────────────────────────────────────────────────────────────

function HistoryRow({ entry }: { entry: PublishResult }) {
  const meta = PLATFORM_META[entry.platform];

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-wider ${meta.colour}`}>
            {meta.label}
          </p>
          <p className="text-[10px] text-zinc-500 mt-0.5">
            {entry.accountLabel ?? "Publisher"} ·{" "}
            {(entry.deliveryMode ?? "manual_handoff").replace(/_/g, " ")}
          </p>
        </div>
        <PublishStatusBadge status={entry.status} />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-zinc-500">
        <span>Requested: {new Date(entry.requestedAt).toLocaleString()}</span>
        <span>Updated: {new Date(entry.updatedAt).toLocaleString()}</span>
        {entry.scheduledAt && (
          <span className="col-span-2">
            Scheduled for: {new Date(entry.scheduledAt).toLocaleString()}
          </span>
        )}
        {entry.publishedAt && (
          <span className="col-span-2">
            Published at: {new Date(entry.publishedAt).toLocaleString()}
          </span>
        )}
        {entry.approvalState !== "not_required" && (
          <span className="col-span-2">
            Approval: {entry.approvalState.replace(/_/g, " ")}
          </span>
        )}
      </div>

      {entry.platformUrl && (
        <a
          href={entry.platformUrl}
          target="_blank"
          rel="noreferrer"
          className="truncate text-[10px] font-mono text-cyan-300 hover:text-cyan-200 underline-offset-2 hover:underline"
        >
          {entry.platformUrl}
        </a>
      )}

      {entry.requiresApproval && (
        <p className="text-[10px] text-amber-500/80">
          Partner approval required before this video goes live.
        </p>
      )}

      {entry.failureReason && (
        <p className="text-[10px] text-red-400">{entry.failureReason}</p>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

const PLATFORMS: VideoExportPlatform[] = ["tiktok", "reels", "shorts", "generic"];

export function PlatformPublishPanel({
  job,
  publishHistory,
  publishResult,
  onPublish,
  disabled = false,
}: PlatformPublishPanelProps) {
  const [platform, setPlatform] = useState<VideoExportPlatform>("tiktok");
  const [scheduledAt, setScheduledAt] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const meta = PLATFORM_META[platform];

  const handlePublish = useCallback(async () => {
    if (!job) {
      setStatusMsg("Select a video job before publishing");
      return;
    }

    setIsPublishing(true);
    setStatusMsg(null);
    const result = await onPublish(
      platform,
      scheduledAt.trim() ? new Date(scheduledAt).toISOString() : undefined,
    );
    setIsPublishing(false);

    if (result) {
      const label = scheduledAt
        ? `Scheduled → ${meta.label}`
        : `${meta.label}: ${result.status.replace(/_/g, " ")}`;
      setStatusMsg(label);
      setScheduledAt("");
    } else {
      setStatusMsg("Publish request failed — check logs");
    }
  }, [job, platform, scheduledAt, meta.label, onPublish]);

  return (
    <section
      aria-label="Platform publish"
      className="rounded-xl border border-fuchsia-900/40 bg-fuchsia-950/10 p-4"
    >
      <h3 className="text-xs font-semibold text-fuchsia-300 uppercase tracking-wider mb-3">
        Publish
      </h3>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
        {/* Platform */}
        <div className="flex-1">
          <label
            htmlFor="publish-platform-select"
            className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-1"
          >
            Platform
          </label>
          <select
            id="publish-platform-select"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as VideoExportPlatform)}
            disabled={disabled || isPublishing}
            className="
              w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2
              text-sm text-zinc-100 focus:outline-none focus:ring-1
              focus:ring-fuchsia-600/60 disabled:opacity-50 disabled:cursor-not-allowed
            "
          >
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_META[p].label}
                {PLATFORM_META[p].requiresApproval ? " (requires approval)" : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Schedule */}
        <div className="flex-1">
          <label
            htmlFor="publish-schedule-input"
            className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-1"
          >
            Schedule (optional)
          </label>
          <input
            id="publish-schedule-input"
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            disabled={disabled || isPublishing}
            className="
              w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2
              text-sm text-zinc-100 focus:outline-none focus:ring-1
              focus:ring-fuchsia-600/60 disabled:opacity-50 disabled:cursor-not-allowed
            "
          />
        </div>

        <button
          type="button"
          onClick={() => void handlePublish()}
          disabled={disabled || isPublishing}
          className="
            inline-flex min-h-10 items-center justify-center rounded-lg border
            border-fuchsia-700/50 bg-fuchsia-800/40 px-5 py-2 text-sm font-semibold
            text-fuchsia-100 hover:bg-fuchsia-800/60 disabled:opacity-40
            disabled:cursor-not-allowed transition-colors focus:outline-none
            focus:ring-2 focus:ring-fuchsia-500
          "
        >
          {isPublishing
            ? "Sending…"
            : scheduledAt
            ? "Schedule"
            : `Publish to ${meta.label}`}
        </button>
      </div>

      {/* Status feedback */}
      {statusMsg && (
        <p className="mt-3 text-xs text-zinc-400">{statusMsg}</p>
      )}

      {publishResult && (
        <div className="mt-3 rounded border border-border bg-bg-surface px-3 py-2">
          <p className="text-[10px] text-text-muted font-mono">
            Latest: {publishResult.status} {publishResult.platformUrl ? `· ${publishResult.platformUrl}` : ""}
          </p>
        </div>
      )}

      {/* Approval notice */}
      {meta.requiresApproval && (
        <div className="mt-3 rounded-lg bg-amber-950/30 border border-amber-900/40 px-3 py-2">
          <p className="text-[10px] text-amber-400">
            Requires partner approval. See docs/TIKTOK_SETUP.md.
          </p>
        </div>
      )}

      {/* History */}
      {publishHistory.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-3">
            Publish History ({publishHistory.length})
          </p>
          <div className="flex flex-col gap-2 max-h-80 overflow-y-auto">
            {publishHistory.map((entry) => (
              <HistoryRow key={entry.publishId} entry={entry} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
