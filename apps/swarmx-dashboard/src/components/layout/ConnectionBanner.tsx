"use client";

import React, { useMemo } from "react";
import { RefreshCw, WifiOff } from "lucide-react";
import { useEventsStore } from "@/stores/events";
import { Button } from "@/components/ui/button";

function formatAge(lastEventAt: number | null): string {
  if (lastEventAt == null) {
    return "No telemetry received yet";
  }

  const ageMs = Math.max(0, Date.now() - lastEventAt);
  if (ageMs < 1_000) {
    return "Telemetry just resumed";
  }
  if (ageMs < 60_000) {
    return `Last update ${Math.round(ageMs / 1_000)}s ago`;
  }
  return `Last update ${Math.round(ageMs / 60_000)}m ago`;
}

export function ConnectionBanner() {
  const isStale = useEventsStore((state) => state.isStale);
  const connectionStatus = useEventsStore((state) => state.connectionStatus);
  const lastEventAt = useEventsStore((state) => state.lastEventAt);

  const visible = isStale || connectionStatus === "disconnected" || connectionStatus === "connecting";
  const message = useMemo(() => {
    if (connectionStatus === "disconnected") {
      return "Live telemetry stream disconnected. Operator metrics may be stale.";
    }
    if (connectionStatus === "connecting") {
      return "Connecting to the SwarmX event stream.";
    }
    return "Telemetry has gone stale. Validate the API before acting on these metrics.";
  }, [connectionStatus]);

  if (!visible) {
    return null;
  }

  const isConnecting = connectionStatus === "connecting";

  return (
    <div
      className="border-b border-status-warning/30 bg-status-warning/10 px-4 py-2 panel-enter"
      role={connectionStatus === "disconnected" ? "alert" : "status"}
      aria-live={connectionStatus === "disconnected" ? "assertive" : "polite"}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          {isConnecting ? (
            <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-warning animate-spin" aria-hidden="true" />
          ) : (
            <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-warning" aria-hidden="true" />
          )}
          <div className="min-w-0">
            <p className="text-[11px] font-mono text-status-warning">{message}</p>
            <p className="text-[10px] font-mono text-text-muted">{formatAge(lastEventAt)}</p>
          </div>
        </div>
        {!isConnecting && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="gap-1.5 border border-status-warning/30 text-status-warning hover:bg-status-warning/10"
            onClick={() => globalThis.location.reload()}
          >
            <RefreshCw className="h-3 w-3" />
            Refresh
          </Button>
        )}
      </div>
    </div>
  );
}
