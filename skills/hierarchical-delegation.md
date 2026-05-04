# hierarchical-delegation

Delegate recursively from supervisor to specialists and synthesize the result.

- Triggers: hierarchical delegation, delegate, supervisor
- Stack: generic
- Owner: system
- Weight: 5

## Use it for
- Large tasks with nested subproblems.
- Multi-step work that needs a central coordinator.
- Clean handoffs between manager and specialist agents.

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

## Elite coordination notes
- Declare ownership, handoff contracts, and failure behavior before the first execution step.
- Prefer the smallest graph shape that covers the task; add cycles only for self-correction, checkpointing, or human-in-the-loop recovery.
- Use producer-reviewer splits instead of shared ownership when a stage needs both generation and critique.
- Simulate at least one downstream hop before committing to irreversible or cross-boundary actions.
