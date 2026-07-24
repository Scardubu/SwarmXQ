"use client";

import { useId, useState } from "react";
import { AlertTriangle, Clapperboard, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useVideoStore } from "../../stores/video";
import type { VideoJobRequest } from "../../lib/video-dashboard";

type ModelRoute = NonNullable<VideoJobRequest["modelTier"]> | "auto";

function Select<T extends string>({
  id,
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  id: string;
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-[10px] font-mono uppercase tracking-wide text-text-muted">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        disabled={disabled}
        className={cn(
          "h-9 w-full rounded border border-border bg-bg-input px-2.5 text-sm text-text-primary",
          "transition-colors duration-(--duration-micro)",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface VideoJobFormProps {
  onSubmitted?: (jobId: string) => void;
  submissionBlocked?: boolean;
  submissionBlockReason?: string | null;
}

export function VideoJobForm({
  onSubmitted,
  submissionBlocked = false,
  submissionBlockReason = null,
}: VideoJobFormProps) {
  const formId = useId();
  const { submitJob, isSubmitting, submitError, clearErrors } = useVideoStore();

  const [prompt, setPrompt] = useState("");
  const [platform, setPlatform] = useState<NonNullable<VideoJobRequest["platform"]>>("tiktok");
  const [niche, setNiche] = useState<NonNullable<VideoJobRequest["niche"]>>("motivational");
  const [targetDuration, setTargetDuration] = useState("30");
  const [modelRoute, setModelRoute] = useState<ModelRoute>("auto");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState<NonNullable<VideoJobRequest["tone"]>>("educational");
  const [style, setStyle] = useState<NonNullable<VideoJobRequest["style"]>>("faceless_broll");
  const [captionStyle, setCaptionStyle] = useState<NonNullable<VideoJobRequest["captionStyle"]>>("bold_center");
  const [voice, setVoice] = useState<NonNullable<VideoJobRequest["voice"]>>("default");
  const [lastQueuedId, setLastQueuedId] = useState<string | null>(null);

  const trimmedPrompt = prompt.trim();
  const canSubmit = trimmedPrompt.length > 0 && !isSubmitting && !submissionBlocked;
  const modelTier = modelRoute === "auto" ? undefined : modelRoute;
  const submitDescriptionId = submissionBlocked ? `${formId}-submit-blocked` : undefined;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submissionBlocked) {
      return;
    }
    clearErrors();

    const jobRequest: VideoJobRequest = {
      prompt: trimmedPrompt,
      platform,
      niche,
      targetDurationSeconds: Number(targetDuration),
      tone,
      style,
      captionStyle,
      voice,
      ...(audience.trim() ? { audience: audience.trim() } : {}),
      ...(modelTier !== undefined ? { modelTier } : {}),
    };

    const jobId = await submitJob(jobRequest);

    if (jobId) {
      setPrompt("");
      setLastQueuedId(jobId);
      onSubmitted?.(jobId);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="live-panel-edge flex flex-col gap-4 rounded border border-border bg-bg-elevated/80 p-4 shadow-[var(--shadow-accent-glow)]"
      aria-labelledby={`${formId}-title`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Clapperboard className="h-4 w-4 text-accent" aria-hidden="true" />
            <h2 id={`${formId}-title`} className="text-sm font-semibold tracking-tight text-text-primary">
              New Video Job
            </h2>
          </div>
          <p className="mt-1 text-xs leading-5 text-text-secondary">
            Shape the brief, then queue a low-RAM-safe render by default.
          </p>
        </div>
        <span className="shrink-0 rounded border border-border-accent bg-[var(--color-accent-dim)] px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-accent">
          {modelRoute === "auto" ? "Auto route" : "Override"}
        </span>
      </div>

      {submissionBlocked && (
        <div
          id={`${formId}-submit-blocked`}
          className="flex items-start gap-2 rounded border border-status-error/35 bg-status-error/10 px-3 py-2 text-xs text-status-error"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <p>
            {submissionBlockReason ?? "Video submission is blocked until runtime readiness recovers."}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${formId}-prompt`}
          className="text-[10px] font-mono uppercase tracking-wide text-text-muted"
        >
          Prompt
        </label>
        <textarea
          id={`${formId}-prompt`}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Create a 30-second faceless TikTok-style video titled '3 habits that improve focus'..."
          rows={4}
          maxLength={2000}
          disabled={isSubmitting}
          className={cn(
            "min-h-28 w-full resize-none rounded border border-border bg-bg-input px-3 py-2.5",
            "text-sm leading-6 text-text-primary placeholder:text-text-muted",
            "transition-colors duration-(--duration-micro)",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] text-text-muted">
            Auto route omits `modelTier`; explicit overrides remain available for compatible hosts.
          </span>
          <span className="shrink-0 font-mono text-[10px] text-text-muted tabular-nums">
            {prompt.length}/2000
          </span>
        </div>
        <p className="text-[10px] leading-4 text-text-muted">
          High-signal prompts specify: (1){" "}
          <strong className="text-text-secondary">hook angle</strong> — the contrarian or
          surprising claim that opens the video; (2){" "}
          <strong className="text-text-secondary">emotional arc</strong> — what the viewer
          moves through from start to close; (3){" "}
          <strong className="text-text-secondary">concrete takeaway</strong> — the one
          actionable thing they leave with; (4){" "}
          <strong className="text-text-secondary">CTA intent</strong> — the behavior or save
          desired. Generic topic-only prompts produce flat scripts.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <Select
          id={`${formId}-platform`}
          label="Platform"
          value={platform}
          onChange={setPlatform}
          disabled={isSubmitting}
          options={[
            { value: "tiktok", label: "TikTok" },
            { value: "youtube_shorts", label: "YT Shorts" },
            { value: "reels", label: "Reels" },
            { value: "generic", label: "Generic" },
          ]}
        />
        <Select
          id={`${formId}-niche`}
          label="Niche"
          value={niche}
          onChange={setNiche}
          disabled={isSubmitting}
          options={[
            { value: "tech", label: "Tech" },
            { value: "motivational", label: "Motivational" },
            { value: "finance", label: "Finance" },
            { value: "facts", label: "Facts" },
            { value: "true_crime", label: "True Crime" },
            { value: "other", label: "Other" },
          ]}
        />
        <Select
          id={`${formId}-duration`}
          label="Duration"
          value={targetDuration}
          onChange={setTargetDuration}
          disabled={isSubmitting}
          options={[
            { value: "15", label: "15s" },
            { value: "30", label: "30s" },
            { value: "60", label: "60s" },
            { value: "90", label: "90s" },
            { value: "120", label: "2 min" },
            { value: "180", label: "3 min" },
          ]}
        />
        <Select
          id={`${formId}-model`}
          label="Model"
          value={modelRoute}
          onChange={setModelRoute}
          disabled={isSubmitting}
          options={[
            { value: "auto", label: "Auto (recommended)" },
            { value: "fast", label: "Fast (3.8B)" },
            { value: "worker", label: "Worker (7B)" },
            { value: "supervisor", label: "Supervisor (7B)" },
            { value: "reasoner", label: "Reasoner (7B)" },
          ]}
        />
      </div>

      <details className="group rounded border border-border/60 bg-bg-surface/40 px-3 py-2">
        <summary className="flex cursor-pointer list-none items-center justify-between text-[10px] font-mono uppercase tracking-wider text-text-muted transition-colors hover:text-text-secondary">
          <span>Model tier reference</span>
          <span className="text-[10px] text-text-muted transition-transform group-open:rotate-180" aria-hidden="true">▾</span>
        </summary>
        <ul className="mt-2 space-y-1 text-[10px] leading-4 text-text-muted">
          <li><strong className="text-text-secondary">Auto</strong> — pipeline picks the safe model for current RAM. On LOW_RAM hosts (&lt;6.2 GB free), all four text stages use Pilot-lite (3.8 B Q4). Cold load ~120 s, warm ~8 min end-to-end.</li>
          <li><strong className="text-text-secondary">Fast</strong> — Pilot-lite for every stage. Needs ~3.3 GB. Best latency; simpler narrative.</li>
          <li><strong className="text-text-secondary">Worker / Supervisor / Reasoner</strong> — 7 B tiers for richer planning &amp; scripting. Need ≥ 6.2 GB free. <em>Silently ignored in LOW_RAM_MODE</em>: the pipeline falls back to Pilot-lite instead of failing admission.</li>
        </ul>
      </details>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label
            htmlFor={`${formId}-audience`}
            className="text-[10px] font-mono uppercase tracking-wide text-text-muted"
          >
            Audience
          </label>
          <input
            id={`${formId}-audience`}
            value={audience}
            onChange={(event) => setAudience(event.target.value)}
            maxLength={160}
            disabled={isSubmitting}
            placeholder="Busy founders, new creators, students..."
            className={cn(
              "h-9 w-full rounded border border-border bg-bg-input px-2.5 text-sm text-text-primary",
              "placeholder:text-text-muted transition-colors duration-(--duration-micro)",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          />
        </div>
        <Select
          id={`${formId}-tone`}
          label="Tone"
          value={tone}
          onChange={setTone}
          disabled={isSubmitting}
          options={[
            { value: "educational", label: "Educational" },
            { value: "urgent", label: "Urgent" },
            { value: "warm", label: "Warm" },
            { value: "contrarian", label: "Contrarian" },
            { value: "cinematic", label: "Cinematic" },
            { value: "minimal", label: "Minimal" },
            { value: "faceless_broll", label: "Faceless B-roll" },
            { value: "kinetic_text", label: "Kinetic Text" },
          ]}
        />
        <Select
          id={`${formId}-style`}
          label="Style"
          value={style}
          onChange={setStyle}
          disabled={isSubmitting}
          options={[
            { value: "faceless_broll", label: "Faceless B-roll" },
            { value: "kinetic_text", label: "Kinetic Text" },
            { value: "storytime", label: "Storytime" },
            { value: "tutorial", label: "Tutorial" },
            { value: "myth_busting", label: "Myth Busting" },
          ]}
        />
        <Select
          id={`${formId}-caption-style`}
          label="Captions"
          value={captionStyle}
          onChange={setCaptionStyle}
          disabled={isSubmitting}
          options={[
            { value: "bold_center", label: "Bold Center" },
            { value: "lower_third", label: "Lower Third" },
            { value: "minimal", label: "Minimal" },
          ]}
        />
        <Select
          id={`${formId}-voice`}
          label="Voice"
          value={voice}
          onChange={setVoice}
          disabled={isSubmitting}
          options={[
            { value: "default", label: "Default" },
            { value: "calm", label: "Calm" },
            { value: "energetic", label: "Energetic" },
            { value: "narrator", label: "Narrator" },
          ]}
        />
      </div>

      {modelRoute !== "auto" && (
        <div className="flex items-start gap-2 rounded border border-status-warning/30 bg-status-warning/8 px-3 py-2 text-xs text-status-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <p>
            Model overrides apply to every text stage. Use Auto for the controlled low-RAM video path.
          </p>
        </div>
      )}

      {/* Submission status region — live for screen readers */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {submissionBlocked ? "Video job submission is blocked by runtime readiness." : null}
        {isSubmitting ? "Queuing video job…" : null}
        {lastQueuedId && !isSubmitting && !submitError ? "Video job queued successfully. Track progress in the queue below." : null}
      </div>

      {submitError && (
        <div
          className="rounded border border-status-error/35 bg-status-error/10 px-3 py-2 text-xs text-status-error"
          role="alert"
        >
          {submitError}
        </div>
      )}

      {lastQueuedId && !isSubmitting && !submitError && (
        <p className="text-xs text-status-success font-mono" role="status">
          Job queued — {lastQueuedId.slice(0, 8)}… Track progress in the queue.
        </p>
      )}

      <div className="flex items-center justify-end">
        <Button
          type="submit"
          variant="accent"
          size="lg"
          disabled={!canSubmit}
          aria-busy={isSubmitting}
          aria-describedby={submitDescriptionId}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Queuing job…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Generate Video
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
