# multi-agent-orchestrator

Compose dynamic orchestration graphs on demand. This skill operates at the meta-level:
it reads the mission, selects the minimum sufficient agent graph, wires execution contracts,
manages state hand-offs, and governs convergence. It is the conductor, not a player.

- **Triggers:** orchestrate, multi-agent, compose agents, build workflow, agent graph, who should work on this, which agents, coordinate agents, multi-step mission, agent coordination
- **Stack:** generic
- **Owner:** system
- **Weight:** 5
- **Policy level:** medium (orchestration itself is low-risk; delegated work may escalate)
- **SwarmX primitives:** `{{mission}}`, `{{context}}`, `{{memory_summary}}`, `{{policy_level}}`, `{{delta}}`, `{{evolution_proposal}}`

---

## When to activate

- When a mission exceeds the capacity of a single agent or skill.
- When `workflow-routing` cannot find a pre-existing workflow that covers the mission shape.
- When `dynamic-team-factory` has produced a team blueprint and requires runtime orchestration.
- When an autonomous run requires adaptive routing based on intermediate results.
- As the coordinating layer for any `swarm run --autonomous` mission.

---

## Orchestration protocol

### Phase 1 · Mission decomposition

Break the mission into atomic subtasks:

```
subtask_graph:
  - id:          [t-01]
    objective:   [specific, bounded, completable subtask]
    depends_on:  [t-N, or "none"]
    parallelizable: [yes | no]
    assigned_to: [agent-name or "to-be-routed"]
    risk:        [low | medium | high]
```

Decompose until each subtask is:
- Assignable to a single agent or skill
- Completable without intermediate human decision
- Bounded (has a stop condition)

### Phase 2 · Agent routing

For each subtask, select the optimal agent from `agents/catalog.yaml`:

```
routing_decision:
  task_id:     [t-01]
  agent:       [selected agent name]
  rationale:   [one sentence: why this agent over alternatives]
  skill:       [primary skill to invoke]
  fallback:    [secondary agent if primary is unavailable or fails]
  model_tier:  [fast | reason | code — based on task complexity]
```

Apply `expert-pool` skill for routing when the task set is diverse.

### Phase 3 · State and handoff management

Define the shared state object that flows through the graph:

```
shared_state:
  mission_id:  [{{mission}}]
  context:     [{{context}}]
  memory_ref:  [{{memory_summary}} pointer]
  stage_outputs: {}  # populated at runtime
  fix_log:     []    # CRITICAL/GAP entries accumulated across agents
  iteration:   0     # current iteration count
  max_iter:    [configured ceiling from autonomy-ops]
```

For each agent handoff:
```
handoff:
  from:           [agent A]
  to:             [agent B]
  payload:        [exact keys from shared_state passed to agent B]
  contract:       [schema or type-level validation]
  validation_mode:[type-level | type-and-range-level | schema-validated]
  on_contract_fail: [retry | escalate-to-orchestrator | halt]
```

### Phase 4 · Convergence governance

The orchestrator actively governs convergence:

```
convergence_rules:
  max_iterations:  [from configs/evolution.yaml]
  stall_signal:    [no output improvement in last 2 iterations]
  drift_signal:    [current_work diverges from {{mission}} by > 30%]
  critical_ceiling:[from configs/guardrails.yaml — halt if CRITICAL count >= 3]

on_stall:    invoke zoom-out → get verdict → replan or halt
on_drift:    invoke zoom-out → reframe objective → reroute
on_critical: halt → emit human_gate=required → preserve state for recovery
```

### Phase 5 · Convergence and synthesis

When the subtask graph is complete:

```
synthesis:
  outputs_collected:    [list of stage outputs from shared_state]
  merge_strategy:       [concatenate | synthesize | select-best | structured-merge]
  quality_check:        [invoke output-quality-gate on merged result]
  policy_final_check:   [assess_action("complete", {{mission}}, risk={{blast_radius}})]
  memory_entry:         [what to persist from this run]
```

---

## Policy integration

```
policy_check:
  decomposition:  assess_action("decompose", {{mission}}, risk="low")
  per_agent:      assess_action(agent.role, subtask.objective, risk=subtask.risk)
  convergence:    assess_action("synthesize", {{mission}}, risk={{blast_radius}})
  human_gate:     required on any subtask with risk=high or critical
                  required on stall or drift events if verdict=halt
  audit_log:      emit stage="multi-agent-orchestrator" for decomposition, each routing decision, each handoff
  fix_log:        aggregate all CRITICAL/GAP entries from all agents into shared_state.fix_log
  delta_capture:  record subtask completion times, handoff failure rates, iteration count
```

---

## Failure modes to avoid

- **Orchestrator as executor**: The orchestrator coordinates; it does not perform domain work itself.
- **Stateless orchestration**: Losing track of intermediate outputs between agent handoffs.
- **Infinite delegation**: Sub-agents sub-delegating without stop conditions creates unbounded recursion.
- **Convergence theater**: Declaring convergence without passing `output-quality-gate`.
- **Swallowing fix_log**: Every CRITICAL entry from any agent must surface to the orchestrator level.

---

## Output contract

```
orchestration_run:
  mission_id:         [{{mission}}]
  subtask_graph:      [complete decomposition]
  routing_decisions:  [per-task agent selection with rationale]
  handoff_log:        [all handoffs with contract validation results]
  iteration_count:    [actual vs max]
  fix_log:            [aggregated CRITICAL/GAP entries]
  convergence_signal: [converged | stalled | drifted | halted]
  synthesis_output:   [merged result, quality-gate validated]
  memory_entries:     [lessons to persist]
  delta:              [{{delta}} for evolution loop]
```

---

## Integration notes

- This skill is the runtime layer over `dynamic-team-factory` — factory builds the team, orchestrator runs it.
- `fix_log.CRITICAL >= 3` is an unconditional halt signal per `configs/guardrails.yaml`.
- Feed `delta` into the `observe` stage of `self-improving-pipeline.yaml` after each run.
- `convergence_signal=stalled` with `iteration_count >= max_iterations` is the trigger for `zoom-out`.
- The orchestrator is responsible for ensuring no agent exceeds its bounded autonomy level without a human gate.
