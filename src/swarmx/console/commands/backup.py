"""``swarm backup`` — create a backup of the SwarmX runtime state.

Backs up:
  - SQLite databases (mission history, skill scores, memory)
  - Audit log (JSONL)
  - Current configuration (YAML snapshots)

All backup artefacts are placed in a timestamped directory under
``SWARMX_HOME/backups/`` and optionally compressed into a ``.tar.gz``.
"""
from __future__ import annotations

import hashlib
import json
import logging
import shutil
import tarfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

import typer

from swarmx.console.output import get_console, safe_print, emit_json, emit_error
from swarmx.console.compat import is_json_mode

logger = logging.getLogger(__name__)

app = typer.Typer(
    help="Back up SwarmX runtime state (DB + audit log + config).",
    invoke_without_command=True,
    no_args_is_help=False,
)

_BACKUP_MANIFEST = "manifest.json"


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


@app.callback()
def backup_callback(
    ctx: typer.Context,
    list_backups: Annotated[bool, typer.Option("--list", help="List existing backups instead of creating a new one.")] = False,
    compress: Annotated[bool, typer.Option("--compress/--no-compress", help="Compress backup as .tar.gz.")] = True,
    tag: Annotated[str, typer.Option("--tag", "-t", help="Optional tag appended to backup directory name.")] = "",
    json_out: Annotated[bool, typer.Option("--json")] = False,
) -> None:
    """Default to backup creation when ``swarm backup`` is invoked without a subcommand."""
    if ctx.invoked_subcommand is not None:
        return
    if list_backups:
        cmd_list(json_out=json_out)
        return
    cmd_create(compress=compress, tag=tag, json_out=json_out)


@app.command("create")
def cmd_create(
    compress: Annotated[bool, typer.Option("--compress/--no-compress", help="Compress backup as .tar.gz.")] = True,
    tag: Annotated[str, typer.Option("--tag", "-t", help="Optional tag appended to backup directory name.")] = "",
    json_out: Annotated[bool, typer.Option("--json")] = False,
) -> None:
    """Create a full SwarmX backup to SWARMX_HOME/backups/."""
    from swarmx.config import SwarmConfig
    _json = json_out or is_json_mode()
    console = get_console()
    cfg = SwarmConfig()

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    dir_name = f"swarmx-backup-{ts}" + (f"-{tag}" if tag else "")
    backup_dir = cfg.home / "backups" / dir_name
    backup_dir.mkdir(parents=True, exist_ok=True)

    collected: list[dict[str, object]] = []
    errors: list[str] = []

    def _copy(src: Path, label: str) -> None:
        if not src.exists():
            logger.debug("Skipping %s — not found at %s", label, src)
            return
        dest = backup_dir / src.name
        try:
            shutil.copy2(src, dest)
            sha256 = _sha256(dest)
            collected.append({"label": label, "source": str(src), "dest": str(dest), "sha256": sha256})
            if not _json:
                console.print(f"  [dim]✓[/dim] {label}")
        except OSError as exc:
            errors.append(f"{label}: {exc}")
            if not _json:
                console.print(f"  [warn]⚠ {label}: {exc}[/warn]")

    if not _json:
        console.print(f"[brand]SwarmX[/brand] backup → [highlight]{backup_dir}[/highlight]")

    # ── SQLite databases ──────────────────────────────────────────────────────
    for db_name in ("swarmx.db", "missions.db", "memory.db", "skills.db"):
        _copy(cfg.home / db_name, f"db:{db_name}")

    # ── Audit log ────────────────────────────────────────────────────────────
    _copy(cfg.home / "audit.jsonl", "audit-log")

    # ── Config snapshots ─────────────────────────────────────────────────────
    config_dir = _repo_root() / "configs"
    if config_dir.exists():
        cfg_dest = backup_dir / "configs"
        cfg_dest.mkdir(exist_ok=True)
        for yaml_file in config_dir.glob("*.yaml"):
            try:
                shutil.copy2(yaml_file, cfg_dest / yaml_file.name)
                collected.append({"label": f"config:{yaml_file.name}", "source": str(yaml_file)})
            except OSError as exc:
                errors.append(f"config:{yaml_file.name}: {exc}")

    # ── Write manifest ────────────────────────────────────────────────────────
    manifest = {
        "version": 1,
        "created_at": ts,
        "tag": tag,
        "swarmx_home": str(cfg.home),
        "files": collected,
        "errors": errors,
    }
    (backup_dir / _BACKUP_MANIFEST).write_text(
        json.dumps(manifest, indent=2, default=str), encoding="utf-8"
    )

    # ── Optional compression ──────────────────────────────────────────────────
    archive_path: Path | None = None
    if compress:
        archive_path = backup_dir.parent / f"{dir_name}.tar.gz"
        try:
            with tarfile.open(archive_path, "w:gz") as tar:
                tar.add(backup_dir, arcname=dir_name)
            shutil.rmtree(backup_dir)
            if not _json:
                console.print(f"[success]Compressed:[/success] {archive_path}")
        except Exception as exc:
            emit_error(f"Compression failed: {exc}", code=0)
            archive_path = None  # fall back to uncompressed dir

    result = {
        "backup": str(archive_path or backup_dir),
        "files_copied": len(collected),
        "errors": errors,
        "timestamp": ts,
    }

    if _json:
        emit_json(result)
    else:
        _display_summary(result, console)


def _display_summary(result: dict[str, object], console: object) -> None:  # type: ignore[type-arg]
    from rich.console import Console
    assert isinstance(console, Console)
    console.print(
        f"\n[success]Backup complete[/success]  "
        f"[dim]{result['files_copied']} files → {result['backup']}[/dim]"
    )
    if result["errors"]:
        console.print(f"[warn]{len(result['errors'])} warning(s):[/warn]")
        for err in result["errors"]:  # type: ignore[union-attr]
            console.print(f"  [dim]{err}[/dim]")


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


@app.command("list")
def cmd_list(
    json_out: Annotated[bool, typer.Option("--json")] = False,
) -> None:
    """List available backups in SWARMX_HOME/backups/."""
    from swarmx.config import SwarmConfig
    _json = json_out or is_json_mode()
    cfg = SwarmConfig()
    backup_root = cfg.home / "backups"

    backups: list[dict[str, object]] = []
    if backup_root.exists():
        # Detect both .tar.gz archives and uncompressed directories
        entries = sorted(
            list(backup_root.glob("swarmx-backup-*.tar.gz"))
            + [d for d in backup_root.iterdir() if d.is_dir() and d.name.startswith("swarmx-backup-")],
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        for entry in entries:
            size = entry.stat().st_size if entry.is_file() else sum(f.stat().st_size for f in entry.rglob("*") if f.is_file())
            backups.append({
                "name": entry.name,
                "path": str(entry),
                "size_bytes": size,
                "compressed": entry.suffix == ".gz",
            })

    if _json:
        emit_json({"backups": backups})
    else:
        if not backups:
            safe_print("[dim]No backups found.[/dim]")
            return
        from rich.table import Table
        console = get_console()
        tbl = Table(show_header=True, header_style="text.muted", box=None, padding=(0, 2))
        tbl.add_column("Backup", style="text.secondary")
        tbl.add_column("Size", justify="right", style="dim")
        tbl.add_column("Type", style="dim")
        for b in backups:
            size_kb = int(b["size_bytes"]) // 1024  # type: ignore[arg-type]
            tbl.add_row(b["name"], f"{size_kb} KB", "archive" if b["compressed"] else "dir")
        console.print(tbl)
