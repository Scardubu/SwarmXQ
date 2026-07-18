import assert from "node:assert";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getSystemHealthLivenessTimeoutMs,
  getSystemHealthModelTimeoutMs,
  readWarmupStatus,
  unavailableModelReadiness,
} from "../src/routes/system.js";
import { resetEnvForTesting } from "../src/lib/env.js";

function withEnvironment<T>(key: string, value: string | undefined, action: () => T): T {
  const previous = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  resetEnvForTesting();

  try {
    return action();
  } finally {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
    resetEnvForTesting();
  }
}

function main(): void {
  withEnvironment("SWARMX_SYSTEM_HEALTH_PROBE_TIMEOUT_MS", undefined, () => {
    assert.strictEqual(getSystemHealthLivenessTimeoutMs(), 1_500);
  });
  withEnvironment("SWARMX_SYSTEM_HEALTH_PROBE_TIMEOUT_MS", "125", () => {
    assert.strictEqual(getSystemHealthLivenessTimeoutMs(), 250);
  });
  withEnvironment("SWARMX_SYSTEM_HEALTH_MODEL_PROBE_TIMEOUT_MS", "25000", () => {
    assert.strictEqual(getSystemHealthModelTimeoutMs(), 10_000);
  });

  const unreachableModels = unavailableModelReadiness();
  assert.strictEqual(unreachableModels.length, 3);
  assert.ok(unreachableModels.every((model) => model.status === "error"));
  assert.ok(unreachableModels.every((model) => model.error === "Ollama unreachable"));

  // ── Warmup status reader (V6.2.26) ────────────────────────────────────────
  const tmpDir = mkdtempSync(join(tmpdir(), "swarmxq-warmup-"));
  const warmupPath = join(tmpDir, "warmup.json");

  // Case 1: file missing → default 140s cold ETA
  withEnvironment("SWARMX_WARMUP_STATUS_FILE", warmupPath, () => {
    const s = readWarmupStatus();
    assert.strictEqual(s.done, false);
    assert.strictEqual(s.coldStartEtaSecs, 140);
    assert.strictEqual(s.source, "default");
  });

  // Case 2: file says done=true → ETA 0, source=file
  writeFileSync(warmupPath, JSON.stringify({
    done: true,
    startedAt: "2026-07-18T12:00:00Z",
    completedAt: "2026-07-18T12:02:20Z",
  }));
  withEnvironment("SWARMX_WARMUP_STATUS_FILE", warmupPath, () => {
    const s = readWarmupStatus();
    assert.strictEqual(s.done, true);
    assert.strictEqual(s.coldStartEtaSecs, 0);
    assert.strictEqual(s.source, "file");
    assert.strictEqual(s.completedAt, "2026-07-18T12:02:20Z");
  });

  // Case 3: file says in-progress → coldStartEtaSecs decays from 140
  const startedAt = "2026-07-18T12:00:00Z";
  const startedMs = Date.parse(startedAt);
  writeFileSync(warmupPath, JSON.stringify({ done: false, startedAt }));
  withEnvironment("SWARMX_WARMUP_STATUS_FILE", warmupPath, () => {
    // 30s after start → 110s remaining
    const s = readWarmupStatus(startedMs + 30_000);
    assert.strictEqual(s.done, false);
    assert.strictEqual(s.coldStartEtaSecs, 110);
    assert.strictEqual(s.startedAt, startedAt);
  });

  // Case 4: warmup elapsed beyond 140s → ETA floored at 0
  withEnvironment("SWARMX_WARMUP_STATUS_FILE", warmupPath, () => {
    const s = readWarmupStatus(startedMs + 300_000);
    assert.strictEqual(s.coldStartEtaSecs, 0);
  });

  // Case 5: malformed JSON → default fallback
  writeFileSync(warmupPath, "{not-json");
  withEnvironment("SWARMX_WARMUP_STATUS_FILE", warmupPath, () => {
    const s = readWarmupStatus();
    assert.strictEqual(s.source, "default");
    assert.strictEqual(s.coldStartEtaSecs, 140);
  });

  unlinkSync(warmupPath);

  console.log("PASS: system health uses bounded liveness/readiness budgets, explicit unreachable model state, and warmup status file parsing");
}

main();