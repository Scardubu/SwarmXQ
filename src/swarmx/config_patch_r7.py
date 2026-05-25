"""
src/swarmx/config_patch_r7.py
─────────────────────────────────────────────────────────────────────────────
APEX-17 r7 — Config Migration Patch
Apply via: replace the _model_alias_map() body and default model fields
in src/swarmx/config.py

This file documents the exact changes needed in config.py.
─────────────────────────────────────────────────────────────────────────────

CHANGE 1: Add import at top of config.py (after existing imports)
───────────────────────────────────────────────────────────────────

OLD:
    from .utils import read_json, write_json

NEW:
    from .utils import read_json, write_json
    from .operator_map import MODEL_ALIASES as _CANONICAL_ALIASES, resolve_canonical_tag


CHANGE 2: Replace _model_alias_map() body
───────────────────────────────────────────────────────────────────

The entire function body should be replaced. The old function hard-coded
-scar tags as BOTH keys AND values (identity mappings). The new version
routes everything through canonical production tags.

OLD (lines ~86-113):
    alias_map: dict[str, str] = {
        # ── APEX-17 canonical -scar tags (primary targets) ...
        "phi4-router-lite-scar":    "phi4-router-lite-scar",
        ...
    }

NEW:
"""


def _model_alias_map() -> dict[str, str]:
    """Return normalized model-tag aliases mapped to canonical Ollama tags.

    [CFG-APEX17-r7-01] All aliases now resolve to canonical production tags
    from the dual-layer naming system (e.g., route-phi4-lite-q4km-prod).
    Legacy -scar tags are supported through MODEL_ALIASES in operator_map.py.
    """
    # Start from the authoritative alias map
    alias_map: dict[str, str] = dict(_CANONICAL_ALIASES)

    # Canonical tags map to themselves (identity)
    from .operator_map import MODEL_OPERATOR_MAP
    for canonical_tag in MODEL_OPERATOR_MAP:
        alias_map[canonical_tag] = canonical_tag

    # Also pull aliases from registry.yaml triad entries (dynamic)
    triad = _cfg("triad", default={})
    if isinstance(triad, dict):
        for spec in triad.values():
            if not isinstance(spec, dict):
                continue
            # Get the ollama_tag from registry — resolve it through canonical map
            raw_tag = str(spec.get("ollama_tag") or spec.get("name") or "").strip()
            if not raw_tag:
                continue
            canonical = resolve_canonical_tag(raw_tag)
            alias_map[raw_tag.lower()] = canonical
            alias_map[canonical] = canonical

            raw_name = str(spec.get("name") or "").strip()
            if raw_name:
                alias_map[raw_name.lower()] = canonical

            # Registry legacy_aliases field (new in r7)
            for alias_field in ("legacy_aliases", "aliases"):
                aliases = spec.get(alias_field, [])
                if isinstance(aliases, list):
                    for alias in aliases:
                        if alias:
                            alias_map[str(alias).strip().lower()] = canonical

    return alias_map


"""
CHANGE 3: Update default model field values (lines ~173-181)
───────────────────────────────────────────────────────────────────

OLD:
    model_fast: str = field(default_factory=lambda: _resolved_model_setting(
        "SWARM_MODEL_FAST", "MODEL_FAST", "router", "model_fast", "phi4-fast-scar"))
    model_code: str = field(default_factory=lambda: _resolved_model_setting(
        "SWARM_MODEL_CODE", "MODEL_CODE", "code", "model_code", "qwen-worker-scar"))
    model_reason: str = field(default_factory=lambda: _resolved_model_setting(
        "SWARM_MODEL_REASON", "MODEL_REASON", "reason", "model_reason", "deepseek-reasoner-scar"))
    ...
    model_ultra_router: str = field(default_factory=lambda: os.environ.get(
        "SWARM_MODEL_ULTRA_ROUTER",
        normalize_model_tag(_cfg("ultra_router", "ollama_tag", default="phi4-router-lite-scar")),
    ))

NEW:
    model_fast: str = field(default_factory=lambda: _resolved_model_setting(
        "SWARM_MODEL_FAST", "MODEL_FAST", "router", "model_fast", "instruct-phi4-pro-q8-prod"))
    model_code: str = field(default_factory=lambda: _resolved_model_setting(
        "SWARM_MODEL_CODE", "MODEL_CODE", "code", "model_code", "code-qwen25-pro-q5km-prod"))
    model_reason: str = field(default_factory=lambda: _resolved_model_setting(
        "SWARM_MODEL_REASON", "MODEL_REASON", "reason", "model_reason", "reason-deepseekr1-pro-q5km-prod"))
    model_ultra_router: str = field(default_factory=lambda: os.environ.get(
        "SWARM_MODEL_ULTRA_ROUTER",
        normalize_model_tag(_cfg("ultra_router", "ollama_tag", default="route-phi4-lite-q4km-prod")),
    ))


CHANGE 4: Update _LEGACY_TAGS validation set (line ~421)
───────────────────────────────────────────────────────────────────

OLD:
    _LEGACY_TAGS = {"phi4-mini", "deepseek-r1", "deepseek-r1:7b", "qwen2.5-coder",
                  "phi4-fast", "deepseek-reasoner", "qwen-worker"}

NEW (expanded to include -scar tags as legacy too):
    _LEGACY_TAGS = {
        # Pre-scar era
        "phi4-mini", "deepseek-r1", "deepseek-r1:7b", "qwen2.5-coder",
        "phi4-fast", "deepseek-reasoner", "qwen-worker",
        # -scar era (now also legacy)
        "phi4-fast-scar", "phi4-router-lite-scar", "phi4-worker-scar",
        "phi4-evolve-scar", "qwen-worker-scar", "qwen-supervisor-scar",
        "qwen-evolve-scar", "deepseek-reasoner-scar", "deepseek-critic-scar",
        "deepseek-supervisor-scar", "deepseek-evolve-scar",
    }
"""
