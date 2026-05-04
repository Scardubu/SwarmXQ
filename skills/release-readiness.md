# release-readiness

Prepare changelogs, manifests, and rollout notes for production delivery.

- Triggers: ship, publish, deploy, release notes, changelog, manifest, rollout, cut release
- Stack: devops
- Owner: release
- Weight: 4

## When to activate
- Preparing a release package before a production deploy.
- Auditing a release for missing documentation, untested dependencies, or incomplete migration paths.

## Execution pattern

1. **Write the changelog first.** The changelog is the contract between the release and its consumers. Format: breaking changes (explicit and prominent), new features with their activation requirements, bug fixes with the symptom they resolve, and dependency upgrades with their security or behavior impact. A changelog that says "various improvements and bug fixes" provides zero value to operators, on-call engineers, or downstream service owners.

2. **Audit all new dependencies.** For every new or upgraded dependency: verify it is not introducing a known CVE, confirm the license is compatible with the project, and verify the imported version is pinned. Unpinned dependencies in a release artifact make the build non-reproducible.

3. **Verify migration paths are complete.** If the release includes schema migrations, config changes, or API deprecations: confirm the migration path is documented, tested in staging, and reversible. A release that requires a migration without a rollback path is a one-way door.

4. **Confirm smoke tests pass.** The minimum acceptable validation for a release is: the primary user flows work in the staging environment against the release artifact. If smoke tests do not exist for the primary flows — add them before shipping. A release that cannot be verified in staging is a production experiment.

5. **Prepare the rollout sequence.** Define: deployment order (if multi-service), feature flag state, traffic percentage for canary (if applicable), success criteria at each stage, and who has the authority to halt the rollout. A rollout without a halt condition is not a controlled rollout.

6. **Produce the release manifest.** Artifact: the release tag or version, all component versions included, the environment it was tested in, the test evidence, the deployment date, and the on-call owner for the 24-hour post-release window.

## Failure modes to avoid
- Changelogs that describe changes at the implementation level ("refactored module X") rather than impact level ("login no longer requires two-factor for SSO users").
- Release manifests that omit the test environment or test evidence.
- Rollouts without a defined halt condition and halt authority.

## Output contract
- Changelog: breaking changes, new features, bug fixes, dependency updates — each with impact description.
- Dependency audit: new/upgraded dependencies with CVE, license, and pin status.
- Migration checklist: schema/config/API migrations with tested rollback paths.
- Smoke test evidence: which flows were tested, in which environment, with what result.
- Release manifest: version, components, test evidence, deployment date, on-call owner.

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
