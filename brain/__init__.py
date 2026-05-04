"""
brain — SwarmX Compatibility Brain Module
=========================================
Compatibility API for legacy brain/ call sites.

This package remains available for transition safety, but canonical runtime
entrypoints now live under src/swarmx (CLI/server APIs). Import from here only
when maintaining legacy integrations.

Usage:
    from brain import run_task, run_task_sync, autonomous_run
    from brain import plan_task, dispatch, route, reflect
"""
from __future__ import annotations

# Core async entry points
from brain.orchestrator import run_task, run_task_sync  # noqa: F401

# Loop (autonomous multi-iteration)
from brain.loop import autonomous_run, autonomous_run_sync, score_output  # noqa: F401

# Planning
from brain.planner import plan_task, plan_task_sync  # noqa: F401

# Dispatch / routing
from brain.dispatcher import dispatch, dispatch_sync, classify  # noqa: F401
from brain.router import route, route_sync, run_model, run_model_sync, detect_intent  # noqa: F401

# Reflection
from brain.reflector import reflect, reflect_sync  # noqa: F401

# Memory
from brain.memory import store, load_all, search, clear  # noqa: F401

# RAG enrichment
from brain.rag import enrich  # noqa: F401

# Graph execution
from brain.graph import TaskGraph, TaskNode, TaskNodeResult, build_graph_from_plan  # noqa: F401

__all__ = [
    # Orchestration
    "run_task", "run_task_sync",
    "autonomous_run", "autonomous_run_sync",
    # Planning
    "plan_task", "plan_task_sync",
    # Dispatch
    "dispatch", "dispatch_sync", "classify",
    "route", "route_sync", "run_model", "run_model_sync", "detect_intent",
    # Reflection
    "reflect", "reflect_sync",
    # Memory
    "store", "load_all", "search", "clear",
    # RAG
    "enrich",
    # Quality
    "score_output",
    # Graph
    "TaskGraph", "TaskNode", "TaskNodeResult", "build_graph_from_plan",
]