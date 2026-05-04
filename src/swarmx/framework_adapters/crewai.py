from __future__ import annotations

import importlib.util

DESCRIPTION = 'CrewAI Flows, checkpointing, and human feedback'
MODULE_NAME = 'crewai'


def available() -> bool:
    return importlib.util.find_spec(MODULE_NAME) is not None


def adapter() -> dict:
    return {
        "name": 'crewai',
        "description": DESCRIPTION,
        "available": available(),
        "module": MODULE_NAME,
    }
