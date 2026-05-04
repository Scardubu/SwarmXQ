# grill-with-docs

Interrogate every assumption against the authoritative documentation before trusting the code, configuration,
or prior memory. The code may lie. The docs are the contract.

- **Triggers:** grill with docs, check the docs, verify against docs, docs vs code, is this documented, what does the spec say, trust but verify, api contract, documentation drift
- **Stack:** generic
- **Owner:** system
- **Weight:** 5
- **Policy level:** low (read-only interrogation)
- **SwarmX primitives:** `{{mission}}`, `{{context}}`, `{{memory_summary}}`, `{{policy_level}}`

---

## When to activate

- Before integrating a third-party API, SDK, or framework at a version boundary.
- When code behavior does not match expectations and the root cause is unclear.
- When refactoring a module that depends on external contracts (REST API, database driver, auth library).
- During `swarm evolve` proposal review — especially when a proposal modifies an integration boundary.
- When `confidence-gating` returns a low-confidence signal about an external dependency.

---

## Execution pattern

### Phase 1 · Enumerate assumptions

List every assumption the current code or proposal makes about an external dependency:

```
assumption_surface:
  - [Component]: [specific assumption made]
  - [Component]: [specific assumption made]
  ...
```

Mark each assumption as:
- `code-derived` — inferred from reading the implementation
- `memory-derived` — sourced from `{{memory_summary}}` or prior run
- `spec-derived` — sourced from documentation or spec

Only `spec-derived` assumptions are trusted without verification.

### Phase 2 · Source the documentation

For each `code-derived` or `memory-derived` assumption, locate the authoritative source:

Priority order (highest to lowest):
1. Official API reference / changelog for the specific version in use
2. Official migration guide if a version bump is involved
3. Published RFCs or standards documents (for protocols)
4. Vendor-published integration guides
5. Source code of the dependency (last resort — implementation may not match contract)

Record the source URL and version for every assumption verification.

### Phase 3 · Grill each assumption

For each assumption, produce a verdict:

```
assumption:     [the assumption being tested]
source:         [documentation URL + version]
verdict:        [CONFIRMED | CONTRADICTED | UNDOCUMENTED | DEPRECATED]
evidence:       [quoted or paraphrased documentation passage]
action:         [none | update-code | raise-risk | escalate | document-gap]
```

`CONTRADICTED` → the assumption is wrong. Trigger `code-diagnose` and flag as a CRITICAL in the Fix Log.
`UNDOCUMENTED` → the behavior is not documented. Treat as unstable surface. Wrap in a boundary adapter.
`DEPRECATED` → the assumption relies on deprecated behavior. Plan migration.

### Phase 4 · Produce the verified assumption set

Emit a clean assumption manifest with all verdicts and required actions.
Feed `CONTRADICTED` and `DEPRECATED` findings directly into `evolution-proposal` as evidence.

---

## Policy integration

```
policy_check:
  phase: read-only — no code mutations in this skill
  escalation: if CONTRADICTED count >= 1, emit human_gate=required in proposal
  audit_log: emit stage="grill-with-docs" for each assumption verdict
  fix_log_entry: CRITICAL for each CONTRADICTED assumption
```

---

## Failure modes to avoid

- **Version mismatch**: Checking the latest docs for a project pinned to an older version.
- **Proxy source trust**: Accepting Stack Overflow or blog posts as authoritative documentation.
- **Undocumented = safe**: Treating undocumented behavior as stable. Undocumented = unreliable contract.
- **Skip when confident**: This skill is most valuable precisely when confidence is high — that is when blind spots are largest.

---

## Output contract

```
docs_grill:
  assumption_count:     [total assumptions enumerated]
  confirmed:            [count]
  contradicted:         [count + list of issues]
  undocumented:         [count + list of unstable surfaces]
  deprecated:           [count + list + migration paths]
  fix_log_criticals:    [count of CRITICAL entries emitted]
  verified_manifest:    [full assumption → verdict → action table]
  next_action:          [proceed | code-diagnose | raise-proposal | escalate]
```

---

## Integration notes

- `grill-with-docs` is the mandatory predecessor to any `mcp-tooling` integration.
- Feed `contradicted` findings into `evolution-proposal` as the **Evidence** field.
- `UNDOCUMENTED` surfaces should trigger `handoff-contract` validation at the affected boundary.
- During `swarm evolve` critique phase, invoke this skill against any proposal that modifies an external integration boundary.
