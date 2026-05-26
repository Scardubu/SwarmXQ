"""
src/swarmx/llm_patch_r7.py
─────────────────────────────────────────────────────────────────────────────
SwarmXQ APEX-17 r7 — LLM Patch Instructions

This file documents the exact surgical edits required in src/swarmx/llm.py.
Because llm.py is 1569 lines, this patch file contains:

  1. A header rewrite (lines 8–16)
  2. Canonical-tag prepend blocks for _MODEL_TEMPERATURES and _MODEL_TOP_P
  3. An optional choose_model() canonicalization snippet

The TS layer (model-orchestrator.ts) already canonicalizes through
resolveCanonicalTag(); these patches bring the Python layer to parity.

Apply via scripts/migrate-to-r7.sh --apply, OR manually with the patterns
described below.
─────────────────────────────────────────────────────────────────────────────
"""

# ─── PATCH 1 — HEADER (replace lines 8–16) ───────────────────────────────────
HEADER_OLD = """  phi4-router-lite-scar — Ultra-router    · intent classification, safety gate (~2.5 GB, Q4_K_M)
  phi4-fast-scar        — Fast orchestrator · routing, Q&A, session management (~4.0 GB, Q8_0)
  deepseek-reasoner-scar — Reasoning Engine · planning, architecture, logic chains (~4.7 GB)
  qwen-worker-scar       — Execution Engine · code generation, tool-use, agentic tasks (~5.0 GB)

  phi4-mini      → phi4-fast-scar
  deepseek-r1:7b → deepseek-reasoner-scar
  qwen2.5-coder  → qwen-worker-scar"""

HEADER_NEW = """  Relay   (route-phi4-lite-q4km-prod)        — Ultra-router    · intent classification, safety gate (~2.5 GB, Q4_K_M)
  Pilot   (instruct-phi4-pro-q8-prod)        — Fast orchestrator · routing, Q&A, session management (~4.3 GB, Q8_0)
  Oracle  (reason-deepseekr1-pro-q5km-prod)  — Reasoning Engine · planning, architecture, logic chains (~5.4 GB, Q5_K_M)
  Forge   (code-qwen25-pro-q5km-prod)        — Execution Engine · code generation, tool-use, agentic tasks (~5.4 GB, Q5_K_M)

  Legacy aliases resolve through operator_map.py automatically:
    phi4-fast-scar         → instruct-phi4-pro-q8-prod   (Pilot)
    deepseek-reasoner-scar → reason-deepseekr1-pro-q5km-prod  (Oracle)
    qwen-worker-scar       → code-qwen25-pro-q5km-prod   (Forge)"""


# ─── PATCH 2 — Prepend canonical entries to _MODEL_TEMPERATURES ──────────────
# Insert immediately AFTER the line `_MODEL_TEMPERATURES: dict[str, float] = {`
# and BEFORE the existing `# APEX-17 canonical -scar tags` comment.

TEMPERATURE_PREPEND = '''    # ── APEX-17 r7 canonical production tags  [LLM-r7-01] ────────────────────
    "route-phi4-lite-q4km-prod":          0.00,  # Relay     — deterministic classification
    "instruct-phi4-pro-q8-prod":          0.20,  # Pilot     — fast chat
    "plan-phi4-pro-q8-prod":              0.20,  # Architect (phi4)
    "plan-qwen25-pro-q5km-prod":          0.15,  # Architect (qwen25)
    "plan-deepseekr1-pro-q5km-prod":      0.40,  # Architect (deepseek)
    "code-qwen25-pro-q5km-prod":          0.15,  # Forge
    "reason-deepseekr1-pro-q5km-prod":    0.40,  # Oracle
    "critique-deepseekr1-pro-q5km-prod":  0.35,  # Auditor
    "synth-phi4-exp-q8-dev":              0.25,  # Lab (phi4)
    "synth-qwen25-exp-q5km-dev":          0.20,  # Lab (qwen25)
    "synth-deepseekr1-exp-q5km-dev":      0.40,  # Lab (deepseek)
'''


# ─── PATCH 3 — Prepend canonical entries to _MODEL_TOP_P ─────────────────────

TOP_P_PREPEND = '''    # ── APEX-17 r7 canonical production tags  [LLM-r7-01] ────────────────────
    "route-phi4-lite-q4km-prod":          0.90,  # Relay
    "instruct-phi4-pro-q8-prod":          0.90,  # Pilot
    "plan-phi4-pro-q8-prod":              0.90,  # Architect (phi4)
    "plan-qwen25-pro-q5km-prod":          0.95,  # Architect (qwen25)
    "plan-deepseekr1-pro-q5km-prod":      0.92,  # Architect (deepseek)
    "code-qwen25-pro-q5km-prod":          0.95,  # Forge
    "reason-deepseekr1-pro-q5km-prod":    0.92,  # Oracle
    "critique-deepseekr1-pro-q5km-prod":  0.92,  # Auditor
    "synth-phi4-exp-q8-dev":              0.92,  # Lab (phi4)
    "synth-qwen25-exp-q5km-dev":          0.95,  # Lab (qwen25)
    "synth-deepseekr1-exp-q5km-dev":      0.92,  # Lab (deepseek)
'''


# ─── PATCH 4 — Add operator_map import (top of file, after existing imports) ─

IMPORT_ADDITION = '''
from .operator_map import (
    resolve_canonical_tag,
    resolve_operator_name,
    format_operator_label,
)
'''


# ─── PATCH 5 — Insert canonicalization in choose_model() / generate() ────────
#
# At the entry point of every generate() / choose_model() / _ollama_generate()
# function, add ONE line that normalizes the model tag through the canonical
# alias map. The lookup function uses startswith() so canonical tags will
# match first since they appear earlier in the dict.
#
# Example insertion (in generate(), near top of function body):

CANONICALIZATION_SNIPPET = '''
    # [LLM-r7-02] Canonicalize model tag at entry — legacy -scar tags
    # automatically resolve to their canonical production names.
    model = resolve_canonical_tag(model)
'''


# ─── PATCH APPLICATION HELPER ────────────────────────────────────────────────

def apply_patches_manually() -> str:
    """Return a human-readable description of the patches to apply."""
    return """
APEX-17 r7 — llm.py Patch Application Instructions
══════════════════════════════════════════════════════════════════════

This patch upgrades llm.py to canonical naming + operator awareness.

STEP 1: Update header comment (lines 8–16)
   Replace HEADER_OLD with HEADER_NEW.

STEP 2: Add operator_map import after existing relative imports
   from .operator_map import (
       resolve_canonical_tag,
       resolve_operator_name,
       format_operator_label,
   )

STEP 3: Prepend canonical entries to _MODEL_TEMPERATURES
   Insert TEMPERATURE_PREPEND immediately after the opening brace.
   Keep existing -scar and pre-scar entries below.

STEP 4: Prepend canonical entries to _MODEL_TOP_P
   Insert TOP_P_PREPEND immediately after the opening brace.
   Keep existing -scar and pre-scar entries below.

STEP 5 (optional but recommended): Add canonicalization snippet at entry
   of generate(), choose_model(), _ollama_generate(), and
   _ollama_generate_stream(). This ensures any legacy tag is resolved
   to canonical before reaching the temperature/top_p lookup.

STEP 6: Run validation
   python -m pytest tests/test_naming_validation.py -v

The scripts/migrate-to-r7.sh script automates steps 1-5 via sed/awk
with backups to .r6-backup/ and verifies the result.
"""


if __name__ == "__main__":
    print(apply_patches_manually())
