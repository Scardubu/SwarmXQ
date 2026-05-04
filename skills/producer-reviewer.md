# producer-reviewer

Implement with a tight produce → review → revise → verify loop. One review pass. No sprawl.

- Triggers: producer reviewer, review loop, code review, merge, implement and review, patch, produce, diff, change
- Stack: generic
- Owner: engineering
- Weight: 5

## When to activate
- Any code change, config patch, or artifact that requires validation before it merges or propagates.
- Tasks where the first pass should be fast and the review pass should be genuinely skeptical.
- Changes that touch shared interfaces, contracts, or safety-adjacent surfaces.

## Execution pattern

1. **Producer pass — smallest safe slice.** The producer implements the minimum change that makes progress toward the objective. No scope creep. No speculative additions. Output: a concrete artifact with an evidence trail (what was changed, why, what it affects).

2. **Review pass — adversarial, not editorial.** The reviewer's job is not to improve the artifact — it is to find the ways it fails. Challenge: correctness (does this actually work?), safety (what breaks if this is wrong?), completeness (what is unhandled?), coupling (does this introduce hidden dependencies?). Return a concrete fix list, not style notes.

3. **Revise pass — one pass only.** The producer applies the fix list from the review. One revision. If the fix list requires more than one pass to resolve, the original scope was too wide — split the task.

4. **Verify pass.** Confirm the revised artifact satisfies the original acceptance criteria. Run any available deterministic checks (tests, linters, type checks). If no automated checks exist, verify manually against the output contract. Record the verification evidence.

5. **Gate on evidence, not confidence.** The loop closes when verification produces evidence of correctness, not when the producer or reviewer feels satisfied.

## Failure modes to avoid
- Review passes that return general praise with minor edits — these are not adversarial reviews.
- Multiple revision rounds that expand scope with each pass.
- Closing the loop without a verification step — "reviewed" is not "verified."

## Output contract
- Produced artifact: the change, with evidence notes (what changed, blast radius).
- Review findings: concrete fix list; nothing else.
- Revised artifact: change applied to fix list.
- Verification evidence: test results, check output, or explicit acceptance criteria match.

## Elite operating discipline
- Prefer the smallest useful action that still satisfies the objective.
- For non-trivial tasks, compare 2-3 internal variants, run one skeptical check, and keep the winner silently.
- Keep assumptions explicit, outputs directly usable, and failure signals short and concrete.
- Stop early when the requested boundary is satisfied; do not smuggle in unrelated improvements.

## Elite coordination notes
- Declare ownership, handoff contracts, and failure behavior before the first execution step.
- Prefer the smallest graph shape that covers the task; add cycles only for self-correction, checkpointing, or human-in-the-loop recovery.
- Use producer-reviewer splits instead of shared ownership when a stage needs both generation and critique.
- Simulate at least one downstream hop before committing to irreversible or cross-boundary actions.
