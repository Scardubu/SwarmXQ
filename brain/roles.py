"""
brain/roles — SwarmX V5.8 Role-to-Model Registry
==================================================
Maps logical agent roles to their Ollama model tags.  This dict mirrors
the `models:` section of orchestration/swarmx_config.yaml and is the
single authoritative source for the brain/ module layer.

Callers should use `role_model(role)` rather than indexing ROLE_MODELS
directly, as it applies env-var overrides and falls back gracefully.

CHANGES FROM LEGACY VERSION:
  [FIX-01] Replaced the `detect_role(task)` function with a proper role→model
           mapping dict.  The legacy function duplicated classifier logic
           already present in brain.dispatcher.classify() and returned role
           *names* inconsistently (e.g. "optimizer" — not a real model role).
           Callers that need intent classification should use
           brain.dispatcher.classify() or brain.router.detect_intent().
  [ENH-01] ROLE_MODELS dict aligns exactly with MODEL_ROLES() in
           orchestration/orchestrator.py and swarmx_config.yaml.
  [ENH-02] `role_model()` applies SWARMX_MODEL_<ROLE> env-var overrides
           so operators can hot-swap individual roles without config edits.
  [ENH-03] `all_roles()` returns the resolved role→model mapping for
           health checks and status displays.
"""
from __future__ import annotations

import os

# ── Role → Ollama model tag ───────────────────────────────────────────────────
# Keep in sync with:
#   orchestration/swarmx_config.yaml  models: section
#   orchestration/orchestrator.py     MODEL_ROLES()
#
# [V5.9-ENH-01] Canonical roles (fast, reason, code, local) now defer to
# SwarmConfig so SWARMX_MODEL_FAST / MODEL_FAST env vars work uniformly
# across the orchestration AND brain layers.  V5.8 roles (supervisor, worker,
# executor, critic) remain wired to the orchestration-layer Ollama tags.

ROLE_MODELS: dict[str, str] = {
    "supervisor": "qwen-supervisor",    # plans, delegates, synthesises
    "worker":     "phi4-worker",        # fast tool execution, short JSON
    "executor":   "qwen-worker",        # complex tool chains, multi-lingual
    "fast":       "phi4-fast",          # classification, routing, validation
    "reasoner":   "deepseek-reasoner",  # deep analysis, code, planning
    "critic":     "deepseek-critic",    # post-run audit, evolution signals
    # brain/ convenience aliases
    "reason":     "deepseek-reasoner",
    "code":       "qwen-worker",
    "local":      "phi4-fast",
}

# Canonical role keys whose primary model should come from SwarmConfig/env
# rather than the V5.8 orchestration-layer defaults above.
_CANONICAL_ROLE_MAP: dict[str, str] = {
    "fast":     "SWARM_MODEL_FAST",   # also MODEL_FAST
    "local":    "SWARM_MODEL_FAST",
    "reason":   "SWARM_MODEL_REASON", # also MODEL_REASON
    "reasoner": "SWARM_MODEL_REASON",
    "code":     "SWARM_MODEL_CODE",   # also MODEL_CODE
}


def _swarmconfig_model(swarm_env_key: str, legacy_env_key: str, cfg_getter: str) -> str | None:
    """Try SwarmConfig-compatible env var, then legacy env var, then SwarmConfig.

    [V5.9-FIX-01] Import order corrected: try the installed 'swarmx.config' package
    path first (production), then 'src.swarmx.config' (editable/dev install).
    The previous order silently failed in production deployments where 'src' is
    not on sys.path, falling back to the same installed path at extra cost.
    """
    val = os.environ.get(swarm_env_key) or os.environ.get(legacy_env_key)
    if val:
        return val
    # Lazy SwarmConfig read — avoids import-time cost and circular-import risk
    for mod_path in ("swarmx.config", "src.swarmx.config"):
        try:
            import importlib
            m = importlib.import_module(mod_path)
            cfg = m.SwarmConfig()
            result = getattr(cfg, cfg_getter, None)
            if isinstance(result, str) and result:
                return result
        except Exception:
            continue
    return None


def role_model(role: str) -> str:
    """
    Resolve a role name to an Ollama model tag.

    Priority order:
      1. SWARMX_MODEL_<ROLE> environment variable
      2. SwarmConfig canonical value (for fast/reason/code/local/reasoner)
      3. ROLE_MODELS static map
      4. 'phi4-fast' universal safe default

    [V5.9-ENH-01] Canonical roles now delegate to SwarmConfig so that
    SWARM_MODEL_FAST etc. propagate consistently across both the orchestration
    and brain/ layers.
    """
    role_lower = role.lower()

    # Check SWARMX_MODEL_<ROLE> first (highest priority)
    env_key = f"SWARMX_MODEL_{role_lower.upper()}"
    override = os.environ.get(env_key)
    if override:
        return override

    # For canonical roles, delegate to SwarmConfig / env-var ladder
    if role_lower in _CANONICAL_ROLE_MAP:
        swarm_env = _CANONICAL_ROLE_MAP[role_lower]
        if role_lower in ("fast", "local"):
            resolved = _swarmconfig_model(swarm_env, "MODEL_FAST", "model_fast")
        elif role_lower in ("reason", "reasoner"):
            resolved = _swarmconfig_model(swarm_env, "MODEL_REASON", "model_reason")
        else:  # code
            resolved = _swarmconfig_model(swarm_env, "MODEL_CODE", "model_code")
        if resolved:
            return resolved

    return ROLE_MODELS.get(role_lower, "phi4-fast")


def all_roles() -> dict[str, str]:
    """Return the fully-resolved role→model mapping (env overrides applied)."""
    return {role: role_model(role) for role in ROLE_MODELS}


__all__ = ["ROLE_MODELS", "role_model", "all_roles"]
