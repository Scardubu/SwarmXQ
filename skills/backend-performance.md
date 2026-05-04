# backend-performance

Reduce latency, CPU, memory, and I/O waste in backend code and services.

- Triggers: latency, throughput, perf, cache, db, slow query, n+1, pool, timeout, memory leak
- Stack: backend
- Owner: platform
- Weight: 5

## When to activate
- Latency or throughput regression detected in traces or benchmarks.
- Cache hit rate below expectation or invalidation causing thundering herds.
- Database query time dominating request latency.
- Memory growth trending upward over time without release.

## Execution pattern

1. **Measure before touching anything.** Establish a baseline: p50/p95/p99 latency, throughput at load, memory at rest and under traffic, CPU utilization per hot path. An optimization without a baseline is a guess with extra steps.

2. **Locate the hottest bottleneck.** Profile — do not rely on intuition. 10% of code paths generate 90% of cost in most systems. Optimizing cold paths wastes time and creates debt without improving user-visible metrics.

3. **Eliminate N+1 patterns first.** N+1 queries are the highest-ROI fix in most backend systems. They compound: a 10x traffic increase turns a manageable N+1 into a database-killing pattern. Fix with eager loading, batching, or dataloader patterns.

4. **Audit cache discipline.** Check: TTL strategy, invalidation triggers, stampede mitigation (stale-while-revalidate, probabilistic early expiry, lock-based refresh). A cache without an invalidation strategy is a correctness liability.

5. **Right-size connection pools.** Tune to the database's concurrency ceiling, not the application's thread count. Oversized pools create queuing at the DB; undersized pools create queuing at the application.

6. **Prove the improvement.** Re-run baseline benchmark against the optimized version. Report delta in the same metric units. An optimization that cannot be measured did not happen.

## Failure modes to avoid
- Optimizing based on code appearance rather than profiler evidence.
- Caching responses containing mutable state without a coherence strategy.
- Reducing latency in one layer by shifting cost to another without measuring total end-to-end.

## Output contract
- Baseline: p50/p95/p99 before change, resource utilization at load.
- Bottleneck: the specific code path, query, or resource causing the most cost.
- Optimization applied: what changed, why, and blast radius.
- Post-change measurement: same metrics as baseline with delta stated.

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
