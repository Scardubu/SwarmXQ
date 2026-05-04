# test-stabilization

Repair flaky tests and strengthen deterministic verification.

- Triggers: test, flaky, ci, failure, regression, intermittent, non-deterministic, flakey, random failure
- Stack: generic
- Owner: qa
- Weight: 5

## When to activate
- A test failure cannot be consistently reproduced.
- CI is red on main without a corresponding code change.
- A test suite is producing false negatives (passing on broken code) or false positives (failing on correct code).

## Execution pattern

1. **Classify the flakiness root cause before fixing anything.** Flakiness has distinct causes that require distinct fixes. Classify before acting:
   - **Timing dependencies:** test relies on real time, sleep calls, or network latency → replace with deterministic waits or mocks.
   - **Shared state:** tests leak state into each other → fix with proper setup/teardown and test isolation.
   - **External dependencies:** test calls real APIs, databases, or services → replace with deterministic doubles (fakes, stubs, mocks).
   - **Non-deterministic ordering:** test output or execution order varies → fix seed values, sort outputs explicitly, make test order-independent.
   - **Resource contention:** tests compete for ports, files, or memory under parallel execution → fix resource allocation or test isolation.

2. **Reproduce the failure deterministically before fixing it.** A flaky test that cannot be reliably reproduced cannot be reliably fixed. Apply: reproduce with a tight loop (run 100 times), introduce an explicit seed, or reduce the timing window. Do not submit a fix for a flaky test if you cannot verify the fix eliminates the failure.

3. **Fix the isolation first.** Shared state between tests is the most common root cause of flakiness and the most insidious — it can manifest as failures in unrelated tests. Verify each test can run in isolation: in any order, with any subset of other tests active, with no state carried from a previous test.

4. **Replace non-deterministic dependencies with deterministic doubles.** Real network calls, real clocks, and real file system operations are non-deterministic under test conditions. Replace with: fake implementations, recorded responses (cassettes/VCR), or injectable clocks and file system abstractions. The test should only be non-deterministic if the behavior under test is non-deterministic.

5. **Add to the golden set.** Once stabilized: add the repro case to the deterministic golden set. A repro case that is not preserved as a regression test will be forgotten, and the flakiness will return.

6. **Validate stability.** After the fix: run the suite 50+ times and verify zero failures. One successful run after a fix is not evidence of stability — it may just be the failure probability falling below the single-run detection threshold.

## Failure modes to avoid
- Fixing a flaky test by adding a larger sleep or retry loop (this hides the root cause).
- Marking a test as skip instead of investigating the flakiness.
- Merging a flakiness fix without proving it eliminates the failure in repeated runs.

## Output contract
- Flakiness classification: root cause category and specific mechanism.
- Reproduction method: how to reliably trigger the failure.
- Fix applied: what changed and why it eliminates the root cause (not just the symptom).
- Isolation verification: evidence the test passes in isolation and in arbitrary test order.
- Stability evidence: run count × pass rate after the fix.

## Elite operating discipline
- Prefer the smallest useful action that still satisfies the objective.
- For non-trivial tasks, compare 2-3 internal variants, run one skeptical check, and keep the winner silently.
- Keep assumptions explicit, outputs directly usable, and failure signals short and concrete.
- Stop early when the requested boundary is satisfied; do not smuggle in unrelated improvements.

## Elite change-control notes
- Freeze the acceptance criteria or baseline before modifying behavior.
- Keep structural changes separate from behavioral changes.
- Verify the smallest safe slice, then expand only after the current slice is proven.
- Surface regressions, drift, and rollback risk immediately when they appear.
