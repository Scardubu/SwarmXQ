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
