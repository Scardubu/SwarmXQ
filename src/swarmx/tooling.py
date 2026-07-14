from __future__ import annotations

import json as _json
import urllib.request
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .utils import cmd_exists, load_yaml, read_json, write_json

DEFAULT_MCP_ALLOWLIST = [
    "filesystem",
    "git",
    "postgres",
    "sqlite",
    "browser",
    "github",
    "fetch",
    "memory",
]


def detect_tools() -> dict[str, bool]:
    return {
        "git": cmd_exists("git"),
        "python": cmd_exists("python") or cmd_exists("python3"),
        "node": cmd_exists("node"),
        "npm": cmd_exists("npm"),
        "pnpm": cmd_exists("pnpm"),
        "yarn": cmd_exists("yarn"),
        "bun": cmd_exists("bun"),
        "cargo": cmd_exists("cargo"),
        "dotnet": cmd_exists("dotnet"),
        "tmux": cmd_exists("tmux"),
    }


def _merge_manifest(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for key, value in override.items():
        if key == "servers":
            existing = out.get("servers", []) or []
            merged = []
            seen = set()
            for item in list(existing) + list(value or []):
                if isinstance(item, dict):
                    ident = item.get("name") or item.get("id") or str(item)
                else:
                    ident = str(item)
                if ident in seen:
                    continue
                seen.add(ident)
                merged.append(item)
            out["servers"] = merged
        elif key == "allowlist":
            out["allowlist"] = list(dict.fromkeys((out.get("allowlist", []) or []) + list(value or [])))
        elif key == "resource_policy" and isinstance(value, dict):
            out[key] = {**(out.get(key, {}) or {}), **value}
        elif isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge_manifest(out[key], value)
        else:
            out[key] = value
    return out


def load_mcp_manifest(repo: Path | None, runtime_home: Path) -> dict[str, Any]:
    candidates: list[Path] = []
    if repo:
        candidates.extend([
            repo / ".swarmx" / "mcp.json",
            repo / ".swarmx" / "mcp.yaml",
            repo / ".swarmx" / "mcp.yml",
        ])
    candidates.extend([
        runtime_home / "mcp.json",
        runtime_home / "mcp.yaml",
        runtime_home / "mcp.yml",
        Path(__file__).resolve().parents[2] / "configs" / "mcp-defaults.yaml",
    ])
    merged: dict[str, Any] = {"servers": [], "allowlist": DEFAULT_MCP_ALLOWLIST, "resource_policy": {}}
    for path in candidates:
        if path.suffix == ".json" and path.exists():
            data = read_json(path, {})
        elif path.suffix in {".yaml", ".yml"} and path.exists():
            data = load_yaml(path, {})
        else:
            continue
        if isinstance(data, dict) and "mcp" in data and isinstance(data["mcp"], dict):
            data = data["mcp"]
        if isinstance(data, dict):
            merged = _merge_manifest(merged, data)
    if not merged.get("servers"):
        merged["servers"] = []
    return merged


def save_mcp_manifest(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix == ".json":
        write_json(path, payload)
    else:
        import yaml
        path.write_text(yaml.safe_dump(payload, sort_keys=False), encoding="utf-8")


def summarize_tooling(manifest: dict[str, Any]) -> list[str]:
    servers = manifest.get("servers", []) or []
    out = []
    for server in servers:
        if isinstance(server, dict):
            name = server.get("name") or server.get("id") or "unknown"
            out.append(str(name))
        else:
            out.append(str(server))
    return out


# ── V5 MCP Tool Abstraction ─────────────────────────────────────────────────────

@dataclass
class MCPTool:
    """Descriptor for a single tool exposed by an MCP server.

    Attributes:
        name:          Unique tool identifier (matches the MCP server's tool name).
        description:   Human-readable purpose surfaced to the planner.
        endpoint:      Full HTTP URL of the MCP server's tool endpoint.
        schema:        JSON Schema dict describing input parameters.
        server_name:   Parent server name (used for allowlist checks).
        enabled:       Whether this tool is currently active.
        registered_at: ISO timestamp of registration.
    """
    name: str
    description: str
    endpoint: str
    schema: dict = field(default_factory=dict)
    server_name: str = "unknown"
    enabled: bool = True
    registered_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# In-process tool registry — process-scoped
_TOOL_REGISTRY: list[MCPTool] = []


def register_mcp_tool(tool: MCPTool, *, runtime_home: Path | None = None) -> MCPTool:
    """Register an MCPTool in the in-process registry and optionally persist it.

    Idempotent: if a tool with the same name already exists, it is replaced.
    """
    global _TOOL_REGISTRY
    _TOOL_REGISTRY = [t for t in _TOOL_REGISTRY if t.name != tool.name]
    _TOOL_REGISTRY.append(tool)
    if runtime_home:
        try:
            write_json(runtime_home / "mcp_tools.json", [t.to_dict() for t in _TOOL_REGISTRY])
        except Exception:
            pass
    return tool


def call_mcp_tool(
    tool_name: str,
    arguments: dict[str, Any],
    *,
    timeout: int = 30,
    runtime_home: Path | None = None,
) -> dict[str, Any]:
    """Call a registered MCP tool by name and return its JSON response.

    Security: only tools in _TOOL_REGISTRY (explicitly registered, enabled=True)
    can be called. Arguments are serialised to JSON — no shell expansion.
    """
    tool = next((t for t in _TOOL_REGISTRY if t.name == tool_name and t.enabled), None)
    if tool is None:
        return {"error": f"Tool '{tool_name}' not found in registry or is disabled."}
    payload = _json.dumps({"name": tool_name, "arguments": arguments}, ensure_ascii=False).encode()
    req = urllib.request.Request(
        tool.endpoint,
        data=payload,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return _json.loads(body)
    except Exception as exc:
        return {"error": str(exc), "tool": tool_name}


def list_registered_tools() -> list[dict[str, Any]]:
    """Return a serialisable snapshot of all registered MCP tools."""
    return [t.to_dict() for t in _TOOL_REGISTRY]
