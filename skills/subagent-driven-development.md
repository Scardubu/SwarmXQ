# subagent-driven-development

Split implementation into independent subagents and merge the results cleanly.

- Triggers: subagent, independent tasks, baton pass
- Stack: generic
- Owner: engineering
- Weight: 5

## Use it for
- Parallelizable implementation tasks.
- Keeping each subagent narrowly scoped.
- Merging the outputs through a clear coordinator.

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
