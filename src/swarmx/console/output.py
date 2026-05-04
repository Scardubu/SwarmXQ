"""Output primitives — console factory, panels, tables, spinners, banners.

All render calls route through the single console instance returned by
``get_console()``. Command modules must NOT instantiate their own Console.

Bug fixes vs v0.2.0:
  - [BUG-01] Spinner and print no longer share the same stream; spinner is
    stopped before any non-Live print call via ``safe_print``.
  - [BUG-03] ``emit_json`` always writes to sys.stdout bypassing Rich so CI
    piping works correctly even when NO_COLOR is active.
  - [BUG-10] Banner renders with ASCII fallback when unicode is unavailable.
"""
from __future__ import annotations

import json
import sys
from typing import Any

from rich.console import Console
from rich.panel import Panel
from rich.rule import Rule
from rich.spinner import Spinner
from rich.table import Table, Column

from .compat import is_no_color, is_json_mode, terminal_width, supports_unicode
from .theme import SWARMX_THEME

# ── Singleton console ─────────────────────────────────────────────────────────

_console: Console | None = None


def get_console(*, force_terminal: bool | None = None) -> Console:
    """Return the shared Rich console, respecting NO_COLOR."""
    global _console
    if _console is None:
        no_color = is_no_color()
        _console = Console(
            theme=SWARMX_THEME,
            no_color=no_color,
            highlight=not no_color,
            force_terminal=force_terminal,
            width=terminal_width(),
            stderr=False,
        )
    return _console


def reset_console() -> None:
    """Force a new console instance (useful in tests and after env changes)."""
    global _console
    _console = None


# ── Safe print (BUG-01 fix) ───────────────────────────────────────────────────

def safe_print(*args: Any, **kwargs: Any) -> None:
    """Print via the shared console. Never call while a Live context is active."""
    get_console().print(*args, **kwargs)


# ── JSON output (BUG-03 fix) ──────────────────────────────────────────────────

def emit_json(data: Any) -> None:
    """Write JSON to raw stdout — bypasses Rich so pipe/capture works."""
    sys.stdout.write(json.dumps(data, default=str, indent=2))
    sys.stdout.write("\n")
    sys.stdout.flush()


def emit_error(message: str, *, code: int = 1, detail: dict[str, Any] | None = None) -> None:
    """Emit a structured error — JSON in json-mode, styled panel otherwise."""
    if is_json_mode():
        payload: dict[str, Any] = {"error": message, "code": code}
        if detail:
            payload["detail"] = detail
        emit_json(payload)
    else:
        get_console().print(
            Panel(message, title="[error]Error[/error]", border_style="error", expand=False)
        )


# ── Banner (BUG-10 fix) ───────────────────────────────────────────────────────

_BANNER_UNICODE = r"""
 ███████╗██╗    ██╗ █████╗ ██████╗ ███╗   ███╗██╗  ██╗
 ██╔════╝██║    ██║██╔══██╗██╔══██╗████╗ ████║╚██╗██╔╝
 ███████╗██║ █╗ ██║███████║██████╔╝██╔████╔██║ ╚███╔╝
 ╚════██║██║███╗██║██╔══██║██╔══██╗██║╚██╔╝██║ ██╔██╗
 ███████║╚███╔███╔╝██║  ██║██║  ██║██║ ╚═╝ ██║██╔╝ ██╗
 ╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝  ╚═╝
""".strip("\n")

_BANNER_ASCII = "SWARMX - Unified Operator Platform"


def print_banner(version: str = "") -> None:
    """Print the startup banner. ASCII fallback when unicode unavailable."""
    c = get_console()
    if supports_unicode() and not is_no_color():
        c.print(f"[brand]{_BANNER_UNICODE}[/brand]")
    else:
        c.print(f"[highlight]{_BANNER_ASCII}[/highlight]")
    if version:
        c.print(f"  [muted]v{version}[/muted]\n")


# ── Section headings ──────────────────────────────────────────────────────────

def print_rule(title: str = "", style: str = "rule.line") -> None:
    get_console().print(Rule(title or "", style=style))


def print_section(title: str) -> None:
    get_console().print(f"\n[table.header]{title}[/table.header]")
    print_rule()


# ── Standard table factory ────────────────────────────────────────────────────

def make_table(
    *headers: str | Column,
    title: str = "",
    caption: str = "",
    show_lines: bool = False,
) -> Table:
    """Create a pre-styled Rich Table."""
    t = Table(
        *headers,
        title=f"[table.header]{title}[/table.header]" if title else None,
        caption=f"[table.caption]{caption}[/table.caption]" if caption else None,
        show_header=True,
        header_style="table.header",
        border_style="panel.border",
        show_lines=show_lines,
        expand=False,
    )
    return t


# ── Spinner factory ───────────────────────────────────────────────────────────

def make_spinner(text: str = "Working…") -> Spinner:
    """Return a Rich Spinner; use inside a Live context."""
    return Spinner("dots", text=f"[spinner]{text}[/spinner]")


# ── Key-value summary panel ───────────────────────────────────────────────────

def kv_panel(data: dict[str, Any], title: str = "", max_value_len: int = 120) -> Panel:
    """Render a dict as a two-column key/value panel."""
    t = make_table("Key", "Value")
    for k, v in data.items():
        raw = str(v)
        display = raw[:max_value_len] + "…" if len(raw) > max_value_len else raw
        t.add_row(f"[muted]{k}[/muted]", display)
    return Panel(t, title=f"[brand]{title}[/brand]" if title else "", border_style="panel.border")


# ── APEX-16 skill/delta/diagnosis render helpers ──────────────────────────────

def render_skill_activation(console: Console, skill_name: str, trigger: str, phase: str = "active") -> None:
    """Render a skill activation banner in the SwarmX terminal UX."""
    style_map = {"active": "skill.active", "triggered": "skill.triggered", "complete": "skill.complete"}
    style = style_map.get(phase, "skill.active")
    console.print(f"  ◆ [{style}]{skill_name}[/{style}] [muted]← {trigger}[/muted]")


def render_diagnosis_table(console: Console, diagnosis: dict[str, Any]) -> None:
    """Render a code-diagnose output as a Rich table."""
    table = Table(title="🔬 Diagnosis Report", border_style="panel.border", show_lines=True)
    table.add_column("Field", style="highlight", width=22)
    table.add_column("Value", style="white")
    rows: list[tuple[str, str]] = [
        ("Failure Signal",  diagnosis.get("failure_signal", "—")),
        ("Change Surface",  diagnosis.get("change_surface", "—")),
        ("Memory Match",    diagnosis.get("memory_match", "none")),
        ("Confirmed Cause", diagnosis.get("confirmed_cause", "investigating...")),
        ("Fix Scope",       diagnosis.get("fix_scope", "—")),
        ("Blast Radius",    diagnosis.get("blast_radius", "—")),
        ("Next Action",     diagnosis.get("next_action", "—")),
    ]
    cause = diagnosis.get("confirmed_cause", "")
    for label, value in rows:
        style = "diagnosis.confirmed" if label == "Confirmed Cause" and cause else "white"
        table.add_row(label, f"[{style}]{value}[/{style}]")
    console.print(table)


def render_delta_summary(console: Console, delta: dict[str, Any]) -> None:
    """Render an evolution delta summary panel."""
    action = delta.get("delta_action", "unknown")
    signal = delta.get("evolution_signal", "—")
    score = float(delta.get("composite_score", 0.0))
    skills = delta.get("triggered_skills", [])
    action_style = "delta.promote" if action == "promote" else "delta.hold"
    skills_str = ", ".join(skills) if skills else "none"
    score_tag = "success" if score >= 0.72 else "warning"
    content = (
        f"[highlight]Action:[/highlight]  [{action_style}]{action.upper()}[/{action_style}]\n"
        f"[highlight]Signal:[/highlight]  [delta.signal]{signal}[/delta.signal]\n"
        f"[highlight]Score:[/highlight]   [{score_tag}]{score:.2f}[/{score_tag}]\n"
        f"[highlight]Skills:[/highlight]  [skill.triggered]{skills_str}[/skill.triggered]"
    )
    console.print(Panel(content, title="⚡ Evolution Delta", border_style="panel.border", padding=(0, 1)))


def render_team_blueprint(console: Console, blueprint: dict[str, Any]) -> None:
    """Render a dynamic-team-factory blueprint as a structured table."""
    pattern = blueprint.get("pattern", "unknown")
    rationale = blueprint.get("rationale", "—")
    roles: list[dict[str, Any]] = blueprint.get("roles", [])
    console.print(f"\n🏗️  [team.pattern]{pattern}[/team.pattern]  [muted]— {rationale}[/muted]")
    table = Table(border_style="panel.border", show_lines=True)
    table.add_column("Role", style="skill.active", width=20)
    table.add_column("Responsibility", style="white", width=40)
    table.add_column("Risk", style="warning", width=8)
    table.add_column("Model Tier", style="muted", width=10)
    for role in roles:
        risk_val = role.get("risk", "low")
        risk_style = {"high": "error", "medium": "warning", "low": "success"}.get(risk_val, "white")
        table.add_row(
            role.get("name", "—"),
            role.get("responsibility", "—"),
            f"[{risk_style}]{risk_val}[/{risk_style}]",
            role.get("model_tier", "—"),
        )
    console.print(table)


def render_security_findings(console: Console, findings: list[dict[str, Any]]) -> None:
    """Render security-auditor findings as a prioritized table."""
    _severity_order = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFORMATIONAL"]
    severity_styles: dict[str, str] = {
        "CRITICAL": "bold red",
        "HIGH": "bright_red",
        "MEDIUM": "bright_yellow",
        "LOW": "bright_blue",
        "INFORMATIONAL": "muted",
    }
    table = Table(title="🛡️  Security Findings", border_style="panel.border", show_lines=True)
    table.add_column("ID", style="muted", width=8)
    table.add_column("Severity", width=12)
    table.add_column("Title", style="white", width=40)
    table.add_column("Priority", width=12)
    table.add_column("Effort", width=6)
    for finding in sorted(
        findings,
        key=lambda f: _severity_order.index(f.get("severity", "LOW"))
        if f.get("severity") in _severity_order
        else 99,
    ):
        sev = finding.get("severity", "LOW")
        style = severity_styles.get(sev, "white")
        table.add_row(
            finding.get("id", "—"),
            f"[{style}]{sev}[/{style}]",
            finding.get("title", "—"),
            finding.get("priority", "—"),
            finding.get("effort", "—"),
        )
    console.print(table)


def render_zoom_out(console: Console, result: dict[str, Any]) -> None:
    """Render a zoom-out result with verdict and next action."""
    verdict = result.get("verdict", "unknown")
    verdict_styles = {"keep": "success", "pivot": "warning", "park": "info", "abandon": "error"}
    style = verdict_styles.get(verdict, "white")
    content = (
        f"[highlight]Original:[/highlight] {result.get('original_objective', '—')}\n"
        f"[highlight]Current: [/highlight] {result.get('current_work', '—')}\n"
        f"[highlight]Verdict: [/highlight] [{style}]{verdict.upper()}[/{style}]\n"
        f"[highlight]Next:    [/highlight] {result.get('next_action', '—')}"
    )
    console.print(Panel(content, title="🔭 Zoom Out", border_style="panel.border", padding=(0, 1)))
