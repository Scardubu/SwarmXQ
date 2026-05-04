# predictive-downstream-simulation

Simulate the next 2–3 agent hops before committing to a path. Reject options that amplify risk, create hidden coupling, or make recovery harder.

- Triggers: downstream, simulate, predict impact, future stages, dependency check
- Stack: generic
- Owner: system
- Weight: 5

## When to activate
- During latent-ensemble-selection, before scoring variants.
- When an Evolver proposal or architectural change propagates through multiple stages.
- When the Workflow Composer is selecting the execution graph.
- Any time an irreversible action is under consideration.

## Execution pattern

1. **Map the next 2–3 downstream consumers.** For the proposed output/action, identify: which agent or system receives it next? Which agent receives that agent's output? Limit to 3 hops — beyond that, uncertainty dominates and precision is theater.

2. **For each hop, simulate the failure mode.** Ask: if this proposal is wrong, what breaks at hop 1? Does that failure propagate to hop 2? Does the error at hop 2 become unrecoverable by hop 3? A recoverable error at hop 1 is acceptable. An unrecoverable error at hop 3 is not.

3. **Score each candidate on downstream risk.** Three levels:
   - **Green**: failure at any hop is detectable and recoverable without data loss or boundary violation.
   - **Yellow**: failure is recoverable but requires manual intervention or rollback.
   - **Red**: failure propagates silently, reaches a boundary violation, or causes data loss.

4. **Reject Red paths outright.** Select the highest-scoring variant that avoids Red downstream risk. If all variants score Red: stop, surface the risk, and request a fundamentally different approach.

5. **Emit a downstream-risk note for Yellow paths.** The note must name the specific hop where manual recovery would be needed.

## Failure modes to avoid
- Simulating only the immediate next step — most cascade failures appear at hop 2 or 3.
- Accepting a Red path because the upstream output "looks right."
- Skipping this step for "simple" changes — the simplest changes often have the most hidden coupling.

## Output contract
- Downstream risk score per candidate: Green / Yellow / Red.
- Failure mode description: which hop, what breaks, why.
- Recommended path: the candidate with the best downstream risk profile.
- Blocking note: present only for Red paths explaining why they were rejected.

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
