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
import {
  getAdaptiveCallConfig,
  recordFailure,
  recordSuccess,
  withTimeout,
} from "./adaptive-timeout-config.js";
import { extractJson, sanitizeReasoningOutput } from "./reasoning-sanitizer.js";
import { generateOllamaText } from "./ollama.js";
import { loadEnv } from "../lib/env.js";

const MAX_RETRIES = 2;

const CAPTION_RULES = {
  firstLineMaxChars: 40,
  disallowedOpeners: ["I ", "My ", "This ", "We ", "Our "],
  hashtagMin: 3,
  hashtagMax: 5,
  trendingHashtagMax: 1,
  hashtagsInBodyProhibited: true,
  soundSuggestionNoUrl: true,
  soundSuggestionNoArtist: true,
  maxEmojiInFullCaption: 3,
} as const;

export interface CaptionGenerationInput {
  topic: string;
  tone: string;
  platform: VideoExportPlatform;
  viralitySummary?: string;
}

export interface CaptionGenerationResult {
  draft: CaptionDraft;
  validation: CaptionValidation;
}

function toLegacyAwarePlatform(platform: VideoExportPlatform): string {
  if (platform === "shorts") return "youtube_shorts";
  return platform;
}

async function callPilotModel(prompt: string): Promise<string> {
  const orchestrator = ModelOrchestrator.getInstance();
  const requestedTag = resolveCanonicalTag(loadEnv().SWARMX_MODEL_FAST);
  const callConfig = getAdaptiveCallConfig(requestedTag, "fast_chat");

  if (callConfig.circuitOpen) {
    throw new Error("caption_generator_circuit_open");
  }

  const modelRequest = await orchestrator.requestModel(callConfig.modelTag);
  try {
    const raw = await withTimeout(
      generateOllamaText({
        model: modelRequest.modelTag,
        prompt: [
          "You generate high-performance short-form video captions.",
          "Output JSON only with keys: firstLine, body, cta, hashtags, soundSuggestion.",
          prompt,
        ].join("\n\n"),
        maxTokens: modelRequest.overrides.num_predict ?? callConfig.overrides.num_predict ?? 512,
        overrides: {
          ...callConfig.overrides,
          ...modelRequest.overrides,
          temperature: 0.2,
        },
      }),
      callConfig.timeoutMs,
      "caption_generator_fast_chat",
    );
    recordSuccess(modelRequest.modelTag);
    const { text } = sanitizeReasoningOutput(raw);
    return text;
  } catch (error) {
    recordFailure(modelRequest.modelTag);
    throw error;
  } finally {
    orchestrator.onModelCallComplete(modelRequest.modelTag);
  }
}

export function validateCaption(
  draft: CaptionDraft,
  _platform: VideoExportPlatform,
): CaptionValidation {
  const violations: string[] = [];

  if (draft.firstLine.length > CAPTION_RULES.firstLineMaxChars) {
    violations.push(`firstLine must be <= ${CAPTION_RULES.firstLineMaxChars} characters`);
  }

  const startsWithDisallowed = CAPTION_RULES.disallowedOpeners.some((opener) =>
    draft.firstLine.trimStart().toLowerCase().startsWith(opener.toLowerCase()),
  );
  if (startsWithDisallowed) {
    violations.push("firstLine cannot start with I, My, This, We, or Our");
  }

  const totalHashtags =
    draft.hashtags.broad.length + draft.hashtags.niche.length + draft.hashtags.trending.length;
  if (totalHashtags < CAPTION_RULES.hashtagMin || totalHashtags > CAPTION_RULES.hashtagMax) {
    violations.push(`total hashtag count must be between ${CAPTION_RULES.hashtagMin} and ${CAPTION_RULES.hashtagMax}`);
  }

  if (draft.hashtags.trending.length > CAPTION_RULES.trendingHashtagMax) {
    violations.push(`hashtags.trending must contain at most ${CAPTION_RULES.trendingHashtagMax} tag`);
  }

  if (CAPTION_RULES.hashtagsInBodyProhibited && (/#\w+/.test(draft.firstLine) || /#\w+/.test(draft.body))) {
    violations.push("hashtags must not appear in firstLine or body");
  }

  if (CAPTION_RULES.soundSuggestionNoUrl && draft.soundSuggestion && /(https?:\/\/|www\.|spotify|soundcloud|apple music)/i.test(draft.soundSuggestion)) {
    violations.push("soundSuggestion must be descriptive text and cannot include a URL");
  }

  if (
    CAPTION_RULES.soundSuggestionNoArtist &&
    draft.soundSuggestion &&
    /\b(feat\.?|ft\.?|by\s+[A-Z][a-z]+|\"[^\"]+\"|song|track|album)\b/.test(draft.soundSuggestion)
  ) {
    violations.push("soundSuggestion must describe tempo, energy, and instruments only");
  }

  const fullCaption = `${draft.firstLine} ${draft.body} ${draft.cta}`;
  const emojiCount = (fullCaption.match(/[\u{1F300}-\u{1FAFF}]/gu) ?? []).length;
  if (emojiCount > CAPTION_RULES.maxEmojiInFullCaption) {
    violations.push(`caption must contain <= ${CAPTION_RULES.maxEmojiInFullCaption} emojis`);
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
    "- firstLine must not begin with I/My/This/We/Our",
    "- hashtags total count 3 to 5",
    "- at most 1 trending hashtag",
    "- no hashtags in firstLine or body",
    "- soundSuggestion must not include song title, artist, or URL",
    "- Describe the audio style in terms of tempo, energy, and instruments only.",
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
  const result = await generateCaptionDraftWithValidation(input);
  return result.draft;
}

export async function generateCaptionDraftWithValidation(
  input: CaptionGenerationInput,
): Promise<CaptionGenerationResult> {
  let violations: string[] = [];
  let lastDraft: CaptionDraft | null = null;
  let lastValidation: CaptionValidation | null = null;
  let retryByRule = new Map<string, number>();

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const prompt = buildPrompt(input, violations);
    const modelText = await callPilotModel(prompt);
    const extracted = extractJson<unknown>(modelText);
    const draft = extracted.ok ? toCaptionDraft(extracted.data) : null;

    if (!draft) {
      const invalidJsonRule = "model output was not valid CaptionDraft JSON";
      const nextCount = (retryByRule.get(invalidJsonRule) ?? 0) + 1;
      retryByRule.set(invalidJsonRule, nextCount);
      violations = [invalidJsonRule];
      lastValidation = {
        valid: false,
        violations,
      };
      if (nextCount > MAX_RETRIES) {
        break;
      }
      continue;
    }

    lastDraft = draft;

    const validation = validateCaption(draft, input.platform);
    lastValidation = validation;
    if (validation.valid) {
      return {
        draft,
        validation,
      };
    }

    violations = validation.violations;
    for (const rule of validation.violations) {
      retryByRule.set(rule, (retryByRule.get(rule) ?? 0) + 1);
    }

    const exhaustedRule = validation.violations.find((rule) => (retryByRule.get(rule) ?? 0) > MAX_RETRIES);
    if (exhaustedRule) {
      break;
    }
  }

  if (lastDraft) {
    return {
      draft: lastDraft,
      validation: lastValidation ?? {
        valid: false,
        violations,
      },
    };
  }

  throw new Error("caption_generation_failed");
}
