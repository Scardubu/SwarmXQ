# skill-router

Route ambiguous objectives to the most effective skill set and workflow shape. Never guess; never over-specify.

- Triggers: skill, router, choose skill, where to start, route, which workflow, what skill, how to approach
- Stack: generic
- Owner: system
- Weight: 5

## When to activate
- Task objective does not obviously map to a single skill or workflow.
- Multiple skills could plausibly apply and the wrong choice wastes a full run.
- Stack detection returns multiple candidate stacks and the overlap is non-trivial.

## Execution pattern

1. **Extract the primary signal.** Before routing, identify: the objective verb (implement, review, fix, design, analyze), the stack signals, and the risk surface. These three inputs determine the routing space. Ignore everything else at this stage.

2. **Generate a candidate skill set (2–3 options).** For each candidate set, estimate: coverage (does this skill set address the full objective?), risk alignment (does it trigger the right gates for the risk surface?), and minimum viable stage count (how many stages does it require?). Prefer the set with the lowest stage count that still covers the objective.

3. **Select the minimum viable workflow.** Match the winning skill set to the smallest workflow that can run it. Resist the instinct to add stages for completeness — over-specified workflows have more failure points, not fewer.

4. **Ask one clarifying question if ambiguity blocks routing.** One question, scoped to the single most load-bearing ambiguity. Not a list. The question should resolve the routing decision, not gather background.

5. **Return the routing decision with rationale.** The rationale must explain why this skill set wins over the next-best alternative. "It seemed right" is not a routing rationale.

## Failure modes to avoid
- Routing to a broad workflow because the objective is vague — constrain the objective first.
- Adding skills to a routing decision "just in case" — this inflates the run graph without improving coverage.
- Treating all stacks as equal weight when one dominates the objective signal.

## Output contract
- Recommended skill set: names and brief per-skill justification.
- Recommended workflow: name and why it fits.
- Routing rationale: why this combination wins over the next-best alternative.
- Clarifying question: present only if one load-bearing ambiguity cannot be resolved from context.

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

## Routing note
- When multiple skills are plausible, route to the one that minimizes reversal cost and handoff ambiguity, not the one that sounds most specific.
