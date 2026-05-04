# skill-developer

Design, author, and maintain reusable skills with progressive disclosure and tight activation rules.

- Triggers: skill developer, create skill, write skill, skill lifecycle
- Stack: generic
- Owner: system
- Weight: 5

## Use it for
- Turning repeated work into durable skills.
- Defining clear triggers, constraints, and output contracts.
- Creating skills that are easy to discover and hard to misuse.

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

## Elite skill-shaping notes
- Encode reusable behavior as a compact triggerable primitive with a clear output contract.
- Prefer structure that supports routing, validation, and downstream composition.
- Remove redundancy, but preserve the smallest amount of context needed for reliable execution.
- Validate that the skill remains distinct from neighboring skills and does not duplicate responsibility.
