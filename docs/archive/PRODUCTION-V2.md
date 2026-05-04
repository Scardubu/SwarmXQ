# SwarmX v2 Production Notes

SwarmX v2 adds:
- durable runtime state at `.swarmx/state/runtime.json`
- append-only job queue at `.swarmx/queue/jobs.jsonl`
- append-only event journal at `.swarmx/traces/journal.jsonl`
- runtime metrics and health endpoints
- dashboard controls for plan, run, and evolve with live refresh

The system remains bounded:
- high-risk work still passes through the existing review gates
- queue and journal are additive; they do not replace run artifacts
- local-first execution remains the default
