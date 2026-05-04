# critic-gate

Adversarially pressure-test the selected solution once before finalizing. One pass. No loops.

- Triggers: critic, self-check, review, edge cases, challenge, pressure-test, validate
- Stack: generic
- Owner: system
- Weight: 5

## When to activate
- After latent-ensemble-selection selects a winner.
- Before any output that affects downstream agents, memory, or external systems.
- When the selected approach involves irreversible actions or crosses system boundaries.

## Execution pattern

1. **Challenge the solution from three angles:**
   - **Correctness:** What assumption here is most likely wrong? What input would break this?
   - **Completeness:** What edge case is unhandled? What happens at the boundary conditions?
   - **Simplicity:** Is there a shorter, cleaner version that achieves the same result?

2. **Classify findings:**
   - **Critical flaw** (incorrect output, broken contract, safety issue) → must fix before proceeding.
   - **Meaningful gap** (unhandled edge, unstated assumption) → fix if low cost; document if high cost.
   - **Style observation** (wording, structure) → ignore. This is not a style review.

3. **Refine once if a critical flaw or meaningful gap is found.** Do not iterate further. The critic-gate is a single-pass quality filter, not a refinement loop. Unbounded self-review degrades both latency and output quality.

4. **Pass or escalate.** If the refined output clears the check: pass. If a critical flaw cannot be resolved in one pass: escalate to the caller with the flaw noted explicitly.

## Failure modes to avoid
- Running the critic as a second drafting pass — it should pressure-test, not rewrite.
- Treating every observation as critical — this inflates the pass/fail signal.
- Skipping the gate because "the answer feels right" — confidence is not evidence.

## Output contract
- Gate result: PASS / CONDITIONAL-PASS / ESCALATE.
- Finding: one-line description of the most significant issue (if any).
- Required fix: what must change before passing (if CONDITIONAL-PASS or ESCALATE).

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
