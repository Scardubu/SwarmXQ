# output-quality-gate

Final pre-response filter. Confirm the output directly answers the objective, is technically correct, and is the minimum sufficient response.

- Triggers: quality gate, final check, output gate, before respond, pre-response, output filter, is this right
- Stack: generic
- Owner: system
- Weight: 5

## When to activate
- As the final step in any agent's response pipeline, after latent-ensemble-selection and critic-gate.
- When confidence is medium or below and the output will propagate to downstream agents or memory.
- When the task type is high-stakes: architectural decisions, safety gates, skill promotions, evolution proposals.

## Execution pattern

1. **Check: does this directly answer the stated objective?** Not a related objective. Not a generalized version. The specific objective as stated. If the output answers a different (possibly better) question, that is scope drift — not a quality improvement.

2. **Check: is this technically correct?** Verify the output against known facts, defined contracts, and explicit constraints. Do not accept plausible-sounding outputs that have not been validated against the task requirements.

3. **Check: is this the minimum sufficient response?** Sufficient means: the caller can take the next action without requiring additional context from this agent. Minimum means: nothing in the output is present purely for appearance of thoroughness.

4. **Gate decision:**
   - All three checks pass → emit response.
   - One check fails → run one internal refinement pass, then re-check. If it passes: emit. If it still fails: emit with the failing check surfaced explicitly (e.g., `[Note: scope drift — answered X because Y was ambiguous]`).
   - Two or more checks fail → do not emit a full response. Return a scoped clarification or a partial answer bounded to what passes.

5. **Hard stop on hallucinated certainty.** If the output contains a confident factual claim that cannot be verified from available context, it must be qualified or removed. Confident-sounding wrong outputs are worse than uncertain correct ones.

## Failure modes to avoid
- Running this gate as a formality — it must produce a genuine gate decision, not a rubber stamp.
- Treating "plausible" as equivalent to "correct."
- Emitting a full response when two checks fail — this propagates low-quality outputs downstream.

## Output contract
- Gate result: PASS / PASS-WITH-NOTE / PARTIAL / BLOCK.
- Failing checks (if any): which of the three checks did not pass and why.
- Refined output: present only if the refinement pass was needed; replaces the original.

## Elite operating discipline
- Prefer the smallest useful action that still satisfies the objective.
- For non-trivial tasks, compare 2-3 internal variants, run one skeptical check, and keep the winner silently.
- Keep assumptions explicit, outputs directly usable, and failure signals short and concrete.
- Stop early when the requested boundary is satisfied; do not smuggle in unrelated improvements.

## Elite quality gate
- Separate objective, constraint, and success criterion before solving.
- Treat ambiguity, missing evidence, or boundary drift as blockers instead of reasons to expand scope.
- Escalate with the exact missing fact, violated assumption, or red-flag condition.
- Return the minimum sufficient answer or artifact, not a narrative about the process.

## Final gate note
- This is the last chance to stop a wrong answer before it propagates; block on mismatch, not on stylistic preference.
