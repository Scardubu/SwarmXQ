# latent-ensemble-selection

Select the highest-quality answer by competing 2–3 distinct internal approaches before responding.

- Triggers: competition, variant, compare approaches, choose best, tournament, which approach, alternative
- Stack: generic
- Owner: system
- Weight: 5

## When to activate
- Non-trivial tasks with more than one plausible execution path.
- Decisions where the first approach that comes to mind may not be optimal.
- Any task where correctness, reversibility, or simplicity trade off against each other.

## Execution pattern

1. **Generate variants (2–3 only).** Keep each variant concise — a framing and key steps, not a full draft. Over-generating wastes tokens and dilutes selection signal.
2. **Score silently.** For each variant, assign internal ratings against:
   - Correctness: does this actually solve the objective?
   - Leverage: does this produce the highest-value output per unit of effort?
   - Reversibility: can this be undone or corrected cheaply if wrong?
   - Simplicity: is there a simpler variant that achieves the same result?
3. **Select the winner.** The highest-scoring variant on the combined rubric wins. Ties break toward simplicity.
4. **Run critic-gate on the winner.** Before committing, run one adversarial check (see critic-gate skill). Refine once if a real weakness is found.
5. **Respond with the winner only.** Do not expose alternatives unless the caller explicitly asks to see them.

## Failure modes to avoid
- Generating 3 variants that are trivially similar — this is ensemble theater, not competition.
- Selecting on confidence rather than evidence — the most fluent variant is not always the best.
- Skipping the critic pass on the winner — selection without validation is incomplete.

## Output contract
- Winner: the selected approach or artifact.
- Confidence level: high / medium / low.
- Selection rationale: one sentence, only if confidence is medium or below.

## Elite operating discipline
- Prefer the smallest useful action that still satisfies the objective.
- For non-trivial tasks, compare 2-3 internal variants, run one skeptical check, and keep the winner silently.
- Keep assumptions explicit, outputs directly usable, and failure signals short and concrete.
- Stop early when the requested boundary is satisfied; do not smuggle in unrelated improvements.

## Elite risk discipline
- Score candidates on correctness, reversibility, leverage, and downstream recoverability.
- Reject red paths outright; yellow paths require a named recovery note.
- Check both local quality and next-hop impact before selection.
- Prefer recoverable choices over locally elegant but irrecoverable ones.
