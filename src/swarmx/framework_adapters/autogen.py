from __future__ import annotations

import importlib.util

DESCRIPTION = 'AutoGen event-driven actor collaboration'
MODULE_NAME = 'autogen_agentchat'


def available() -> bool:
    return importlib.util.find_spec(MODULE_NAME) is not None


def adapter() -> dict:
    return {
        "name": 'autogen',
        "description": DESCRIPTION,
        "available": available(),
        "module": MODULE_NAME,
    }
