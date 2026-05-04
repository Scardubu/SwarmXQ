# architecture-improve

Holistic codebase architecture review with explicit drift detection, boundary enforcement, and
an incremental refactoring roadmap. Improve structure without burning the ship.

- **Triggers:** improve architecture, architecture review, codebase health, structural drift, domain model, service boundaries, coupling, cohesion, architectural debt, codebase improvement, modernize architecture
- **Stack:** generic
- **Owner:** platform
- **Weight:** 5
- **Policy level:** medium (produces proposals; mutations require human gate if blast_radius=high)
- **SwarmX primitives:** `{{mission}}`, `{{context}}`, `{{memory_summary}}`, `{{policy_level}}`, `{{evolution_proposal}}`

---

## When to activate

- Quarterly architecture hygiene runs on any long-lived codebase.
- Before a major feature addition that will stress existing boundaries.
- When `swarm-coherence-audit` returns boundary violations or drift signals.
- When onboarding velocity is declining (new contributors take too long to ship safely).
- As the strategic framing stage before a refactoring sprint.

---

## Execution pattern

### Phase 1 · Map the current architecture

Produce a dependency and boundary map without interpretation:

```
layer_map:
  presentation:  [components, files, entry points]
  application:   [use cases, orchestration, workflows]
  domain:        [entities, value objects, domain services]
  infrastructure:[repositories, adapters, external integrations]

boundary_inventory:
  - [boundary name]: [what crosses it, in both directions]

dependency_graph:
  - [module A] → [module B]: [reason for dependency]
```

Do not evaluate yet. Map first.

### Phase 2 · Detect drift

Compare the current map against what the architecture *should* be (stated intent, ARCHITECTURE.md, or domain model):

```
drift_inventory:
  - type: [COUPLING | LEAKAGE | MISSING_BOUNDARY | CIRCULAR_DEP | ORPHAN | DUPLICATION]
    location: [file or module path]
    severity: [high | medium | low]
    evidence: [observable signal — import, call graph, test setup complexity]
    impact:   [what this drift is costing: testability, velocity, safety]
```

Rank by impact, not by ease of fix.

### Phase 3 · Produce the improvement roadmap

For each high-severity drift item, produce one improvement proposal:

```
improvement:
  id:              [arch-{n}]
  drift_type:      [from Phase 2]
  proposed_change: [specific boundary enforcement, extraction, or deletion]
  approach:        [strangler fig | extract module | introduce adapter | delete dead code]
  blast_radius:    [low | medium | high]
  reversibility:   [undoable_1min | undoable_1hr | irreversible]
  effort:          [S | M | L | XL]
  value:           [testability | velocity | safety | cost]
  sequence:        [before | after | independent of {arch-n}]
```

Produce a sequenced execution order. Low-blast, high-value changes go first.

### Phase 4 · Vertical slice validation

Before the roadmap is finalized, validate that at least one improvement has been sliced into a shippable vertical:

```
vertical_slice:
  improvement_id:  [arch-{n}]
  slice_scope:     [what can be done in a single PR]
  success_signal:  [observable proof this slice improved the boundary]
  test_coverage:   [new or existing tests that protect the change]
```

A roadmap without a shippable slice is a wish list.

---

## Policy integration

```
policy_check:
  phase_1_2: assess_action("read", {{context}}, risk="low")
  phase_3:   assess_action("propose", {{improvement}}, risk="medium")
  phase_4:   assess_action("mutate", {{vertical_slice}}, risk={{blast_radius}})
  human_gate: required if any improvement.blast_radius == "high"
  audit_log: emit stage="architecture-improve" for each phase
  evolution_proposal: feed ranked improvements into {{evolution_proposal}} for review
```

---

## Failure modes to avoid

- **Big bang refactoring**: Proposing a complete rewrite instead of incremental boundary enforcement.
- **Drift without evidence**: Declaring drift without citing the specific observable signal (import, test setup, deployment coupling).
- **Roadmap without sequence**: Listing improvements without ordering them by dependency and blast radius.
- **Skipping the vertical slice**: The first improvement must be shippable independently.

---

## Output contract

```
architecture_review:
  layer_map:             [complete current-state map]
  drift_inventory:       [typed, ranked, evidence-cited]
  improvement_roadmap:   [sequenced proposals with blast_radius and effort]
  vertical_slice:        [first shippable improvement with success signal]
  evolution_proposals:   [high-value items promoted to swarm evolution queue]
  memory_candidate:      [recurring pattern to promote to skill, or "none"]
```

---

## Integration notes

- Run after `swarm-coherence-audit` to translate boundary violations into concrete proposals.
- Feed the `improvement_roadmap` into `workflow-composition` to build a phased execution plan.
- High-blast improvements require `risk-sentinel` review before `refactor-safety` is invoked.
- This skill pairs with `zoom-out` for strategic resets and with `code-diagnose` for root-cause-grounded structural fixes.
