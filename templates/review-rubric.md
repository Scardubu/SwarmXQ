# Review Rubric Template
# Version: 2026.04 · IEP-ELITE-MAX · v2.0
# Backward-compatible with all prior versions.

## Scoring dimensions (0–5 each; 0 = absent, 5 = exemplary)

| Dimension          | Weight | Score | Notes |
|--------------------|--------|-------|-------|
| Correctness        | 0.25   |       | Verified against evidence, not fluency |
| Safety             | 0.20   |       | Blast radius contained; rollback viable |
| Clarity            | 0.15   |       | Caller can act without follow-up questions |
| Completeness       | 0.15   |       | No critical edge cases unhandled |
| Measurability      | 0.15   |       | Success signal is observable and local |
| Rollback readiness | 0.10   |       | Rollback anchor registered and viable |

**Composite score** = Σ(score × weight). Minimum bar for promotion: **3.5 / 5.0**.

## IEP-ELITE quality checks (binary — pass/fail)

- [ ] Fix Log: CLEAN (no unresolved `[CRITICAL]` entries)
- [ ] Handoff contract: all receiver fields present and correctly typed
- [ ] Confidence gate: HIGH or MEDIUM (not LOW for any release-critical claim)
- [ ] Island convergence probe: EXPLOITATION mode (not stuck in convergence)
- [ ] Output Quality Gate §15: all three checks passed

## Hard rejection criteria (automatic fail, regardless of composite score)
- Output that cannot be validated locally.
- Blast radius wider than the original scope estimate without an explicit correction.
- Fix Log with ≥ 1 unresolved `[CRITICAL]` entry.
- Any claim that fails the confidence calibration check (μ-3).
- Rollback path documented but not verified.

## Reviewer notes
Use this field for causal observations — what specific evidence drove the scores
above. Scores without evidence are opinions, not reviews.
