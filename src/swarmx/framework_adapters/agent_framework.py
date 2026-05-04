from __future__ import annotations

import importlib.util

DESCRIPTION = "Microsoft Agent Framework production workflows, state, telemetry, and A2A/MCP interoperability"
MODULE_NAME = "agent_framework"


def available() -> bool:
    return importlib.util.find_spec(MODULE_NAME) is not None


def adapter() -> dict:
    return {
        "name": "agent_framework",
        "description": DESCRIPTION,
        "available": available(),
        "module": MODULE_NAME,
    }
