# baseline-capture

Enforce measurement before any optimization, refactor, or change that claims improvement.

- Triggers: before change, baseline, measure first, pre-optimization, before refactor, capture state, establish baseline
- Stack: generic
- Owner: system
- Weight: 4

## When to activate
- Before any optimization that will be justified by performance improvement.
- Before a refactor that will be justified by reduced complexity.
- Before any change where "improvement" must be validated against a prior state.

## Execution pattern

1. **Capture the baseline before touching anything.** The baseline is the pre-change state against which the improvement will be measured. Capture it in the same environment, with the same tooling, and against the same data that will be used for the post-change measurement. A baseline captured in a different environment than the post-change measurement is not a valid baseline.

2. **Select the right metric for what is being claimed.** If the claim is "this is faster" — measure latency percentiles (p50, p95, p99), not averages. If the claim is "this is simpler" — measure cyclomatic complexity, function count, or line count, not subjective impression. If the claim is "this uses less memory" — measure heap allocation under load, not at rest. The metric must match the claim exactly.

3. **Record the baseline in a verifiable artifact.** The baseline numbers must be: written down before the change begins, stored somewhere the reviewer can see them, and reproducible using the same tooling described in the measurement notes. A baseline that exists only in the implementer's memory is not a baseline — it is a claim.

4. **Define the improvement threshold.** What delta constitutes a meaningful improvement? A 0.5% latency reduction on a 500ms baseline is noise. A 50ms reduction on a 500ms baseline is signal. Define the threshold before running the post-change measurement — defining it after creates motivated reasoning.

5. **Capture the post-change measurement identically.** After the change: repeat the baseline measurement in the same environment, with the same tooling, and against the same data. Any deviation from the baseline setup is a confound that makes the comparison invalid.

6. **Report the delta with context.** State: what was measured, the before and after values, the delta (absolute and relative), and the threshold that was defined upfront. If the delta does not meet the threshold: the change may still be valuable for other reasons, but do not claim an improvement that the data does not support.

## Failure modes to avoid
- Claiming improvement without a pre-change baseline (makes the claim unverifiable).
- Defining the improvement threshold after seeing the post-change numbers (motivated reasoning).
- Measuring in different environments before and after (the environment, not the code, may explain the delta).

## Output contract
- Baseline measurement: metric, value, environment, tooling, timestamp.
- Metric rationale: why this metric matches the improvement claim.
- Improvement threshold: the minimum delta that constitutes meaningful improvement.
- Post-change measurement: same fields as baseline measurement.
- Delta report: before, after, absolute delta, relative delta, and threshold verdict.

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

## Measurement note
- The baseline only counts if it is captured in the same environment, with the same data and tooling, before the change begins.
