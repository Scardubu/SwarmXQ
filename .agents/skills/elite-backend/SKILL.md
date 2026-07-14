Elite Backend Workflow
Objective

Deliver a secure, observable, failure-aware, test-covered backend implementation that preserves data integrity and behaves correctly under retries, concurrency, dependency failure, and resource pressure.

Workflow
1. Map the use case

Identify:

Caller:
Authentication:
Authorization:
Input contract:
Output contract:
Side effects:
Data stores:
External dependencies:
Queue or worker behavior:
Idempotency requirement:
Timeout budget:
Failure states:
Observability:

Trace current behavior through routes, services, repositories, queues, and adapters.

2. Model the invariants

Write down the rules that must always remain true.

Examples:

one active job per idempotency key;
completed artifact always maps to a real validated file;
tenant cannot read another tenant’s record;
retry cannot duplicate an irreversible side effect;
state transition cannot move backward unexpectedly.

Enforce critical invariants at the strongest appropriate layer.

3. Define contracts

Use runtime schemas for untrusted input and external responses.

Define stable:

success response;
error response;
error codes;
retryability;
job states;
event payloads.

Reject unknown privileged fields.

4. Establish failure policy

For each dependency, define:

timeout
cancellation
retryable failures
maximum attempts
backoff
fallback
circuit or load-shedding behavior
observability

Do not turn dependency failure into false success.

5. Implement through correct layers

Keep:

routes thin;
policies in services/domain;
persistence in repositories;
infrastructure details in adapters;
schemas and contracts reusable.

Preserve compatibility unless migration is part of the task.

6. Secure the operation

Verify:

authentication;
object ownership;
role or capability;
tenant boundary;
resource limits;
output filtering;
safe outbound access;
secret handling;
auditability.

Test the negative authorization path.

7. Protect data integrity

Use:

transactions;
constraints;
idempotency records;
version checks;
deterministic state transitions;
atomic file operations.

Do not place slow network calls inside database transactions.

8. Add observability

Add structured events and measurements for:

request;
use-case outcome;
dependency latency;
retry;
timeout;
queue wait;
terminal failure;
saturation.

Use existing telemetry abstractions.

9. Test failure behavior

Cover:

success;
malformed input;
unauthorized;
forbidden;
conflict;
duplicate request;
timeout;
dependency unavailable;
malformed dependency response;
concurrency;
retry exhaustion;
rollback;
restart behavior where material.
10. Verify operationally

Run:

typecheck;
targeted tests;
database tests if touched;
production build;
API smoke test;
health/readiness checks;
relevant logs and metrics;
migration inspection when applicable.
Output Contract

Report:

Use case:
Invariants protected:
Contracts changed:
Security controls:
Reliability controls:
Observability:
Files changed:
Validation evidence:
Remaining operational risks: