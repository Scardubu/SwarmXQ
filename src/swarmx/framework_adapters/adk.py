from __future__ import annotations

import importlib.util

DESCRIPTION = 'Google ADK graph workflows and human input'
MODULE_NAME = 'google.adk'


def available() -> bool:
    return importlib.util.find_spec(MODULE_NAME) is not None


def adapter() -> dict:
    return {
        "name": 'adk',
        "description": DESCRIPTION,
        "available": available(),
        "module": MODULE_NAME,
    }
