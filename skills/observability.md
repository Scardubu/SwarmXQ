# observability

Improve logs, traces, metrics, and actionable run summaries.

- Triggers: trace, log, telemetry, debug, observability, alert, metrics, latency, SLO, dashboard
- Stack: generic
- Owner: platform
- Weight: 4

## When to activate
- Adding instrumentation to a new service or pipeline.
- Diagnosing why a failure was not detected until a user reported it.
- Reducing alert fatigue or improving alert actionability.

## Execution pattern

1. **Separate signals by type.** Metrics answer "is the system healthy?" — they require aggregation and work best for threshold alerting. Logs answer "what happened?" — they require search and work best for debugging. Traces answer "where did the time go?" — they require correlation and work best for latency analysis. Using the wrong signal type for a question produces misleading answers.

2. **Design alerts to be actionable.** Every alert must have: a clear trigger condition, a runbook or remediation action, and an owner. An alert that fires and says "something is wrong" without indicating what to do creates alert fatigue and on-call burnout. If you cannot write the runbook for an alert, the alert is not ready to go into production.

3. **Instrument at service boundaries.** The highest-value instrumentation points are the boundaries: HTTP ingress/egress, database calls, queue producers and consumers, external API calls. A service that is invisible at its boundaries cannot be debugged when it misbehaves.

4. **Guard cardinality.** High-cardinality labels (user IDs, request IDs, raw URL paths) in metrics will explode storage costs and query latency. Use them in traces and logs — not in metrics. Metrics labels should have bounded, predictable cardinality: service name, endpoint category, status code bucket, region.

5. **Align metrics to SLOs.** Every metric that feeds an alert should map to a user-impacting SLO: availability, latency, error rate, throughput. Metrics that do not map to a user-impacting outcome are interesting but should not page anyone.

6. **Write run summaries for long-running processes.** For pipelines, batch jobs, and agent runs: emit a structured summary at completion — records processed, errors encountered, time taken, and any anomalies detected. Summaries are the first thing responders read during an incident.

## Failure modes to avoid
- Alerts that fire without actionable runbooks (creates fatigue without improving MTTR).
- High-cardinality label values in metrics (causes storage and query cost explosions).
- Missing boundary instrumentation (makes the system a black box at its most important surfaces).

## Output contract
- Signal taxonomy: what is measured with metrics vs. logs vs. traces and why.
- Alert spec: trigger condition, runbook reference, owner, and severity for each new alert.
- Boundary instrumentation: which entry and exit points now have spans or log events.
- Cardinality audit: any new labels introduced and their cardinality assessment.
- SLO alignment: which SLO each new metric maps to.

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
