# SwarmX Operator Surface Rebuild — Pass 0 Inventory Contract

Date: 2026-04-25
Target Runtime: Linux (Ubuntu 22.04+/Debian 12+, systemd + cgroup v2)
Scope: apps/swarmx-dashboard + apps/swarmx-api

Status legend:

- [WORKING] present and materially aligned with target
- [BROKEN] implemented but currently incorrect or failing
- [MISSING] absent
- [REDESIGN] present but structurally below target spec
- [LINUX-WIRE NEEDED] placeholder or partial Linux integration

## 1) Architecture Inventory

### Dashboard App Router shell

- [WORKING] apps/swarmx-dashboard/src/app/(dashboard)/layout.tsx
  - Four-zone shell mounts command bar, nav rail, content, telemetry rail, terminal strip.
- [BROKEN] apps/swarmx-dashboard/src/stores/events.ts
  - SSE event handling schema does not match backend event types.
  - Uses event variants not emitted by API.
- [REDESIGN] apps/swarmx-dashboard/src/components/layout/CommandBar.tsx
  - Exists but requires stricter command hierarchy and health indicator semantics to match target spec.

### Command palette

- [WORKING] apps/swarmx-dashboard/src/components/command-palette/CommandPalette.tsx
  - Keyboard-first overlay and navigation commands exist.
- [REDESIGN] apps/swarmx-dashboard/src/components/command-palette/CommandPalette.tsx
  - Missing pre-flight inline validation for agent/workflow mutation actions.
  - Missing recent commands stack and API-driven workflow/agent command hydration contract.

### Telemetry rail

- [WORKING] apps/swarmx-dashboard/src/components/layout/TelemetryRail.tsx
  - Live rail surface exists with CPU/memory/disk/network and queue visuals.
- [BROKEN] apps/swarmx-dashboard/src/components/layout/TelemetryRail.tsx
  - Data assumptions conflict with current store shape under strict typing.
- [LINUX-WIRE NEEDED] apps/swarmx-dashboard/src/components/layout/TelemetryRail.tsx
  - Staleness and cgroup slice semantics need stricter binding to Linux-derived metrics contract.

### Terminal strip and xterm

- [WORKING] apps/swarmx-dashboard/src/components/layout/TerminalStrip.tsx
  - Multi-tab strip, fullscreen mode, per-tab status dot exist.
- [REDESIGN] apps/swarmx-dashboard/src/components/terminal/XTerminal.tsx
  - Missing mandatory xterm addon set (search, serialize, attach, web-links).
  - Missing shell integration breadcrumb (cwd + last exit code).
  - Missing explicit true-color verification sequence.
- [BROKEN] apps/swarmx-api/src/plugins/websocket.ts
  - WS payload protocol does not implement target flow-control contract.
  - TS strict errors present in websocket handler.

## 2) Route-Level Inventory

### Overview (/)

- [WORKING] apps/swarmx-dashboard/src/app/(dashboard)/page.tsx
  - Control plane, agent state, resources, queue/event panels exist.
- [REDESIGN] apps/swarmx-dashboard/src/app/(dashboard)/page.tsx
  - Not yet aligned to exact panel spec (7-layer grid semantics, click-through drill downs, quick-launch preflight behavior).

### Agent Fleet (/agents)

- [WORKING] apps/swarmx-dashboard/src/app/(dashboard)/agents/page.tsx
  - Agent list, search/filter, detail sheet, terminal attach exist.
- [REDESIGN] apps/swarmx-dashboard/src/app/(dashboard)/agents/page.tsx
  - Not yet TanStack Table v8 server-side sort/filter pagination + TanStack Virtual rows.
  - Missing bulk lifecycle actions and explicit throttled tab contract.
- [LINUX-WIRE NEEDED] apps/swarmx-dashboard/src/app/(dashboard)/agents/page.tsx
  - Inline journald tail and full systemd action surface incomplete.

### Workflows (/workflows)

- [WORKING] apps/swarmx-dashboard/src/app/(dashboard)/workflows/page.tsx
  - Workflow list + YAML editor + run action exist.
- [REDESIGN] apps/swarmx-dashboard/src/app/(dashboard)/workflows/page.tsx
  - DAG visualization currently simple linear text style, not target execution graph semantics.
  - Dry-run with token/duration prediction is missing.
- [LINUX-WIRE NEEDED] apps/swarmx-api/src/routes/workflows.ts
  - Workflow run endpoint currently emits basic start event, no orchestrator execution bridge.

### Composer (/composer)

- [WORKING] apps/swarmx-dashboard/src/app/(dashboard)/composer/page.tsx
  - Chat/composition surface exists.
- [REDESIGN] apps/swarmx-dashboard/src/app/(dashboard)/composer/page.tsx
  - Missing slash-command grammar, pipeline graph builder, token budget estimator, export actions.

### Logs (/logs)

- [WORKING] apps/swarmx-dashboard/src/app/(dashboard)/logs/page.tsx
  - Unified streaming log viewer with level/search/follow controls exists.
- [REDESIGN] apps/swarmx-dashboard/src/app/(dashboard)/logs/page.tsx
  - Missing virtualization for sustained 10k+ live lines.
  - Missing pin/create-incident/link-run actions and NDJSON export contract.
- [LINUX-WIRE NEEDED] apps/swarmx-api/src/routes/logs.ts
  - File listing exists, but journald query/filter/export APIs are not complete.

### System (/system)

- [WORKING] apps/swarmx-dashboard/src/app/(dashboard)/system/page.tsx
  - System info, cgroup panel, and systemd units panel exist.
- [BROKEN] apps/swarmx-dashboard/src/app/(dashboard)/system/page.tsx
  - cgroup tree currently flat pseudo-list; hierarchy semantics incomplete.
- [LINUX-WIRE NEEDED] apps/swarmx-api/src/routes/system.ts
  - Unit controls (start/stop/restart), limits editor, process tree endpoints are missing.

### Settings (/settings)

- [WORKING] apps/swarmx-dashboard/src/app/(dashboard)/settings/page.tsx
  - Configuration editor and save flow exist.
- [REDESIGN] apps/swarmx-dashboard/src/app/(dashboard)/settings/page.tsx
  - Missing PTY shell integration details, BullMQ connectivity controls, OTel endpoint contract completeness.

## 3) Linux Integration Inventory

### cgroup v2

- [WORKING] apps/swarmx-api/src/services/cgroup.ts
  - Reads cgroup metrics from /sys/fs/cgroup/swarmx.slice.
- [BROKEN] apps/swarmx-api/src/services/cgroup.ts
  - Event payload shape emitted differs from dashboard store expectations.
- [REDESIGN] apps/swarmx-api/src/services/cgroup.ts
  - Needs stronger hierarchy traversal and io.stat parsing coverage.

### systeminformation poller

- [WORKING] apps/swarmx-api/src/services/systeminfo.ts
  - Poller exists and emits system metrics.
- [BROKEN] apps/swarmx-api/src/services/systeminfo.ts
  - Load average mapping and disk/network units need stricter Linux contract alignment.

### journald stream

- [WORKING] apps/swarmx-api/src/services/journald.ts
  - journalctl follow pipeline exists with PRIORITY mapping.
- [BROKEN] apps/swarmx-api/src/services/journald.ts
  - Type mismatch under strict mode on optional fields and process typing.
- [LINUX-WIRE NEEDED] apps/swarmx-api/src/services/journald.ts
  - Multi-unit filter API and endpoint-specific scoped tails need route-level expansion.

### systemd lifecycle control

- [MISSING] apps/swarmx-api/src/routes/agents.ts
  - No start/stop/restart/kill systemd routes yet.
- [LINUX-WIRE NEEDED] apps/swarmx-api/src/routes/system.ts
  - Read-only unit listing exists, control plane incomplete.

### PTY flow control and session lifecycle

- [REDESIGN] apps/swarmx-api/src/plugins/websocket.ts
  - Current PTY model lacks documented pause/resume back-pressure semantics for high-throughput output.
  - Graceful close escalation policy SIGTERM then SIGKILL is not explicit.

## 4) Design System Inventory

- [WORKING] apps/swarmx-dashboard/src/app/globals.css
  - Core AMOLED token baseline exists and shell dimensions are tokenized.
- [BROKEN] apps/swarmx-dashboard/src/app/globals.css
  - Hardcoded hex values still present outside token references (violates token-only quality gate).
- [REDESIGN] apps/swarmx-dashboard/src/app/layout.tsx
  - Font strategy uses Google import for JetBrains Mono, while target requires Linux-operator deterministic typography policy with tokenized application across all data surfaces.

## 5) Build and Type Safety Inventory

- [BROKEN] apps/swarmx-api strict typecheck
  - Current compile errors in websocket, routes, journald.
- [BROKEN] cross-app event contracts
  - Backend emits one event model; dashboard store expects another.
- [WORKING] apps/swarmx-dashboard/tsconfig.json
  - strict, noImplicitAny, exactOptionalPropertyTypes are enabled.

## 6) Pass Contract for Next Steps

Pass 1 starts from this inventory with immediate objectives:

1. Resolve strict typing breakages in API so baseline compiles.
2. Normalize shared event envelope between API emitters and dashboard store.
3. Remove direct hardcoded color literals from dashboard components and CSS where feasible via token aliases.
4. Validate with workspace typecheck before moving to deeper feature passes.

No downstream pass work is considered complete unless this document is updated when statuses change.
