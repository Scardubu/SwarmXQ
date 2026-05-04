from __future__ import annotations

import importlib.util

DESCRIPTION = 'OpenAI Agents SDK / Responses API'
MODULE_NAME = 'agents'


def available() -> bool:
    return importlib.util.find_spec(MODULE_NAME) is not None


def adapter() -> dict:
    return {
        "name": 'openai_agents',
        "description": DESCRIPTION,
        "available": available(),
        "module": MODULE_NAME,
    }
