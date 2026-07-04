/**
 * apps/swarmx-api/src/services/caption-generator.ts
 * VIDEO-ALPHA caption generation and validation.
 */

import type {
  CaptionDraft,
  CaptionValidation,
  VideoExportPlatform,
} from "@swarmx/types/video-types";
import { resolveCanonicalTag } from "@swarmx/types/operator-map";
import { ModelOrchestrator } from "./model-orchestrator.js";
import { extractJson, sanitizeReasoningOutput } from "./reasoning-sanitizer.js";

const OLLAMA_BASE = process.env["SWARMX_OLLAMA_URL"] ?? process.env["OLLAMA_HOST"] ?? "http://127.0.0.1:11434";
const MAX_RETRIES = 2;

export interface CaptionGenerationInput {
  topic: string;
  tone: string;
  platform: VideoExportPlatform;
  viralitySummary?: string;
}

function toLegacyAwarePlatform(platform: VideoExportPlatform): string {
  if (platform === "shorts") return "youtube_shorts";
  return platform;
}

async function callPilotModel(prompt: string): Promise<string> {
  const orchestrator = ModelOrchestrator.getInstance();
  const requestedTag = resolveCanonicalTag(
    process.env["SWARMX_MODEL_FAST"] ?? process.env["SWARM_MODEL_FAST"] ?? "instruct-phi4-pro-q8-prod",
  );

  const modelRequest = await orchestrator.requestModel(requestedTag);
  try {
    const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelRequest.modelTag,
        keep_alive: modelRequest.keepAlive,
        stream: false,
        options: {
          num_predict: modelRequest.overrides.num_predict ?? 512,
          ...(modelRequest.overrides.num_ctx !== undefined
            ? { num_ctx: modelRequest.overrides.num_ctx }
            : {}),
          temperature: 0.2,
        },
        messages: [
          {
            role: "system",
            content:
              "You generate high-performance short-form video captions. Output JSON only with keys: firstLine, body, cta, hashtags, soundSuggestion.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Caption generation failed with ${response.status}`);
    }

    const payload = (await response.json()) as { message?: { content?: string } };
    const raw = payload.message?.content ?? "";
    const { text } = sanitizeReasoningOutput(raw);
    return text;
  } finally {
    orchestrator.onModelCallComplete(modelRequest.modelTag);
  }
}

export function validateCaption(
  draft: CaptionDraft,
  _platform: VideoExportPlatform,
): CaptionValidation {
  const violations: string[] = [];

  if (draft.firstLine.length > 40) {
    violations.push("firstLine must be <= 40 characters");
  }

  if (/^\s*(I|My|This)\b/i.test(draft.firstLine)) {
    violations.push("firstLine cannot start with I, My, or This");
  }

  const totalHashtags =
    draft.hashtags.broad.length + draft.hashtags.niche.length + draft.hashtags.trending.length;
  if (totalHashtags < 3 || totalHashtags > 5) {
    violations.push("total hashtag count must be between 3 and 5");
  }

  if (draft.hashtags.trending.length !== 1) {
    violations.push("hashtags.trending must contain exactly 1 tag");
  }

  if (/#\w+/.test(draft.firstLine) || /#\w+/.test(draft.body)) {
    violations.push("hashtags must not appear in firstLine or body");
  }

  if (draft.soundSuggestion && /(https?:\/\/|www\.)/i.test(draft.soundSuggestion)) {
    violations.push("soundSuggestion must be descriptive text and cannot include a URL");
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

function buildPrompt(input: CaptionGenerationInput, priorViolations: string[] = []): string {
  const corrections =
    priorViolations.length > 0
      ? `\nValidation failures to fix:\n- ${priorViolations.join("\n- ")}`
      : "";

  return [
    `Platform: ${toLegacyAwarePlatform(input.platform)}`,
    `Topic: ${input.topic}`,
    `Tone: ${input.tone}`,
    `Virality context: ${input.viralitySummary ?? "No prior virality scoring available"}`,
    "Output strict JSON only.",
    "Schema:",
    '{"firstLine":"...","body":"...","cta":"...","hashtags":{"broad":["..."],"niche":["..."],"trending":["..."]},"soundSuggestion":"tempo/energy/instruments only"}',
    "Rules:",
    "- firstLine length <= 40",
    "- firstLine must not begin with I/My/This",
    "- hashtags total count 3 to 5",
    "- exactly 1 trending hashtag",
    "- no hashtags in firstLine or body",
    "- soundSuggestion must not include song title, artist, or URL",
    corrections,
  ].join("\n");
}

function toCaptionDraft(value: unknown): CaptionDraft | null {
  const parsed = value as Partial<CaptionDraft>;
  if (!parsed || typeof parsed !== "object") return null;
  if (typeof parsed.firstLine !== "string") return null;
  if (typeof parsed.body !== "string") return null;
  if (typeof parsed.cta !== "string") return null;
  if (!parsed.hashtags || typeof parsed.hashtags !== "object") return null;

  const hashtags = parsed.hashtags as Partial<CaptionDraft["hashtags"]>;
  if (!Array.isArray(hashtags.broad) || !Array.isArray(hashtags.niche) || !Array.isArray(hashtags.trending)) {
    return null;
  }

  return {
    firstLine: parsed.firstLine,
    body: parsed.body,
    cta: parsed.cta,
    hashtags: {
      broad: hashtags.broad.map(String),
      niche: hashtags.niche.map(String),
      trending: hashtags.trending.map(String),
    },
    ...(typeof parsed.soundSuggestion === "string"
      ? { soundSuggestion: parsed.soundSuggestion }
      : {}),
  };
}

export async function generateCaptionDraft(input: CaptionGenerationInput): Promise<CaptionDraft> {
  let violations: string[] = [];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const prompt = buildPrompt(input, violations);
    const modelText = await callPilotModel(prompt);
    const extracted = extractJson<unknown>(modelText);
    const draft = extracted.ok ? toCaptionDraft(extracted.data) : null;

    if (!draft) {
      violations = ["model output was not valid CaptionDraft JSON"];
      continue;
    }

    const validation = validateCaption(draft, input.platform);
    if (validation.valid) {
      return draft;
    }

    violations = validation.violations;
  }

  throw new Error("Caption generation failed after validation retries");
}
