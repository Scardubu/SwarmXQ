from __future__ import annotations

import importlib.util

DESCRIPTION = 'Model Context Protocol tools and servers'
MODULE_NAME = 'mcp'


def available() -> bool:
    return importlib.util.find_spec(MODULE_NAME) is not None


def adapter() -> dict:
    return {
        "name": 'mcp',
        "description": DESCRIPTION,
        "available": available(),
        "module": MODULE_NAME,
    }
