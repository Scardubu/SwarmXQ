# Safety and control

SwarmX defaults to proposal-first, evidence-first, and rollback-aware behavior.

## Human review required

- high or critical risk changes
- secrets, credentials, tokens, and auth flows
- billing, payment, and financial paths
- migrations and production deploys
- destructive file, infra, or release actions
- agent roster or template changes that would broaden automation power

## Guardrails

- bounded refinement budgets
- sandboxed command execution where possible
- checkpointing during runs
- trace logging for every stage
- proposal storage before application
- low-risk auto-apply only when explicitly enabled
- generated skills stay in runtime-local catalogs so the base bundle remains auditable
- self-improvement candidates are staged before any deployment decision

## Recovery model

When the swarm encounters failures:

1. capture the failing evidence
2. preserve the run state
3. summarize the root cause candidate
4. write a memory entry
5. keep the change bounded
6. prefer rollback or a smaller patch over broad mutation

## Operator rule

Treat the output as a decision support system, not a blind release bot. Anything that could affect production, data, or access control should stay behind an approval boundary.
