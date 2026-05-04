from __future__ import annotations

from .adk import adapter as adk_adapter
from .agent_framework import adapter as agent_framework_adapter
from .autogen import adapter as autogen_adapter
from .crewai import adapter as crewai_adapter
from .langgraph import adapter as langgraph_adapter
from .mcp import adapter as mcp_adapter
from .openai_agents import adapter as openai_agents_adapter
from .strands import adapter as strands_adapter

ADAPTERS = {
    "openai_agents": openai_agents_adapter,
    "langgraph": langgraph_adapter,
    "agent_framework": agent_framework_adapter,
    "crewai": crewai_adapter,
    "autogen": autogen_adapter,
    "adk": adk_adapter,
    "strands": strands_adapter,
    "mcp": mcp_adapter,
}


def adapter_matrix() -> list[dict]:
    return [fn() for fn in ADAPTERS.values()]


def enabled_adapters() -> list[str]:
    return [row["name"] for row in adapter_matrix() if row.get("available")]


def adapter_summary() -> str:
    ready = enabled_adapters()
    if ready:
        return "Available adapters: " + ", ".join(ready)
    return "No optional framework adapters detected; running in built-in mode."


def preferred_orchestrator() -> str:
    for candidate in ("langgraph", "agent_framework", "adk", "crewai", "autogen", "strands"):
        if candidate in enabled_adapters():
            return candidate
    return "builtin"


def ready_adapters() -> list[str]:
    return enabled_adapters()
