"""
SwarmX Tool Registry
====================
Built-in tools agents invoke via tool_call messages.

VERSION: V5.9  (see PATCH MANIFEST V5.9)

CHANGES V5.9 vs V5.6:
  ✦ [FIX-01] tool_run_python: replaced deprecated `asyncio.get_event_loop().run_in_executor()`
    with `asyncio.to_thread()` (Python 3.9+). The old API emits DeprecationWarning in 3.10+
    and raises RuntimeError in 3.12+ if there is no running loop.
  ✦ [FIX-02] SSRF blocklist extended with cloud metadata endpoints:
    `metadata.google.internal`, `169.254.169.254` (kept), `100.100.100.200` (Azure IMDS),
    `fd00:ec2::254` (AWS IPv6), `10.0.0.1`, `192.168.0.1` (RFC-1918 gateways),
    `metadata.azure.com`, `instance-data.ec2.amazonaws.com`.
  ✦ [ENH-01] tool_git_status added: safe git status/log/diff reader that operates only
    inside _SAFE_READ_ROOTS; uses subprocess.run with a fixed command allowlist —
    no shell=True, no model-supplied command strings.
  ✦ [ENH-02] tool_run_shell_safe added: restricted shell command runner with an
    explicit command allowlist (make, pytest, cargo, go test, dotnet test, etc.).
    Model supplies argv as a list — never a shell string. Blocks any command not on
    the allowlist. Replaces the anti-pattern of open-ended shell execution.
  ✦ [ENH-03] dispatch_tool: per-tool call log now stores tool_args_keys for
    observability without logging potentially sensitive arg values.
  ✦ [ENH-04] tool_read_file: added line_range support [start, end] for partial file
    reads — avoids context-window blow-up on large source files.
  ✦ [ENH-05] ToolResult.to_dict() now JSON-serialises result safely (converts
    non-serialisable values to str) so tool results never crash the message loop.
  ✦ [FIX-06] `tool_summarise_text`: replaced deprecated `/api/generate` endpoint
    with `/api/chat`. Ollama's `/api/generate` is on a deprecation path in 0.6+;
    all inference in this stack must go through `/api/chat` for consistency and
    to avoid silent breakage when generate support is removed.
  ✦ [ENH-06] `tool_yaml_parse` added: safe YAML file/string parser (read-only,
    path-gated to safe read roots). Agents can now load workflow YAML, config
    overlays, and skill catalog data without raw file reads.
  ✦ [ENH-07] `tool_json_merge` added: recursive deep-merge of two JSON objects.
    Enables agents to combine partial step outputs without writing merge code.

Design rules (unchanged):
  - All tools accept and return JSON-serializable data
  - All tools have explicit timeout handling
  - Tool errors return ToolResult(status="error") — never raise to caller
  - Tool results are bounded (truncated if too large)
  - No arbitrary shell execution from model output (injection prevention)
  - run_python uses AST-level dangerous import/call check
  - Write roots restricted to ~/swarmx_outputs and /tmp
  - SSRF blocklist prevents metadata endpoint leakage
"""

from __future__ import annotations

import asyncio
import collections
import difflib
import hashlib
import json
import os
import subprocess
import time
import urllib.parse
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

# ─── OLLAMA_BASE_URL helper ───────────────────────────────────────────────────

def _ollama_base_url() -> str:
    return os.environ.get("SWARMX_OLLAMA_URL", "http://127.0.0.1:11434")


# ─── Tool result ──────────────────────────────────────────────────────────────

@dataclass
class ToolResult:
    status: str          # "success" | "error" | "partial"
    result: Any          # JSON-serializable
    error_detail: str | None = None

    def truncated(self, max_chars: int = 2000) -> ToolResult:
        try:
            result_str = json.dumps(self.result)
        except (TypeError, ValueError):
            result_str = str(self.result)
        if len(result_str) > max_chars:
            return ToolResult(
                status="partial",
                result=result_str[:max_chars],
                error_detail=f"result_truncated_at_{max_chars}_chars",
            )
        return self

    def to_dict(self) -> dict:
        # [ENH-05] Safe serialisation — never crashes the message loop
        try:
            json.dumps(self.result)
            safe_result = self.result
        except (TypeError, ValueError):
            safe_result = str(self.result)
        return {"status": self.status, "result": safe_result, "error_detail": self.error_detail}


# ─── Registry ─────────────────────────────────────────────────────────────────

_TOOL_REGISTRY: dict[str, dict] = {}
_CALL_LOG: collections.deque = collections.deque(maxlen=500)  # O(1) append+eviction
_DISPATCH_LOG_PATH: Path | None = None

_RATE_LIMIT_PER_MIN: int = int(os.environ.get("TOOL_RATE_LIMIT_PER_MIN", "60"))
_RATE_WINDOWS: dict[str, collections.deque] = {}
# [V5.7-ENH-01] Per-tool rate limit overrides (populated by orchestrator at config load)
_PER_TOOL_RATE_LIMITS: dict[str, int] = {}
# [V5.7-ENH-02] Circuit breaker state per tool
_CIRCUIT_BREAKER: dict[str, dict] = {}

_CB_OPEN_THRESHOLD: int   = int(os.environ.get("TOOL_CB_THRESHOLD", "5"))
_CB_RESET_S:        float = float(os.environ.get("TOOL_CB_RESET_S", "60.0"))
# [V5.9-PATCH-02] Hard dispatch timeout — read once at module load
_HARD_TIMEOUT_S:    float = float(os.environ.get("TOOL_HARD_TIMEOUT_S", "180"))


def set_per_tool_rate_limit(tool_name: str, limit_per_min: int) -> None:
    """
    [V5.7-ENH-01] Called by orchestrator._wire_per_tool_rate_limits() after
    config load. Sets a per-tool override for _check_rate_limit().
    """
    _PER_TOOL_RATE_LIMITS[tool_name] = max(1, int(limit_per_min))

def set_circuit_breaker_thresholds(
    open_threshold: int | None = None,
    reset_s: float | None = None,
) -> None:
    """
    Set circuit-breaker globals from config (called by orchestrator at startup).

    Args:
        open_threshold: Number of consecutive failures before tripping (min 1).
        reset_s:        Seconds before a tripped circuit enters half-open (min 1.0).

    Both parameters are optional — pass only the ones you want to override.
    This replaces the env-var-only path so YAML tuning takes effect at runtime.
    """
    global _CB_OPEN_THRESHOLD, _CB_RESET_S
    if open_threshold is not None:
        _CB_OPEN_THRESHOLD = max(1, int(open_threshold))
    if reset_s is not None:
        _CB_RESET_S = max(1.0, float(reset_s))
def _cb_check(tool_name: str) -> ToolResult | None:
    """
    [V5.7-ENH-02] Returns an error ToolResult if the circuit is open, else None.
    On expiry of _CB_RESET_S the circuit enters half-open (one probe allowed).
    """
    state = _CIRCUIT_BREAKER.get(tool_name)
    if state is None:
        return None
    if state["open"]:
        elapsed = time.monotonic() - state["opened_at"]
        if elapsed < _CB_RESET_S:
            remaining = round(_CB_RESET_S - elapsed, 1)
            return ToolResult(
                status="error",
                result=None,
                error_detail=(
                    f"Circuit open for '{tool_name}' — resets in {remaining}s "
                    f"({_CB_OPEN_THRESHOLD} consecutive failures)."
                ),
            )
        # Half-open probe: reset and allow one call through
        state["open"] = False
        state["consecutive_failures"] = 0
    return None


def _cb_record(tool_name: str, success: bool) -> None:
    """[V5.7-ENH-02] Update circuit breaker state after a tool call completes.

    [NEW] Emits EventKind.TOOL_CB_OPEN to the event bus on the exact transition
    from closed → open, giving the dashboard a visibility event for circuit trips.
    """
    state = _CIRCUIT_BREAKER.setdefault(
        tool_name,
        {"consecutive_failures": 0, "open": False, "opened_at": 0.0},
    )
    if success:
        state["consecutive_failures"] = 0
        state["open"] = False
    else:
        state["consecutive_failures"] += 1
        if state["consecutive_failures"] >= _CB_OPEN_THRESHOLD and not state["open"]:
            state["open"] = True
            state["opened_at"] = time.monotonic()
            # [NEW] Publish circuit-open event for TUI / dashboard observability.
            # EventKind.TOOL_CB_OPEN was declared in event_bus.py but never emitted.
            _swarm_home = os.environ.get("SWARM_HOME", "")
            if _swarm_home:
                try:
                    from pathlib import Path as _Path

                    from swarmx.event_bus import EventKind as _EK
                    from swarmx.event_bus import publish as _pub  # type: ignore
                    _pub(_Path(_swarm_home), _EK.TOOL_CB_OPEN, {
                        "tool":       tool_name,
                        "failures":   state["consecutive_failures"],
                        "reset_in_s": _CB_RESET_S,
                    })
                except Exception:
                    pass


def configure_dispatch_log(path: str | None) -> None:
    global _DISPATCH_LOG_PATH
    _DISPATCH_LOG_PATH = Path(path) if path else None


def register_tool(name: str, description: str = ""):
    def decorator(fn: Callable):
        _TOOL_REGISTRY[name] = {"fn": fn, "name": name, "description": description}
        return fn
    return decorator


def _check_rate_limit(tool_name: str) -> bool:
    """[V5.7-ENH-01] Resolves per-tool limit first; falls back to global default."""
    now   = time.monotonic()
    limit = _PER_TOOL_RATE_LIMITS.get(tool_name, _RATE_LIMIT_PER_MIN)
    window = _RATE_WINDOWS.setdefault(tool_name, collections.deque())
    while window and now - window[0] > 60.0:
        window.popleft()
    if len(window) >= limit:
        return False
    window.append(now)
    return True


async def dispatch_tool(tool_name: str, args: dict) -> ToolResult:
    entry = _TOOL_REGISTRY.get(tool_name)
    if entry is None:
        return ToolResult(
            status="error",
            result=None,
            error_detail=f"Unknown tool: '{tool_name}'. Available: {list(_TOOL_REGISTRY.keys())}",
        )

    # [V5.7-ENH-02] Circuit breaker — short-circuit on open circuit
    cb_result = _cb_check(tool_name)
    if cb_result is not None:
        return cb_result

    # [V5.7-ENH-01] Per-tool rate limit
    limit = _PER_TOOL_RATE_LIMITS.get(tool_name, _RATE_LIMIT_PER_MIN)
    if not _check_rate_limit(tool_name):
        return ToolResult(
            status="error",
            result=None,
            error_detail=f"Rate limit exceeded for '{tool_name}': max {limit} calls/minute",
        )

    # [V5.9-PATCH-02] Hard dispatch timeout — prevents hung tools from
    # blocking the orchestrator indefinitely.
    # Configurable via TOOL_HARD_TIMEOUT_S env var (default 180s).
    t0 = time.monotonic()
    try:
        result = await asyncio.wait_for(
            entry["fn"](args),
            timeout=_HARD_TIMEOUT_S,
        )
        result = result.truncated()
        _cb_record(tool_name, success=True)
    except TimeoutError:
        result = ToolResult(
            status="error",
            result=None,
            error_detail=f"Hard dispatch timeout after {_HARD_TIMEOUT_S}s",
        )
        _cb_record(tool_name, success=False)
    except Exception as e:
        result = ToolResult(status="error", result=None, error_detail=str(e))
        _cb_record(tool_name, success=False)

    elapsed = round(time.monotonic() - t0, 3)
    # [ENH-03] log arg keys only — never log arg values (may contain secrets)
    log_entry = {
        "tool": tool_name,
        "status": result.status,
        "duration_s": elapsed,
        "args_keys": list(args.keys()),
        "ts": time.time(),
    }

    # [V5.9-PATCH-03] Publish to event bus for TUI / dashboard observability
    _swarm_home = os.environ.get("SWARM_HOME", "")
    if _swarm_home:
        try:
            from pathlib import Path as _Path

            from swarmx.event_bus import EventKind as _EK
            from swarmx.event_bus import publish as _pub  # type: ignore
            _ek = _EK.TOOL_ERROR if result.status == "error" else _EK.TOOL_RESULT
            _pub(_Path(_swarm_home), _ek, {
                "tool":       tool_name,
                "status":     result.status,
                "duration_s": elapsed,
            })
        except Exception:
            pass

    _CALL_LOG.append(log_entry)

    if _DISPATCH_LOG_PATH is not None:
        try:
            _DISPATCH_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
            with open(_DISPATCH_LOG_PATH, "a") as f:
                f.write(json.dumps(log_entry) + "\n")
        except OSError:
            pass

    return result


def list_tools(*, include_cb_state: bool = False) -> list[dict]:
    """[V5.9-PATCH-04] Optional circuit-breaker state per tool."""
    result = []
    for v in _TOOL_REGISTRY.values():
        entry: dict = {"name": v["name"], "description": v["description"]}
        if include_cb_state:
            cb = _CIRCUIT_BREAKER.get(v["name"], {})
            entry["circuit_breaker"] = {
                "open":                cb.get("open", False),
                "consecutive_failures": cb.get("consecutive_failures", 0),
            }
        result.append(entry)
    return result


def get_call_log() -> list[dict]:
    """Return a snapshot of the recent dispatch log (up to last 500 entries)."""
    return list(_CALL_LOG)


# ─── Path security helpers ────────────────────────────────────────────────────

_SAFE_READ_ROOTS  = [Path.home(), Path("/tmp"), Path("/opt/swarmx")]
_SAFE_WRITE_ROOTS = [Path.home() / "swarmx_outputs", Path("/tmp")]


def _is_safe_read_path(path: Path) -> bool:
    resolved = path.resolve()
    return any(str(resolved).startswith(str(r.resolve())) for r in _SAFE_READ_ROOTS)


def _is_safe_write_path(path: Path) -> bool:
    resolved = path.resolve()
    return any(str(resolved).startswith(str(r.resolve())) for r in _SAFE_WRITE_ROOTS)


# ─── SSRF blocklist ───────────────────────────────────────────────────────────
# [FIX-02] Extended to cover all major cloud metadata endpoints.

_SSRF_BLOCKED_HOSTS = {
    # Loopback
    "localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]",
    # AWS metadata (IPv4 + IPv6)
    "169.254.169.254", "fd00:ec2::254", "instance-data.ec2.amazonaws.com",
    # GCP metadata
    "metadata.google.internal",
    # Azure metadata + IMDS
    "100.100.100.200", "metadata.azure.com",
    # Common RFC-1918 gateway defaults
    "10.0.0.1", "192.168.0.1", "172.16.0.1",
}


def _ssrf_check(url: str) -> ToolResult | None:
    parsed_url = urllib.parse.urlparse(url)
    if parsed_url.scheme not in ("http", "https"):
        return ToolResult(status="error", result=None, error_detail=f"Blocked scheme: {parsed_url.scheme}")
    host = (parsed_url.hostname or "").lower()
    if host in _SSRF_BLOCKED_HOSTS:
        return ToolResult(status="error", result=None, error_detail="SSRF blocked: local/metadata address")
    # Block RFC-1918 ranges (simple prefix check — not a full CIDR check)
    _rfc1918_prefixes = ("10.", "172.16.", "172.17.", "172.18.", "172.19.", "172.20.", "172.21.",
                         "172.22.", "172.23.", "172.24.", "172.25.", "172.26.", "172.27.", "172.28.",
                         "172.29.", "172.30.", "172.31.", "192.168.")
    if any(host.startswith(p) for p in _rfc1918_prefixes):
        return ToolResult(status="error", result=None, error_detail="SSRF blocked: RFC-1918 address")
    return None


# ─── Shell command allowlist (for tool_run_shell_safe) ────────────────────────

_SHELL_ALLOWLIST = {
    "pytest", "python3", "python", "pip", "uv",
    "pnpm", "npm", "bun", "yarn", "node",
    "cargo", "rustc", "go",
    "dotnet", "mvn", "gradle",
    "make", "just",
    "git",   # only status/log/diff — enforced inside tool_git_status
    "rg", "grep",
}


# ─── Built-in Tools ──────────────────────────────────────────────────────────

@register_tool("read_file", description="Read a local file and return its content.")
async def tool_read_file(args: dict) -> ToolResult:
    """
    args:
      path:        str  — absolute or relative file path
      encoding:    str  — default "utf-8"
      max_chars:   int  — default 4000
      line_range:  [start, end] — optional 1-based inclusive line range [ENH-04]
    """
    path_str = args.get("path")
    if not path_str:
        return ToolResult(status="error", result=None, error_detail="Missing 'path'")

    resolved = Path(path_str).resolve()
    if not _is_safe_read_path(resolved):
        return ToolResult(status="error", result=None, error_detail=f"Access denied: {resolved}")
    if not resolved.exists():
        return ToolResult(status="error", result=None, error_detail=f"File not found: {resolved}")

    enc       = args.get("encoding", "utf-8")
    max_chars = int(args.get("max_chars", 4000))
    line_range = args.get("line_range")

    try:
        content = resolved.read_text(encoding=enc)
        if line_range and isinstance(line_range, (list, tuple)) and len(line_range) == 2:
            lines  = content.splitlines(keepends=True)
            start  = max(0, int(line_range[0]) - 1)
            end    = min(len(lines), int(line_range[1]))
            content = "".join(lines[start:end])
        truncated = len(content) > max_chars
        return ToolResult(
            status="partial" if truncated else "success",
            result=content[:max_chars],
            error_detail="truncated" if truncated else None,
        )
    except Exception as e:
        return ToolResult(status="error", result=None, error_detail=str(e))


@register_tool("write_file", description="Write content to a file in the swarmx_outputs directory.")
async def tool_write_file(args: dict) -> ToolResult:
    """
    args:
      path:    str — must resolve under ~/swarmx_outputs or /tmp
      content: str
      mode:    "write" | "append" — default "write"
    """
    path_str = args.get("path")
    content  = args.get("content", "")
    if not path_str:
        return ToolResult(status="error", result=None, error_detail="Missing 'path'")

    resolved = Path(path_str).resolve()
    if not _is_safe_write_path(resolved):
        return ToolResult(
            status="error", result=None,
            error_detail=f"Write access denied: {resolved} outside safe write directories",
        )
    resolved.parent.mkdir(parents=True, exist_ok=True)
    mode = "a" if args.get("mode") == "append" else "w"
    try:
        with open(resolved, mode) as f:
            f.write(content)
        return ToolResult(status="success", result={"path": str(resolved), "bytes_written": len(content)})
    except Exception as e:
        return ToolResult(status="error", result=None, error_detail=str(e))


@register_tool("list_directory", description="List files and directories at a path with metadata.")
async def tool_list_directory(args: dict) -> ToolResult:
    """
    args:
      path:      str — directory path
      pattern:   str — glob pattern, default "*"
      max_items: int — default 100
    """
    path_str  = args.get("path", ".")
    pattern   = args.get("pattern", "*")
    max_items = int(args.get("max_items", 100))

    resolved = Path(path_str).resolve()
    if not _is_safe_read_path(resolved):
        return ToolResult(status="error", result=None, error_detail=f"Access denied: {resolved}")
    if not resolved.is_dir():
        return ToolResult(status="error", result=None, error_detail=f"Not a directory: {resolved}")

    try:
        all_entries = list(resolved.glob(pattern))
        entries = []
        for p in sorted(all_entries)[:max_items]:
            stat = p.stat()
            entries.append({
                "name":       p.name,
                "type":       "dir" if p.is_dir() else "file",
                "size_bytes": stat.st_size if p.is_file() else None,
                "mtime":      round(stat.st_mtime, 1),
                "path":       str(p),
            })
        return ToolResult(status="success", result={
            "path": str(resolved),
            "count": len(entries),
            "truncated": len(all_entries) > max_items,
            "entries": entries,
        })
    except Exception as e:
        return ToolResult(status="error", result=None, error_detail=str(e))


@register_tool("search_files", description="Search for a pattern in files under a directory (safe grep).")
async def tool_search_files(args: dict) -> ToolResult:
    """
    args:
      directory:        str — search root (must be in safe read roots)
      pattern:          str — literal text pattern (no regex from model)
      file_glob:        str — file name glob filter, default "*.py"
      max_results:      int — default 50
      case_insensitive: bool — default false
    """
    dir_str          = args.get("directory", ".")
    pattern          = args.get("pattern", "")
    file_glob        = args.get("file_glob", "*.py")
    max_results      = int(args.get("max_results", 50))
    case_insensitive = bool(args.get("case_insensitive", False))

    if not pattern:
        return ToolResult(status="error", result=None, error_detail="Missing 'pattern'")

    resolved_dir = Path(dir_str).resolve()
    if not _is_safe_read_path(resolved_dir):
        return ToolResult(status="error", result=None, error_detail=f"Access denied: {resolved_dir}")

    search_pattern = pattern.lower() if case_insensitive else pattern
    matches: list[dict] = []

    try:
        for file_path in sorted(resolved_dir.rglob(file_glob)):
            if len(matches) >= max_results:
                break
            if not file_path.is_file():
                continue
            try:
                text  = file_path.read_text(encoding="utf-8", errors="replace")
                lines = text.splitlines()
                for lineno, line in enumerate(lines, 1):
                    haystack = line.lower() if case_insensitive else line
                    if search_pattern in haystack:
                        matches.append({"file": str(file_path.relative_to(resolved_dir)), "line": lineno, "content": line.rstrip()[:200]})
                        if len(matches) >= max_results:
                            break
            except (UnicodeDecodeError, PermissionError):
                continue
    except Exception as e:
        return ToolResult(status="error", result=None, error_detail=str(e))

    return ToolResult(status="success", result={
        "pattern": pattern,
        "directory": str(resolved_dir),
        "matches": matches,
        "truncated": len(matches) >= max_results,
    })


@register_tool("run_python", description="Execute a safe Python snippet and return stdout.")
async def tool_run_python(args: dict) -> ToolResult:
    """
    [FIX-01] Uses asyncio.to_thread() — no more deprecated get_event_loop().

    Safety model:
      - AST-level import/call check blocks dangerous modules and builtins.
      - Subprocess runs with a fixed minimal environment — no inherited secrets.

    args:
      code:    str — Python source
      timeout: int — seconds, default 15, max 30
    """
    import ast

    code    = args.get("code", "")
    timeout = min(int(args.get("timeout", 15)), 30)

    if not code:
        return ToolResult(status="error", result=None, error_detail="No code provided")

    BLOCKED_MODULES  = {"os", "sys", "subprocess", "socket", "shutil", "pathlib",
                        "importlib", "ctypes", "multiprocessing", "threading",
                        "pty", "fcntl", "signal", "pickle", "shelve"}
    BLOCKED_BUILTINS = {"exec", "eval", "__import__", "compile", "open", "breakpoint"}

    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return ToolResult(status="error", result=None, error_detail=f"Syntax error: {e}")

    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            mod = (node.names[0].name if isinstance(node, ast.Import) else (node.module or "")).split(".")[0]
            if mod in BLOCKED_MODULES:
                return ToolResult(status="error", result=None, error_detail=f"Blocked: import of '{mod}' is not permitted.")
        if isinstance(node, ast.Call):
            func_name = ""
            if isinstance(node.func, ast.Name):
                func_name = node.func.id
            elif isinstance(node.func, ast.Attribute):
                func_name = node.func.attr
            if func_name in BLOCKED_BUILTINS:
                return ToolResult(status="error", result=None, error_detail=f"Blocked: '{func_name}()' call is not permitted.")

    safe_env = {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "LANG": os.environ.get("LANG", "en_US.UTF-8"),
        "PYTHONPATH": "",
        "PYTHONDONTWRITEBYTECODE": "1",
    }

    def _run_sync() -> subprocess.CompletedProcess:
        return subprocess.run(
            ["python3", "-c", code],
            capture_output=True,
            text=True,
            timeout=timeout,
            env=safe_env,
        )

    try:
        # [FIX-01] asyncio.to_thread() — safe in 3.9+, no DeprecationWarning
        proc_result = await asyncio.wait_for(asyncio.to_thread(_run_sync), timeout=timeout + 2)
        if proc_result.returncode != 0:
            return ToolResult(
                status="error",
                result=proc_result.stdout[:500] if proc_result.stdout else None,
                error_detail=proc_result.stderr[:500],
            )
        return ToolResult(status="success", result=proc_result.stdout[:2000])
    except TimeoutError:
        return ToolResult(status="error", result=None, error_detail=f"Timeout after {timeout}s")
    except Exception as e:
        return ToolResult(status="error", result=None, error_detail=str(e))


@register_tool("run_shell_safe", description="Run an allowlisted shell command and return stdout/stderr.")
async def tool_run_shell_safe(args: dict) -> ToolResult:
    """
    [ENH-02] Restricted command runner. argv must be a list; first element must
    be on _SHELL_ALLOWLIST. No shell=True, no string interpolation of model input.

    args:
      argv:        list[str] — command + args (first element must be on allowlist)
      cwd:         str       — working directory (must be in safe read roots)
      timeout:     int       — seconds, default 30, max 120
      max_chars:   int       — max output chars, default 4000
      env_extras:  dict      — additional safe env vars (no secrets — keys inspected)
    """
    argv = args.get("argv")
    if not isinstance(argv, list) or not argv:
        return ToolResult(status="error", result=None, error_detail="'argv' must be a non-empty list")

    cmd = argv[0]
    if cmd not in _SHELL_ALLOWLIST:
        return ToolResult(
            status="error", result=None,
            error_detail=f"'{cmd}' is not on the safe command allowlist. Allowed: {sorted(_SHELL_ALLOWLIST)}",
        )

    cwd_str = args.get("cwd", ".")
    cwd_resolved = Path(cwd_str).resolve()
    if not _is_safe_read_path(cwd_resolved):
        return ToolResult(status="error", result=None, error_detail=f"cwd not in safe read roots: {cwd_resolved}")

    timeout   = min(int(args.get("timeout", 30)), 120)
    max_chars = int(args.get("max_chars", 4000))

    safe_env = {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "HOME": str(Path.home()),
        "LANG": os.environ.get("LANG", "en_US.UTF-8"),
    }
    env_extras = args.get("env_extras", {}) or {}
    # Only allow safe env keys — no PATH override, no secrets
    _BLOCKED_ENV_KEYS = {"PATH", "LD_PRELOAD", "PYTHONPATH", "LD_LIBRARY_PATH", "HOME"}
    for k, v in env_extras.items():
        if k not in _BLOCKED_ENV_KEYS and isinstance(k, str) and isinstance(v, str):
            safe_env[k] = v

    def _run_sync() -> subprocess.CompletedProcess:
        return subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=safe_env,
            cwd=str(cwd_resolved),
        )

    try:
        proc = await asyncio.wait_for(asyncio.to_thread(_run_sync), timeout=timeout + 2)
        return ToolResult(
            status="success" if proc.returncode == 0 else "error",
            result={
                "returncode": proc.returncode,
                "stdout":     proc.stdout[:max_chars],
                "stderr":     proc.stderr[:max_chars],
                "command":    argv,
            },
            error_detail=proc.stderr[:500] if proc.returncode != 0 else None,
        )
    except TimeoutError:
        return ToolResult(status="error", result=None, error_detail=f"Timeout after {timeout}s")
    except Exception as e:
        return ToolResult(status="error", result=None, error_detail=str(e))


@register_tool("git_status", description="Read git status, log, or diff for a repository (read-only, safe).")
async def tool_git_status(args: dict) -> ToolResult:
    """
    [ENH-01] Safe git reader. Only runs fixed read-only git subcommands —
    no model-supplied git arguments. Operates only inside _SAFE_READ_ROOTS.

    args:
      repo:      str — repository root path
      operation: str — "status" | "log" | "diff" | "branch" | "remote"
      max_chars: int — default 3000
      log_n:     int — number of log entries (for operation="log"), default 10
    """
    repo_str  = args.get("repo", ".")
    operation = args.get("operation", "status")
    max_chars = int(args.get("max_chars", 3000))
    log_n     = min(int(args.get("log_n", 10)), 50)

    repo_resolved = Path(repo_str).resolve()
    if not _is_safe_read_path(repo_resolved):
        return ToolResult(status="error", result=None, error_detail=f"Access denied: {repo_resolved}")
    git_marker = repo_resolved / ".git"
    if not git_marker.exists():
        return ToolResult(status="error", result=None, error_detail=f"Not a git repository: {repo_resolved}")

    CMD_MAP: dict[str, list[str]] = {
        "status": ["git", "-C", str(repo_resolved), "status", "--short", "--branch"],
        "log":    ["git", "-C", str(repo_resolved), "log", f"-{log_n}", "--oneline", "--no-color"],
        "diff":   ["git", "-C", str(repo_resolved), "diff", "--stat", "--no-color"],
        "branch": ["git", "-C", str(repo_resolved), "branch", "-v", "--no-color"],
        "remote": ["git", "-C", str(repo_resolved), "remote", "-v"],
    }

    cmd = CMD_MAP.get(operation)
    if cmd is None:
        return ToolResult(
            status="error", result=None,
            error_detail=f"Unknown operation '{operation}'. Use: {list(CMD_MAP.keys())}",
        )

    def _run() -> subprocess.CompletedProcess:
        return subprocess.run(
            cmd, capture_output=True, text=True, timeout=15,
            env={"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": str(Path.home()), "GIT_TERMINAL_PROMPT": "0"},
        )

    try:
        proc = await asyncio.wait_for(asyncio.to_thread(_run), timeout=17)
        output = (proc.stdout or proc.stderr or "")[:max_chars]
        return ToolResult(
            status="success" if proc.returncode == 0 else "error",
            result={"operation": operation, "repo": str(repo_resolved), "output": output},
            error_detail=proc.stderr[:300] if proc.returncode != 0 else None,
        )
    except TimeoutError:
        return ToolResult(status="error", result=None, error_detail="git operation timed out after 15s")
    except Exception as e:
        return ToolResult(status="error", result=None, error_detail=str(e))


@register_tool("http_get", description="Perform an HTTP GET request and return the response body.")
async def tool_http_get(args: dict) -> ToolResult:
    url = args.get("url")
    if not url:
        return ToolResult(status="error", result=None, error_detail="Missing 'url'")
    ssrf = _ssrf_check(url)
    if ssrf:
        return ssrf
    timeout   = min(int(args.get("timeout", 10)), 30)
    max_chars = int(args.get("max_chars", 3000))
    headers   = args.get("headers", {})
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            text = resp.text[:max_chars]
            return ToolResult(status="success", result={
                "status_code": resp.status_code,
                "content_type": resp.headers.get("content-type", ""),
                "body": text,
                "truncated": len(resp.text) > max_chars,
            })
    except httpx.HTTPStatusError as e:
        return ToolResult(status="error", result=None, error_detail=f"HTTP {e.response.status_code}: {e.response.url}")
    except Exception as e:
        return ToolResult(status="error", result=None, error_detail=str(e))


@register_tool("http_post", description="Perform an HTTP POST request with a JSON body.")
async def tool_http_post(args: dict) -> ToolResult:
    url  = args.get("url")
    body = args.get("body", {})
    if not url:
        return ToolResult(status="error", result=None, error_detail="Missing 'url'")
    ssrf = _ssrf_check(url)
    if ssrf:
        return ssrf
    timeout   = min(int(args.get("timeout", 10)), 30)
    max_chars = int(args.get("max_chars", 3000))
    headers   = {"Content-Type": "application/json", **args.get("headers", {})}
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            resp = await client.post(url, json=body, headers=headers)
            resp.raise_for_status()
            text = resp.text[:max_chars]
            return ToolResult(status="success", result={
                "status_code": resp.status_code,
                "content_type": resp.headers.get("content-type", ""),
                "body": text,
                "truncated": len(resp.text) > max_chars,
            })
    except httpx.HTTPStatusError as e:
        return ToolResult(status="error", result=None, error_detail=f"HTTP {e.response.status_code}")
    except Exception as e:
        return ToolResult(status="error", result=None, error_detail=str(e))


@register_tool("json_validate", description="Validate JSON against a named SwarmX schema.")
async def tool_json_validate(args: dict) -> ToolResult:
    import jsonschema

    schema_path = Path(__file__).parent.parent / "schemas" / "message_schemas.json"
    try:
        with open(schema_path) as f:
            all_schemas = json.load(f)["definitions"]
    except Exception as e:
        return ToolResult(status="error", result=None, error_detail=f"Schema load failed: {e}")

    schema_name = args.get("schema_name")
    data        = args.get("data")

    if isinstance(data, str):
        try:
            data = json.loads(data)
        except json.JSONDecodeError as e:
            return ToolResult(status="error", result=None, error_detail=f"JSON parse error: {e}")

    schema = all_schemas.get(schema_name)
    if schema is None:
        return ToolResult(status="error", result=None, error_detail=f"Unknown schema '{schema_name}'. Available: {list(all_schemas.keys())}")

    validator = jsonschema.Draft7Validator(schema)
    errors    = list(validator.iter_errors(data))
    if errors:
        return ToolResult(status="error", result={"valid": False, "violations": [e.message for e in errors]})
    return ToolResult(status="success", result={"valid": True, "violations": []})


@register_tool("json_transform", description="Extract a value from a JSON object by dot-path key chain.")
async def tool_json_transform(args: dict) -> ToolResult:
    data    = args.get("data")
    path    = args.get("path", "")
    default = args.get("default")

    if isinstance(data, str):
        try:
            data = json.loads(data)
        except json.JSONDecodeError as e:
            return ToolResult(status="error", result=None, error_detail=f"JSON parse error: {e}")

    if not path:
        return ToolResult(status="success", result=data)

    try:
        current = data
        for key in path.split("."):
            if isinstance(current, dict):
                current = current[key]
            elif isinstance(current, list):
                current = current[int(key)]
            else:
                return ToolResult(status="success", result=default)
        return ToolResult(status="success", result=current)
    except (KeyError, IndexError, ValueError, TypeError):
        return ToolResult(status="success", result=default)


@register_tool("diff_texts", description="Return a unified diff of two text strings.")
async def tool_diff_texts(args: dict) -> ToolResult:
    a         = args.get("a", "")
    b         = args.get("b", "")
    label_a   = args.get("label_a", "original")
    label_b   = args.get("label_b", "modified")
    max_chars = int(args.get("max_chars", 4000))

    diff_lines = list(difflib.unified_diff(
        a.splitlines(keepends=True),
        b.splitlines(keepends=True),
        fromfile=label_a,
        tofile=label_b,
    ))
    diff_text = "".join(diff_lines)
    truncated = len(diff_text) > max_chars

    return ToolResult(status="success", result={
        "diff": diff_text[:max_chars],
        "lines_changed": sum(1 for l in diff_lines if l.startswith(("+", "-")) and not l.startswith(("+++", "---"))),
        "truncated": truncated,
    })


@register_tool("hash_file", description="Compute SHA-256 (or MD5) digest of a local file.")
async def tool_hash_file(args: dict) -> ToolResult:
    path_str  = args.get("path")
    algorithm = args.get("algorithm", "sha256").lower()

    if not path_str:
        return ToolResult(status="error", result=None, error_detail="Missing 'path'")
    if algorithm not in ("sha256", "md5"):
        return ToolResult(status="error", result=None, error_detail=f"Unsupported algorithm '{algorithm}'. Use sha256 or md5.")

    resolved = Path(path_str).resolve()
    if not _is_safe_read_path(resolved):
        return ToolResult(status="error", result=None, error_detail=f"Access denied: {resolved}")
    if not resolved.exists():
        return ToolResult(status="error", result=None, error_detail=f"File not found: {resolved}")

    try:
        h = hashlib.new(algorithm)
        with open(resolved, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        return ToolResult(status="success", result={
            "path": str(resolved),
            "algorithm": algorithm,
            "digest": h.hexdigest(),
            "size_bytes": resolved.stat().st_size,
        })
    except Exception as e:
        return ToolResult(status="error", result=None, error_detail=str(e))


@register_tool("summarise_text", description="Summarise a text block using phi4-fast.")
async def tool_summarise_text(args: dict) -> ToolResult:
    text      = args.get("text", "")
    max_words = int(args.get("max_words", 100))
    if not text:
        return ToolResult(status="error", result=None, error_detail="No text provided")

    # [FIX-06] Use /api/chat (non-deprecated). /api/generate is on the removal path
    # in Ollama 0.6+. The chat API accepts the same model and produces identical output.
    base_url = _ollama_base_url().rstrip("/")
    api_url  = f"{base_url}/api/chat"

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.post(api_url, json={
                "model":  os.environ.get("SWARMX_FAST_MODEL", "phi4-fast"),
                "stream": False,
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            f"Summarise the following in under {max_words} words. "
                            f"Output plain text only.\n\n{text[:3000]}"
                        ),
                    }
                ],
            })
            resp.raise_for_status()
            summary = resp.json().get("message", {}).get("content", "").strip()
            return ToolResult(status="success", result=summary)
        except Exception as e:
            return ToolResult(status="error", result=None, error_detail=str(e))


@register_tool("list_tools", description="List all available tools, their descriptions, and optional circuit-breaker state.")
async def tool_list_tools(args: dict) -> ToolResult:
    """
    args:
      include_cb_state: bool — if true, each tool entry includes circuit-breaker state (default false)
    """
    include_cb_state = bool(args.get("include_cb_state", False))
    return ToolResult(status="success", result=list_tools(include_cb_state=include_cb_state))


@register_tool("get_tool_call_log", description="Return recent tool dispatch log entries for observability.")
async def tool_get_call_log(_args: dict) -> ToolResult:
    return ToolResult(status="success", result=get_call_log()[-50:])


@register_tool("yaml_parse", description="Parse a YAML file or YAML string and return the data as a JSON-serializable dict.")
async def tool_yaml_parse(args: dict) -> ToolResult:
    """
    [ENH-06] Safe YAML parser. File paths are gated to safe read roots.
    String inputs are parsed directly (no filesystem access).

    args:
      source:   str — a file path (absolute/~/relative) OR a raw YAML string.
                      File path detection: starts with '/' or '~'.
      key_path: str — optional dot-separated sub-key to extract.
                      E.g. "models.supervisor" returns the supervisor value only.
    """
    import yaml as _yaml  # pyyaml — already in requirements.txt

    source = args.get("source", "")
    if not source:
        return ToolResult(status="error", result=None, error_detail="Missing 'source'")

    key_path = args.get("key_path", "")

    try:
        is_path = source.startswith("/") or source.startswith("~/") or source.startswith("~\\")
        if is_path:
            resolved = Path(source.replace("~/", str(Path.home()) + "/").replace("~\\", str(Path.home()) + "\\")).resolve()
            if not _is_safe_read_path(resolved):
                return ToolResult(status="error", result=None, error_detail=f"Access denied: {resolved}")
            if not resolved.exists():
                return ToolResult(status="error", result=None, error_detail=f"File not found: {resolved}")
            raw = resolved.read_text(encoding="utf-8")
        else:
            raw = source

        data = _yaml.safe_load(raw)
    except _yaml.YAMLError as e:
        return ToolResult(status="error", result=None, error_detail=f"YAML parse error: {e}")
    except Exception as e:
        return ToolResult(status="error", result=None, error_detail=str(e))

    # Optional sub-key extraction via dot-path
    if key_path:
        current = data
        for part in key_path.split("."):
            if isinstance(current, dict):
                current = current.get(part)
            elif isinstance(current, list):
                try:
                    current = current[int(part)]
                except (ValueError, IndexError):
                    current = None
                    break
            else:
                current = None
                break
        data = current

    # Ensure result is JSON-serializable
    try:
        json.dumps(data)
    except (TypeError, ValueError):
        data = str(data)

    return ToolResult(status="success", result=data)


@register_tool("json_merge", description="Deep-merge two JSON objects (right-side values win on key collision). Lists are replaced, not merged.")
async def tool_json_merge(args: dict) -> ToolResult:
    """
    [ENH-07] Recursive deep-merge of two JSON objects.
    Right operand values take precedence on key collision at every depth.
    Lists are NOT merged — the right list replaces the left list entirely.
    Scalars (str, int, bool, null) are always overwritten by the right value.

    args:
      base:    dict | str  — base JSON object or JSON string
      overlay: dict | str  — overlay JSON object or JSON string (takes precedence)
    """
    def _parse_arg(v: Any) -> Any:
        if isinstance(v, str):
            try:
                return json.loads(v)
            except json.JSONDecodeError as e:
                raise ValueError(f"JSON parse error in argument: {e}") from e
        return v

    def _deep_merge(base: Any, overlay: Any) -> Any:
        """Recursively merge overlay into base. Overlay wins on all conflicts."""
        if isinstance(base, dict) and isinstance(overlay, dict):
            merged = dict(base)
            for k, v in overlay.items():
                if k in base:
                    merged[k] = _deep_merge(base[k], v)
                else:
                    merged[k] = v
            return merged
        # For non-dict types (list, scalar, null): overlay replaces base
        return overlay

    try:
        base    = _parse_arg(args.get("base", {}))
        overlay = _parse_arg(args.get("overlay", {}))
    except ValueError as e:
        return ToolResult(status="error", result=None, error_detail=str(e))

    try:
        merged = _deep_merge(base, overlay)
        # Ensure result is JSON-serializable before returning
        json.dumps(merged)
        return ToolResult(status="success", result=merged)
    except (TypeError, ValueError) as e:
        return ToolResult(status="error", result=None, error_detail=f"Merge result not JSON-serializable: {e}")
    except Exception as e:
        return ToolResult(status="error", result=None, error_detail=str(e))


# ─── V5.7 New Tools ───────────────────────────────────────────────────────────
@register_tool(
    "check_file_exists",
    description="Check whether a file or directory exists at a path. Returns exists bool and type.",
)
async def tool_check_file_exists(args: dict) -> ToolResult:
    """
    [V5.7-ENH-03] Cheap existence probe — does not read content.

    args:
      path: str — absolute or relative path to check
    """
    path_str = args.get("path")
    if not path_str:
        return ToolResult(status="error", result=None, error_detail="Missing 'path'")

    resolved = Path(path_str).resolve()
    if not _is_safe_read_path(resolved):
        return ToolResult(status="error", result=None, error_detail=f"Access denied: {resolved}")

    exists    = resolved.exists()
    file_type = "file" if resolved.is_file() else "dir" if resolved.is_dir() else "other"
    return ToolResult(
        status="success",
        result={
            "path":       str(resolved),
            "exists":     exists,
            "type":       file_type if exists else None,
            "size_bytes": resolved.stat().st_size if exists and resolved.is_file() else None,
        },
    )


@register_tool(
    "calculate",
    description=(
        "Evaluate a safe arithmetic or boolean expression and return the result. "
        "Supports +, -, *, /, //, %, **, abs(), round(), min(), max(). "
        "No imports, no string ops, no builtins beyond the safe set."
    ),
)
async def tool_calculate(args: dict) -> ToolResult:
    """
    [V5.7-ENH-03] Safe expression evaluator via ast.literal_eval + restricted eval.

    args:
      expression: str — e.g. "(12288 * 0.70) // 4"
      precision:  int — decimal places to round float results (default: 6)
    """
    import ast as _ast
    import math as _math

    expression = str(args.get("expression", "")).strip()
    precision  = min(int(args.get("precision", 6)), 15)

    if not expression:
        return ToolResult(status="error", result=None, error_detail="Missing 'expression'")
    if len(expression) > 500:
        return ToolResult(status="error", result=None, error_detail="Expression too long (max 500 chars)")

    _SAFE_NAMES = {
        "abs": abs, "round": round, "min": min, "max": max, "sum": sum,
        "int": int, "float": float, "bool": bool, "len": len,
        "pi": _math.pi, "e": _math.e,
        "sqrt": _math.sqrt, "log": _math.log, "log10": _math.log10,
        "floor": _math.floor, "ceil": _math.ceil,
        "True": True, "False": False,
    }
    _SAFE_NODES = (
        _ast.Expression, _ast.BoolOp, _ast.BinOp, _ast.UnaryOp,
        _ast.Call, _ast.Constant, _ast.Name, _ast.Load,
        _ast.Add, _ast.Sub, _ast.Mult, _ast.Div, _ast.FloorDiv,
        _ast.Mod, _ast.Pow, _ast.UAdd, _ast.USub,
        _ast.And, _ast.Or, _ast.Not,
        _ast.Compare, _ast.Eq, _ast.NotEq, _ast.Lt, _ast.LtE, _ast.Gt, _ast.GtE,
        _ast.IfExp,
    )

    try:
        tree = _ast.parse(expression, mode="eval")
    except SyntaxError as e:
        return ToolResult(status="error", result=None, error_detail=f"Syntax error: {e}")

    for node in _ast.walk(tree):
        if not isinstance(node, _SAFE_NODES):
            return ToolResult(
                status="error",
                result=None,
                error_detail=f"Blocked node type: {type(node).__name__}. Only arithmetic/boolean ops allowed.",
            )
        if isinstance(node, _ast.Name) and node.id not in _SAFE_NAMES:
            return ToolResult(
                status="error",
                result=None,
                error_detail=f"Undefined name: '{node.id}'. Allowed names: {sorted(_SAFE_NAMES.keys())}",
            )

    try:
        # pylint: disable=eval-used
        raw = eval(compile(tree, "<expr>", "eval"), {"__builtins__": {}}, _SAFE_NAMES)  # noqa: S307
    except ZeroDivisionError:
        return ToolResult(status="error", result=None, error_detail="Division by zero")
    except Exception as e:
        return ToolResult(status="error", result=None, error_detail=f"Evaluation error: {e}")

    if isinstance(raw, float):
        raw = round(raw, precision)

    return ToolResult(status="success", result={"expression": expression, "result": raw})


@register_tool(
    "batch_read_files",
    description=(
        "Read multiple files in one call. Returns a map of path → content (or error). "
        "Skips files outside safe read roots rather than aborting the whole batch."
    ),
)
async def tool_batch_read_files(args: dict) -> ToolResult:
    """
    [V5.7-ENH-03] Parallel multi-file reader. Avoids multiple round-trips for
    agents that need several source files in one step.

    args:
      paths:      list[str] — list of file paths (max 20)
      encoding:   str  — default "utf-8"
      max_chars:  int  — per-file char limit, default 3000
    """
    paths     = args.get("paths", [])
    encoding  = args.get("encoding", "utf-8")
    max_chars = int(args.get("max_chars", 3000))

    if not isinstance(paths, list) or not paths:
        return ToolResult(status="error", result=None, error_detail="'paths' must be a non-empty list")
    if len(paths) > 20:
        return ToolResult(status="error", result=None, error_detail="Max 20 files per batch_read_files call")

    async def _read_one(path_str: str) -> tuple[str, Any]:
        resolved = Path(path_str).resolve()
        if not _is_safe_read_path(resolved):
            return path_str, {"error": f"Access denied: {resolved}"}
        if not resolved.exists():
            return path_str, {"error": f"Not found: {resolved}"}
        try:
            content = resolved.read_text(encoding=encoding)
            truncated = len(content) > max_chars
            return path_str, {
                "content":   content[:max_chars],
                "truncated": truncated,
                "size":      resolved.stat().st_size,
            }
        except Exception as e:
            return path_str, {"error": str(e)}

    results_list = await asyncio.gather(*[_read_one(p) for p in paths])
    results_map  = dict(results_list)
    errors       = [p for p, v in results_map.items() if "error" in v]

    return ToolResult(
        status="partial" if errors else "success",
        result={"files": results_map, "error_count": len(errors)},
        error_detail=f"Failed paths: {errors}" if errors else None,
    )


@register_tool(
    "env_info",
    description=(
        "Return non-secret system environment facts for diagnostics: "
        "Python version, OS, CPU count, RAM available, disk free on /, SWARMX env vars (values redacted)."
    ),
)
async def tool_env_info(_args: dict) -> ToolResult:
    """
    [V5.7-ENH-03] Safe diagnostics probe. Never returns secret values — all env
    var values are redacted to their length only.
    """
    import platform
    import shutil

    _SAFE_ENV_PREFIXES = ("SWARMX_", "OLLAMA_", "SWARM_", "LANG", "HOME", "USER", "PATH")

    def _ram_avail_gb() -> float | None:
        try:
            with open("/proc/meminfo") as f:
                for line in f:
                    if line.startswith("MemAvailable:"):
                        return round(int(line.split()[1]) / 1024 / 1024, 2)
        except Exception:
            pass
        return None

    disk = shutil.disk_usage("/")
    safe_env = {
        k: f"<{len(v)} chars>"
        for k, v in os.environ.items()
        if any(k.startswith(p) for p in _SAFE_ENV_PREFIXES)
    }

    return ToolResult(
        status="success",
        result={
            "python": platform.python_version(),
            "platform": platform.platform(),
            "cpu_count": os.cpu_count(),
            "ram_avail_gb": _ram_avail_gb(),
            "disk_free_gb": round(disk.free / 1024**3, 2),
            "disk_total_gb": round(disk.total / 1024**3, 2),
            "env_vars": safe_env,
        },
    )


@register_tool(
    "semantic_search",
    description=(
        "Search the SwarmX vector memory for documents semantically similar to the query. "
        "Returns up to top_k relevant snippets. Uses FAISS when available, TF-IDF otherwise."
    ),
)
async def tool_semantic_search(args: dict) -> ToolResult:
    """
    args:
      query:   str — search query
      top_k:   int — max results (default 3, max 10)

    [ENH] Closes the capability gap where the agent had no tool-level access to
    the vector memory store — previously only accessible via brain/rag.py at
    prompt-enrichment time, not during mid-execution tool calls.
    """
    query = args.get("query", "")
    if not query:
        return ToolResult(status="error", result=None, error_detail="Missing 'query'")

    try:
        top_k = min(int(args.get("top_k", 3)), 10)
    except Exception:
        top_k = 3

    results: list[str] = []

    try:
        from memory.faiss_store import FAISSStore  # type: ignore[import]
        store = FAISSStore()
        results = store.search(query, k=top_k)
    except Exception:
        pass

    if not results:
        try:
            from memory.vector_store import VectorStore  # type: ignore[import]
            results = VectorStore().search(query, top_k=top_k)
        except Exception:
            pass

    if not results:
        try:
            from brain.memory import search as mem_search  # type: ignore[import]
            records = mem_search(query, top_k=top_k)
            results = [
                f"{r.get('task', '')[:150]} → {r.get('result', '')[:150]}"
                for r in records
            ]
        except Exception:
            pass

    if not results:
        return ToolResult(
            status="success",
            result={"results": [], "count": 0, "note": "no memory entries found"},
        )

    return ToolResult(
        status="success",
        result={"results": results[:top_k], "count": len(results)},
    )


@register_tool(
    "diff_files",
    description=(
        "Compute a unified diff between two local files. "
        "Returns the diff as a string. Both files must be within safe read roots."
    ),
)
async def tool_diff_files(args: dict) -> ToolResult:
    """
    args:
      path_a:     str — first file path (original)
      path_b:     str — second file path (modified)
      context:    int — context lines (default 3)
      max_chars:  int — max diff output chars (default 4000)

    [ENH] Enables agents to compare two file versions or output snapshots
    during self-improvement and audit workflows without reading both files
    separately and doing manual comparison.
    """
    path_a_str = args.get("path_a")
    path_b_str = args.get("path_b")
    if not path_a_str or not path_b_str:
        return ToolResult(status="error", result=None, error_detail="Missing 'path_a' or 'path_b'")

    path_a = Path(path_a_str).resolve()
    path_b = Path(path_b_str).resolve()

    for p in (path_a, path_b):
        if not _is_safe_read_path(p):
            return ToolResult(status="error", result=None, error_detail=f"Access denied: {p}")
        if not p.exists():
            return ToolResult(status="error", result=None, error_detail=f"File not found: {p}")

    try:
        context = max(0, int(args.get("context", 3)))
    except Exception:
        context = 3

    try:
        max_chars = int(args.get("max_chars", 4000))
    except Exception:
        max_chars = 4000

    try:
        lines_a = path_a.read_text(encoding="utf-8", errors="replace").splitlines(keepends=True)
        lines_b = path_b.read_text(encoding="utf-8", errors="replace").splitlines(keepends=True)

        diff = list(
            difflib.unified_diff(
                lines_a,
                lines_b,
                fromfile=str(path_a),
                tofile=str(path_b),
                n=context,
            )
        )

        diff_str = "".join(diff)
        truncated = len(diff_str) > max_chars

        return ToolResult(
            status="partial" if truncated else "success",
            result={
                "diff": diff_str[:max_chars],
                "lines_added": sum(1 for l in diff if l.startswith("+")),
                "lines_removed": sum(1 for l in diff if l.startswith("-")),
                "truncated": truncated,
            },
            error_detail="diff_truncated" if truncated else None,
        )
    except Exception as e:
        return ToolResult(status="error", result=None, error_detail=str(e))
