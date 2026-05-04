# skill-check

Validate skills against structure, naming, and behavior expectations before publication.

- Triggers: skill check, validate skill, agentskills, skill authoring
- Stack: generic
- Owner: system
- Weight: 5

## Use it for
- Checking for broken front matter or malformed metadata.
- Catching ambiguous triggers and duplicate responsibilities.
- Recommending the smallest correction that restores quality.

## Execution pattern
- Prefer the smallest useful action.
- Compare 2-3 internal variants only when the task is non-trivial.
- Run one skeptical check for edge cases, missing evidence, and simpler alternatives.
- Keep the result concise, deterministic, and directly usable.



## Output contract
- Return the decision or artifact directly.
- Include only the minimal evidence needed to trust it.
- Keep assumptions explicit when certainty is incomplete.

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

## Validation note
- Check the smallest thing that can fail: metadata, naming, trigger clarity, behavior overlap, and output contract integrity.
