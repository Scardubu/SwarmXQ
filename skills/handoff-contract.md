# handoff-contract

Define and enforce explicit input/output contracts at every agent boundary.

- Triggers: handoff, contract, interface, schema, boundary, agent output, next agent, pass to, input expectation
- Stack: generic
- Owner: system
- Weight: 5

## When to activate
- Before dispatching output from one agent to the next.
- When designing a new workflow edge between two agents.
- When a downstream agent fails on unexpected input from an upstream agent.

## Execution pattern

1. **Define the output contract at the producing agent.** Every agent output must specify: the data structure (fields, types, required vs. optional), the completeness criterion (what "done" means for this output), and the failure shapes (what a non-success output looks like and how it must be handled). An output without a completeness criterion cannot be evaluated by the next agent.

2. **Define the input expectation at the consuming agent.** The consuming agent must specify: which fields it requires, what validation it applies at entry, and what happens when required fields are missing or malformed (halt / substitute with default / escalate). Input expectations that are implicit are mismatches waiting to happen.

3. **Verify the contract matches at the edge.** Before the workflow runs: compare the producing agent's output contract against the consuming agent's input expectation. Every required input field must be present in the output contract. Every optional input field must have a defined default behavior when absent.

4. **Use typed schemas when possible.** JSON Schema, TypeScript interfaces, or Pydantic models as the source of truth for handoff contracts. Prose descriptions of handoffs produce interpretation variance — typed schemas do not.

5. **Include error propagation rules.** What happens when the upstream agent emits an error instead of a successful output? The downstream agent must not assume it will only receive success shapes. Every handoff contract must define: error format, error routing (retry / escalate / halt), and the maximum acceptable retry count before escalation.

6. **Version the contract on breaking changes.** Any change to a handoff contract that removes a field, changes a type, or modifies the semantic meaning of a field is a breaking change. Breaking changes require: version bump, downstream agent update, and a defined migration window.

## Failure modes to avoid
- Implicit contracts defined only by the producing agent's observed behavior.
- Missing error shapes in the contract (downstream agents receive unexpected input under failure).
- Breaking contract changes deployed without notifying downstream consumers.

## Output contract
- Producing agent contract: output schema (fields, types, required/optional), completeness criterion, failure shapes.
- Consuming agent expectation: required fields, validation rules, missing-field behavior.
- Contract match verification: confirmed or conflicts identified.
- Error propagation rules: error format, routing, retry ceiling.
- Contract version: current version and breaking change policy.

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
