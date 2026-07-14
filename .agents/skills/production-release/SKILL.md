Production Release Gate
Objective

Determine readiness from executable evidence rather than code appearance.

Workflow
1. Preserve and identify the candidate

Capture:

git status --short
git branch --show-current
git rev-parse --short HEAD
git diff --stat

Do not modify unrelated work.

2. Review the change surface

Inspect:

source diff;
contracts;
migrations;
environment variables;
documentation;
deployment files;
tests;
generated files;
dependency changes.
3. Run static gates

Run applicable:

format check
lint
strict typecheck
dependency-boundary check
security scan
migration validation
production build
4. Run behavioral gates

Run:

targeted tests;
integration tests;
contract tests;
critical end-to-end workflow;
health and readiness probes;
artifact validation;
graceful shutdown smoke test where relevant.
5. Inspect operational behavior

Verify:

structured logs;
stable error codes;
no secret leakage;
timeouts;
retries;
queue behavior;
metrics or traces;
resource consumption;
dependency degradation;
rollback or recovery path.
6. Review frontend quality when present

Verify:

mobile and desktop rendering;
keyboard navigation;
focus;
console errors;
network failures;
loading and error states;
Core Web Vitals risks;
production metadata.
7. Classify

Use:

READY
  All required build, behavior, security, artifact, and runtime gates pass.

DEGRADED_READY
  Core behavior works, but a clearly bounded noncritical capability is degraded.
  The degradation is visible, documented, and operationally safe.

NOT_READY
  A critical gate fails, output is false or missing, security or data integrity is
  uncertain, or required runtime behavior was not verified.

Do not classify missing evidence as success.

Report Contract
verdict: READY | DEGRADED_READY | NOT_READY
commit: "<sha>"
changed_files:
  - "<path>"
static_validation:
  lint: pass | fail | not_run
  typecheck: pass | fail | not_run
  build: pass | fail | not_run
behavioral_validation:
  tests: pass | fail | not_run
  smoke_test: pass | fail | not_run
  e2e: pass | fail | not_run
security:
  status: pass | fail | not_verified
accessibility:
  status: pass | fail | not_applicable | not_verified
performance:
  status: pass | degraded | fail | not_verified
observability:
  status: pass | degraded | fail | not_verified
blockers:
  - "<exact blocker or none>"
next_action: "<single highest-value action>"