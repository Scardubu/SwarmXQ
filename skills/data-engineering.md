# data-engineering

Improve schemas, pipelines, query efficiency, and data observability.

- Triggers: data, pipeline, etl, schema, warehouse, ingestion, query, lineage, freshness, idempotent
- Stack: backend, generic
- Owner: platform
- Weight: 4

## When to activate
- Designing or modifying data pipelines, ETL jobs, or ingestion flows.
- Debugging data quality issues, freshness lag, or schema drift.
- Adding observability to an opaque pipeline.

## Execution pattern

1. **Version the schema and the contract together.** A schema change without a versioning and migration plan is a breaking change with deferred consequences. Every schema must carry: version, owner, expected freshness, null policy, and downstream consumers. Never change a schema without notifying its consumers.

2. **Enforce idempotency at every stage.** Every pipeline stage must be safely re-runnable: same input → same output, regardless of how many times it runs. A stage that is not idempotent is a partial-failure bomb. Implement with: natural keys for upsert, hash-based deduplication, or explicit idempotency tokens.

3. **Preserve lineage.** Every transformed record must be traceable to its source: origin system, ingestion timestamp, transformation version, and applied filters. Lineage is not optional decoration — it is the audit trail that makes debugging possible and compliance provable.

4. **Gate on data quality at entry.** Validate freshness, null rates, schema conformance, and referential integrity before the data enters the pipeline. A quality gate at entry is exponentially cheaper than debugging a corrupt downstream model.

5. **Instrument each stage.** Measure: row count in vs. out, rejection rate, processing latency, error rate, and freshness lag. Alert on anomalies — a pipeline that runs silently is a pipeline whose failures are silent.

6. **Design for recovery.** Every pipeline must have a defined checkpoint, replay window, and failure-isolation strategy. If a stage fails, the pipeline should be resumable from the last checkpoint — not require a full restart from the beginning.

## Failure modes to avoid
- Schema changes that break downstream consumers without migration paths.
- Pipelines that cannot be safely re-run after partial failure.
- Missing freshness SLOs that make stale data indistinguishable from current data.

## Output contract
- Schema delta: what changed, migration path, downstream impact.
- Idempotency guarantee: how re-runs are handled at each stage.
- Lineage map: source → transform → sink with versioning.
- Quality gate spec: what is checked at entry and what triggers rejection.
- Instrumentation additions: what is now measured and what alerts are set.

## Elite operating discipline
- Prefer the smallest useful action that still satisfies the objective.
- For non-trivial tasks, compare 2-3 internal variants, run one skeptical check, and keep the winner silently.
- Keep assumptions explicit, outputs directly usable, and failure signals short and concrete.
- Stop early when the requested boundary is satisfied; do not smuggle in unrelated improvements.

## Elite domain quality bar
- Protect the existing interface, user flow, and contract semantics.
- Optimize within the current architecture before proposing a redesign.
- Verify the change on the most relevant user-visible or system-level metric.
- Keep implementation and verification tightly coupled.
