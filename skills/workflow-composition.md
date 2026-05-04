# workflow-composition

Compose the best execution graph from specialist agents.

- Triggers: architecture, workflow, skill, template, evidence, safety, compose, graph, orchestrate, sequence
- Stack: generic
- Owner: system
- Weight: 5

## When to activate
- Assembling a multi-agent run from a routing decision.
- Auditing a workflow graph for unnecessary stages, missing handoff contracts, or ownership gaps.
- Designing a new workflow pattern for a recurring task type.

## Execution pattern

1. **Lock stage ownership before defining data flow.** Every stage must have exactly one owning agent. Shared ownership produces conflicting outputs and stalled handoffs. If two agents are needed for one stage: use a producer-reviewer split — not joint ownership.

2. **Define handoff contracts explicitly.** Every edge in the workflow graph requires: the output schema of the upstream stage (what it produces), the input expectation of the downstream stage (what it accepts), and the failure behavior when the upstream output does not match (escalate / retry / halt). An undeclared handoff contract is a silent failure waiting to happen.

3. **Select runtime shape by task nature.** Apply the smallest shape that covers the objective:
   - Linear pipeline → sequential stages, each producing a clean artifact for the next.
   - Review loop → producer-reviewer cycle with a defined revision ceiling.
   - Parallel fan-out → independent subproblems computed concurrently, merged at fan-in.
   - Cyclic graph (LangGraph) → when self-correction, checkpointing, or human-in-the-loop is required.
   - Crew (CrewAI) → when the work is naturally decomposable into specialist roles with delegation.

4. **Verify no stage is duplicating another's work.** Every stage in the workflow must have a unique responsibility that cannot be absorbed into an adjacent stage without increasing its complexity. Duplicate responsibilities create inconsistent outputs and ambiguous ownership at the merge point.

5. **Define the halt condition at the graph level.** Who has authority to halt the workflow? What signals trigger a halt? What is the state of the system when the workflow halts mid-run? A workflow without a halt authority and a halt state definition is a workflow that does not know how to fail safely.

6. **Validate the composition before dispatching.** Walk through the graph: does each stage's output contract satisfy the next stage's input contract? Are all stop conditions reachable? Can the workflow be interrupted at any stage and produce a useful partial artifact? If any of these answers is no — fix the composition before dispatching agents.

## Failure modes to avoid
- Workflows where two stages share responsibility for the same output (produces conflicts at merge).
- Handoff contracts that are described in prose rather than defined as schemas.
- Workflows that can run indefinitely because the halt condition depends on agent judgment.

## Output contract
- Stage map: ordered stages with owning agent, input schema, output schema.
- Handoff contracts: edge definitions with failure behavior per edge.
- Runtime shape: the orchestration pattern selected and why it fits.
- Halt conditions: who can halt, what triggers a halt, system state at halt.
- Composition validation: confirmation that all input/output contracts across edges are satisfied.

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

## Composition note
- Represent the workflow as an explicit graph, not as prose, whenever the path includes parallelism, review loops, or checkpoints.
