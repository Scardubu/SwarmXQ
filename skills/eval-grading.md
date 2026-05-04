# eval-grading

Design rubrics, scorecards, and trace-grade criteria that produce deterministic, evidence-based evaluation signals.

- Triggers: rubric, scorecard, grading, eval, acceptance criteria, trace grade, quality gate, pass/fail, benchmark
- Stack: generic
- Owner: system
- Weight: 5

## When to activate
- Evaluator agent grading a produced artifact.
- Designing acceptance criteria for a new task type.
- Diagnosing inconsistent or speculative evaluations.

## Execution pattern

1. **Anchor the rubric to observable evidence.** Every rubric dimension must be evaluable against something that exists in the output — not the agent's stated confidence, not stylistic preference, not intent. Observable criteria include: presence of required output fields, logical consistency of claims, coverage of stated acceptance criteria, absence of known failure signatures.

2. **Calibrate dimension weights.** Not all dimensions carry equal weight. Correctness outweighs style. Safety outweighs completeness. Missing a required field outweighs suboptimal wording. Make the weighting explicit — unlabeled rubrics produce inconsistent grading across runs.

3. **Define explicit pass thresholds.** "Good enough" is not a threshold. For each dimension: what score is a pass, what score is a conditional pass requiring one fix, and what score is a reject. Binary dimensions (pass/fail) are preferred over 5-point scales when the distinction at the middle is ambiguous.

4. **Add failure signature recognition.** For recurring task types, enumerate the 3–5 most common failure modes. Encode these as rapid-disqualification checks before the full rubric run. This accelerates grading and prevents speculative passes of obviously broken outputs.

5. **Require a corrective action, not just a verdict.** A scorecard that returns reject without a concrete next step forces the executor to interpret the failure. Every non-pass verdict must include: what is wrong, where to find it in the output, and the minimum fix required to re-submit.

## Failure modes to avoid
- Rubrics with dimensions that cannot be evaluated without re-running the task.
- Pass/fail thresholds set so low that they never reject anything.
- Grading the agent's confidence instead of the output's evidence.
- Returning a verdict without a corrective action — this creates stalled loops.

## Output contract
- Rubric: dimensions, observable criteria, weights, pass thresholds.
- Scorecard: dimension scores, weighted total, verdict (PASS / CONDITIONAL / REJECT).
- Corrective action: required only for CONDITIONAL or REJECT; one concrete fix per failing dimension.
- Failure signature hits: list any rapid-disqualification criteria that fired.

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
