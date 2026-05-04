"""Three-tier TUI review for evolution proposals.

Tier 1 — Textual (full TUI)
Tier 2 — questionary (interactive prompts)
Tier 3 — stdin line reader (CI / pipe fallback)

Bug fix vs v0.2.0:
  - [BUG-05] Decisions dict is mutated in-place and shared across tiers so
    a partial questionary session is not lost if Textual fails mid-session.
  - [BUG-06] Shared-decisions object is passed by reference; all three tiers
    write into the same dict so caller always sees the final merged state.
"""
from __future__ import annotations

from typing import Any

from .compat import has_textual, has_questionary
from .output import get_console, safe_print


# ── Public API ────────────────────────────────────────────────────────────────

def review_proposals(
    proposals: list[dict[str, Any]],
    *,
    decisions: dict[str, str] | None = None,
    dry_run: bool = False,
) -> dict[str, str]:
    """Present proposals for human review and collect approve/reject decisions.

    Parameters
    ----------
    proposals:
        List of proposal dicts with at least ``id``, ``summary``, and
        optionally ``pareto_score``.
    decisions:
        Pre-populated decisions dict to extend (shared mutable state, BUG-05/06).
    dry_run:
        If True, auto-approve all proposals without prompting.

    Returns
    -------
    dict mapping proposal_id → "approved" | "rejected"
    """
    if decisions is None:
        decisions = {}

    if dry_run:
        for p in proposals:
            decisions[p["id"]] = "approved"
        return decisions

    if has_textual():
        try:
            return _review_textual(proposals, decisions)
        except Exception as exc:
            safe_print(f"[warning]Textual TUI failed ({exc}), falling back to prompts.[/warning]")

    if has_questionary():
        try:
            return _review_questionary(proposals, decisions)
        except Exception as exc:
            safe_print(f"[warning]questionary failed ({exc}), falling back to stdin.[/warning]")

    return _review_stdin(proposals, decisions)


# ── Tier 1: Textual ───────────────────────────────────────────────────────────

def _review_textual(
    proposals: list[dict[str, Any]],
    decisions: dict[str, str],
) -> dict[str, str]:
    from textual.app import App, ComposeResult
    from textual.widgets import DataTable, Footer, Header, Label
    from textual.binding import Binding

    class ReviewApp(App[None]):
        BINDINGS = [
            Binding("a", "approve", "Approve"),
            Binding("r", "reject", "Reject"),
            Binding("q", "quit", "Done"),
        ]

        def __init__(self) -> None:
            super().__init__()
            self._idx = 0

        def compose(self) -> ComposeResult:
            yield Header()
            yield Label("", id="detail")
            yield DataTable(id="table")
            yield Footer()

        def on_mount(self) -> None:
            tbl: DataTable = self.query_one("#table")  # type: ignore[assignment]
            tbl.add_columns("ID", "Summary", "Pareto", "Decision")
            for p in proposals:
                tbl.add_row(
                    p.get("id", "?"),
                    str(p.get("summary", ""))[:60],
                    f"{p.get('pareto_score', 0.0):.3f}",
                    decisions.get(p.get("id", ""), "—"),
                )
            self._refresh_detail()

        def _refresh_detail(self) -> None:
            if not proposals:
                return
            p = proposals[self._idx]
            label: Label = self.query_one("#detail")  # type: ignore[assignment]
            label.update(
                f"[{self._idx + 1}/{len(proposals)}] {p.get('id','')} — "
                f"{p.get('summary','')}"
            )

        def action_approve(self) -> None:
            if not proposals:
                return
            pid = proposals[self._idx].get("id", "")
            decisions[pid] = "approved"
            self._advance()

        def action_reject(self) -> None:
            if not proposals:
                return
            pid = proposals[self._idx].get("id", "")
            decisions[pid] = "rejected"
            self._advance()

        def _advance(self) -> None:
            self._idx = min(self._idx + 1, len(proposals) - 1)
            self._refresh_detail()
            tbl: DataTable = self.query_one("#table")  # type: ignore[assignment]
            tbl.move_cursor(row=self._idx)

        def action_quit(self) -> None:
            self.exit()

    ReviewApp().run()
    return decisions


# ── Tier 2: questionary ───────────────────────────────────────────────────────

def _review_questionary(
    proposals: list[dict[str, Any]],
    decisions: dict[str, str],
) -> dict[str, str]:
    import questionary

    for p in proposals:
        pid = p.get("id", "")
        if pid in decisions:
            continue
        summary = p.get("summary", str(p))[:120]
        pareto = p.get("pareto_score", None)
        label = summary
        if pareto is not None:
            label = f"{summary}  [pareto={pareto:.3f}]"
        answer = questionary.select(
            f"Proposal {pid}:\n  {label}",
            choices=["approve", "reject", "skip"],
            default="approve",
        ).ask()
        if answer and answer != "skip":
            decisions[pid] = answer + "d"  # "approved" / "rejected"

    return decisions


# ── Tier 3: stdin ─────────────────────────────────────────────────────────────

def _review_stdin(
    proposals: list[dict[str, Any]],
    decisions: dict[str, str],
) -> dict[str, str]:
    c = get_console()
    for p in proposals:
        pid = p.get("id", "")
        if pid in decisions:
            continue
        summary = p.get("summary", str(p))[:120]
        pareto = p.get("pareto_score", None)
        c.print(f"\n[brand]Proposal[/brand] [highlight]{pid}[/highlight]")
        c.print(f"  [muted]{summary}[/muted]")
        if pareto is not None:
            c.print(f"  pareto_score=[brand]{pareto:.3f}[/brand]")
        try:
            raw = input("  Approve? [Y/n/skip]: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            break
        if raw in {"n", "no"}:
            decisions[pid] = "rejected"
        elif raw in {"s", "skip"}:
            pass
        else:
            decisions[pid] = "approved"

    return decisions
