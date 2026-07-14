"""
brain/router — SwarmX V6.1 Brain Router
========================================
Routes brain/ module calls to the appropriate model via Ollama /api/chat.

CHANGES V6.1 vs V6.0:
  [FIX-05] [PERF-01] Module-level singleton httpx.AsyncClient replaces the
    per-call `async with httpx.AsyncClient()` pattern. The old pattern opened
    and closed a full TCP connection on every run_model() call, adding 50-200ms
    round-trip overhead on a cold connection pool. The singleton reuses one
    connection pool for the process lifetime.
    New helpers: _get_http_client() (lazy async init), close_http_client(),
    close_http_client_sync() for graceful teardown at process exit.
  [FIX-06] URL-change detection: if SWARMX_OLLAMA_URL changes at runtime
    (e.g. in tests), the old client is closed and a new one is created.

CHANGES V6.0 vs V5.6:
  [FIX-01] Robust config loader with SWARM_ROOT env override, `models` key
    validation, and safe fallback to V5.6 defaults.
  [FIX-02] httpx async /api/chat — no deprecated subprocess.run per call.
  [FIX-03] `detect_intent` normalises legacy brain.yaml model names to V5.6 tags.
  [ENH-01] `run_model` async-first; `run_model_sync` wrapper for legacy callers.
  [ENH-02] `route` async with sync wrapper.
  [FIX-04] `_load_config()` guarded by `threading.Lock` (double-checked locking).
  [ENH-03] `detect_intent` extended with fintech / security / architecture signals.
"""

from __future__ import annotations

import asyncio
import json
import os
import threading
import warnings
from pathlib import Path
from typing import Any

import httpx

# ─── Legacy model name remap ──────────────────────────────────────────────────

_V5_MODEL_REMAP: dict[str, str] = {
    "phi3":       "phi4-fast",
    "phi3:mini":  "phi4-fast",
    "phi4:mini":  "phi4-fast",
    "llama3:8b":  "deepseek-reasoner",
    "llama3":     "deepseek-reasoner",
    "qwen:7b":    "qwen-worker",
    "qwen2.5":    "qwen-supervisor",
}

_DEFAULT_MODELS: dict[str, str] = {
    "fast":       "phi4-fast",
    "reason":     "deepseek-reasoner",
    "code":       "qwen-worker",
    "supervisor": "qwen-supervisor",
    "worker":     "phi4-worker",
    "critic":     "deepseek-critic",
}

# ─── Thread-safe config loader ────────────────────────────────────────────────

_CONFIG: dict[str, Any] | None = None  # [V5.9-FIX-04] None sentinel — empty dict {} means "loaded with no models"
_CONFIG_LOCK = threading.Lock()
_DEPRECATION_WARNED = False


def _warn_deprecated(entrypoint: str) -> None:
    global _DEPRECATION_WARNED
    if _DEPRECATION_WARNED:
        return
    warnings.warn(
        (
            f"brain.router.{entrypoint} is a compatibility adapter and will be "
            "retired in a future release. Use canonical runtime entrypoints under "
            "src/swarmx (routing/llm APIs) instead."
        ),
        DeprecationWarning,
        stacklevel=2,
    )
    _DEPRECATION_WARNED = True


def _load_config() -> dict[str, Any]:
    global _CONFIG
    if _CONFIG is not None:  # [V5.9-FIX-04] None = uninitialized; {} = loaded-empty
        return _CONFIG

    with _CONFIG_LOCK:
        if _CONFIG is not None:
            return _CONFIG

        swarm_root = os.environ.get("SWARM_ROOT", ".")
        candidates = [
            Path(swarm_root) / "configs" / "brain.yaml",
            Path(__file__).parent.parent / "configs" / "brain.yaml",
            Path("configs") / "brain.yaml",
        ]

        for candidate in candidates:
            if candidate.exists():
                try:
                    import yaml
                    raw = yaml.safe_load(candidate.read_text(encoding="utf-8")) or {}
                    if isinstance(raw, dict) and "models" in raw:
                        remapped = {
                            role: _V5_MODEL_REMAP.get(tag, tag)
                            for role, tag in raw.get("models", {}).items()
                        }
                        _CONFIG = {**raw, "models": {**_DEFAULT_MODELS, **remapped}}
                        return _CONFIG
                except Exception:
                    pass

        _CONFIG = {"models": _DEFAULT_MODELS}
        return _CONFIG


def _ollama_url() -> str:
    return os.environ.get("SWARMX_OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")


# ─── [FIX-05] Module-level httpx singleton ────────────────────────────────────
# One connection pool for the process lifetime — no TCP setup overhead per call.

_HTTP_CLIENT: httpx.AsyncClient | None = None
_HTTP_BASE_URL: str = ""
_HTTP_CLIENT_LOCK = threading.Lock()


async def _get_http_client() -> httpx.AsyncClient:
    """Return the singleton AsyncClient, (re)creating it if the Ollama URL changed."""
    global _HTTP_CLIENT, _HTTP_BASE_URL
    current_url = _ollama_url()
    # Fast path — correct client already exists
    if (
        _HTTP_CLIENT is not None
        and not _HTTP_CLIENT.is_closed
        and current_url == _HTTP_BASE_URL
    ):
        return _HTTP_CLIENT

    # Slow path — create or recreate (URL change / first call)
    # Use a threading.Lock here because async Lock requires a running loop
    # and this helper can be called from run_model_sync via asyncio.run().
    with _HTTP_CLIENT_LOCK:
        if _HTTP_CLIENT is not None and not _HTTP_CLIENT.is_closed:
            if current_url == _HTTP_BASE_URL:
                return _HTTP_CLIENT
            # URL changed — close old client
            try:
                await _HTTP_CLIENT.aclose()
            except Exception:
                pass

        _HTTP_BASE_URL = current_url
        _HTTP_CLIENT = httpx.AsyncClient(
            base_url=current_url,
            timeout=httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=5.0),
            limits=httpx.Limits(max_connections=8, max_keepalive_connections=4),
        )
        return _HTTP_CLIENT


async def close_http_client() -> None:
    """[FIX-05] Gracefully close the singleton httpx client at process exit."""
    global _HTTP_CLIENT
    if _HTTP_CLIENT is not None and not _HTTP_CLIENT.is_closed:
        try:
            await _HTTP_CLIENT.aclose()
        except Exception:
            pass
    _HTTP_CLIENT = None


def close_http_client_sync() -> None:
    """Synchronous wrapper for close_http_client."""
    try:
        asyncio.get_running_loop()
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            pool.submit(asyncio.run, close_http_client()).result()
    except RuntimeError:
        try:
            asyncio.run(close_http_client())
        except Exception:
            pass


# ─── Intent detection ─────────────────────────────────────────────────────────

def detect_intent(prompt: str) -> str:
    """Map a prompt to a model role key. Returns a key from _DEFAULT_MODELS."""
    p = prompt.lower()

    _reason_signals = (
        "design", "architecture", "analyze", "analyse", "research",
        "plan", "strategy", "reason", "evaluate", "compliance",
        "zero-knowledge", "zkp", "multi-step", "taxbridge", "sabiscore",
        "hashablanca", "explain", "investigate", "diagnose",
    )
    if any(k in p for k in _reason_signals):
        return "reason"

    _code_signals = (
        "code", "script", "implement", "function", "class", "refactor",
        "endpoint", "schema", "migration", "test", "dockerfile", "pipeline",
        "typescript", "python", "javascript", "prisma", "effect-ts", "bullmq",
    )
    if any(k in p for k in _code_signals):
        return "code"

    _critic_signals = ("review", "critique", "audit", "score", "grade", "assess")
    if any(k in p for k in _critic_signals):
        return "critic"

    return "fast"


def _resolve_model(role: str) -> str:
    """Resolve a role key to an Ollama model tag (config → env → static fallback)."""
    cfg = _load_config()
    tag = cfg.get("models", {}).get(role)
    if tag:
        return _V5_MODEL_REMAP.get(tag, tag)

    try:
        from brain.roles import role_model
        return role_model(role)
    except Exception:
        pass

    fallback = _DEFAULT_MODELS.get(role.lower(), "phi4-fast")
    return _V5_MODEL_REMAP.get(fallback, fallback)


# ─── Core model call ──────────────────────────────────────────────────────────

async def run_model(role: str, prompt: str, timeout: int = 120) -> str:
    """
    Call the Ollama /api/chat endpoint for the given role.

    [FIX-05] Uses the module-level singleton AsyncClient — no per-call TCP setup.
    Returns the assistant message content as a plain string.
    """
    _warn_deprecated("run_model")
    model = _resolve_model(role)
    client = await _get_http_client()
    try:
        resp = await client.post(
            "/api/chat",
            json={
                "model":    model,
                "stream":   False,
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=timeout,
        )
        resp.raise_for_status()
        return resp.json().get("message", {}).get("content", "")
    except httpx.HTTPStatusError as e:
        return json.dumps({"error": f"Ollama HTTP {e.response.status_code}", "model": model})
    except Exception as e:
        return json.dumps({"error": str(e), "model": model})


def run_model_sync(role: str, prompt: str, timeout: int = 120) -> str:
    """Synchronous wrapper for run_model (for legacy callers)."""
    try:
        asyncio.get_running_loop()
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(asyncio.run, run_model(role, prompt, timeout=timeout)).result()
    except RuntimeError:
        return asyncio.run(run_model(role, prompt, timeout=timeout))


# ─── Route helper ─────────────────────────────────────────────────────────────

async def route(step: str) -> str:
    """Detect intent and dispatch to the appropriate model. Returns response text."""
    role = detect_intent(step)
    return await run_model(role, step)


def route_sync(step: str) -> str:
    """Synchronous wrapper for route (for legacy callers)."""
    try:
        asyncio.get_running_loop()
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(asyncio.run, route(step)).result()
    except RuntimeError:
        return asyncio.run(route(step))
