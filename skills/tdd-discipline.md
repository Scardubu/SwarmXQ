# tdd-discipline

Write the test before the implementation. Red → Green → Refactor. No exceptions for non-trivial logic.

- **Triggers:** tdd, test first, red green refactor, write test first, test driven, failing test before code, specification by example, behavior before implementation
- **Stack:** generic
- **Owner:** qa
- **Weight:** 5
- **Policy level:** low (test authoring is read/write bounded to test files only)
- **SwarmX primitives:** `{{mission}}`, `{{context}}`, `{{memory_summary}}`, `{{policy_level}}`

---

## When to activate

- Any new feature or behavior that is non-trivial (more than 3 lines of logic).
- Bug fixes — write a failing test that reproduces the bug before applying the fix.
- Refactoring — confirm existing tests are green, then proceed. If coverage is absent, write tests first.
- As the standard discipline for `swarm run` missions tagged `backend`, `qa`, or `core`.

---

## Execution pattern

### Phase 1 · Specify behavior (not implementation)

Before writing any test, write a plain-English specification of the expected behavior:

```
GIVEN: [precondition — system state before the action]
WHEN:  [action — the operation being tested]
THEN:  [postcondition — observable state or return value]
```

Write one GIVEN/WHEN/THEN per distinct behavior. If you have 5 distinct behaviors, you need 5 specifications.

### Phase 2 · Write the failing test (Red)

Translate each specification into a failing test:

- Test name must describe the behavior, not the implementation: `should_reject_expired_token` not `test_auth_function`.
- Test only one behavior per test case. No multi-assertion tests that check orthogonal behaviors.
- Use the real interface of the module under test. Do not mock the module itself.
- **Confirm the test fails** before writing the implementation. A test that passes before the implementation exists is not a test.

### Phase 3 · Write the minimum implementation (Green)

Write the smallest amount of code that makes the failing test pass:

- Solve for the test, not for imagined future requirements.
- Do not add logic that is not currently tested.
- If you find yourself adding untested logic, write the test first and return to Phase 2.

### Phase 4 · Refactor (Clean)

Now that behavior is locked by passing tests:

- Remove duplication.
- Improve naming, structure, and readability.
- Run `refactor-safety` before any refactor that crosses module boundaries.
- Re-run tests after each refactor step. If any test fails, revert the refactor step — do not adjust the test to match the implementation.

### Phase 5 · Coverage and regression gate

```
coverage_check:
  min_line_coverage: 80%
  branch_coverage: enabled
  mutation_score: target ≥ 0.65
  regression_status: clean (no prior-passing test now failing)
```

Report coverage delta. If coverage dropped, name the uncovered path and explain why it is acceptable or write the missing test.

---

## Policy integration

```
policy_check:
  scope: test files only during Red/Green phases
  implementation_writes: assessed at phase_3_entry
  refactor_writes: assess_action("refactor", {{context}}, risk="medium")
  audit_log: emit stage="tdd-discipline" phase=[red|green|refactor|gate]
  human_gate: not required for test file writes; required if refactor touches blast_radius=high
```

---

## Failure modes to avoid

- **Test-after**: Writing implementation first, then writing tests to match it. This produces tests that describe what the code does, not what it should do.
- **Over-mocking**: Mocking the module under test makes the test validate the mock, not the behavior.
- **Omnibus tests**: One test case asserting 7 things. When it fails, you don't know which assertion broke.
- **Green without red**: Declaring a test "passing" without first confirming it fails when the behavior is absent.

---

## Output contract

```
tdd_session:
  specifications:         [GIVEN/WHEN/THEN per behavior]
  red_tests:              [failing test file path(s) + confirmation they fail]
  green_implementation:   [implementation file path(s)]
  refactor_summary:       [changes made post-green, or "none"]
  coverage_delta:         [before → after]
  regression_status:      [clean | flagged: {failing tests}]
  memory_candidate:       [reusable pattern to promote, or "none"]
```

---

## Integration notes

- `tdd-discipline` feeds `test-stabilization` when test quality degrades over time.
- After a `code-diagnose` run that confirms a bug, activate `tdd-discipline` to write the reproducing test before the fix.
- The `regression_status` field is a required input to `release-readiness`.
- Mutation score below 0.5 is a signal to `skill-sentinel` that this test suite needs a `tdd-discipline` run.
