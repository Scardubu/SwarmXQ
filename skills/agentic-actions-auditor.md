# agentic-actions-auditor

Audit GitHub Actions and agent integrations for security weaknesses.

- Triggers: actions audit, github actions, workflow security, agent security
- Stack: security, devops
- Owner: security
- Weight: 5

## Use it for
- Reviewing CI workflows that touch agent tooling.
- Catching unsafe secrets usage or overly broad tokens.
- Hardening automation before it reaches production.

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

## Elite augmentation
- Preserve the original interface, workflow, and external behavior.
- Make the smallest change that fully satisfies the stated objective.
- Validate the result against the most likely downstream consumer.
- Return only the artifact or decision this skill is meant to produce.
