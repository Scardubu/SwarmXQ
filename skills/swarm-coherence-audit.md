# swarm-coherence-audit

Check any proposed action against all four swarm boundaries simultaneously. Refuse drift before it spreads.

- Triggers: coherence, swarm boundary, drift, boundary check, cross-agent consistency
- Stack: generic
- Owner: system
- Weight: 5

## When to activate
- Before any action that crosses a subsystem boundary (architecture, security, UI, data).
- When an agent's proposed change optimizes its local objective at the potential cost of system-wide coherence.
- When the Strategist, Chief Architect, or Evolver needs a rapid multi-boundary check.

## Four boundaries — check all simultaneously

### 1 · Architecture boundary
Does the proposed change respect the current service/module boundary map?  
Does it introduce accidental coupling, new dependencies, or hidden state sharing?  
Would Chief Architect approve this without requiring revision?

### 2 · Security boundary
Does the change respect least-privilege? Does it expose new attack surfaces, secret-handling paths, or overly broad permissions?  
Would the Risk Sentinel block this?

### 3 · Design-system boundary
Does the change maintain token consistency, component coherence, spacing, accessibility standards?  
Does it drift from the established design language?

### 4 · Data contract boundary
Does the change preserve schema compatibility? Does it break existing contracts, alter data lineage, or skip versioning?  
Would the Data Engineer require a migration path first?

## Scoring
- All four CLEAR → proceed.
- One boundary AMBER (minor concern, low risk) → proceed with a one-line note.
- One boundary RED (violation) → block and return a precise description of the violated boundary and the minimum remediation.
- Two or more boundaries RED → full stop. Escalate to Chief Architect and Risk Sentinel before proceeding.

## Output contract
- Boundary check results: CLEAR / AMBER / RED per boundary.
- Blocking findings: which boundary, what is violated, minimum remediation.
- Proceed signal: yes / no / conditional.

## Elite operating discipline
- Prefer the smallest useful action that still satisfies the objective.
- For non-trivial tasks, compare 2-3 internal variants, run one skeptical check, and keep the winner silently.
- Keep assumptions explicit, outputs directly usable, and failure signals short and concrete.
- Stop early when the requested boundary is satisfied; do not smuggle in unrelated improvements.

## Elite risk discipline
- Score candidates on correctness, reversibility, leverage, and downstream recoverability.
- Reject red paths outright; yellow paths require a named recovery note.
- Check both local quality and next-hop impact before selection.
- Prefer recoverable choices over locally elegant but irrecoverable ones.

## Production note
- Use this skill as a preflight check whenever the current step may create hidden coupling, a boundary violation, or an irreversible downstream cost.
