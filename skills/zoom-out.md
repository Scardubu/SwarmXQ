# zoom-out

Strategic zoom-out for direction resets. Recover context when the mission is drifting,
assumptions have accumulated, or the swarm has lost the thread of the original objective.

- **Triggers:** zoom out, step back, big picture, am i solving the right problem, direction reset, lost the thread, what are we actually doing, context recovery, mission drift, objective alignment, forest for the trees
- **Stack:** generic
- **Owner:** system
- **Weight:** 5
- **Policy level:** low (diagnostic and reframing only — no mutations)
- **SwarmX primitives:** `{{mission}}`, `{{context}}`, `{{memory_summary}}`, `{{policy_level}}`, `{{delta}}`

---

## When to activate

- After more than 3 iterations on the same problem without convergence.
- When a `swarm evolve` run is producing proposals that score below the fitness threshold.
- When the current task has grown to touch more than 3 unrelated systems.
- When `swarm-coherence-audit` detects boundary drift across multiple agents.
- At any point where the original `{{mission}}` objective has become ambiguous.
- Before a major planning session or when the team has lost alignment.

---

## Execution pattern

### Phase 1 · Recover the original objective

Pull `{{mission}}` and `{{memory_summary}}`. Answer without editorializing:

```
original_objective:  [the mission statement as defined at session start]
current_work:        [what the swarm is actually doing right now]
delta:               [the gap between original objective and current work]
```

If `delta` is empty, the swarm is on track. Return "on-track" and exit this skill.
If `delta` is non-trivial, continue.

### Phase 2 · Surface accumulated assumptions

List every assumption that has been made and not yet validated:

```
assumption_stack:
  - [assumption]: [when it was made] [validated: yes/no/partial]
  - [assumption]: [when it was made] [validated: yes/no/partial]
```

Unvalidated assumptions that are now driving significant work are **risk compounders**.

### Phase 3 · Reframe the objective

With the gap and assumption stack in hand, reframe the objective:

```
reframed_objective:
  what_we_are_solving:    [the actual problem, not the assumed one]
  what_we_are_not_solving: [explicit out-of-scope — stops scope creep]
  minimum_success_signal: [the smallest observable proof that the objective is met]
  current_work_verdict:   [keep | pivot | park | abandon]
```

Apply `current_work_verdict`:
- `keep` → the current work serves the reframed objective. Continue with updated framing.
- `pivot` → the current work partially serves the objective. Redirect the in-flight stages.
- `park` → the current work has value but not for this objective. Store as a memory note for a future mission.
- `abandon` → the current work does not serve the objective. Stop immediately, log the lesson, and replan.

### Phase 4 · Emit the delta note

Record the zoom-out session as a `{{delta}}` memory note:

```
delta_note:
  session:          [mission_id + timestamp]
  original:         [original objective]
  reframed:         [reframed objective]
  accumulated_debt: [unvalidated assumptions count]
  verdict:          [keep | pivot | park | abandon]
  lesson:           [one sentence: what caused the drift and how to prevent recurrence]
```

---

## Policy integration

```
policy_check:
  all_phases: read-only — no code or config mutations
  audit_log: emit stage="zoom-out" with delta_note
  escalation: if verdict=abandon, require human confirmation before halting
  memory: store delta_note as a durable memory entry with tag="direction-reset"
```

---

## Failure modes to avoid

- **Zoom-out theater**: Performing the exercise without acting on the verdict.
- **Retrospective drift**: Using zoom-out to relitigate past decisions rather than reframe the current objective.
- **Abandon without logging**: Stopping work without a delta note prevents future missions from learning from the course correction.
- **Reframe without minimum success signal**: A reframed objective without a falsifiable success signal is just a new assumption.

---

## Output contract

```
zoom_out:
  original_objective:      [recovered from {{mission}}]
  current_work:            [what the swarm is doing]
  gap:                     [delta between objective and work]
  assumption_stack:        [list with validation status]
  reframed_objective:      [updated mission statement]
  minimum_success_signal:  [falsifiable proof point]
  verdict:                 [keep | pivot | park | abandon]
  delta_note:              [stored to memory graph]
  next_action:             [resume | replan | park | stop]
```

---

## Integration notes

- `zoom-out` should be called by `autonomy-ops` automatically when `max_iterations` is reached without convergence.
- The `reframed_objective` replaces `{{mission}}` for subsequent stages in the current session.
- `verdict=abandon` must trigger a human gate — no autonomous termination of a mission without operator confirmation.
- Feed `accumulated_debt` (unvalidated assumptions count) into the `observe` stage of `self-improving-pipeline.yaml` as a quality signal.
