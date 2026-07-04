/**
 * CaptionEditor — interactive caption draft editor with live validation,
 * virality re-scoring, platform preview pane, and clipboard copy.
 *
 * Design constraints (inviolable):
 *   font-mono, text-xs/text-[10px], border-zinc-700/800, bg-zinc-900, zinc/amber palette.
 *   No external colour tokens. No new design-system dependencies.
 */

"use client";

import { useState, useCallback, useRef, useTransition } from "react";
import type { CaptionDraft, ViralitySignal, VideoExportPlatform } from "@swarmx/types/video-types";

const API_BASE = typeof window !== "undefined"
  ? (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:7380")
  : "http://localhost:7380";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CaptionEditorProps {
  jobId?: string;
  initialDraft: CaptionDraft;
  platform?: VideoExportPlatform;
  onSignalUpdate?: (signal: ViralitySignal) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FIRST_LINE_MAX = 40;

function countChars(text: string): number {
  return [...text].length;
}

function firstLineClass(text: string): string {
  const len = countChars(text);
  if (len > FIRST_LINE_MAX) return "border-red-500 focus:ring-red-500";
  if (len > FIRST_LINE_MAX * 0.85) return "border-amber-500 focus:ring-amber-500";
  return "border-zinc-700 focus:ring-amber-600/60";
}

// ─── Platform preview ────────────────────────────────────────────────────────

function PlatformPreview({
  draft,
  platform,
}: {
  draft: CaptionDraft;
  platform?: VideoExportPlatform;
}) {
  const preview = platform === "tiktok" || platform === "reels"
    ? draft.firstLine.slice(0, FIRST_LINE_MAX)
    : draft.firstLine;

  const isTruncated =
    (platform === "tiktok" || platform === "reels") &&
    countChars(draft.firstLine) > FIRST_LINE_MAX;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
      <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">
        {platform === "tiktok" ? "TikTok" : platform === "reels" ? "Reels" : "Preview"}
        {" "}Caption
      </p>
      <p className="text-xs text-zinc-200 leading-relaxed">
        <span className="font-semibold">{preview}</span>
        {isTruncated && (
          <span className="text-red-400 text-[10px] font-mono ml-1">[truncated at 40 chars]</span>
        )}
        {!isTruncated && draft.body && (
          <span className="text-zinc-400"> {draft.body}</span>
        )}
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        {[...draft.hashtags.broad, ...draft.hashtags.niche, ...draft.hashtags.trending].map(
          (tag) => (
            <span
              key={tag}
              className="rounded-full bg-zinc-800 border border-zinc-700 px-2 py-0.5 text-[10px] text-cyan-300"
            >
              {tag.startsWith("#") ? tag : `#${tag}`}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CaptionEditor({
  jobId: _jobId,
  initialDraft,
  platform,
  onSignalUpdate,
}: CaptionEditorProps) {
  const [draft, setDraft] = useState<CaptionDraft>(initialDraft);
  const [broadHashtag, setBroadHashtag] = useState(
    initialDraft.hashtags.broad.join(" "),
  );
  const [nicheHashtag, setNicheHashtag] = useState(
    initialDraft.hashtags.niche.join(" "),
  );
  const [trendingHashtag, setTrendingHashtag] = useState(
    initialDraft.hashtags.trending[0] ?? "",
  );
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [isPending, startTransition] = useTransition();
  const [rescoreError, setRescoreError] = useState<string | null>(null);
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Sync hashtag sub-fields back into draft ────────────────────────────────
  const syncHashtags = useCallback(
    (
      broad: string,
      niche: string,
      trending: string,
    ): CaptionDraft["hashtags"] => ({
      broad: broad
        .split(/\s+/)
        .filter(Boolean)
        .map((t) => t.replace(/^#/, "")),
      niche: niche
        .split(/\s+/)
        .filter(Boolean)
        .map((t) => t.replace(/^#/, "")),
      trending: trending
        .trim()
        .replace(/^#/, "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 1),
    }),
    [],
  );

  const handleFirstLine = (value: string) => {
    setDraft((prev) => ({ ...prev, firstLine: value }));
  };

  const handleBody = (value: string) => {
    setDraft((prev) => ({ ...prev, body: value }));
  };

  const handleCta = (value: string) => {
    setDraft((prev) => ({ ...prev, cta: value }));
  };

  const handleHashtagChange = (
    type: "broad" | "niche" | "trending",
    value: string,
  ) => {
    if (type === "broad") setBroadHashtag(value);
    if (type === "niche") setNicheHashtag(value);
    if (type === "trending") setTrendingHashtag(value);

    const newHashtags = syncHashtags(
      type === "broad" ? value : broadHashtag,
      type === "niche" ? value : nicheHashtag,
      type === "trending" ? value : trendingHashtag,
    );

    setDraft((prev) => ({ ...prev, hashtags: newHashtags }));
  };

  // ── Clipboard copy ─────────────────────────────────────────────────────────
  const handleCopy = useCallback(() => {
    const all = [
      draft.firstLine,
      "",
      draft.body,
      "",
      draft.cta,
      "",
      [
        ...draft.hashtags.broad,
        ...draft.hashtags.niche,
        ...draft.hashtags.trending,
      ]
        .map((t) => `#${t.replace(/^#/, "")}`)
        .join(" "),
    ]
      .join("\n")
      .trim();

    void navigator.clipboard.writeText(all).then(() => {
      setCopyState("copied");
      if (toastRef.current) clearTimeout(toastRef.current);
      toastRef.current = setTimeout(() => setCopyState("idle"), 2_000);
    });
  }, [draft]);

  // ── Rescore via API ────────────────────────────────────────────────────────
  const handleRescore = useCallback(() => {
    startTransition(async () => {
      setRescoreError(null);
      try {
        const token = process.env["NEXT_PUBLIC_VIDEO_API_TOKEN"] ?? "";
        const res = await fetch(`${API_BASE}/api/video/caption/score`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            prompt: draft.firstLine + " " + draft.body,
            platform: platform ?? "generic",
          }),
        });

        if (!res.ok) {
          setRescoreError("Rescore failed — API error");
          return;
        }

        const data = (await res.json()) as {
          captionDraft?: CaptionDraft;
          viralitySignal?: ViralitySignal;
        };

        if (data.viralitySignal) {
          onSignalUpdate?.(data.viralitySignal);
        }
      } catch {
        setRescoreError("Rescore failed — network error");
      }
    });
  }, [draft, platform, onSignalUpdate]);

  const firstLineLen = countChars(draft.firstLine);
  const hashtagCount =
    draft.hashtags.broad.length +
    draft.hashtags.niche.length +
    draft.hashtags.trending.length;

  return (
    <section
      aria-label="Caption editor"
      className="rounded-xl border border-cyan-900/40 bg-cyan-950/10 p-4"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold text-cyan-300 uppercase tracking-wider">
          Caption Draft
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRescore}
            disabled={isPending}
            className="
              rounded-lg border border-cyan-700/50 bg-cyan-900/30 px-3 py-1.5
              text-[10px] font-semibold uppercase tracking-wider text-cyan-200
              hover:bg-cyan-900/50 disabled:opacity-40 disabled:cursor-not-allowed
              transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-500
            "
          >
            {isPending ? "Scoring…" : "Re-score"}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="
              relative rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5
              text-[10px] font-semibold uppercase tracking-wider text-zinc-300
              hover:bg-zinc-700 transition-colors focus:outline-none focus:ring-2
              focus:ring-zinc-500 overflow-hidden
            "
          >
            {copyState === "copied" ? (
              <span className="text-emerald-400">Copied!</span>
            ) : (
              "Copy Caption"
            )}
          </button>
        </div>
      </div>

      {rescoreError && (
        <div className="mb-3 rounded-lg bg-red-950/40 border border-red-900/40 px-3 py-2">
          <p className="text-xs text-red-400">{rescoreError}</p>
        </div>
      )}

      {/* First line */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] uppercase tracking-wider text-zinc-500">
            Hook Line
          </label>
          <span
            className={`text-[10px] font-mono tabular-nums ${
              firstLineLen > FIRST_LINE_MAX
                ? "text-red-400"
                : firstLineLen > FIRST_LINE_MAX * 0.85
                ? "text-amber-400"
                : "text-zinc-600"
            }`}
          >
            {firstLineLen}/{FIRST_LINE_MAX}
          </span>
        </div>
        <input
          type="text"
          value={draft.firstLine}
          onChange={(e) => handleFirstLine(e.target.value)}
          maxLength={120}
          className={`
            w-full rounded-lg bg-zinc-900 border px-3 py-2 text-sm text-zinc-100
            placeholder:text-zinc-600 focus:outline-none focus:ring-1
            transition-colors font-mono ${firstLineClass(draft.firstLine)}
          `}
          placeholder="Primary hook (≤ 40 chars visible on feed)"
        />
      </div>

      {/* Body */}
      <div className="mb-3">
        <label className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-1">
          Body
        </label>
        <textarea
          value={draft.body}
          onChange={(e) => handleBody(e.target.value)}
          rows={3}
          className="
            w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm
            text-zinc-200 placeholder:text-zinc-600 focus:outline-none
            focus:ring-1 focus:ring-amber-600/60 focus:border-amber-700
            resize-none transition-colors leading-relaxed
          "
          placeholder="2–3 lines: value, story, or relatability…"
        />
      </div>

      {/* CTA */}
      <div className="mb-4">
        <label className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-1">
          Call to Action
        </label>
        <input
          type="text"
          value={draft.cta}
          onChange={(e) => handleCta(e.target.value)}
          className="
            w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2
            text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none
            focus:ring-1 focus:ring-amber-600/60 focus:border-amber-700
            transition-colors
          "
          placeholder="Follow for more…"
        />
      </div>

      {/* Hashtag inputs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        {(
          [
            { key: "broad" as const, label: "Broad (1–2)", value: broadHashtag },
            { key: "niche" as const, label: "Niche (1–2)", value: nicheHashtag },
            {
              key: "trending" as const,
              label: "Trending (1 max)",
              value: trendingHashtag,
            },
          ] as Array<{
            key: "broad" | "niche" | "trending";
            label: string;
            value: string;
          }>
        ).map(({ key, label, value }) => (
          <div key={key}>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-1">
              {label}
            </label>
            <input
              type="text"
              value={value}
              onChange={(e) => handleHashtagChange(key, e.target.value)}
              className="
                w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2
                text-xs text-cyan-300 font-mono placeholder:text-zinc-700
                focus:outline-none focus:ring-1 focus:ring-cyan-600/60
                focus:border-cyan-700 transition-colors
              "
              placeholder={key === "trending" ? "#tiktok" : "#tag1 #tag2"}
            />
          </div>
        ))}
      </div>

      {/* Hashtag count indicator */}
      <p
        className={`text-[10px] font-mono mb-4 ${
          hashtagCount < 3 || hashtagCount > 5 ? "text-amber-400" : "text-zinc-600"
        }`}
      >
        {hashtagCount} total hashtag{hashtagCount !== 1 ? "s" : ""}
        {hashtagCount < 3 && " — aim for 3–5"}
        {hashtagCount > 5 && " — reduce to 3–5"}
      </p>

      {/* Sound suggestion */}
      {draft.soundSuggestion && (
        <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
            Audio Style
          </p>
          <p className="text-xs text-zinc-400">{draft.soundSuggestion}</p>
        </div>
      )}

      {/* Platform preview */}
      <PlatformPreview draft={draft} {...(platform ? { platform } : {})} />
    </section>
  );
}
