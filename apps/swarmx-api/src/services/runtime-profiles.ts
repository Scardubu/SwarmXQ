import { readFileSync } from "node:fs";
import type { RuntimeProfileId } from "@swarmx/types/video-types";
import { loadEnv } from "../lib/env.js";

export type RuntimeProfileSource = "auto" | "env" | "fallback";

export interface RuntimeProfileDefinition {
  id: RuntimeProfileId;
  label: string;
  minTotalRamMb: number;
  ollamaNumParallel: 1;
  ollamaMaxLoadedModels: 1 | 2;
  ollamaKeepAlive: "0";
  startupHeavyPreload: boolean;
  allowSecondResidentModel: boolean;
  allowAcceleratedAdapters: boolean;
  notes: string[];
}

export interface RuntimeProfileResolution {
  profile: RuntimeProfileDefinition;
  source: RuntimeProfileSource;
  requested: string;
  totalRamMb: number | null;
  availableRamMb: number | null;
  blockers: string[];
  warnings: string[];
}

export const RUNTIME_PROFILE_DEFINITIONS: Record<RuntimeProfileId, RuntimeProfileDefinition> = {
  constrained_cpu_8gb: {
    id: "constrained_cpu_8gb",
    label: "Constrained CPU 8 GB",
    minTotalRamMb: 0,
    ollamaNumParallel: 1,
    ollamaMaxLoadedModels: 1,
    ollamaKeepAlive: "0",
    startupHeavyPreload: false,
    allowSecondResidentModel: false,
    allowAcceleratedAdapters: false,
    notes: [
      "One heavyweight model resident at a time.",
      "No heavyweight startup preload.",
      "TTS and render stages run after model eviction.",
    ],
  },
  standard_cpu_16gb: {
    id: "standard_cpu_16gb",
    label: "Standard CPU 16 GB",
    minTotalRamMb: 12_288,
    ollamaNumParallel: 1,
    ollamaMaxLoadedModels: 2,
    ollamaKeepAlive: "0",
    startupHeavyPreload: false,
    allowSecondResidentModel: true,
    allowAcceleratedAdapters: false,
    notes: [
      "At most one 7B-class model may be actively inferencing.",
      "A second lightweight resident model is allowed only after pressure checks.",
      "Global keep-alive remains zero; request-level keep-alive is explicit.",
    ],
  },
  accelerated_optional: {
    id: "accelerated_optional",
    label: "Accelerated Optional",
    minTotalRamMb: 0,
    ollamaNumParallel: 1,
    ollamaMaxLoadedModels: 2,
    ollamaKeepAlive: "0",
    startupHeavyPreload: false,
    allowSecondResidentModel: true,
    allowAcceleratedAdapters: true,
    notes: [
      "Opt-in only.",
      "Never required for local-first release gates.",
      "GPU or remote adapters must expose a local fallback and capability state.",
    ],
  },
};

export function normalizeRuntimeProfileId(input: string | undefined | null): RuntimeProfileId | "auto" {
  const value = (input ?? "auto").trim().toLowerCase();
  switch (value) {
    case "":
    case "auto":
      return "auto";
    case "8gb":
    case "8g":
    case "constrained":
    case "constrained_cpu":
    case "constrained_cpu_8gb":
      return "constrained_cpu_8gb";
    case "16gb":
    case "16g":
    case "standard":
    case "standard_cpu":
    case "standard_cpu_16gb":
      return "standard_cpu_16gb";
    case "accelerated":
    case "accelerated_optional":
      return "accelerated_optional";
    default:
      return "auto";
  }
}

export function detectTotalMemoryMb(): number | null {
  try {
    const raw = readFileSync("/proc/meminfo", "utf8");
    const totalKb = Number(raw.match(/MemTotal:\s+(\d+)\s+kB/)?.[1] ?? 0);
    return totalKb > 0 ? Math.floor(totalKb / 1024) : null;
  } catch {
    return null;
  }
}

export function detectAvailableMemoryMbForProfile(): number | null {
  try {
    const raw = readFileSync("/proc/meminfo", "utf8");
    const availableKb = Number(raw.match(/MemAvailable:\s+(\d+)\s+kB/)?.[1] ?? 0);
    return availableKb > 0 ? Math.floor(availableKb / 1024) : null;
  } catch {
    return null;
  }
}

export function resolveRuntimeProfile(input?: {
  requested?: string;
  totalRamMb?: number | null;
  availableRamMb?: number | null;
  ollamaNumParallel?: number;
  ollamaMaxLoadedModels?: number;
  ollamaKeepAlive?: string;
  startupPrewarm?: string;
}): RuntimeProfileResolution {
  const env = loadEnv();
  const requestedRaw = input?.requested ?? env.SWARMX_HOST_PROFILE;
  const requested = normalizeRuntimeProfileId(requestedRaw);
  const totalRamMb = input?.totalRamMb ?? detectTotalMemoryMb();
  const availableRamMb = input?.availableRamMb ?? detectAvailableMemoryMbForProfile();
  const source: RuntimeProfileSource = requested === "auto" ? "auto" : "env";
  const autoProfile: RuntimeProfileId =
    totalRamMb !== null && totalRamMb >= RUNTIME_PROFILE_DEFINITIONS.standard_cpu_16gb.minTotalRamMb
      ? "standard_cpu_16gb"
      : "constrained_cpu_8gb";
  const profileId = requested === "auto" ? autoProfile : requested;
  const profile = RUNTIME_PROFILE_DEFINITIONS[profileId];
  const blockers: string[] = [];
  const warnings: string[] = [];

  const numParallel = input?.ollamaNumParallel ?? env.OLLAMA_NUM_PARALLEL;
  const maxLoadedModels = input?.ollamaMaxLoadedModels ?? env.OLLAMA_MAX_LOADED_MODELS;
  const keepAlive = input?.ollamaKeepAlive ?? env.OLLAMA_KEEP_ALIVE;
  const startupPrewarm = input?.startupPrewarm ?? env.SWARMX_MODEL_STARTUP_PREWARM;

  if (numParallel !== 1) blockers.push("OLLAMA_NUM_PARALLEL must be 1 on CPU profiles");
  if (profile.id === "constrained_cpu_8gb") {
    if (maxLoadedModels !== 1) blockers.push("constrained_cpu_8gb requires OLLAMA_MAX_LOADED_MODELS=1");
    if (keepAlive !== "0" && keepAlive !== "0s") blockers.push("constrained_cpu_8gb requires OLLAMA_KEEP_ALIVE=0");
    if (startupPrewarm === "1") blockers.push("constrained_cpu_8gb prohibits heavyweight startup preload");
  }
  if (profile.id === "standard_cpu_16gb") {
    if (maxLoadedModels > 2) blockers.push("standard_cpu_16gb allows at most OLLAMA_MAX_LOADED_MODELS=2");
    if (maxLoadedModels < 1) blockers.push("OLLAMA_MAX_LOADED_MODELS must be at least 1");
    if (keepAlive !== "0" && keepAlive !== "0s") warnings.push("standard_cpu_16gb should keep global OLLAMA_KEEP_ALIVE=0 and use request-level keep_alive");
  }
  if (profile.id === "accelerated_optional" && requestedRaw === "auto") {
    blockers.push("accelerated_optional must be explicitly requested");
  }
  if (totalRamMb !== null && profile.id === "standard_cpu_16gb" && totalRamMb < profile.minTotalRamMb) {
    warnings.push(`standard_cpu_16gb requested on ${totalRamMb} MB RAM host; constrained safeguards may be required`);
  }
  if (availableRamMb !== null && availableRamMb < 2_200) {
    warnings.push(`available RAM is low (${availableRamMb} MB); admission should delay or fail heavy stages`);
  }

  return {
    profile,
    source,
    requested: requestedRaw,
    totalRamMb,
    availableRamMb,
    blockers,
    warnings,
  };
}

export function assertRuntimeProfileSafe(resolution = resolveRuntimeProfile()): void {
  if (resolution.blockers.length > 0) {
    throw new Error(`Unsafe runtime profile settings:\n${resolution.blockers.map((b) => `  - ${b}`).join("\n")}`);
  }
}
