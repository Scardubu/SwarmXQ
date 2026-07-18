// ============================================================================
// SwarmX Series Engine — Canonical Series Type Contracts
// Source of truth for series planning, episode roadmap, and character/world
// registry shared between API and dashboard.
// ============================================================================

import type { VideoTone } from "./video-types.js";

// ─── Series Brief (Phase 0) ───────────────────────────────────────────────────

export type SeriesPrimaryConflict =
  | "internal"
  | "interpersonal"
  | "societal"
  | "existential"
  | "cosmic";

export type SeriesArcStructure =
  | "3-act"
  | "heros_journey"
  | "episodic_anthology"
  | "mystery_reveal"
  | "character_transformation";

export type SeriesPrimaryPlatform =
  | "tiktok"
  | "reels"
  | "youtube_shorts"
  | "facebook"
  | "x";

export type SeriesEpisodeDuration = 15 | 30 | 45 | 60;

export interface SeriesBrief {
  storyTheme: string;
  coreMessage: string;
  emotionalJourney: string;
  primaryConflict: SeriesPrimaryConflict;
  targetAudience: string;
  tone: VideoTone;
  seriesLength: number;          // 6–30 episodes
  episodeDurationSeconds: SeriesEpisodeDuration;
  platformPrimary: SeriesPrimaryPlatform;
  recurringSymbols?: string;
  arcStructure: SeriesArcStructure;
}

// ─── Continuity Registry (Phase 1) ───────────────────────────────────────────

export interface CharacterProfile {
  name: string;
  appearance: string;            // precise physical description
  face: string;                  // specific facial features
  defaultOutfit: string;         // AI-prompt-ready fabric/style/colour
  voice: string;
  personality: string;           // 3 defining traits + 1 contradiction
  relationships: Record<string, string>; // otherCharName → dynamic description
  emotionalArc: string;          // where they start → where they end
  signatureCues: string;         // gesture/phrase/object per episode
  speakingStyle: string;
  aiPromptSeed: string;          // copy verbatim into every scene prompt
}

export interface WorldRegistry {
  keyLocations: Array<{
    name: string;
    description: string;
    lightingDefault: string;
    timeOfDayDefault: string;
  }>;
  architecture: string;
  colorPalette: string[];        // 3–5 hex values or named colours
  cameraLanguage: {
    defaultLens: string;
    defaultMovementStyle: string;
    shotGrammarRules: string;
  };
  visualMotifs: string[];
  era: string;
  toneMap: string;               // derived from TONE_BACKGROUNDS / TONE_ACCENTS
  soundSignature: string;        // defining recurring audio element
  // V2.0 — added by Pass 4 cinematic lock (non-fatal; absent on planning failure)
  colorGradeContract?: {
    shadowTone: string;
    highlight: string;
    saturation: string;
    filmEmulation: string;
  };
  cinematicShotGrammar?: string; // e.g. "ECU on tension, WS on wonder"
}

// ─── Episode Roadmap ──────────────────────────────────────────────────────────

export interface EpisodeRoadmapEntry {
  episodeNumber: number;         // 1-based
  title: string;
  summary: string;               // one-line story advance
  continuityThread: string;      // what carries forward from prior episode
  chekhovGun?: string;           // element planted in this episode
  chekhovPayoffEpisode?: number; // future episode that resolves it
}

// ─── Episode Context (injected into VideoJobRequest) ─────────────────────────

export interface SeriesEpisodeContext {
  seriesTitle: string;
  episodeTitle: string;
  episodeSummary: string;
  characterBible: CharacterProfile[];
  worldGuide: WorldRegistry;
  previousEpisodeSummaries: string[]; // summaries for episodes 1..(n-1)
  chekhovGun?: string;
}

// ─── Series Job ───────────────────────────────────────────────────────────────

export type SeriesJobStatus =
  | "planning"   // AI planning pipeline running
  | "planned"    // plan ready; episodes can be produced
  | "producing"  // ≥1 episode in production
  | "completed"  // all episodes produced
  | "failed";    // planning pipeline failed

export interface SeriesJob {
  id: string;
  status: SeriesJobStatus;
  brief: SeriesBrief;
  characterBible?: CharacterProfile[];
  worldGuide?: WorldRegistry;
  episodeRoadmap?: EpisodeRoadmapEntry[];
  viralityArc?: string;                        // binge mechanics notes
  videoJobIds: Partial<Record<number, string>>; // episodeNumber → jobId
  // V2.0 — per-episode pre-production data
  preProduction?: Partial<Record<number, EpisodePreProduction>>;
  createdAt: string;
  updatedAt: string;
  planningError?: string;
}

// ─── List / Response shapes ───────────────────────────────────────────────────

export interface SeriesListResponse {
  series: SeriesJob[];
  total: number;
}

export interface SeriesCreateResponse {
  seriesId: string;
  status: SeriesJobStatus;
  message: string;
}

export interface SeriesProduceEpisodeResponse {
  seriesId: string;
  episodeNumber: number;
  jobId: string;
  status: string;
}

// ─── V2.0 — Per-Episode Pre-Production ───────────────────────────────────────

export interface EpisodeScript {
  hook: string;            // ≤ 18 words
  body: string;
  emotionalPeak: string;
  cliffhanger: {
    type: "REVELATION" | "JEOPARDY" | "MYSTERY" | "IDENTITY" | "CHOICE";
    text: string;
  };
  transitionBridge: {
    type: "VISUAL_MATCH" | "AUDIO_THREAD" | "QUESTION_ECHO" | "SMASH_CUT_TEASE";
    description: string;
  };
  sceneCount: number;
}

export interface ScenePromptSuite {
  sceneIndex: number;
  sceneTitle: string;
  master: string;
  character: string;
  environment: string;
  camera: string;
  lighting: string;
  motion: string;
  style: string;
  animation: string;
  negative: string;
}

export interface AudioPlan {
  narrationStyle: "intimate" | "authoritative" | "conspiratorial" | "poetic";
  musicDescription: string;
  soundEffects: string[];
  silenceCues: string[];
  seriesSonicSignature: string;
  dialogueNotes?: string[];  // V6.2.25 — per-character emotion/delivery cues
}

export interface PlatformPublishingAsset {
  platform: SeriesPrimaryPlatform;
  title: string;           // ≤ 60 chars
  seoDescription: string;  // 120–160 chars
  caption: string;
  hashtags: string[];      // 3–5
  cta: string;             // 5–8 words
  thumbnailConcept: string;
  pinnedComment: string;
  soundSuggestion: string; // no URLs or artist names
}

export interface EpisodeViralityScore {
  hookStrength: number;    // 0–1
  completionProxy: number; // 0–1
  shareability: number;    // 0–1
  seoScore: number;        // 0–1
  overall: number;         // hookStrength×0.35 + completionProxy×0.25 + shareability×0.25 + seoScore×0.15
  recommendations: string[]; // 2–4 actionable
}

export type QualityGateCategory =
  | "STORY_INTEGRITY"
  | "CREATIVE_QUALITY"
  | "VISUAL_CONSISTENCY"
  | "PRODUCTION_READINESS"
  | "AUDIO_COHERENCE";

export interface QualityGateCheckItem {
  category: QualityGateCategory;
  label: string;
  passed: boolean;
  detail?: string;
}

export interface QualityGateResult {
  passed: boolean;
  checks: QualityGateCheckItem[];
}

export interface ContinuityReport {
  characterDriftChecks: Array<{
    characterName: string;
    seedPresentInPrompts: boolean;
    speakingStyleNoted: boolean;
  }>;
  worldDriftCheck: {
    colorPaletteReferenced: boolean;
    soundSignaturePresent: boolean;
    locationUsed: boolean;
  };
  plotThreadStatus: {
    continuityThreadAddressed: boolean;
    chekhovGunPlanted: boolean;
    transitionBridgeSpecified: boolean;
  };
  transitionBridgeConfirmed: boolean;
  overallContinuityPassed: boolean;
}

export type EpisodePreProductionStatus =
  | "pending"
  | "scripting"
  | "prompting"
  | "audio_assets"
  | "scoring"
  | "complete"
  | "failed";

export interface EpisodePreProduction {
  episodeNumber: number;
  status: EpisodePreProductionStatus;
  script?: EpisodeScript;
  scenePrompts?: ScenePromptSuite[];
  audioPlan?: AudioPlan;
  platformAssets?: PlatformPublishingAsset[];
  viralityScore?: EpisodeViralityScore;
  qualityGateResult?: QualityGateResult;
  continuityReport?: ContinuityReport;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface SeriesPreProductionResponse {
  seriesId: string;
  episodeNumber: number;
  preProduction: EpisodePreProduction;
}
