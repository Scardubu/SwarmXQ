# benchmarking

Build repeatable baselines, compare variants, and track regressions over time.

- Triggers: benchmark, baseline, compare, measure, latency, throughput, regression, variant, score delta
- Stack: generic
- Owner: qa
- Weight: 4

## When to activate
- Before any performance optimization to establish a comparable baseline.
- When comparing two or more implementation variants on measurable criteria.
- When a regression needs to be confirmed or ruled out with evidence.

## Execution pattern

1. **Define the metric before running anything.** The metric must be specific (not "faster" — "p95 latency under 100 concurrent users"), measurable with available tooling, and stable across runs when no change is made.

2. **Control the environment.** Benchmarks must run against the same hardware class, OS state, data volume, concurrency level, and warm-up protocol. A benchmark that varies the environment measures the environment, not the code.

3. **Warm up before measuring.** JIT, cache population, and connection pool initialization skew cold-start numbers. Run at least one full warm-up iteration before recording.

4. **Run enough samples for statistical significance.** Minimum 30 iterations for stable metrics; more for high-variance workloads. Report: median, p95, p99, and standard deviation. A single-run result is anecdote.

5. **Compare like-for-like.** Both variants must run under identical conditions: same data, same hardware, same concurrency model. Anything differing between runs is a confound that invalidates the comparison.

6. **Record and version the benchmark artifact.** Benchmark configuration, seed data, and results belong in version control. A benchmark that cannot be reproduced is an observation, not evidence.

## Failure modes to avoid
- Benchmarking in production under real traffic (confounds with live load).
- Reporting averages only (hides tail latency issues).
- Treating a benchmark improvement as a real-world improvement without validating under realistic concurrency.

## Output contract
- Metric definition: what is measured and at what load level.
- Baseline result: median, p95, p99, stddev for the control variant.
- Comparison result: same metrics for each variant under test.
- Score delta: relative improvement or regression with statistical confidence note.
- Benchmark artifact: configuration and seed data reference for reproducibility.

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
