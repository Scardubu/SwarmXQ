# incident-command

Stabilize outages, coordinate mitigation, and preserve a clean postmortem trail.

- Triggers: incident, outage, postmortem, rollback, blameless, degraded, on-call, escalation, sev
- Stack: devops, security
- Owner: release
- Weight: 5

## When to activate
- A system degradation or outage is detected in production.
- An escalation arrives from monitoring, on-call, or a user report.
- A post-incident review needs to be structured.

## Execution pattern

1. **Classify severity before anything else.** SEV1: service is completely unavailable or data is being corrupted. SEV2: core functionality is degraded but a workaround exists. SEV3: minor degradation, no user-facing impact. Severity drives the response protocol, team size, and communication cadence. Misclassifying SEV1 as SEV3 is a compounding error.

2. **Stabilize before analyzing.** The first objective is to stop the bleeding — not to understand why it is bleeding. Apply the fastest available mitigation (rollback, feature flag disable, traffic rerouting, cache flush) before spending time on root cause analysis. An elegant root cause explanation does not help users who cannot access the service right now.

3. **Declare ownership immediately.** Assign one incident commander. Assign one communications lead. Ambiguous ownership produces duplicated efforts, contradictory updates, and missed decisions. The commander makes decisions; the communications lead produces updates. These are not the same person.

4. **Preserve evidence continuously.** Write down: the timeline (with timestamps), the symptoms observed, the mitigation steps attempted, and the outcomes of each step. Evidence captured during the incident is the most reliable source for the postmortem. Evidence reconstructed from memory three days later is not reliable.

5. **Communicate at cadence.** External updates every 15 minutes (SEV1), 30 minutes (SEV2) during active incidents. Internal channel updates as decisions are made. Silence during an incident destroys trust faster than honest uncertainty.

6. **Declare resolution only when validated.** Resolution requires: the symptom is no longer present, the mitigation is holding, monitoring shows normal baseline, and a watchful period has begun (minimum 15 minutes for SEV1, 5 minutes for SEV2). "I think it's fixed" is not a resolution declaration.

## Failure modes to avoid
- Jumping to root cause analysis before stabilization is confirmed.
- Multiple people taking independent mitigation actions without coordination (conflicting changes compound the incident).
- Declaring resolution before the monitoring baseline has returned to normal.

## Output contract
- Severity classification with rationale.
- Timeline: symptoms detected, mitigation applied, outcome of each step, resolution declared.
- Current status: stabilized / investigating / resolved.
- Postmortem draft: what happened, what was the root cause, what prevented faster detection, what prevents recurrence.

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
