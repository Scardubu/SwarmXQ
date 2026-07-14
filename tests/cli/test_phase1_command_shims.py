from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_phase1_wrapper_commands_registered_in_cli_root() -> None:
    text = (ROOT / "cli/main.py").read_text(encoding="utf-8")

    expected = {
        "plan": "cli.commands.plan",
        "skills": "cli.commands.skills",
        "workflows": "cli.commands.workflows",
        "models": "cli.commands.models",
        "frameworks": "cli.commands.frameworks",
        "config": "cli.commands.config",
    }

    for command, module in expected.items():
        needle = f'_add("{command}", "{module}"'
        assert needle in text, command
