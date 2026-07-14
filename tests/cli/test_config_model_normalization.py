from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from swarmx.config import SwarmConfig, _bundle_defaults, normalize_model_tag


def _fresh_config() -> SwarmConfig:
    _bundle_defaults.cache_clear()
    return SwarmConfig()


def test_normalize_model_tag_maps_legacy_triad_names() -> None:
    # APEX-17 r7: legacy short tags resolve to canonical production tags.
    assert normalize_model_tag("phi4-mini") == "instruct-phi4-pro-q8-prod"
    assert normalize_model_tag("deepseek-r1:7b") == "reason-deepseekr1-pro-q5km-prod"
    assert normalize_model_tag("qwen2.5-coder") == "code-qwen25-pro-q5km-prod"


def test_swarmconfig_defaults_resolve_canonical_tags() -> None:
    # APEX-17 r7: default models use canonical production tags.
    cfg = _fresh_config()
    assert cfg.model_fast == "instruct-phi4-pro-q8-prod"
    assert cfg.model_reason == "reason-deepseekr1-pro-q5km-prod"
    assert cfg.model_code == "code-qwen25-pro-q5km-prod"


def test_swarmconfig_env_legacy_aliases_are_normalized() -> None:
    with patch.dict(
        os.environ,
        {
            "SWARM_MODEL_FAST": "phi4-mini",
            "SWARM_MODEL_REASON": "deepseek-r1:7b",
            "SWARM_MODEL_CODE": "qwen2.5-coder",
        },
        clear=False,
    ):
        cfg = _fresh_config()

    # APEX-17 r7: env legacy aliases must also resolve to canonical production tags.
    assert cfg.model_fast == "instruct-phi4-pro-q8-prod"
    assert cfg.model_reason == "reason-deepseekr1-pro-q5km-prod"
    assert cfg.model_code == "code-qwen25-pro-q5km-prod"
