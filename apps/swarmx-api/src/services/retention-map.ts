/**
 * Retention map generator — rule-based, no LLM, no I/O.
 *
 * Produces a time-coded risk assessment for each narrative beat.
 * A beat section with fewer than MIN_WORDS_PER_BEAT words upgrades
 * MEDIUM risk to HIGH (thin-content signal).
 *
 * unrecoveredHighRiskCount > 0 emits a stageValidationTrace warn entry —
 * it does NOT throw (soft guard per INV-16: only scripting failures throw).
 */
import type { RetentionBeat, RetentionMap, BeatLabel, DropOffRisk } from "@swarmx/types/video-types";

const MIN_WORDS_PER_BEAT = 10;

interface BeatTiming {
  beatLabel: BeatLabel;
  startSec: number;
  endSec: number;
  baseRisk: DropOffRisk;
  defaultViewerQuestion: string;
  defaultNewInformation: string;
  defaultVisualEvent: string;
  defaultMicroReward: string | null;
  defaultPlannedRecovery: string | null;
}

const DEFAULT_BEAT_TIMINGS: BeatTiming[] = [
  {
    beatLabel: "HOOK",
    startSec: 0,
    endSec: 3,
    baseRisk: "LOW",
    defaultViewerQuestion: "What is this about and why should I keep watching?",
    defaultNewInformation: "Unexpected premise or bold claim creates viewer commitment",
    defaultVisualEvent: "First-frame visual hook with motion or text overlay",
    defaultMicroReward: null,
    defaultPlannedRecovery: null,
  },
  {
    beatLabel: "ORIENTATION",
    startSec: 3,
    endSec: 6,
    baseRisk: "LOW",
    defaultViewerQuestion: "Who is this for and what will I get from staying?",
    defaultNewInformation: "Stakes and frame established; viewer knows what payoff to expect",
    defaultVisualEvent: "Context shot or kinetic text establishing the premise",
    defaultMicroReward: null,
    defaultPlannedRecovery: null,
  },
  {
    beatLabel: "ESCALATION",
    startSec: 6,
    endSec: 12,
    baseRisk: "MEDIUM",
    defaultViewerQuestion: "Is the problem real? Is it getting worse?",
    defaultNewInformation: "Information density increases; stakes become personal",
    defaultVisualEvent: "Supporting b-roll or data visualization reinforces tension",
    defaultMicroReward: null,
    defaultPlannedRecovery: "Add a micro-fact or statistic to re-engage viewer at 8s",
  },
  {
    beatLabel: "INSIGHT",
    startSec: 12,
    endSec: 18,
    baseRisk: "LOW",
    defaultViewerQuestion: "What is the core answer or revelation?",
    defaultNewInformation: "Central value delivered — the primary payoff of the video",
    defaultVisualEvent: "Text overlay or graphic highlights the key insight",
    defaultMicroReward: "Clarity reward: viewer feels understood and informed",
    defaultPlannedRecovery: null,
  },
  {
    beatLabel: "PROOF",
    startSec: 18,
    endSec: 24,
    baseRisk: "MEDIUM",
    defaultViewerQuestion: "Can I trust this? Where is the evidence?",
    defaultNewInformation: "Demonstration, validation, or surprising supporting detail",
    defaultVisualEvent: "Example, before/after, or evidence clip",
    defaultMicroReward: null,
    defaultPlannedRecovery: "Add a visual example or case study to sustain attention at 21s",
  },
  {
    beatLabel: "PAYOFF",
    startSec: 24,
    endSec: 28,
    baseRisk: "LOW",
    defaultViewerQuestion: "How does this resolve the tension from the hook?",
    defaultNewInformation: "Emotional or intellectual resolution of the opening promise",
    defaultVisualEvent: "Clean final graphic or narrator moment with strong presence",
    defaultMicroReward: "Resolution reward: hook tension released, viewer satisfied",
    defaultPlannedRecovery: null,
  },
  {
    beatLabel: "CTA_OR_LOOP",
    startSec: 28,
    endSec: 33,
    baseRisk: "LOW",
    defaultViewerQuestion: "What should I do next? Does this loop back?",
    defaultNewInformation: "Specific actionable step or loop-back to hook premise",
    defaultVisualEvent: "CTA overlay or freeze frame with text",
    defaultMicroReward: null,
    defaultPlannedRecovery: null,
  },
];

function wordCountInRange(scriptText: string, startSec: number, endSec: number, totalSec: number): number {
  const allWords = scriptText.trim().split(/\s+/).filter(Boolean);
  const total = Math.max(totalSec, 1);
  const start = Math.floor((startSec / total) * allWords.length);
  const end = Math.ceil((endSec / total) * allWords.length);
  return end - start;
}

function resolveRisk(base: DropOffRisk, wordCount: number): DropOffRisk {
  if (base === "MEDIUM" && wordCount < MIN_WORDS_PER_BEAT) return "HIGH";
  return base;
}

function maxRisk(risks: DropOffRisk[]): DropOffRisk {
  if (risks.includes("HIGH")) return "HIGH";
  if (risks.includes("MEDIUM")) return "MEDIUM";
  return "LOW";
}

export function generateRetentionMap(
  scriptText: string,
  targetDurationSecs = 33,
): RetentionMap {
  const beats: RetentionBeat[] = DEFAULT_BEAT_TIMINGS.map((timing) => {
    const wordCount = wordCountInRange(scriptText, timing.startSec, timing.endSec, targetDurationSecs);
    const dropOffRisk = resolveRisk(timing.baseRisk, wordCount);

    const plannedRecovery =
      dropOffRisk === "HIGH" ? (timing.defaultPlannedRecovery ?? `Add content to the ${timing.beatLabel} beat to reduce drop-off risk`) : null;

    return {
      timestamp: timing.startSec,
      beatLabel: timing.beatLabel,
      viewerQuestion: timing.defaultViewerQuestion,
      newInformation: timing.defaultNewInformation,
      visualEvent: timing.defaultVisualEvent,
      microReward: timing.defaultMicroReward,
      dropOffRisk,
      plannedRecovery,
    };
  });

  const highRiskCount = beats.filter((b) => b.dropOffRisk === "HIGH").length;
  const unrecoveredHighRiskCount = beats.filter(
    (b) => b.dropOffRisk === "HIGH" && b.plannedRecovery === null,
  ).length;

  return {
    schemaVersion: 1,
    beats,
    overallRisk: maxRisk(beats.map((b) => b.dropOffRisk)),
    highRiskCount,
    unrecoveredHighRiskCount,
    generatedAt: new Date().toISOString(),
  };
}
