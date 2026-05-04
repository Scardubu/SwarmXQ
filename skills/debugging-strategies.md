# debugging-strategies

Systematic hypothesis-elimination debugging. Scientific method applied to software failures.
Stop guessing. Build a model, instrument it, falsify wrong hypotheses, confirm the root cause.

- **Triggers:** debug, can't reproduce, intermittent failure, flapping, race condition, nondeterministic, production bug, why is this slow, why does this break, narrowing down, bisect, investigate failure
- **Stack:** generic
- **Owner:** engineering
- **Weight:** 5
- **Policy level:** low (investigation only) → medium if fix is applied
- **SwarmX primitives:** `{{mission}}`, `{{context}}`, `{{memory_summary}}`, `{{policy_level}}`

---

## When to activate

- Any bug that is not immediately obvious from a single stack trace.
- Intermittent or nondeterministic failures (flapping tests, race conditions, timing bugs).
- Performance regressions with no obvious cause.
- Production incidents where the root cause is unknown.
- When `code-diagnose` returns multiple unresolved hypotheses after its Phase 3 elimination pass.

---

## Debugging strategy selection

Choose the appropriate strategy based on the failure type. Justify the selection.

### Strategy A: Binary Search / Bisect
```
Use when: a regression was introduced in a range of commits and is reproducible.
Method:   git bisect or manual halving of the change set until the introducing commit is isolated.
Signal:   "It worked in version X but not in version Y."
Stop:     First commit that introduces the failure = root cause boundary.
```

### Strategy B: Divide and Conquer (Input Space)
```
Use when: failure occurs for some inputs but not others.
Method:   Progressively simplify the failing input until the minimal reproducing case is found.
Signal:   "It fails with this payload but not a similar one."
Stop:     Minimal input that reproduces the failure is the invariant violation specification.
```

### Strategy C: Instrumentation-First
```
Use when: the failure is observable but the cause is invisible (no useful stack trace).
Method:   Add structured logging at suspected boundaries, re-run, compare output.
Signal:   "I can see it fail but I don't know where in the call graph."
Stop:     The log boundary where expected state diverges from actual state.
Constraint: Remove all debug instrumentation before fix proposal. No debug logs in production.
```

### Strategy D: Differential Debugging (Works/Doesn't-Work Comparison)
```
Use when: two code paths or environments produce different results for the same input.
Method:   Map every difference between the working and non-working contexts.
          (Dependencies, config, env vars, OS, network, data state, time/timezone.)
Signal:   "It works on my machine but not in CI" or "staging is fine but prod breaks."
Stop:     The specific difference that causes the divergence.
```

### Strategy E: Time-Travel / Snapshot Replay
```
Use when: failure is nondeterministic or time-dependent.
Method:   Capture system state at failure time (heap dump, trace, DB snapshot).
          Replay from captured state deterministically.
Signal:   "It fails sometimes but I can't reproduce it consistently."
Stop:     Confirmed reproduction from snapshot = deterministic root cause isolation.
```

### Strategy F: Elimination by Simplification
```
Use when: a complex system fails and the interacting components are numerous.
Method:   Remove components one at a time (or replace with stubs) until failure disappears.
Signal:   "Too many moving parts, don't know which one is failing."
Stop:     Minimum component set that reproduces the failure identifies the guilty component.
```

---

## Execution protocol (all strategies)

### Step 1 · Model before touching code

Build a mental or written model of what *should* happen:
```
expected_behavior:   [what the system should do, step by step]
actual_behavior:     [what it actually does, step by step]
first_divergence:    [the exact point where expected ≠ actual]
```

### Step 2 · Instrument the divergence point

Place observation at the first divergence point. Do not instrument speculatively.
```
instrumentation:
  location:   [file:line or service:endpoint]
  observes:   [state variable / return value / timing]
  method:     [structured log | assertion | breakpoint | metric]
```

### Step 3 · Run and collect

Run the minimum reproducible scenario. Collect the output.
```
reproduction:
  command:    [exact command to reproduce]
  iterations: [how many runs needed for reliable signal]
  output:     [collected evidence]
```

### Step 4 · Update the model and iterate

Compare collected output to model. Update the model. Narrow the hypothesis set.
Repeat Steps 2–4 until `hypothesis_set.count == 1`.

### Step 5 · Confirm with a controlled experiment

Before declaring root cause confirmed:
```
controlled_experiment:
  hypothesis:   [the single remaining hypothesis]
  change:       [exact minimal change that, if the hypothesis is correct, should fix the failure]
  expected:     [what should happen if hypothesis is correct]
  actual:       [what actually happened]
  verdict:      [CONFIRMED | FALSIFIED]
```

`FALSIFIED` → return to Step 1. Do not guess again; build a new model.

---

## Policy integration

```
policy_check:
  investigation: assess_action("investigate", {{context}}, risk="low")
  instrumentation: assess_action("instrument", {{location}}, risk="low")
  fix_application: assess_action("fix", {{confirmed_cause}}, risk="medium")
  audit_log: emit stage="debugging-strategies" strategy=[A|B|C|D|E|F] for each session
  human_gate: not required for investigation; required if fix blast_radius >= "high"
```

---

## Failure modes to avoid

- **Strategy-free debugging**: Randomly adding print statements without a model.
- **Hypothesis attachment**: Refusing to update the model when evidence contradicts H1.
- **Debug pollution**: Leaving instrumentation code in the codebase after fixing.
- **Fix before confirm**: Applying a fix before `controlled_experiment.verdict == CONFIRMED`.
- **Nondeterminism acceptance**: Treating intermittent failures as "acceptable" without root cause confirmation.

---

## Output contract

```
debug_session:
  strategy_used:          [A | B | C | D | E | F]
  strategy_rationale:     [one sentence]
  model:                  [expected vs actual vs first_divergence]
  instrumentation_trail:  [locations instrumented and what was observed]
  hypothesis_set:         [initial hypotheses and elimination evidence for each]
  confirmed_root_cause:   [one sentence, evidence-cited]
  controlled_experiment:  [change, expected, actual, verdict]
  fix_scope:              [minimum change definition]
  debug_artifacts:        [removed before fix application: yes/no]
  memory_candidate:       [reusable debug pattern to promote, or "none"]
```

---

## Integration notes

- `debugging-strategies` is the upstream of `code-diagnose` for complex, multi-component failures.
- Feed `confirmed_root_cause` into `tdd-discipline` to write the reproducing test before the fix.
- `memory_candidate` promotes recurring debug patterns to `skill-synthesis` for future skill generation.
- For production incidents, run `incident-command` in parallel — `debugging-strategies` drives root cause while `incident-command` manages mitigation and communication.
