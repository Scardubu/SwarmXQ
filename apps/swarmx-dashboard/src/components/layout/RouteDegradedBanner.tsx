"use client";

import { AlertTriangle, WifiOff } from "lucide-react";
import { getRuntimeGuidance } from "@/lib/runtime-guidance";

interface RouteDegradedBannerProps {
  readonly pressureLevel: string | undefined;
  readonly availableMb?: number | null;
  readonly apiOnline: boolean | null;
  readonly ollamaOnline: boolean | null;
}

/**
 * Route-level degraded-state banner. Returns null when the runtime is healthy.
 * Each route page reads pressureLevel/ollamaOnline from useEventsStore + useApiHealth
 * and passes them here — no additional store reads inside.
 */
export function RouteDegradedBanner({
  pressureLevel,
  availableMb,
  apiOnline,
  ollamaOnline,
}: RouteDegradedBannerProps) {
  const guidance = getRuntimeGuidance({ apiOnline, ollamaOnline, pressureLevel, availableMb });

  if (!guidance) {
    return null;
  }

  const Icon = guidance.tone === "critical" ? WifiOff : AlertTriangle;

  return (
    <div
      className={
        guidance.tone === "critical"
          ? "flex items-start gap-3 rounded border border-status-error/35 bg-status-error/10 px-3 py-3"
          : "flex items-start gap-3 rounded border border-status-warning/35 bg-status-warning/10 px-3 py-3"
      }
      role={guidance.tone === "critical" ? "alert" : "status"}
      aria-live={guidance.tone === "critical" ? "assertive" : "polite"}
    >
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded border border-status-warning/35 bg-status-warning/12">
        <Icon className="h-4 w-4 text-status-warning" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-status-warning">{guidance.title}</p>
        <p className="mt-1 text-xs leading-5 text-text-secondary">{guidance.detail}</p>
        <p className="mt-1 text-xs leading-5 text-text-muted">{guidance.recoveryHint}</p>
      </div>
    </div>
  );
}
