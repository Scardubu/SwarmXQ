from __future__ import annotations

import importlib.util

DESCRIPTION = 'LangGraph cyclic state graphs and self-correction'
MODULE_NAME = 'langgraph'


def available() -> bool:
    return importlib.util.find_spec(MODULE_NAME) is not None


def adapter() -> dict:
    return {
        "name": 'langgraph',
        "description": DESCRIPTION,
        "available": available(),
        "module": MODULE_NAME,
    }
