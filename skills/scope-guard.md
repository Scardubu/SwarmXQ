# scope-guard

Detect and prevent scope creep during implementation before it compounds.

- Triggers: scope, creep, expanding, out of scope, drift, gold plating, feature addition, unplanned
- Stack: generic
- Owner: system
- Weight: 5

## When to activate
- Before beginning implementation of any task with explicitly defined acceptance criteria.
- When an implementation pass is returning more changes than the task required.
- When an agent is adding "related improvements" alongside the core task.

## Execution pattern

1. **Lock the acceptance criteria before the first line of implementation.** Acceptance criteria must be: specific (not "improve it" — "reduce p95 latency below 200ms under 50 concurrent users"), bounded (what is explicitly out of scope is as important as what is in scope), and measurable (there is a verifiable test for each criterion). Criteria that are not locked before implementation begins are criteria that will drift.

2. **Apply the minimum-viable-change discipline.** For every planned change: ask "does this change directly address one of the locked acceptance criteria?" If yes: proceed. If no: it belongs in a separate task. Adding changes that are "obviously good" while addressing a specific task is scope creep — even when the additions are genuinely good. They belong in a follow-up, not the current change.

3. **Flag scope signals early.** Scope creep signals include: touching more files than estimated, discovering "while I'm here" improvements, adding tests for behavior that was not part of the original task, and implementing edge cases that were not in the acceptance criteria. Each signal is a decision point — not an automatic justification to expand.

4. **Distinguish scope creep from scope correction.** Sometimes the original scope was wrong. When implementation reveals that the stated acceptance criteria are insufficient to achieve the stated goal: surface this explicitly. Do not silently expand scope — return a scope correction proposal with the specific gap identified and the minimum additional change required.

5. **Track the blast radius against the estimate.** If the number of files touched, lines changed, or agents involved has grown beyond the original estimate by more than 20%: stop and reassess. Either the estimate was wrong (document why), the scope has expanded (return a scope correction proposal), or the implementation approach is too broad (split the task).

6. **Gate every "related improvement" through the task backlog.** Every legitimate improvement discovered during implementation that is out of scope for the current task must be captured in the task backlog — not implemented silently. The backlog entry should include: what was found, why it matters, and what it would take to address it.

## Failure modes to avoid
- Implementing "obviously correct" improvements that were not in the acceptance criteria (creates untested surface area and review burden).
- Expanding scope silently instead of surfacing the need for a scope correction.
- Treating scope creep as "going above and beyond" — it creates merge conflicts, review burden, and unpredictable blast radius.

## Output contract
- Scope lock: the acceptance criteria as-stated, with out-of-scope items explicitly listed.
- Scope adherence: confirmation that all changes directly address a locked criterion.
- Scope signals: any signals detected and the decision made at each signal point.
- Backlog entries: out-of-scope improvements captured for follow-up.
- Scope correction proposal (if needed): the specific gap found and the minimum additional change required.

## Elite operating discipline
- Prefer the smallest useful action that still satisfies the objective.
- For non-trivial tasks, compare 2-3 internal variants, run one skeptical check, and keep the winner silently.
- Keep assumptions explicit, outputs directly usable, and failure signals short and concrete.
- Stop early when the requested boundary is satisfied; do not smuggle in unrelated improvements.

## Elite change-control notes
- Freeze the acceptance criteria or baseline before modifying behavior.
- Keep structural changes separate from behavioral changes.
- Verify the smallest safe slice, then expand only after the current slice is proven.
- Surface regressions, drift, and rollback risk immediately when they appear.

## Scope note
- Treat every added task, test, or cleanup item as a new commitment unless it is explicitly required by the locked acceptance criteria.
