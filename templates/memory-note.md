# Memory Note Template
# Version: 2026.04 · IEP-ELITE-MAX · v2.0
# Backward-compatible with all prior versions.

## Cold-retrieval test
Before storing: answer this question cold — "If I receive only this note 30 days
from now, can I act on it without the original context?" If no → rewrite until yes.
Notes that fail the cold-retrieval test are not memories — they are noise.

## Required fields
- **kind:**         [lesson | pattern | failure | evolution-applied | skill-promoted |
                    blocking-pattern | test-failure | decision | other]
- **summary:**      [≤ 2 sentences. What changed and why it mattered.]
- **tags:**         [2–5 tags: stack, workflow, agent, failure-mode, etc.]
- **run_id:**       [Source run identifier for traceability.]
- **created_at:**   [ISO-8601 UTC]

## Capture only durable lessons

**What changed** — the specific behavior, config, or pattern that shifted.

**Why it worked or failed** — root cause, not surface symptom. If the cause is
unknown, say so explicitly. An invented cause is worse than an unknown one.

**Which stack patterns repeated** — observable recurring behavior worth encoding
into a skill or routing rule.

**Which skill should be reused next time** — specific skill name, or "none if no
reusable pattern emerged."

**Island winner (if applicable)** — if this lesson came from a multi-island ensemble
run, record which island (A/B/C) produced the winning strategy. Supports
PromptBreeder self-referential evolution.

## Anti-patterns — never store these
- Observations that will be stale within 1 week (temporary states, not patterns).
- Claims that cannot be verified from the run artifacts.
- Lessons already present in the skill catalog (duplication check required before
  storage).
- Any note that fails the cold-retrieval test above.
