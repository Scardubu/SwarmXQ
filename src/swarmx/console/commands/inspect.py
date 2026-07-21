"""``swarm inspect`` — deep inspection of missions, memory, and graph."""
from __future__ import annotations

from typing import Annotated

import structlog
import typer

from swarmx.console.compat import is_json_mode
from swarmx.console.output import emit_json, get_console, kv_panel, make_table, safe_print

logger = structlog.get_logger("swarmx.console.commands.inspect")

app = typer.Typer(help="Inspect missions, memory, and agent state.")


@app.command("mission")
def inspect_mission(
    mission_id: Annotated[str, typer.Argument(help="Mission ID to inspect.")],
    json_out: Annotated[bool, typer.Option("--json", help="JSON output.")] = False,
) -> None:
    """Inspect a specific mission record."""
    from swarmx.config import SwarmConfig
    from swarmx.core.mission_manager import list_missions, mission_progress

    cfg = SwarmConfig()
    _json = json_out or is_json_mode()

    missions = list_missions(cfg.home, limit=200)
    match = next((m for m in missions if str(m.get("id", "")).startswith(mission_id)), None)

    if match is None:
        msg = f"Mission not found: {mission_id}"
        if _json:
            emit_json({"error": msg})
        else:
            safe_print(f"[error]{msg}[/error]")
        raise typer.Exit(code=1)

    if _json:
        emit_json(match)
        return

    c = get_console()
    progress = mission_progress(match)
    c.print(kv_panel({
        "id": match.get("id"),
        "target": match.get("target"),
        "status": match.get("status"),
        "progress": f"{progress:.0%}",
        "phases": len(match.get("phases", [])),
        "created_at": match.get("created_at"),
    }, title=f"Mission: {mission_id[:30]}"))


@app.command("memory")
def inspect_memory(
    query: Annotated[str, typer.Argument(help="Semantic query for memory retrieval.")] = "",
    limit: Annotated[int, typer.Option("--limit", "-n", help="Max results.")] = 5,
    json_out: Annotated[bool, typer.Option("--json", help="JSON output.")] = False,
) -> None:
    """Search swarm memory for relevant records."""
    from swarmx.config import SwarmConfig
    from swarmx.memory import load_recent_memories

    cfg = SwarmConfig()
    _json = json_out or is_json_mode()

    if query:
        # Semantic retrieval via vector store
        try:
            from core.memory.vector_store import get_vector_store  # type: ignore[import]
            vs_path = cfg.home / "state" / "vector_memory.db"
            results = get_vector_store(vs_path).retrieve(query, k=limit)
        except Exception:
            results = []

        if _json:
            emit_json(results)
            return
        if not results:
            safe_print("[muted]No matching memory records found.[/muted]")
            return
        c = get_console()
        t = make_table("Score", "Content", title="Memory Results")
        for r in results:
            t.add_row(
                f"{float(r.get('score', 0.0)):.3f}",
                str(r.get("content", r.get("text", str(r))))[:100],
            )
        c.print(t)
    else:
        memories = load_recent_memories(cfg.home, limit=limit)
        if _json:
            emit_json(memories)
            return
        c = get_console()
        t = make_table("Kind", "Summary", title="Recent Memory")
        for m in memories:
            t.add_row(str(m.get("kind", "?")), str(m.get("summary", str(m)))[:100])
        c.print(t)


@app.command("graph")
def inspect_graph(
    query: Annotated[str, typer.Argument(help="Search query for memory graph.")],
    limit: Annotated[int, typer.Option("--limit", "-n")] = 10,
    json_out: Annotated[bool, typer.Option("--json")] = False,
) -> None:
    """Search the memory graph."""
    from swarmx.config import SwarmConfig
    from swarmx.memory_graph import search_memory_graph

    cfg = SwarmConfig()
    _json = json_out or is_json_mode()

    try:
        results = search_memory_graph(cfg.home, query, limit=limit)
    except Exception as exc:
        if _json:
            emit_json({"error": str(exc)})
        else:
            safe_print(f"[error]Graph search failed: {exc}[/error]")
        raise typer.Exit(code=1)

    if _json:
        emit_json(results)
        return

    if not results:
        safe_print("[muted]No graph results found.[/muted]")
        return

    c = get_console()
    t = make_table("Node", "Type", "Summary", title="Memory Graph")
    for r in results:
        t.add_row(
            str(r.get("id", "?"))[:24],
            str(r.get("type", "?"))[:16],
            str(r.get("summary", str(r)))[:80],
        )
    c.print(t)
