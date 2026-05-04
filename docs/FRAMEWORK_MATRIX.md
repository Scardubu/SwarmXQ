# Framework Matrix

SwarmX can coordinate multiple agent ecosystems and prefers the best available orchestrator for the current machine.

| Framework | Role | Notes |
| --- | --- | --- |
| LangGraph | Cyclic workflow backbone | Good for stateful routing, checkpoints, and self-correction loops. |
| CrewAI | Role-based crew execution | Good for structured multi-role collaboration. |
| AutoGen | Event-driven collaboration | Useful for agent-to-agent conversation and tool handoffs. |
| Microsoft Agent Framework | Successor path | Preferred when building modern tool-rich agent apps. |
| OpenAI Agents SDK / Responses API | Model-native tools and traces | Strong for built-in tool calling, traces, and guarded execution. |
| Google ADK | Agent development kit | Good for task flows, build/debug loops, and structured orchestration. |
| Strands Agents | Meta-tooling and swarms | Useful for model-driven, tool-aware agent systems. |
| MCP | Tool transport and context | Standardized external tool and server connectivity. |
