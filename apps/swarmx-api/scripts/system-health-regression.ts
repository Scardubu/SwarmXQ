import assert from "node:assert";
import {
  getSystemHealthLivenessTimeoutMs,
  getSystemHealthModelTimeoutMs,
  unavailableModelReadiness,
} from "../src/routes/system.js";

function withEnvironment<T>(key: string, value: string | undefined, action: () => T): T {
  const previous = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }

  try {
    return action();
  } finally {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
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

  console.log("PASS: system health uses bounded liveness/readiness budgets and explicit unreachable model state");
}

main();