# Micro-Utilities
# Version: IEP-ELITE 2026.4 — v2.0
# Drop these into any agent's internal protocol or workflow as inline checks.
# Zero external dependencies. Copy-paste ready. All utilities are additive and non-breaking.

---

## μ-1 · Stop-Condition Enforcer

**Purpose:** Prevent loops that rely on the agent to self-terminate.
**Usage:** Insert at the TOP of any autonomous loop, before work is dispatched.

```
STOP IF ANY:
□ iteration_count >= ceiling
□ evidence_quality == "weak" or "contradictory"
□ last_output unchanged from previous iteration
□ risk_signal fired in any upstream stage
□ required_input missing and cannot be safely inferred
□ fix_log CRITICAL count >= 3 (convergence failure — escalate, do not continue)

If any box is checked → HALT. Surface the first matching condition to the caller.
Do not buffer until loop end. A late stop is a missed gate.
```

---

## μ-2 · Output Contract Diff

**Purpose:** Instant handoff validation before passing output downstream.
**Usage:** Run at the end of every stage, before emit.

```
REQUIRED FIELDS CHECK (two levels):

Level 1 — Type:
For each field in receiver.expected_inputs:
  □ present in sender.output?         YES / NO / WRONG_TYPE

Level 2 — Range:
For each field that passed Level 1:
  □ value within expected range/enum/format? YES / NO / UNKNOWN

If all YES → PASS. Proceed with handoff.
If any NO → BLOCK. Return gap to sending stage:
  "[HANDOFF-BLOCK]: Field: [field]. Level: [TYPE|RANGE]. Expected: [type/format/range]. Received: [actual or ∅]."

Do not allow a downstream agent to operate on a malformed input.
A silent malformed handoff is worse than a visible block.
```

---

## μ-3 · Confidence Calibration Check

**Purpose:** Prevent confident-sounding wrong outputs from propagating.
**Usage:** Run as the final step of the output quality gate before emit.

```
FOR EACH factual claim in output:
  □ Can I verify this from available context (not from fluency)?  YES / NO
  □ Would I stake the next agent's work on this claim?           YES / NO

If both YES → claim is HIGH confidence. Emit as-is.
If first YES, second NO → MEDIUM. Add [Assumption: X] prefix to that claim.
If first NO → REMOVE claim or qualify with "unverified" / "inferred".

HALT OVER HALLUCINATE:
If a claim fails the first check and cannot be qualified — remove it entirely.
A clean gap is always preferable to a confident wrong output.
Never emit a confident claim that fails the first check.
```

---

## μ-4 · Island Bias Pulse

**Purpose:** Seed the session's implicit strategy island from Fix Log patterns
             before a new task begins. Prevents cold-start strategy drift.
**Usage:** Run at the START of any multi-stage workflow, using the Fix Log from
           the most recent prior run.

```
COUNT fix_log entries from prior run:
  CRITICAL_count  = number of [CRITICAL] entries
  GAP_count       = number of [GAP] entries
  CROSSOVER_count = number of [CROSSOVER] entries
  BLOCK_count     = number of [BLOCK] entries

DOMINANT_SIGNAL = the signal with the highest count
  (break ties by precedence: CRITICAL > BLOCK > GAP > CROSSOVER)

ISLAND SELECTION:
  CRITICAL dominant  → elevate Island α (precision: correctness and boundary fidelity above all)
  BLOCK dominant     → elevate Island α + tighten §13 validation threshold
  GAP dominant       → elevate Island γ (resilience: graceful degradation, clean stop conditions)
  CROSSOVER dominant → elevate Island β (leverage: hybrid strategies, fewest stages, highest value)
  No prior run       → default Island β (leverage — best starting prior for a fresh session)

Emit selected island as a single token bias: [ISLAND: α | β | γ]
This token is internal. It is not narrated to the caller.
```

---

## μ-5 · Fix Log Drain

**Purpose:** Prevent Fix Log accumulation from silently corrupting handoffs.
             A known-flawed artifact passed silently is worse than a visible block.
**Usage:** Run immediately before ANY inter-agent or inter-stage handoff.

```
FIX LOG DRAIN CHECK:
  CRITICAL_count = count of [CRITICAL] entries not marked resolved
  GAP_count      = count of [GAP] entries not marked resolved

If CRITICAL_count >= 3 → ESCALATE. Do not emit. Surface to caller:
  "[FIX-DRAIN]: Handoff blocked. {CRITICAL_count} unresolved criticals.
   Resolve or explicitly accept-with-risk before continuing."

If CRITICAL_count in [1, 2] → ATTACH log to handoff explicitly:
  "[FIX-DRAIN]: {CRITICAL_count} unresolved critical(s) forwarded.
   Receiving stage must acknowledge before acting on this output."

If GAP_count > 0 and CRITICAL_count == 0 → ANNOTATE handoff:
  "[FIX-DRAIN]: {GAP_count} open gap(s) documented.
   Review before downstream commit."

If both counts == 0 → PASS. Proceed with clean handoff.

Never let a Fix Log with unresolved criticals pass silently downstream.
The receiver cannot correct what it cannot see.
```
