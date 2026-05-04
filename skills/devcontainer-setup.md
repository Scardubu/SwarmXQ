# devcontainer-setup

Create reproducible devcontainer environments with pinned toolchains and persistent volumes.

- Triggers: devcontainer, container setup, reproducible env, toolchain, onboarding, local env, dev environment
- Stack: devops, generic
- Owner: platform
- Weight: 5

## When to activate
- Onboarding a new repo or team to a controlled development environment.
- Eliminating "works on my machine" failure modes.
- Freezing language runtimes and tool versions for a project lifecycle.

## Execution pattern

1. **Idempotency first.** Before writing a single line of setup: confirm the script is idempotent. Ask: what happens when a developer runs this twice? If the answer is "it fails or creates duplicates" — fix that before proceeding. Environment scripts that are not idempotent are time bombs that fire during onboarding, exactly when trust is lowest.

2. **Pin every toolchain version explicitly.** Node version, Python version, language runtime, package manager version, and key CLI tools all require explicit pins. "Latest" in a devcontainer is a reproducibility liability. Use `.nvmrc`, `.tool-versions`, or image tags with digests.

3. **Audit secret handling.** Secrets must never appear in: Dockerfile layers, environment echo output, shell history, devcontainer.json, or version-controlled files. Use secret mounting (Docker BuildKit secrets, devcontainer `secrets`, or a `.env` file outside version control). Verify there is a `.gitignore` entry for every secret-bearing file before proceeding.

4. **Define volume strategy.** Separate persistent volumes (node_modules, build cache, IDE extensions) from ephemeral workspace data. Persistent volumes survive container rebuilds; ephemeral data does not. Misclassification causes either slow rebuilds or lost state — make the policy explicit.

5. **Verify on a clean machine.** The only valid test of an environment setup is: it works on a machine with no prior state. Document the verification command explicitly. A setup that requires prior state to work is not a setup — it is a partial migration.

6. **Add a health check.** After setup, provide a single command that verifies the environment is correct: language version, key tools present, dependencies installed, and dev server starts. If the health check passes, the environment is ready. If it fails, the error message should tell the developer what to fix.

## Failure modes to avoid
- Setup scripts that assume prior state (prior Node version, cached packages, existing config files).
- Secrets embedded in Dockerfile layers (they survive layer removal via docker history).
- Missing idempotency causing double-installation conflicts on re-run.

## Output contract
- Idempotency guarantee: the script can be run N times with the same result.
- Toolchain manifest: all pinned versions with their source of truth.
- Secret handling: what secrets are needed, how they are injected, what must not be committed.
- Volume strategy: what persists vs. what is ephemeral and why.
- Health check command: single command to verify environment correctness.

## Elite operating discipline
- Prefer the smallest useful action that still satisfies the objective.
- For non-trivial tasks, compare 2-3 internal variants, run one skeptical check, and keep the winner silently.
- Keep assumptions explicit, outputs directly usable, and failure signals short and concrete.
- Stop early when the requested boundary is satisfied; do not smuggle in unrelated improvements.

## Elite augmentation
- Preserve the original interface, workflow, and external behavior.
- Make the smallest change that fully satisfies the stated objective.
- Validate the result against the most likely downstream consumer.
- Return only the artifact or decision this skill is meant to produce.
