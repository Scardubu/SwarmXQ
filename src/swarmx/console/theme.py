"""Design tokens and Rich theme for the SwarmX premium CLI."""
from __future__ import annotations

from rich.theme import Theme

# ── Palette ──────────────────────────────────────────────────────────────────

BRAND = "bright_cyan"
ACCENT = "bright_magenta"
SUCCESS = "bright_green"
WARNING = "bright_yellow"
ERROR = "bright_red"
MUTED = "grey62"
INFO = "bright_blue"
HIGHLIGHT = "bold white"

# ── Named styles ─────────────────────────────────────────────────────────────

SWARMX_THEME = Theme(
    {
        # semantic
        "brand": BRAND,
        "accent": ACCENT,
        "success": SUCCESS,
        "warning": WARNING,
        "error": f"bold {ERROR}",
        "muted": MUTED,
        "info": INFO,
        "highlight": HIGHLIGHT,
        # structural
        "panel.border": BRAND,
        "rule.line": MUTED,
        "progress.description": "white",
        "progress.percentage": BRAND,
        "progress.remaining": MUTED,
        "progress.bar.complete": BRAND,
        "progress.bar.finished": SUCCESS,
        "progress.bar.pulse": ACCENT,
        "spinner": BRAND,

        # ── Skill invocation styles ───────────────────────────────────────────
        "skill.active":        "bold bright_cyan",
        "skill.triggered":     "bright_magenta",
        "skill.complete":      "bright_green",
        "delta.promote":       "bold bright_green",
        "delta.hold":          "bright_yellow",
        "delta.signal":        "bright_magenta",
        "diagnosis.confirmed": "bold bright_green",
        "diagnosis.searching": "bright_yellow",
        "team.pattern":        "bold bright_cyan",
        # table chrome
        "table.header": f"bold {BRAND}",
        "table.caption": MUTED,
        # markdown
        "markdown.h1": f"bold {BRAND}",
        "markdown.h2": f"bold {ACCENT}",
        "markdown.code": "green",
        "markdown.code_block": "green",
        "markdown.link": INFO,
        # status
        "status.pending": WARNING,
        "status.running": BRAND,
        "status.done": SUCCESS,
        "status.failed": f"bold {ERROR}",
        "status.skipped": MUTED,
        "status.approved": SUCCESS,
        "status.rejected": f"bold {ERROR}",
        "status.awaiting_review": WARNING,
        "status.evolution_approved": f"bold {SUCCESS}",
        "status.risk_low": INFO,
        "status.risk_high": WARNING,
        "status.risk_critical": f"bold {ERROR}",
    }
)

# ── Status display maps ───────────────────────────────────────────────────────

STATUS_ICONS: dict[str, str] = {
    "done": "✓",
    "running": "⟳",
    "pending": "○",
    "failed": "✗",
    "skipped": "–",
    "approved": "✓",
    "rejected": "✗",
    "review": "⊙",
    "awaiting_review": "⊙",
    "evolution_approved": "✦",
    "risk_low": "▲",
    "risk_high": "▲",
    "risk_critical": "▲",
}

STATUS_FALLBACK: dict[str, str] = {
    "done": "[OK]",
    "running": "[..] ",
    "pending": "[ ]",
    "failed": "[FAIL]",
    "skipped": "[SKIP]",
    "approved": "[OK]",
    "rejected": "[FAIL]",
    "review": "[??]",
    "awaiting_review": "[??]",
    "evolution_approved": "[EVO]",
    "risk_low": "[LOW]",
    "risk_high": "[HIGH]",
    "risk_critical": "[CRIT]",
}

STATUS_STYLE: dict[str, str] = {
    "done": "success",
    "running": "brand",
    "pending": "status.pending",
    "failed": "error",
    "skipped": "muted",
    "approved": "status.approved",
    "rejected": "status.rejected",
    "review": "info",
    "awaiting_review": "status.awaiting_review",
    "evolution_approved": "status.evolution_approved",
    "risk_low": "status.risk_low",
    "risk_high": "status.risk_high",
    "risk_critical": "status.risk_critical",
}


def status_icon(state: str, unicode_ok: bool = True) -> str:
    """Return the display icon for a state, with ASCII fallback."""
    key = state.lower()
    if unicode_ok:
        return STATUS_ICONS.get(key, "?")
    return STATUS_FALLBACK.get(key, "?")


def status_style(state: str) -> str:
    """Return the Rich style name for a state."""
    return STATUS_STYLE.get(state.lower(), "muted")
