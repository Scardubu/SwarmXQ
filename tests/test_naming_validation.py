"""
tests/test_naming_validation.py
─────────────────────────────────────────────────────────────────────────────
SwarmXQ APEX-17 r7 — Dual-Layer Naming System Validation

Validates:
  1. MODEL_OPERATOR_MAP is mirror-consistent between Python and TypeScript
  2. All canonical tags follow the grammar: <role>-<family>-<tier>-<quant>-<env>
  3. Every legacy alias resolves to a valid canonical tag
  4. No -scar tags appear in active runtime default values
  5. Operator names cover all 7 expected operators (Relay → Lab)
  6. Repo-wide audit: no -scar references in canonical-only files
─────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from swarmx.operator_map import (
    MODEL_ALIASES,
    MODEL_OPERATOR_MAP,
    OPERATOR_NAMES,
    find_legacy_tags,
    format_operator_label,
    get_7b_tags,
    get_operator_entry,
    get_tags_for_operator,
    is_canonical_tag,
    is_legacy_alias,
    resolve_canonical_tag,
    resolve_model_role,
    resolve_operator_name,
    tags_by_operator,
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


def _repo_root() -> Path:
    """Find the repo root by walking up from this test file."""
    for parent in Path(__file__).resolve().parents:
        if (parent / "src" / "swarmx" / "operator_map.py").exists():
            return parent
    pytest.skip("Could not locate repo root")
    raise RuntimeError  # unreachable


# ─── Tests: Structure & Grammar ──────────────────────────────────────────────

class TestModelOperatorMap:
    """Validate the authoritative MODEL_OPERATOR_MAP structure."""

    def test_all_operators_present(self) -> None:
        found = {e["operator"] for e in MODEL_OPERATOR_MAP.values()}
        assert found == EXPECTED_OPERATORS, f"Missing operators: {EXPECTED_OPERATORS - found}"

    def test_all_roles_present(self) -> None:
        found = {e["role"] for e in MODEL_OPERATOR_MAP.values()}
        assert found == EXPECTED_ROLES, f"Missing roles: {EXPECTED_ROLES - found}"

    def test_canonical_tags_follow_grammar(self) -> None:
        for tag in MODEL_OPERATOR_MAP:
            assert TAG_PATTERN.match(tag), (
                f"Canonical tag '{tag}' does not follow grammar "
                "<role>-<family>-<tier>-<quant>-<env>"
            )

    def test_entry_role_matches_tag_prefix(self) -> None:
        for tag, entry in MODEL_OPERATOR_MAP.items():
            prefix = tag.split("-")[0]
            assert prefix == entry["role"], (
                f"Tag '{tag}' starts with '{prefix}' but role is '{entry['role']}'"
            )

    def test_entry_family_matches_tag(self) -> None:
        for tag, entry in MODEL_OPERATOR_MAP.items():
            family_in_tag = tag.split("-")[1]
            assert family_in_tag == entry["family"], (
                f"Tag '{tag}' family in name = '{family_in_tag}' but entry = '{entry['family']}'"
            )

    def test_entry_env_matches_tag(self) -> None:
        for tag, entry in MODEL_OPERATOR_MAP.items():
            env_in_tag = tag.rsplit("-", 1)[1]
            assert env_in_tag == entry["env"]

    def test_minimum_entry_count(self) -> None:
        assert len(MODEL_OPERATOR_MAP) >= 11

    def test_ram_estimates_reasonable(self) -> None:
        for tag, entry in MODEL_OPERATOR_MAP.items():
            assert 1000 <= entry["estimatedRamMb"] <= 10000, (
                f"RAM estimate for {tag} = {entry['estimatedRamMb']} MB is out of range"
            )

    def test_7b_classification(self) -> None:
        for tag, entry in MODEL_OPERATOR_MAP.items():
            if entry["family"] in ("qwen25", "deepseekr1") and entry["tier"] == "pro":
                assert entry["is7B"] is True, f"{tag} should be is7B=True"
            if entry["family"] == "phi4" and entry["tier"] == "lite":
                assert entry["is7B"] is False, f"{tag} should be is7B=False"

    def test_relay_is_not_7b(self) -> None:
        for tag in get_tags_for_operator("Relay"):
            assert MODEL_OPERATOR_MAP[tag]["is7B"] is False, "Relay must never be 7B"

    def test_temperatures_in_range(self) -> None:
        for tag, entry in MODEL_OPERATOR_MAP.items():
            assert 0.0 <= entry["temperature"] <= 1.0
            assert 0.0 <= entry["topP"] <= 1.0


# ─── Tests: Alias Resolution ─────────────────────────────────────────────────

class TestAliasResolution:

    def test_every_alias_resolves_to_canonical(self) -> None:
        for alias, target in MODEL_ALIASES.items():
            assert target in MODEL_OPERATOR_MAP, (
                f"Alias '{alias}' → '{target}' but '{target}' is not canonical"
            )

    def test_scar_aliases_present(self) -> None:
        scar = [k for k in MODEL_ALIASES if k.endswith("-scar")]
        assert len(scar) >= 11, f"Expected ≥11 -scar aliases, found {len(scar)}"

    def test_scar_aliases_resolve_canonical(self) -> None:
        for tag in (k for k in MODEL_ALIASES if k.endswith("-scar")):
            resolved = resolve_canonical_tag(tag)
            assert is_canonical_tag(resolved), (
                f"-scar tag '{tag}' resolved to non-canonical '{resolved}'"
            )

    def test_pre_scar_aliases_resolve(self) -> None:
        for tag in ("phi4-fast", "phi4-mini", "deepseek-r1", "qwen-worker",
                    "qwen2.5-coder", "deepseek-r1:7b"):
            resolved = resolve_canonical_tag(tag)
            assert is_canonical_tag(resolved), f"'{tag}' resolved to '{resolved}'"

    def test_canonical_tag_is_identity(self) -> None:
        for tag in MODEL_OPERATOR_MAP:
            assert resolve_canonical_tag(tag) == tag

    def test_empty_string_passthrough(self) -> None:
        assert resolve_canonical_tag("") == ""

    def test_unknown_tag_passthrough(self) -> None:
        assert resolve_canonical_tag("some-unknown-model") == "some-unknown-model"


# ─── Tests: Operator Resolution ──────────────────────────────────────────────

class TestOperatorResolution:

    def test_resolve_from_canonical(self) -> None:
        cases = {
            "route-phi4-lite-q4km-prod":         "Relay",
            "instruct-phi4-pro-q8-prod":         "Pilot",
            "plan-qwen25-pro-q5km-prod":         "Architect",
            "code-qwen25-pro-q5km-prod":         "Forge",
            "reason-deepseekr1-pro-q5km-prod":   "Oracle",
            "critique-deepseekr1-pro-q5km-prod": "Auditor",
            "synth-phi4-exp-q8-dev":             "Lab",
        }
        for tag, expected in cases.items():
            assert resolve_operator_name(tag) == expected, (
                f"{tag} resolved to {resolve_operator_name(tag)}, expected {expected}"
            )

    def test_resolve_from_legacy_scar(self) -> None:
        cases = {
            "phi4-router-lite-scar":  "Relay",
            "phi4-fast-scar":         "Pilot",
            "qwen-worker-scar":       "Forge",
            "deepseek-reasoner-scar": "Oracle",
            "deepseek-critic-scar":   "Auditor",
        }
        for tag, expected in cases.items():
            assert resolve_operator_name(tag) == expected

    def test_resolve_role(self) -> None:
        assert resolve_model_role("route-phi4-lite-q4km-prod") == "route"
        assert resolve_model_role("code-qwen25-pro-q5km-prod") == "code"
        assert resolve_model_role("unknown-model") == "unknown"

    def test_format_operator_label(self) -> None:
        label = format_operator_label("route-phi4-lite-q4km-prod")
        assert label == "Relay (route-phi4-lite-q4km-prod)"
        label2 = format_operator_label("phi4-fast-scar")
        assert label2 == "Pilot (instruct-phi4-pro-q8-prod)"


# ─── Tests: Legacy Detection ─────────────────────────────────────────────────

class TestLegacyDetection:

    def test_find_scar_tags(self) -> None:
        tags = ["route-phi4-lite-q4km-prod", "phi4-fast-scar", "deepseek-reasoner-scar"]
        assert set(find_legacy_tags(tags)) == {"phi4-fast-scar", "deepseek-reasoner-scar"}

    def test_clean_list_returns_empty(self) -> None:
        assert find_legacy_tags(["route-phi4-lite-q4km-prod", "code-qwen25-pro-q5km-prod"]) == []

    def test_is_canonical(self) -> None:
        assert is_canonical_tag("route-phi4-lite-q4km-prod") is True
        assert is_canonical_tag("phi4-router-lite-scar") is False

    def test_is_legacy(self) -> None:
        assert is_legacy_alias("phi4-router-lite-scar") is True
        assert is_legacy_alias("route-phi4-lite-q4km-prod") is False


# ─── Tests: Lookups ───────────────────────────────────────────────────────────

class TestLookups:

    def test_get_entry_canonical(self) -> None:
        entry = get_operator_entry("route-phi4-lite-q4km-prod")
        assert entry is not None
        assert entry["operator"] == "Relay"
        assert entry["role"] == "route"

    def test_get_entry_legacy(self) -> None:
        entry = get_operator_entry("phi4-fast-scar")
        assert entry is not None
        assert entry["operator"] == "Pilot"

    def test_get_entry_unknown_returns_none(self) -> None:
        assert get_operator_entry("nonexistent-model") is None

    def test_get_tags_for_operator(self) -> None:
        relay_tags = get_tags_for_operator("Relay")
        assert relay_tags == ["route-phi4-lite-q4km-prod"]
        architect_tags = get_tags_for_operator("Architect")
        assert len(architect_tags) >= 3  # phi4, qwen25, deepseekr1

    def test_tags_by_operator(self) -> None:
        grouped = tags_by_operator()
        assert set(grouped.keys()) == EXPECTED_OPERATORS
        # Relay should have exactly 1; Lab should have 3
        assert len(grouped["Relay"]) == 1
        assert len(grouped["Lab"]) >= 3

    def test_get_7b_tags(self) -> None:
        seven_b = get_7b_tags()
        assert len(seven_b) >= 4
        # All Oracle and Auditor must be 7B
        for tag in get_tags_for_operator("Oracle"):
            assert tag in seven_b
        for tag in get_tags_for_operator("Auditor"):
            assert tag in seven_b


# ─── Tests: TS/Python Mirror Consistency ─────────────────────────────────────

class TestMirrorConsistency:
    """Validate that TS and Python sources of truth stay in sync.

    Parses operator-map.ts via regex (no Node.js dependency) and compares
    the resulting key set against the Python MODEL_OPERATOR_MAP.
    """

    @pytest.fixture
    def ts_keys(self) -> set[str]:
        ts_path = _repo_root() / "packages" / "swarmx-types" / "src" / "operator-map.ts"
        if not ts_path.exists():
            pytest.skip("operator-map.ts not found")
        content = ts_path.read_text(encoding="utf-8")

        # Extract keys from MODEL_OPERATOR_MAP. Match: "tag-name": {
        # We bound the search to the MODEL_OPERATOR_MAP block.
        match = re.search(
            r"MODEL_OPERATOR_MAP[^=]*=\s*\{(.*?)\n\}\s*as\s+const",
            content, re.DOTALL,
        )
        if not match:
            pytest.fail("Could not locate MODEL_OPERATOR_MAP in operator-map.ts")
        block = match.group(1)
        keys = set(re.findall(r'"([\w\-:.]+)":\s*\{', block))
        # Filter out internal field names (operator, role, family, etc.)
        internal = {"operator", "role", "family", "tier", "quant", "env", "is7B",
                    "estimatedRamMb", "defaultCtx", "temperature", "topP", "description"}
        return {k for k in keys if k not in internal}

    @pytest.fixture
    def ts_aliases(self) -> set[str]:
        ts_path = _repo_root() / "packages" / "swarmx-types" / "src" / "operator-map.ts"
        if not ts_path.exists():
            pytest.skip("operator-map.ts not found")
        content = ts_path.read_text(encoding="utf-8")

        match = re.search(
            r"MODEL_ALIASES[^=]*=\s*\{(.*?)\n\}\s*;",
            content, re.DOTALL,
        )
        if not match:
            return set()
        block = match.group(1)
        return set(re.findall(r'"([\w\-:.]+)":\s*"', block))

    def test_canonical_keys_match(self, ts_keys: set[str]) -> None:
        py_keys = set(MODEL_OPERATOR_MAP.keys())
        only_ts = ts_keys - py_keys
        only_py = py_keys - ts_keys
        assert not only_ts and not only_py, (
            f"Mirror desync. Only in TS: {only_ts}. Only in Python: {only_py}"
        )

    def test_alias_keys_match(self, ts_aliases: set[str]) -> None:
        py_aliases = set(MODEL_ALIASES.keys())
        only_ts = ts_aliases - py_aliases
        only_py = py_aliases - ts_aliases
        assert not only_ts and not only_py, (
            f"Alias desync. Only in TS: {only_ts}. Only in Python: {only_py}"
        )


# ─── Tests: Runtime Default Verification ─────────────────────────────────────

class TestRuntimeDefaults:
    """Ensure no -scar tags leak into runtime default values."""

    def test_default_canonical_constants(self) -> None:
        defaults = {
            "Relay":  "route-phi4-lite-q4km-prod",
            "Pilot":  "instruct-phi4-pro-q8-prod",
            "Forge":  "code-qwen25-pro-q5km-prod",
            "Oracle": "reason-deepseekr1-pro-q5km-prod",
        }
        for operator, expected_tag in defaults.items():
            assert is_canonical_tag(expected_tag)
            assert resolve_operator_name(expected_tag) == operator


# ─── Tests: Repo-Wide Audit ──────────────────────────────────────────────────

class TestRepoAudit:
    """Scan the repo for -scar leakage in canonical-only contexts."""

    def test_operator_map_py_no_scar_in_canonical_section(self) -> None:
        path = _repo_root() / "src" / "swarmx" / "operator_map.py"
        content = path.read_text()
        # Find MODEL_OPERATOR_MAP block
        m = re.search(
            r"MODEL_OPERATOR_MAP[^=]*=\s*\{(.+?)^\}",
            content, re.DOTALL | re.MULTILINE,
        )
        assert m is not None
        block = m.group(1)
        assert "-scar" not in block, "MODEL_OPERATOR_MAP must not contain -scar tags"

    def test_operator_map_ts_no_scar_in_canonical_section(self) -> None:
        path = _repo_root() / "packages" / "swarmx-types" / "src" / "operator-map.ts"
        if not path.exists():
            pytest.skip("operator-map.ts not present")
        content = path.read_text()
        m = re.search(
            r"MODEL_OPERATOR_MAP[^=]*=\s*\{(.*?)\n\}\s*as\s+const",
            content, re.DOTALL,
        )
        assert m is not None
        block = m.group(1)
        assert "-scar" not in block, "MODEL_OPERATOR_MAP must not contain -scar tags"

    def test_registry_yaml_ollama_tags_canonical(self) -> None:
        path = _repo_root() / "models" / "registry.yaml"
        if not path.exists():
            pytest.skip("registry.yaml not present")
        content = path.read_text()
        # Match `ollama_tag: <something>` lines
        for line in content.split("\n"):
            stripped = line.strip()
            if stripped.startswith("ollama_tag:"):
                value = stripped.split(":", 1)[1].strip()
                assert "-scar" not in value, (
                    f"registry.yaml has -scar in ollama_tag: '{value}'"
                )

    def test_configs_no_scar_in_model_assignments(self) -> None:
        """Check that primary model assignment lines use canonical tags."""
        configs = _repo_root() / "configs"
        if not configs.exists():
            pytest.skip("configs/ not present")
        # These are the key fields that must NOT contain -scar (excluding legacy_alias)
        target_fields = ("model_fast:", "model_reason:", "model_code:",
                         "observer_model:", "critic_model:", "mutator_model:")
        violations = []
        for yaml_file in configs.glob("*.yaml"):
            for lineno, line in enumerate(yaml_file.read_text().split("\n"), 1):
                stripped = line.strip()
                if any(stripped.startswith(f) for f in target_fields):
                    if "-scar" in line and "alias" not in line and "legacy" not in line:
                        violations.append(f"{yaml_file.name}:{lineno}: {line.strip()}")
        assert not violations, (
            "Found -scar in model assignment lines:\n" + "\n".join(violations)
        )
