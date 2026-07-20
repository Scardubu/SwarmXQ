"use client";

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type {
  AudiencePersona,
  BrandKit,
  CreativeFactoryWorkflowRun,
  PlatformCapability,
  VideoBlueprint,
  WorkflowStageDefinition,
} from "@swarmx/types/video-types";

const API_BASE = "";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    ...init,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json() as { message?: string };
      message = typeof body.message === "string" ? body.message : message;
    } catch {
      // keep statusText
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export interface CreativeFactoryState {
  stages: WorkflowStageDefinition[];
  runs: CreativeFactoryWorkflowRun[];
  capabilities: PlatformCapability[];
  brandKits: BrandKit[];
  audiences: AudiencePersona[];
  blueprints: VideoBlueprint[];
  isLoading: boolean;
  error: string | null;
}

export interface CreativeFactoryActions {
  fetchFactory: () => Promise<void>;
  createRun: (input: Pick<CreativeFactoryWorkflowRun, "mode" | "profile" | "idempotencyKey">) => Promise<string | null>;
}

type CreativeFactoryStore = CreativeFactoryState & CreativeFactoryActions;

export const useCreativeFactoryStore = create<CreativeFactoryStore>()(
  devtools((set, get) => ({
    stages: [],
    runs: [],
    capabilities: [],
    brandKits: [],
    audiences: [],
    blueprints: [],
    isLoading: false,
    error: null,

    fetchFactory: async () => {
      set({ isLoading: true, error: null }, false, "factory/fetch/start");
      try {
        const [definitions, runs, capabilities, brandKits, audiences, blueprints] = await Promise.all([
          apiFetch<{ stages: WorkflowStageDefinition[] }>("/api/video/factory/workflow/definitions"),
          apiFetch<{ runs: CreativeFactoryWorkflowRun[] }>("/api/video/factory/runs"),
          apiFetch<{ capabilities: PlatformCapability[] }>("/api/video/factory/capabilities"),
          apiFetch<{ brandKits: BrandKit[] }>("/api/video/factory/brand-kits"),
          apiFetch<{ audiences: AudiencePersona[] }>("/api/video/factory/audiences"),
          apiFetch<{ blueprints: VideoBlueprint[] }>("/api/video/factory/blueprints"),
        ]);
        set({
          stages: definitions.stages,
          runs: runs.runs,
          capabilities: capabilities.capabilities,
          brandKits: brandKits.brandKits,
          audiences: audiences.audiences,
          blueprints: blueprints.blueprints,
          isLoading: false,
        }, false, "factory/fetch/done");
      } catch (err) {
        set({
          isLoading: false,
          error: err instanceof Error ? err.message : "Failed to load Creative Factory state.",
        }, false, "factory/fetch/error");
      }
    },

    createRun: async (input) => {
      try {
        const run = await apiFetch<CreativeFactoryWorkflowRun>("/api/video/factory/runs", {
          method: "POST",
          body: JSON.stringify(input),
        });
        set({ runs: [run, ...get().runs.filter((existing) => existing.id !== run.id)] }, false, "factory/createRun");
        return run.id;
      } catch (err) {
        set({ error: err instanceof Error ? err.message : "Failed to create workflow run." });
        return null;
      }
    },
  }), { name: "creative-factory-store" }),
);
