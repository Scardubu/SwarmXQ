# signal-triage

Rank all inputs by decision-relevance before solving. Ignore low-value signals. Focus on what changes the output.

- Triggers: triage, signal, prioritize inputs, context dilution, what matters, rank inputs, focus, filter context
- Stack: generic
- Owner: system
- Weight: 5

## When to activate
- Before any non-trivial planning, routing, or evaluation task.
- When the input contains a large or mixed context where not all signals are equally relevant.
- When a previous run produced a diluted or unfocused output — retroactively apply to identify what noise was processed as signal.

## Execution pattern

1. **Extract the decision-critical inputs.** Identify: the objective (what must be true when done), the primary constraint (what cannot be violated), and the success criterion (what observable state constitutes done). These are Tier 1 signals. Everything else is downstream.

2. **Classify remaining inputs.** For each remaining input signal:
   - **Tier 2 — Supporting:** adds context that improves the quality of the primary decision (stack details, prior run outcomes, risk flags).
   - **Tier 3 — Background:** true but irrelevant to the current decision (general best practices, organizational history, broad context that doesn't change the output).
   - **Tier 4 — Noise:** contradictory, stale, or out-of-scope. Actively suppress — do not include in reasoning even implicitly.

3. **Confirm the objective is unambiguous before proceeding.** If the Tier 1 objective is unclear, fix it before touching Tier 2 or 3 inputs. Building a precise plan on an ambiguous objective produces precise-looking garbage.

4. **Proceed with Tier 1 + selective Tier 2 only.** Do not surface Tier 3 in the output. Do not reference Tier 4 at all. Context dilution — treating all inputs as equal — is the primary cause of unfocused agent outputs.

## Failure modes to avoid
- Processing all context uniformly because "more context is safer" — this is the root cause of diluted plans.
- Spending reasoning budget on Tier 3 inputs to appear thorough.
- Allowing a noisy input to persist in reasoning because it came from a high-authority source.

## Output contract
- Tier 1 signals: objective, primary constraint, success criterion.
- Tier 2 signals: selected supporting context (brief, one line each).
- Suppressed signals: count only; no detail (prevents them from re-entering reasoning).
- Proceed signal: confirmation that the objective is unambiguous and reasoning can begin.

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
