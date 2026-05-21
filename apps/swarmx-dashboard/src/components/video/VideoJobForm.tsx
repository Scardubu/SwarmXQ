"use client";

/**
 * apps/swarmx-dashboard/src/components/video/VideoJobForm.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Video job creation form. Submits to POST /api/video/jobs.
 * Shows pressure warning when system memory is elevated.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useEventsStore } from "@/stores/events";
import { cn } from "@/lib/utils";
import { Film, Loader2, AlertTriangle, Sparkles } from "lucide-react";

type VideoStyle = "motivational" | "educational" | "narrative" | "documentary" | "explainer" | "abstract" | "custom";
type VideoAspect = "9:16" | "16:9" | "1:1";
type VideoLength = "short" | "medium" | "long";
type TargetPlatform = "tiktok" | "youtube_shorts" | "reels" | "generic";

interface VideoJobFormProps {
  onJobCreated: (jobId: string) => void;
}

const API_BASE = process.env["NEXT_PUBLIC_API_BASE"] ?? "http://localhost:3001";

const STYLE_OPTIONS: { value: VideoStyle; label: string; desc: string }[] = [
  { value: "motivational", label: "Motivational", desc: "Inspire & uplift" },
  { value: "educational", label: "Educational", desc: "Teach & explain" },
  { value: "narrative", label: "Narrative", desc: "Story-driven" },
  { value: "explainer", label: "Explainer", desc: "How-to / concepts" },
  { value: "abstract", label: "Abstract", desc: "Visual / conceptual" },
];

const LENGTH_OPTIONS: { value: VideoLength; label: string; range: string }[] = [
  { value: "short", label: "Short", range: "15–45s" },
  { value: "medium", label: "Medium", range: "45–90s" },
  { value: "long", label: "Long", range: "90–180s" },
];

const ASPECT_OPTIONS: { value: VideoAspect; label: string; hint: string }[] = [
  { value: "9:16", label: "Vertical", hint: "TikTok / Reels" },
  { value: "16:9", label: "Landscape", hint: "YouTube / Desktop" },
  { value: "1:1", label: "Square", hint: "Feed / Cross-platform" },
];

const PLATFORM_OPTIONS: { value: TargetPlatform; label: string }[] = [
  { value: "tiktok", label: "TikTok" },
  { value: "youtube_shorts", label: "YouTube Shorts" },
  { value: "reels", label: "Instagram Reels" },
  { value: "generic", label: "Generic / Other" },
];

const EXAMPLE_PROMPTS = [
  "Create a motivational video about building daily habits that stick",
  "Explain compound interest for a TikTok audience in under 30 seconds",
  "Tell a story about overcoming failure and finding success",
  "Quick finance tip: why you should automate your savings",
];

export function VideoJobForm({ onJobCreated }: VideoJobFormProps) {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<VideoStyle>("motivational");
  const [length, setLength] = useState<VideoLength>("short");
  const [aspect, setAspect] = useState<VideoAspect>("9:16");
  const [platform, setPlatform] = useState<TargetPlatform>("tiktok");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [degradeWarning, setDegradeWarning] = useState<string | null>(null);

  const pressureLevel = useEventsStore((s) => s.governorSnapshot?.pressureLevel ?? "normal");
  const isHighPressure = pressureLevel === "high" || pressureLevel === "critical";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    setDegradeWarning(null);

    try {
      const res = await fetch(`${API_BASE}/api/video/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), style, length, aspect, targetPlatform: platform }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" })) as { error?: string };
        setSubmitError(err.error ?? `HTTP ${res.status}`);
        return;
      }

      const data = await res.json() as { jobId?: string; degradeWarning?: string };
      if (data.degradeWarning) setDegradeWarning(data.degradeWarning);
      if (data.jobId) {
        setPrompt("");
        onJobCreated(data.jobId);
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="rounded-xl border border-border-subtle bg-bg-elevated p-5 space-y-5"
      aria-label="Create video generation job"
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <Film className="h-5 w-5 text-text-accent" aria-hidden />
        <h2 className="text-sm font-semibold text-text-primary">New Video Job</h2>
      </div>

      {/* Pressure warning */}
      {isHighPressure && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            System memory is {pressureLevel}. Render may fall back to storyboard-only output.
            Script and storyboard will still be generated.
          </span>
        </div>
      )}

      {/* Prompt */}
      <div className="space-y-1.5">
        <label htmlFor="video-prompt" className="text-xs font-medium text-text-secondary">
          Describe your video
        </label>
        <Input
          id="video-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. A motivational video about building daily habits..."
          maxLength={2000}
          required
          disabled={submitting}
          className="text-sm"
          aria-describedby="prompt-hint"
        />
        <p id="prompt-hint" className="text-[11px] text-text-muted">
          {prompt.length}/2000 · Be specific about topic, tone, and goal
        </p>
      </div>

      {/* Example prompts */}
      <div className="space-y-1.5">
        <p className="text-[11px] text-text-muted">Examples:</p>
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLE_PROMPTS.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setPrompt(ex)}
              className="rounded-md border border-border-subtle px-2 py-0.5 text-[11px] text-text-secondary hover:bg-bg-surface hover:text-text-primary transition-colors"
            >
              {ex.slice(0, 40)}…
            </button>
          ))}
        </div>
      </div>

      {/* Style + Length row */}
      <div className="grid grid-cols-2 gap-4">
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-text-secondary">Style</legend>
          <div className="flex flex-wrap gap-1.5">
            {STYLE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setStyle(opt.value)}
                disabled={submitting}
                aria-pressed={style === opt.value}
                className={cn(
                  "rounded-md border px-2 py-1 text-[11px] transition-colors",
                  style === opt.value
                    ? "border-text-accent bg-text-accent/10 text-text-accent"
                    : "border-border-subtle text-text-secondary hover:border-border-active hover:text-text-primary",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-text-secondary">Length</legend>
          <div className="flex gap-1.5">
            {LENGTH_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setLength(opt.value)}
                disabled={submitting}
                aria-pressed={length === opt.value}
                className={cn(
                  "rounded-md border px-2 py-1 text-[11px] transition-colors",
                  length === opt.value
                    ? "border-text-accent bg-text-accent/10 text-text-accent"
                    : "border-border-subtle text-text-secondary hover:border-border-active hover:text-text-primary",
                )}
              >
                {opt.label}
                <span className="ml-1 text-text-muted">{opt.range}</span>
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      {/* Aspect + Platform row */}
      <div className="grid grid-cols-2 gap-4">
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-text-secondary">Aspect Ratio</legend>
          <div className="flex gap-1.5">
            {ASPECT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setAspect(opt.value)}
                disabled={submitting}
                aria-pressed={aspect === opt.value}
                className={cn(
                  "rounded-md border px-2 py-1 text-[11px] transition-colors",
                  aspect === opt.value
                    ? "border-text-accent bg-text-accent/10 text-text-accent"
                    : "border-border-subtle text-text-secondary hover:border-border-active hover:text-text-primary",
                )}
              >
                {opt.value}
                <span className="ml-1 text-text-muted">{opt.hint}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-text-secondary">Platform</legend>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as TargetPlatform)}
            disabled={submitting}
            className="w-full rounded-md border border-border-subtle bg-bg-surface px-2 py-1.5 text-xs text-text-primary focus:border-text-accent focus:outline-none"
          >
            {PLATFORM_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </fieldset>
      </div>

      {/* Submit error */}
      {submitError && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {submitError}
        </div>
      )}

      {/* Degrade warning after submit */}
      {degradeWarning && (
        <div role="status" className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <Sparkles className="inline h-3 w-3 mr-1" />
          {degradeWarning}
        </div>
      )}

      {/* Submit */}
      <Button
        type="submit"
        disabled={!prompt.trim() || submitting}
        className="w-full"
        size="sm"
      >
        {submitting ? (
          <>
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />
            Queuing job…
          </>
        ) : (
          <>
            <Film className="mr-2 h-3.5 w-3.5" aria-hidden />
            Generate Video
          </>
        )}
      </Button>
    </form>
  );
}
