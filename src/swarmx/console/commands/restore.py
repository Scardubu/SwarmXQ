"""``swarm restore`` — restore SwarmX runtime state from a backup.

Validates the backup manifest, checks compatibility, prompts for
confirmation before overwriting, then extracts files to SWARMX_HOME.
"""
from __future__ import annotations

import hashlib
import json
import logging
import shutil
import tarfile
from pathlib import Path
from typing import Annotated, Optional

import typer

from swarmx.console.output import get_console, safe_print, emit_json, emit_error
from swarmx.console.compat import is_json_mode

logger = logging.getLogger(__name__)

app = typer.Typer(
    help="Restore SwarmX state from a backup archive.",
    invoke_without_command=True,
    no_args_is_help=False,
)

_BACKUP_MANIFEST = "manifest.json"


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _latest_backup_path() -> Optional[Path]:
    from swarmx.config import SwarmConfig

    cfg = SwarmConfig()
    backup_root = cfg.home / "backups"
    if not backup_root.exists():
        return None

    entries = sorted(
        list(backup_root.glob("swarmx-backup-*.tar.gz"))
        + [path for path in backup_root.iterdir() if path.is_dir() and path.name.startswith("swarmx-backup-")],
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    return entries[0] if entries else None


@app.callback()
def restore_callback(
    ctx: typer.Context,
    latest: Annotated[bool, typer.Option("--latest", help="Restore the most recent backup.")] = False,
    yes: Annotated[bool, typer.Option("--yes", "-y", help="Skip confirmation prompt.")] = False,
    dry_run: Annotated[bool, typer.Option("--dry-run", help="Validate backup without restoring.")] = False,
    json_out: Annotated[bool, typer.Option("--json")] = False,
) -> None:
    """Allow ``swarm restore --latest`` without requiring the ``run`` subcommand."""
    if ctx.invoked_subcommand is not None:
        return
    if not latest:
        raise typer.Exit(code=0)

    backup_path = _latest_backup_path()
    if backup_path is None:
        emit_error("No backups found to restore.", code=1)
        raise typer.Exit(code=1)
    cmd_run(backup_path=backup_path, yes=yes, dry_run=dry_run, json_out=json_out)


@app.command("run")
def cmd_run(
    backup_path: Annotated[Path, typer.Argument(help="Path to backup .tar.gz or backup directory.")],
    yes: Annotated[bool, typer.Option("--yes", "-y", help="Skip confirmation prompt.")] = False,
    dry_run: Annotated[bool, typer.Option("--dry-run", help="Validate backup without restoring.")] = False,
    json_out: Annotated[bool, typer.Option("--json")] = False,
) -> None:
    """Restore a SwarmX backup to SWARMX_HOME."""
    from swarmx.config import SwarmConfig
    _json = json_out or is_json_mode()
    console = get_console()
    cfg = SwarmConfig()

    backup_path = Path(backup_path).expanduser().resolve()
    if not backup_path.exists():
        emit_error(f"Backup not found: {backup_path}", code=1)
        raise typer.Exit(code=1)

    # ── Extract if archive ────────────────────────────────────────────────────
    work_dir: Optional[Path] = None
    actual_dir: Path

    if backup_path.is_file() and backup_path.suffix in (".gz", ".tgz"):
        import tempfile
        tmp = tempfile.mkdtemp(prefix="swarmx-restore-")
        work_dir = Path(tmp)
        try:
            with tarfile.open(backup_path, "r:gz") as tar:
                # Security: check for path traversal before extracting
                _validate_tar_members(tar, work_dir)
                tar.extractall(path=work_dir, filter="data")
        except Exception as exc:
            shutil.rmtree(work_dir, ignore_errors=True)
            emit_error(f"Failed to extract backup: {exc}", code=1)
            raise typer.Exit(code=1)
        # The archive should contain a single top-level directory
        entries = list(work_dir.iterdir())
        if len(entries) != 1 or not entries[0].is_dir():
            shutil.rmtree(work_dir, ignore_errors=True)
            emit_error("Unexpected archive structure — expected single top-level directory.", code=1)
            raise typer.Exit(code=1)
        actual_dir = entries[0]
    elif backup_path.is_dir():
        actual_dir = backup_path
    else:
        emit_error(f"Unrecognised backup format: {backup_path}", code=1)
        raise typer.Exit(code=1)

    # ── Validate manifest ────────────────────────────────────────────────────
    manifest_path = actual_dir / _BACKUP_MANIFEST
    if not manifest_path.exists():
        _cleanup(work_dir)
        emit_error("Backup manifest (manifest.json) not found — invalid backup.", code=1)
        raise typer.Exit(code=1)

    try:
        manifest: dict[str, object] = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        _cleanup(work_dir)
        emit_error(f"Corrupt manifest: {exc}", code=1)
        raise typer.Exit(code=1)

    # ── Integrity check ───────────────────────────────────────────────────────
    files = manifest.get("files", [])
    integrity_ok = True
    for entry in files:  # type: ignore[union-attr]
        sha256 = entry.get("sha256")  # type: ignore[union-attr]
        dest_name = Path(str(entry.get("dest", ""))).name  # type: ignore[union-attr]
        local_path = actual_dir / dest_name
        if sha256 and local_path.exists():
            actual = _sha256(local_path)
            if actual != sha256:
                if not _json:
                    console.print(f"[warn]Checksum mismatch: {dest_name}[/warn]")
                integrity_ok = False

    if dry_run:
        result = {
            "valid": integrity_ok,
            "manifest": manifest,
            "backup_dir": str(actual_dir),
        }
        if _json:
            emit_json(result)
        else:
            console.print(f"[success]Dry-run:[/success] manifest valid={integrity_ok}  "
                          f"created_at={manifest.get('created_at')}  "
                          f"files={len(files)}")
        _cleanup(work_dir)
        return

    # ── Confirmation ──────────────────────────────────────────────────────────
    if not yes and not _json:
        console.print(f"[warn]This will overwrite files in: {cfg.home}[/warn]")
        console.print(f"[dim]Backup created: {manifest.get('created_at')}  files: {len(files)}[/dim]")
        confirmed = typer.confirm("Proceed with restore?", default=False)
        if not confirmed:
            console.print("[dim]Restore cancelled.[/dim]")
            _cleanup(work_dir)
            raise typer.Exit(code=0)

    # ── Restore files ────────────────────────────────────────────────────────
    cfg.home.mkdir(parents=True, exist_ok=True)
    restored: list[str] = []
    errors: list[str] = []

    for entry in files:  # type: ignore[union-attr]
        dest_name = Path(str(entry.get("dest", ""))).name  # type: ignore[union-attr]
        if not dest_name:
            continue
        src = actual_dir / dest_name
        if not src.exists():
            errors.append(f"Source file missing in backup: {dest_name}")
            continue
        target = cfg.home / dest_name
        try:
            shutil.copy2(src, target)
            restored.append(dest_name)
            if not _json:
                console.print(f"  [dim]✓[/dim] {dest_name}")
        except OSError as exc:
            errors.append(f"{dest_name}: {exc}")

    # ── Configs ────────────────────────────────────────────────────────────────
    cfg_backup = actual_dir / "configs"
    if cfg_backup.exists():
        cfg_dest = _repo_root() / "configs"
        cfg_dest.mkdir(exist_ok=True)
        for yaml_file in cfg_backup.glob("*.yaml"):
            try:
                shutil.copy2(yaml_file, cfg_dest / yaml_file.name)
                restored.append(f"config:{yaml_file.name}")
            except OSError as exc:
                errors.append(f"config:{yaml_file.name}: {exc}")

    _cleanup(work_dir)

    result_data = {
        "restored": len(restored),
        "errors": errors,
        "backup_created_at": manifest.get("created_at"),
    }
    if _json:
        emit_json(result_data)
    else:
        console.print(
            f"\n[success]Restore complete[/success]  "
            f"[dim]{len(restored)} files restored[/dim]"
        )
        if errors:
            console.print(f"[warn]{len(errors)} error(s):[/warn]")
            for err in errors:
                console.print(f"  [dim]{err}[/dim]")


def _validate_tar_members(tar: tarfile.TarFile, base_dir: Path) -> None:
    """Raise if any tar member would extract outside base_dir (path traversal guard)."""
    for member in tar.getmembers():
        member_path = (base_dir / member.name).resolve()
        if not str(member_path).startswith(str(base_dir.resolve())):
            raise ValueError(f"Path traversal attempt detected in archive: {member.name}")


def _cleanup(work_dir: Optional[Path]) -> None:
    if work_dir and work_dir.exists():
        shutil.rmtree(work_dir, ignore_errors=True)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()
