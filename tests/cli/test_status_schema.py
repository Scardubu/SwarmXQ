"""Tests for swarmx.core.status_schema — canonical status vocabulary."""
from __future__ import annotations

import pytest

from swarmx.core.status_schema import (
    AgentStatus,
    RiskLevel,
    normalize_status,
    worst_health,
)


class TestAgentStatusEnum:
    def test_all_values_are_strings(self):
        for member in AgentStatus:
            assert isinstance(member.value, str)

    def test_canonical_values_present(self):
        expected = {
            "idle", "queued", "running", "throttled",
            "activating", "active", "deactivating",
            "success", "error", "fatal", "failed_permanent",
            "oom_killed", "oom", "killed", "reload", "reloading",
            "awaiting_review",
        }
        assert {m.value for m in AgentStatus} == expected

    def test_direct_instantiation(self):
        assert AgentStatus("running") is AgentStatus.RUNNING
        assert AgentStatus("oom_killed") is AgentStatus.OOM_KILLED


class TestNormalizeStatus:
    def test_direct_values_pass_through(self):
        for member in AgentStatus:
            assert normalize_status(member.value) is member

    def test_uppercase_is_normalized(self):
        assert normalize_status("RUNNING") is AgentStatus.RUNNING
        assert normalize_status("ERROR") is AgentStatus.ERROR

    def test_aliases_resolve(self):
        assert normalize_status("done") is AgentStatus.SUCCESS
        assert normalize_status("ok") is AgentStatus.SUCCESS
        assert normalize_status("pending") is AgentStatus.QUEUED
        assert normalize_status("review") is AgentStatus.AWAITING_REVIEW
        assert normalize_status("waiting") is AgentStatus.QUEUED
        assert normalize_status("failed") is AgentStatus.ERROR
        assert normalize_status("crash") is AgentStatus.FATAL
        # "oom" is a direct enum value — no alias needed
        assert normalize_status("oom") is AgentStatus.OOM

    def test_unknown_falls_back_to_idle(self):
        assert normalize_status("definitely_not_a_status") is AgentStatus.IDLE

    def test_none_falls_back_to_idle(self):
        assert normalize_status(None) is AgentStatus.IDLE

    def test_empty_string_falls_back_to_idle(self):
        assert normalize_status("") is AgentStatus.IDLE

    def test_whitespace_stripped(self):
        assert normalize_status("  running  ") is AgentStatus.RUNNING


class TestWorstHealth:
    def test_error_beats_all(self):
        assert worst_health("ok", "warn", "error", "skip") == "error"

    def test_warn_beats_ok_and_skip(self):
        assert worst_health("ok", "warn", "skip") == "warn"

    def test_single_value(self):
        assert worst_health("ok") == "ok"

    def test_all_ok(self):
        assert worst_health("ok", "ok", "ok") == "ok"


class TestRiskLevel:
    def test_values(self):
        assert RiskLevel.LOW.value == "low"
        assert RiskLevel.CRITICAL.value == "critical"

    def test_ordering_by_value(self):
        levels = sorted(RiskLevel, key=lambda r: r.value)
        assert [r.value for r in levels] == ["critical", "high", "low", "medium"]
