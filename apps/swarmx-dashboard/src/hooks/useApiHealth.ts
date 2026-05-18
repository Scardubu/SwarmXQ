"use client";

import React from "react";

export interface ApiHealthState {
  apiOnline: boolean | null;
  ollamaOnline: boolean | null;
  latencyMs: number | null;
  lastChecked: number | null;
}

function resolveDirectApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SWARMX_API_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return "http://127.0.0.1:3001";
}

/**
 * Polls /api/system/health to surface API and Ollama liveness.
 * Shared across header and composer so health semantics stay aligned.
 */
export function useApiHealth(pollIntervalMs = 12_000): ApiHealthState {
  const [health, setHealth] = React.useState<ApiHealthState>({
    apiOnline: null,
    ollamaOnline: null,
    latencyMs: null,
    lastChecked: null,
  });

  React.useEffect(() => {
    const baseUrl = resolveDirectApiBaseUrl();
    let cancelled = false;

    async function probe() {
      if (cancelled) return;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8_000);
        const t0 = Date.now();
        const res = await fetch(`${baseUrl}/api/system/health`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const latencyMs = Date.now() - t0;
        if (cancelled) return;

        if (res.ok || res.status === 503) {
          const data = (await res.json()) as { ollama?: { reachable?: boolean } };
          setHealth({
            apiOnline: true,
            ollamaOnline: data?.ollama?.reachable ?? null,
            latencyMs,
            lastChecked: Date.now(),
          });
          return;
        }

        setHealth((prev) => ({
          ...prev,
          apiOnline: false,
          latencyMs,
          lastChecked: Date.now(),
        }));
      } catch {
        if (!cancelled) {
          setHealth((prev) => ({
            ...prev,
            apiOnline: false,
            latencyMs: null,
            lastChecked: Date.now(),
          }));
        }
      }
    }

    void probe();
    const id = setInterval(() => {
      void probe();
    }, pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pollIntervalMs]);

  return health;
}
