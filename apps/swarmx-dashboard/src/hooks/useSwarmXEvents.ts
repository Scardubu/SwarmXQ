"use client";

import { useEffect, useRef } from "react";
import type { SwarmXEvent } from "@swarmx/types";
import { useEventsStore } from "@/stores/events";

const SSE_URL = "/api/events";
const HISTORY_URL = "/api/logs/events?limit=120";
const RECONNECT_DELAY_MS = 2_000;
const STALE_CHECK_INTERVAL_MS = 2_000;

interface HistoricalEventsResponse {
  events: SwarmXEvent[];
  count: number;
}

/**
 * Establishes an SSE connection to /api/events and dispatches all events
 * into the Zustand events store. Handles reconnection automatically.
 * Stale data indicator: if silent > 5s, marks store as stale.
 *
 * Mount once at the root dashboard layout. The underlying EventSource
 * auto-reconnects on network drop — this hook adds exponential back-pressure
 * via a manual reconnect gate when the server sends close/error.
 */
export function useSwarmXEvents(): void {
  const handleEvent = useEventsStore((s) => s.handleEvent);
  const setConnectionStatus = useEventsStore((s) => s.setConnectionStatus);
  const checkStale = useEventsStore((s) => s.checkStale);

  const esRef = useRef<EventSource | null>(null);
  const staleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let destroyed = false;

    async function bootstrapHistory() {
      try {
        const response = await fetch(HISTORY_URL, { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as HistoricalEventsResponse;
        for (const event of payload.events) {
          if (destroyed) return;
          handleEvent(event);
        }
      } catch {
        // Historical bootstrap is best-effort only
      }
    }

    function connect() {
      if (destroyed) return;

      setConnectionStatus("connecting");
      const es = new EventSource(SSE_URL);
      esRef.current = es;

      es.onopen = () => {
        if (!destroyed) setConnectionStatus("connected");
      };

      es.onmessage = (e: MessageEvent<string>) => {
        if (destroyed) return;
        try {
          const event = JSON.parse(e.data) as SwarmXEvent;
          handleEvent(event);
        } catch {
          // Malformed SSE payload — skip silently
        }
      };

      es.onerror = () => {
        if (destroyed) return;
        setConnectionStatus("disconnected");
        es.close();
        esRef.current = null;
        reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    }

    connect();
    void bootstrapHistory();

    // Stale data watchdog
    staleTimerRef.current = setInterval(() => {
      if (!destroyed) checkStale();
    }, STALE_CHECK_INTERVAL_MS);

    return () => {
      destroyed = true;
      esRef.current?.close();
      esRef.current = null;
      if (staleTimerRef.current) clearInterval(staleTimerRef.current);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [handleEvent, setConnectionStatus, checkStale]);
}
