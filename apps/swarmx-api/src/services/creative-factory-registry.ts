import { randomUUID } from "node:crypto";
import type {
  AudiencePersona,
  BrandKit,
  ConceptTournament,
  CreativeAgentSpec,
  CreativeDNA,
  PlatformCapability,
  VariantRecord,
  VideoBlueprint,
  VideoExportPlatform,
} from "@swarmx/types/video-types";
import type { DurableCollection } from "./local-state-store.js";
import { appendStateEvent, readSnapshot, writeSnapshot } from "./local-state-store.js";

type RegistryCollection =
  | "brand-kits"
  | "audience-personas"
  | "video-blueprints"
  | "platform-capabilities"
  | "creative-dna"
  | "concept-tournaments"
  | "variant-records"
  | "creative-agent-specs";

type RegistryRecord =
  | BrandKit
  | AudiencePersona
  | VideoBlueprint
  | PlatformCapabilityRecord
  | CreativeDNA
  | ConceptTournament
  | VariantRecord
  | CreativeAgentSpec;

interface PlatformCapabilityRecord extends PlatformCapability {
  id: string;
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
}

const records: Partial<Record<RegistryCollection, Map<string, RegistryRecord>>> = {};
const hydrated = new Set<RegistryCollection>();

function now(): string {
  return new Date().toISOString();
}

function collectionMap(collection: RegistryCollection): Map<string, RegistryRecord> {
  const existing = records[collection];
  if (existing) return existing;
  const created = new Map<string, RegistryRecord>();
  records[collection] = created;
  return created;
}

function ensureHydrated(collection: RegistryCollection): Map<string, RegistryRecord> {
  const map = collectionMap(collection);
  if (hydrated.has(collection)) return map;
  for (const record of readSnapshot<RegistryRecord>(collection)) {
    if (!record?.id || record.schemaVersion !== 1) continue;
    map.set(record.id, record);
  }
  hydrated.add(collection);
  if (collection === "platform-capabilities" && map.size === 0) {
    for (const capability of defaultPlatformCapabilities()) {
      map.set(capability.id, capability);
    }
    persist(collection, "seed", [...map.values()]);
  }
  if (collection === "video-blueprints" && map.size === 0) {
    for (const blueprint of defaultBlueprints()) {
      map.set(blueprint.id, blueprint);
    }
    persist(collection, "seed", [...map.values()]);
  }
  if (collection === "creative-dna" && map.size === 0) {
    for (const dna of defaultCreativeDNA()) {
      map.set(dna.id, dna);
    }
    persist(collection, "seed", [...map.values()]);
  }
  if (collection === "creative-agent-specs" && map.size === 0) {
    for (const agent of defaultCreativeAgentSpecs()) {
      map.set(agent.id, agent);
    }
    persist(collection, "seed", [...map.values()]);
  }
  return map;
}

function persist(collection: RegistryCollection, event: string, nextRecords: RegistryRecord[]): void {
  writeSnapshot(collection, nextRecords);
  for (const record of nextRecords) {
    appendStateEvent(collection as DurableCollection, event, record);
  }
}

export function listRegistryRecords<T extends RegistryRecord>(collection: RegistryCollection): T[] {
  return [...ensureHydrated(collection).values()] as T[];
}

export function getRegistryRecord<T extends RegistryRecord>(
  collection: RegistryCollection,
  id: string,
): T | undefined {
  return ensureHydrated(collection).get(id) as T | undefined;
}

export function upsertRegistryRecord<T extends RegistryRecord>(
  collection: RegistryCollection,
  record: Omit<T, "id" | "schemaVersion" | "createdAt" | "updatedAt"> & {
    id?: string;
    createdAt?: string;
  },
): T {
  const map = ensureHydrated(collection);
  const id = record.id ?? randomUUID();
  const existing = map.get(id);
  const timestamp = now();
  const next = {
    ...existing,
    ...record,
    id,
    schemaVersion: 1,
    createdAt: existing?.createdAt ?? record.createdAt ?? timestamp,
    updatedAt: timestamp,
  } as T;
  map.set(id, next);
  persist(collection, existing ? "update" : "create", [...map.values()]);
  return next;
}

export function listPlatformCapabilities(): PlatformCapabilityRecord[] {
  return listRegistryRecords<PlatformCapabilityRecord>("platform-capabilities");
}

function defaultPlatformCapabilities(): PlatformCapabilityRecord[] {
  const timestamp = now();
  const base = {
    schemaVersion: 1 as const,
    verifiedAt: "2026-07-20",
    maxDurationSeconds: 60,
    aspectRatios: ["9:16"],
    supportedContainers: ["mp4"],
    supportsDraftUpload: false,
    supportsDirectPublish: false,
    requiresAiDisclosure: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const recordsByPlatform: Array<PlatformCapabilityRecord> = [
    {
      ...base,
      id: "platform-capability-tiktok",
      platform: "tiktok",
      specVersion: "manual-export-baseline-2026-07-20",
      supportsDraftUpload: false,
      notes: ["Manual export is available locally; API publishing requires approved platform credentials."],
    },
    {
      ...base,
      id: "platform-capability-reels",
      platform: "reels",
      specVersion: "manual-export-baseline-2026-07-20",
      notes: ["Instagram/Reels publishing requires eligible professional-account API capability."],
    },
    {
      ...base,
      id: "platform-capability-shorts",
      platform: "shorts",
      specVersion: "manual-export-baseline-2026-07-20",
      notes: ["YouTube Shorts package generation is local-first; direct upload remains approval-bound."],
    },
    {
      ...base,
      id: "platform-capability-generic",
      platform: "generic",
      specVersion: "local-export-baseline-2026-07-20",
      requiresAiDisclosure: false,
      notes: ["Generic export writes local package metadata and never performs remote publication."],
    },
  ];
  return recordsByPlatform;
}

function defaultBlueprints(): VideoBlueprint[] {
  const timestamp = now();
  const make = (
    id: string,
    name: string,
    platform: VideoExportPlatform,
    durationSeconds: number,
    templateId = "faceless_broll_story_v1",
    rendererTier: VideoBlueprint["rendererTier"] = "ffmpeg_faceless_broll",
  ): VideoBlueprint => ({
    id,
    schemaVersion: 1,
    name,
    mode: "FULL_RENDER",
    profile: "constrained_cpu_8gb",
    platform,
    aspectRatio: "9:16",
    durationSeconds,
    templateId,
    captionStyle: "lower_third",
    rendererTier,
    certificationEligible: true,
    maxStaticIntervalSeconds: 1.8,
    minVisualEventsPerMinute: 18,
    safeZones: { topPct: 10, bottomPct: 18, sidePct: 8 },
    requiredAssetKinds: ["template"],
    audioProfileId: "spoken_shortform_v1",
    requiredCapabilityIds: [`platform-capability-${platform}`],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return [
    make("blueprint-tiktok-narrator-30", "Narrator Short 30s", "tiktok", 30),
    make("blueprint-reels-narrator-30", "Reels Narrator 30s", "reels", 30),
    make("blueprint-shorts-narrator-30", "Shorts Narrator 30s", "shorts", 30),
    make("blueprint-kinetic-text-insight", "Kinetic Text Insight", "generic", 24, "kinetic_text_insight_v1", "ffmpeg_kinetic_text"),
    make("blueprint-faceless-broll-story", "Faceless B-roll Story", "generic", 30, "faceless_broll_story_v1", "ffmpeg_faceless_broll"),
    make("blueprint-cinematic-explainer", "Cinematic Narrator Explainer", "generic", 30, "narrator_cinematic_explainer_v1", "ffmpeg_cinematic_explainer"),
    make("blueprint-educational-mini-doc", "Educational Mini Documentary", "generic", 45, "faceless_broll_story_v1", "ffmpeg_faceless_broll"),
    make("blueprint-myth-versus-fact", "Myth Versus Fact", "generic", 30, "kinetic_text_insight_v1", "ffmpeg_kinetic_text"),
    make("blueprint-list-countdown", "List Countdown", "generic", 30, "kinetic_text_insight_v1", "ffmpeg_kinetic_text"),
    make("blueprint-mystery-reveal", "Mystery Reveal", "generic", 30, "narrator_cinematic_explainer_v1", "ffmpeg_cinematic_explainer"),
    make("blueprint-product-demo", "Product Demonstration", "generic", 30, "faceless_broll_story_v1", "ffmpeg_faceless_broll"),
    make("blueprint-transformation", "Motivational Transformation", "generic", 30, "narrator_cinematic_explainer_v1", "ffmpeg_cinematic_explainer"),
    make("blueprint-quote-to-insight", "Quote To Insight", "generic", 20, "kinetic_text_insight_v1", "ffmpeg_kinetic_text"),
    make("blueprint-chart-data-story", "Chart Data Story", "generic", 30, "kinetic_text_insight_v1", "ffmpeg_kinetic_text"),
    make("blueprint-series-recap-bridge", "Series Recap Bridge", "generic", 25, "faceless_broll_story_v1", "ffmpeg_faceless_broll"),
  ];
}

function defaultCreativeDNA(): CreativeDNA[] {
  const timestamp = now();
  return [{
    id: "creative-dna-local-first-creator",
    schemaVersion: 1,
    name: "Local-first creator systems",
    audiencePromise: "Turn practical systems into short videos that are clear, useful, and reviewable.",
    coreEmotion: "earned momentum",
    centralTension: "automation should save time without hiding quality or rights decisions",
    noveltyMechanism: "show the invisible workflow as concrete visual progress",
    hookFamily: "counterintuitive claim",
    narrativeShape: "promise, mechanism, proof, action",
    visualGrammar: "dark workspace, high-contrast motion typography, concrete process artifacts",
    motionGrammar: "short holds, progress bars, directional accents, safe-zone captions",
    soundSignature: "clear narration with restrained synthetic texture",
    captionPersonality: "direct, specific, non-hype",
    CTAStyle: "save or apply one step",
    loopMechanism: "ending restates the first promise as an action",
    forbiddenCliches: ["like and subscribe", "in today's video", "unlock your potential"],
    brandConstraints: ["no fabricated metrics", "no unlicensed external assets", "no viral guarantees"],
    platformAdaptations: {
      tiktok: "front-load the visual promise and keep copy under safe-zone limits",
      reels: "use clear first-frame copy and disclosure-ready caption text",
      shorts: "prioritize readable narration and a strong final loop",
      generic: "export a complete local production package for review",
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  }];
}

function defaultCreativeAgentSpecs(): CreativeAgentSpec[] {
  const timestamp = now();
  const make = (
    id: string,
    purpose: string,
    outputs: string[],
    operatorPolicy: string,
    humanApprovalBoundary: string,
  ): CreativeAgentSpec => ({
    id,
    schemaVersion: 1,
    purpose,
    inputs: ["brief", "runtime-profile", "brand-kit", "audience-persona", "prior-artifacts"],
    outputs,
    allowedTools: ["read_registry", "write_checkpoint", "validate_schema"],
    forbiddenTools: ["shell", "network_fetch", "publish_direct", "filesystem_delete"],
    operatorPolicy,
    profileRequirements: ["constrained_cpu_8gb", "standard_cpu_16gb"],
    timeoutMs: 120_000,
    retryPolicy: "bounded_once",
    validation: ["schema", "rights_state", "profile_eligibility"],
    confidenceRequired: 0.7,
    humanApprovalBoundary,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return [
    make("intake-capability-agent", "Validate brief, mode, platform, rights, and hardware constraints before expensive work.", ["capability-contract"], "Pilot or deterministic validator; no 7B required", "Blocks impossible or unsafe requests before queueing."),
    make("creative-strategy-agent", "Generate CreativeDNA-aligned concepts with distinct premise, emotion, and visual language.", ["creative-dna", "concept-candidates"], "Architect when RAM permits, Pilot-lite fallback in constrained mode", "Human review before promoting a concept to production."),
    make("concept-tournament-agent", "Score concept diversity and select winner plus backup with transparent rationale.", ["concept-tournament"], "Deterministic scoring plus optional Oracle review", "Approval required before discarding all backup candidates."),
    make("asset-rights-agent", "Track asset source, license, attribution, consent, and transformation lineage.", ["asset-manifest", "rights-blockers"], "Deterministic validator; model suggestions cannot approve rights", "Unknown required rights block READY_TO_POST."),
    make("quality-council-agent", "Combine deterministic QC, creative review, accessibility, rights, and platform fit.", ["quality-report", "certification-recommendation"], "Deterministic checks own hard failures; Auditor may add review notes", "Cannot override failed deterministic media or rights checks."),
    make("analytics-evolution-agent", "Convert observed metrics into approval-required learning recommendations.", ["learning-record"], "Oracle or Pilot; never mutates production policy directly", "Every proposed routing/template/prompt change requires approval."),
  ];
}

export function _clearCreativeFactoryRegistryForTesting(): void {
  for (const map of Object.values(records)) {
    map.clear();
  }
  hydrated.clear();
}
