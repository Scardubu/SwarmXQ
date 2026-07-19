import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";
import { resetEnvForTesting } from "../src/lib/env.js";
import {
  _clearSeriesRegistryForTesting,
  _runCleanupForTesting,
  createSeries,
  getSeries,
  listSeries,
  updateSeries,
  setSeriesStatus,
  recordEpisodeJobId,
  deleteSeries,
  getPreProduction,
  setPreProduction,
  patchPreProduction,
  updatePreProductionStatus,
  updateSeriesPassStatus,
  updateEpisodePassStatus,
} from "../src/services/series-registry.js";
import type { SeriesBrief, EpisodePreProduction } from "@swarmx/types/series-types";

const minimalBrief: SeriesBrief = {
  storyTheme: "test theme",
  coreMessage: "test message",
  emotionalJourney: "fear to hope",
  primaryConflict: "internal",
  targetAudience: "gen z",
  tone: "educational",
  seriesLength: 3,
  episodeDurationSeconds: 30,
  platformPrimary: "tiktok",
  arcStructure: "3-act",
};

const minimalPreProd: EpisodePreProduction = {
  episodeNumber: 1,
  status: "pending",
};

beforeEach(() => {
  resetEnvForTesting();
  _clearSeriesRegistryForTesting();
});

// ─── createSeries ─────────────────────────────────────────────────────────────

describe("createSeries", () => {
  test("assigns a unique UUID to each series", () => {
    const a = createSeries(minimalBrief);
    const b = createSeries(minimalBrief);
    expect(a.id).toBeTruthy();
    expect(b.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
  });

  test("sets status to planning", () => {
    const s = createSeries(minimalBrief);
    expect(s.status).toBe("planning");
  });

  test("stores all brief fields verbatim", () => {
    const s = createSeries(minimalBrief);
    expect(s.brief.storyTheme).toBe("test theme");
    expect(s.brief.tone).toBe("educational");
    expect(s.brief.seriesLength).toBe(3);
    expect(s.brief.platformPrimary).toBe("tiktok");
  });

  test("sets createdAt as a parseable ISO string", () => {
    const before = new Date().toISOString();
    const s = createSeries(minimalBrief);
    expect(s.createdAt >= before).toBe(true);
    expect(() => new Date(s.createdAt)).not.toThrow();
  });

  test("initialises videoJobIds as empty object", () => {
    const s = createSeries(minimalBrief);
    expect(s.videoJobIds).toEqual({});
  });
});

// ─── getSeries ────────────────────────────────────────────────────────────────

describe("getSeries", () => {
  test("returns undefined for unknown ID", () => {
    expect(getSeries("nonexistent")).toBeUndefined();
  });

  test("returns the correct series by ID", () => {
    const s = createSeries(minimalBrief);
    const found = getSeries(s.id);
    expect(found).toBeDefined();
    expect(found?.id).toBe(s.id);
  });
});

// ─── listSeries ───────────────────────────────────────────────────────────────

describe("listSeries", () => {
  test("returns empty array when registry is empty", () => {
    expect(listSeries()).toEqual([]);
  });

  test("returns all created series", () => {
    createSeries(minimalBrief);
    createSeries(minimalBrief);
    expect(listSeries()).toHaveLength(2);
  });

  test("sorts newest first by createdAt", async () => {
    const a = createSeries(minimalBrief);
    await new Promise((r) => setTimeout(r, 10));
    const b = createSeries(minimalBrief);
    const list = listSeries();
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
  });
});

// ─── updateSeries ─────────────────────────────────────────────────────────────

describe("updateSeries", () => {
  test("merges patch fields and preserves others", () => {
    const s = createSeries(minimalBrief);
    const updated = updateSeries(s.id, { status: "planned" });
    expect(updated?.status).toBe("planned");
    expect(updated?.brief.storyTheme).toBe("test theme");
  });

  test("returns undefined for unknown ID", () => {
    expect(updateSeries("bad-id", { status: "planned" })).toBeUndefined();
  });

  test("preserves original id and createdAt", () => {
    const s = createSeries(minimalBrief);
    const updated = updateSeries(s.id, { status: "planned" });
    expect(updated?.id).toBe(s.id);
    expect(updated?.createdAt).toBe(s.createdAt);
  });

  test("updates updatedAt on every patch", async () => {
    const s = createSeries(minimalBrief);
    await new Promise((r) => setTimeout(r, 10));
    const updated = updateSeries(s.id, { status: "planned" });
    expect(updated?.updatedAt >= s.updatedAt).toBe(true);
  });
});

// ─── setSeriesStatus ──────────────────────────────────────────────────────────

describe("setSeriesStatus", () => {
  test("sets status field", () => {
    const s = createSeries(minimalBrief);
    expect(setSeriesStatus(s.id, "planned")?.status).toBe("planned");
  });

  test("stores optional planningError", () => {
    const s = createSeries(minimalBrief);
    const updated = setSeriesStatus(s.id, "failed", "pass1 failed: LLM timeout");
    expect(updated?.planningError).toBe("pass1 failed: LLM timeout");
  });

  test("returns the updated series", () => {
    const s = createSeries(minimalBrief);
    const updated = setSeriesStatus(s.id, "planned");
    expect(updated).toBeDefined();
    expect(updated?.id).toBe(s.id);
  });

  test("returns undefined for unknown ID", () => {
    expect(setSeriesStatus("bad-id", "planned")).toBeUndefined();
  });
});

// ─── recordEpisodeJobId ───────────────────────────────────────────────────────

describe("recordEpisodeJobId", () => {
  test("stores jobId under episodeNumber in videoJobIds", () => {
    const s = createSeries(minimalBrief);
    recordEpisodeJobId(s.id, 1, "job-001");
    expect(getSeries(s.id)?.videoJobIds[1]).toBe("job-001");
  });

  test("sets status to producing when fewer than all episodes recorded", () => {
    const s = createSeries({ ...minimalBrief, seriesLength: 2 });
    updateSeries(s.id, {
      episodeRoadmap: [
        { episodeNumber: 1, title: "ep1", summary: "s1", continuityThread: "ct1" },
        { episodeNumber: 2, title: "ep2", summary: "s2", continuityThread: "ct2" },
      ],
    });
    recordEpisodeJobId(s.id, 1, "job-001");
    expect(getSeries(s.id)?.status).toBe("producing");
  });

  test("sets status to completed when all episodes are recorded", () => {
    const s = createSeries({ ...minimalBrief, seriesLength: 2 });
    updateSeries(s.id, {
      episodeRoadmap: [
        { episodeNumber: 1, title: "ep1", summary: "s1", continuityThread: "ct1" },
        { episodeNumber: 2, title: "ep2", summary: "s2", continuityThread: "ct2" },
      ],
    });
    recordEpisodeJobId(s.id, 1, "job-001");
    recordEpisodeJobId(s.id, 2, "job-002");
    expect(getSeries(s.id)?.status).toBe("completed");
  });

  test("no-ops gracefully for unknown seriesId", () => {
    expect(() => recordEpisodeJobId("nonexistent", 1, "job-001")).not.toThrow();
  });
});

// ─── deleteSeries ─────────────────────────────────────────────────────────────

describe("deleteSeries", () => {
  test("removes the series from the registry", () => {
    const s = createSeries(minimalBrief);
    expect(deleteSeries(s.id)).toBe(true);
    expect(getSeries(s.id)).toBeUndefined();
  });

  test("returns false for unknown ID", () => {
    expect(deleteSeries("nonexistent")).toBe(false);
  });
});

// ─── getPreProduction / setPreProduction ──────────────────────────────────────

describe("getPreProduction / setPreProduction", () => {
  test("returns undefined before setPreProduction is called", () => {
    const s = createSeries(minimalBrief);
    expect(getPreProduction(s.id, 1)).toBeUndefined();
  });

  test("returns the set data after setPreProduction", () => {
    const s = createSeries(minimalBrief);
    setPreProduction(s.id, 1, minimalPreProd);
    const result = getPreProduction(s.id, 1);
    expect(result).toBeDefined();
    expect(result?.episodeNumber).toBe(1);
    expect(result?.status).toBe("pending");
  });

  test("isolates state by episodeNumber — different episodes are independent", () => {
    const s = createSeries(minimalBrief);
    setPreProduction(s.id, 1, { ...minimalPreProd, episodeNumber: 1, status: "scripting" });
    setPreProduction(s.id, 2, { ...minimalPreProd, episodeNumber: 2, status: "prompting" });
    expect(getPreProduction(s.id, 1)?.status).toBe("scripting");
    expect(getPreProduction(s.id, 2)?.status).toBe("prompting");
  });
});

// ─── patchPreProduction ───────────────────────────────────────────────────────

describe("patchPreProduction", () => {
  test("merges patch fields into existing record", () => {
    const s = createSeries(minimalBrief);
    setPreProduction(s.id, 1, minimalPreProd);
    patchPreProduction(s.id, 1, { status: "scripting" });
    expect(getPreProduction(s.id, 1)?.status).toBe("scripting");
  });

  test("preserves unpatched fields", () => {
    const s = createSeries(minimalBrief);
    setPreProduction(s.id, 1, { ...minimalPreProd, error: "original error" });
    patchPreProduction(s.id, 1, { status: "scripting" });
    const pp = getPreProduction(s.id, 1);
    expect(pp?.error).toBe("original error");
    expect(pp?.status).toBe("scripting");
  });

  test("no-ops when pre-production record does not exist", () => {
    const s = createSeries(minimalBrief);
    expect(() => patchPreProduction(s.id, 99, { status: "scripting" })).not.toThrow();
    expect(getPreProduction(s.id, 99)).toBeUndefined();
  });
});

// ─── updatePreProductionStatus ────────────────────────────────────────────────

describe("updatePreProductionStatus", () => {
  test("sets status on the existing pre-production record", () => {
    const s = createSeries(minimalBrief);
    setPreProduction(s.id, 1, minimalPreProd);
    updatePreProductionStatus(s.id, 1, "scripting");
    expect(getPreProduction(s.id, 1)?.status).toBe("scripting");
  });
});

// ─── updateSeriesPassStatus ───────────────────────────────────────────────────

describe("updateSeriesPassStatus", () => {
  test("sets pass1 status without affecting other passes", () => {
    const s = createSeries(minimalBrief);
    updateSeriesPassStatus(s.id, "pass1", "running");
    const ps = getSeries(s.id)?.planningPassStatus;
    expect(ps?.pass1).toBe("running");
    expect(ps?.pass2).toBe("idle");
    expect(ps?.pass3).toBe("idle");
    expect(ps?.pass4).toBe("idle");
  });

  test("transitions pass2 to complete while preserving pass1 complete", () => {
    const s = createSeries(minimalBrief);
    updateSeriesPassStatus(s.id, "pass1", "complete");
    updateSeriesPassStatus(s.id, "pass2", "running");
    const ps = getSeries(s.id)?.planningPassStatus;
    expect(ps?.pass1).toBe("complete");
    expect(ps?.pass2).toBe("running");
  });

  test("marks pass3 as failed", () => {
    const s = createSeries(minimalBrief);
    updateSeriesPassStatus(s.id, "pass3", "failed");
    expect(getSeries(s.id)?.planningPassStatus?.pass3).toBe("failed");
  });
});

// ─── updateEpisodePassStatus ──────────────────────────────────────────────────

describe("updateEpisodePassStatus", () => {
  test("sets passA status on the episode pre-production record", () => {
    const s = createSeries(minimalBrief);
    setPreProduction(s.id, 1, minimalPreProd);
    updateEpisodePassStatus(s.id, 1, "passA", "running");
    expect(getPreProduction(s.id, 1)?.passStatus?.passA).toBe("running");
  });

  test("sets passB without overwriting passA", () => {
    const s = createSeries(minimalBrief);
    setPreProduction(s.id, 1, minimalPreProd);
    updateEpisodePassStatus(s.id, 1, "passA", "complete");
    updateEpisodePassStatus(s.id, 1, "passB", "running");
    const ps = getPreProduction(s.id, 1)?.passStatus;
    expect(ps?.passA).toBe("complete");
    expect(ps?.passB).toBe("running");
    expect(ps?.passC).toBe("idle");
    expect(ps?.passD).toBe("idle");
  });

  test("no-ops gracefully when pre-production record does not exist", () => {
    const s = createSeries(minimalBrief);
    expect(() => updateEpisodePassStatus(s.id, 99, "passA", "running")).not.toThrow();
  });
});

// ─── TTL cleanup ──────────────────────────────────────────────────────────────

describe("TTL cleanup", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("evicts series whose age exceeds 7-day TTL", () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    vi.setSystemTime(t0);
    const s = createSeries(minimalBrief);
    // advance past 7-day TTL
    vi.setSystemTime(t0 + 7 * 24 * 60 * 60 * 1000 + 1000);
    _runCleanupForTesting();
    expect(getSeries(s.id)).toBeUndefined();
  });

  test("preserves series whose age is below TTL", () => {
    const s = createSeries(minimalBrief);
    _runCleanupForTesting();
    expect(getSeries(s.id)).toBeDefined();
  });
});
