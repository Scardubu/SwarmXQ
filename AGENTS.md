Repository Engineering Contract
Project Discovery
Before implementing work:
    1. read the root README and applicable documentation;
    2. inspect workspace manifests and package scripts;
    3. map applications, packages, services, data stores, queues, and external dependencies;
    4. identify existing architecture and naming conventions;
    5. inspect the relevant tests;
    6. inspect configuration and deployment files;
    7. inspect current working-tree changes.
Do not infer the stack from prior experience. Verify it from the repository.
Monorepo Boundaries
Each workspace should expose a clear public surface.
Applications may depend on shared packages. Shared packages must not import applications.
Keep:
    • domain contracts in shared schema/type packages;
    • UI-only primitives in UI packages;
    • persistence adapters in backend-owned packages;
    • runtime-specific code outside universal packages;
    • generated code clearly separated from handwritten code.
Avoid deep imports into another package’s private directories.
When changing a shared contract:
    1. identify every consumer;
    2. preserve compatibility or provide a coordinated migration;
    3. update tests and documentation;
    4. verify all affected workspaces.
Product and Architecture Decisions
Before a substantial feature, write a concise implementation brief:
User outcome:
Current behavior:
Target behavior:
Primary flow:
Failure states:
Data contracts:
Security boundaries:
Performance constraints:
Compatibility constraints:
Validation plan:
The brief is a working tool, not ceremony. Keep it proportionate to the task.
API and UI Contract
Public API responses must use stable schemas.
Represent asynchronous operations with explicit states such as:
queued
running
completed
failed
cancelled
Do not infer completion from request acceptance.
For generated or uploaded artifacts, verify:
    • file exists;
    • size is nonzero;
    • format is valid;
    • metadata reflects the real file;
    • public access route works;
    • authorization is correct.
A placeholder, stub, or mock must be visibly identified and must never satisfy a production success gate.
Reliability Requirements
All outbound calls require:
    • explicit timeout;
    • cancellation;
    • bounded response size where relevant;
    • typed parsing;
    • failure classification;
    • deliberate retry policy.
All queues require:
    • idempotent submission or documented duplicate semantics;
    • bounded attempts;
    • terminal-state rules;
    • queue-depth protection;
    • recovery behavior;
    • observable attempt count.
All background workers require graceful shutdown and must stop accepting new work before process termination.
Observability Requirements
Use structured logs.
Include where applicable:
timestamp
level
service
environment
requestId
traceId
spanId
jobId
userId or tenantId when safe
operation
durationMs
status
errorCode
retryAttempt
Do not create high-cardinality metric labels from raw IDs or user input.
Instrument critical paths with:
    • request rate;
    • error rate;
    • latency;
    • saturation;
    • queue depth;
    • retry count;
    • timeout count;
    • dependency health;
    • resource pressure.
Use consistent OpenTelemetry semantic attributes when available.
Dependency Policy
Before adding a dependency, establish:
    • existing code cannot reasonably provide the capability;
    • package is actively maintained;
    • license is acceptable;
    • bundle/runtime cost is justified;
    • security history is acceptable;
    • dependency does not duplicate an existing library.
Use the repository’s package manager. Never create a second lockfile.
Documentation Policy
Update documentation when changing:
    • setup;
    • environment variables;
    • commands;
    • public APIs;
    • architectural boundaries;
    • deployment;
    • migrations;
    • operational behavior;
    • user-visible workflows.
Examples must be executable and must match current contracts.
Repository Definition of Done
Run the repository’s own scripts. At minimum verify:
lint
typecheck
targeted tests
production build
runtime smoke test
Add package-specific checks when touched.
Review:
git diff --check
git diff --stat
git diff
