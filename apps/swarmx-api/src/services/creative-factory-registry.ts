import { randomUUID } from "node:crypto";
import type {
  AudiencePersona,
  BrandKit,
  PlatformCapability,
  VideoBlueprint,
  VideoExportPlatform,
} from "@swarmx/types/video-types";
import type { DurableCollection } from "./local-state-store.js";
import { appendStateEvent, readSnapshot, writeSnapshot } from "./local-state-store.js";

type RegistryCollection =
  | "brand-kits"
  | "audience-personas"
  | "video-blueprints"
  | "platform-capabilities";

type RegistryRecord = BrandKit | AudiencePersona | VideoBlueprint | PlatformCapabilityRecord;

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
  ): VideoBlueprint => ({
    id,
    schemaVersion: 1,
    name,
    mode: "FULL_RENDER",
    profile: "constrained_cpu",
    platform,
    aspectRatio: "9:16",
    durationSeconds,
    templateId: "narrator-template-v1",
    captionStyle: "lower_third",
    requiredCapabilityIds: [`platform-capability-${platform}`],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return [
    make("blueprint-tiktok-narrator-30", "Narrator Short 30s", "tiktok", 30),
    make("blueprint-reels-narrator-30", "Reels Narrator 30s", "reels", 30),
    make("blueprint-shorts-narrator-30", "Shorts Narrator 30s", "shorts", 30),
  ];
}

export function _clearCreativeFactoryRegistryForTesting(): void {
  for (const map of Object.values(records)) {
    map.clear();
  }
  hydrated.clear();
}
