# dynamic-team-factory

Generate purpose-built agent teams on demand. Choose the right orchestration pattern,
wire the handoff contracts, and capture the team's performance as a delta for the evolution loop.
This is the Harness meta-skill — it builds teams, not just tasks.

- **Triggers:** build a team, generate team, team factory, dynamic team, harness team, which pattern, orchestration pattern, compose agents, mission team, team for this objective
- **Stack:** generic
- **Owner:** system
- **Weight:** 5
- **Policy level:** medium (team generation is safe; generated teams may escalate based on their mission)
- **SwarmX primitives:** `{{mission}}`, `{{context}}`, `{{memory_summary}}`, `{{policy_level}}`, `{{delta}}`, `{{evolution_proposal}}`

---

## When to activate

- When a mission requires more than one specialist agent and no existing workflow covers it.
- When `workflow-routing` cannot find a matching workflow blueprint.
- When a domain-specific team needs to be bootstrapped (e.g., "a team to harden TaxBridge's auth layer").
- When `swarm evolve` is generating a proposal that requires a multi-agent execution plan.
- When an existing team pattern is underperforming and a structural change is needed.

---

## The 6 Orchestration Patterns

Evaluate all 6 before selecting. Justify the choice with a one-line rationale.

### Pattern 1: Pipeline (Sequential)
```
Use when: work is strictly sequential — each stage's output is the next stage's input.
Shape:    A → B → C → D
Gate:     Handoff contract validation at every stage boundary.
Risk:     Blocking — one failed stage halts the pipeline.
Best for: ETL, code generation → test → review → deploy, document production.
```

### Pattern 2: Fan-out / Fan-in (Parallel)
```
Use when: work can be decomposed into independent parallel tasks, then merged.
Shape:    A → [B1, B2, B3] → C (merge)
Gate:     Merge contract must define conflict resolution for overlapping outputs.
Risk:     Merge complexity grows with fan-out width. Cap at 5 parallel branches.
Best for: Multi-perspective research, parallel testing, security audit across domains.
```

### Pattern 3: Expert Pool (Selective Dispatch)
```
Use when: the problem space is wide but each sub-problem needs only one specialist.
Shape:    Router → {Expert A | Expert B | Expert C} → Collector
Gate:     Router must define dispatch criteria before any expert is invoked.
Risk:     Router errors send work to the wrong expert — validate dispatch criteria first.
Best for: Domain triage, multi-language support, diverse compliance requirements.
```

### Pattern 4: Producer-Reviewer (Dual-Pass)
```
Use when: output quality requires independent critique before acceptance.
Shape:    Producer → Reviewer → [accept | rework → Producer]
Gate:     Max rework cycles = 2. Escalate to human on third cycle.
Risk:     Infinite loop if Producer and Reviewer have incompatible quality bars.
Best for: Code review loops, content quality gates, proposal validation.
```

### Pattern 5: Supervisor (Hierarchical Control)
```
Use when: a coordinator must maintain state and route work dynamically based on intermediate results.
Shape:    Supervisor → assigns to Specialists → Supervisor aggregates → next assignment
Gate:     Supervisor must maintain explicit state. Stateless supervisors are anti-pattern.
Risk:     Supervisor bottleneck. Cap supervisor's direct reports at 5.
Best for: Incident command, adaptive research, exploration tasks with unknown subtask count.
```

### Pattern 6: Hierarchical Delegation (Recursive)
```
Use when: the mission decomposes recursively — each sub-team can itself be a smaller team.
Shape:    Chief → [Lead A → [Spec A1, Spec A2]] → [Lead B → [Spec B1]]
Gate:     Each delegation level must have explicit stop conditions to prevent infinite recursion.
Risk:     Latency compounds with depth. Max depth = 3 unless explicitly overridden.
Best for: Large-scale architecture reviews, multi-domain platform builds, org-level planning.
```

---

## Team generation protocol

### Step 1 · Pattern selection

```
pattern_evaluation:
  mission:       [{{mission}}]
  selected:      [Pattern N: name]
  rationale:     [one sentence why this pattern over the others]
  rejected:      [patterns considered and why eliminated]
```

### Step 2 · Role definition

For each role in the team:
```
role:
  name:         [agent name — must match agents/catalog.yaml or flag as new]
  responsibility: [one sentence — what this agent does and does not own]
  inputs:       [expected inputs from prior stage]
  outputs:      [what it must produce for the next stage]
  stop_condition: [when does this agent's work end?]
  policy_level: [low | medium | high]
```

### Step 3 · Handoff contract wiring

For every stage boundary:
```
handoff:
  from:         [role A]
  to:           [role B]
  contract:     [exact output format expected — type-level or schema-level]
  validation:   [type-level | type-and-range-level | schema-validated]
  on_failure:   [retry | escalate | halt]
```

### Step 4 · Delta capture (for evolution loop)

After the team completes its mission, capture the performance delta:
```
team_delta:
  mission_id:        [{{mission}}]
  pattern_used:      [Pattern N]
  fitness_score:     [0-1, multi-axis: correctness, leverage, reversibility, simplicity, synergy]
  bottlenecks:       [stages that created wait or rework]
  handoff_failures:  [which contracts broke and why]
  evolution_signal:  [promote_pattern | deprecate_role | add_role | change_pattern]
  proposal_candidate: [feed into {{evolution_proposal}} if fitness < 0.72]
```

---

## Policy integration

```
policy_check:
  team_generation: assess_action("compose", {{mission}}, risk="medium")
  per_role:        assess_action(role.responsibility, risk=role.policy_level)
  human_gate:      required if any role.policy_level == "high" or "critical"
  audit_log:       emit stage="dynamic-team-factory" for pattern selection and each role
  delta_capture:   store team_delta to memory_graph after mission completes
  evolution_feed:  if fitness_score < 0.72, auto-generate evolution_proposal
```

---

## Output contract

```
team_blueprint:
  pattern:          [selected pattern name]
  rationale:        [one-line justification]
  roles:            [list of role definitions]
  handoff_contracts:[list of stage boundary contracts]
  workflow_yaml:    [generated YAML compatible with workflows/ directory format]
  team_delta:       [captured post-mission for evolution loop]
  skill_gaps:       [roles that required skills not in skills/catalog.yaml → promote to skill-developer]
```

---

## Integration notes

- Generated `workflow_yaml` should be validated by `workflow-composition` before first run.
- `skill_gaps` are direct inputs to `skill-developer` for new skill authoring.
- `team_delta` feeds the `observe` stage of `self-improving-pipeline.yaml` on the next evolution cycle.
- This skill is the Harness-pattern implementation for SwarmX — it makes `harness-orchestrator` concrete.
- `evolution_signal=change_pattern` with fitness < 0.72 is a mandatory trigger for a new `dynamic-team-factory` run.
