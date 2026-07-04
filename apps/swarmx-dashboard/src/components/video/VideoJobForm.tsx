/**
 * apps/swarmx-dashboard/src/components/video/VideoJobForm.tsx
 * Video generation request form with platform/niche/duration controls.
 */

"use client";

import { useState, useId } from "react";
import { useVideoStore } from "../../stores/video";
import type { VideoJobRequest } from "../../../../swarmx-api/src/types/video";

// ─── Select Helper ────────────────────────────────────────────────────────────

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
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        disabled={disabled}
        className="
          w-full rounded-lg bg-zinc-800/60 border border-zinc-700 text-zinc-200 text-sm
          px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-600/60 focus:border-amber-700
          disabled:opacity-50 disabled:cursor-not-allowed transition-colors
        "
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface VideoJobFormProps {
  onSubmitted?: (jobId: string) => void;
}

export function VideoJobForm({ onSubmitted }: VideoJobFormProps) {
  const formId = useId();
  const { submitJob, isSubmitting, submitError, clearErrors } = useVideoStore();

  const [prompt, setPrompt] = useState("");
  const [platform, setPlatform] = useState<VideoJobRequest["platform"]>("tiktok");
  const [niche, setNiche] = useState<NonNullable<VideoJobRequest["niche"]>>("motivational");
  const [targetDuration, setTargetDuration] = useState(60);
  const [modelTier, setModelTier] =
    useState<NonNullable<VideoJobRequest["modelTier"]>>("supervisor");

  const canSubmit = prompt.trim().length > 0 && !isSubmitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearErrors();

    const jobRequest: VideoJobRequest = {
      prompt: prompt.trim(),
      targetDurationSeconds: targetDuration,
      modelTier,
      ...(platform !== undefined ? { platform } : {}),
      ...(niche !== undefined ? { niche } : {}),
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
      className="flex flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-900/70 p-5"
      aria-labelledby={`${formId}-title`}
    >
      <div className="flex items-center justify-between">
        <h2
          id={`${formId}-title`}
          className="text-sm font-semibold text-zinc-200 tracking-tight"
        >
          New Video Job
        </h2>
        <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
          Vidgen
        </span>
      </div>

      {/* Prompt */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${formId}-prompt`}
          className="text-xs font-medium text-zinc-400 uppercase tracking-wider"
        >
          Prompt
        </label>
        <textarea
          id={`${formId}-prompt`}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the faceless video you want to generate…"
          rows={3}
          maxLength={2000}
          disabled={isSubmitting}
          className="
            w-full resize-none rounded-lg bg-zinc-800/60 border border-zinc-700
            text-zinc-200 text-sm px-3 py-2.5 placeholder:text-zinc-600
            focus:outline-none focus:ring-1 focus:ring-amber-600/60 focus:border-amber-700
            disabled:opacity-50 disabled:cursor-not-allowed transition-colors leading-relaxed
          "
        />
        <div className="flex justify-end">
          <span className="text-[10px] text-zinc-600 font-mono">
            {prompt.length}/2000
          </span>
        </div>
      </div>

      {/* Controls row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Select
          id={`${formId}-platform`}
          label="Platform"
          value={platform ?? "generic"}
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
            { value: "motivational", label: "Motivational" },
            { value: "finance", label: "Finance" },
            { value: "facts", label: "Facts" },
            { value: "true_crime", label: "True Crime" },
            { value: "tech", label: "Tech" },
            { value: "other", label: "Other" },
          ]}
        />
        <Select
          id={`${formId}-duration`}
          label="Duration"
          value={String(targetDuration) as never}
          onChange={(v) => setTargetDuration(Number(v))}
          disabled={isSubmitting}
          options={[
            { value: "15" as never, label: "15s" },
            { value: "30" as never, label: "30s" },
            { value: "60" as never, label: "60s" },
            { value: "90" as never, label: "90s" },
            { value: "120" as never, label: "2 min" },
          ]}
        />
        <Select
          id={`${formId}-model`}
          label="Model Tier"
          value={modelTier}
          onChange={setModelTier}
          disabled={isSubmitting}
          options={[
            { value: "fast", label: "Fast" },
            { value: "worker", label: "Worker" },
            { value: "supervisor", label: "Supervisor" },
            { value: "reasoner", label: "Reasoner" },
          ]}
        />
      </div>

      {/* Error */}
      {submitError && (
        <div className="rounded-lg bg-red-950/50 border border-red-900/50 px-3 py-2">
          <p className="text-xs text-red-400">{submitError}</p>
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={!canSubmit}
        className="
          self-end flex items-center gap-2 rounded-lg bg-amber-600 hover:bg-amber-500
          text-white text-sm font-semibold px-5 py-2.5
          disabled:opacity-40 disabled:cursor-not-allowed
          transition-all duration-150 active:scale-95
        "
      >
        {isSubmitting ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Submitting…
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Generate Video
          </>
        )}
      </button>
    </form>
  );
}