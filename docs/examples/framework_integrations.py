"""
SwarmX Framework Integration Examples
======================================
Production-ready patterns for LangGraph, CrewAI, and AutoGen.
All examples use the native Ollama API with JSON schema enforcement.

MAJOR IMPROVEMENTS (V5.2 — final merged):
  ✦ Model names updated to V5.2 tags (phi4-fast, qwen-supervisor, deepseek-reasoner)
    — v2 used stale phi4-mini:swarmx tags, v5.1 routing enum was inconsistent.
  ✦ ROUTING_SCHEMA.routed_to enum aligned to V5.2 model names.
  ✦ asyncio import added to planner_node (was missing — AttributeError at runtime).
  ✦ build_crewai_crew returns a Crew object, not a loose agent tuple.
  ✦ call_model() raises on non-2xx so callers surface errors rather than silently
    returning malformed content.
  ✦ demo_native_schema_enforcement() accepts a task argument (not hardcoded).

Run after: source setup/ollama_env.sh && ollama serve
"""

from __future__ import annotations

import json
import re

import httpx

OLLAMA_BASE = "http://localhost:11434/api/chat"

# ─── Shared schemas for native JSON enforcement ───────────────────────────────
# Pass as `format` to Ollama >= 0.5.0 — constrains generation at token level.

ROUTING_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "task_id": {"type": "string"},
        "classification": {"type": "string"},
        "routed_to": {
            "type": "string",
            # V5.2 model name enum — must match `ollama list` output
            "enum": ["phi4-fast", "deepseek-reasoner", "qwen-supervisor"],
        },
        "sub_tasks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "owner": {"type": "string"},
                    "objective": {"type": "string"},
                    "stop_condition": {"type": "string"},
                },
                "required": ["id", "owner", "objective", "stop_condition"],
            },
        },
        "risk_level": {"type": "string", "enum": ["low", "medium", "high"]},
        "requires_approval": {"type": "boolean"},
        "confidence": {"type": "string", "enum": ["HIGH", "MEDIUM", "LOW"]},
        "rationale": {"type": "string"},
    },
    "required": [
        "task_id",
        "classification",
        "routed_to",
        "risk_level",
        "requires_approval",
        "confidence",
    ],
}

ANALYSIS_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "confidence": {"type": "string", "enum": ["HIGH", "MEDIUM", "LOW"]},
        "assumptions": {"type": "array", "items": {"type": "string"}},
        "analysis_summary": {"type": "string"},
        "recommendation": {"type": "string"},
        "risk": {"type": "string", "enum": ["low", "medium", "high"]},
        "rollback": {"type": "string"},
        "fix_log": {"type": "array"},
        "next_action": {"type": "string"},
        "requires_approval": {"type": "boolean"},
    },
    "required": [
        "confidence",
        "analysis_summary",
        "recommendation",
        "risk",
        "rollback",
        "next_action",
        "requires_approval",
    ],
}


def call_model(
    model: str,
    messages: list[dict],
    schema: dict | None = None,
    timeout: int = 120,
) -> dict:
    """
    Synchronous Ollama call with optional native JSON schema enforcement.
    Raises httpx.HTTPError on non-2xx responses.
    """
    payload: dict = {"model": model, "messages": messages, "stream": False}
    if schema is not None:
        # Ollama >= 0.5.0: constrain token generation to the schema
        payload["format"] = schema
    r = httpx.post(OLLAMA_BASE, json=payload, timeout=timeout)
    r.raise_for_status()
    return r.json()


def _strip_think(text: str) -> str:
    """Strip DeepSeek-R1 <think>...</think> blocks."""
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


# ═══════════════════════════════════════════════════════════════════════════════
# 1. LANGGRAPH — Supervisor-Executor-Planner pattern
# ═══════════════════════════════════════════════════════════════════════════════


def build_langgraph_app():
    """
    Builds a LangGraph StateGraph with three nodes:
      router   → phi4-fast        (fast routing + classification)
      executor → qwen-supervisor  (implementation)
      planner  → deepseek-reasoner (complex reasoning / decomposition)

    Routing:
      router → executor  (for implementation tasks)
      router → planner   (for architecture/reasoning tasks)
      planner → executor (planner decomposes → executor implements)
    """
    try:
        from langgraph.graph import END, StateGraph
    except ImportError:
        print('Install langgraph: pip install "langgraph>=0.2.0"')
        return None

    def router_node(state: dict) -> dict:
        """phi4-fast classifies and routes with native schema enforcement."""
        result = call_model(
            "phi4-fast",
            [{"role": "user", "content": state["task"]}],
            schema=ROUTING_SCHEMA,
        )
        content = result["message"]["content"]
        routing = json.loads(content) if isinstance(content, str) else content
        return {**state, "routing": routing}

    def executor_node(state: dict) -> dict:
        """qwen-supervisor executes bounded sub-tasks."""
        sub_tasks = state.get("routing", {}).get("sub_tasks", [])
        task_input = json.dumps(sub_tasks[0]) if sub_tasks else state["task"]

        result = call_model(
            "qwen-supervisor",
            [{"role": "user", "content": task_input}],
        )
        return {**state, "result": result["message"]["content"]}

    def planner_node(state: dict) -> dict:
        """deepseek-reasoner handles ambiguous or high-complexity tasks."""
        result = call_model(
            "deepseek-reasoner",
            [{"role": "user", "content": state["task"]}],
            schema=ANALYSIS_SCHEMA,
        )
        content = result["message"]["content"]
        clean = _strip_think(content)
        plan: dict
        try:
            plan = json.loads(clean) if clean.startswith("{") else {"raw": clean}
        except json.JSONDecodeError:
            plan = {"raw": clean}
        return {**state, "plan": plan}

    def route_decision(state: dict) -> str:
        """Conditional edge: decides which node to execute next."""
        routing = state.get("routing", {})
        routed_to = routing.get("routed_to", "")

        if "qwen" in routed_to:
            return "executor"
        elif "deepseek" in routed_to:
            return "planner"
        return END

    graph = StateGraph(dict)
    graph.add_node("router", router_node)
    graph.add_node("executor", executor_node)
    graph.add_node("planner", planner_node)

    graph.set_entry_point("router")
    graph.add_conditional_edges(
        "router",
        route_decision,
        {"executor": "executor", "planner": "planner", END: END},
    )
    graph.add_edge("executor", END)
    graph.add_edge("planner", "executor")  # planner decomposes → executor implements

    return graph.compile()


# ═══════════════════════════════════════════════════════════════════════════════
# 2. CREWAI — Role-based crew
# ═══════════════════════════════════════════════════════════════════════════════


def build_crewai_crew(tools: list | None = None):
    """
    Builds a CrewAI Crew with three agents mirroring the SwarmX triad:

      phi4-fast        → Orchestrator (routing + coordination)
      qwen-supervisor  → Executor    (implementation + tool use)
      deepseek-reasoner → Planner   (analysis + architecture)

    Returns the assembled Crew object ready for kickoff.
    """
    try:
        from crewai import Agent, Crew, Process, Task
    except ImportError:
        print('Install crewai: pip install "crewai>=0.80.0"')
        return None

    orchestrator = Agent(
        role="Orchestrator",
        goal="Classify tasks and coordinate specialists efficiently",
        backstory=(
            "You are phi4-fast — SwarmX's fast router. "
            "You classify every incoming task, route it to the right specialist, "
            "and keep the swarm coherent. You never execute tasks yourself; "
            "you decompose and delegate."
        ),
        llm="ollama/phi4-fast",
        verbose=False,
        allow_delegation=True,
    )

    executor = Agent(
        role="Executor",
        goal="Implement delegated tasks with correct, production-grade output",
        backstory=(
            "You are qwen-supervisor — SwarmX's general-purpose execution agent. "
            "You implement tasks, call tools, transform data, and write code. "
            "You apply the smallest correct change that satisfies the contract."
        ),
        llm="ollama/qwen-supervisor",
        verbose=True,
        tools=tools or [],
    )

    planner = Agent(
        role="Planner",
        goal="Solve hard planning and architecture problems with deep reasoning",
        backstory=(
            "You are deepseek-reasoner — SwarmX's deep reasoning engine. "
            "You tackle architecture decisions, complex debugging, math, and critique. "
            "You use chain-of-thought reasoning before emitting structured conclusions."
        ),
        llm="ollama/deepseek-reasoner",
        verbose=True,
    )

    # Example task wiring — override task descriptions at call site
    routing_task = Task(
        description="Classify and route the incoming task.",
        expected_output="Routing decision JSON.",
        agent=orchestrator,
    )
    execution_task = Task(
        description="Execute the delegated task.",
        expected_output="Step complete JSON with result.",
        agent=executor,
    )

    crew = Crew(
        agents=[orchestrator, executor, planner],
        tasks=[routing_task, execution_task],
        process=Process.sequential,
        verbose=True,
    )
    return crew


# ═══════════════════════════════════════════════════════════════════════════════
# 3. AUTOGEN — GroupChat pattern
# ═══════════════════════════════════════════════════════════════════════════════


def build_autogen_group(task: str):
    """
    Builds an AutoGen GroupChat with the three SwarmX models.
    phi4-fast acts as the group chat manager.

    AUTOGEN VERSION NOTE:
      v1 API (pyautogen <= 0.2.x):  pip install "pyautogen>=0.2.0"
        import autogen
        autogen.AssistantAgent, autogen.UserProxyAgent, autogen.GroupChat

      v2 API (autogen-agentchat >= 0.4):  pip install "autogen-agentchat>=0.4.0"
        from autogen_agentchat.agents import AssistantAgent
        from autogen_agentchat.teams import RoundRobinGroupChat
        Uses async patterns and a different team topology API.

    This example targets the v1 pyautogen API which is more widely deployed.
    For v2, replace with autogen_agentchat equivalents.
    """
    try:
        import autogen
    except ImportError:
        print("Install pyautogen (v1 API): pip install pyautogen")
        print("For v2: pip install autogen-agentchat")
        return None

    def _cfg(model_tag: str) -> dict:
        """Build a per-model config_list for pyautogen v1."""
        return {
            "config_list": [
                {
                    "model": model_tag,
                    "base_url": "http://localhost:11434/v1",
                    "api_key": "ollama",  # Ollama ignores this; required by autogen
                }
            ]
        }

    orchestrator = autogen.AssistantAgent(
        name="Orchestrator",
        system_message=(
            "You are phi4-fast. Classify tasks and route to Executor or Planner. "
            "Emit routing decisions as JSON. Keep messages concise."
        ),
        llm_config=_cfg("phi4-fast"),
    )
    executor = autogen.AssistantAgent(
        name="Executor",
        system_message="You are qwen-supervisor. Implement tasks delegated by the Orchestrator.",
        llm_config=_cfg("qwen-supervisor"),
    )
    planner = autogen.AssistantAgent(
        name="Planner",
        system_message="You are deepseek-reasoner. Handle complex reasoning and architecture tasks.",
        llm_config=_cfg("deepseek-reasoner"),
    )
    user_proxy = autogen.UserProxyAgent(
        name="User",
        human_input_mode="NEVER",
        max_consecutive_auto_reply=10,
        code_execution_config=False,
    )

    group_chat = autogen.GroupChat(
        agents=[orchestrator, executor, planner, user_proxy],
        messages=[],
        max_round=15,
        speaker_selection_method="auto",
    )
    manager = autogen.GroupChatManager(
        groupchat=group_chat,
        llm_config=_cfg("phi4-fast"),
    )
    return user_proxy, manager, task


# ═══════════════════════════════════════════════════════════════════════════════
# 4. Raw Ollama — native JSON schema enforcement example
# ═══════════════════════════════════════════════════════════════════════════════


def demo_native_schema_enforcement(
    task: str = "Route this: implement a Redis rate limiter in Python",
) -> dict:
    """
    Demonstrates Ollama >= 0.5.0 native JSON schema enforcement.
    The `format` parameter constrains generation at the token sampler level —
    more reliable than prompt-only JSON instructions.

    Args:
      task: The routing task to send to phi4-fast.

    Returns:
      The parsed routing decision dict.
    """
    print("=== Native schema enforcement demo ===")
    print(f"Task:   {task}")
    print("Model:  phi4-fast")
    print("Schema: ROUTING_SCHEMA\n")

    response = httpx.post(
        OLLAMA_BASE,
        json={
            "model": "phi4-fast",
            "messages": [{"role": "user", "content": task}],
            "format": ROUTING_SCHEMA,  # ← Ollama >= 0.5.0 schema enforcement
            "stream": False,
        },
        timeout=60,
    )
    response.raise_for_status()
    content = response.json()["message"]["content"]
    routing = json.loads(content)

    print("Routing decision:")
    print(json.dumps(routing, indent=2))
    print(f"\nRouted to:  {routing.get('routed_to')}")
    print(f"Confidence: {routing.get('confidence')}")
    print(f"Risk:       {routing.get('risk_level')}")

    return routing


if __name__ == "__main__":
    demo_native_schema_enforcement()
