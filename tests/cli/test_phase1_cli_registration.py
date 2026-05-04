from __future__ import annotations


def test_phase1_compat_commands_registered_on_root_cli() -> None:
    from cli.main import app

    registered = {grp.name for grp in app.registered_groups} | {cmd.name for cmd in app.registered_commands}
    for expected in {"plan", "skills", "workflows", "models", "frameworks", "config"}:
        assert expected in registered
