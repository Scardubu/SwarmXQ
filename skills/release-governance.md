# release-governance

Apply safe gating, approvals, and release sequencing.

- Triggers: release, approval, governance, rollout, gate, go no-go, production deploy, ship
- Stack: devops, security
- Owner: release
- Weight: 4

## When to activate
- Preparing a release for production deployment.
- Designing or auditing the approval workflow for a deployment pipeline.
- Deciding whether a change is safe to ship given current evidence.

## Execution pattern

1. **Define go/no-go criteria before the release begins.** Go criteria must be: observable (not "it feels stable" — "error rate < 0.1% for 30 minutes post-deploy"), owned (who is responsible for verifying each criterion), and binary (pass or fail — not "mostly okay"). A release without defined go criteria is a release without a stopping rule.

2. **Sequence approvals by risk.** The approval chain should match the risk profile: low-risk changes (config flags, copy updates) require one approval; medium-risk changes (schema migrations, new service dependencies) require two approvals with evidence; high-risk changes (payment flows, auth, data deletions) require senior approval and a rollback drill before proceeding.

3. **Enforce evidence gates, not time gates.** "We will wait 24 hours" is not a safety gate — it is a ritual. The gate should close when evidence (metrics, logs, error rates) shows the change is behaving as expected, not when time has elapsed. Evidence gates are actionable; time gates are not.

4. **Require a tested rollback path.** Every production deployment must have a documented and tested rollback procedure. "We can just revert the commit" is not a tested rollback — it is a theory. Test the rollback in a staging environment before the production deploy. This is non-negotiable for database migrations, feature flag releases, and infrastructure changes.

5. **Define the monitoring window.** After a release: how long is the watchful period? What metrics are being watched? Who is watching them? What is the escalation path if an anomaly appears? A release without a monitoring window is a change that is shipped and immediately forgotten.

6. **Escalate instead of compromising the gate.** When stakeholders pressure a release despite a failing gate: document the risk, record the override decision with the approver's name and rationale, and ensure the team knows the risk has been accepted — not resolved. Speed pressure from stakeholders is not evidence of safety.

## Failure modes to avoid
- Go criteria defined in terms of time elapsed rather than observable system behavior.
- Rollback paths that are documented but untested.
- Release gates that are softened under deadline pressure without explicit risk acceptance.

## Output contract
- Go/no-go criteria: observable conditions, owner per criterion, binary pass/fail.
- Approval chain: required approvers, evidence needed per approval level.
- Rollback procedure: steps, verification, and who owns execution.
- Monitoring window: duration, metrics watched, escalation path.
- Gate result: pass / conditional-pass (with explicit risk acceptance) / hold.

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
