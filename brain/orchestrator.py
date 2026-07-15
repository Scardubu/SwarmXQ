"""
brain/orchestrator — SwarmX V6.0 Brain Adapter
===============================================
Thin async adapter that bridges the legacy `brain/` call sites into the
production orchestration engine (orchestration/orchestrator.py).

CHANGES FROM LEGACY VERSION (V5.6):
  [FIX-01] Removed `from v7.api.client import send_task_to_cluster` — the v7
           module never existed in this codebase; this import caused an
           ImportError on startup and silently broke all brain/ entry points.
  [FIX-02] `run_task()` is now async and delegates to `SwarmXOrchestrator.run()`
           instead of rebuilding a parallel (incomplete) execution pipeline.
  [FIX-03] `store` (FAISSStore) is only instantiated when the optional
           sentence-transformers / faiss dependencies are available; gracefully
           degrades to VectorStore (TF-IDF) when heavy ML libs are absent.
  [ENH-01] `run_task_sync()` helper wraps the async run for callers that still
           use a synchronous entry point (CLI scripts, tests).

CHANGES V6.0 (new):
  [ENH-02] SINGLETON pattern: OllamaClient + SwarmXOrchestrator are created ONCE
           per-process and reused across all `run_task()` calls. Previously a new
           httpx.AsyncClient was created and immediately closed on every call —
           defeating connection-pool reuse and adding ~50–200ms overhead per task
           on cold pools.
  [ENH-03] `shutdown()` / `shutdown_sync()` exposed for graceful process teardown.
  [ENH-04] `reset_singleton()` for test isolation without process restart.

Usage:
    # Async (preferred):
    from brain.orchestrator import run_task
    result = await run_task("Summarise the project dependencies")

    # Sync wrapper (for CLI / legacy callers):
    from brain.orchestrator import run_task_sync
    result = run_task_sync("Summarise the project dependencies")

    # Graceful shutdown at process exit:
    from brain.orchestrator import shutdown_sync
    shutdown_sync()

    # Test isolation:
    from brain.orchestrator import reset_singleton
    reset_singleton()
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import sys
import warnings
from pathlib import Path
from typing import Any, cast

try:
    import structlog
    log = structlog.get_logger("swarmx.brain.orchestrator")
except ImportError:
    import logging
    _logger = logging.getLogger("swarmx.brain.orchestrator")

    class _StructlogCompat:  # type: ignore[no-redef]
        def info(self, event: str, **kw: object) -> None: _logger.info("%s %s", event, kw)
        def warning(self, event: str, **kw: object) -> None: _logger.warning("%s %s", event, kw)

    log = _StructlogCompat()  # type: ignore[assignment]

# ─── Lazy vector store ────────────────────────────────────────────────────────

def _build_store() -> Any:
    """Return the best available vector store — FAISS if available, TF-IDF otherwise."""
    for factory in (
        lambda: __import__("memory.faiss_store", fromlist=["FAISSStore"]).FAISSStore(),
        lambda: __import__("memory.vector_store", fromlist=["VectorStore"]).VectorStore(),
    ):
        try:
            return factory()
        except Exception:
            continue
    return None


_store: Any = None
_DEPRECATION_WARNED = False


def _warn_deprecated(entrypoint: str) -> None:
    global _DEPRECATION_WARNED
    if _DEPRECATION_WARNED:
        return
    warnings.warn(
        (
            f"brain.orchestrator.{entrypoint} is a compatibility adapter and will be "
            "retired in a future release. Use canonical runtime entrypoints under "
            "src/swarmx (cli/server APIs) instead."
        ),
        DeprecationWarning,
        stacklevel=2,
    )
    _DEPRECATION_WARNED = True


def _get_store() -> Any:
    global _store
    if _store is None:
        _store = _build_store()
    return _store


# ─── Singleton orchestrator ───────────────────────────────────────────────────
# [ENH-02] One OllamaClient (one httpx connection pool) per process lifetime.
# Previously _make_orchestrator() was called on every run_task() invocation,
# spinning up and immediately tearing down a fresh httpx.AsyncClient each time.

# [ENH-02] One OllamaClient (one httpx connection pool) per process lifetime.
# [FIX-LAZY-LOCK] asyncio.Lock lazily created inside the running event loop.
# Creating asyncio.Lock() at module import time emits DeprecationWarning in
# Python 3.10+ and raises RuntimeError in 3.12+ when no loop is running.
# Mirrors the fix already applied in brain/memory.py [FIX-03].

_orch_lock: asyncio.Lock | None = None
_ollama: Any = None
_orch: Any = None


def _get_orch_lock() -> asyncio.Lock:
    """Return the asyncio.Lock, creating it lazily inside the running event loop."""
    global _orch_lock
    if _orch_lock is None:
        try:
            asyncio.get_running_loop()
        except RuntimeError as exc:
            raise RuntimeError(
                "brain.orchestrator._get_orch() must be called from an async context."
            ) from exc
        _orch_lock = asyncio.Lock()
    return _orch_lock

def _add_orchestration_to_path() -> None:
    """Ensure the canonical orchestration/ directory is on sys.path."""
    orch_dir = Path(__file__).parent.parent / "orchestration"
    if str(orch_dir) not in sys.path:
        sys.path.insert(0, str(orch_dir))


async def _get_orch() -> tuple[Any, Any]:
    """
    [ENH-02] Return (orch, ollama) singleton, creating on first call.

    Uses double-checked locking so concurrent coroutines that race past
    the first `if _orch is not None` check don't each attempt initialisation.
    """
    global _ollama, _orch
    if _orch is not None:
        return _orch, _ollama

    async with _get_orch_lock():
        # Double-checked locking — another coroutine may have initialised first
        if _orch is not None:
            return _orch, _ollama

        _add_orchestration_to_path()
        from orchestrator import (  # type: ignore[import]
            OllamaClient,
            SwarmXOrchestrator,
            _init_cache,
            load_config,
            load_schemas,
        )
        load_config()
        load_schemas()
        _init_cache()

        trace_dir = Path(os.environ.get("SWARM_TRACE_DIR", "traces"))
        _ollama = OllamaClient()
        _orch = SwarmXOrchestrator(ollama=_ollama, trace_dir=trace_dir)

    return _orch, _ollama


# ─── Public API ───────────────────────────────────────────────────────────────

async def run_task(prompt: str) -> dict[str, Any]:
    """
    Run a task through the V6.0 orchestration engine.

    1. Optional: RAG-enrich prompt from vector memory.
    2. Delegate to singleton SwarmXOrchestrator.run().
    3. Store result embedding back to vector store.

    Returns the final_answer dict from the orchestrator.
    """
    _warn_deprecated("run_task")
    # [V5.9-FIX-01] Replaced print() with structlog — library code must never print()
    log.info("run_task_start", prompt_preview=prompt[:100])

    # Snapshot the raw prompt before any RAG mutation so the memory key stored
    # after execution always reflects the original user intent — not the
    # CONTEXT-prefixed string forwarded to the orchestrator.
    original_prompt = prompt

    # RAG enrichment (optional — degrades gracefully if store unavailable)
    store = _get_store()
    if store is not None:
        try:
            ctx_results = store.search(prompt) if hasattr(store, "search") else []
            if ctx_results:
                ctx_block = "\n".join(ctx_results[:3])
                prompt = f"CONTEXT:\n{ctx_block}\n\nTASK:\n{prompt}"
        except Exception:
            pass  # never block orchestration on memory failure

    # [ENH-02] Reuse the singleton — no open/close on every call
    orch, _ = await _get_orch()
    result = await orch.run(prompt)

    # Store result embedding back into memory, keyed on the original prompt
    # so future similarity searches match cleanly without the CONTEXT prefix.
    if store is not None:
        try:
            summary = str(result.get("result", result))[:500]
            if hasattr(store, "add"):
                store.add(f"{original_prompt[:200]} → {summary}")
        except Exception:
            pass

    log.info("run_task_done", status=result.get("task_status", "?"), confidence=result.get("confidence", "?"))
    return cast(dict[str, Any], result)


def run_task_sync(prompt: str) -> dict[str, Any]:
    """Synchronous wrapper for callers that cannot use async/await."""
    try:
        asyncio.get_running_loop()
        # Already inside a running loop — offload to a thread to avoid deadlock
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(asyncio.run, run_task(prompt)).result()
    except RuntimeError:
        # No running loop — safe to call asyncio.run() directly
        return asyncio.run(run_task(prompt))


async def shutdown() -> None:
    """
    [ENH-03] Gracefully close the singleton httpx client.

    Call at process exit (e.g. via atexit or an ASGI lifespan handler) to
    ensure all in-flight HTTP connections are flushed and file descriptors
    are released cleanly.
    """
    global _ollama, _orch
    if _ollama is not None:
        with contextlib.suppress(Exception):
            await _ollama.close()
    _ollama = None
    _orch = None


def shutdown_sync() -> None:
    """
    Synchronous shutdown wrapper.

    Safe to call from plain atexit handlers (no running loop) and from ASGI
    lifespan shutdown handlers (running loop present). In the latter case the
    coroutine is offloaded to a fresh thread — mirroring run_task_sync — so
    asyncio.run() never sees an already-running loop and raises RuntimeError.
    """
    try:
        asyncio.get_running_loop()
        # Inside a running loop (e.g. ASGI lifespan) — offload to a thread
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            pool.submit(asyncio.run, shutdown()).result()
    except RuntimeError:
        # No running loop — safe to call asyncio.run() directly
        with contextlib.suppress(Exception):
            asyncio.run(shutdown())


def reset_singleton() -> None:
    """
    [ENH-04] Force re-creation of the singleton on the next call.

    Resets both the orchestrator/client singleton AND the vector store so
    that tests start from a clean slate without a full process restart.

    WARNING — NOT SAFE FOR CONCURRENT USE: this function mutates the three
    singleton globals without acquiring _orch_lock. Calling it while async
    tasks are in flight can produce a half-reset state where _orch is None
    but _ollama is not (or vice versa). Only call during test setUp/tearDown
    when no coroutines are running.
    """
    global _ollama, _orch, _store
    _ollama = None
    _orch = None
    _store = None
