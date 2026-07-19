"""``swarm evolve`` — generate and review evolution proposals.

Bug fixes vs v0.2.0:
  - [BUG-04] ImportError for optional divergent_proposer is caught in the
    engine adapter; evolve never crashes on missing optional package.
  - [BUG-05] TUI decisions are persisted in a shared dict across tier fallbacks.
  - [BUG-07] Pareto score column is always rendered in the proposals table.
  - [BUG-09] --apply flag is guarded by a gate assessment before any mutation.
"""
from __future__ import annotations

import structlog
from pathlib import Path
from typing import Annotated

import typer

from swarmx.console.compat import is_json_mode
from swarmx.console.output import emit_error, emit_json, get_console, make_table, safe_print

logger = structlog.get_logger("swarmx.console.commands.evolve")

app = typer.Typer(help="Generate, review, and apply swarm evolution proposals.")


@app.command("show")
def evolve_show(
    repo: Annotated[Path, typer.Option("--repo", "-r", help="Repository root.")] = Path("."),
    limit: Annotated[int, typer.Option("--limit", "-n", help="Max proposals to show.")] = 10,
    json_out: Annotated[bool, typer.Option("--json", help="JSON output.")] = False,
) -> None:
    """Show pending evolution proposals."""
    from swarmx.config import SwarmConfig
    from swarmx.core.evolution_engine import get_proposals

    cfg = SwarmConfig()
    proposals = get_proposals(cfg.home, limit=limit)
    _json = json_out or is_json_mode()

    if _json:
        emit_json(proposals)
        return

    c = get_console()
    if not proposals:
        c.print("[muted]No proposals stored. Run 'swarm evolve generate' first.[/muted]")
        return

    t = make_table("ID", "Summary", "Pareto", "Status", title="Evolution Proposals")
    for p in proposals:
        t.add_row(
            str(p.get("id", "?"))[:20],
            str(p.get("summary", p.get("description", "")))[:60],
            f"{float(p.get('pareto_score', 0.0)):.3f}",  # BUG-07: always render
            str(p.get("status", "pending")),
        )
    c.print(t)


@app.command("generate")
def evolve_generate(
    repo: Annotated[Path, typer.Option("--repo", "-r", help="Repository root.")] = Path("."),
    k: Annotated[int, typer.Option("--k", help="Number of divergent proposals.")] = 3,
    json_out: Annotated[bool, typer.Option("--json", help="JSON output.")] = False,
) -> None:
    """Generate divergent evolution proposals."""
    from swarmx.config import SwarmConfig
    from swarmx.core.evolution_engine import generate_proposals

    cfg = SwarmConfig()
    repo_path = repo.expanduser().resolve()
    _json = json_out or is_json_mode()

    if not _json:
        safe_print(f"[brand]Generating {k} evolution proposals…[/brand]")

    proposals = generate_proposals(repo=repo_path, cfg=cfg, k=k)

    if _json:
        emit_json(proposals)
        return

    if not proposals:
        safe_print("[warning]No proposals generated.[/warning]")
        return

    c = get_console()
    t = make_table("ID", "Summary", "Pareto", title="Generated Proposals")
    for p in proposals:
        t.add_row(
            str(p.get("id", "?"))[:24],
            str(p.get("summary", p.get("description", "")))[:70],
            f"{float(p.get('pareto_score', 0.0)):.3f}",
        )
    c.print(t)


@app.command("review")
def evolve_review(
    repo: Annotated[Path, typer.Option("--repo", "-r", help="Repository root.")] = Path("."),
    dry_run: Annotated[bool, typer.Option("--dry-run", help="Auto-approve (no prompts).")] = False,
    json_out: Annotated[bool, typer.Option("--json", help="JSON output.")] = False,
) -> None:
    """Interactively review pending proposals (Textual → questionary → stdin)."""
    from swarmx.config import SwarmConfig
    from swarmx.console.tui_review import review_proposals
    from swarmx.core.evolution_engine import pending_proposals

    cfg = SwarmConfig()
    proposals = pending_proposals(cfg.home)
    _json = json_out or is_json_mode()

    if not proposals:
        if _json:
            emit_json({"decisions": {}})
        else:
            safe_print("[muted]No pending proposals to review.[/muted]")
        return

    # BUG-05: decisions is a shared dict mutated in-place across tiers
    decisions: dict[str, str] = {}
    decisions = review_proposals(proposals, decisions=decisions, dry_run=dry_run)

    if _json:
        emit_json({"decisions": decisions})
        return

    safe_print(f"[success]Review complete:[/success] {len(decisions)} decision(s) recorded.")


@app.command("apply")
def evolve_apply(
    repo: Annotated[Path, typer.Option("--repo", "-r", help="Repository root.")] = Path("."),
    json_out: Annotated[bool, typer.Option("--json", help="JSON output.")] = False,
    force: Annotated[bool, typer.Option("--force", help="Skip gate assessment.")] = False,
) -> None:
    """Apply approved evolution proposals (gated, BUG-09)."""
    from swarmx.config import SwarmConfig
    from swarmx.core.evolution_engine import apply_proposals, get_proposals
    from swarmx.policy import assess_action

    cfg = SwarmConfig()
    repo_path = repo.expanduser().resolve()
    _json = json_out or is_json_mode()

    proposals = [p for p in get_proposals(cfg.home) if p.get("status") == "approved"]
    if not proposals:
        if _json:
            emit_json({"applied": 0})
        else:
            safe_print("[muted]No approved proposals to apply.[/muted]")
        return

    # BUG-09: gate assessment before mutation
    if not force:
        try:
            gate = assess_action("evolve_apply", "apply proposals", repo_path, cfg)
            if not gate.get("allowed", True):
                msg = gate.get("reason", "Gate rejected apply action.")
                emit_error(msg, code=5)
                raise typer.Exit(code=5)
        except ImportError:
            pass

    try:
        result = apply_proposals(proposals=proposals, repo=repo_path, cfg=cfg)
    except Exception as exc:
        emit_error(f"Apply failed: {exc}", code=6)
        raise typer.Exit(code=6)

    if _json:
        emit_json({"applied": len(proposals), "result": result})
    else:
        safe_print(f"[success]Applied {len(proposals)} proposal(s).[/success]")


@app.command("layer")
def evolve_layer(
    repo: Annotated[Path, typer.Option("--repo", "-r", help="Repository root.")] = Path("."),
    cycles: Annotated[int, typer.Option("--cycles", help="Number of self-improving cycles.")] = 1,
    auto_deploy: Annotated[bool, typer.Option("--auto-deploy", help="Allow stage/deploy within the V6 overlay.")] = False,
    json_out: Annotated[bool, typer.Option("--json", help="JSON output.")] = False,
) -> None:
    """Run the V6 self-improving autonomous swarm layer."""
    from swarmx.config import SwarmConfig

    cfg = SwarmConfig()
    repo_path = repo.expanduser().resolve()
    _json = json_out or is_json_mode()
    from swarmx.evolution_layer.controller import run_cycle

    try:
        payload = run_cycle(repo=repo_path, cfg=cfg, cycles=max(1, cycles), auto_deploy=auto_deploy, dry_run=not auto_deploy)
    except Exception as exc:
        emit_error(f"V6 layer failed: {exc}", code=6)
        raise typer.Exit(code=6)

    if _json:
        emit_json(payload)
    else:
        safe_print(f"[success]V6 layer complete:[/success] {payload.get('layer', 'unknown')}")
