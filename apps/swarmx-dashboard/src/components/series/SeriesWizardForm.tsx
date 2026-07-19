"use client";

import { useId, useState } from "react";
import { Film, ChevronRight, ChevronLeft, Loader2, Sparkles, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSeriesStore } from "@/stores/series";
import type {
  SeriesBrief,
  SeriesPrimaryConflict,
  SeriesArcStructure,
  SeriesPrimaryPlatform,
  SeriesEpisodeDuration,
} from "@swarmx/types/series-types";
import type { VideoTone } from "@swarmx/types/video-types";

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-[10px] font-mono uppercase tracking-wide text-text-muted">
      {children}
    </label>
  );
}

function TextInput({
  id,
  value,
  onChange,
  placeholder,
  maxLength,
  disabled,
  required,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  required?: boolean;
}) {
  return (
    <input
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      disabled={disabled}
      required={required}
      className={cn(
        "h-9 w-full rounded border border-border bg-bg-input px-2.5 text-sm text-text-primary",
        "placeholder:text-text-muted transition-colors duration-(--duration-micro)",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
    />
  );
}

function TextareaInput({
  id,
  value,
  onChange,
  placeholder,
  maxLength,
  rows,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  rows?: number;
  disabled?: boolean;
}) {
  return (
    <textarea
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      rows={rows ?? 2}
      disabled={disabled}
      className={cn(
        "w-full resize-none rounded border border-border bg-bg-input px-3 py-2.5",
        "text-sm leading-6 text-text-primary placeholder:text-text-muted",
        "transition-colors duration-(--duration-micro)",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
    />
  );
}

function SelectField<T extends string>({
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
  options: { value: T; label: string; description?: string }[];
  disabled?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        disabled={disabled}
        className={cn(
          "h-9 w-full rounded border border-border bg-bg-input px-2.5 text-sm text-text-primary",
          "transition-colors duration-(--duration-micro)",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
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

// ─── Step 1 defaults ──────────────────────────────────────────────────────────

const DEFAULT_CONFLICT: SeriesPrimaryConflict = "internal";

interface Step1State {
  storyTheme: string;
  coreMessage: string;
  emotionalJourney: string;
  primaryConflict: SeriesPrimaryConflict;
  targetAudience: string;
}

// ─── Step 2 defaults ──────────────────────────────────────────────────────────

const DEFAULT_TONE: VideoTone = "cinematic";
const DEFAULT_PLATFORM: SeriesPrimaryPlatform = "tiktok";
const DEFAULT_DURATION: SeriesEpisodeDuration = 30;
const DEFAULT_ARC: SeriesArcStructure = "character_transformation";

interface Step2State {
  tone: VideoTone;
  platformPrimary: SeriesPrimaryPlatform;
  episodeDurationSeconds: SeriesEpisodeDuration;
  seriesLength: number;
  arcStructure: SeriesArcStructure;
  recurringSymbols: string;
  soloFormat: boolean;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface SeriesWizardFormProps {
  onCreated?: (seriesId: string) => void;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function SeriesWizardForm({ onCreated }: SeriesWizardFormProps) {
  const formId = useId();
  const { createSeries, isCreating, createError, clearErrors } = useSeriesStore(
    (s) => ({ createSeries: s.createSeries, isCreating: s.isCreating, createError: s.createError, clearErrors: s.clearErrors }),
  );

  const [step, setStep] = useState<1 | 2>(1);

  const [s1, setS1] = useState<Step1State>({
    storyTheme: "",
    coreMessage: "",
    emotionalJourney: "",
    primaryConflict: DEFAULT_CONFLICT,
    targetAudience: "",
  });

  const [s2, setS2] = useState<Step2State>({
    tone: DEFAULT_TONE,
    platformPrimary: DEFAULT_PLATFORM,
    episodeDurationSeconds: DEFAULT_DURATION,
    seriesLength: 6,
    arcStructure: DEFAULT_ARC,
    recurringSymbols: "",
    soloFormat: false,
  });

  const step1Valid =
    s1.storyTheme.trim().length > 0 &&
    s1.coreMessage.trim().length > 0 &&
    s1.emotionalJourney.trim().length > 0 &&
    s1.targetAudience.trim().length > 0;

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();
    if (step1Valid) {
      clearErrors();
      setStep(2);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearErrors();

    const brief: SeriesBrief = {
      storyTheme: s1.storyTheme.trim(),
      coreMessage: s1.coreMessage.trim(),
      emotionalJourney: s1.emotionalJourney.trim(),
      primaryConflict: s1.primaryConflict,
      targetAudience: s1.targetAudience.trim(),
      tone: s2.tone,
      platformPrimary: s2.platformPrimary,
      episodeDurationSeconds: s2.episodeDurationSeconds,
      seriesLength: s2.seriesLength,
      arcStructure: s2.arcStructure,
      ...(s2.recurringSymbols.trim() ? { recurringSymbols: s2.recurringSymbols.trim() } : {}),
      ...(s2.soloFormat ? { soloFormat: true } : {}),
    };

    const id = await createSeries(brief);
    if (id) onCreated?.(id);
  };

  return (
    <div className="flex flex-col gap-0 rounded border border-border bg-bg-elevated/80 shadow-[var(--shadow-accent-glow)]">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <Film className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-text-primary">New Series</h2>
            <p className="text-xs text-text-muted">AI builds the character bible, world guide, and episode roadmap.</p>
          </div>
        </div>
        {/* Step indicator */}
        <div className="flex shrink-0 items-center gap-1.5" aria-label={`Step ${step} of 2`}>
          {([1, 2] as const).map((n) => (
            <div
              key={n}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                n === step
                  ? "w-5 bg-accent"
                  : n < step
                    ? "w-2.5 bg-accent/50"
                    : "w-2.5 bg-border",
              )}
              aria-hidden="true"
            />
          ))}
          <span className="ml-1 font-mono text-[10px] text-text-muted">{step}/2</span>
        </div>
      </div>

      {/* Step 1 — Story fields */}
      {step === 1 && (
        <form onSubmit={handleNext} className="flex flex-col gap-5 px-5 py-5">
          <p className="text-xs text-text-secondary">
            Define the narrative core. The AI uses these to build a consistent character bible and world.
          </p>

          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor={`${formId}-theme`}>Story Theme <span className="text-status-error">*</span></FieldLabel>
            <TextInput
              id={`${formId}-theme`}
              value={s1.storyTheme}
              onChange={(v) => setS1((prev) => ({ ...prev, storyTheme: v }))}
              placeholder="A lone architect who rebuilds forgotten cities"
              maxLength={200}
              disabled={isCreating}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor={`${formId}-core-msg`}>Core Message <span className="text-status-error">*</span></FieldLabel>
            <TextInput
              id={`${formId}-core-msg`}
              value={s1.coreMessage}
              onChange={(v) => setS1((prev) => ({ ...prev, coreMessage: v }))}
              placeholder="Restoration is an act of defiance"
              maxLength={300}
              disabled={isCreating}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor={`${formId}-journey`}>Emotional Journey <span className="text-status-error">*</span></FieldLabel>
            <TextareaInput
              id={`${formId}-journey`}
              value={s1.emotionalJourney}
              onChange={(v) => setS1((prev) => ({ ...prev, emotionalJourney: v }))}
              placeholder="Grief → isolation → purpose → community → legacy"
              maxLength={400}
              rows={2}
              disabled={isCreating}
            />
            <p className="text-[10px] text-text-muted">Map the arc: how does the audience feel at the start vs. the end?</p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              id={`${formId}-conflict`}
              label="Primary Conflict *"
              value={s1.primaryConflict}
              onChange={(v) => setS1((prev) => ({ ...prev, primaryConflict: v }))}
              disabled={isCreating}
              options={[
                { value: "internal", label: "Internal — character vs. self" },
                { value: "interpersonal", label: "Interpersonal — character vs. character" },
                { value: "societal", label: "Societal — character vs. system" },
                { value: "existential", label: "Existential — character vs. meaning" },
                { value: "cosmic", label: "Cosmic — character vs. unknown" },
              ]}
            />

            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor={`${formId}-audience`}>Target Audience <span className="text-status-error">*</span></FieldLabel>
              <TextInput
                id={`${formId}-audience`}
                value={s1.targetAudience}
                onChange={(v) => setS1((prev) => ({ ...prev, targetAudience: v }))}
                placeholder="Creatives 25–40 burned out by corporate work"
                maxLength={200}
                disabled={isCreating}
                required
              />
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <Button
              type="submit"
              variant="accent"
              size="lg"
              disabled={!step1Valid || isCreating}
            >
              Production Settings
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </form>
      )}

      {/* Step 2 — Production settings */}
      {step === 2 && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-5 px-5 py-5">
          <p className="text-xs text-text-secondary">
            Set the production parameters. These determine how episodes are generated and distributed.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              id={`${formId}-tone`}
              label="Tone *"
              value={s2.tone}
              onChange={(v) => setS2((prev) => ({ ...prev, tone: v }))}
              disabled={isCreating}
              options={[
                { value: "cinematic", label: "Cinematic — visual-first, sweeping" },
                { value: "warm", label: "Warm — intimate, personal" },
                { value: "educational", label: "Educational — authoritative, structured" },
                { value: "urgent", label: "Urgent — high-stakes, fast-paced" },
                { value: "contrarian", label: "Contrarian — challenges assumptions" },
                { value: "minimal", label: "Minimal — stripped back, sparse" },
                { value: "faceless_broll", label: "Faceless B-roll — narration + visuals" },
                { value: "kinetic_text", label: "Kinetic Text — text-forward, punchy" },
              ]}
            />

            <SelectField
              id={`${formId}-platform`}
              label="Primary Platform *"
              value={s2.platformPrimary}
              onChange={(v) => setS2((prev) => ({ ...prev, platformPrimary: v }))}
              disabled={isCreating}
              options={[
                { value: "tiktok", label: "TikTok" },
                { value: "reels", label: "Instagram Reels" },
                { value: "youtube_shorts", label: "YouTube Shorts" },
                { value: "facebook", label: "Facebook" },
                { value: "x", label: "X (Twitter)" },
              ]}
            />

            <SelectField
              id={`${formId}-duration`}
              label="Episode Duration *"
              value={String(s2.episodeDurationSeconds) as "15" | "30" | "45" | "60"}
              onChange={(v) => setS2((prev) => ({ ...prev, episodeDurationSeconds: Number(v) as SeriesEpisodeDuration }))}
              disabled={isCreating}
              options={[
                { value: "15", label: "15 seconds" },
                { value: "30", label: "30 seconds" },
                { value: "45", label: "45 seconds" },
                { value: "60", label: "60 seconds" },
              ]}
            />

            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor={`${formId}-length`}>Series Length (episodes) *</FieldLabel>
              <input
                id={`${formId}-length`}
                type="number"
                min={6}
                max={30}
                value={s2.seriesLength}
                onChange={(e) => {
                  const n = Math.max(6, Math.min(30, Number(e.target.value)));
                  setS2((prev) => ({ ...prev, seriesLength: n }));
                }}
                disabled={isCreating}
                className={cn(
                  "h-9 w-full rounded border border-border bg-bg-input px-2.5 text-sm text-text-primary",
                  "transition-colors duration-(--duration-micro)",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              />
              <p className="text-[10px] text-text-muted">6–30 episodes</p>
            </div>

            <SelectField
              id={`${formId}-arc`}
              label="Arc Structure *"
              value={s2.arcStructure}
              onChange={(v) => setS2((prev) => ({ ...prev, arcStructure: v }))}
              disabled={isCreating}
              options={[
                { value: "character_transformation", label: "Character Transformation" },
                { value: "3-act", label: "3-Act Structure" },
                { value: "heros_journey", label: "Hero's Journey" },
                { value: "episodic_anthology", label: "Episodic Anthology" },
                { value: "mystery_reveal", label: "Mystery Reveal" },
              ]}
            />

            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor={`${formId}-symbols`}>Recurring Symbols (optional)</FieldLabel>
              <TextInput
                id={`${formId}-symbols`}
                value={s2.recurringSymbols}
                onChange={(v) => setS2((prev) => ({ ...prev, recurringSymbols: v }))}
                placeholder="broken clock, red thread, empty chair…"
                maxLength={300}
                disabled={isCreating}
              />
              <p className="text-[10px] text-text-muted">Visual or narrative motifs the AI will plant across episodes.</p>
            </div>
          </div>

          {/* Solo format toggle */}
          <label
            htmlFor={`${formId}-solo`}
            className="flex cursor-pointer items-start gap-3 rounded border border-border bg-bg-surface px-3 py-2.5"
          >
            <input
              id={`${formId}-solo`}
              type="checkbox"
              checked={s2.soloFormat}
              onChange={(e) => setS2((prev) => ({ ...prev, soloFormat: e.target.checked }))}
              disabled={isCreating}
              className="mt-0.5 accent-accent"
            />
            <div>
              <p className="text-xs font-medium text-text-primary">Solo Format (narrator only)</p>
              <p className="mt-0.5 text-[10px] text-text-muted">
                Omits character bible. All AI scene prompts use narrator-only mode. Ideal for faceless or
                voiceover-driven series.
              </p>
            </div>
          </label>

          {/* Summary card */}
          <div className="rounded border border-border/60 bg-bg-surface px-3 py-2.5 text-[11px] text-text-muted">
            <span className="font-medium text-text-secondary">{s1.storyTheme.trim() || "Untitled"}</span>
            {" · "}
            {s2.seriesLength} episodes × {s2.episodeDurationSeconds}s
            {" · "}
            {s2.platformPrimary}
          </div>

          {createError && (
            <div
              className="flex items-start gap-2 rounded border border-status-error/35 bg-status-error/10 px-3 py-2 text-xs text-status-error"
              role="alert"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {createError}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="lg"
              onClick={() => { clearErrors(); setStep(1); }}
              disabled={isCreating}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Back
            </Button>
            <Button
              type="submit"
              variant="accent"
              size="lg"
              disabled={isCreating}
              aria-busy={isCreating}
            >
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Creating series…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  Create Series
                </>
              )}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
