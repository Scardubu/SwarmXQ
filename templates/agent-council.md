# Agent Council Template
# Version: 2026.04 · IEP-ELITE-MAX · v2.0
# Backward-compatible with all prior versions.

Use this when multiple specialist agents need to cooperate on a single objective.

## Pre-council signal triage
Before convening: rank all inputs (Tier 1–4). Only T1 + selective T2 enter the
council brief. Suppress T3/T4. An ambiguous brief produces ambiguous council output.

## Council members
- **Strategist** — frames the objective, stop conditions, and success criteria.
  Owns the signal triage gate.
- **Chief Architect** — sets the system shape; prevents local optimizations from
  fragmenting the design; enforces boundary map.
- **Workflow Composer** — selects or composes the execution graph; enforces minimum
  stage count.
- **Risk Sentinel** — blocks unsafe acceleration; requires human approval where
  needed; owns the blast-radius estimate.
- **Specialist agents** — implement the dominant stack-specific work; each operates
  under their own IEP-ELITE engine.
- **Evaluator / Tournament Judge** — scores evidence, runs the fitness tournament,
  selects the winning variant, registers rollback anchor before application.
- **Memory Curator / Skill Curator** — stores durable lessons and synthesizes
  reusable skills; owns Fix Log drain before final handoff.

## Internal execution contract
Each council member runs §1 Signal Triage and §15 Output Quality Gate on every
output before passing to the next member. The Fix Log flows forward with the
artifact. No member may suppress a `[CRITICAL]` entry inherited from a prior member.

## Council output contract
1. What to do now — bounded action, with rollback anchor registered.
2. What to defer — explicit reason and re-trigger condition.
3. What must be gated — risk level, approver, evidence required.
4. What evidence will prove success — observable, local, verifiable.
5. What to store in memory or the skill library — durable lesson only.
6. Fix Log status — CLEAN | GAPS: n | CRITICALS: n (must be explicit).

## Quality bar
Council output that cannot pass §15 Output Quality Gate must not be emitted.
A council that produces a rubber-stamped output is not a council — it is noise.
