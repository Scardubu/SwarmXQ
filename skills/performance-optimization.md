# performance-optimization

Improve CPU, render, memory, and network budgets across frontend and backend.

- Triggers: performance, budget, cpu, memory, network, render, bundle, fps, lcp, cls, inp
- Stack: frontend, backend, devops
- Owner: platform
- Weight: 4

## When to activate
- Core Web Vitals regression (LCP, INP, CLS) detected after a release.
- CPU or memory budget exceeded in production profiling.
- Network payload size increase causing load time regression.

## Execution pattern

1. **Establish a budget before optimizing.** Define the acceptable ceiling for each dimension: bundle size (kB gzipped), LCP target (ms), memory ceiling at steady state, CPU time per interaction (ms). Optimization without a budget produces diminishing returns with no defined stopping point.

2. **Profile before touching code.** Use the appropriate profiling tool for the surface: Chrome DevTools Performance panel for rendering, Lighthouse for Core Web Vitals, node --prof or clinic.js for backend CPU, heap snapshots for memory. Never optimize based on "this looks expensive" — instruments first.

3. **Eliminate the largest cost first.** For bundle size: identify the largest unused dependency. For rendering: identify the component re-rendering on every frame. For memory: identify the largest retained object tree. The largest single item almost always outweighs the sum of all smaller items.

4. **Apply targeted micro-optimizations last.** Memoization, lazy loading, code splitting, and virtualization are effective — but only after the architectural bottlenecks are resolved. Applying them to a fundamentally expensive component defers the problem rather than solving it.

5. **Measure the improvement against the baseline.** Re-run the profiler. Compare against the pre-optimization baseline in the same environment, same data, same concurrency. Report the delta as a concrete number, not as a percentage improvement on an unmeasured baseline.

6. **Validate no regression on correctness.** Performance optimizations that break correctness are not improvements — they are defects that happen to be fast. Run the test suite before declaring the optimization complete.

## Failure modes to avoid
- Optimizing by feel ("this loop looks slow") instead of by profiler evidence.
- Applying memoization everywhere (incorrect memoization is worse than no memoization).
- Shipping a performance improvement that broke a test and was not caught.

## Output contract
- Budget definition: the ceiling for each dimension being optimized.
- Profiler evidence: what was measured before the change (screenshot, trace, or numbers).
- Optimization applied: what changed and why it addresses the measured bottleneck.
- Post-change measurement: same metric as before with delta stated.
- Correctness validation: test results confirming no regression.

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
