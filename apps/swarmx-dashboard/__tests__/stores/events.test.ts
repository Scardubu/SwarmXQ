/**
 * Unit tests for useEventsStore.handleEvent
 *
 * Tests the pure state transition logic in isolation.
 * Zustand stores are headless and work fine in a Node.js vitest environment.
 */
import { describe, it, expect, beforeEach } from "vitest";

// Import the store — "use client" is a no-op string in Node.js
import { useEventsStore } from "@/stores/events";

function resetStore() {
  useEventsStore.setState({
    connectionStatus: "connecting",
    lastEventAt: null,
    isStale: false,
    agents: new Map(),
    systemMetrics: null,
    cpuHistory: [],
    memHistory: [],
    diskReadHistory: [],
    diskWriteHistory: [],
    netRxHistory: [],
    netTxHistory: [],
    queues: new Map(),
    controlPlaneLayers: new Map(),
    cgroupScopes: new Map(),
    logs: [],
    errorAgentCount: 0,
    activeAgentCount: 0,
    totalAgentCount: 0,
    scsScore: null,
    scsHistory: [],
  });
}

describe("useEventsStore.handleEvent", () => {
  beforeEach(resetStore);

  describe("agent:update", () => {
    it("adds a new agent to the fleet", () => {
      const { handleEvent } = useEventsStore.getState();

      handleEvent({
        type: "agent:update",
        data: {
          id: "agent-1",
          name: "Alpha",
          status: "running",
          pid: 1234,
          timestamp: Date.now(),
        } as never,
      });

      const state = useEventsStore.getState();
      expect(state.agents.size).toBe(1);
      expect(state.agents.get("agent-1")?.status).toBe("running");
      expect(state.agents.get("agent-1")?.pid).toBe(1234);
    });

    it("merges update into existing agent without clobbering fields", () => {
      const { handleEvent } = useEventsStore.getState();

      handleEvent({
        type: "agent:update",
        data: {
          id: "agent-1",
          name: "Alpha",
          status: "idle",
          pid: 100,
          timestamp: Date.now(),
          oomCount: 2,
        } as never,
      });

      handleEvent({
        type: "agent:update",
        data: {
          id: "agent-1",
          name: "Alpha",
          status: "running",
          pid: 101,
          timestamp: Date.now(),
        } as never,
      });

      const agent = useEventsStore.getState().agents.get("agent-1");
      expect(agent?.status).toBe("running");
      expect(agent?.pid).toBe(101);
      // oomCount from first event should survive (merged)
      expect(agent?.oomCount).toBe(2);
    });

    it("increments activeAgentCount for running agents", () => {
      const { handleEvent } = useEventsStore.getState();

      handleEvent({
        type: "agent:update",
        data: { id: "a1", status: "running", timestamp: Date.now() } as never,
      });
      handleEvent({
        type: "agent:update",
        data: { id: "a2", status: "active", timestamp: Date.now() } as never,
      });
      handleEvent({
        type: "agent:update",
        data: { id: "a3", status: "idle", timestamp: Date.now() } as never,
      });

      const state = useEventsStore.getState();
      expect(state.activeAgentCount).toBe(2);
      expect(state.totalAgentCount).toBe(3);
    });

    it("increments errorAgentCount for error/fatal/oom_killed agents", () => {
      const { handleEvent } = useEventsStore.getState();

      for (const status of ["error", "fatal", "oom_killed"] as const) {
        handleEvent({
          type: "agent:update",
          data: { id: `agent-${status}`, status, timestamp: Date.now() } as never,
        });
      }

      expect(useEventsStore.getState().errorAgentCount).toBe(3);
    });
  });

  describe("agent:remove", () => {
    it("removes agent from fleet", () => {
      const { handleEvent } = useEventsStore.getState();

      handleEvent({
        type: "agent:update",
        data: { id: "a1", status: "running", timestamp: Date.now() } as never,
      });
      handleEvent({ type: "agent:remove", data: { id: "a1" } as never });

      expect(useEventsStore.getState().agents.size).toBe(0);
      expect(useEventsStore.getState().totalAgentCount).toBe(0);
    });

    it("is idempotent for unknown agent IDs", () => {
      const { handleEvent } = useEventsStore.getState();
      expect(() =>
        handleEvent({ type: "agent:remove", data: { id: "ghost" } as never })
      ).not.toThrow();
      expect(useEventsStore.getState().agents.size).toBe(0);
    });
  });

  describe("queue:metrics", () => {
    it("stores queue metrics by name", () => {
      const { handleEvent } = useEventsStore.getState();

      handleEvent({
        type: "queue:metrics",
        data: {
          name: "default",
          waiting: 5,
          active: 2,
          completed: 100,
          failed: 1,
          delayed: 0,
          paused: false,
          workerCount: 2,
          timestamp: Date.now(),
        } as never,
      });

      const q = useEventsStore.getState().queues.get("default");
      expect(q?.waiting).toBe(5);
      expect(q?.active).toBe(2);
    });

    it("overwrites stale metrics for same queue", () => {
      const { handleEvent } = useEventsStore.getState();

      const base = {
        name: "default",
        active: 1,
        completed: 0,
        failed: 0,
        delayed: 0,
        paused: false,
        workerCount: 1,
        timestamp: Date.now(),
      };

      handleEvent({ type: "queue:metrics", data: { ...base, waiting: 10 } as never });
      handleEvent({ type: "queue:metrics", data: { ...base, waiting: 3 } as never });

      expect(useEventsStore.getState().queues.get("default")?.waiting).toBe(3);
    });
  });

  describe("setConnectionStatus / checkStale", () => {
    it("updates connection status", () => {
      useEventsStore.getState().setConnectionStatus("connected");
      expect(useEventsStore.getState().connectionStatus).toBe("connected");
    });

    it("marks stale when no event received within threshold", () => {
      // Simulate a last event 10 s ago
      useEventsStore.setState({ lastEventAt: Date.now() - 10_000 });
      useEventsStore.getState().checkStale();
      expect(useEventsStore.getState().isStale).toBe(true);
    });

    it("clears stale when recently active", () => {
      useEventsStore.setState({ lastEventAt: Date.now() - 100 });
      useEventsStore.getState().checkStale();
      expect(useEventsStore.getState().isStale).toBe(false);
    });
  });
});
