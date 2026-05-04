from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def _read(rel_path: str) -> str:
    return (ROOT / rel_path).read_text(encoding="utf-8")


def test_simple_wrappers_delegate_to_unified_entrypoint() -> None:
    wrappers = {
        "swarm-doctor.sh": "doctor",
        "swarm-status.sh": "status",
        "swarm-init.sh": "init",
        "swarm-plan.sh": "plan",
        "swarm-audit.sh": "audit",
        "swarm-skills.sh": "skills",
        "swarm-workflows.sh": "workflows",
        "swarm-models.sh": "models",
        "swarm-inspect.sh": "inspect",
        "swarm-dashboard.sh": "dashboard",
        "swarm-config.sh": "config",
        "swarm-frameworks.sh": "frameworks",
    }
    for script_name, command in wrappers.items():
        text = _read(script_name)
        assert f'exec bash "$ROOT/swarm.sh" {command} "$@"' in text
        assert "-m swarmx" not in text


def test_run_wrapper_delegates_to_unified_entrypoint() -> None:
    text = _read("swarm-run.sh")
    assert 'exec bash "$ROOT/swarm.sh" run "$@"' in text


def test_evolve_wrapper_executes_via_unified_entrypoint() -> None:
    text = _read("swarm-evolve.sh")
    assert 'if bash "$ROOT/swarm.sh" evolve "$@"; then' in text


def test_swarm_entrypoint_prefers_cli_before_legacy_swarmx() -> None:
    text = _read("swarm.sh")
    cli_index = text.index("if has_module cli; then")
    swarmx_index = text.index("elif has_module swarmx; then")
    assert cli_index < swarmx_index
