# context7-auto-research

Fetch current documentation and version-sensitive guidance before making changes.

- Triggers: context7, latest docs, current docs, library docs
- Stack: generic
- Owner: research
- Weight: 5

## Use it for
- Fast-moving libraries and frameworks.
- API changes that may have shifted since the last release.
- Converting fresh docs into implementation notes.

## Execution pattern
- Prefer the smallest useful action.
- Compare 2-3 internal variants only when the task is non-trivial.
- Run one skeptical check for edge cases, missing evidence, and simpler alternatives.
- Keep the result concise, deterministic, and directly usable.

## Elite operating discipline
- Prefer the smallest useful action that still satisfies the objective.
- For non-trivial tasks, compare 2-3 internal variants, run one skeptical check, and keep the winner silently.
- Keep assumptions explicit, outputs directly usable, and failure signals short and concrete.
- Stop early when the requested boundary is satisfied; do not smuggle in unrelated improvements.

## Elite domain guardrails
- Preserve least-privilege, contract stability, and auditability.
- Validate inputs, assumptions, and side effects against the intended boundary.
- Prefer traceable sources, explicit configuration, and deterministic outcomes.
- Block or narrow the change when it increases attack surface, ambiguity, or hidden coupling.
