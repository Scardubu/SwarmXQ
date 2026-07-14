"""Capability detection and environment compatibility for the premium CLI.

Centralises all environment probing so no command module needs to directly
read os.environ for colour / TTY / CI state.
"""
from __future__ import annotations

import os
import sys


def _flag(name: str) -> bool:
    """Return True if an environment variable is set to a truthy value."""
    v = os.environ.get(name, "").strip().lower()
    return v in {"1", "true", "yes", "on"}


def _is_swarm_invocation() -> bool:
    """Return True when process argv represents a swarm/swarmx CLI run."""
    if not sys.argv:
        return False

    argv0 = os.path.basename(sys.argv[0]).lower()
    if "swarm" in argv0:
        return True

    if len(sys.argv) >= 3 and sys.argv[1] == "-m":
        target = sys.argv[2].lower()
        return target == "swarmx" or target.startswith("swarmx.")
    return False


def _argv_has(flag: str) -> bool:
    """Detect a CLI flag only for swarm invocations to avoid tool conflicts."""
    return _is_swarm_invocation() and flag in sys.argv


# ── Terminal capability detection ────────────────────────────────────────────

def is_no_color() -> bool:
    """True when color output should be suppressed.

    Explicit NO_COLOR-style environment variables apply globally. TERM=dumb is
    only honored for SwarmX CLI invocations so unrelated non-interactive test
    runners do not change default behavior.
    """
    return (
        "NO_COLOR" in os.environ
        or _flag("SWARMX_NO_COLOR")
        or (_is_swarm_invocation() and os.environ.get("TERM", "").lower() == "dumb")
    )


def is_ci() -> bool:
    """True when running inside a known CI environment."""
    return (
        "CI" in os.environ
        or "GITHUB_ACTIONS" in os.environ
        or "GITLAB_CI" in os.environ
        or "BUILDKITE" in os.environ
        or "CIRCLECI" in os.environ
        or "JENKINS_HOME" in os.environ
        or _flag("SWARMX_CI")
    )


def is_json_mode() -> bool:
    """True when the caller requested machine-readable JSON output."""
    return _flag("SWARMX_JSON") or _argv_has("--json")


def is_quiet() -> bool:
    """True when quiet / non-interactive output is requested."""
    return _flag("SWARMX_QUIET") or _argv_has("-q") or _argv_has("--quiet")


def is_no_progress() -> bool:
    """True when progress indicators should be suppressed."""
    return is_ci() or is_no_color() or is_quiet() or _flag("SWARMX_NO_PROGRESS")


def supports_unicode() -> bool:
    """True when the terminal encoding can render Unicode."""
    try:
        encoding = sys.stdout.encoding or "ascii"
        return encoding.lower().replace("-", "") in {"utf8", "utf16", "utf32"}
    except Exception:
        return False


def terminal_width() -> int:
    """Safe terminal width with a compact minimum for narrow consoles."""
    try:
        import shutil
        w = shutil.get_terminal_size(fallback=(80, 24)).columns
        return max(40, w)
    except Exception:
        return 80


def has_textual() -> bool:
    """True when textual TUI is available."""
    try:
        import textual  # noqa: F401
        return True
    except ImportError:
        return False


def has_questionary() -> bool:
    """True when questionary interactive prompts are available."""
    try:
        import questionary  # noqa: F401
        return True
    except ImportError:
        return False


def has_typer() -> bool:
    """True when typer is installed (should always be true after install)."""
    try:
        import typer  # noqa: F401
        return True
    except ImportError:
        return False
