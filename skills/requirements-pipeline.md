# requirements-pipeline

Convert a vague mission objective into a structured PRD, then decompose it into
vertical-sliced, immediately actionable issues. No ambiguity survives this pipeline.

- **Triggers:** prd, requirements, write requirements, product requirements, to issues, break into tickets, requirements document, what are we building, spec, feature spec, scope the work, user stories
- **Stack:** generic
- **Owner:** system
- **Weight:** 4
- **Policy level:** low (requirements authoring is read/write bounded to docs only)
- **SwarmX primitives:** `{{mission}}`, `{{context}}`, `{{memory_summary}}`, `{{policy_level}}`

---

## When to activate

- At the start of any new feature or product initiative before engineering work begins.
- When a mission objective is underspecified and the swarm cannot decompose it without more structure.
- When `zoom-out` returns a `reframed_objective` that needs to be formalized.
- Before a `dynamic-team-factory` run — the team needs a PRD to operate against.
- When stakeholder alignment is uncertain and the scope needs to be made explicit and agreed upon.

---

## Execution pattern

### Phase 1 · Requirements elicitation (grill the objective)

Interrogate the mission objective before writing anything:

```
elicitation:
  who_benefits:       [specific user segment — not "users" in general]
  problem_statement:  [what problem this solves and for whom]
  why_now:            [what makes this the right moment to build this]
  success_metric:     [the single measurable outcome that defines success]
  anti_goals:         [what this explicitly does not solve — prevents scope creep]
  open_questions:     [unresolved ambiguities that must be answered before implementation]
```

`open_questions` that cannot be answered by the swarm must be escalated to a human before proceeding.
Do not write the PRD until open_questions is empty or explicitly marked as "accepted uncertainty."

### Phase 2 · PRD authoring

```
PRD:
  title:          [feature name]
  version:        [1.0]
  status:         [draft | review | approved]
  owner:          [agent or human role responsible]
  objective:      [one paragraph — what we're building and why]
  
  user_stories:
    - as_a:   [specific user type]
      i_want: [specific capability]
      so_that:[specific benefit — not "I can use the feature"]

  acceptance_criteria:
    - [GIVEN/WHEN/THEN format — must be testable by QA without ambiguity]

  out_of_scope:
    - [explicit exclusion with rationale]

  technical_constraints:
    - [stack constraints, performance requirements, compliance requirements]

  dependencies:
    - [external systems, APIs, teams, or decisions this feature depends on]

  risks:
    - risk:        [specific risk]
      likelihood:  [high | medium | low]
      mitigation:  [specific action]

  open_questions:
    - [only present if accepted as "acceptable uncertainty" — must be tracked]
```

### Phase 3 · Vertical slice decomposition

Decompose the PRD into implementation issues. Each issue must be a **vertical slice** — it must deliver end-to-end value, not a layer of the stack.

```
issue:
  id:           [ISS-{n}]
  title:        [action verb + specific outcome — e.g., "Add JWT refresh token rotation"]
  type:         [feature | bug | chore | spike]
  value:        [one sentence: what user value this slice delivers when shipped]
  acceptance:   [directly references PRD acceptance_criteria — must be testable]
  tasks:
    - [implementation sub-task]
    - [test sub-task — must include both unit and integration coverage]
  estimate:     [S | M | L | XL]
  dependencies: [ISS-{n} or "none"]
  risk:         [low | medium | high]
  sequence:     [parallel | after ISS-{n}]
```

Ordering rules:
1. Ship the smallest complete user-facing slice first.
2. Infrastructure issues that block multiple feature issues go first.
3. High-risk issues go early — surface risk before the project is half-built.

### Phase 4 · Backlog validation

Before emitting the issue list:

```
backlog_validation:
  coverage:       [all acceptance_criteria covered by at least one issue: yes | gaps]
  no_orphans:     [all issues trace to at least one user story: yes | gaps]
  no_big_bangs:   [no single issue delivers value only if N other issues also ship: yes | violations]
  sequence_valid: [no circular dependencies: yes | cycles]
  risk_front_loaded: [high-risk issues scheduled in first 30% of sequence: yes | no]
```

Fix all gaps before emitting the final backlog.

---

## Policy integration

```
policy_check:
  elicitation: assess_action("elicit", {{mission}}, risk="low")
  prd_write: assess_action("document", {{mission}}, risk="low")
  issue_creation: assess_action("create-issues", {{backlog}}, risk="low")
  escalation: if open_questions != empty, escalate to human before Phase 2
  audit_log: emit stage="requirements-pipeline" for elicitation, PRD, decomposition, validation
```

---

## Failure modes to avoid

- **Requirement laundering**: Writing down what the developer wants to build and calling it a requirement.
- **Acceptance criteria without GIVEN/WHEN/THEN**: Vague criteria cannot be tested and will be interpreted differently by every agent.
- **Horizontal slices**: Issues that deliver "the database layer" or "the UI components" without end-to-end user value.
- **Scope creep via open_questions**: Treating open questions as optional rather than blocking.
- **PRD without anti_goals**: Missing explicit exclusions leads to scope expansion during implementation.

---

## Output contract

```
requirements_pipeline:
  elicitation:        [complete with open_questions resolved or accepted]
  prd:                [structured PRD document]
  issue_backlog:      [ordered vertical-slice issues with dependencies]
  backlog_validation: [all checks passing]
  memory_candidate:   [domain pattern to promote for future similar missions, or "none"]
```

---

## Integration notes

- Feed the approved PRD into `dynamic-team-factory` as the `{{context}}` for team generation.
- `acceptance_criteria` in the PRD become the test specifications for `tdd-discipline`.
- `risks` in the PRD with likelihood=high feed `risk-sentinel` before engineering starts.
- `open_questions` that are escalated to human review must block `swarm run` until resolved.
- The issue backlog feeds directly into `workflow-composition` for execution graph construction.
