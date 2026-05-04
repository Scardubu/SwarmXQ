# workflow-routing

Pick the highest-leverage workflow and budget before execution.

- Triggers: workflow, route, budget, planner, how to approach, what workflow, execution plan, which path
- Stack: generic
- Owner: system
- Weight: 5

## When to activate
- Before starting any multi-stage task where the wrong workflow shape would waste a full run.
- When the objective contains ambiguity that would cause different agents to choose different paths.
- When budget or time constraints require the most efficient path selection upfront.

## Execution pattern

1. **Extract the objective verb and stack signal.** The objective verb (implement, review, fix, design, analyze, research) determines the workflow class. The stack signal (backend, frontend, devops, generic) determines which specialists are needed. Do not route before these two signals are clear.

2. **Classify the task complexity.** Three tiers:
   - **Simple** (one agent, one pass): a single well-defined output with clear acceptance criteria.
   - **Medium** (2–3 stages, linear): requires sequential steps with handoffs but no parallelism or cycles.
   - **Complex** (multi-agent, cyclic, or parallel): requires coordination, fan-out/fan-in, or self-correction loops.
   Never assign a complex workflow to a simple task — the coordination overhead costs more than it saves.

3. **Select the minimum viable workflow.** Map the task to the smallest workflow that can produce the required output at the required quality level. Resist adding stages for completeness — over-specified workflows have more failure points, not fewer. Every additional stage is an additional handoff failure opportunity.

4. **Set the budget at entry.** Define before dispatching work: iteration ceiling per stage, maximum refinement passes, and a total token/time budget for the run. Budget enforcement at entry prevents over-run; budget enforcement at exit allows one over-run per stage.

5. **Define stop conditions explicitly.** Every workflow must have at least one explicit stop condition: evidence threshold met, iteration ceiling reached, or risk gate triggered. A workflow without a stop condition runs until it consumes all available budget.

6. **Return the routing decision with a rationale.** The rationale must explain why this workflow wins over the next-best alternative. This allows the Strategist or caller to override with context the router does not have.

## Failure modes to avoid
- Routing to a complex workflow because the objective is vague (constrain the objective first).
- Adding stages "just in case" (inflates the run graph without improving coverage).
- Setting budgets after work is dispatched (makes the ceiling advisory rather than enforced).

## Output contract
- Workflow selection: name and shape (simple / medium / complex).
- Stage map: ordered stages with owner agent and input/output contract per stage.
- Budget allocation: iteration ceiling and refinement pass ceiling per stage.
- Stop conditions: explicit, not "the agent will decide when it's done."
- Routing rationale: why this workflow wins over the next-best alternative.

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
