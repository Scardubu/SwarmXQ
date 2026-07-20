import { randomUUID } from "node:crypto";
import type { LearningRecord, PerformanceSnapshot } from "@swarmx/types/video-types";
import { appendStateEvent, readSnapshot, writeSnapshot } from "./local-state-store.js";

const performanceSnapshots = new Map<string, PerformanceSnapshot>();
const learningRecords = new Map<string, LearningRecord>();
let hydrated = false;

function now(): string {
  return new Date().toISOString();
}

function hydrate(): void {
  if (hydrated) return;
  for (const snapshot of readSnapshot<PerformanceSnapshot>("performance-snapshots")) {
    if (snapshot?.id && snapshot.schemaVersion === 1) performanceSnapshots.set(snapshot.id, snapshot);
  }
  for (const record of readSnapshot<LearningRecord>("learning-records")) {
    if (record?.id && record.schemaVersion === 1) learningRecords.set(record.id, record);
  }
  hydrated = true;
}

export function listPerformanceSnapshots(): PerformanceSnapshot[] {
  hydrate();
  return [...performanceSnapshots.values()].sort(
    (left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt),
  );
}

export function recordPerformanceSnapshot(
  input: Omit<PerformanceSnapshot, "id" | "schemaVersion" | "observedAt"> & {
    observedAt?: string;
  },
): PerformanceSnapshot {
  hydrate();
  const snapshot: PerformanceSnapshot = {
    id: randomUUID(),
    schemaVersion: 1,
    observedAt: input.observedAt ?? now(),
    ...input,
  };
  performanceSnapshots.set(snapshot.id, snapshot);
  appendStateEvent("performance-snapshots", "create", snapshot);
  writeSnapshot("performance-snapshots", [...performanceSnapshots.values()]);
  return snapshot;
}

export function createLearningRecord(
  input: Omit<LearningRecord, "id" | "schemaVersion" | "createdAt" | "approvalState"> & {
    approvalState?: LearningRecord["approvalState"];
  },
): LearningRecord {
  hydrate();
  const record: LearningRecord = {
    id: randomUUID(),
    schemaVersion: 1,
    approvalState: input.approvalState ?? "pending",
    createdAt: now(),
    ...input,
  };
  learningRecords.set(record.id, record);
  appendStateEvent("learning-records", "create", record);
  writeSnapshot("learning-records", [...learningRecords.values()]);
  return record;
}

export function listLearningRecords(): LearningRecord[] {
  hydrate();
  return [...learningRecords.values()].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );
}

export function _clearCreativeFactoryAnalyticsForTesting(): void {
  performanceSnapshots.clear();
  learningRecords.clear();
  hydrated = false;
}
