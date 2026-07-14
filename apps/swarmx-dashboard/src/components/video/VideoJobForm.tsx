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
}

export function VideoJobForm({ onSubmitted }: VideoJobFormProps) {
  const formId = useId();
  const { submitJob, isSubmitting, submitError, clearErrors } = useVideoStore();

  const [prompt, setPrompt] = useState("");
  const [platform, setPlatform] = useState<NonNullable<VideoJobRequest["platform"]>>("tiktok");
  const [niche, setNiche] = useState<NonNullable<VideoJobRequest["niche"]>>("tech");
  const [targetDuration, setTargetDuration] = useState("30");
  const [modelRoute, setModelRoute] = useState<ModelRoute>("auto");

  const trimmedPrompt = prompt.trim();
  const canSubmit = trimmedPrompt.length > 0 && !isSubmitting;
  const modelTier = modelRoute === "auto" ? undefined : modelRoute;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    clearErrors();

    const jobRequest: VideoJobRequest = {
      prompt: trimmedPrompt,
      platform,
      niche,
      targetDurationSeconds: Number(targetDuration),
      ...(modelTier !== undefined ? { modelTier } : {}),
    };

    const jobId = await submitJob(jobRequest);

    if (jobId) {
      setPrompt("");
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
            Queue a vertical short with low-RAM-safe routing by default.
          </p>
        </div>
        <span className="shrink-0 rounded border border-border-accent bg-[var(--color-accent-dim)] px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-accent">
          {modelRoute === "auto" ? "Auto route" : "Override"}
        </span>
      </div>

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
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
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
          ]}
        />
        <Select
          id={`${formId}-model`}
          label="Model"
          value={modelRoute}
          onChange={setModelRoute}
          disabled={isSubmitting}
          options={[
            { value: "auto", label: "Auto" },
            { value: "fast", label: "Fast" },
            { value: "worker", label: "Worker" },
            { value: "supervisor", label: "Supervisor" },
            { value: "reasoner", label: "Reasoner" },
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

      {submitError && (
        <div
          className="rounded border border-status-error/35 bg-status-error/10 px-3 py-2 text-xs text-status-error"
          role="alert"
        >
          {submitError}
        </div>
      )}

      <div className="flex items-center justify-end">
        <Button type="submit" variant="accent" size="lg" disabled={!canSubmit}>
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Submitting
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
