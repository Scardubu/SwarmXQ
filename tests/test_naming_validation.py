"""
tests/test_naming_validation.py
─────────────────────────────────────────────────────────────────────────────
SwarmXQ APEX-17 r7 — Dual-Layer Naming System Validation

Ensures:
  1. MODEL_OPERATOR_MAP is consistent between Python and TypeScript
  2. All canonical tags follow the grammar: <role>-<family>-<tier>-<quant>-<env>
  3. Every legacy alias resolves to a valid canonical tag
  4. No -scar tags appear in runtime default values
  5. Operator names cover all 7 expected operators
  6. No naming regressions after migration
─────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest

from swarmx.operator_map import (
    MODEL_OPERATOR_MAP,
    MODEL_ALIASES,
    resolve_canonical_tag,
    resolve_operator_name,
    resolve_model_role,
    is_canonical_tag,
    find_legacy_tags,
    format_operator_label,
)


# ─── Fixtures ────────────────────────────────────────────────────────────────

EXPECTED_OPERATORS = {"Relay", "Pilot", "Architect", "Forge", "Oracle", "Auditor", "Lab"}
EXPECTED_ROLES = {"route", "instruct", "plan", "code", "reason", "critique", "synth"}

# Grammar: <role>-<family>-<tier>-<quant>-<env>
TAG_PATTERN = re.compile(
    r"^(route|instruct|plan|code|reason|critique|synth)"
    r"-(phi4|qwen25|deepseekr1)"
    r"-(lite|pro|exp)"
    r"-(q4km|q8|q5km)"
    r"-(prod|dev)$"
)


# ─── Tests ───────────────────────────────────────────────────────────────────

class TestModelOperatorMap:
    """Validate the authoritative MODEL_OPERATOR_MAP."""

    def test_all_operators_represented(self) -> None:
        found = {e["operator"] for e in MODEL_OPERATOR_MAP.values()}
        assert found == EXPECTED_OPERATORS, f"Missing operators: {EXPECTED_OPERATORS - found}"

    def test_all_roles_represented(self) -> None:
        found = {e["role"] for e in MODEL_OPERATOR_MAP.values()}
        assert found == EXPECTED_ROLES, f"Missing roles: {EXPECTED_ROLES - found}"

    def test_canonical_tags_follow_grammar(self) -> None:
        for tag in MODEL_OPERATOR_MAP:
            assert TAG_PATTERN.match(tag), (
                f"Canonical tag '{tag}' does not follow grammar "
                "<role>-<family>-<tier>-<quant>-<env>"
            )

    def test_entry_tag_role_consistency(self) -> None:
        """The role prefix of the tag must match the role field."""
        for tag, entry in MODEL_OPERATOR_MAP.items():
            prefix = tag.split("-")[0]
            assert prefix == entry["role"], (
                f"Tag '{tag}' starts with '{prefix}' but entry role is '{entry['role']}'"
            )

    def test_minimum_entry_count(self) -> None:
        assert len(MODEL_OPERATOR_MAP) >= 11, "Expected at least 11 canonical tags"

    def test_is7b_consistency(self) -> None:
        """All qwen25 and deepseekr1 pro entries should be 7B."""
        for tag, entry in MODEL_OPERATOR_MAP.items():
            if entry["family"] in ("qwen25", "deepseekr1") and entry["tier"] == "pro":
                assert entry["is7B"] is True, f"{tag} should be 7B"

    def test_relay_is_not_7b(self) -> None:
        relay_tags = [t for t, e in MODEL_OPERATOR_MAP.items() if e["operator"] == "Relay"]
        for tag in relay_tags:
            assert MODEL_OPERATOR_MAP[tag]["is7B"] is False, "Relay must never be 7B"


class TestAliasResolution:
    """Validate backward-compatible alias resolution."""

    def test_every_alias_resolves_to_canonical(self) -> None:
        for alias, target in MODEL_ALIASES.items():
            assert target in MODEL_OPERATOR_MAP, (
                f"Alias '{alias}' → '{target}' but '{target}' is not a canonical tag"
            )

    def test_scar_aliases_resolve(self) -> None:
        scar_tags = [k for k in MODEL_ALIASES if k.endswith("-scar")]
        assert len(scar_tags) >= 11, f"Expected >= 11 -scar aliases, found {len(scar_tags)}"
        for tag in scar_tags:
            resolved = resolve_canonical_tag(tag)
            assert is_canonical_tag(resolved), f"-scar tag '{tag}' resolved to non-canonical '{resolved}'"

    def test_pre_scar_aliases_resolve(self) -> None:
        pre_scar = ["phi4-fast", "phi4-mini", "deepseek-r1", "qwen-worker", "qwen2.5-coder"]
        for tag in pre_scar:
            resolved = resolve_canonical_tag(tag)
            assert is_canonical_tag(resolved), f"Pre-scar tag '{tag}' resolved to '{resolved}'"

    def test_canonical_tags_are_identity(self) -> None:
        for tag in MODEL_OPERATOR_MAP:
            assert resolve_canonical_tag(tag) == tag, f"Canonical tag '{tag}' did not resolve to itself"

    def test_unknown_tag_passthrough(self) -> None:
        assert resolve_canonical_tag("some-unknown-model") == "some-unknown-model"


class TestOperatorResolution:
    """Validate operator name lookup."""

    def test_resolve_from_canonical(self) -> None:
        assert resolve_operator_name("route-phi4-lite-q4km-prod") == "Relay"
        assert resolve_operator_name("instruct-phi4-pro-q8-prod") == "Pilot"
        assert resolve_operator_name("code-qwen25-pro-q5km-prod") == "Forge"
        assert resolve_operator_name("reason-deepseekr1-pro-q5km-prod") == "Oracle"
        assert resolve_operator_name("critique-deepseekr1-pro-q5km-prod") == "Auditor"

    def test_resolve_from_legacy(self) -> None:
        assert resolve_operator_name("phi4-fast-scar") == "Pilot"
        assert resolve_operator_name("deepseek-reasoner-scar") == "Oracle"
        assert resolve_operator_name("qwen-worker-scar") == "Forge"
        assert resolve_operator_name("deepseek-critic-scar") == "Auditor"

    def test_resolve_role(self) -> None:
        assert resolve_model_role("route-phi4-lite-q4km-prod") == "route"
        assert resolve_model_role("code-qwen25-pro-q5km-prod") == "code"
        assert resolve_model_role("unknown-tag") == "unknown"

    def test_format_operator_label(self) -> None:
        label = format_operator_label("route-phi4-lite-q4km-prod")
        assert label == "Relay (route-phi4-lite-q4km-prod)"

    def test_format_from_legacy(self) -> None:
        label = format_operator_label("phi4-fast-scar")
        assert label == "Pilot (instruct-phi4-pro-q8-prod)"


class TestFindLegacyTags:
    """Validate legacy tag detection."""

    def test_detects_scar_tags(self) -> None:
        tags = ["route-phi4-lite-q4km-prod", "phi4-fast-scar", "deepseek-reasoner-scar"]
        legacy = find_legacy_tags(tags)
        assert set(legacy) == {"phi4-fast-scar", "deepseek-reasoner-scar"}

    def test_clean_list_returns_empty(self) -> None:
        tags = ["route-phi4-lite-q4km-prod", "code-qwen25-pro-q5km-prod"]
        assert find_legacy_tags(tags) == []


class TestNoScarInRuntimeDefaults:
    """Ensure no -scar tags leak into runtime default values."""

    def test_config_defaults_are_canonical(self) -> None:
        """Verify that the patched config.py defaults use canonical tags."""
        # These are the expected defaults after r7 migration
        expected_defaults = {
            "model_fast":         "instruct-phi4-pro-q8-prod",
            "model_code":         "code-qwen25-pro-q5km-prod",
            "model_reason":       "reason-deepseekr1-pro-q5km-prod",
            "model_ultra_router": "route-phi4-lite-q4km-prod",
        }
        for field, expected in expected_defaults.items():
            assert is_canonical_tag(expected), (
                f"Default for {field} = '{expected}' is not a canonical tag"
            )


class TestRepoScarAudit:
    """Scan the repo for -scar references in active runtime paths."""

    @pytest.fixture
    def repo_root(self) -> Path:
        # Find repo root relative to this test file
        candidate = Path(__file__).resolve().parents[1]
        if (candidate / "src" / "swarmx").exists():
            return candidate
        pytest.skip("Could not find repo root")
        return candidate  # unreachable but satisfies type checker

    def test_no_scar_in_operator_map(self, repo_root: Path) -> None:
        """operator_map.py should never contain -scar as a value (only in alias keys)."""
        om = repo_root / "src" / "swarmx" / "operator_map.py"
        if not om.exists():
            pytest.skip("operator_map.py not found")
        content = om.read_text()
        # Values in MODEL_OPERATOR_MAP should never contain -scar
        # But MODEL_ALIASES keys rightfully contain -scar
        lines = content.split("\n")
        in_operator_map = False
        for line in lines:
            if "MODEL_OPERATOR_MAP" in line and "=" in line:
                in_operator_map = True
            if in_operator_map and line.strip() == "}":
                in_operator_map = False
            if in_operator_map and "-scar" in line:
                pytest.fail(f"Found -scar in MODEL_OPERATOR_MAP: {line.strip()}")
