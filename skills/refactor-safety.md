# refactor-safety

Restructure code with guardrails and regression checks.

- Triggers: refactor, cleanup, rename, simplify, restructure, extract, reorganize, technical debt
- Stack: generic
- Owner: engineering
- Weight: 5

## When to activate
- Restructuring code without changing observable behavior.
- Extracting a reusable abstraction from duplicated code.
- Renaming or reorganizing modules before a larger feature addition.

## Execution pattern

1. **Lock the behavioral invariants before touching anything.** Identify: what observable behavior must remain identical after the refactor? Write or verify that tests cover this behavior. If there are no tests for the behavior you are about to restructure — write them before you start. A refactor without a behavioral safety net is a guess with extra steps.

2. **Estimate the blast radius.** List every file, module, import, or call site that will be affected. If the blast radius is larger than expected — split the refactor. The minimum safe slice for a refactor is: one change that can be reviewed in isolation, leaves the system in a working state, and can be reverted cleanly.

3. **Make the structural move first, separately from behavior changes.** Never combine a refactor with a feature addition or bug fix in the same commit. Mixing structural and behavioral changes makes the review impossible and the rollback ambiguous. Move code → verify it works → then change behavior → verify again.

4. **Rename with global search-replace verification.** After renaming: search for every string instance of the old name in the codebase, not just in code (config files, documentation, migration scripts, CI definitions). Missed renames in non-code files are a common silent breakage source.

5. **Run the full test suite before declaring done.** Not just the tests for the affected module — the full suite. Refactors are the most common source of unexpected cross-module regressions because they change import graphs and shared state in ways that are not obvious at the call site.

6. **Validate in the integration environment.** Unit tests pass does not mean the integration behavior is preserved. Run the integration suite or manually verify the primary flows in a non-production environment before merging.

## Failure modes to avoid
- Refactoring and adding new behavior in the same change.
- Skipping the pre-refactor test-writing step when coverage is low.
- Declaring "done" after unit tests pass without running integration verification.

## Output contract
- Behavioral invariant list: what must remain identical after the refactor.
- Blast radius: files and call sites affected.
- Refactor scope: the minimum slice being moved in this change.
- Test evidence: pre-refactor and post-refactor test results.
- Integration validation: evidence the primary flows still work after the structural change.

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

## Refactor note
- When the refactor is non-trivial, separate discovery, move, verification, and cleanup into distinct passes so rollback stays easy.
