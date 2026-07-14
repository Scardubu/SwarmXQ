"""mcp_server.py — opt-in FastMCP bridge for SwarmX V5.

Disabled by default (``mcp.enabled = false`` in routing.yaml).
When enabled, exposes registered SwarmX tools over the Model Context Protocol
so external agents can discover and call them.

Usage::

    from swarmx.mcp_server import start_mcp_server
    start_mcp_server(cfg)          # only starts if cfg.mcp_enabled is True
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

from .config import SwarmConfig
from .tooling import list_registered_tools

# ── MCP capability manifest ──────────────────────────────────────────────────

def _build_manifest() -> dict[str, Any]:
    """Build a minimal MCP capabilities manifest from the tool registry."""
    return {
        "schema_version": "2024-11-05",
        "capabilities": {"tools": {}},
        "tools": [
            {
                "name": t["name"],
                "description": t.get("description", ""),
                "inputSchema": t.get("schema", {"type": "object", "properties": {}}),
            }
            for t in list_registered_tools()
            if t.get("enabled", True)
        ],
    }


# ── Minimal HTTP/JSON-RPC handler ────────────────────────────────────────────

class _MCPHandler(BaseHTTPRequestHandler):
    """Minimal JSON-RPC 2.0 handler for the MCP tool listing endpoint."""

    def log_message(self, fmt: str, *args: Any) -> None:  # silence access logs
        pass

    def _send_json(self, status: int, body: dict[str, Any]) -> None:
        encoded = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:  # noqa: N802
        if self.path in {"/", "/mcp", "/mcp/manifest"}:
            self._send_json(200, _build_manifest())
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            req = json.loads(raw.decode("utf-8", errors="replace"))
        except Exception:
            self._send_json(400, {"error": "invalid JSON"})
            return

        method: str = req.get("method", "")
        req_id = req.get("id")

        if method == "tools/list":
            self._send_json(200, {"jsonrpc": "2.0", "id": req_id, "result": _build_manifest()["tools"]})
        elif method == "tools/call":
            # Delegate to register MCP tool call
            from .tooling import call_mcp_tool
            params = req.get("params", {}) or {}
            tool_name = params.get("name", "")
            arguments = params.get("arguments", {}) or {}
            result = call_mcp_tool(tool_name, arguments)
            if "error" in result:
                self._send_json(200, {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32000, "message": result["error"]}})
            else:
                self._send_json(200, {"jsonrpc": "2.0", "id": req_id, "result": result})
        else:
            self._send_json(200, {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": f"Method not found: {method}"}})


# ── Server lifecycle ─────────────────────────────────────────────────────────

_server_instance: HTTPServer | None = None
_server_thread: threading.Thread | None = None


def start_mcp_server(
    cfg: SwarmConfig | None = None,
    *,
    host: str = "127.0.0.1",
    port: int = 9090,
    daemon: bool = True,
) -> HTTPServer | None:
    """Start the MCP bridge server if enabled.

    Returns the ``HTTPServer`` instance if started, ``None`` if disabled.
    The server runs in a background daemon thread when ``daemon=True``.

    Security: binds to loopback (127.0.0.1) by default. Only change ``host``
    when running inside a trusted, network-isolated container.
    """
    global _server_instance, _server_thread

    if cfg is not None and not getattr(cfg, "mcp_enabled", False):
        return None

    if _server_instance is not None:
        return _server_instance  # already running

    try:
        _server_instance = HTTPServer((host, port), _MCPHandler)
    except OSError as exc:
        # Non-fatal — port may be in use; log and return None
        import warnings
        warnings.warn(f"SwarmX MCP server could not bind to {host}:{port}: {exc}", stacklevel=2)
        return None

    _server_thread = threading.Thread(
        target=_server_instance.serve_forever,
        name="swarmx-mcp-server",
        daemon=daemon,
    )
    _server_thread.start()
    return _server_instance


def stop_mcp_server() -> None:
    """Gracefully shut down the MCP server if running."""
    global _server_instance, _server_thread
    if _server_instance is not None:
        _server_instance.shutdown()
        _server_instance = None
    if _server_thread is not None:
        _server_thread.join(timeout=5)
        _server_thread = None
