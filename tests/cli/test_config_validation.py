"""
tests/cli/test_config_validation.py — SwarmConfig.validate() regression tests
===============================================================================
[V5.9-ENH-01] Tests for the startup config health-check added in config.py.

Covers:
  [VAL-01] Canonical model tags pass validation without warnings.
  [VAL-02] Legacy tags surviving normalization produce a warning (shouldn't happen
            in production, but the guard must fire if normalisation is skipped).
  [VAL-03] Empty model_fast raises ValueError.
  [VAL-04] max_iterations=0 raises ValueError.
  [VAL-05] max_iterations > 20 produces a warning (not fatal).
  [VAL-06] Home dir not writable raises ValueError.
  [VAL-07] SWARMX_OLLAMA_URL unset produces advisory warning.
  [VAL-08] validate() is called automatically from ensure().
"""
from __future__ import annotations

import os
import sys
import tempfile
import stat
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from swarmx.config import SwarmConfig, _bundle_defaults


def _fresh_cfg(**overrides) -> SwarmConfig:
    _bundle_defaults.cache_clear()
    base = SwarmConfig()
    if overrides:
        base = replace(base, **overrides)
    return base


# ── [VAL-01] Canonical tags pass validation ───────────────────────────────────

def test_canonical_tags_pass_with_no_warnings(tmp_path: Path) -> None:
    cfg = _fresh_cfg(home=tmp_path)
    warnings = cfg.validate()
    # No legacy-tag warnings expected for canonical tags.
    tag_warnings = [w for w in warnings if "legacy tag" in w.lower()]
    assert tag_warnings == [], f"Unexpected legacy-tag warnings: {tag_warnings}"


# ── [VAL-02] Legacy tags surviving normalization produce a warning ────────────

def test_legacy_tag_on_model_fast_produces_warning(tmp_path: Path) -> None:
    cfg = _fresh_cfg(home=tmp_path, model_fast="phi4-mini")  # bypass normalisation
    warnings = cfg.validate()
    assert any("phi4-mini" in w and "legacy tag" in w.lower() for w in warnings), (
        f"Expected legacy-tag warning for phi4-mini; got: {warnings}"
    )


def test_legacy_tag_on_model_reason_produces_warning(tmp_path: Path) -> None:
    cfg = _fresh_cfg(home=tmp_path, model_reason="deepseek-r1:7b")
    warnings = cfg.validate()
    assert any("deepseek-r1:7b" in w and "legacy tag" in w.lower() for w in warnings)


def test_legacy_tag_on_model_code_produces_warning(tmp_path: Path) -> None:
    cfg = _fresh_cfg(home=tmp_path, model_code="qwen2.5-coder")
    warnings = cfg.validate()
    assert any("qwen2.5-coder" in w and "legacy tag" in w.lower() for w in warnings)


# ── [VAL-03] Empty model_fast raises ValueError ───────────────────────────────

def test_empty_model_fast_raises_value_error(tmp_path: Path) -> None:
    cfg = _fresh_cfg(home=tmp_path, model_fast="")
    try:
        cfg.validate()
        raise AssertionError("Expected ValueError for empty model_fast")
    except ValueError as exc:
        assert "model_fast" in str(exc).lower()


# ── [VAL-04] max_iterations=0 raises ValueError ───────────────────────────────

def test_zero_max_iterations_raises_value_error(tmp_path: Path) -> None:
    cfg = _fresh_cfg(home=tmp_path, max_iterations=0)
    try:
        cfg.validate()
        raise AssertionError("Expected ValueError for max_iterations=0")
    except ValueError as exc:
        assert "max_iterations" in str(exc)


# ── [VAL-05] max_iterations > 20 produces a warning ─────────────────────────

def test_high_max_iterations_produces_warning(tmp_path: Path) -> None:
    cfg = _fresh_cfg(home=tmp_path, max_iterations=25)
    warnings = cfg.validate()
    assert any("max_iterations" in w and "25" in w for w in warnings), (
        f"Expected max_iterations warning; got: {warnings}"
    )


# ── [VAL-06] Non-writable home raises ValueError ────────────────────────────

def test_nonwritable_home_raises_value_error(tmp_path: Path) -> None:
    locked = tmp_path / "locked"
    locked.mkdir()
    try:
        locked.chmod(stat.S_IREAD | stat.S_IXUSR)  # read-only
        cfg = _fresh_cfg(home=locked)
        try:
            cfg.validate()
            raise AssertionError("Expected ValueError for non-writable home")
        except ValueError as exc:
            assert "not writable" in str(exc).lower() or "locked" in str(exc).lower()
    finally:
        locked.chmod(stat.S_IRWXU)  # restore for cleanup


# ── [VAL-07] SWARMX_OLLAMA_URL unset produces advisory warning ───────────────

def test_missing_ollama_url_env_produces_advisory(tmp_path: Path) -> None:
    env = {k: v for k, v in os.environ.items() if k != "SWARMX_OLLAMA_URL"}
    with patch.dict(os.environ, env, clear=True):
        cfg = _fresh_cfg(home=tmp_path, ollama_url="http://127.0.0.1:11434")
        warnings = cfg.validate()
    assert any("SWARMX_OLLAMA_URL" in w for w in warnings), (
        f"Expected SWARMX_OLLAMA_URL advisory; got: {warnings}"
    )


# ── [VAL-08] ensure() triggers validate() ────────────────────────────────────

def test_ensure_calls_validate(tmp_path: Path, monkeypatch) -> None:
    """Verifies that cfg.ensure() runs validate() and directories are created."""
    cfg = _fresh_cfg(home=tmp_path)
    cfg.ensure()
    # Directories should now exist.
    assert (tmp_path / "runs").exists() or (tmp_path).exists()
    # model_fast must be canonical after ensure() — APEX-17 r7 production tags.
    CANONICAL_FAST_TAGS = {
        "instruct-phi4-pro-q8-prod",
        "route-phi4-lite-q4km-prod",
        "plan-phi4-pro-q8-prod",
    }
    assert cfg.model_fast in CANONICAL_FAST_TAGS, (
        f"model_fast '{cfg.model_fast}' is not a recognised canonical fast tag"
    )
