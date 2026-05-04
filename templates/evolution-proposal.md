# Evolution Proposal Template
# Version: 2026.04 · IEP-ELITE-MAX · v2.0
# Backward-compatible with all prior versions.

## Proposal header
- id:              [auto-generated: proposal-{timestamp}-{nonce}-{scope}]
- created_at:      [ISO-8601 UTC]
- scope:           [bootstrap | reliability | safety | routing | skills | templates |
                    signal-triage | confidence-gate | output-quality-gate | other]
- version:         [v2.0 · 2026.04]

## Proposal body
- **Reason:**           [Evidence-grounded statement. No speculative reasons accepted.]
- **Patch:**            [Minimal config/behavior delta. Show the diff, not the full file.]
- **Risk:**             [low | medium | high | critical]
- **Blast radius:**     [component | service | system]
- **Reversibility:**    [undoable_1min | undoable_1hr | irreversible]

## Scoring
- **Correctness:**       [0–1]  Does this actually fix the identified signal?
- **Leverage:**          [0–1]  Highest-value change per unit of blast radius?
- **Reversibility:**     [0–1]  How easy is rollback?
- **Simplicity:**        [0–1]  Shorter path to the same outcome?
- **Swarm-synergy:**     [0–1]  Strengthens downstream agents or creates coupling?
- **Composite score:**   [0–1]  Weighted average. Minimum bar: 0.72 to qualify.

## Validation
- **Evidence:**          [Observable proof this change is needed — cite run IDs,
                          memory notes, or trace signals. Required. No evidence = no
                          proposal.]
- **Success signal:**    [What observable outcome proves this proposal worked?]
- **Failure signal:**    [What observable outcome proves this proposal made things
                          worse? Must be detectable within 3 runs.]

## Safety
- **Rollback path:**     [Exact revert instruction. A rollback path that has not been
                          tested is not a rollback path.]
- **Rollback anchor:**   [ANCHOR: {n} · {context} · {revert_instruction}]
- **Gate required:**     [human | auto-apply | proposal-only]

## Post-application
- **Memory to store:**   [Durable lesson in ≤ 2 sentences. What happened and why.]
- **Skill to promote:**  [Skill name if a reusable pattern emerged, else "none".]
- **Fix Log status:**    [CLEAN | GAPS: n | CRITICALS: n]
