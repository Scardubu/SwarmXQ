# tournament-selection

Rank candidate plans, proposals, or outputs by evidence quality, leverage, and safety. Select the strongest survivor.

- Triggers: architecture, workflow, skill, template, evidence, safety, compare candidates, rank options, which plan, best approach
- Stack: generic
- Owner: system
- Weight: 5

## When to activate
- Tournament Judge comparing multiple proposals or outputs.
- Evolver selecting which proposal to promote.
- Any agent choosing between 2+ plausible paths with non-trivial stakes.

## Execution pattern

1. **Lock the rubric before evaluating candidates.** The scoring dimensions must be fixed before any candidate is assessed. Changing the rubric mid-comparison introduces selection bias. Default rubric: correctness, leverage, simplicity, reversibility, evidence quality.

2. **Score each candidate independently.** Score in isolation against the rubric before comparing. This prevents anchoring — the first candidate reviewed should not implicitly set the scale for the others.

3. **Compare and rank.** Identify the margin between first and second place. A narrow margin (≤ 1 rubric point difference) is a signal: the task may need better candidates, not a forced pick between weak ones.

4. **Apply elimination criteria.** Any candidate that is:
   - Brittle under adversarial conditions
   - Under-validated (claims without evidence)
   - Unclear in its output contract
   ...is disqualified regardless of score. A weak survivor is worse than no selection.

5. **Select or escalate.** If a clear winner exists above the minimum bar → select and return.
   If no candidate clears the minimum bar → return "regenerate" signal, not a forced winner.

## Failure modes to avoid
- Selecting the most fluent candidate over the most correct one.
- Treating a narrow margin as a decisive win.
- Allowing post-hoc rationalization to change the rubric to fit a preferred candidate.

## Output contract
- Winner: candidate name or ID.
- Rationale: 1–2 sentences tied to the rubric, not rhetoric.
- Margin note: present only if the margin is narrow (≤ 1 point) or if no candidate cleared the bar.
- Next validation step: what must be verified before this selection is acted upon.

## Elite operating discipline
- Prefer the smallest useful action that still satisfies the objective.
- For non-trivial tasks, compare 2-3 internal variants, run one skeptical check, and keep the winner silently.
- Keep assumptions explicit, outputs directly usable, and failure signals short and concrete.
- Stop early when the requested boundary is satisfied; do not smuggle in unrelated improvements.

## Elite skill-shaping notes
- Encode reusable behavior as a compact triggerable primitive with a clear output contract.
- Prefer structure that supports routing, validation, and downstream composition.
- Remove redundancy, but preserve the smallest amount of context needed for reliable execution.
- Validate that the skill remains distinct from neighboring skills and does not duplicate responsibility.
