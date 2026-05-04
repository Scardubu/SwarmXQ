from __future__ import annotations

import os
from dataclasses import dataclass, field, asdict
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from .utils import read_json, write_json


def _split_env(value: str | None, default: list[str]) -> list[str]:
    if not value:
        return list(default)
    out = [x.strip() for x in value.split(",") if x.strip()]
    return out or list(default)


def _boolish(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _bundle_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _merge_dicts(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge_dicts(out[key], value)
        else:
            out[key] = value
    return out


@lru_cache(maxsize=1)
def _bundle_defaults() -> dict[str, Any]:
    merged: dict[str, Any] = {}
    for rel in [
        "configs/swarmx.defaults.yaml",
        "configs/routing.yaml",
        "configs/guardrails.yaml",
        "configs/evolution.yaml",
        "configs/v6-overlay.yaml",
        "configs/mcp-defaults.yaml",
        "models/registry.yaml",
    ]:
        path = _bundle_root() / rel
        if path.exists():
            try:
                data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
                if isinstance(data, dict):
                    merged = _merge_dicts(merged, data)
            except Exception:
                continue
    return merged


def _cfg(*keys: str, default: Any = None) -> Any:
    cur: Any = _bundle_defaults()
    for key in keys:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(key)
        if cur is None:
            return default
    return cur if cur is not None else default


def _model_alias_map() -> dict[str, str]:
    """Return normalized model-tag aliases mapped to canonical Ollama tags.

    [V5.9-FIX-01] The bundled YAML still contains a mix of legacy triad names
    (`phi4-mini`, `deepseek-r1:7b`, `qwen2.5-coder`) and the newer canonical
    runtime tags used by the orchestrator and shipped Modelfiles
    (`phi4-fast`, `deepseek-reasoner`, `qwen-worker`). This helper makes that
    drift explicit and normalizes all three primary runtime slots in one place.
    """
    alias_map: dict[str, str] = {
        "phi4-fast": "phi4-fast",
        "phi4-mini": "phi4-fast",
        "phi4:mini": "phi4-fast",
        "deepseek-reasoner": "deepseek-reasoner",
        "deepseek-r1": "deepseek-reasoner",
        "deepseek-r1:7b": "deepseek-reasoner",
        "qwen-worker": "qwen-worker",
        "qwen2.5-coder": "qwen-worker",
        "qwen2.5-coder:7b": "qwen-worker",
        "phi4-fast:swarmx-evolve": "phi4-fast:swarmx-evolve",
        "phi4-mini:swarmx-evolve": "phi4-fast:swarmx-evolve",
        "qwen2.5:swarmx-evolve": "qwen2.5:swarmx-evolve",
        "deepseek-r1:swarmx-evolve": "deepseek-r1:swarmx-evolve",
    }

    triad = _cfg("triad", default={})
    if isinstance(triad, dict):
        for spec in triad.values():
            if not isinstance(spec, dict):
                continue
            canonical = str(spec.get("ollama_tag") or spec.get("name") or "").strip()
            if not canonical:
                continue
            alias_map[canonical.lower()] = canonical
            raw_name = str(spec.get("name") or "").strip()
            if raw_name:
                alias_map[raw_name.lower()] = canonical
            aliases = spec.get("aliases", [])
            if isinstance(aliases, list):
                for alias in aliases:
                    if alias:
                        alias_map[str(alias).strip().lower()] = canonical

    return alias_map


def normalize_model_tag(value: str | None, fallback: str | None = None) -> str:
    """Normalize a configured or env-sourced model tag to its canonical form."""
    if value is None:
        return fallback or ""
    raw = str(value).strip()
    if not raw:
        return fallback or ""
    return _model_alias_map().get(raw.lower(), raw)


def _resolved_model_setting(
    primary_env: str,
    legacy_env: str,
    triad_slot: str,
    routing_key: str,
    fallback: str,
) -> str:
    """Resolve a model setting with env precedence and canonical normalization."""
    env_value = os.environ.get(primary_env) or os.environ.get(legacy_env)
    if env_value:
        return normalize_model_tag(env_value, fallback=fallback)

    triad_spec = _cfg("triad", triad_slot, default={})
    if isinstance(triad_spec, dict):
        triad_value = triad_spec.get("ollama_tag") or triad_spec.get("name")
        if triad_value:
            return normalize_model_tag(str(triad_value), fallback=fallback)

    return normalize_model_tag(_cfg("routing", routing_key, default=fallback), fallback=fallback)


@dataclass
class SwarmConfig:
    home: Path = field(default_factory=lambda: Path(os.environ.get("SWARM_HOME", Path.home() / ".swarmx")))
    provider: str = field(default_factory=lambda: os.environ.get("SWARM_LLM_PROVIDER", _cfg("routing", "provider", default="ollama")))
    model: str = field(default_factory=lambda: os.environ.get("SWARM_MODEL", ""))
    model_fast: str = field(default_factory=lambda: _resolved_model_setting("SWARM_MODEL_FAST", "MODEL_FAST", "router", "model_fast", "phi4-fast"))
    model_code: str = field(default_factory=lambda: _resolved_model_setting("SWARM_MODEL_CODE", "MODEL_CODE", "code", "model_code", "qwen-worker"))
    model_reason: str = field(default_factory=lambda: _resolved_model_setting("SWARM_MODEL_REASON", "MODEL_REASON", "reason", "model_reason", "deepseek-reasoner"))
    autonomous: bool = field(default_factory=lambda: _boolish(os.environ.get("SWARM_AUTONOMOUS"), _cfg("runtime", "autonomous", default=True)))
    review_required: bool = field(default_factory=lambda: _boolish(os.environ.get("SWARM_REVIEW_REQUIRED"), _cfg("runtime", "review_required", default=False)))
    auto_apply: bool = field(default_factory=lambda: _boolish(os.environ.get("SWARM_AUTO_APPLY"), _cfg("runtime", "auto_apply", default=False)))
    max_iterations: int = field(default_factory=lambda: int(os.environ.get("SWARM_MAX_ITERATIONS", str(_cfg("runtime", "max_iterations", default=3)))))
    checkpoint_every: int = field(default_factory=lambda: int(os.environ.get("SWARM_CHECKPOINT_EVERY", str(_cfg("runtime", "checkpoint_every", default=1)))))
    trace_every_stage: bool = field(default_factory=lambda: _boolish(os.environ.get("SWARM_TRACE_EVERY_STAGE"), _cfg("observability", "trace_every_stage", default=True)))
    persist_run_artifacts: bool = field(default_factory=lambda: _boolish(os.environ.get("SWARM_PERSIST_RUN_ARTIFACTS"), _cfg("observability", "persist_run_artifacts", default=True)))
    evaluator_passes: int = field(default_factory=lambda: int(os.environ.get("SWARM_EVALUATOR_PASSES", str(_cfg("evolution", "budget", "refinement_passes", default=2)))))
    proposal_budget: int = field(default_factory=lambda: int(os.environ.get("SWARM_PROPOSAL_BUDGET", str(_cfg("evolution", "budget", "proposals_per_run", default=3)))))
    risk_floor: str = field(default_factory=lambda: os.environ.get("SWARM_RISK_FLOOR", str(_cfg("safety", "auto_apply_risk_floor", default="low"))))
    workflow_preference: str = field(default_factory=lambda: os.environ.get("SWARM_WORKFLOW", _cfg("routing", "workflow_preference", default="autonomous-pipeline")))
    framework_preference: list[str] = field(default_factory=lambda: _split_env(os.environ.get("SWARM_FRAMEWORKS"), list(_cfg("routing", "framework_preference", default=[]))))
    tool_allowlist: list[str] = field(default_factory=lambda: list(dict.fromkeys(list(_cfg("mcp", "allowlist", default=["git", "python", "python3", "bash", "node", "npm", "pnpm", "pip", "curl", "wget"])))))
    storage_backend: str = field(default_factory=lambda: os.environ.get("SWARM_STORAGE_BACKEND", _cfg("storage", "backend", default="sqlite+jsonl")))
    worker_interval: float = field(default_factory=lambda: float(os.environ.get("SWARM_WORKER_INTERVAL", str(_cfg("runtime", "worker_interval", default=2.0)))))
    worker_pool_size: int = field(default_factory=lambda: int(os.environ.get("SWARM_WORKER_POOL_SIZE", str(_cfg("runtime", "worker_pool_size", default=1)))))
    mission_budget: int = field(default_factory=lambda: int(os.environ.get("SWARM_MISSION_BUDGET", str(_cfg("runtime", "mission_budget", default=4)))))
    graph_limit: int = field(default_factory=lambda: int(os.environ.get("SWARM_GRAPH_LIMIT", str(_cfg("memory", "graph_limit", default=250)))))
    memory_search_limit: int = field(default_factory=lambda: int(os.environ.get("SWARM_MEMORY_SEARCH_LIMIT", str(_cfg("memory", "search_limit", default=20)))))
    live_stream_interval: float = field(default_factory=lambda: float(os.environ.get("SWARM_STREAM_INTERVAL", str(_cfg("observability", "stream_interval", default=2.0)))))
    event_retention: int = field(default_factory=lambda: int(os.environ.get("SWARM_EVENT_RETENTION", str(_cfg("observability", "event_retention", default=200)))))
    mission_retention: int = field(default_factory=lambda: int(os.environ.get("SWARM_MISSION_RETENTION", str(_cfg("observability", "mission_retention", default=100)))))
    control_mode: str = field(default_factory=lambda: os.environ.get("SWARM_CONTROL_MODE", _cfg("runtime", "control_mode", default="hybrid")))
    # ── Ollama connectivity — env SWARMX_OLLAMA_URL overrides config ──────────
    # [V5.9-ENH-01] Added to surface Ollama URL through SwarmConfig so callers
    # do not need to duplicate os.environ.get("SWARMX_OLLAMA_URL") everywhere.
    ollama_url: str = field(default_factory=lambda: os.environ.get(
        "SWARMX_OLLAMA_URL",
        _cfg("routing", "base_url", default="http://localhost:11434"),
    ))
    ollama_timeout_s: int = field(default_factory=lambda: int(os.environ.get(
        "SWARMX_OLLAMA_TIMEOUT",
        str(_cfg("routing", "timeout_seconds", default=180)),
    )))
    # ── Tool execution ────────────────────────────────────────────────────────
    # [V5.9-ENH-02] Per-tool hard-timeout documented in copilot-instructions as
    # TOOL_HARD_TIMEOUT_S but was not surfaced through SwarmConfig.
    tool_hard_timeout_s: int = field(default_factory=lambda: int(os.environ.get(
        "TOOL_HARD_TIMEOUT_S",
        str(_cfg("tool_hard_timeout_s", default=180)),
    )))
    # ── RAG / Memory tunables ─────────────────────────────────────────────────
    # [V5.9-ENH-03] SWARM_MEMORY_TTL_SECONDS and SWARM_RAG_TOP_K are documented
    # env vars but were not bound to SwarmConfig fields.
    memory_ttl_seconds: int = field(default_factory=lambda: int(os.environ.get(
        "SWARM_MEMORY_TTL_SECONDS",
        str(_cfg("brain", "memory_ttl_seconds", default=0)),
    )))
    rag_top_k: int = field(default_factory=lambda: int(os.environ.get(
        "SWARM_RAG_TOP_K",
        str(_cfg("brain", "rag_top_k", default=3)),
    )))
    # ── Retention limits — sourced from guardrails.yaml retention block ───────
    # [V5.9-ENH-04] Previously only memory.retain_recent_* keys were used;
    # guardrails.yaml has a parallel retention: block that was not wired.
    retain_recent_runs: int = field(default_factory=lambda: int(os.environ.get(
        "SWARM_RETAIN_RUNS",
        str(_cfg("retention", "runs", default=_cfg("memory", "retain_recent_runs", default=50))),
    )))
    retain_recent_memories: int = field(default_factory=lambda: int(os.environ.get(
        "SWARM_RETAIN_MEMORIES",
        str(_cfg("retention", "memories", default=_cfg("memory", "retain_recent_memories", default=200))),
    )))
    # ── Runtime Governance — pressure thresholds and enforcement flags ────────
    # [V5.9-ENH-05] Procfs-based pressure state machine wired through config so
    # orchestrator and graph executor can adapt concurrency and token budgets.
    pressure_warn_mb: int = field(default_factory=lambda: int(os.environ.get(
        "SWARM_PRESSURE_WARN_MB",
        str(_cfg("governance", "pressure", "warn_available_mb", default=1500)),
    )))
    pressure_critical_mb: int = field(default_factory=lambda: int(os.environ.get(
        "SWARM_PRESSURE_CRITICAL_MB",
        str(_cfg("governance", "pressure", "critical_available_mb", default=800)),
    )))
    pressure_check_interval_s: float = field(default_factory=lambda: float(os.environ.get(
        "SWARM_PRESSURE_INTERVAL",
        str(_cfg("governance", "pressure", "check_interval_s", default=5.0)),
    )))
    strict_escalation: bool = field(default_factory=lambda: _boolish(
        os.environ.get("SWARM_STRICT_ESCALATION"),
        _cfg("governance", "escalation", "strict_tier_enforcement", default=True),
    ))
    governance_observe_only: bool = field(default_factory=lambda: _boolish(
        os.environ.get("SWARM_GOVERNANCE_OBSERVE_ONLY"),
        _cfg("governance", "observe_only", default=False),
    ))
    governance_normal_max: int = field(default_factory=lambda: int(os.environ.get(
        "SWARM_CONCURRENCY_NORMAL",
        str(_cfg("governance", "concurrency", "normal_max", default=2)),
    )))
    governance_high_max: int = field(default_factory=lambda: int(os.environ.get(
        "SWARM_CONCURRENCY_HIGH",
        str(_cfg("governance", "concurrency", "high_max", default=1)),
    )))
    governance_critical_max: int = field(default_factory=lambda: int(os.environ.get(
        "SWARM_CONCURRENCY_CRITICAL",
        str(_cfg("governance", "concurrency", "critical_max", default=1)),
    )))
    handoff_max_context_chars: int = field(default_factory=lambda: int(os.environ.get(
        "SWARM_HANDOFF_MAX_CHARS",
        str(_cfg("governance", "handoff", "max_context_chars", default=2000)),
    )))
    handoff_compress_above_chars: int = field(default_factory=lambda: int(os.environ.get(
        "SWARM_HANDOFF_COMPRESS_ABOVE",
        str(_cfg("governance", "handoff", "compress_above_chars", default=800)),
    )))

    @property
    def runs_dir(self) -> Path:
        return self.home / "runs"

    @property
    def memory_dir(self) -> Path:
        return self.home / "memory"

    @property
    def evolution_dir(self) -> Path:
        return self.home / "evolution"

    @property
    def proposals_dir(self) -> Path:
        return self.evolution_dir / "proposals"

    @property
    def applied_dir(self) -> Path:
        return self.evolution_dir / "applied"

    @property
    def checkpoints_dir(self) -> Path:
        return self.home / "checkpoints"

    @property
    def traces_dir(self) -> Path:
        return self.home / "traces"

    @property
    def skills_dir(self) -> Path:
        return self.home / "skills"

    @property
    def reports_dir(self) -> Path:
        return self.home / "reports"

    def runtime_profile(self) -> dict[str, Any]:
        return {
            "home": str(self.home),
            "provider": self.provider,
            "ollama": {
                "url": self.ollama_url,
                "timeout_s": self.ollama_timeout_s,
            },
            "models": {"router": self.model_fast, "reason": self.model_reason, "code": self.model_code, "default": self.model or self.model_code or self.model_fast},
            "runtime": {
                "autonomous": self.autonomous,
                "review_required": self.review_required,
                "auto_apply": self.auto_apply,
                "max_iterations": self.max_iterations,
                "checkpoint_every": self.checkpoint_every,
                "trace_every_stage": self.trace_every_stage,
                "persist_run_artifacts": self.persist_run_artifacts,
                "evaluator_passes": self.evaluator_passes,
                "proposal_budget": self.proposal_budget,
                "risk_floor": self.risk_floor,
                "worker_interval": self.worker_interval,
                "worker_pool_size": self.worker_pool_size,
                "mission_budget": self.mission_budget,
                "control_mode": self.control_mode,
            },
            "tools": {
                "hard_timeout_s": self.tool_hard_timeout_s,
            },
            "memory": {
                "ttl_seconds": self.memory_ttl_seconds,
                "rag_top_k": self.rag_top_k,
                "retain_runs": self.retain_recent_runs,
                "retain_memories": self.retain_recent_memories,
            },
            "storage": {"backend": self.storage_backend},
            "routing": {"workflow_preference": self.workflow_preference, "framework_preference": self.framework_preference, "tool_allowlist": self.tool_allowlist},
            "observability": {"graph_limit": self.graph_limit, "search_limit": self.memory_search_limit, "live_stream_interval": self.live_stream_interval, "event_retention": self.event_retention, "mission_retention": self.mission_retention},
            "evolution": {"proposal_only_by_default": _cfg("evolution", "proposal_only_by_default", default=True), "auto_apply_low_risk": _cfg("evolution", "auto_apply_low_risk", default=True), "selection_strategy": _cfg("evolution", "selection_strategy", default="tournament"), "budget": {"proposals_per_run": self.proposal_budget, "refinement_passes": self.evaluator_passes}},
        }

    def ensure(self) -> None:
        for d in [self.home, self.runs_dir, self.memory_dir, self.evolution_dir, self.proposals_dir, self.applied_dir, self.checkpoints_dir, self.traces_dir, self.skills_dir, self.reports_dir, self.home / "state", self.home / "queue"]:
            d.mkdir(parents=True, exist_ok=True)
        self.validate()  # [V5.9-ENH-01] run startup config health check

    @classmethod
    def load_repo(cls, repo: str | Path) -> dict[str, Any]:
        repo = Path(repo)
        cfg_yaml = repo / ".swarmx" / "config.yaml"
        cfg_json = repo / ".swarmx" / "config.json"
        if cfg_yaml.exists():
            return yaml.safe_load(cfg_yaml.read_text(encoding="utf-8")) or {}
        if cfg_json.exists():
            return read_json(cfg_json, {})
        return {}

    def save_repo(self, repo: str | Path, data: dict[str, Any]) -> None:
        repo = Path(repo)
        cfg_dir = repo / ".swarmx"
        cfg_dir.mkdir(parents=True, exist_ok=True)
        (cfg_dir / "config.yaml").write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
        write_json(cfg_dir / "config.json", data)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def validate(self) -> list[str]:
        """[V5.9-ENH-01] Validate critical config fields at startup.

        Returns a list of warning strings for non-fatal issues.
        Raises ``ValueError`` on fatal misconfiguration.
        """
        try:
            import structlog as _sl
            _log = _sl.get_logger("swarmx.config.validate")
        except ImportError:
            import logging as _logging
            _log = _logging.getLogger("swarmx.config.validate")  # type: ignore[assignment]
        warnings: list[str] = []

        # 1. Model tags must be canonical (non-empty)
        _REQUIRED_MODELS = {
            "model_fast":   self.model_fast,
            "model_reason": self.model_reason,
            "model_code":   self.model_code,
        }
        for field_name, tag in _REQUIRED_MODELS.items():
            if not tag or not tag.strip():
                raise ValueError(
                    f"SwarmConfig.{field_name} is empty or unset. "
                    "Set the corresponding SWARM_MODEL_* env var or check configs/swarmx.defaults.yaml."
                )

        # 2. Warn on legacy model tags that survived normalization (shouldn't happen)
        _LEGACY_TAGS = {"phi4-mini", "deepseek-r1", "deepseek-r1:7b", "qwen2.5-coder"}
        for field_name, tag in _REQUIRED_MODELS.items():
            if tag.lower() in _LEGACY_TAGS:
                msg = (
                    f"SwarmConfig.{field_name} is still using legacy tag '{tag}'. "
                    "Expected canonical tag (phi4-fast | deepseek-reasoner | qwen-worker). "
                    "Check _normalise_model_tag() or configs/swarmx.defaults.yaml."
                )
                warnings.append(msg)
                _log.warning("legacy_model_tag_detected", field=field_name, tag=tag)

        # 3. Warn if ollama_url is the default but SWARMX_OLLAMA_URL was not set
        if self.ollama_url == "http://127.0.0.1:11434" and not os.environ.get("SWARMX_OLLAMA_URL"):
            warnings.append(
                "SWARMX_OLLAMA_URL not set — using default http://127.0.0.1:11434. "
                "Set it explicitly in production."
            )

        # 4. Max iterations sanity check
        if self.max_iterations < 1:
            raise ValueError(
                f"SwarmConfig.max_iterations={self.max_iterations!r} is invalid. Must be >= 1."
            )
        if self.max_iterations > 20:
            warnings.append(
                f"SwarmConfig.max_iterations={self.max_iterations} is very high (>20). "
                "This may cause OOM on 8 GB systems. Recommended ceiling: 20."
            )

        # 5. Ensure home directory is writable
        home = self.home
        if not home.exists():
            try:
                home.mkdir(parents=True, exist_ok=True)
            except OSError as exc:
                raise ValueError(
                    f"SwarmConfig.home={home!r} does not exist and cannot be created: {exc}"
                ) from exc
        if not os.access(home, os.W_OK):
            raise ValueError(
                f"SwarmConfig.home={home!r} is not writable. "
                "Check permissions or set SWARM_HOME to a writable path."
            )

        if warnings:
            _log.warning("swarmconfig_validation_warnings", count=len(warnings), warnings=warnings)
        else:
            _log.info("swarmconfig_validation_ok", model_fast=self.model_fast, model_reason=self.model_reason, model_code=self.model_code)
        return warnings
