"use client";

import { useQuery } from "@tanstack/react-query";

export interface WarmupSnapshot {
  done: boolean;
  coldStartEtaSecs: number;
  source: "file" | "default";
}

export interface ApiHealthState {
  apiOnline: boolean | null;
  ollamaOnline: boolean | null;
  latencyMs: number | null;
  lastChecked: number | null;
  warmup: WarmupSnapshot | null;
}

function resolveDirectApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SWARMX_API_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return "http://127.0.0.1:3001";
}

const API_HEALTH_QUERY_KEY = ["swarmx", "api-health"] as const;
const API_HEALTH_POLL_INTERVAL_MS = 12_000;
const API_HEALTH_REQUEST_TIMEOUT_MS = 3_000;

const INITIAL_HEALTH: ApiHealthState = {
  apiOnline: null,
  ollamaOnline: null,
  latencyMs: null,
  lastChecked: null,
  warmup: null,
};

async function fetchApiHealth(): Promise<ApiHealthState> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(
    () => controller.abort(),
    API_HEALTH_REQUEST_TIMEOUT_MS,
  );
  const startedAt = Date.now();

  try {
    const response = await fetch(`${resolveDirectApiBaseUrl()}/api/system/health`, {
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      return {
        apiOnline: false,
        ollamaOnline: null,
        latencyMs,
        lastChecked: Date.now(),
        warmup: null,
      };
    }

    const data = (await response.json()) as {
      ollama?: { reachable?: boolean };
      warmup?: {
        done?: boolean;
        coldStartEtaSecs?: number;
        source?: "file" | "default";
      };
    };
    const warmup: WarmupSnapshot | null = data.warmup
      ? {
          done: Boolean(data.warmup.done),
          coldStartEtaSecs: Number.isFinite(data.warmup.coldStartEtaSecs)
            ? Number(data.warmup.coldStartEtaSecs)
            : 140,
          source: data.warmup.source === "file" ? "file" : "default",
        }
      : null;
    return {
      apiOnline: true,
      ollamaOnline: data.ollama?.reachable ?? null,
      latencyMs,
      lastChecked: Date.now(),
      warmup,
    };
  } catch {
    return {
      apiOnline: false,
      ollamaOnline: null,
      latencyMs: null,
      lastChecked: Date.now(),
      warmup: null,
    };
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

/**
 * Polls `/api/system/health` through a single React Query cache entry. All
 * mounted consumers share both the in-flight request and the twelve-second
 * cache cadence, preventing each dashboard surface from multiplying probes.
 */
export function useApiHealth(): ApiHealthState {
  const { data } = useQuery({
    queryKey: API_HEALTH_QUERY_KEY,
    queryFn: fetchApiHealth,
    refetchInterval: API_HEALTH_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    staleTime: API_HEALTH_POLL_INTERVAL_MS,
    retry: false,
    refetchOnWindowFocus: false,
  });

  return data ?? INITIAL_HEALTH;
}
