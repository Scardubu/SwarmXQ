"""
SwarmX Orchestrator
===================
Async multi-agent orchestration engine for local Ollama models.

VERSION: V5.9  (surgical enhancements; see PATCH MANIFEST V5.9)

CHANGES V5.8 vs V5.6/V5.7:
  ✦ [FIX-CRITICAL-01] score_complexity(): double-try block WITHOUT a matching
    except was a SyntaxError that prevented the entire module from importing.
    Fixed: _timeout is now resolved before the single guarded try block.
  ✦ [FIX-CRITICAL-02] run(): nested signal-handler closures (_restore_signals,
    _persist_trace, _handle_sigterm, _handle_sigint) were defined at class
    scope — they referenced local variables of run() which would have raised
    NameError at the first SIGTERM or Ctrl-C. Fixed: closures are now defined
    inside run() with explicit `nonlocal` declarations.
  ✦ [FIX-03] _should_compress_memory(): dict/list content serialised safely
    (was already present but moved to a single canonical location).
  ✦ [FIX-04] _run_critic_bg(): auto_critic_timeout_s enforcement via
    asyncio.wait_for + improvements_log mkdir guard (was V5.7-FIX-04, but the
    implementation had a stray `_run_critic_bg` body left outside the class).
    Method is now definitively inside SwarmXOrchestrator.
  ✦ [ENH-01] _execute_tool_call_loop(): CLARIFY envelope now injects a
    structured clarification_response back into the message loop rather than
    simply logging and continuing, allowing the model to resume properly.
  ✦ [ENH-02] TaskTrace.save(): atomic write via a .tmp file + rename to prevent
    partial trace files on crash during serialisation.
  ✦ [ENH-03] OllamaClient._chat_single(): streaming path now records latency
    (was missing — only the non-stream path recorded it).
  ✦ [ENH-04] run(): guard added — if no steps are produced after plan
    normalisation, a single-step fallback is injected before the execution
    loop, preventing a silent 0-step execution.
  ✦ [ENH-05] score_complexity(): result is now clamped to [0.0, 1.0] and
    returns 0.5 on timeout (neutral routing) instead of propagating silently.
  ✦ [ENH-06] _LATENCY_WINDOW aligned to 50 samples (was 20 in llm.py branch;
    config value observability.latency_window is now the authoritative source).
  ✦ [ENH-07] Health probe: now includes circuit-breaker state per tool when
    tools module is importable.

CHANGES V5.9 vs V5.8:
  ✦ [V5.9-PATCH-01] _execute_tool_call_loop(): message-list pruning via
    _prune_messages() — prevents tool-loop OOM by keeping only the initial
    delegation + last N messages (default 12, configurable via
    orchestration.tool_loop_msg_keep).
  ✦ [V5.9-PATCH-02] SwarmXOrchestrator.__init__: asyncio.Lock added for
    thread-safe lazy dispatch initialisation. New _get_tool_dispatch_async()
    method (double-checked lock pattern) replaces bare _get_tool_dispatch()
    at all internal call sites.
  ✦ [V5.9-PATCH-03] run(): TaskGraph-parallel execution for independent
    (root) plan steps via brain.graph. Gracefully skipped if brain.graph is
    unavailable; sequential loop remains authoritative for dep-bound steps.
  ✦ [V5.9-PATCH-04] Version strings bumped to V5.9 throughout.
  ✦ [V5.9-PATCH-05] health(): brain/memory stats exposed via new
    _get_brain_memory_stats() static helper; keyed "brain_memory" in probe.

Architecture (V5.9 — topology unchanged):
  Fast       (phi4-fast)          ← complexity scoring, routing, validation
  Supervisor (qwen-supervisor)    ← plans, delegates, synthesises final answer
  Worker     (phi4-worker)        ← fast tool execution, short JSON tasks
  Executor   (qwen-worker)        ← complex tool chains, multi-lingual
  Reasoner   (deepseek-reasoner)  ← deep analysis, planning, code generation
  Critic     (deepseek-critic)    ← post-run audit, APEX-17 evolution signals

Design invariants (unchanged):
  - ONE model loaded at a time (OLLAMA_MAX_LOADED_MODELS=1 strict mode)
  - Config loaded from swarmx_config.yaml at startup — no hardcoded constants
  - Tool calls dispatched to tools.py; results fed back in-turn
  - DeepSeek <think> blocks stripped before forwarding to other agents
  - Retry-with-backoff on transient Ollama errors
  - Task trace persisted atomically to disk for critic post-run audit
  - Memory compression triggered at context thresholds
  - Hard loop detection: max steps, max tool calls per step
  - ESCALATE / BLOCK / BLOCKED envelopes honoured
  - Native Ollama JSON schema enforcement for routing + step_complete
  - allow_auto_deploy is ALWAYS False
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import signal
import sys
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Optional

import httpx
import jsonschema
import structlog
import yaml
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

# ─── Auto-configure dispatch log from environment ─────────────────────────────
_env_dispatch_log = os.environ.get("SWARMX_DISPATCH_LOG", "")
if _env_dispatch_log:
    _dispatch_log_path_env: Optional[Path] = Path(_env_dispatch_log)
else:
    _dispatch_log_path_env = None

# ─── Configuration ────────────────────────────────────────────────────────────

_CONFIG_PATH = Path(__file__).parent / "swarmx_config.yaml"
_CFG: dict = {}


def load_config() -> dict:
    global _CFG
    if _CFG:
        return _CFG
    try:
        with open(_CONFIG_PATH) as f:
            _CFG = yaml.safe_load(f) or {}
    except FileNotFoundError:
        _CFG = {}
        structlog.get_logger("swarmx").warning(
            "config_not_found", path=str(_CONFIG_PATH), using="built-in defaults"
        )
    _wire_per_tool_rate_limits()
    return _CFG


def _wire_per_tool_rate_limits() -> None:
    """Push per-tool rate limit overrides from swarmx_config.yaml into tools.py."""
    try:
        import tools as _tools
        per_tool: dict = cfg("tool_rate_limits", {}) or {}
        if not per_tool or not hasattr(_tools, "set_per_tool_rate_limit"):
            return

        # Normalize legacy/typo keys so older configs do not silently drift.
        alias_map = {
            "yami_parse": "yaml_parse",
        }

        available_tools: set[str] = set()
        if hasattr(_tools, "list_tools"):
            try:
                available_tools = {
                    str(t.get("name"))
                    for t in _tools.list_tools()
                    if isinstance(t, dict) and t.get("name")
                }
            except Exception:
                available_tools = set()

        unknown_tools: list[str] = []
        normalized_per_tool: dict[str, Any] = {}
        for raw_name, limit in per_tool.items():
            normalized_name = alias_map.get(raw_name, raw_name)
            if raw_name != normalized_name:
                structlog.get_logger("swarmx").warning(
                    "tool_rate_limit_key_normalized",
                    from_key=raw_name,
                    to_key=normalized_name,
                )
            if available_tools and normalized_name not in available_tools:
                unknown_tools.append(raw_name)
                continue
            normalized_per_tool[normalized_name] = limit

        for tool_name, limit in normalized_per_tool.items():
            try:
                _tools.set_per_tool_rate_limit(tool_name, int(limit))
            except (TypeError, ValueError):
                pass

        if unknown_tools:
            structlog.get_logger("swarmx").warning(
                "unknown_tool_rate_limit_keys",
                keys=sorted(unknown_tools),
            )

        structlog.get_logger("swarmx").debug(
            "per_tool_rate_limits_wired", tools=sorted(normalized_per_tool.keys())
        )
    except (ImportError, Exception) as exc:
        structlog.get_logger("swarmx").debug(
            "per_tool_rate_limit_wire_skipped", reason=str(exc)
        )


def cfg(key_path: str, default: Any = None) -> Any:
    """Dot-separated key path accessor. E.g. cfg('orchestration.max_steps_per_task')."""
    c = load_config()
    for part in key_path.split("."):
        if not isinstance(c, dict):
            return default
        c = c.get(part, default)
    return c


def OLLAMA_BASE_URL() -> str:
    return os.environ.get("SWARMX_OLLAMA_URL", cfg("ollama.base_url", "http://127.0.0.1:11434"))


def REQUEST_TIMEOUT() -> int:
    return int(cfg("ollama.request_timeout_seconds", 180))


def CONNECT_TIMEOUT() -> float:
    return float(cfg("ollama.connect_timeout_seconds", 10.0))


def MAX_RETRIES_PER_STEP() -> int:
    return int(cfg("orchestration.max_retries_per_step", 3))


def MAX_STEPS_PER_TASK() -> int:
    return int(cfg("orchestration.max_steps_per_task", 20))


def MAX_TOOL_CALLS_PER_STEP() -> int:
    return int(cfg("orchestration.max_tool_calls_per_step", 6))


def MEMORY_COMPRESSION_THRESHOLD() -> float:
    return float(cfg("orchestration.memory_compression_threshold", 0.70))


def REASONER_COMPLEXITY_THRESHOLD() -> float:
    return float(cfg("routing.reasoner_complexity_threshold", 0.65))


def CO_LOAD_MAX_CONCURRENT() -> int:
    if cfg("co_load.strict_single_model", True):
        return 1
    return int(cfg("co_load.batch_max_concurrent", 2))


def MODEL_ROLES() -> dict:
    return cfg("models", {
        "supervisor": "qwen-supervisor",
        "worker":     "phi4-worker",
        "executor":   "qwen-worker",
        "fast":       "phi4-fast",
        "reasoner":   "deepseek-reasoner",
        "critic":     "deepseek-critic",
    })


def EVOLUTION_MODELS() -> dict:
    return cfg("evolution.models", {
        "observe":  "phi4-fast:swarmx-evolve",
        "critique": "deepseek-critic",
        "mutate":   "qwen2.5:swarmx-evolve",
        "validate": "deepseek-critic",
    })


def MODEL_CONTEXT() -> dict:
    return cfg("context_limits", {
        "qwen-supervisor":   12288,
        "qwen-worker":        8192,
        "phi4-worker":        8192,
        "phi4-fast":          4096,
        "deepseek-reasoner": 16384,
        "deepseek-critic":   20480,
    })


def MODEL_VRAM_EST() -> dict:
    return cfg("vram_estimates_mb", {
        "qwen-supervisor":   6100,
        "qwen-worker":       5500,  # V5.8: empirically measured (was 5400)
        "phi4-worker":       4350,
        "phi4-fast":         4150,
        "deepseek-reasoner": 6000,
        "deepseek-critic":   6300,
    })


# [ENH-06] Authoritative latency window — read from config, default 50
def _latency_window() -> int:
    return int(cfg("observability.latency_window", 50))


# ─── Model Escalation Chain ───────────────────────────────────────────────────

def MODEL_ESCALATION_CHAIN() -> dict[str, list[str]]:
    return cfg("escalation_chains", {
        "qwen-supervisor":   ["qwen-supervisor", "deepseek-reasoner", "qwen-worker"],
        "qwen-worker":       ["qwen-worker", "phi4-worker", "phi4-fast"],
        "phi4-worker":       ["phi4-worker", "qwen-worker", "phi4-fast"],
        "phi4-fast":         ["phi4-fast", "phi4-worker"],
        "deepseek-reasoner": ["deepseek-reasoner", "qwen-supervisor", "qwen-worker"],
        "deepseek-critic":   ["deepseek-critic", "deepseek-reasoner"],
    })


def _escalation_chain_for(model: str) -> list[str]:
    chains = MODEL_ESCALATION_CHAIN()
    if model in chains:
        return chains[model]
    for k, chain in chains.items():
        if model.startswith(k) or k.startswith(model.split(":")[0]):
            return chain
    return [model]


# ─── Routing schemas ──────────────────────────────────────────────────────────

ROUTING_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "task_id":           {"type": "string"},
        "classification":    {"type": "string"},
        "routed_to":         {"type": "string", "enum": ["phi4-fast", "deepseek-reasoner", "qwen-supervisor"]},
        "sub_tasks":         {"type": "array"},
        "risk_level":        {"type": "string", "enum": ["low", "medium", "high"]},
        "requires_approval": {"type": "boolean"},
        "confidence":        {"type": "string", "enum": ["HIGH", "MEDIUM", "LOW"]},
        "rationale":         {"type": "string"},
    },
    "required": ["task_id", "classification", "routed_to", "risk_level", "requires_approval", "confidence"],
}

STEP_COMPLETE_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "type":       {"type": "string"},
        "task_id":    {"type": "string"},
        "step_id":    {"type": "integer"},
        "output":     {},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "warnings":   {"type": "array"},
    },
    "required": ["type", "task_id", "step_id", "output", "confidence", "warnings"],
}

# ─── Logging ──────────────────────────────────────────────────────────────────

structlog.configure(
    processors=[
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.dev.ConsoleRenderer(),
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    logger_factory=structlog.stdlib.LoggerFactory(),
)
log = structlog.get_logger("swarmx")

# ─── Schema loader ────────────────────────────────────────────────────────────

_SCHEMA_PATH = Path(__file__).parent.parent / "schemas" / "message_schemas.json"
_SCHEMAS: dict[str, Any] = {}


def load_schemas() -> None:
    global _SCHEMAS
    try:
        with open(_SCHEMA_PATH) as f:
            root = json.load(f)
        _SCHEMAS = root.get("definitions", {})
        log.info("schemas_loaded", count=len(_SCHEMAS))
    except FileNotFoundError:
        log.warning("schema_file_not_found", path=str(_SCHEMA_PATH))


def validate_message(msg: dict, schema_name: str) -> list[str]:
    """Returns list of validation errors; empty list if valid."""
    if not _SCHEMAS:
        load_schemas()
    schema = _SCHEMAS.get(schema_name)
    if schema is None:
        return [f"Unknown schema: {schema_name}"]
    validator = jsonschema.Draft7Validator(schema)
    return [e.message for e in validator.iter_errors(msg)]


# ─── LLM Response Cache ───────────────────────────────────────────────────────

_CACHE_DIR: Optional[Path] = None
_CACHE_TTL_S: int = 3600
_CACHE_ENABLED: bool = False


def _init_cache() -> None:
    global _CACHE_DIR, _CACHE_TTL_S, _CACHE_ENABLED
    _CACHE_ENABLED = bool(cfg("cache.enabled", False))
    _CACHE_TTL_S = int(cfg("cache.ttl_seconds", 3600))
    cache_dir_str = cfg("cache.dir", os.environ.get("SWARM_LLM_CACHE_DIR", ""))
    if _CACHE_ENABLED and cache_dir_str:
        _CACHE_DIR = Path(cache_dir_str)
        _CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _cache_key(model: str, messages: list[dict]) -> str:
    payload = model + "||" + json.dumps(messages, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()[:32]


def _cache_get(key: str) -> Optional[str]:
    if not _CACHE_ENABLED or _CACHE_DIR is None:
        return None
    cache_file = _CACHE_DIR / f"{key}.json"
    if not cache_file.exists():
        return None
    try:
        d = json.loads(cache_file.read_text())
        if time.time() - d.get("ts", 0) > _CACHE_TTL_S:
            cache_file.unlink(missing_ok=True)
            return None
        return d.get("response")
    except Exception:
        return None


def _cache_set(key: str, response: str) -> None:
    if not _CACHE_ENABLED or _CACHE_DIR is None:
        return
    try:
        (_CACHE_DIR / f"{key}.json").write_text(
            json.dumps({"ts": time.time(), "response": response})
        )
    except Exception:
        pass


# ─── P95 Latency Tracking ─────────────────────────────────────────────────────

_LATENCY_HISTORY: dict[str, list[float]] = {}
# [ENH-06] Window size is now read from config at call time
_LATENCY_WINDOW = 50  # module-level default; cfg("observability.latency_window") overrides


def _record_latency(model: str, elapsed_ms: float) -> None:
    window = _latency_window()
    hist = _LATENCY_HISTORY.setdefault(model, [])
    hist.append(elapsed_ms)
    if len(hist) > window:
        hist.pop(0)


def _p95_latency(model: str) -> float:
    hist = _LATENCY_HISTORY.get(model, [])
    if not hist:
        return 0.0
    s = sorted(hist)
    return s[int(len(s) * 0.95)]


def get_latency_stats() -> dict[str, dict]:
    return {
        model: {
            "p95_ms": round(_p95_latency(model), 1),
            "samples": len(_LATENCY_HISTORY.get(model, [])),
        }
        for model in _LATENCY_HISTORY
    }


# ─── Quant-level detection ────────────────────────────────────────────────────

def _detect_quant_level(model: str) -> str:
    name = model.lower()
    for marker in ("q8_0", "q5_k_m", "q5_k", "q4_k_m", "q4_k", "q4_0", "fp16", "f16"):
        if marker in name:
            return marker.upper()
    if "phi4-fast" in name or "phi4-worker" in name:
        return "Q4_K_M"
    if "deepseek" in name:
        return "Q5_K_M"
    if "qwen" in name:
        return "Q5_K_M"
    return "unknown"


# ─── Health log helper ────────────────────────────────────────────────────────

def _emit_health_log(event: dict[str, Any]) -> None:
    """Emit structured event to health log for μ-metric monitoring."""
    health_log = cfg("observability.health_log", "swarmx_health.jsonl")
    try:
        Path(health_log).parent.mkdir(parents=True, exist_ok=True)
        with open(health_log, "a", encoding="utf-8") as f:
            f.write(json.dumps({**event, "ts": time.time()}) + "\n")
    except Exception:
        pass


# ─── Task State ───────────────────────────────────────────────────────────────

class TaskStatus(Enum):
    PENDING    = "pending"
    PLANNING   = "planning"
    RUNNING    = "running"
    VALIDATING = "validating"
    COMPLETE   = "complete"
    FAILED     = "failed"
    ABORTED    = "aborted"
    BLOCKED    = "blocked"


@dataclass
class StepRecord:
    step_id: int
    agent: str
    action: str
    status: str = "pending"
    input: Any = None
    output: Any = None
    retries: int = 0
    tool_calls_made: int = 0
    duration_s: float = 0.0
    errors: list[str] = field(default_factory=list)
    model_used: str = ""
    quant_level: str = "unknown"
    p95_ms: float = 0.0


@dataclass
class TaskTrace:
    task_id: str
    goal: str
    status: TaskStatus = TaskStatus.PENDING
    plan: Optional[dict] = None
    steps: list[StepRecord] = field(default_factory=list)
    messages: list[dict] = field(default_factory=list)
    memory: dict = field(default_factory=dict)
    final_answer: Optional[dict] = None
    escalations: list[dict] = field(default_factory=list)
    started_at: float = field(default_factory=time.time)
    finished_at: float = 0.0
    total_tokens_est: int = 0

    def add_message(self, role: str, content: Any, model: str = "") -> None:
        self.messages.append({"ts": time.time(), "role": role, "model": model, "content": content})

    def save(self, out_dir: Path) -> None:
        """[ENH-02] Atomic write via .tmp + rename to prevent partial files on crash."""
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / f"trace_{self.task_id}.json"
        tmp_path = path.with_suffix(".tmp")
        payload = {
            "task_id": self.task_id,
            "goal": self.goal,
            "status": self.status.value,
            "plan": self.plan,
            "steps": [s.__dict__ for s in self.steps],
            "messages": self.messages,
            "memory": self.memory,
            "final_answer": self.final_answer,
            "escalations": self.escalations,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "duration_s": self.finished_at - self.started_at if self.finished_at else 0.0,
            "total_tokens_est": self.total_tokens_est,
            "latency_stats": get_latency_stats(),
        }
        try:
            with open(tmp_path, "w") as f:
                json.dump(payload, f, indent=2)
            tmp_path.replace(path)  # atomic on POSIX
            log.info("trace_saved", path=str(path))
        except Exception as e:
            log.warning("trace_save_failed", error=str(e))
            try:
                tmp_path.unlink(missing_ok=True)
            except Exception:
                pass


# ─── Ollama Client ────────────────────────────────────────────────────────────

class OllamaError(Exception):
    pass


class OllamaClient:
    """
    Async wrapper around Ollama /api/chat with escalation, caching, and streaming.
    """

    def __init__(self, base_url: Optional[str] = None):
        self.base_url = base_url or OLLAMA_BASE_URL()
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(REQUEST_TIMEOUT(), connect=CONNECT_TIMEOUT()),
        )
        self._current_model: Optional[str] = None

    async def close(self) -> None:
        await self._client.aclose()

    @retry(
        retry=retry_if_exception_type((httpx.HTTPError, OllamaError)),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=30),
    )
    async def _chat_single(
        self,
        model: str,
        messages: list[dict],
        options: Optional[dict] = None,
        schema: Optional[dict] = None,
        stream_callback: Optional[Callable[[str], None]] = None,
    ) -> tuple[str, dict]:
        if self._current_model != model:
            log.info(
                "model_switch",
                from_model=self._current_model,
                to_model=model,
                vram_est_mb=MODEL_VRAM_EST().get(model, "unknown"),
                quant=_detect_quant_level(model),
            )
            self._current_model = model

        payload: dict = {
            "model":    model,
            "messages": messages,
            "stream":   stream_callback is not None,
        }
        if options:
            payload["options"] = options
        if schema is not None and stream_callback is None:
            payload["format"] = schema

        t0 = time.monotonic()
        try:
            if stream_callback is not None:
                raw_text = await self._stream_chat(payload, stream_callback)
                elapsed_ms = round((time.monotonic() - t0) * 1000, 1)
                _record_latency(model, elapsed_ms)  # [ENH-03] streaming path now records latency
                usage = {"completion_tokens": 0, "prompt_tokens": 0,
                         "duration_s": round(elapsed_ms / 1000, 3), "tokens_per_sec": 0,
                         "p95_ms": _p95_latency(model)}
            else:
                resp = await self._client.post("/api/chat", json=payload)
                resp.raise_for_status()
                data = resp.json()
                raw_text = data.get("message", {}).get("content", "")
                elapsed_ms = round((time.monotonic() - t0) * 1000, 1)
                _record_latency(model, elapsed_ms)
                usage = {
                    "prompt_tokens":     data.get("prompt_eval_count", 0),
                    "completion_tokens": data.get("eval_count", 0),
                    "duration_s":        round((time.monotonic() - t0), 3),
                    "tokens_per_sec":    round(
                        data.get("eval_count", 0) / max((time.monotonic() - t0), 0.001), 1
                    ),
                    "p95_ms":            _p95_latency(model),
                }
        except httpx.HTTPStatusError as e:
            if e.response.status_code >= 500:
                raise OllamaError(f"Ollama 5xx: {e.response.status_code}") from e
            raise

        log.debug(
            "inference_complete",
            model=model,
            tokens_out=usage.get("completion_tokens", 0),
            tps=usage.get("tokens_per_sec", 0),
            duration_s=usage.get("duration_s", 0),
            p95_ms=usage.get("p95_ms", 0),
        )
        return raw_text, usage

    async def _stream_chat(self, payload: dict, callback: Callable[[str], None]) -> str:
        full_text = ""
        async with self._client.stream("POST", "/api/chat", json=payload) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                    token = chunk.get("message", {}).get("content", "")
                    if token:
                        callback(token)
                        full_text += token
                    if chunk.get("done"):
                        break
                except Exception:
                    continue
        return full_text

    async def chat(
        self,
        model: str,
        messages: list[dict],
        options: Optional[dict] = None,
        schema: Optional[dict] = None,
        stream_callback: Optional[Callable[[str], None]] = None,
    ) -> tuple[str, dict]:
        """Chat with automatic escalation chain on OllamaError."""
        if stream_callback is None:
            ck = _cache_key(model, messages)
            cached = _cache_get(ck)
            if cached is not None:
                log.debug("llm_cache_hit", model=model)
                return cached, {"cached": True, "completion_tokens": 0, "duration_s": 0.0}

        chain = _escalation_chain_for(model)
        last_exc: Optional[Exception] = None

        for candidate in chain:
            try:
                raw_text, usage = await self._chat_single(
                    candidate, messages, options, schema, stream_callback
                )
                if candidate != model:
                    log.warning("model_escalated", original=model, used=candidate)
                if stream_callback is None:
                    _cache_set(ck, raw_text)  # type: ignore[possibly-undefined]
                return raw_text, usage
            except (OllamaError, httpx.HTTPError) as exc:
                chain_idx = chain.index(candidate)
                log.warning(
                    "model_candidate_failed",
                    model=candidate,
                    error=str(exc),
                    next_in_chain=chain[chain_idx + 1] if chain_idx + 1 < len(chain) else "none",
                )
                last_exc = exc
                continue

        log.error("all_escalation_candidates_failed", model=model, chain=chain, error=str(last_exc))
        fallback = _deterministic_fallback(model, messages)
        return fallback, {"completion_tokens": 0, "duration_s": 0.0, "fallback": True}

    async def list_models(self) -> list[str]:
        try:
            resp = await self._client.get("/api/tags")
            resp.raise_for_status()
            return [m["name"] for m in resp.json().get("models", [])]
        except Exception:
            return []

    async def ensure_models_exist(self, include_evolution: bool = False) -> None:
        available = await self.list_models()
        required: set[str] = set(MODEL_ROLES().values())
        if include_evolution:
            required |= set(EVOLUTION_MODELS().values())
        missing = [f"'{m}'" for m in required if not any(m in a for a in available)]
        if missing:
            raise OllamaError(
                f"Missing models: {', '.join(missing)}. Run: bash scripts/install.sh"
            )
        log.info("all_models_verified", count=len(required))


# ─── Deterministic fallback ───────────────────────────────────────────────────

def _deterministic_fallback(model: str, messages: list[dict]) -> str:
    last_content = ""
    for m in reversed(messages):
        if m.get("role") == "user":
            raw = m.get("content", "")
            last_content = raw[:80] if isinstance(raw, str) else str(raw)[:80]
            break
    digest = hashlib.sha256(f"{model}:{last_content}".encode()).hexdigest()[:12]
    return json.dumps({
        "type": "step_complete",
        "task_id": "fallback",
        "step_id": 1,
        "output": (
            f"[deterministic-fallback:{model}] All LLM candidates failed. Digest: {digest}. "
            "Review Ollama service health and model availability."
        ),
        "confidence": "low",
        "warnings": ["deterministic_fallback_used", f"model_chain_exhausted:{model}"],
    })


# ─── Batch generation helper ──────────────────────────────────────────────────

async def run_batch(
    ollama: OllamaClient,
    prompts: list[str],
    model: Optional[str] = None,
    max_concurrent: Optional[int] = None,
) -> list[str]:
    """Fan-out prompts to the fast model in parallel. Results in input order."""
    _model = model or MODEL_ROLES()["fast"]
    _max = min(max_concurrent or CO_LOAD_MAX_CONCURRENT(), CO_LOAD_MAX_CONCURRENT())
    semaphore = asyncio.Semaphore(_max)

    async def _call(prompt: str) -> str:
        async with semaphore:
            raw, _ = await ollama.chat(_model, [{"role": "user", "content": prompt}])
            return raw

    return list(await asyncio.gather(*[_call(p) for p in prompts]))


# ─── Message parsing ──────────────────────────────────────────────────────────

def strip_think_block(text: str) -> str:
    """Remove DeepSeek-R1 <think>...</think> chain-of-thought blocks."""
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


def extract_json(text: str) -> Optional[dict]:
    """Robustly extract a JSON object from model output."""
    text = strip_think_block(text)
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"```\s*$", "", text, flags=re.MULTILINE)
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return None


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def is_envelope(parsed: dict) -> tuple[bool, str]:
    status = parsed.get("status", "")
    if status in ("ESCALATE", "BLOCK", "CLARIFY", "DONE", "APPROVAL_REQUIRED", "SCOPE_CREEP"):
        return True, status
    return False, ""


# ─── Vertical Context Injection ───────────────────────────────────────────────

def _detect_vertical_context(task: str) -> str:
    """Consolidated vertical detection with domain constraint injection."""
    task_l = task.lower()
    lines: list[str] = []

    _taxbridge_tokens = {
        "taxbridge", "nrs", "firs", "cbn", "ndpc", "nibss",
        "paystack", "remita", "e-invoice", "invoice-irn", "effect-ts",
        "irn", "firs tin", "bvn", "kyc tier",
    }
    if any(tok in task_l for tok in _taxbridge_tokens):
        lines.append(
            "VERTICAL [TaxBridge · NRS Compliance]:\n"
            "  · All monetary values: Decimal, never float\n"
            "  · NRS e-invoice fields: IRN, FIRS TIN, BVN/KYC tier required\n"
            "  · Webhook verification: SHA-512 HMAC (Paystack standard)\n"
            "  · Idempotency keys on all payment mutations\n"
            "  · NDPC data residency: PII must stay in Nigeria-region storage\n"
        )

    if any(sig in task_l for sig in ("sabiscore", "ml observ", "sports intel", "opentelemetry", "otel")):
        lines.append(
            "VERTICAL [SabiScore · ML Observability]:\n"
            "  · OpenTelemetry spans on all ML pipeline stages\n"
            "  · Model metrics: precision/recall logged per prediction\n"
            "  · BullMQ job tracing: job_id → span_id correlation required\n"
        )

    if any(sig in task_l for sig in ("hashablanca", "zero-knowledge", "zk", "zkp", "blockchain")):
        lines.append(
            "VERTICAL [Hashablanca · ZK Infrastructure]:\n"
            "  · ZK proof generation: never expose witness data in logs\n"
            "  · Circuit constraints must be formally verified before deploy\n"
            "  · Key management: HSM-backed, never in-process\n"
            "  · Commitment schemes: use Pedersen or Poseidon, not SHA-256 for ZK paths\n"
        )

    if any(sig in task_l for sig in ("fintech", "banking", "wallet", "payment", "kyc")):
        lines.append(
            "VERTICAL [Generic Fintech · Compliance]:\n"
            "  · PII fields: encrypted at rest (AES-256-GCM minimum)\n"
            "  · Audit log: append-only, tamper-evident\n"
            "  · Rate limiting: per-user per-endpoint (not just global)\n"
        )

    if not lines:
        return ""
    return "\n\nDOMAIN CONSTRAINTS (must honour in all output):\n" + "".join(lines)


# ─── Skill fragment injection ─────────────────────────────────────────────────

def _load_skill_fragment(role: str, task: str) -> str:
    """Load matching skill fragments from SWARM_ROOT/skills."""
    swarm_root = os.environ.get("SWARM_ROOT", ".")
    skill_dirs = [
        Path(swarm_root) / "skills",
        Path(__file__).parent.parent / "skills",
    ]
    task_l = task.lower()
    role_l = role.lower()
    fragments: list[str] = []

    for skill_dir in skill_dirs:
        if not skill_dir.is_dir():
            continue
        for skill_file in sorted(skill_dir.glob("*.md"))[:10]:
            try:
                content = skill_file.read_text(encoding="utf-8")
                skill_name = skill_file.stem.lower().replace("-", " ")
                if any(kw in task_l or kw in role_l for kw in skill_name.split()):
                    fragments.append(f"[Skill:{skill_file.stem}]\n{content[:300]}")
            except Exception:
                continue
        if fragments:
            break

    if not fragments:
        return ""
    return "\n\nSKILL LIBRARY CONTEXT:\n" + "\n---\n".join(fragments[:3])


# ─── Complexity Routing ───────────────────────────────────────────────────────

async def score_complexity(
    ollama: OllamaClient,
    task_description: str,
    task_id: str,
) -> float:
    """
    Score task complexity 0.0–1.0.
    Returns 0.5 (neutral routing) on any failure — never blocks task routing.

    [FIX-CRITICAL-01] The double try-block without a matching except (SyntaxError
    in V5.6) is fixed: _timeout is resolved before the single guarded try block.
    """
    request = json.dumps({
        "task_id": task_id,
        "instruction": (
            "Score the complexity of this task 0.0 to 1.0. "
            "0.0 = trivial lookup. 1.0 = deep architectural reasoning. "
            'Return JSON: {"type":"classify","label":"<label>",'
            '"confidence":<score 0.0-1.0>,"score":<score 0.0-1.0>,"reason":"<5 words>"}.'
        ),
        "task": task_description[:500],
    })

    # [FIX-CRITICAL-01] Resolve timeout BEFORE the try block — not inside it.
    _timeout = float(cfg("routing.complexity_score_timeout_s", 30.0))

    try:
        raw, _ = await asyncio.wait_for(
            ollama.chat(
                model=MODEL_ROLES()["fast"],
                messages=[{"role": "user", "content": request}],
            ),
            timeout=_timeout,
        )
        parsed = extract_json(raw)
        if parsed:
            raw_score = parsed.get("confidence", parsed.get("score", 0.5))
            try:
                score = float(raw_score)
            except (TypeError, ValueError):
                score = 0.5
            score = max(0.0, min(1.0, score))
            log.debug(
                "complexity_scored",
                score=score,
                threshold=REASONER_COMPLEXITY_THRESHOLD(),
                task_id=task_id,
            )
            return score
    except asyncio.TimeoutError:
        log.warning("complexity_scoring_timeout", timeout_s=_timeout, task_id=task_id)
    except Exception as e:
        log.warning("complexity_scoring_failed", error=str(e))
    return 0.5


# ─── Core Orchestrator ────────────────────────────────────────────────────────

class SwarmXOrchestrator:
    """
    Multi-agent orchestration engine (V5.9).

    Phase flow:
      1. Receive user task
      2. phi4-fast scores complexity → selects planner
      3. Supervisor/Reasoner creates plan
      4. Per-step execution with tool call loop + escalation
      5. Supervisor synthesises final_answer
      6. Optional: critic audit, APEX-17 evolution
    """

    def __init__(self, ollama: OllamaClient, trace_dir: Path = Path("traces")):
        self.ollama = ollama
        self.trace_dir = trace_dir
        self._tool_dispatch = None
        self._tool_dispatch_lock = asyncio.Lock()   # [V5.9] async safety
        self._active_trace: Optional[TaskTrace] = None

    def _get_tool_dispatch(self):
        if self._tool_dispatch is None:
            try:
                from tools import dispatch_tool
                self._tool_dispatch = dispatch_tool
            except ImportError:
                async def _noop_dispatch(name, args):
                    from tools import ToolResult
                    return ToolResult(status="error", result=None,
                                      error_detail="tools module not loaded")
                self._tool_dispatch = _noop_dispatch
        return self._tool_dispatch

    async def _get_tool_dispatch_async(self):
        """[V5.9] Async-safe lazy import with lock — prevents duplicate init
        under concurrent _execute_step() calls."""
        if self._tool_dispatch is not None:
            return self._tool_dispatch
        async with self._tool_dispatch_lock:
            if self._tool_dispatch is not None:
                return self._tool_dispatch
            try:
                from tools import dispatch_tool
                self._tool_dispatch = dispatch_tool
            except ImportError:
                async def _noop_dispatch(name, args):
                    from tools import ToolResult
                    return ToolResult(status="error", result=None,
                                      error_detail="tools module not loaded")
                self._tool_dispatch = _noop_dispatch
        return self._tool_dispatch

    def _model_for_role(self, role: str) -> str:
        return MODEL_ROLES().get(role, MODEL_ROLES()["worker"])

    def _should_compress_memory(self, trace: TaskTrace, model: str) -> bool:
        ctx_limit = MODEL_CONTEXT().get(model, 8192)
        total_chars = 0
        for m in trace.messages[-20:]:
            content = m.get("content", "")
            if isinstance(content, str):
                total_chars += len(content)
            else:
                try:
                    total_chars += len(json.dumps(content))
                except (TypeError, ValueError):
                    total_chars += len(str(content))
        return (total_chars // 4) > int(ctx_limit * MEMORY_COMPRESSION_THRESHOLD())

    async def _compress_memory(self, trace: TaskTrace) -> None:
        log.info("memory_compression_triggered", task_id=trace.task_id)
        compression_request = json.dumps({
            "task": "memory_compression",
            "task_id": trace.task_id,
            "messages_to_compress": trace.messages[-10:],
            "instruction": (
                "Compress the above message history into a memory_update JSON. "
                "Keep all critical facts. Discard redundant information."
            ),
        })
        raw, _ = await self.ollama.chat(
            model=MODEL_ROLES()["reasoner"],
            messages=[{"role": "user", "content": compression_request}],
        )
        msg = extract_json(raw)
        if msg and msg.get("type") == "memory_update":
            trace.memory["compressed_context"] = msg.get("compressed_context", "")
            trace.memory["key_facts"] = msg.get("key_facts", [])
            log.info("memory_compressed", facts=len(trace.memory["key_facts"]))

    def _initial_messages(self, trace: TaskTrace, delegation_content: str) -> list[dict]:
        msgs: list[dict] = []
        if trace.memory.get("compressed_context"):
            msgs.append({
                "role": "user",
                "content": f"[CONTEXT SUMMARY]\n{trace.memory['compressed_context']}\n[END SUMMARY]",
            })
        msgs.append({"role": "user", "content": delegation_content})
        return msgs

    async def _execute_tool_call_loop(
        self,
        trace: TaskTrace,
        step: StepRecord,
        model: str,
        delegation: dict,
    ) -> Optional[dict]:
        """
        Multi-turn tool call loop for a single step.
        Message list accumulated across all turns — never rebuilt.
        [ENH-01] CLARIFY envelope injects structured response back into loop.
        """
        dispatch = await self._get_tool_dispatch_async()
        messages = self._initial_messages(trace, json.dumps(delegation))
        max_tool_calls = MAX_TOOL_CALLS_PER_STEP()
        current_model = model
        _use_schema = step.agent not in ("reasoner", "critic")

        # [V5.9-ENH] _prune_messages: keep the tool-call sub-loop from
        # growing unbounded and blowing through the model's context window.
        # Keeps the initial delegation message + the last N turn pairs.
        _TOOL_LOOP_MSG_KEEP = int(cfg("orchestration.tool_loop_msg_keep", 12))

        def _prune_messages(msgs: list[dict]) -> list[dict]:
            if len(msgs) <= _TOOL_LOOP_MSG_KEEP + 1:
                return msgs
            # Always keep the first message (delegation) + last N
            return [msgs[0]] + msgs[-_TOOL_LOOP_MSG_KEEP:]

        for _ in range(max_tool_calls + 1):
            messages = _prune_messages(messages)   # [V5.9] prune on every turn
            raw, usage = await self.ollama.chat(
                model=current_model,
                messages=messages,
                schema=STEP_COMPLETE_SCHEMA if _use_schema else None,
            )
            trace.total_tokens_est += usage.get("completion_tokens", 0)
            trace.add_message("assistant", raw, model=current_model)

            parsed = extract_json(raw)
            if parsed is None:
                # FIX-08 (from V5.4): continue — not return None. Consumes one
                # budget slot and retries rather than killing the step.
                messages.append({"role": "assistant", "content": raw})
                messages.append({"role": "user", "content": json.dumps({
                    "type": "retry_hint",
                    "reason": "Response was not valid JSON. Please emit a step_complete JSON.",
                })})
                continue

            envelope_hit, etype = is_envelope(parsed)
            if envelope_hit:
                log.warning("envelope_received", envelope=etype,
                            step_id=step.step_id, task_id=trace.task_id)
                trace.escalations.append({
                    "step_id": step.step_id,
                    "envelope": etype,
                    "payload": parsed,
                    "ts": time.time(),
                })
                if etype == "BLOCK":
                    step.errors.append(f"BLOCKED: {parsed.get('reason', '')}")
                    step.status = "failed"
                    return None
                if etype == "APPROVAL_REQUIRED":
                    reason = parsed.get("reason", "unspecified")
                    log.warning("approval_required", step_id=step.step_id, reason=reason)
                    step.errors.append(f"APPROVAL_REQUIRED: {reason}")
                    step.status = "failed"
                    if trace.escalations:
                        trace.escalations[-1]["requires_human_approval"] = True
                    return None
                if etype == "DONE":
                    log.info("done_envelope_accepted", step_id=step.step_id)
                    return {
                        "type": "step_complete",
                        "task_id": trace.task_id,
                        "step_id": step.step_id,
                        "output": parsed.get("result", parsed),
                        "confidence": "medium",
                        "warnings": ["done_envelope_converted"],
                    }
                if etype == "CLARIFY":
                    # [ENH-01] Inject structured clarification response so model
                    # can resume with a concrete answer rather than hitting the
                    # budget ceiling on unanswered clarification loops.
                    clarification_q = parsed.get("question", "Please clarify the task.")
                    log.info("clarify_envelope", step_id=step.step_id,
                             question=clarification_q[:100])
                    messages.append({"role": "assistant", "content": raw})
                    messages.append({"role": "user", "content": json.dumps({
                        "type": "clarification_response",
                        "question": clarification_q,
                        "answer": (
                            "Proceed with the information available. "
                            "If the task is ambiguous, choose the most conservative "
                            "interpretation and note the assumption in your output's "
                            "warnings field."
                        ),
                    })})
                    continue
                if etype in ("ESCALATE", "SCOPE_CREEP"):
                    new_model = MODEL_ROLES()["reasoner"]
                    _use_schema = False
                    log.info("escalating_to_reasoner",
                             from_model=current_model, step_id=step.step_id)
                    messages.append({"role": "assistant", "content": raw})
                    messages.append({"role": "user", "content": json.dumps({
                        "type": "escalation_handoff",
                        "reason": etype,
                        "escalation_context": parsed,
                        "instruction": (
                            "You have been escalated to handle this step. "
                            "Review the conversation history and emit step_complete."
                        ),
                    })})
                    current_model = new_model
                    continue

            if parsed.get("type") == "tool_call":
                tool_name = parsed.get("tool", "")
                tool_args = parsed.get("args", {})
                step.tool_calls_made += 1
                log.info("tool_dispatch", tool=tool_name,
                         step_id=step.step_id, call_n=step.tool_calls_made)
                tool_result = await dispatch(tool_name, tool_args)
                tool_result_msg = json.dumps({
                    "type": "tool_result",
                    "task_id": trace.task_id,
                    "step_id": step.step_id,
                    "tool": tool_name,
                    "status": tool_result.status,
                    "result": tool_result.result,
                    "error_detail": tool_result.error_detail,
                })
                messages.append({"role": "assistant", "content": raw})
                messages.append({"role": "user", "content": tool_result_msg})
                trace.add_message("tool_result", tool_result.to_dict(), model="system")
                continue

            terminal_types = {
                "step_complete", "analysis", "code", "code_plan",
                "plan_refinement", "critique"
            }
            if parsed.get("type") in terminal_types:
                return parsed
            if parsed.get("type") == "step_error":
                return parsed

            messages.append({"role": "assistant", "content": raw})
            messages.append({"role": "user", "content": json.dumps({
                "type": "format_hint",
                "instruction": (
                    "Emit one of: step_complete, tool_call, step_error, or an ESCALATE envelope. "
                    "No other response types are accepted."
                ),
            })})

        log.warning("tool_call_budget_exhausted",
                    max=max_tool_calls, step_id=step.step_id)
        return None

    async def _execute_step(self, trace: TaskTrace, step: StepRecord) -> bool:
        """Execute a single step. Returns True on success, False on failure."""
        model = self._model_for_role(step.agent)
        step.status = "running"
        step.model_used = model
        step.quant_level = _detect_quant_level(model)
        t0 = time.monotonic()

        delegation = {
            "type": "delegation",
            "task_id": trace.task_id,
            "step_id": step.step_id,
            "agent": step.agent,
            "instruction": step.action,
            "input": step.input,
            "expected_output_schema": "step_complete",
            "timeout_seconds": 120 if step.agent == "reasoner" else 60,
        }

        for attempt in range(MAX_RETRIES_PER_STEP()):
            try:
                log.info(
                    "step_execute",
                    task_id=trace.task_id,
                    step_id=step.step_id,
                    agent=step.agent,
                    model=model,
                    quant=step.quant_level,
                    attempt=attempt + 1,
                )
                if self._should_compress_memory(trace, model):
                    await self._compress_memory(trace)

                parsed = await self._execute_tool_call_loop(trace, step, model, delegation)

                if parsed is None:
                    step.errors.append(f"Attempt {attempt + 1}: no valid JSON response")
                    step.retries += 1
                    continue

                if parsed.get("type") == "step_error":
                    recoverable = parsed.get("recoverable", False)
                    log.warning("step_error_from_agent",
                                error_code=parsed.get("error_code"),
                                recoverable=recoverable)
                    step.errors.append(parsed.get("error_detail", ""))
                    step.retries += 1
                    if not recoverable:
                        step.status = "failed"
                        return False
                    continue

                step.output = parsed
                step.duration_s = time.monotonic() - t0
                step.p95_ms = _p95_latency(model)
                step.status = "complete"
                log.info(
                    "step_complete",
                    step_id=step.step_id,
                    agent=step.agent,
                    model=model,
                    duration_s=round(step.duration_s, 2),
                    confidence=parsed.get("confidence", "?"),
                    tool_calls=step.tool_calls_made,
                    p95_ms=step.p95_ms,
                )
                return True

            except (OllamaError, httpx.HTTPError) as e:
                log.error("step_http_error", error=str(e), attempt=attempt)
                step.errors.append(f"HTTP error: {e}")
                step.retries += 1
                backoff_base = cfg("orchestration.retry_backoff_base_seconds", 2)
                backoff_max  = cfg("orchestration.retry_backoff_max_seconds", 30)
                await asyncio.sleep(min(backoff_base ** attempt, backoff_max))

        step.status = "failed"
        return False

    def _interrupt_checkpoint(self, trace: TaskTrace) -> None:
        """Write ABORTED trace on SIGTERM / KeyboardInterrupt."""
        trace.status = TaskStatus.ABORTED
        trace.finished_at = time.time()
        try:
            trace.save(self.trace_dir)
            _emit_health_log({
                "event": "interrupt_checkpoint",
                "task_id": trace.task_id,
                "status": "aborted",
            })
        except Exception:
            pass

    async def run(self, user_task: str) -> dict:
        """
        Main entry point. Accepts plain-text task description.
        Returns final_answer dict or error dict.

        [FIX-CRITICAL-02] Signal-handler closures are now defined INSIDE run()
        with `nonlocal` declarations, preventing NameError on SIGTERM/Ctrl-C.
        """
        task_id = str(uuid.uuid4())
        trace = TaskTrace(task_id=task_id, goal=user_task)
        self._active_trace = trace
        trace.status = TaskStatus.PLANNING
        trace_dir = Path(cfg("traces.output_dir", "traces"))

        # Mutable state shared with closures — declare here so nonlocal works
        original_sigterm = None
        original_sigint = None
        signals_installed = False
        trace_persisted = False

        # ── Closure definitions (MUST be inside run()) ─────────────────────
        def _restore_signals() -> None:
            nonlocal signals_installed
            if not signals_installed:
                return
            try:
                if original_sigterm is not None:
                    signal.signal(signal.SIGTERM, original_sigterm)
            except Exception:
                pass
            try:
                if original_sigint is not None:
                    signal.signal(signal.SIGINT, original_sigint)
            except Exception:
                pass

        def _persist_trace() -> None:
            nonlocal trace_persisted
            trace.save(trace_dir)
            trace_persisted = True

        def _handle_sigterm(signum, frame):
            self._interrupt_checkpoint(trace)
            _restore_signals()
            sys.exit(0)

        def _handle_sigint(signum, frame):
            self._interrupt_checkpoint(trace)
            _restore_signals()
            raise KeyboardInterrupt
        # ──────────────────────────────────────────────────────────────────────

        try:
            original_sigterm = signal.getsignal(signal.SIGTERM)
            original_sigint  = signal.getsignal(signal.SIGINT)
            signal.signal(signal.SIGTERM, _handle_sigterm)
            signal.signal(signal.SIGINT,  _handle_sigint)
            signals_installed = True
        except (ValueError, OSError):
            pass  # Not on main thread — signal registration unavailable

        log.info("task_start", task_id=task_id, goal=user_task[:100])

        try:
            # ── PHASE 0: Complexity scoring ──────────────────────────────────
            complexity = await score_complexity(self.ollama, user_task, task_id)
            log.info("complexity_score", score=complexity, task_id=task_id)

            planner_role = "reasoner" if complexity > REASONER_COMPLEXITY_THRESHOLD() else "supervisor"
            planner_model = MODEL_ROLES()[planner_role]
            log.info("planner_selected", model=planner_model, complexity=complexity)

            # ── PHASE 1: Planning ────────────────────────────────────────────
            vertical_ctx = _detect_vertical_context(user_task)
            skill_ctx = _load_skill_fragment(planner_role, user_task)

            plan_request = json.dumps({
                "task_id": task_id,
                "user_request": user_task,
                "complexity": complexity,
                "instruction": (
                    "Decompose this task into a plan. "
                    "Use 'worker' for simple tool execution. "
                    "Use 'executor' for complex multi-step tool chains. "
                    "Use 'reasoner' only for complex analysis or code generation. "
                    "Emit a plan schema JSON."
                ),
                "domain_constraints": vertical_ctx or None,
                "skill_context": skill_ctx or None,
            })

            trace.add_message("user", plan_request)
            raw_plan, usage = await self.ollama.chat(
                model=planner_model,
                messages=[{"role": "user", "content": plan_request}],
            )
            trace.add_message("assistant", raw_plan, model=planner_model)
            trace.total_tokens_est += (usage or {}).get("completion_tokens", 0)

            plan = extract_json(raw_plan)
            if plan is None or not isinstance(plan, dict) or plan.get("type") not in ("plan", "plan_id"):
                log.warning("plan_parse_failed", raw=raw_plan[:300] if raw_plan else "")
                plan = {
                    "type": "plan",
                    "task_id": task_id,
                    "goal": user_task,
                    "steps": [{
                        "step_id": 1,
                        "agent": "executor",
                        "action": user_task,
                        "depends_on": [],
                        "schema": "step_complete",
                    }],
                    "constraints": [],
                    "fallback": "abort",
                    "warnings": ["plan_parse_failed_using_fallback"],
                }

            plan_errors = validate_message(plan, "plan")
            if plan_errors:
                log.warning("plan_schema_errors", errors=plan_errors)

            steps = plan.get("steps") or []
            normalized_steps: list[dict] = []
            seen_step_ids: set[int] = set()

            for idx, raw_step in enumerate(steps, 1):
                if not isinstance(raw_step, dict):
                    raw_step = {"action": str(raw_step)}
                try:
                    step_id = int(raw_step.get("step_id", idx))
                except (TypeError, ValueError):
                    step_id = idx
                if step_id in seen_step_ids:
                    step_id = idx
                seen_step_ids.add(step_id)
                raw_step["step_id"] = step_id
                raw_step.setdefault("agent", "worker")
                raw_step.setdefault("action", raw_step.get("objective", ""))
                raw_step.setdefault("depends_on", [])
                normalized_steps.append(raw_step)

            # [ENH-04] Guard: ensure at least one step is always present
            if not normalized_steps:
                log.warning("plan_produced_no_steps", task_id=task_id)
                normalized_steps = [{
                    "step_id": 1,
                    "agent": "executor",
                    "action": user_task,
                    "depends_on": [],
                    "schema": "step_complete",
                }]
                plan["steps"] = normalized_steps

            trace.plan = plan
            trace.status = TaskStatus.RUNNING

            for s in normalized_steps:
                trace.steps.append(
                    StepRecord(
                        step_id=s["step_id"],
                        agent=s.get("agent", "worker"),
                        action=s.get("action", s.get("objective", "")),
                        input=None,
                    )
                )

            plan_steps_by_id = {int(s["step_id"]): s for s in normalized_steps}
            log.info("plan_created", steps=len(trace.steps), planner=planner_model)

            # ── [V5.9] TaskGraph-parallel execution for independent steps ──
            # If the plan has any steps that have no dependencies (true root
            # nodes), execute all root-level steps in parallel via brain.graph
            # before falling through to the sequential loop for dep-bound steps.
            try:
                from brain.graph import build_graph_from_plan, TaskGraph, TaskNode  # type: ignore

                async def _graph_dispatcher(node_id: str, task_payload: Any) -> Any:
                    """Bridge brain.graph dispatcher → orchestrator step execution."""
                    matching = [sr for sr in trace.steps if str(sr.step_id) == node_id]
                    if not matching:
                        return None
                    sr = matching[0]
                    if sr.status not in ("pending",):
                        return sr.output
                    await self._execute_step(trace, sr)
                    return sr.output

                root_ids = {
                    str(s["step_id"])
                    for s in normalized_steps
                    if not s.get("depends_on")
                }

                if len(root_ids) > 1:
                    graph = build_graph_from_plan(plan)
                    root_graph = TaskGraph([
                        TaskNode(nid, graph.nodes[nid].task)
                        for nid in root_ids
                        if nid in graph.nodes
                    ])
                    log.info("graph_parallel_roots",
                             count=len(root_ids),
                             task_id=task_id)
                    await root_graph.execute(_graph_dispatcher)
            except Exception as _graph_exc:
                log.debug("graph_parallel_skipped", reason=str(_graph_exc))

            # ── PHASE 2: Execution ───────────────────────────────────────────
            guard = 0
            max_steps = max(1, int(MAX_STEPS_PER_TASK()))

            for step in trace.steps:
                guard += 1
                if guard > max_steps:
                    log.error("max_steps_exceeded", task_id=task_id)
                    trace.status = TaskStatus.ABORTED
                    break

                # [V5.9] Skip steps already executed by the parallel graph dispatcher
                if step.status == "complete":
                    log.debug("step_already_complete_via_graph", step_id=step.step_id)
                    continue

                plan_step = plan_steps_by_id.get(step.step_id, {})
                deps = plan_step.get("depends_on", [])
                if isinstance(deps, (str, int)):
                    deps = [deps]
                elif not isinstance(deps, (list, tuple, set)):
                    deps = []

                dep_ids: list[int] = []
                for dep in deps:
                    try:
                        dep_ids.append(int(dep))
                    except (TypeError, ValueError):
                        continue

                if dep_ids:
                    dep_map = {s.step_id: s.output for s in trace.steps if s.output is not None}
                    ordered_outputs = [dep_map[d] for d in dep_ids if d in dep_map]
                    missing = [d for d in dep_ids if d not in dep_map]
                    if missing:
                        log.warning("missing_dependencies",
                                    step_id=step.step_id, missing=missing)
                    step.input = ordered_outputs[0] if len(ordered_outputs) == 1 else ordered_outputs

                if step.agent == "worker" and complexity > REASONER_COMPLEXITY_THRESHOLD():
                    log.info("agent_upgraded_to_reasoner",
                             step_id=step.step_id, complexity=complexity)
                    step.agent = "reasoner"

                success = await self._execute_step(trace, step)

                if not success:
                    if any(e.get("envelope") == "BLOCK" for e in trace.escalations):
                        log.error("task_blocked_by_agent", step_id=step.step_id)
                        trace.status = TaskStatus.BLOCKED
                        break

                    fallback = plan.get("fallback", "abort")
                    if "abort" in str(fallback).lower():
                        trace.status = TaskStatus.FAILED
                        break

                    log.warning("continuing_after_failure",
                                fallback=fallback, step_id=step.step_id)

            # ── PHASE 3: Final Answer ────────────────────────────────────────
            trace.status = TaskStatus.VALIDATING

            completed_outputs = {
                str(s.step_id): s.output
                for s in trace.steps
                if s.status == "complete" and s.output
            }

            final_request = json.dumps({
                "task_id": task_id,
                "original_goal": user_task,
                "completed_steps": completed_outputs,
                "task_status": trace.status.value,
                "instruction": "Synthesize completed step outputs into a final_answer JSON.",
            })
            trace.add_message("user", final_request)

            final_model = MODEL_ROLES().get("supervisor", planner_model)
            fallback_final_model = MODEL_ROLES().get("executor", final_model)
            used_final_model = final_model
            raw_final = ""
            final_usage: dict = {}
            final_error = None

            try:
                raw_final, final_usage = await self.ollama.chat(
                    model=final_model,
                    messages=[{"role": "user", "content": final_request}],
                )
            except Exception as final_exc:
                final_error = final_exc
                if fallback_final_model != final_model:
                    log.warning(
                        "final_synthesis_supervisor_failed",
                        error=str(final_exc),
                        fallback=fallback_final_model,
                    )
                    used_final_model = fallback_final_model
                    try:
                        raw_final, final_usage = await self.ollama.chat(
                            model=fallback_final_model,
                            messages=[{"role": "user", "content": final_request}],
                        )
                        final_error = None
                    except Exception as fallback_exc:
                        final_error = fallback_exc
                        raw_final = ""

            trace.total_tokens_est += (final_usage or {}).get("completion_tokens", 0)
            if raw_final:
                trace.add_message("assistant", raw_final, model=used_final_model)

            final = extract_json(raw_final) if raw_final else None
            if final is None or not isinstance(final, dict) or final.get("type") != "final_answer":
                warnings = ["supervisor_final_parse_failed"]
                if trace.status == TaskStatus.BLOCKED:
                    warnings.append("task_was_blocked")
                if trace.status == TaskStatus.ABORTED:
                    warnings.append("task_was_aborted")
                if trace.status == TaskStatus.FAILED:
                    warnings.append("task_failed_before_finalization")
                if final_error is not None:
                    warnings.append(f"final_synthesis_error:{type(final_error).__name__}")
                final = {
                    "type": "final_answer",
                    "task_id": task_id,
                    "result": completed_outputs,
                    "confidence": "medium",
                    "sources": list(completed_outputs.keys()),
                    "warnings": warnings,
                    "task_status": trace.status.value,
                }

            trace.final_answer = final
            if trace.status == TaskStatus.VALIDATING:
                trace.status = TaskStatus.COMPLETE
            trace.finished_at = time.time()
            _persist_trace()

            duration = trace.finished_at - trace.started_at
            run_summary = {
                "event": "task_complete",
                "task_id": task_id,
                "duration_s": round(duration, 2),
                "final_status": trace.status.value,
                "confidence": final.get("confidence"),
                "tokens_est": trace.total_tokens_est,
                "steps_completed": sum(1 for s in trace.steps if s.status == "complete"),
                "tool_calls_total": sum(s.tool_calls_made for s in trace.steps),
            }
            log.info("task_complete", **run_summary)
            _emit_health_log(run_summary)

            if cfg("traces.auto_critic", False):
                trace_path = trace_dir / f"trace_{task_id}.json"
                asyncio.create_task(self._run_critic_bg(trace_path))

            return final

        except KeyboardInterrupt:
            log.warning("orchestrator_interrupted", task_id=task_id)
            trace.status = TaskStatus.ABORTED
            trace.finished_at = time.time()
            trace.final_answer = trace.final_answer or {
                "type": "final_answer",
                "task_id": task_id,
                "result": {},
                "confidence": "low",
                "sources": [],
                "warnings": ["interrupted"],
                "task_status": trace.status.value,
            }
            if not trace_persisted:
                _persist_trace()
            _emit_health_log({
                "event": "task_interrupted",
                "task_id": task_id,
                "status": trace.status.value,
            })
            return {
                "type": "error",
                "task_id": task_id,
                "error": "interrupted",
                "status": trace.status.value,
            }

        except Exception as e:
            log.exception("orchestrator_error", error=str(e))
            trace.status = TaskStatus.FAILED
            trace.finished_at = time.time()
            trace.final_answer = {
                "type": "final_answer",
                "task_id": task_id,
                "result": {},
                "confidence": "low",
                "sources": [],
                "warnings": [f"orchestrator_error:{type(e).__name__}"],
                "task_status": trace.status.value,
            }
            if not trace_persisted:
                _persist_trace()
            _emit_health_log({
                "event": "task_error",
                "task_id": task_id,
                "error": str(e),
            })
            return {
                "type": "error",
                "task_id": task_id,
                "error": str(e),
                "status": trace.status.value,
            }

        finally:
            try:
                if not trace_persisted:
                    trace.finished_at = trace.finished_at or time.time()
                    _persist_trace()
            finally:
                _restore_signals()
                self._active_trace = None

    async def _run_critic_bg(self, trace_path: Path) -> None:
        """
        [FIX-04] Enforces auto_critic_timeout_s via asyncio.wait_for.
        Guards improvements_log parent mkdir.
        Method is definitively inside SwarmXOrchestrator (was orphaned in V5.7).
        """
        timeout_s = float(cfg("traces.auto_critic_timeout_s", 120))
        try:
            coro = self.run_critic(trace_path)
            audit = (
                await asyncio.wait_for(coro, timeout=timeout_s)
                if timeout_s > 0
                else await coro
            )
            improvements_log = Path(
                cfg("observability.improvements_log", "swarmx_improvements.jsonl")
            )
            improvements_log.parent.mkdir(parents=True, exist_ok=True)
            with open(improvements_log, "a") as f:
                f.write(json.dumps(audit) + "\n")
            log.info("critic_audit_logged", path=str(improvements_log))
        except asyncio.TimeoutError:
            log.warning("critic_bg_timeout",
                        timeout_s=timeout_s, trace=str(trace_path))
        except Exception as e:
            log.error("critic_bg_error", error=str(e))

    async def run_critic(self, trace_path: Path) -> dict:
        """Post-run critic audit. Loads a saved trace and passes it to deepseek-critic."""
        with open(trace_path) as f:
            trace_data = json.load(f)
        critic_request = json.dumps({
            "instruction": "Audit this agent run trace. Emit an audit schema JSON.",
            "trace": trace_data,
        })
        log.info("critic_audit_start", trace=trace_path.name)
        raw, _ = await self.ollama.chat(
            model=MODEL_ROLES()["critic"],
            messages=[{"role": "user", "content": critic_request}],
        )
        audit = extract_json(raw)
        if audit:
            audit_path = trace_path.parent / f"audit_{trace_data['task_id']}.json"
            with open(audit_path, "w") as f:
                json.dump(audit, f, indent=2)
            log.info("audit_saved", path=str(audit_path))
        return audit or {"error": "Critic failed to emit valid audit JSON"}

    async def run_evolution_cycle(self, run_data: dict) -> dict:
        """
        Full APEX-17 evolution cycle: observe → critique → mutate → validate.
        Persists result to .swarmx/evolution-layer/latest.json.
        allow_auto_deploy is ALWAYS False.
        """
        evo_models = EVOLUTION_MODELS()
        safety_floor        = int(cfg("evolution.safety_floor", 4))
        reversibility_floor = int(cfg("evolution.reversibility_floor", 3))
        log.info("evolution_cycle_start")

        async def _evo_chat(phase: str, instruction: str, data: Any) -> Optional[dict]:
            model = evo_models[phase]
            raw, _ = await self.ollama.chat(
                model=model,
                messages=[{"role": "user", "content": json.dumps({
                    "instruction": instruction, "data": data,
                })}],
            )
            result = extract_json(raw)
            log.info("evolve_phase_done",
                     phase=phase,
                     model=model,
                     result_keys=list(result.keys()) if result else [])
            return result

        snapshot = await _evo_chat("observe",  "Observe this run data. Emit a fitness snapshot JSON.", run_data)
        critique = await _evo_chat("critique", "Critique this fitness snapshot. Emit a critique JSON.", snapshot)
        proposal = await _evo_chat("mutate",   "Generate ONE bounded mutation proposal. Emit a proposal JSON.", critique)
        verdict  = await _evo_chat("validate", (
            "Validate this proposal. Score safety (1-5) and reversibility (1-5). "
            "Emit a validation JSON with verdict: ACCEPT or REJECT."
        ), {
            "proposal": proposal, "critique": critique,
            "safety_floor": safety_floor, "reversibility_floor": reversibility_floor,
        })

        if cfg("evolution.allow_auto_deploy", False):
            log.error("evolution_auto_deploy_blocked",
                      reason="allow_auto_deploy must never be true in production")

        result = {
            "cycle": {
                "snapshot": snapshot,
                "critique": critique,
                "proposal": proposal,
                "verdict":  verdict,
            },
            "human_review_required": True,
            "allow_auto_deploy": False,
        }

        evo_path = self.trace_dir / f"evolution_{uuid.uuid4()}.json"
        evo_path.parent.mkdir(parents=True, exist_ok=True)
        with open(evo_path, "w") as f:
            json.dump(result, f, indent=2)

        latest_dir = Path(
            os.environ.get("SWARM_HOME", str(Path.home() / ".swarmx"))
        ) / "evolution-layer"
        latest_dir.mkdir(parents=True, exist_ok=True)
        try:
            (latest_dir / "latest.json").write_text(
                json.dumps(result, indent=2), encoding="utf-8"
            )
            log.info("evolution_latest_written",
                     path=str(latest_dir / "latest.json"))
        except Exception:
            pass

        log.info("evolution_cycle_saved", path=str(evo_path))
        return result

    @staticmethod
    def _get_brain_memory_stats() -> dict:
        """[V5.9] Expose brain/memory stats in health probe."""
        try:
            from brain.memory import stats as mem_stats  # type: ignore
            return mem_stats()
        except Exception:
            return {}

    async def health(self) -> dict:
        """
        Health probe for swarmx-api /health route.
        [ENH-07] Now includes circuit-breaker state per tool when tools available.
        """
        try:
            available_models = await self.ollama.list_models()
            reachable = True
        except Exception as e:
            available_models = []
            reachable = False
            log.warning("health_ollama_unreachable", error=str(e))

        required = set(MODEL_ROLES().values())
        missing  = [m for m in required if not any(m in a for a in available_models)]

        # [ENH-07] Collect circuit-breaker state from tools module if available
        circuit_breaker_state: dict = {}
        try:
            import tools as _tools
            if hasattr(_tools, "_CIRCUIT_BREAKER"):
                circuit_breaker_state = {
                    tool: {
                        "open": state.get("open", False),
                        "consecutive_failures": state.get("consecutive_failures", 0),
                    }
                    for tool, state in _tools._CIRCUIT_BREAKER.items()
                    if state.get("open") or state.get("consecutive_failures", 0) > 0
                }
        except (ImportError, Exception):
            pass

        return {
            "status": "healthy" if reachable and not missing else "degraded",
            "ollama_reachable": reachable,
            "models": {
                "required":   list(required),
                "available":  available_models,
                "missing":    missing,
                "loaded_est": len([m for m in available_models if m in required]),
            },
            "vram_estimates_mb": MODEL_VRAM_EST(),
            "latency_p95":       get_latency_stats(),
            "co_load": {
                "strict_single_model":  cfg("co_load.strict_single_model", True),
                "batch_max_concurrent": CO_LOAD_MAX_CONCURRENT(),
            },
            "circuit_breakers": circuit_breaker_state,
            "brain_memory": self._get_brain_memory_stats(),
            "config_path": str(_CONFIG_PATH),
            "ts": time.time(),
        }


# ─── CLI Entry Point ──────────────────────────────────────────────────────────

async def main() -> None:
    import argparse

    from rich.console import Console
    from rich.json import JSON as RichJSON
    from rich.panel import Panel

    console = Console()
    parser = argparse.ArgumentParser(
        description="SwarmX CLI V5.9 — multi-agent local LLM orchestration",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
Examples:
  python orchestrator.py "Summarise the file ~/notes.txt"
  python orchestrator.py --critic traces/trace_<uuid>.json
  python orchestrator.py --evolve traces/
  python orchestrator.py --health
  python orchestrator.py --latency-stats
""",
    )
    parser.add_argument("task", nargs="*", help="Task description (plain text)")
    parser.add_argument("--critic",    type=str, default=None,
                        help="Run critic on a saved trace file")
    parser.add_argument("--evolve",    type=str, default=None, metavar="TRACE_DIR",
                        help="Run APEX-17 evolution cycle")
    parser.add_argument("--trace-dir", type=str, default=None,
                        help="Override trace output directory")
    parser.add_argument("--include-evolution-models", action="store_true", default=False)
    parser.add_argument("--latency-stats", action="store_true", default=False)
    parser.add_argument("--health",    action="store_true", default=False,
                        help="Print health probe and exit")
    args = parser.parse_args()

    load_config()
    load_schemas()
    _init_cache()

    if _dispatch_log_path_env is None:
        dispatch_log_path = cfg("observability.dispatch_log", "")
        if dispatch_log_path:
            try:
                from tools import configure_dispatch_log
                configure_dispatch_log(dispatch_log_path)
                log.info("dispatch_log_configured", path=dispatch_log_path)
            except ImportError:
                pass
    else:
        try:
            from tools import configure_dispatch_log
            configure_dispatch_log(str(_dispatch_log_path_env))
            log.info("dispatch_log_configured", path=str(_dispatch_log_path_env))
        except ImportError:
            pass

    trace_dir = Path(args.trace_dir or cfg("traces.output_dir", "traces"))
    ollama = OllamaClient()

    try:
        if args.latency_stats:
            stats = get_latency_stats()
            if not stats:
                console.print("[dim]No latency data yet — run at least one task.[/dim]")
            else:
                console.print("\n[bold cyan]P95 Latency Stats[/]")
                console.print(RichJSON(json.dumps(stats, indent=2)))
            return

        if args.health:
            orch = SwarmXOrchestrator(ollama, trace_dir)
            h = await orch.health()
            console.print("\n[bold cyan]SwarmX Health[/]")
            console.print(RichJSON(json.dumps(h, indent=2)))
            return

        if args.critic:
            critic_path = Path(args.critic)
            if not critic_path.exists():
                console.print(f"[bold red]Error:[/] Trace file not found: {critic_path}")
                sys.exit(1)
            orch = SwarmXOrchestrator(ollama, trace_dir)
            audit = await orch.run_critic(critic_path)
            console.print("\n[bold yellow]Critic Audit[/]")
            console.print(RichJSON(json.dumps(audit, indent=2)))
            return

        if args.evolve:
            evo_dir = Path(args.evolve)
            traces  = sorted(evo_dir.glob("trace_*.json"),
                             key=lambda p: p.stat().st_mtime)
            if not traces:
                console.print(f"[bold red]Error:[/] No traces found in: {evo_dir}")
                sys.exit(1)
            with open(traces[-1]) as f:
                run_data = json.load(f)
            console.print(f"[bold cyan]SwarmX Evolution[/] — trace: {traces[-1].name}")
            orch = SwarmXOrchestrator(ollama, trace_dir)
            result = await orch.run_evolution_cycle(run_data)
            console.print("\n[bold yellow]Evolution Cycle Result[/]")
            console.print(RichJSON(json.dumps(result, indent=2)))
            return

        task = " ".join(args.task) if args.task else None
        if not task:
            parser.print_help()
            sys.exit(1)

        await ollama.ensure_models_exist(
            include_evolution=args.include_evolution_models
        )
        orch = SwarmXOrchestrator(ollama, trace_dir)

        console.print(Panel.fit(
            f"[bold cyan]SwarmX V5.9[/] — Task: {task[:80]}",
            border_style="cyan",
        ))
        result = await orch.run(task)
        console.print("\n[bold green]✓ Task Complete[/]")
        console.print(RichJSON(json.dumps(result, indent=2)))

    finally:
        await ollama.close()


if __name__ == "__main__":
    asyncio.run(main())