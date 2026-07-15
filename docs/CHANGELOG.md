# SwarmX Changelog

<!-- markdownlint-disable MD024 MD032 -->

---

## V6.2.8 — Final Runtime and Dashboard Polish (2026-07-15)

### Dashboard reliability and accessibility

- Added a bounded 30-second REST fallback for the Agent Fleet only while its
  SSE connection is disconnected, so live data recovers without imposing a
  duplicate polling loop during normal streaming.
- Replaced misleading cgroup `treegrid` semantics with a native accessible
  metrics table because the API supplies a flat scope collection, not a
  parent-child hierarchy.
- Announced Agent Fleet and System loading states to assistive technology and
  increased the refresh control to a touch-friendly target.
- Removed raw route-boundary exception messages and digests from the operator
  UI while retaining structured client-side diagnostics.

### Video runtime and documentation

- Aligned API video export and render-workspace defaults with
  `configs/video.defaults.yaml`: `.swarmx/video/exports` and
  `.swarmx/video/tmp`.
- Updated the video configuration, duration, audio fallback, and first-job
  admission documentation to match source behavior.
- Reframed the obsolete V5 Modelfile document and the r7 migration manual as
  historical references; the supported policy is canonical tags with strict
  single-model residency on 8 GB hosts.

### Validation

- API regression scripts, dashboard tests, lint, workspace type checks, and
  production builds passed before release.

---

## V6.2.7 — Degraded Runtime Health Integration (2026-07-15)

### Health and performance

- Bounded `/api/system/health` Ollama liveness probes to a dedicated
  `SWARMX_SYSTEM_HEALTH_PROBE_TIMEOUT_MS` budget (default: 1500 ms).
- Stopped model-list discovery when Ollama liveness has already failed, so an
  unavailable backend returns a bounded HTTP `200` degraded response instead of
  waiting for readiness work that cannot succeed.
- Added `SWARMX_SYSTEM_HEALTH_MODEL_PROBE_TIMEOUT_MS` (default: 2500 ms) for
  bounded readiness checks after Ollama is confirmed live.

### Dashboard UX

- Centralized dashboard API/Ollama/RAM recovery guidance through a shared
  runtime policy and React Query health cache.
- Deduplicated health polling across the dashboard shell, Composer, and video
  workspace with a 12-second shared cadence, three-second client budget, and no
  automatic retry storm.
- Made API and Ollama health badges visible at compact widths and clarified
  recovery instructions in the global banner and video workspace.

### Tests and documentation

- Added pure runtime-guidance coverage and an API system-health regression
  script that validates bounded configuration and explicit offline model state.
- Updated the environment template, startup/config references, installation
  pnpm version, and canonical architecture terminology.

---

## V6.2.6 — Low-RAM Runtime Finalization & Video Render Hardening (2026-07-14)

### Runtime

- Enforced 8 GB defaults across startup, Docker, setup helpers, and health checks:
  `OLLAMA_MAX_LOADED_MODELS=1`, `OLLAMA_NUM_PARALLEL=1`, and `OLLAMA_KEEP_ALIVE=0`.
- Made Relay startup prewarm and speculative specialist prewarm opt-in with
  `SWARMX_MODEL_STARTUP_PREWARM=1` and `SWARMX_MODEL_PREDICTIVE_PREWARM=1`.
- Shortened request-level keep-alive windows for Relay, Pilot, and non-7B Phi4
  operators; 7B specialists continue to unload after calls outside explicit
  evolver reuse windows.
- Added pre-eviction headroom checks before 7B loads and refreshed `/api/ps`
  residency state before eviction decisions.

### Video

- Added a bounded FFmpeg render smoke test that creates and probes a real MP4.
- Required `ffmpeg`, `ffprobe`, and `espeak-ng` for local voiced production
  renders; silent output is opt-in only.
- Added artifact validation before completed status: file existence, nonzero
  size, duration, dimensions, frame rate, and format.
- Added backward-compatible creative request fields for audience, tone, style,
  caption style, and voice.

### Tooling And Docs

- Added root workspace `test`, `lint`, `typecheck`, and `build` scripts.
- Restored reproducible Python validation through project dev dependencies and
  deterministic async paths that no longer hang during default-executor teardown.
- Updated setup, startup, config, video, and low-RAM documentation with clean
  clone commands and current hardware constraints.

---

## V6.2.5 — UI/UX Polish & Accessibility Quick Wins (2026-07-05)

Systematic quality pass across all video dashboard components. Resolves WCAG AA violations, eliminates per-render object allocations, and ships the missing right-panel empty state.

### Dashboard — Accessibility

- `apps/swarmx-dashboard/src/components/video/ViralityMeter.tsx`
  - **Hoisted `<Tooltip.Provider>`** out of `DimensionBar` into a single wrapper around the dimension bars grid. Previously a new Provider context was mounted for each of the 5 bars per render.
  - Added `role="progressbar"` with `aria-valuenow/min/max` and `aria-label` to the compact variant bar — was previously an unsemantic `<div>` with no ARIA role.

- `apps/swarmx-dashboard/src/components/video/VideoJobCard.tsx`
  - Added `tabIndex={0}`, `role="button"`, `aria-label`, `onKeyDown` (Enter/Space → select), and `focus-visible:ring-2` to `<article>` — was click-only, entirely keyboard-inaccessible.
  - Cancel and download action buttons: added `focus-visible:opacity-100` and `focus-visible:ring-2` so they are reachable without a mouse (previously `opacity-0` until hover).
  - Cancel/download `aria-label` now includes the job prompt.

- `apps/swarmx-dashboard/src/components/video/CaptionEditor.tsx`
  - Added `id` attributes to all 6 form controls and matching `htmlFor` to all `<label>` elements — previously no labels were programmatically associated with their controls (WCAG 1.3.1 failure).
  - Added `role="alert"` to the rescore error container — screen readers now announce API failures immediately.
  - Sound Suggestion input: added consistent `focus:outline-none focus:ring-1 transition-colors` focus ring.
  - Error copy: replaced code-language `"firstLine cannot start with I/My/This/We/Our"` with a user-readable message.

- `apps/swarmx-dashboard/src/components/video/PlatformPublishPanel.tsx`
  - Status feedback paragraph: added `role="status"` and `aria-live="polite"` — publish outcome was previously announced only visually.
  - History scroll container: added descriptive `aria-label` with event count.

- `apps/swarmx-dashboard/src/app/(dashboard)/video/[id]/page.tsx`
  - Replaced ASCII arrows `"<- Back to Queue"` / `"Video -> "` with Unicode `←` / `→`.
  - `!job` loading state now renders `<VideoJobDetailLoading />` skeleton instead of plain text.
  - `<video>` element: added `aria-label` containing the job prompt.
  - Operator trace `<table>`: added `<caption className="sr-only">` — was a table with no accessible name.

### Dashboard — Performance

- `apps/swarmx-dashboard/src/components/video/VideoJobCard.tsx`
  - Moved `StatusBadge` status map to module-scope constant `STATUS_MAP` — was recreated on every render.

### Dashboard — UX

- `apps/swarmx-dashboard/src/app/(dashboard)/video/page.tsx`
  - Added right-panel empty state (visible above `lg` breakpoint) prompting users to select a job — layout previously left the right column blank.
  - Derived `runningCount`, `queuedCount`, `doneCount` once — was calling `jobs.filter().length` three times inline in JSX.
  - Retry button `aria-label` now includes the job prompt (first 50 chars).

- `apps/swarmx-dashboard/src/components/video/CaptionEditor.tsx`
  - Moved `DISALLOWED_OPENERS` array to module scope — was recreated on every render.

### Validation status

- `pnpm --filter @swarmx/dashboard lint` — **0 errors, 0 warnings**.
- `pnpm --filter @swarmx/dashboard typecheck` — **clean**.

---

## V6.2.4 — Accessibility, Error Boundaries & Code Quality (2026-07-05)

Systematic audit pass following V6.2.3. Adds missing Next.js route boundaries, closes accessibility gaps across all video UI components, and removes production anti-patterns.

### Dashboard — New route files

- `apps/swarmx-dashboard/src/app/(dashboard)/video/[id]/error.tsx` *(new)*
  - Error boundary for the job detail route. Shows a job-scoped error state with "Try again" and "Back to jobs" affordances. Was previously missing — any unhandled error in the detail page would propagate to the root layout boundary with no route-level recovery path.

- `apps/swarmx-dashboard/src/app/(dashboard)/video/[id]/loading.tsx` *(new)*
  - Suspense skeleton for the job detail route. Renders animated placeholder sections for the header, progress timeline, and metadata panel while the page component loads.

### Dashboard — Accessibility improvements

- `apps/swarmx-dashboard/src/components/video/CaptionEditor.tsx`
  - Added `aria-label` to "Re-score", "Copy Caption", and "Reset" action buttons. Copy button label dynamically reflects state ("Caption copied to clipboard" / "Copy full caption to clipboard").

- `apps/swarmx-dashboard/src/components/video/ViralityMeter.tsx`
  - Added `aria-label` to the "Improve" button: "Get AI recommendations to improve virality score".

- `apps/swarmx-dashboard/src/components/video/PlatformPublishPanel.tsx`
  - Added dynamic `aria-label` to the publish/schedule button that includes platform name and current state (publishing in progress, schedule, or publish).

- `apps/swarmx-dashboard/src/app/(dashboard)/video/page.tsx`
  - Added `aria-label` to draggable job containers (describes job prompt for screen readers).
  - Added `aria-label` to the "Retry from Failed Stage" button.

### API — Code quality

- `apps/swarmx-api/src/services/video-orchestrator.ts`
  - Replaced `console.log` with `process.stderr.write` for the SINGLE-7B eviction log line. Eliminates the last `console.log` in the orchestration path; all observability output now goes to stderr in a structured format consistent with pino's output stream.

- `apps/swarmx-api/src/routes/workflows.ts`
  - Replaced `res: any` with `res: import("http").IncomingMessage` in the HTTP callback. Eliminates the last untyped `any` in the API routes layer.

### Validation status

- `pnpm --filter @swarmx/dashboard lint` — **0 errors, 0 warnings**.
- `pnpm --filter @swarmx/dashboard typecheck` — verified clean.
- `pnpm --filter @swarmx/api typecheck` — verified clean.
- Python test suite (204 tests) — all passed.

---

## V6.2.3 — Production Readiness Pass (2026-07-05)

Codebase audit pass eliminating all React Compiler violations, stale Python test assertions, and unused-variable warnings introduced during the VIDEO-ALPHA integration. Zero regressions.

### Dashboard

- `apps/swarmx-dashboard/src/components/video/VideoJobCard.tsx`
  - **[V5.9-FIX-10]** Replaced impure `Date.now()` call during render (React Compiler rule violation) with a `useState` + `useEffect` ticker pattern. Elapsed time now updates every second while the job is `running` and remains stable otherwise.

- `apps/swarmx-dashboard/src/app/(dashboard)/video/page.tsx`
  - **[V5.9-FIX-11]** Removed closure over `queuedJobs` snapshot inside `handleDropOn` — the React Compiler correctly flagged this as a mutable dependency that caused the `useCallback` memoization to be skipped entirely. The callback now reads live queue state via `useVideoStore.getState().listJobs()`, which is safe inside a callback and compiler-transparent.
  - Removed the now-unnecessary `queuedJobs` derived variable.

- `apps/swarmx-dashboard/src/components/video/CaptionEditor.tsx`
  - Added `eslint-disable-next-line` comment with rationale on the intentionally unused `jobId` destructure (`_unusedJobId`) to suppress the `no-unused-vars` warning cleanly without altering the component's public API.

### Python tests

- `tests/cli/test_config_model_normalization.py`
  - Updated all three test assertions to expect APEX-17 r7 canonical tags (`instruct-phi4-pro-q8-prod`, `reason-deepseekr1-pro-q5km-prod`, `code-qwen25-pro-q5km-prod`) instead of pre-migration short names that were removed during the r7 naming migration.

- `tests/cli/test_config_validation.py`
  - Updated `test_ensure_calls_validate` canonical-tag assertion set to match r7 production tags.

### Dev dependencies

- Installed `typer`, `pytest`, and `pytest-asyncio` into the project venv to unblock previously skipping CLI and async test modules.

### Validation status

- `pnpm --filter @swarmx/dashboard lint` — **0 errors, 0 warnings** (was 3 errors, 1 warning).
- `pnpm --filter @swarmx/dashboard typecheck` — verified clean.
- `pnpm --filter @swarmx/api typecheck` — verified clean.
- `python3 -m pytest tests/cli/test_config_model_normalization.py tests/cli/test_config_validation.py` — **13/13 passed**.
- Full non-CLI test suite (204 tests) — **all passed**.

---

## V6.2.2 — VIDEO-ALPHA Integration Finish (2026-07-04)

Final integration pass for the VIDEO-ALPHA upgrade, focused on live-update wiring, route validation, dashboard correctness, and documentation hygiene.

### Highlights

- `apps/swarmx-api/src/services/ollama.ts`
  - Added centralized `generateOllamaText()` helper so video orchestration uses the shared Ollama transport path instead of embedding a direct `/api/generate` call in the orchestrator.

- `apps/swarmx-api/src/services/video-orchestrator.ts`
  - Switched stage text generation to the shared Ollama helper.
  - Preserved RAM-aware overrides and stage abort signaling while removing inline model transport logic.

- `apps/swarmx-api/src/routes/video.ts`
  - Added Zod validation for `POST /api/video/jobs/:id/resume`, `POST /api/video/jobs/reprioritize`, and `POST /api/video/caption/score`.
  - Added caption-score rate limiting at 10 requests/minute per connection, configurable via `SWARMX_VIDEO_CAPTION_SCORE_LIMIT_PER_MIN`.

- `apps/swarmx-dashboard/src/stores/video.ts`
  - Added store actions for job-specific SSE subscription, retry-from-stage, queue reprioritization, and caption rescoring.
  - Job SSE subscription now returns a teardown callback so route-level consumers can unsubscribe cleanly.

- `apps/swarmx-dashboard/src/app/(dashboard)/video/[id]/page.tsx`
  - Added job-scoped SSE subscription on mount for direct detail-route live updates.
  - Fixed publish callback behavior so successful publishes surface correct UI feedback instead of always appearing to fail.

- `apps/swarmx-dashboard/src/app/(dashboard)/video/page.tsx`
  - Added queue drag-reorder wiring for queued jobs.
  - Added retry affordance for failed jobs.

- `apps/swarmx-dashboard/src/components/video/CaptionEditor.tsx`
  - Rescoring now routes through the shared video store API instead of duplicating direct fetch logic in the component.

- `apps/swarmx-dashboard/src/components/video/PlatformPublishPanel.tsx`
  - Made returned platform URLs clickable and improved publish guidance copy.

- `apps/swarmx-dashboard/src/stores/events.ts`
  - Removed unused type aliases and cleaned a small unused-parameter warning.

- `docs/VIDEO-GENERATION.md`
  - Synchronized route coverage and examples with the implemented surface.
  - Fixed markdown structure, tables, fenced code block languages, and TOC/lint issues.
  - Documented resume/reprioritize routes, RAM admission error, caption-score endpoint, and rate-limiting behavior.

- `env.example`
  - Added `SWARMX_VIDEO_CAPTION_SCORE_LIMIT_PER_MIN` and documented the current RAM gate behavior.

### Validation status

- `pnpm --filter @swarmx/api typecheck` — verified clean.
- `pnpm --filter @swarmx/dashboard typecheck` — verified clean.
- `./scripts/rebuild-all-modelfiles.sh --validate` — verified clean.
- Grep verification for direct `/api/generate` and `/api/chat` usage in the video orchestrator path — verified clean.

## V6.2.1 — API Contract + Docs Sync (2026-07-04)

Documentation and contract-alignment pass after strict TypeScript cleanup and naming migration hardening.

### Highlights

- `apps/swarmx-api/src/types/events.ts`
  - Canonicalized API-local video lifecycle events on `{ type, timestamp, data }`.
  - Confirmed emitted variants: `video:created`, `video:queued`, `video:stage_started`, `video:progress`, `video:completed`, `video:failed`, `video:cancelled`, `video:snapshot`.

- `apps/swarmx-api/src/routes/video.ts`
  - Confirmed implemented route surface:
    - `POST /api/video/jobs`
    - `GET /api/video/jobs`
    - `GET /api/video/jobs/:id`
    - `POST /api/video/jobs/:id/cancel`
    - `GET /api/video/files/:filename`
  - Removed stale docs references to non-implemented `DELETE /api/video/jobs/:id`, `POST /api/video/jobs/:id/retry`, and `GET /api/video/health`.

- `docs/VIDEO-GENERATION.md`
  - Rewrote API examples and schemas to match current request/query/response contracts.
  - Updated SSE section to distinguish API lifecycle events from compact dashboard progress projections.
  - Corrected model/env examples to canonical tags and active dashboard env key (`NEXT_PUBLIC_API_URL`).
  - Updated architecture and troubleshooting references (`videoRoutes` registration, stage names).

- `README.md`
  - Updated video pipeline stage narrative to match the current orchestrator implementation and linked to authoritative API/video docs.

### Validation status

- `pnpm --filter @swarmx/api typecheck` — verified clean.
- `bash scripts/rebuild-all-modelfiles.sh --validate` — verified clean for canonical naming checks.

---

## V5.8 — Surgical Refinement: Gap Closure + Async Hardening (2026-05-04)

Production refinement pass closing all critical import failures, naming
collisions, path regressions, and blocking-thread anti-patterns identified
in the V5.1–V5.7 codebase. Zero architectural regressions; all V5.7
features and invariants preserved.

### Critical Fixes

**`brain/scorer.py`** — Name-collision fix
- The legacy `score_output()` in `brain/scorer.py` (3-signal, length-based)
  was shadowing the production `score_output()` in `brain/loop.py`
  (5-signal, 0.0–1.0 range) depending on Python import order. Quality
  gating was non-deterministic. Fixed: `brain/scorer.py` now re-exports
  `brain.loop.score_output` — one canonical definition.

**`brain/rag.py`** — ImportError on minimal deployments
- Bare `from memory.faiss_store import FAISSStore` at module level with no
  error handling caused `ImportError` to propagate through
  `brain/orchestrator.py` on any machine without faiss/sentence-transformers,
  crashing the entire brain subsystem. Fixed: replaced with a 4-tier
  graceful degradation chain (FAISS → TF-IDF → JSONL keyword → passthrough).

**`memory/vector_store.py`** and **`memory/faiss_store.py`** — Path regression
- Both stores wrote to `~/.swarm` (stale, pre-V5 path) instead of
  `~/.swarmx` (current, aligned with `SWARM_HOME` env and `brain/memory.py`).
  Agents running in isolated environments were silently writing memory to a
  different directory than the one being read. Fixed: both stores now use
  `Path(os.environ.get("SWARM_HOME", Path.home() / ".swarmx")) / "memory"`.

**`memory/faiss_store.py`** — Missing import guards
- `import faiss` and `from sentence_transformers import ...` were bare module-
  level imports with no try/except. Any import of `memory.faiss_store` without
  the ML stack present raised `ImportError`. Fixed: all ML imports guarded;
  `FAISSStore()` is now a factory returning `_FAISSStoreImpl` when deps are
  present, `_FallbackStore` (delegates to VectorStore) otherwise.

**`src/swarmx/core/evolution_engine.py`** — Duplicate `__all__` omits `delta_capture`
- The file had two `__all__` definitions. Python uses the last; the last one
  did not include `delta_capture`. The comment above the first `__all__`
  ("Replace the existing `__all__` with:") was a merge artifact from a PR
  that was applied as a comment block rather than a code change.
  Fixed: first `__all__` block removed; `delta_capture` added to the
  canonical (final) `__all__`.

**`agents/executor.py`** — Blocking `threading.Thread` in async event loop
- `execute_parallel()` used `threading.Thread` + `t.join()` synchronously
  inside what is now an async execution context. This deadlocked when called
  from within the V5.8 orchestrator's `asyncio.gather` path. Fixed: replaced
  with `asyncio.gather` + `asyncio.to_thread` wrapper for sync callables.

**`brain/roles.py`** and **`brain/utils.py`** — Duplicate `detect_role` stubs
- Both files contained `detect_role(task)` with different signal sets,
  duplicating `brain.dispatcher.classify()`. Downstream callers received
  inconsistent model routing depending on which module they imported from.
  Fixed: stubs removed; canonical implementation is `brain.dispatcher.classify()`.
  `brain/roles.py` rewritten as a complete role→model mapping dict with
  env-var override support. `brain/utils.py` rewritten with `chunk_tasks`,
  `flatten_results`, and `truncate` utilities.

### New Capabilities

**`orchestration/tools.py`** — Two new tools
- `semantic_search`: exposes the 3-tier vector memory to agent tool dispatch.
  Previously agents could only benefit from RAG enrichment at prompt time
  (via `brain/rag.py`); they could not query memory mid-execution.
- `diff_files`: unified diff between two safe-path files. Enables audit and
  self-improvement workflows to compare file versions through tool dispatch.

**`src/swarmx/event_bus.py`** — Typed `EventKind` constants + `subscribe()` generator
- `EventKind` class added with 20 typed event string constants. `publish()`
  now validates kinds in strict mode (`SWARMX_EVENT_STRICT=1`). `subscribe()`
  generator added for filtered event streaming. `snapshot()` extended with
  per-kind latency stats.

**`memory/__init__.py`** — `get_store()` factory
- New package entry point: `from memory import get_store` returns the best
  available store (FAISS → TF-IDF → None) without the caller needing to
  know which ML deps are installed.

**`brain/__init__.py`** — Unified public API
- All brain module entry points now importable from `brain` directly.
  Eliminates the need for callers to know the specific submodule.

### Test Coverage

New test files added:
- `tests/brain/__init__.py`
- `tests/brain/test_rag.py` — 6 tests covering all 4 degradation tiers
- `tests/brain/test_scorer.py` — 6 parametrised signal tests + collision regression
- `tests/brain/test_graph.py` — 8 DAG executor tests (parallel, cycles, skip, sync)
- `tests/memory/test_vector_store.py` — 8 tests (path, JSONL, search, clear, fallback)
- `tests/agents/__init__.py`
- `tests/agents/test_executor.py` — async parallel executor tests
- `tests/agents/test_analyzer.py` — result aggregator tests

### No Regressions

All V5.7 features preserved:
- 6-role model architecture, config-driven via `swarmx_config.yaml`
- Full async multi-turn tool call loop (max 20 steps × 6 tool calls)
- Per-tool rate limiting + circuit breaker (V5.7 ENH-01/02)
- Memory compression at 70% context threshold
- Background auto-critic (`deepseek-critic`)
- ESCALATE / BLOCK / BLOCKED envelope detection
- Atomic TaskTrace persistence
- Gödel guard (`policy.py:godel_guard()`)
- `allow_auto_deploy: false` invariant

---

## V5.1 — Surgical Merge: v2-corrected + v5 (2026-05-03)

Surgical merge of `swarmx-v2-corrected` (corrected Modelfiles, proven APEX-17 prompts) into
`swarmx-v5` (full orchestration stack, 6-role architecture). V5.1 is the canonical production base.

### Fixes Applied (from v2-corrected analysis)

**`orchestration/orchestrator.py`** — Critical CLI bug fixed
- `--critic` mode contained `audit = await ollama.chat.__func__` — a dead reference
  left from a refactor. Fixed: now correctly instantiates `SwarmXOrchestrator` and
  calls `orch.run_critic(Path(args.critic))`.
- `TaskStatus.BLOCKED` was defined in the enum but never set in the run loop.
  Fixed: BLOCK envelope from any agent now sets `trace.status = TaskStatus.BLOCKED`
  and halts execution. Was previously treated identically to step failure.
- Argparse `--help` output improved with epilog examples.
- Minor: `cached_tokens` calculation corrected (was a subtraction of identical values).

**`modelfiles/primary/`** — Missing `REQUIRES 0.5.13` directives added
- `qwen-supervisor.modelfile` — was missing (phi4 models already had it)
- `qwen-worker.modelfile` — was missing
- `deepseek-reasoner.modelfile` — was missing
- `deepseek-critic.modelfile` — was missing

**`orchestration/swarmx_config.yaml`** — Evolution model names corrected
- `evolution.models` section was absent; APEX-17 comments still referenced old
  V4 names (`phi4-mini:swarmx-evolve`, `deepseek-r1:swarmx-evolve`).
  Added explicit `evolution.models` block with V5.1 names:
  `observe: phi4-fast:swarmx-evolve`, `critique/validate: deepseek-critic`,
  `mutate: qwen2.5:swarmx-evolve`.
- Added `co_load.unsafe_pairs` entry for `deepseek-critic + deepseek-r1-evolve`.

**`orchestration/requirements.txt`** — Merged v2 deps into v5 clean layout
- Re-added `pydantic-settings>=2.3.0` (removed in v5, still needed for .env schema)
- Re-added `python-dotenv>=1.0.1` (was pinned to 1.0.0 in v5; bumped)
- Removed `asyncio>=3.4.3` (stdlib since Python 3.4 — never install via pip)
- Added framework integration comments (LangGraph / CrewAI / AutoGen)

### New Files

**`modelfiles/variants/phi4-fast-evolve.modelfile`** (new in V5.1)
- APEX-17 observe phase variant based on phi4-fast (Q8_0)
- 8k context, temperature 0.15 — fitness signal synthesis
- Emits `FITNESS_SNAPSHOT` schema for deepseek-critic consume
- Was missing in both v2 and v5; v5's config.yaml referenced it but it didn't exist

### No Regressions

All V5.0 features preserved:
- Config-driven orchestrator (all constants from swarmx_config.yaml)
- Full multi-turn tool call loop per step
- ESCALATE/BLOCK envelope detection and routing
- Background auto-critic (`traces.auto_critic`)
- 6-role model architecture (fast, worker, executor, supervisor, reasoner, critic)
- Rich CLI with argparse
- TaskTrace with escalations list and per-step tool_calls_made counter

---

## V5.0 — APEX-17 Integrated Merge (2026-05)

See full V5.0 notes in previous CHANGELOG entry below.

This is a surgical merge of four source bundles:
- **V4** — hardened parameter headers, APEX-17 system prompts, native DeepSeek + Qwen templates
- **swarmx-modelfiles-v2a** — flat 9-modelfile set with individual system prompts
- **swarmx_complete** — full Python orchestration bundle
- **swarmx-modelfiles-v2b** — structured primary/variants split, APEX-17 evolution cycle

### V5.0 Key Features

**Orchestrator** — Config-driven, tool call loop, memory compression, auto-critic, ESCALATE/BLOCK envelopes, argparse CLI

**Tools** — `http_post`, AST-level `run_python` safety, SSRF protection, `json_validate`, `summarise_text`, call log observability

**Config** — Co-load matrix, KV strategy per role, latency targets, self-improvement gate, evolution gates

**Modelfiles** — 6 primary + 3 variant; dedicated `deepseek-critic` role, `phi4-fast` router, `qwen-supervisor` + `qwen-worker` split

**Setup** — `install.sh` with version check, `health_check.py` with 6-model validation + co-load check, `test_integration.py` with `--fast` flag

---

## V4 (prior)

- V4 headers with detailed memory math per model
- APEX-17 system prompts across all 5 primary modelfiles
- Native DeepSeek-R1 TEMPLATE with `<think>` block support
- Native Qwen2.5 TEMPLATE, Phi-4 mini TEMPLATE

## swarmx_complete (prior)

- Full Python orchestration stack: orchestrator, tools, config, schemas
- health_check.py, test_integration.py, install.sh, zram_setup.sh, ollama_env.sh
- message_schemas.json, kv_cache_reference.md
