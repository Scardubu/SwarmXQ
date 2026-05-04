from __future__ import annotations

import hashlib
import json
import platform
import shutil
import subprocess
from pathlib import Path
from typing import Any


def which(cmd: str) -> str | None:
    return shutil.which(cmd)


def cmd_exists(cmd: str) -> bool:
    return which(cmd) is not None


def run_cmd(args: list[str], cwd: str | None = None, timeout: int = 300) -> tuple[int, str, str]:
    try:
        proc = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout, check=False)
        return proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout if isinstance(exc.stdout, str) else ""
        stderr = exc.stderr if isinstance(exc.stderr, str) else ""
        message = f"Command timed out after {timeout}s: {' '.join(args)}"
        if stderr:
            message = stderr.rstrip() + "\n" + message
        return 124, stdout, message
    except Exception as exc:  # defensive: keep the control plane alive
        return 1, "", f"{type(exc).__name__}: {exc}"


def read_text(path: str | Path, default: str = "") -> str:
    try:
        return Path(path).read_text(encoding="utf-8")
    except FileNotFoundError:
        return default


def write_text(path: str | Path, content: str) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")


def write_json(path: str | Path, payload: Any) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def read_json(path: str | Path, default: Any) -> Any:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def load_yaml(path: str | Path, default: Any = None) -> Any:
    try:
        import yaml
        return yaml.safe_load(Path(path).read_text(encoding="utf-8")) or default
    except FileNotFoundError:
        return default
    except Exception:
        return default


def dump_yaml(path: str | Path, payload: Any) -> None:
    import yaml
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(yaml.safe_dump(payload, sort_keys=False), encoding="utf-8")


def platform_summary() -> dict[str, str]:
    return {
        "system": platform.system(),
        "release": platform.release(),
        "machine": platform.machine(),
        "python": platform.python_version(),
    }


def hash_file(path: str | Path) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as fh:
        for chunk in iter(lambda: fh.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def slugify(text: str, limit: int = 64) -> str:
    out = []
    dash = False
    for ch in text.lower():
        if ch.isalnum():
            out.append(ch)
            dash = False
        else:
            if not dash:
                out.append("-")
                dash = True
    slug = "".join(out).strip("-")
    return slug[:limit] or "item"
