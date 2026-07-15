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
import { useVideoStore } from "../../stores/video";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CaptionEditorProps {
  jobId?: string;
  initialDraft: CaptionDraft;
  platform?: VideoExportPlatform;
  onSignalUpdate?: (signal: ViralitySignal) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FIRST_LINE_MAX = 40;

const DISALLOWED_OPENERS = ["i ", "my ", "this ", "we ", "our "];

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
  jobId: _unusedJobId, // eslint-disable-line @typescript-eslint/no-unused-vars -- reserved for future job-scoped rescore routing
  initialDraft,
  platform,
  onSignalUpdate,
}: CaptionEditorProps) {
  const scoreCaption = useVideoStore((s) => s.scoreCaption);
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
        const signal = await scoreCaption(draft, platform ?? "generic");
        if (signal) {
          onSignalUpdate?.(signal);
          return;
        }
        setRescoreError("Rescore unavailable");
      } catch {
        setRescoreError("Rescore failed — network error");
      }
    });
  }, [draft, platform, onSignalUpdate, scoreCaption]);

  const firstLineLen = countChars(draft.firstLine);
  const hashtagCount =
    draft.hashtags.broad.length +
    draft.hashtags.niche.length +
    draft.hashtags.trending.length;
  const hasDisallowedOpener = DISALLOWED_OPENERS.some((opener) =>
    draft.firstLine.trimStart().toLowerCase().startsWith(opener),
  );

  return (
    <section
      aria-label="Caption editor"
      className="rounded border border-border bg-bg-elevated p-4"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-mono text-text-secondary uppercase tracking-wider">
          Caption Draft
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRescore}
            disabled={isPending}
            aria-label="Re-score caption virality"
            className="
              rounded border border-border px-2 py-1 text-[10px] font-mono text-text-secondary
              hover:text-sky-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors
            "
          >
            {isPending ? "Scoring…" : "Re-score"}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            aria-label={copyState === "copied" ? "Caption copied to clipboard" : "Copy full caption to clipboard"}
            className="
              relative rounded border border-border px-2 py-1 text-[10px] font-mono text-text-secondary
              hover:text-text-primary transition-colors overflow-hidden
            "
          >
            {copyState === "copied" ? (
              <span className="text-emerald-400">Copied!</span>
            ) : (
              "Copy Caption"
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(initialDraft);
              setBroadHashtag(initialDraft.hashtags.broad.join(" "));
              setNicheHashtag(initialDraft.hashtags.niche.join(" "));
              setTrendingHashtag(initialDraft.hashtags.trending[0] ?? "");
              setRescoreError(null);
            }}
            aria-label="Reset caption draft to original"
            className="rounded border border-border px-2 py-1 text-[10px] font-mono text-text-muted hover:text-text-primary"
          >
            Reset
          </button>
        </div>
      </div>

      {rescoreError && (
        <div role="alert" className="mb-3 rounded-lg bg-red-950/40 border border-red-900/40 px-3 py-2">
          <p className="text-xs text-red-400">{rescoreError}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[55%_45%] gap-4">
        <fieldset className="space-y-3" aria-label="Caption structure fields">
          <legend className="sr-only">Caption structure fields</legend>
          {/* First line */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="caption-firstline" className="text-[10px] uppercase tracking-wider text-text-muted font-mono">
                Hook Line
              </label>
              <span
                className={`text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded ${
                  firstLineLen > FIRST_LINE_MAX
                    ? "bg-red-400/20 text-red-400"
                    : "bg-emerald-400/20 text-emerald-400"
                }`}
              >
                {firstLineLen}/{FIRST_LINE_MAX}
              </span>
            </div>
            <textarea
              id="caption-firstline"
              value={draft.firstLine}
              onChange={(e) => handleFirstLine(e.target.value)}
              rows={1}
              aria-describedby="caption-firstline-help"
              className={`
                w-full rounded bg-bg-surface border border-border px-3 py-2 text-sm text-text-primary
                placeholder:text-text-muted focus:outline-none focus:ring-1 transition-colors font-mono ${firstLineClass(draft.firstLine)}
              `}
              placeholder="Primary hook (<=40 chars visible on feed)"
            />
            <p id="caption-firstline-help" className="sr-only">Maximum 40 characters are visible in platform feed previews.</p>
            {hasDisallowedOpener && (
              <p className="mt-1 text-amber-400 text-[10px]">
                Hook Line can&apos;t start with &ldquo;I&rdquo;, &ldquo;My&rdquo;, &ldquo;This&rdquo;, &ldquo;We&rdquo;, or &ldquo;Our&rdquo; — lead with the value or action instead.
              </p>
            )}
          </div>

          {/* Body */}
          <div>
            <label htmlFor="caption-body" className="text-[10px] uppercase tracking-wider text-text-muted block mb-1 font-mono">
              Body
            </label>
            <textarea
              id="caption-body"
              value={draft.body}
              onChange={(e) => handleBody(e.target.value)}
              rows={3}
              aria-describedby="caption-body-help"
              className="
                w-full rounded bg-bg-surface border border-border px-3 py-2 text-sm
                text-text-secondary placeholder:text-text-muted focus:outline-none
                focus:ring-1 resize-none transition-colors leading-relaxed
              "
              placeholder="2–3 lines: value, story, or relatability..."
            />
            <p id="caption-body-help" className="sr-only">Use two to three concise lines to provide value and context.</p>
          </div>

          {/* CTA */}
          <div>
            <label htmlFor="caption-cta" className="text-[10px] uppercase tracking-wider text-text-muted block mb-1 font-mono">
              Call to Action
            </label>
            <textarea
              id="caption-cta"
              value={draft.cta}
              onChange={(e) => handleCta(e.target.value)}
              rows={1}
              aria-describedby="caption-cta-help"
              className="
                w-full rounded bg-bg-surface border border-border px-3 py-2
                text-sm text-text-primary placeholder:text-text-muted focus:outline-none
                focus:ring-1 transition-colors
              "
              placeholder="Follow for more..."
            />
            <p id="caption-cta-help" className="sr-only">Provide a short call to action for the viewer.</p>
          </div>

          {/* Hashtag inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(
              [
                { key: "broad" as const, label: "Broad", value: broadHashtag },
                { key: "niche" as const, label: "Niche", value: nicheHashtag },
                {
                  key: "trending" as const,
                  label: "Trending",
                  value: trendingHashtag,
                },
              ] as Array<{
                key: "broad" | "niche" | "trending";
                label: string;
                value: string;
              }>
            ).map(({ key, label, value }) => (
              <div key={key}>
                <label htmlFor={`caption-hashtag-${key}`} className="text-[10px] uppercase tracking-wider text-text-muted block mb-1 font-mono">
                  {label}
                </label>
                <input
                  id={`caption-hashtag-${key}`}
                  type="text"
                  value={value}
                  onChange={(e) => handleHashtagChange(key, e.target.value)}
                  className="
                    w-full rounded bg-bg-surface border border-border px-3 py-2
                    text-xs text-sky-400 font-mono placeholder:text-text-muted
                    focus:outline-none focus:ring-1 transition-colors
                  "
                  placeholder={key === "trending" ? "#trend (max 1)" : "#tag1 #tag2"}
                />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <p
              className={`text-[10px] font-mono ${
                hashtagCount < 3 || hashtagCount > 5 ? "text-amber-400" : "text-text-muted"
              }`}
            >
              {hashtagCount}/5 hashtags
            </p>
          </div>

          {/* Sound suggestion */}
          <div>
            <label htmlFor="caption-sound" className="text-[10px] uppercase tracking-wider text-text-muted block mb-1 font-mono">
              Sound Suggestion
            </label>
            <input
              id="caption-sound"
              type="text"
              value={draft.soundSuggestion ?? ""}
              onChange={(e) => setDraft((prev) => ({ ...prev, soundSuggestion: e.target.value }))}
              className="w-full rounded bg-bg-surface border border-border px-3 py-2 text-xs text-text-secondary placeholder:text-text-muted focus:outline-none focus:ring-1 transition-colors"
              placeholder="e.g. upbeat lo-fi with snare drop"
            />
          </div>
        </fieldset>

        <div className="space-y-3">
          <PlatformPreview draft={draft} {...(platform ? { platform } : {})} />
          <div className="rounded border border-border bg-bg-surface px-3 py-2">
            <p className="text-[10px] text-text-muted">{copyState === "copied" ? "Caption copied ✓" : "Use Re-score to refresh Oracle virality feedback."}</p>
          </div>
        </div>
      </div>

    </section>
  );
}
