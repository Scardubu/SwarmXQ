# autonomy-ops

Route work, maintain bounded control loops, and enforce system coherence in autonomous runs.

- Triggers: autonomous, agent, orchestration, loop, route, control plane, bounded, stop condition, handoff
- Stack: generic
- Owner: system
- Weight: 5

## When to activate
- Strategist decomposing work into agent-owned stages.
- Workflow Composer selecting and sequencing a run graph.
- Any autonomous loop that requires explicit stop conditions and budget enforcement.

## Execution pattern

1. **Establish stop conditions before the loop starts.** Every autonomous sequence must have at least one explicit stop condition: iteration ceiling, evidence threshold, or risk gate. A loop without a stop condition is a safety boundary violation waiting to happen.

2. **Assign clear ownership per stage.** Each stage must have exactly one owning agent. Shared ownership without a tiebreaker produces conflicting outputs and stalled handoffs. If two agents are needed for one stage, use a producer-reviewer split — not joint ownership.

3. **Enforce budget at entry, not exit.** Check the iteration budget and refinement pass ceiling before dispatching work, not after. Budget enforcement at exit allows one round of over-run every time. Budget enforcement at entry prevents it.

4. **Validate handoffs.** Before passing output from stage N to stage N+1, confirm: does the output contract of stage N match the input expectation of stage N+1? A mismatched handoff is a silent failure — the receiving agent will proceed on a malformed input without raising an error.

5. **Route escalations immediately.** When any stage produces a risk signal, ambiguity flag, or out-of-scope result, route to the risk-sentinel or strategist immediately. Do not buffer escalations until the end of the loop — a late escalation is a missed gate.

## Failure modes to avoid
- Loops that rely on the agent to self-terminate — this always produces over-runs.
- Handoffs that pass state blobs without explicit contracts — the receiver must not have to infer what it received.
- Budget checks that happen after work is dispatched — this makes the ceiling advisory, not enforced.

## Output contract
- Routing decision: which workflow and which agent owns each stage.
- Stop conditions: explicit, not "the agent will decide when it's done."
- Budget allocation: iteration ceiling and refinement pass ceiling per stage.
- Escalation paths: which signal routes to which agent.

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
