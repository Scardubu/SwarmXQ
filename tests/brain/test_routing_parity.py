"""
tests/brain/test_routing_parity.py — V5.9 routing-parity regression tests

Covers:
  - brain.roles.role_model() env-var override propagation
  - brain.router._resolve_model() delegates to role_model() (no divergence)
  - brain.loop._publish_event() rejects unknown event kind strings
  - SwarmConfig model fields respond to env-var overrides
  - detect_intent / classify consistency (same role for same signal words)
"""
from __future__ import annotations

import os
import sys
from unittest.mock import patch

# ─── role_model env-var override ─────────────────────────────────────────────

def test_role_model_fast_env_override() -> None:
    """SWARM_MODEL_FAST propagates through brain.roles.role_model('fast')."""
    import brain.roles as roles
    with patch.dict(os.environ, {"SWARM_MODEL_FAST": "phi4-override"}):
        # Force re-evaluation (no module-level caching)
        result = roles.role_model("fast")
    assert result == "phi4-override"


def test_role_model_reason_env_override() -> None:
    """SWARM_MODEL_REASON propagates through brain.roles.role_model('reason')."""
    import brain.roles as roles
    with patch.dict(os.environ, {"SWARM_MODEL_REASON": "llama3:70b"}):
        result = roles.role_model("reason")
    assert result == "llama3:70b"


def test_role_model_code_env_override() -> None:
    """SWARM_MODEL_CODE propagates through brain.roles.role_model('code')."""
    import brain.roles as roles
    with patch.dict(os.environ, {"SWARM_MODEL_CODE": "qwen2.5-coder:32b"}):
        result = roles.role_model("code")
    assert result == "qwen2.5-coder:32b"


def test_role_model_swarmx_override_highest_priority() -> None:
    """SWARMX_MODEL_FAST overrides SWARM_MODEL_FAST (highest priority)."""
    import brain.roles as roles
    with patch.dict(os.environ, {
        "SWARMX_MODEL_FAST": "top-priority",
        "SWARM_MODEL_FAST": "lower-priority",
    }):
        result = roles.role_model("fast")
    assert result == "top-priority"


def test_role_model_unknown_role_returns_default() -> None:
    """Unknown role returns phi4-fast universal fallback."""
    import brain.roles as roles
    result = roles.role_model("nonexistent-role")
    assert result == "phi4-fast"


# ─── _resolve_model delegates to role_model ───────────────────────────────────

def test_resolve_model_uses_roles_module() -> None:
    """brain.router._resolve_model delegates to brain.roles.role_model for canon roles."""
    import brain.router as router
    with patch.dict(os.environ, {"SWARM_MODEL_FAST": "delegated-model"}):
        # Clear cached config so no brain.yaml override applies
        router._CONFIG = {}
        result = router._resolve_model("fast")
    assert result == "delegated-model"


def test_resolve_model_brain_yaml_wins_over_env() -> None:
    """brain.yaml `models:` section overrides env (highest priority in router)."""
    import brain.router as router
    router._CONFIG = {"models": {"fast": "config-file-model"}}
    with patch.dict(os.environ, {"SWARM_MODEL_FAST": "env-model"}):
        result = router._resolve_model("fast")
    router._CONFIG = {}  # cleanup
    assert result == "config-file-model"


# ─── _publish_event kind mapping ─────────────────────────────────────────────

def test_publish_event_unknown_kind_is_skipped(monkeypatch) -> None:
    """_publish_event silently skips unknown kind strings (doesn't blow up)."""
    import brain.loop as loop

    published = []

    def fake_publish(home, kind, payload):
        published.append(kind)

    monkeypatch.setenv("SWARM_HOME", "/tmp/swarmx-test")
    # Mock the event bus publish so we don't need SWARM_HOME to exist
    with patch("brain.loop._SWARM_HOME", "/tmp/swarmx-test"), patch.dict(sys.modules, {
        "swarmx.event_bus": type(sys)("swarmx.event_bus"),
    }):
        import types
        bus_mock = types.ModuleType("swarmx.event_bus")

        class FakeEventKind:
            TASK_START = "TASK_START"
            TASK_COMPLETE = "TASK_COMPLETE"
            TASK_FAILED = "TASK_FAILED"

        bus_mock.EventKind = FakeEventKind
        bus_mock.publish = fake_publish
        sys.modules["swarmx.event_bus"] = bus_mock

        # Known kind — should publish
        loop._publish_event("task.start", {"goal": "test"})
        # Unknown kind — should NOT raise, should not publish
        loop._publish_event("unknown.kind", {"goal": "test"})

        del sys.modules["swarmx.event_bus"]

    # Only the known kind was forwarded
    assert len(published) == 1
    assert published[0] == FakeEventKind.TASK_START


# ─── detect_intent / classify consistency ─────────────────────────────────────

def test_detect_intent_classify_agree_on_code_signals() -> None:
    """router.detect_intent and dispatcher.classify must agree on code-heavy prompts."""
    from brain.dispatcher import classify
    from brain.router import detect_intent

    prompt = "implement a Python class for the payment schema"
    router_role = detect_intent(prompt)
    dispatch_mode = classify(prompt)

    # Both should route to code/implementation path
    assert router_role == "code", f"router gave {router_role!r}"
    assert dispatch_mode == "code", f"classifier gave {dispatch_mode!r}"


def test_detect_intent_classify_agree_on_reason_signals() -> None:
    """router.detect_intent and dispatcher.classify must agree on analysis prompts."""
    from brain.dispatcher import classify
    from brain.router import detect_intent

    prompt = "analyze and design the architecture for the auth service"
    router_role = detect_intent(prompt)
    dispatch_mode = classify(prompt)

    assert router_role == "reason", f"router gave {router_role!r}"
    assert dispatch_mode == "reason", f"classifier gave {dispatch_mode!r}"


# ─── SwarmConfig env-var binding ─────────────────────────────────────────────

def test_swarmconfig_model_fast_from_env() -> None:
    """SwarmConfig.model_fast is controlled by SWARM_MODEL_FAST env var."""
    with patch.dict(os.environ, {"SWARM_MODEL_FAST": "phi4-env"}):
        # Import fresh to bypass lru_cache on _bundle_defaults but dataclass
        # fields are evaluated at instantiation time — safe to import here
        try:
            from swarmx.config import SwarmConfig
        except ImportError:
            from src.swarmx.config import SwarmConfig  # type: ignore[no-redef]
        cfg = SwarmConfig()
    assert cfg.model_fast == "phi4-env"


def test_swarmconfig_tool_timeout_from_env() -> None:
    """SwarmConfig.tool_hard_timeout_s is controlled by TOOL_HARD_TIMEOUT_S."""
    with patch.dict(os.environ, {"TOOL_HARD_TIMEOUT_S": "99"}):
        try:
            from swarmx.config import SwarmConfig
        except ImportError:
            from src.swarmx.config import SwarmConfig  # type: ignore[no-redef]
        cfg = SwarmConfig()
    assert cfg.tool_hard_timeout_s == 99
