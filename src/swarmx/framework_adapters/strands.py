from __future__ import annotations

import importlib.util

DESCRIPTION = 'Strands graphs, swarms, workflows, and agent-as-tool patterns'
MODULE_NAME = 'strands'


def available() -> bool:
    return importlib.util.find_spec(MODULE_NAME) is not None


def adapter() -> dict:
    return {
        "name": 'strands',
        "description": DESCRIPTION,
        "available": available(),
        "module": MODULE_NAME,
    }
