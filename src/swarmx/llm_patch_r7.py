"""
src/swarmx/llm_patch_r7.py
─────────────────────────────────────────────────────────────────────────────
APEX-17 r7 — LLM Temperature/TopP Migration Patch

Apply: prepend canonical tag entries to _MODEL_TEMPERATURES and _MODEL_TOP_P
in src/swarmx/llm.py. Keep existing -scar and legacy entries for compatibility.

Also update the docstring header (lines 8-16) to use canonical tags.
─────────────────────────────────────────────────────────────────────────────

CHANGE 1: Replace header comment (lines 8-16)
───────────────────────────────────────────────────────────────────────────────

OLD:
  phi4-router-lite-scar — Ultra-router    · intent classification, safety gate ...
  phi4-fast-scar        — Fast orchestrator · routing, Q&A, session management ...
  deepseek-reasoner-scar — Reasoning Engine · planning, architecture, logic chains ...
  qwen-worker-scar       — Execution Engine · code generation, tool-use, agentic tasks ...

  phi4-mini      → phi4-fast-scar
  deepseek-r1:7b → deepseek-reasoner-scar
  qwen2.5-coder  → qwen-worker-scar

NEW:
  Relay   (route-phi4-lite-q4km-prod)    — Ultra-router    · intent classification, safety gate (~2.5 GB, Q4_K_M)
  Pilot   (instruct-phi4-pro-q8-prod)   — Fast orchestrator · routing, Q&A, session management (~4.3 GB, Q8_0)
  Oracle  (reason-deepseekr1-pro-q5km-prod) — Reasoning Engine · planning, architecture, logic chains (~5.4 GB, Q5_K_M)
  Forge   (code-qwen25-pro-q5km-prod)   — Execution Engine · code generation, tool-use, agentic tasks (~5.4 GB, Q5_K_M)

  Legacy aliases resolve through operator_map.py:
    phi4-fast-scar     → instruct-phi4-pro-q8-prod
    deepseek-reasoner-scar → reason-deepseekr1-pro-q5km-prod
    qwen-worker-scar   → code-qwen25-pro-q5km-prod


CHANGE 2: Prepend canonical entries to _MODEL_TEMPERATURES
───────────────────────────────────────────────────────────────────────────────

Insert BEFORE the existing -scar entries (which stay for compatibility):
"""

_MODEL_TEMPERATURES_CANONICAL = {
    # APEX-17 r7 canonical production tags  [LLM-r7-01]
    "route-phi4-lite-q4km-prod":            0.00,  # Relay — deterministic classification
    "instruct-phi4-pro-q8-prod":            0.20,  # Pilot — fast chat
    "plan-phi4-pro-q8-prod":                0.20,  # Architect (phi4)
    "plan-qwen25-pro-q5km-prod":            0.15,  # Architect (qwen25)
    "plan-deepseekr1-pro-q5km-prod":        0.40,  # Architect (deepseek)
    "code-qwen25-pro-q5km-prod":            0.15,  # Forge
    "reason-deepseekr1-pro-q5km-prod":      0.40,  # Oracle
    "critique-deepseekr1-pro-q5km-prod":    0.35,  # Auditor
    "synth-phi4-exp-q8-dev":                0.25,  # Lab (phi4)
    "synth-qwen25-exp-q5km-dev":            0.20,  # Lab (qwen25)
    "synth-deepseekr1-exp-q5km-dev":        0.40,  # Lab (deepseek)
}

_MODEL_TOP_P_CANONICAL = {
    # APEX-17 r7 canonical production tags  [LLM-r7-01]
    "route-phi4-lite-q4km-prod":            0.90,  # Relay
    "instruct-phi4-pro-q8-prod":            0.90,  # Pilot
    "plan-phi4-pro-q8-prod":                0.90,  # Architect (phi4)
    "plan-qwen25-pro-q5km-prod":            0.95,  # Architect (qwen25)
    "plan-deepseekr1-pro-q5km-prod":        0.92,  # Architect (deepseek)
    "code-qwen25-pro-q5km-prod":            0.95,  # Forge
    "reason-deepseekr1-pro-q5km-prod":      0.92,  # Oracle
    "critique-deepseekr1-pro-q5km-prod":    0.92,  # Auditor
    "synth-phi4-exp-q8-dev":                0.92,  # Lab (phi4)
    "synth-qwen25-exp-q5km-dev":            0.95,  # Lab (qwen25)
    "synth-deepseekr1-exp-q5km-dev":        0.92,  # Lab (deepseek)
}

"""
Merge strategy: prepend canonical entries, keep legacy entries below.
The lookup function already uses startswith() — canonical tags will match
first since they appear earlier in the dict.

Final _MODEL_TEMPERATURES should look like:

    _MODEL_TEMPERATURES: dict[str, float] = {
        # APEX-17 r7 canonical production tags  [LLM-r7-01]
        "route-phi4-lite-q4km-prod":         0.00,  # Relay
        "instruct-phi4-pro-q8-prod":         0.20,  # Pilot
        ...
        # APEX-17 r1-r6 -scar tags (compat)  [LLM-APEX17-01]
        "phi4-router-lite-scar":             0.00,
        ...
        # Pre-APEX-17 and legacy aliases (compat)
        "phi4-fast":                         0.20,
        ...
    }
"""
