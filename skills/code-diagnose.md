# code-diagnose

Evidence-first, hypothesis-elimination diagnosis before proposing any fix. Never guess.
Map the failure space completely before touching a single line of code.

- **Triggers:** diagnose, investigate, what's wrong, root cause, why is this failing, trace the bug, find the problem, before fixing, understand the failure
- **Stack:** generic
- **Owner:** engineering
- **Weight:** 5
- **Policy level:** low (read-only analysis phase) → escalates to medium if mutation is proposed
- **SwarmX primitives:** `{{mission}}`, `{{memory_summary}}`, `{{context}}`, `{{policy_level}}`

---

## When to activate

- Any time a bug report or failure signal arrives and the cause is unclear.
- Before writing a fix — even if the cause "seems obvious."
- When a prior fix did not hold (regression or recurrence signal detected).
- During a code review that surfaces surprising behavior.
- As the mandatory first stage of any `swarm evolve` run touching a codebase.

---

## Execution pattern

### Phase 1 · Gather evidence (read-only, low risk)

Collect all available observable signals before forming any hypothesis:

1. **Failure surface** — Exact error message, stack trace, and reproduction steps. If you don't have a reproduction path, stop and request one.
2. **Change surface** — What changed since the last known-good state? (git log, recent commits, dependency bumps, config changes, env changes.)
3. **Memory surface** — Query `{{memory_summary}}` for prior incidents involving the same component. Pattern recurrence is high-signal.
4. **Scope surface** — What is the blast radius? Which downstream systems or agents depend on the failing component?

### Phase 2 · Form hypotheses (structured, not speculative)

Produce exactly 3 hypotheses, ranked by likelihood based on observable evidence only:

```
H1: [Most likely root cause]  Evidence: [specific signal that supports it]
H2: [Second hypothesis]       Evidence: [specific signal that supports it]
H3: [Third hypothesis]        Evidence: [specific signal that supports it]
```

Each hypothesis must be falsifiable. If you cannot state what evidence would disprove it, discard it.

### Phase 3 · Eliminate (minimum-invasive experiments)

For each hypothesis, define the minimum observable test that confirms or eliminates it:

```
H1 test: [exact command / log line / assertion to run]
H2 test: [exact command / log line / assertion to run]
H3 test: [exact command / log line / assertion to run]
```

Run tests in order from least invasive to most invasive. Stop at the first confirmation.

### Phase 4 · Confirm and scope the fix

Once the root cause is confirmed:

- State the confirmed root cause in one sentence.
- State the fix scope: what is the minimum change that resolves it without side effects?
- State the blast radius of the fix: what else could break?
- Run the critic-gate before proposing the fix to `swarm run`.

---

## Policy integration

```
policy_check:
  before_phase_3: assess_action("diagnose", {{mission}}, risk="low")
  before_fix_proposal: assess_action("fix", {{fix_scope}}, risk="medium")
  audit_log: emit stage="code-diagnose" for each phase
  human_gate: required if fix_scope touches high/critical risk keywords
```

---

## Failure modes to avoid

- **Anchoring**: Committing to H1 before running H2/H3 tests.
- **Fix-first bias**: Writing a fix before confirming the root cause.
- **Scope creep during diagnosis**: Refactoring unrelated code while investigating.
- **Silent hypothesis**: Forming a hypothesis that cannot be falsified.

---

## Output contract

```
diagnosis:
  failure_signal:    [exact error + reproduction path]
  change_surface:    [what changed in the relevant window]
  memory_match:      [prior incident reference or "none"]
  confirmed_cause:   [one sentence, evidence-cited]
  fix_scope:         [minimum change definition]
  blast_radius:      [affected components]
  next_action:       [propose-fix | escalate | rollback | monitor]
  policy_decision:   [PolicyDecision.to_dict()]
```

---

## Integration notes

- Feed the `confirmed_cause` field into `evolution-proposal` as the **Evidence** field.
- If `memory_match` is non-empty, attach the prior memory note to the proposal.
- If `blast_radius` is high/critical, trigger `risk-sentinel` before any fix proposal.
- This skill is the mandatory predecessor to `refactor-safety` and `test-stabilization` when working on a confirmed bug.
