Elite Backend and Platform Engineering Instructions
Backend Mission

Build services that remain correct under:

malformed input;
duplicate requests;
concurrent requests;
dependency failure;
timeout;
cancellation;
process restart;
partial infrastructure outage;
elevated load;
low-memory conditions.

A successful HTTP status is not proof that an asynchronous workflow completed.

Layering

Keep routes thin.

Recommended ownership:

Route or transport:
  authentication
  authorization entry point
  schema validation
  protocol translation
  response mapping

Application service:
  use-case orchestration
  transaction boundary
  policy enforcement
  dependency coordination

Domain:
  invariants
  state transitions
  calculations
  domain errors

Repository or adapter:
  database or external-system access
  persistence translation

Do not place SQL, queue coordination, or complex business logic directly in route handlers.

Fastify

When using Fastify:

organize capabilities as plugins;
define request and response schemas;
use encapsulation deliberately;
test through fastify.inject() where suitable;
configure structured logging;
centralize stable error translation;
add hooks only at the narrowest required scope;
close resources during shutdown.

Do not mutate global Fastify state from unrelated plugins.

Input and Output Contracts

Define runtime schemas for:

params;
query strings;
headers when material;
request bodies;
successful responses;
documented errors.

Reject unknown or privileged fields when mass assignment is possible.

Keep response contracts stable.

Do not expose database records directly when they contain internal or sensitive fields.

Authentication and Authorization

Authentication establishes identity. Authorization establishes permission.

Check authorization against the requested object, tenant, and operation.

Never rely solely on:

possession of an identifier;
a hidden UI control;
client-provided tenant ID;
route-level authentication;
an “admin” string without validated role semantics.

Use deny-by-default behavior.

Error Model

Use stable error codes such as:

VALIDATION_FAILED
UNAUTHENTICATED
FORBIDDEN
NOT_FOUND
CONFLICT
RATE_LIMITED
DEPENDENCY_UNAVAILABLE
TIMEOUT
RESOURCE_EXHAUSTED
INTERNAL_ERROR

Separate:

safe client message;
internal diagnostic context;
retryability;
HTTP status;
causal error.

Do not return raw exceptions or stack traces.

Timeouts, Cancellation, and Retries

Every external call must have a timeout.

Propagate cancellation.

Separate:

connection timeout;
response timeout;
overall operation deadline;
queue timeout;
model-load timeout;
inference timeout.

Retries must be:

bounded;
observable;
limited to transient failures;
idempotent;
protected by backoff and jitter.

Never retry validation, authorization, deterministic model-capability, or permanent configuration failures.

Idempotency

Use idempotency keys for operations likely to be retried externally, especially:

payment-like actions;
job creation;
webhook handling;
artifact generation;
resource provisioning.

Persist enough information to return the prior result safely.

Define behavior for:

same key and same payload;
same key and different payload;
in-progress operation;
failed terminal operation;
expiration.
Concurrency and State Machines

Represent workflows with explicit valid transitions.

Prevent impossible transitions using:

database constraints;
compare-and-swap updates;
transactions;
locks only when justified;
version fields;
unique constraints.

Do not let a retrying job remain displayed as queued while it is executing.

Record:

attempt count;
current stage;
stage start and end;
terminal error;
progress timestamp;
output identity.
Database Access

Keep transactions short.

Do not make slow network or model calls inside database transactions.

Use:

unique constraints for uniqueness;
foreign keys for referential integrity;
indexes based on observed query patterns;
pagination for unbounded collections;
explicit selected fields;
batch loading to prevent N+1 behavior.

Investigate query plans before adding speculative indexes.

Caching

Every cache must define:

ownership;
key format;
value schema;
TTL;
invalidation;
maximum size;
stale behavior;
stampede protection;
failure behavior.

Caches must not weaken authorization or tenant isolation.

The source of truth must remain explicit.

Files and Artifacts

For file operations:

resolve paths against an approved root;
reject traversal;
validate MIME type and extension independently;
impose size limits;
use atomic writes where relevant;
verify existence and nonzero size;
calculate integrity metadata;
clean temporary files;
authorize downloads;
set safe content headers.

Never mark a generated artifact complete before validating the real file.

SSRF and Outbound Requests

Do not fetch arbitrary user-provided URLs.

Use:

allowed schemes;
host allowlists;
DNS and IP validation;
redirect limits;
private-network protection;
response size limits;
content-type validation;
timeouts.

Revalidate redirects rather than trusting the original host check.

Resource Protection

Bound:

body size;
file size;
query complexity;
pagination size;
concurrency;
queue depth;
model context;
output tokens;
subprocess runtime;
memory-heavy operations.

Return an explicit resource-exhaustion response rather than destabilizing the host.

Logging and Telemetry

Log structured events at ownership boundaries.

Avoid duplicate logging of the same failure at every layer.

Measure:

route latency;
dependency latency;
stage latency;
error code;
retry attempt;
queue wait;
active jobs;
memory pressure;
saturation.

Use correlation IDs across HTTP, queues, workers, and generated artifacts.

Graceful Shutdown

On termination:

stop accepting new work;
mark readiness false;
cancel or drain bounded work;
close queue consumers;
close database and cache clients;
flush telemetry;
exit within a defined deadline.

Do not continue accepting jobs during shutdown.

Backend Verification

For each changed use case, test:

valid request;
invalid request;
unauthenticated request;
forbidden object access;
duplicate request;
dependency failure;
timeout;
cancellation;
concurrent execution where material;
persistence rollback;
graceful shutdown impact.

Run a real health and readiness smoke test after starting the production build.