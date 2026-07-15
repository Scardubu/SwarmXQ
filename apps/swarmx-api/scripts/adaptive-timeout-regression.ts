/**
 * Regression tests for the adaptive-timeout-config service.
 * Run with: tsx scripts/adaptive-timeout-regression.ts
 */
import assert from "node:assert";
import {
  getTimeout,
  withTimeout,
  createStreamGuard,
  circuitState,
  recordSuccess,
  recordFailure,
} from "../src/services/adaptive-timeout-config.js";

// ── getTimeout ────────────────────────────────────────────────────────────────

{
  // Returns a positive integer for every known operation at every pressure level
  const ops = [
    "intent_classify", "routing", "fast_chat", "tool_execution",
    "supervisor_planning", "code_generation", "deep_reasoning",
    "critic_audit", "evolver_observe", "evolver_critique",
    "evolver_mutate", "evolver_validate", "health_probe",
  ] as const;
  const pressures = ["low", "normal", "high", "critical"] as const;

  for (const op of ops) {
    for (const pressure of pressures) {
      const ms = getTimeout(op, pressure);
      assert.ok(ms > 0, `getTimeout(${op}, ${pressure}) must be > 0 (got ${ms})`);
      assert.ok(Number.isFinite(ms), `getTimeout(${op}, ${pressure}) must be finite`);
    }
  }
}

{
  // Timeouts decrease monotonically from low → critical pressure
  const ms_low      = getTimeout("deep_reasoning", "low");
  const ms_normal   = getTimeout("deep_reasoning", "normal");
  const ms_high     = getTimeout("deep_reasoning", "high");
  const ms_critical = getTimeout("deep_reasoning", "critical");
  assert.ok(ms_low >= ms_normal && ms_normal >= ms_high && ms_high >= ms_critical,
    "deep_reasoning timeout must decrease low → critical");
}

{
  // health_probe must always be among the shortest timeouts
  const healthNormal = getTimeout("health_probe", "normal");
  const reasonNormal = getTimeout("deep_reasoning", "normal");
  assert.ok(healthNormal < reasonNormal, "health_probe must be shorter than deep_reasoning");
}

// ── withTimeout ───────────────────────────────────────────────────────────────

{
  // Resolves immediately when the promise resolves before the timeout
  const result = await withTimeout(Promise.resolve("result"), 5_000, "test_ok");
  assert.strictEqual(result, "result");
}

{
  // Rejects when the promise exceeds the timeout
  const slow = new Promise<never>((resolve) => setTimeout(() => resolve("late"), 5_000));
  try {
    await withTimeout(slow, 10, "test_timeout");
    assert.fail("withTimeout should have rejected");
  } catch (err) {
    assert.ok(
      err instanceof Error && err.message.includes("test_timeout"),
      "rejection message must include the operation label",
    );
  }
}

// ── createStreamGuard ─────────────────────────────────────────────────────────

{
  // Invokes onTimeout after inactivity and can be cancelled before firing
  let fired = false;
  const guard = createStreamGuard(50, "test_stream", () => { fired = true; });

  // Wait less than the timeout — should not fire
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(fired, false, "guard should not fire before timeout");

  // Cancel — should never fire
  guard.cancel();
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(fired, false, "guard must not fire after cancel");
}

{
  // Fires when not cancelled
  let firedLabel: string | undefined;
  const guard = createStreamGuard(30, "stream_fire_test", (lbl) => { firedLabel = lbl; });

  await new Promise((r) => setTimeout(r, 80));
  guard.cancel();
  assert.strictEqual(firedLabel, "stream_fire_test", "guard must fire with the correct label");
}

// ── Circuit Breaker ───────────────────────────────────────────────────────────

{
  // Fresh circuit is closed
  const tag = "route-phi4-lite-q4km-prod";
  assert.strictEqual(circuitState(tag), "closed", "new circuit must start closed");
}

{
  // Enough failures open the circuit
  const tag = "instruct-phi4-pro-q8-prod-test-trip";
  for (let i = 0; i < 10; i++) recordFailure(tag);
  assert.strictEqual(circuitState(tag), "open", "circuit must open after repeated failures");
}

{
  // Closed circuit tolerates a success without tripping
  const tag = "code-qwen25-pro-q5km-prod-test-ok";
  recordSuccess(tag);
  assert.strictEqual(circuitState(tag), "closed", "success must not open a healthy circuit");
}

console.log("PASS: adaptive-timeout-config — all assertions passed");
