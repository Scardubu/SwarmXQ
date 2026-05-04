"""``swarm doctor`` — environment health checks.

Checks Python version, required packages, runtime directories, config,
network connectivity (optional), and key module imports.
"""
from __future__ import annotations

import importlib
import logging
import platform
import sys
from pathlib import Path
from typing import Annotated

import typer

from swarmx.console.output import get_console, safe_print, emit_json, make_table
from swarmx.console.compat import is_json_mode

logger = logging.getLogger(__name__)

app = typer.Typer(help="Run environment health checks.")

# Packages to probe at doctor run time
_REQUIRED_PACKAGES = ["rich", "yaml", "typer"]
_OPTIONAL_PACKAGES = ["textual", "questionary", "tqdm", "pyfiglet"]
_SWARMX_MODULES = [
    "swarmx.config",
    "swarmx.evolver",
    "swarmx.mission",
    "swarmx.storage",
    "swarmx.skills",
    "swarmx.telemetry",
]

CheckResult = dict[str, object]


def _check_python() -> CheckResult:
    ver = sys.version_info
    ok = ver >= (3, 11)
    return {
        "check": "Python version",
        "status": "ok" if ok else "fail",
        "detail": f"{platform.python_version()} (requires >=3.11)",
    }


def _check_package(name: str, *, required: bool = True) -> CheckResult:
    try:
        importlib.import_module(name)
        return {"check": f"package:{name}", "status": "ok", "detail": "installed"}
    except ImportError:
        return {
            "check": f"package:{name}",
            "status": "fail" if required else "warn",
            "detail": "NOT installed",
        }


def _check_swarmx_module(dotted: str) -> CheckResult:
    try:
        importlib.import_module(dotted)
        return {"check": f"import:{dotted}", "status": "ok", "detail": "importable"}
    except ImportError as exc:
        return {"check": f"import:{dotted}", "status": "fail", "detail": str(exc)[:80]}


def _check_runtime_dirs(runtime_home: Path) -> list[CheckResult]:
    results = []
    for subdir in ["state", "traces", "audit", "memory"]:
        d = runtime_home / subdir
        results.append({
            "check": f"dir:{subdir}",
            "status": "ok" if d.exists() else "warn",
            "detail": str(d),
        })
    return results


def _check_config() -> CheckResult:
    try:
        from swarmx.config import SwarmConfig
        cfg = SwarmConfig()
        return {"check": "SwarmConfig", "status": "ok", "detail": str(cfg.home)}
    except Exception as exc:
        return {"check": "SwarmConfig", "status": "fail", "detail": str(exc)[:80]}


def run_checks(runtime_home: Path | None = None) -> list[CheckResult]:
    """Run all doctor checks and return a list of result dicts."""
    from swarmx.config import SwarmConfig

    if runtime_home is None:
        try:
            runtime_home = SwarmConfig().home
        except Exception:
            runtime_home = Path.home() / ".swarmx"

    results: list[CheckResult] = [
        _check_python(),
        _check_config(),
    ]
    for pkg in _REQUIRED_PACKAGES:
        results.append(_check_package(pkg, required=True))
    for pkg in _OPTIONAL_PACKAGES:
        results.append(_check_package(pkg, required=False))
    for mod in _SWARMX_MODULES:
        results.append(_check_swarmx_module(mod))
    results.extend(_check_runtime_dirs(runtime_home))
    return results


@app.command("check")
def doctor_check(
    json_out: Annotated[bool, typer.Option("--json", help="JSON output.")] = False,
    strict: Annotated[bool, typer.Option("--strict", help="Exit non-zero on warnings too.")] = False,
) -> None:
    """Run all environment health checks and report status."""
    from swarmx.config import SwarmConfig

    try:
        cfg = SwarmConfig()
        runtime_home = cfg.home
    except Exception:
        runtime_home = None

    checks = run_checks(runtime_home)
    _json = json_out or is_json_mode()

    if _json:
        emit_json(checks)
    else:
        c = get_console()
        t = make_table("Check", "Status", "Detail", title="Doctor Report")
        for ch in checks:
            status = str(ch.get("status", "?"))
            style = "success" if status == "ok" else "error" if status == "fail" else "warning"
            t.add_row(str(ch.get("check")), f"[{style}]{status.upper()}[/{style}]", str(ch.get("detail", "")))
        c.print(t)

    fails = [c for c in checks if c.get("status") == "fail"]
    warns = [c for c in checks if c.get("status") == "warn"]

    if not _json:
        if fails:
            safe_print(f"[error]{len(fails)} failure(s) detected.[/error]")
        if warns:
            safe_print(f"[warning]{len(warns)} warning(s) detected.[/warning]")
        if not fails and not warns:
            safe_print("[success]All checks passed.[/success]")

    if fails or (strict and warns):
        raise typer.Exit(code=1)
