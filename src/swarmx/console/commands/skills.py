"""``swarm skills`` — skill library browsing, search, and APEX-17 delta history.

Subcommands:
  list          — list all skills (filterable by stack)
  search        — fuzzy search by name/purpose/trigger
  show          — full detail for one skill
  triggers      — show all trigger keywords for a skill or across all APEX-17 skills  [APEX-17]
  delta-history — show recent evolution delta records from the memory store           [APEX-17]
"""
from __future__ import annotations

import logging
from typing import Annotated

import typer

from swarmx.console.compat import is_json_mode
from swarmx.console.output import emit_json, get_console, make_table, safe_print

logger = logging.getLogger(__name__)

app = typer.Typer(help="Browse and search the SwarmX skill library.")

# ── APEX-17 skill names for display ──────────────────────────────────────────
_APEX17_SKILLS = {
    "code-diagnose", "tdd-discipline", "grill-with-docs", "architecture-improve",
    "improve-codebase-architecture", "grill-me", "zoom-out", "debugging-strategies",
    "dynamic-team-factory", "multi-agent-orchestrator", "delta-evolution",
    "security-auditor", "requirements-pipeline",
}


# ── list ──────────────────────────────────────────────────────────────────────

@app.command("list")
def skills_list(
    stack: Annotated[str | None, typer.Option("--stack", "-s", help="Filter by stack (frontend/backend/security/devops/generic).")] = None,
    apex17: Annotated[bool, typer.Option("--apex17", help="Show only the 13 APEX-17 skills.")] = False,
    json_out: Annotated[bool, typer.Option("--json", help="JSON output.")] = False,
) -> None:
    """List all available skills."""
    from swarmx.core.skill_manager import list_skills, skill_to_dict

    skills = list_skills()

    if stack:
        skills = [s for s in skills if stack.lower() in [t.lower() for t in s.stack]]
    if apex17:
        skills = [s for s in skills if s.name in _APEX17_SKILLS]

    _json = json_out or is_json_mode()
    if _json:
        emit_json([skill_to_dict(s) for s in skills])
        return

    c = get_console()
    t = make_table("Name", "Owner", "Stack", "W", "Rating", title="Skill Library")
    for s in skills:
        apex_tag = " [skill.triggered]★[/skill.triggered]" if s.name in _APEX17_SKILLS else ""
        t.add_row(
            f"{s.name}{apex_tag}",
            s.owner,
            ", ".join(s.stack),
            str(s.weight),
            f"{s.rating:.1f}",
        )
    c.print(t)
    safe_print(
        f"\n[muted]{len(skills)} skill(s) total."
        f"  [skill.triggered]★[/skill.triggered] = APEX-17 skill[/muted]"
    )


# ── search ────────────────────────────────────────────────────────────────────

@app.command("search")
def skills_search(
    query: Annotated[str, typer.Argument(help="Search query.")],
    json_out: Annotated[bool, typer.Option("--json", help="JSON output.")] = False,
) -> None:
    """Search for skills by name, purpose, or trigger keyword."""
    from swarmx.core.skill_manager import search_skills, skill_to_dict

    results = search_skills(query)
    _json = json_out or is_json_mode()

    if _json:
        emit_json([skill_to_dict(s) for s in results])
        return

    if not results:
        safe_print(f"[muted]No skills match '{query}'.[/muted]")
        return

    c = get_console()
    t = make_table("Name", "Purpose", "Triggers", title=f"Skills matching '{query}'")
    for s in results:
        apex_tag = " [skill.triggered]★[/skill.triggered]" if s.name in _APEX17_SKILLS else ""
        t.add_row(
            f"{s.name}{apex_tag}",
            s.purpose[:60],
            ", ".join(s.triggers[:4]),
        )
    c.print(t)


# ── show ──────────────────────────────────────────────────────────────────────

@app.command("show")
def skills_show(
    name: Annotated[str, typer.Argument(help="Skill name.")],
    json_out: Annotated[bool, typer.Option("--json")] = False,
) -> None:
    """Show full details for a specific skill."""
    from swarmx.core.skill_manager import get_skill, skill_to_dict

    skill = get_skill(name)
    if skill is None:
        msg = f"Skill not found: {name}"
        if is_json_mode() or json_out:
            emit_json({"error": msg})
        else:
            safe_print(f"[error]{msg}[/error]")
        raise typer.Exit(code=1)

    if is_json_mode() or json_out:
        emit_json(skill_to_dict(skill))
        return

    from swarmx.console.output import kv_panel
    c = get_console()
    d = skill_to_dict(skill)
    # Render triggers as readable string
    if isinstance(d.get("triggers"), list):
        d["triggers"] = ", ".join(d["triggers"])
    if isinstance(d.get("stack"), list):
        d["stack"] = ", ".join(d["stack"])
    apex_note = "  [skill.triggered]★ APEX-17 skill[/skill.triggered]" if skill.name in _APEX17_SKILLS else ""
    c.print(kv_panel(d, title=f"Skill: {skill.name}{apex_note}"))


# ── triggers [APEX-17] ────────────────────────────────────────────────────────

@app.command("triggers")
def skills_triggers(
    name: Annotated[str | None, typer.Argument(help="Skill name. Omit to list all APEX-17 trigger keywords.")] = None,
    json_out: Annotated[bool, typer.Option("--json")] = False,
) -> None:
    """Show trigger keywords for a skill or all APEX-17 skills.

    APEX-17: Trigger keywords are the phrases that activate skill routing
    from the mission planner. Use this to understand what target text will
    invoke which skill.
    """
    from swarmx.core.skill_manager import get_skill, list_skills

    _json = json_out or is_json_mode()

    if name:
        # Single skill lookup
        skill = get_skill(name)
        if skill is None:
            msg = f"Skill not found: {name}"
            emit_json({"error": msg}) if _json else safe_print(f"[error]{msg}[/error]")
            raise typer.Exit(code=1)
        if _json:
            emit_json({"name": skill.name, "triggers": skill.triggers})
            return
        c = get_console()
        c.print(f"\n[skill.active]{skill.name}[/skill.active]  [muted](owner={skill.owner} weight={skill.weight})[/muted]")
        c.print(f"[dim]Purpose:[/dim] {skill.purpose}\n")
        c.print("[highlight]Trigger keywords:[/highlight]")
        for trigger in skill.triggers:
            c.print(f"  [skill.triggered]{trigger}[/skill.triggered]")
        return

    # All APEX-17 skills
    all_skills = list_skills()
    apex_skills = [s for s in all_skills if s.name in _APEX17_SKILLS]
    apex_skills.sort(key=lambda s: (-s.weight, s.name))

    if _json:
        emit_json([{"name": s.name, "triggers": s.triggers, "weight": s.weight} for s in apex_skills])
        return

    c = get_console()
    t = make_table(
        "Skill", "Weight", "Top Trigger Keywords",
        title="APEX-17 Skill Trigger Map",
        caption="★ = APEX-17 | Keywords that activate skill routing from the mission planner",
    )
    for s in apex_skills:
        top_triggers = ", ".join(s.triggers[:5])
        remainder = len(s.triggers) - 5
        more = f" +{remainder}" if remainder > 0 else ""
        t.add_row(
            f"[skill.active]{s.name}[/skill.active]",
            str(s.weight),
            f"{top_triggers}[muted]{more}[/muted]",
        )
    c.print(t)
    safe_print(f"\n[muted]{len(apex_skills)} APEX-17 skills  |  run [highlight]swarm skills triggers <name>[/highlight] for full keyword list[/muted]")


# ── delta-history [APEX-17] ───────────────────────────────────────────────────

@app.command("delta-history")
def skills_delta_history(
    limit: Annotated[int, typer.Option("--limit", "-n", help="Number of records to show.")] = 10,
    json_out: Annotated[bool, typer.Option("--json")] = False,
) -> None:
    """Show recent evolution delta records from the fitness memory store.

    APEX-17: Every ``swarm evolve`` run calls delta_capture() which writes a
    fitness snapshot to SWARMX_HOME. This command surfaces those records so
    you can track whether the swarm's composite fitness score is improving,
    which skills were triggered, and what action was taken (promote / hold).

    Green Δ = fitness improved since prior run.
    Red Δ   = fitness regressed — check rollback_candidate field.
    """
    from swarmx.config import SwarmConfig
    _json = json_out or is_json_mode()

    try:
        from swarmx.core.evolution_engine import get_delta_history
        cfg = SwarmConfig()
        records = get_delta_history(cfg.home, limit=limit)
    except Exception as exc:
        logger.debug("delta-history: %s", exc)
        records = []

    if not records:
        msg = "No evolution delta records found. Run `swarm evolve` to generate one."
        if _json:
            emit_json({"records": [], "message": msg})
        else:
            safe_print(f"[muted]{msg}[/muted]")
        return

    if _json:
        emit_json({"records": records})
        return

    c = get_console()
    t = make_table(
        "ID", "Timestamp", "Composite", "Fitness Δ", "Action", "Triggered Skills",
        title=f"Evolution Delta History  (last {len(records)})",
        caption="Run `swarm evolve` to add a new record | green = improved · red = regressed",
        show_lines=True,
    )
    for rec in records:
        delta_f = float(rec.get("delta_fitness", 0.0))
        composite = float(rec.get("composite_score", 0.0))
        action = str(rec.get("delta_action", "—"))
        triggered = ", ".join(rec.get("triggered_skills", [])) or "none"
        ts = str(rec.get("timestamp", ""))[:19].replace("T", " ")
        delta_id = str(rec.get("id", "—"))

        # Style delta fitness
        delta_str = f"{delta_f:+.4f}"
        if delta_f > 0:
            delta_styled = f"[delta.promote]{delta_str}[/delta.promote]"
        elif delta_f < -0.005:
            delta_styled = f"[error]{delta_str}[/error]"
        else:
            delta_styled = f"[delta.hold]{delta_str}[/delta.hold]"

        # Style action
        action_styled = (
            f"[delta.promote]{action}[/delta.promote]" if action == "promote"
            else f"[delta.hold]{action}[/delta.hold]"
        )
        # Style composite
        comp_style = "success" if composite >= 0.72 else "warning" if composite >= 0.5 else "error"
        composite_styled = f"[{comp_style}]{composite:.3f}[/{comp_style}]"

        t.add_row(
            f"[muted]{delta_id[-12:]}[/muted]",
            f"[muted]{ts}[/muted]",
            composite_styled,
            delta_styled,
            action_styled,
            f"[skill.triggered]{triggered}[/skill.triggered]",
        )

    c.print(t)

    # Footer: trend summary
    if len(records) >= 2:
        first = float(records[-1].get("composite_score", 0.0))
        last = float(records[0].get("composite_score", 0.0))
        trend = last - first
        trend_style = "delta.promote" if trend > 0 else "delta.hold" if trend >= -0.01 else "error"
        safe_print(
            f"\n[muted]Trend over {len(records)} runs:[/muted] "
            f"[{trend_style}]{trend:+.4f}[/{trend_style}]  "
            f"[muted]({first:.3f} → {last:.3f})[/muted]"
        )
