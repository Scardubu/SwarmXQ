/**
 * ViralityMeter — 5-dimension virality signal display
 *
 * Renders Hook / Completion / Shareability / SEO / Overall as labeled bars
 * with colour-coded thresholds:
 *   < 0.4  → red-400
 *   0.4–0.7 → amber-400
 *   > 0.7  → emerald-400
 *
 * Accepts values 0–100 (API normalised) or 0–1 (raw).
 * Uses @radix-ui/react-tooltip for per-bar Oracle reasoning excerpts.
 */

"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import type { ViralitySignal } from "@swarmx/types/video-types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ViralityMeterProps {
  signal: ViralitySignal;
  /** When true renders a single-row compact variant for use inside cards. */
  compact?: boolean;
  /** Called when the user clicks the "Improve" button. */
  onImprove?: () => void;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Normalise a value to the 0–1 range, accepting either 0–1 or 0–100 input. */
function normalise(value: number): number {
  if (value > 1) return value / 100;
  return value;
}

/** Resolve the colour class for a normalised 0–1 score. */
function scoreColour(norm: number): string {
  if (norm < 0.4) return "text-red-400";
  if (norm <= 0.7) return "text-amber-400";
  return "text-emerald-400";
}

/** Resolve the bar fill class for a normalised 0–1 score. */
function barColour(norm: number): string {
  if (norm < 0.4) return "bg-red-500";
  if (norm <= 0.7) return "bg-amber-500";
  return "bg-emerald-500";
}

// ─── Recommendation excerpts per dimension ────────────────────────────────────

function dimensionReasoning(
  signal: ViralitySignal,
  dimension: string,
): string {
  const recs = signal.recommendations;
  if (!recs || recs.length === 0) return "No recommendations available.";

  // Try to find a recommendation mentioning the dimension keyword
  const keywordMap: Record<string, string[]> = {
    Hook: ["hook", "interrupt", "3 second", "scroll", "opening"],
    Completion: ["completion", "watch time", "end", "reveal", "pacing"],
    Shareability: ["share", "emotion", "relat", "forward", "unique"],
    SEO: ["caption", "hashtag", "keyword", "cta", "seo"],
    Overall: ["overall", "improve", "structure"],
  };

  const keywords = keywordMap[dimension] ?? [];
  const match = recs.find((r) =>
    keywords.some((kw) => r.toLowerCase().includes(kw)),
  );

  return match ?? recs[0] ?? "No recommendations available.";
}

// ─── Single bar ───────────────────────────────────────────────────────────────

interface DimensionBarProps {
  label: string;
  value: number;
  reasoning: string;
  compact: boolean;
}

function DimensionBar({ label, value, reasoning, compact }: DimensionBarProps) {
  const norm = normalise(value);
  const pct = Math.round(norm * 100);
  const colour = scoreColour(norm);
  const fill = barColour(norm);

  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <div
            className={`flex flex-col gap-1 cursor-default ${compact ? "min-w-[4rem]" : ""}`}
            tabIndex={0}
            aria-label={`${label}: ${pct}/100 — ${reasoning}`}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                {label}
              </span>
              <span className={`text-[10px] font-semibold tabular-nums font-mono ${colour}`}>
                {pct}
              </span>
            </div>
            <div className="h-1 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ease-out ${fill}`}
                style={{ width: `${pct}%` }}
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>
          </div>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            sideOffset={6}
            className="
              z-50 max-w-xs rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2
              text-xs text-zinc-300 shadow-xl leading-relaxed
            "
          >
            <p className="font-semibold text-zinc-100 mb-1">{label}</p>
            <p>{reasoning}</p>
            <Tooltip.Arrow className="fill-zinc-900" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

const DIMENSIONS: Array<{ key: keyof ViralitySignal; label: string }> = [
  { key: "hookStrength", label: "Hook" },
  { key: "completionProxy", label: "Completion" },
  { key: "shareability", label: "Shareability" },
  { key: "seoScore", label: "SEO" },
  { key: "overall", label: "Overall" },
];

export function ViralityMeter({ signal, compact = false, onImprove }: ViralityMeterProps) {
  const overallNorm = normalise(signal.overall);
  const overallPct = Math.round(overallNorm * 100);
  const overallColour = scoreColour(overallNorm);

  if (compact) {
    return (
      <div className="flex items-center gap-3 flex-wrap">
        {DIMENSIONS.map(({ key, label }) => (
          <DimensionBar
            key={key}
            label={label}
            value={signal[key] as number}
            reasoning={dimensionReasoning(signal, label)}
            compact
          />
        ))}
      </div>
    );
  }

  return (
    <section
      aria-label="Virality score"
      className="rounded-xl border border-amber-900/40 bg-gradient-to-br from-amber-950/30 to-zinc-900/60 p-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-xs font-semibold text-amber-300 uppercase tracking-wider">
            Virality Signal
          </h3>
          <p className="text-[10px] text-zinc-500 mt-0.5">
            Scored by {signal.scoredBy}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div
            className={`text-2xl font-bold tabular-nums font-mono ${overallColour}`}
            aria-label={`Overall virality score: ${overallPct} out of 100`}
          >
            {overallPct}
            <span className="text-xs text-zinc-600 font-normal">/100</span>
          </div>
          {onImprove && (
            <button
              onClick={onImprove}
              className="
                rounded-lg border border-amber-700/50 bg-amber-900/30 px-3 py-1.5
                text-xs font-semibold text-amber-200 hover:bg-amber-900/50
                transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500
              "
            >
              Improve
            </button>
          )}
        </div>
      </div>

      {/* Dimension bars */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {DIMENSIONS.map(({ key, label }) => (
          <DimensionBar
            key={key}
            label={label}
            value={signal[key] as number}
            reasoning={dimensionReasoning(signal, label)}
            compact={false}
          />
        ))}
      </div>

      {/* Recommendations */}
      {signal.recommendations && signal.recommendations.length > 0 && (
        <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">
            Oracle Recommendations
          </p>
          <ul className="space-y-1.5">
            {signal.recommendations.map((rec, idx) => (
              <li key={idx} className="flex gap-2 text-xs text-zinc-300">
                <span className="mt-0.5 shrink-0 text-amber-500">•</span>
                <span>{rec}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
