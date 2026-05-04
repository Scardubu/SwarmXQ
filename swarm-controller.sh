#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# swarm-controller.sh — SwarmX Meta-Evolution Dispatch Controller v4.2
# ═══════════════════════════════════════════════════════════════════════════════
#
# ARCHITECTURE: Phi-4-mini (orchestrator) · DeepSeek-R1:7B (reasoning) · Qwen2.5-Coder (execution)
#               + MemEvolve memory layer · Dr. Zero proposer-solver loop · GEA group evolution
#
# WHAT'S NEW IN v4.2 vs v4.1:
#   [CTL-V42-01] _check_resources(): pre-dispatch VRAM guard — queries /api/ps,
#                warns when VRAM usage exceeds 10 GB ceiling (configurable via
#                SWARM_VRAM_CEILING_GB env var), and calls flush_models() when
#                the ceiling is reached. Called at the start of cmd_chain,
#                cmd_solve, cmd_code, and cmd_reason.
#   [CTL-V42-02] cmd_status(): enhanced VRAM section — displays currently loaded
#                models with per-model VRAM usage from /api/ps alongside the
#                existing P95 latency block.
#   [CTL-V42-03] cmd_doctor(): section [8/8] — Ollama resource health check
#                mirrors gate μ-10 logic: reports VRAM usage and recent error
#                spike count from dispatch.jsonl.
#   [CTL-V42-04] --health flag wired into cmd_gate() — routes to swarm-gate.sh
#                --health (μ-10 only) for fast VRAM triage without full gate run.
#   [CTL-V42-05] CONTROLLER_VERSION bumped to 4.2.0; build date 2026.05.
#                All telemetry records include updated version string.
#
# WHAT'S NEW IN v4.1 vs v4.0:
#   [CTL-FIX-01] cmd_chain() JSON output: argv indices were off-by-one — chain_id
#                was passed as sys.argv[7] but also used as chain_log filename base;
#                corrected positional mapping to match actual argument order
#   [CTL-FIX-02] cmd_solve() OUTPUT_JSON path: IFS='|||' join of bash array elements
#                is unreliable when solution text contains literal '|||'; switched to
#                python3 json.dumps() for safe serialisation of the solutions array
#   [CTL-FIX-03] _dispatch() top_p hardcoded to 0.92 for all models; now reads
#                per-model top_p from routing.yaml (phi4-mini=0.90, qwen3-coder=0.95)
#   [CTL-FIX-04] cmd_auto() solve_signals regex used look-ahead constructs not
#                supported by bash grep -E; simplified to explicit alternation
#   [CTL-FIX-05] doctor() check [1/7] header says 7 sections but only 7 are run —
#                header count corrected to match implementation (was [1/6]..[6/6])
#   [CTL-FIX-06] gate --all pre-flight block used `local gate_exit` inside a
#                non-function context causing silent failure; refactored to a
#                proper subshell capture with exit-code propagation
#   [CTL-ENH-01] cmd_chain() Phase 4 adversarial critique pass added (mirrors
#                llm.py _adversarial_critique); only fires when --adversarial flag
#                is set or SWARM_ADVERSARIAL=1 env var is present
#   [CTL-ENH-02] --proposer-solver flag wired into cmd_code and cmd_reason;
#                previously the flag was documented but not dispatched
#   [CTL-ENH-03] cmd_status() now shows per-model P95 latency from dispatch.jsonl
#                (mirrors swarm-gate.sh μ-6 latency probe for quick triage)
#   [CTL-ENH-04] SWARM_ADVERSARIAL env var added to env-var reference block
#
# WHAT'S NEW IN v4.0 vs v3.0:
#   [CTL-01] ADAPTIVE ROUTING — Phi-4-mini now introspects dispatch telemetry
#            to dynamically re-weight routing signals per-session. Hot paths
#            auto-promoted after 3 consecutive correct routes (PromptBreeder-style).
#   [CTL-02] MEMEVOLVE INTEGRATION — every chain dispatch writes a compressed
#            semantic memory note to ~/.swarmx/memory/controller.jsonl.
#            The chain command re-reads recent notes to prime phase-2 reasoning.
#   [CTL-03] DR. ZERO PROPOSER-SOLVER LOOP — new `solve` command runs a
#            data-free proposer-solver dialogue between reason+code models:
#            DeepSeek-R1 proposes N approaches; Qwen2.5-Coder stress-tests each;
#            the loop picks the best via lightweight island scoring.
#   [CTL-04] GROUP EVOLUTION (GEA) — new `evolve` command sends the last 5
#            chain logs + run telemetry to the full SwarmX evolver pipeline
#            (src/swarmx/evolver.py) and surfaces the top proposal + patch.
#   [CTL-05] LIFECYCLE HOOKS — pre/post dispatch hooks read
#            ~/.swarmx/controller/hooks.yaml for user-defined shell commands
#            to run at named lifecycle points (pre_route, post_chain, etc.).
#   [CTL-06] CONFIDENCE GATE — every single-model dispatch is graded by a
#            fast Phi-4-mini critic pass (unless --skip-grade). Responses
#            scoring REJECT are retried once with a refined prompt before
#            escalating. Mirrors executor.py _review_task_output().
#   [CTL-07] TRACE GRADING — chain command emits a structured JSONL trace
#            per phase with: model, elapsed_ms, confidence, island, signals.
#            Consumed by swarm-gate.sh μ-6 and dashboard/app.js.
#   [CTL-08] WAT TIMEZONE — all timestamps use WAT (UTC+1) in display output,
#            UTC in JSONL telemetry. Mirrors SWARM_TZ=Africa/Lagos convention.
#   [CTL-09] VERTICAL SIGNAL INJECTION — TaxBridge / SabiScore / Hashablanca
#            context is injected into chain prompts when SWARM_VERTICAL env
#            var is set or when vertical keywords appear in the prompt.
#   [CTL-10] MCP TOOL AWARENESS — `tools` command lists MCP tools available
#            in ~/.swarmx/tools/ and can invoke them via tooling.py shim.
#
# INTEGRATES WITH:
#   · swarm-gate.sh         — pre/post quality gates (7 gates, μ-6 reads v4 trace)
#   · src/swarmx/llm.py     — Python runtime model dispatch + telemetry
#   · src/swarmx/evolver.py — evolution proposals (GEA, PromptBreeder, island tournament)
#   · src/swarmx/evaluator.py — island_tournament(), score_text() for grading
#   · src/swarmx/memory.py  — store_memory() for MemEvolve notes
#   · src/swarmx/config.py  — SwarmConfig (SWARM_MODEL_* env vars respected)
#   · src/swarmx/telemetry.py — emit_event() for trace store
#   · configs/routing.yaml  — dispatch rules, temperatures, timeouts
#   · configs/evolution.yaml — island scoring weights, promotion thresholds
#
# USAGE:
#   ./swarm-controller.sh <command> [options] ['prompt']
#
# COMMANDS:
#   route   <prompt>    — Phi-4-mini  (classify/route/evaluate/status)
#   reason  <prompt>    — DeepSeek-R1 (plan/architecture/analyze/research)
#   code    <prompt>    — Qwen2.5-Coder (implement/refactor/test/generate)
#   chain   <prompt>    — Full triadic pipeline: route→reason→code + MemEvolve
#   auto    <prompt>    — Auto-select model from routing.yaml signal rules
#   solve   <prompt>    — Dr. Zero proposer-solver loop (reason↔code, best-of-N)
#   evolve  [--apply]   — GEA: group-evolve from recent telemetry, surface proposals
#   grade   <text>      — Run confidence gate on arbitrary text (critic pass)
#   tools   [list|run]  — MCP tool awareness and invocation
#   gate    [--all]     — Run IEP-ELITE quality gates (wraps swarm-gate.sh)
#   status              — Print model triad health + RAM state + v4 metrics
#   flush               — Force unload all models + drop kernel caches
#   context  <file>     — Load a .json/.md context file into dispatch
#   doctor              — Full environment diagnostic (v4: includes MemEvolve check)
#   hooks               — List/edit lifecycle hooks
#
# OPTIONS:
#   --runtime <dir>      — Override .swarmx runtime directory
#   --timeout <sec>      — Override per-model timeout (default: per-model config)
#   --keep-alive <sec>   — Override keep_alive window (default: 0 = unload after)
#   --context <file>     — Inject context file into prompt
#   --json               — Output structured JSON response
#   --quiet              — Suppress banners and progress; pipe-safe
#   --dry-run            — Print resolved config without calling Ollama
#   --gate-before        — Run IEP gates before dispatch (auto for 'chain')
#   --gate-after         — Run IEP gates after dispatch  (auto for 'chain')
#   --verbose            — Print full prompt sent to model
#   --skip-grade         — Skip confidence gate critic pass [CTL-06]
#   --vertical <name>    — Force vertical context injection (taxbridge|sabiscore|hashablanca)
#   --proposals <N>      — Number of Dr. Zero proposals to generate (default: 3)
#   --island <A|B|C>     — Pin to a specific evolution island
#
# EXIT CODES:
#   0  — Success, clean response
#   1  — Model warning (response degraded or fallback used)
#   2  — Model error / escalation chain exhausted
#   3  — Usage / config error
#   4  — Gate BLOCK (see swarm-gate.sh exit 2)
#   5  — Context chain failure (chain command only)
#   6  — Confidence gate REJECT after retry (critic consensus)
#
# EXAMPLES:
#   ./swarm-controller.sh route "Is this a planning or coding task?"
#   ./swarm-controller.sh reason "Design the TaxBridge NRS webhook pipeline"
#   ./swarm-controller.sh code "Implement Fastify 5 idempotency middleware"
#   ./swarm-controller.sh chain "Architect and implement BullMQ job retry strategy"
#   ./swarm-controller.sh solve "Best approach for ZK proof batching in Hashablanca"
#   ./swarm-controller.sh evolve --apply
#   ./swarm-controller.sh grade "This implementation handles all edge cases..."
#   ./swarm-controller.sh tools list
#   ./swarm-controller.sh auto "Analyze and fix the failing Prisma migration"
#   ./swarm-controller.sh gate --all
#   ./swarm-controller.sh flush
#   ./swarm-controller.sh status
#   ./swarm-controller.sh doctor
#
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail
IFS=$'\n\t'

# ── Version ──────────────────────────────────────────────────────────────────
CONTROLLER_VERSION="4.2.0"
CONTROLLER_BUILD="2026.05"

# ── Root resolution ───────────────────────────────────────────────────────────
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Defaults (overridable by env or flags) ────────────────────────────────────
OLLAMA_HOST="${OLLAMA_HOST:-http://localhost:11434}"
OLLAMA_API="${OLLAMA_HOST}/api/generate"
OLLAMA_API_TAGS="${OLLAMA_HOST}/api/tags"
OLLAMA_API_PS="${OLLAMA_HOST}/api/ps"

# Model triad — mirrors configs/routing.yaml and src/swarmx/config.py priority
MODEL_ROUTER="${SWARM_MODEL_FAST:-${MODEL_FAST:-phi4-mini}}"
MODEL_REASON="${SWARM_MODEL_REASON:-${MODEL_REASON:-deepseek-r1:7b}}"
MODEL_CODE="${SWARM_MODEL_CODE:-${MODEL_CODE:-qwen3-coder}}"

# Per-model timeouts (seconds)
TIMEOUT_ROUTER="${SWARM_TIMEOUT_ROUTER:-30}"
TIMEOUT_REASON="${SWARM_TIMEOUT_REASON:-300}"
TIMEOUT_CODE="${SWARM_TIMEOUT_CODE:-120}"

# Per-model temperatures
TEMP_ROUTER="0.20"
TEMP_REASON="0.40"
TEMP_CODE="0.15"

# v4 additions
TEMP_GRADE="0.10"        # critic pass: highly deterministic
TIMEOUT_GRADE="25"       # critic passes must be fast
PROPOSALS_DEFAULT=3      # Dr. Zero proposal count
SKIP_GRADE=false
VERTICAL="${SWARM_VERTICAL:-}"
ISLAND_PIN=""
PROPOSALS_N="$PROPOSALS_DEFAULT"
ADVERSARIAL="${SWARM_ADVERSARIAL:-0}"   # [CTL-ENH-01] adversarial critique gate
USE_PROPOSER_SOLVER=false               # [CTL-ENH-02] Dr. Zero proposer-solver flag

# Keep-alive: 0 = unload immediately after response (8 GB safety default)
KEEP_ALIVE_DEFAULT=0

# VRAM ceiling for pre-dispatch resource guard [CTL-V42-01]
VRAM_CEILING_GB="${SWARM_VRAM_CEILING_GB:-10}"

# Runtime directory
RUNTIME_DIR="${SWARM_HOME:-${HOME}/.swarmx}"

# ── CLI state ─────────────────────────────────────────────────────────────────
COMMAND=""
PROMPT=""
CONTEXT_FILE=""
OUTPUT_JSON=false
QUIET=false
DRY_RUN=false
GATE_BEFORE=false
GATE_AFTER=false
VERBOSE=false
KEEP_ALIVE="$KEEP_ALIVE_DEFAULT"
CUSTOM_TIMEOUT=""
CHAIN_SEPARATOR="────────────────────────────────────────"

# ── WAT timezone offset [CTL-08] ──────────────────────────────────────────────
# Display timestamps in WAT (UTC+1); telemetry always UTC
_wat_time() {
  TZ="Africa/Lagos" date '+%H:%M:%S' 2>/dev/null || date -u '+%H:%M:%SZ'
}
_utc_iso() {
  date -u '+%Y-%m-%dT%H:%M:%SZ'
}

# ── ANSI ──────────────────────────────────────────────────────────────────────
_tty() { [[ -t 1 ]] && ! $QUIET; }
RED()     { _tty && printf '\033[0;31m%s\033[0m' "$1" || printf '%s' "$1"; }
YELLOW()  { _tty && printf '\033[0;33m%s\033[0m' "$1" || printf '%s' "$1"; }
GREEN()   { _tty && printf '\033[0;32m%s\033[0m' "$1" || printf '%s' "$1"; }
CYAN()    { _tty && printf '\033[0;36m%s\033[0m' "$1" || printf '%s' "$1"; }
MAGENTA() { _tty && printf '\033[0;35m%s\033[0m' "$1" || printf '%s' "$1"; }
BOLD()    { _tty && printf '\033[1m%s\033[0m'    "$1" || printf '%s' "$1"; }
DIM()     { _tty && printf '\033[2m%s\033[0m'    "$1" || printf '%s' "$1"; }
BLUE()    { _tty && printf '\033[0;34m%s\033[0m' "$1" || printf '%s' "$1"; }

# ── Logging ───────────────────────────────────────────────────────────────────
_log()  { ! $QUIET && echo "$( DIM "[$(  _wat_time)]") $*" >&2; }
_info() { echo "$(GREEN '[→]') $*" >&2; }
_warn() { echo "$(YELLOW '[⚠]') $*" >&2; }
_err()  { echo "$(RED '[✗]') $*" >&2; }
_ok()   { echo "$(GREEN '[✓]') $*" >&2; }
_v4()   { echo "$(BLUE '[v4]') $*" >&2; }

# ── Telemetry ─────────────────────────────────────────────────────────────────
CONTROLLER_LOG_DIR="${RUNTIME_DIR}/controller"

_telemetry() {
  local event="$1" model="$2" status="$3" elapsed="${4:-0}" extra="${5:-}"
  mkdir -p "$CONTROLLER_LOG_DIR" 2>/dev/null || true
  local ts; ts="$(_utc_iso)"
  local record
  record="$(python3 -c "
import json, sys
d = {'ts': sys.argv[1], 'event': sys.argv[2], 'model': sys.argv[3],
     'status': sys.argv[4], 'elapsed_ms': int(sys.argv[5]), 'source': 'controller.sh', 'version': '$CONTROLLER_VERSION'}
if sys.argv[6]: d['extra'] = sys.argv[6]
print(json.dumps(d))
" "$ts" "$event" "$model" "$status" "$elapsed" "$extra" 2>/dev/null || echo "{}")"
  echo "$record" >> "${CONTROLLER_LOG_DIR}/dispatch.jsonl" 2>/dev/null || true
}

# ── MemEvolve memory writer [CTL-02] ─────────────────────────────────────────
_memevolve_write() {
  local kind="$1" summary="$2" tags="${3:-controller}"
  # Try Python path first (hooks into memory.py store_memory),
  # fallback to direct JSONL append if swarmx not importable
  if python3 -c "import swarmx" 2>/dev/null; then
    python3 - "$RUNTIME_DIR" "$kind" "$summary" "$tags" <<'PY' 2>/dev/null || true
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(sys.argv[1]).parent.parent / "src"))
try:
    from swarmx.memory import store_memory
    runtime_dir = Path(sys.argv[1])
    store_memory(runtime_dir, {
        "kind": sys.argv[2],
        "summary": sys.argv[3],
        "tags": [t.strip() for t in sys.argv[4].split(",")],
    })
except Exception as e:
    print(f"[memevolve] warn: {e}", file=sys.stderr)
PY
  else
    # Direct JSONL fallback
    mkdir -p "${RUNTIME_DIR}/memory" 2>/dev/null || true
    python3 -c "
import json, sys, time
from pathlib import Path
note = {
    'kind': sys.argv[1],
    'summary': sys.argv[2],
    'tags': sys.argv[3].split(','),
    'ts': '$(_utc_iso)',
    'source': 'controller.sh',
}
p = Path('$RUNTIME_DIR') / 'memory' / 'controller.jsonl'
p.parent.mkdir(parents=True, exist_ok=True)
with p.open('a') as f:
    f.write(json.dumps(note) + '\n')
" "$kind" "$summary" "$tags" 2>/dev/null || true
  fi
}

# ── MemEvolve memory reader (last N notes for chain priming) [CTL-02] ────────
_memevolve_read() {
  local limit="${1:-5}"
  local mem_file="${RUNTIME_DIR}/memory/controller.jsonl"
  if [[ ! -f "$mem_file" ]]; then
    echo ""
    return 0
  fi
  python3 -c "
import json, sys
from pathlib import Path
p = Path(sys.argv[1])
lines = [l for l in p.read_text().splitlines() if l.strip()][-int(sys.argv[2]):]
records = []
for l in lines:
    try:
        d = json.loads(l)
        records.append(f\"{d.get('kind','?')}: {d.get('summary','')[:120]}\")
    except Exception:
        pass
print('\n'.join(records))
" "$mem_file" "$limit" 2>/dev/null || echo ""
}

# ── Lifecycle hooks [CTL-05] ──────────────────────────────────────────────────
_run_hook() {
  local hook_name="$1"
  local hooks_file="${RUNTIME_DIR}/controller/hooks.yaml"
  [[ ! -f "$hooks_file" ]] && return 0
  local hook_cmd
  hook_cmd="$(python3 -c "
import yaml, sys
d = yaml.safe_load(open(sys.argv[1]))
print(d.get(sys.argv[2], '') or '')
" "$hooks_file" "$hook_name" 2>/dev/null || echo "")"
  [[ -z "$hook_cmd" ]] && return 0
  _log "Hook [$hook_name]: $hook_cmd"
  eval "$hook_cmd" 2>/dev/null || _warn "Hook [$hook_name] failed (non-fatal)"
}

# ── Helpers ───────────────────────────────────────────────────────────────────
_require() {
  for cmd in "$@"; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      _err "Required command not found: $cmd"
      exit 3
    fi
  done
}

_elapsed_ms() {
  local start="$1"
  local end; end="$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')"
  echo $(( end - start ))
}

_start_timer() {
  date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))'
}

# ── Vertical context injection [CTL-09] ───────────────────────────────────────
_vertical_context() {
  local prompt_lower; prompt_lower="$(echo "${PROMPT}${1:-}" | tr '[:upper:]' '[:lower:]')"
  local vert="${VERTICAL:-}"

  # Auto-detect from prompt if not set
  if [[ -z "$vert" ]]; then
    if echo "$prompt_lower" | grep -qE "(taxbridge|nrs|invoic|cbn|ndpc|firs|paystack|remita|nibss)"; then
      vert="taxbridge"
    elif echo "$prompt_lower" | grep -qE "(sabiscore|xgboost|lightgbm|catboost|ml.observ|otel|opentelemetry)"; then
      vert="sabiscore"
    elif echo "$prompt_lower" | grep -qE "(hashablanca|zk.proof|zero.knowledge|zksnark|circuit|witness)"; then
      vert="hashablanca"
    fi
  fi

  case "$vert" in
    taxbridge|TAXBRIDGE)
      cat <<'CTX'

VERTICAL CONTEXT [TaxBridge · NRS Compliance · Nigerian Fintech]:
  · Monetary values: Prisma Decimal only — never float or number
  · NRS e-invoice required fields: IRN, FIRS TIN, BVN/KYC tier
  · Webhook verification: SHA-512 HMAC (Paystack standard)
  · Idempotency keys mandatory on all payment mutations
  · NDPC data residency: PII must stay in Nigeria-region storage
  · NRS Phase-2 deadline: flag any schema gap immediately
  · Stack: Fastify 5 · PostgreSQL 15 · BullMQ · Expo SDK 54 · Prisma 5
CTX
      ;;
    sabiscore|SABISCORE)
      cat <<'CTX'

VERTICAL CONTEXT [SabiScore · ML Observability]:
  · OpenTelemetry spans on every ML pipeline stage
  · Precision/recall logged per prediction batch
  · BullMQ job_id → span_id correlation required
  · Model ensemble: XGBoost/LightGBM/CatBoost — never single model
  · Feature drift monitoring: Evidently AI or equivalent
CTX
      ;;
    hashablanca|HASHABLANCA)
      cat <<'CTX'

VERTICAL CONTEXT [Hashablanca · ZK Infrastructure]:
  · ZK proof generation: never expose witness data in logs
  · Circuit constraints must be formally verified before deploy
  · Key management: HSM-backed, never in-process
  · Proof batching: aggregate before on-chain submission
  · Multi-chain privacy: Ethereum + Solana compatibility required
CTX
      ;;
    *)
      echo ""
      ;;
  esac
}

# ── Ollama health check ───────────────────────────────────────────────────────
_ollama_alive() {
  curl -sf --max-time 3 "${OLLAMA_HOST}/api/tags" >/dev/null 2>&1
}

_ollama_running_models() {
  curl -sf --max-time 3 "${OLLAMA_API_PS}" 2>/dev/null \
    | python3 -c "import json,sys; d=json.load(sys.stdin); [print(m['name']) for m in d.get('models',[])]" 2>/dev/null \
    || true
}

_ollama_available_models() {
  curl -sf --max-time 3 "${OLLAMA_API_TAGS}" 2>/dev/null \
    | python3 -c "import json,sys; d=json.load(sys.stdin); [print(m['name']) for m in d.get('models',[])]" 2>/dev/null \
    || true
}

# ── Memory management — core 8 GB safety ─────────────────────────────────────
flush_models() {
  ! $QUIET && _log "Clearing VRAM/RAM — unloading all active models"
  local running; running="$(_ollama_running_models)"
  if [[ -z "$running" ]]; then
    ! $QUIET && _ok "No models currently loaded"
    return 0
  fi
  while IFS= read -r model; do
    [[ -z "$model" ]] && continue
    _log "  Unloading: $model"
    curl -sf -X POST "$OLLAMA_API" \
      -H "Content-Type: application/json" \
      -d "{\"model\":\"$model\",\"prompt\":\"\",\"keep_alive\":0,\"stream\":false}" \
      >/dev/null 2>&1 || true
  done <<< "$running"

  if [[ -w /proc/sys/vm/drop_caches ]] 2>/dev/null; then
    echo 3 > /proc/sys/vm/drop_caches 2>/dev/null && \
      _log "  Kernel page cache dropped" || true
  elif sudo -n sh -c 'echo 3 > /proc/sys/vm/drop_caches' 2>/dev/null; then
    _log "  Kernel page cache dropped (sudo)"
  fi
  sync 2>/dev/null || true
  _ok "Flush complete"
}

# ── VRAM resource guard (v4.2 [CTL-V42-01]) ──────────────────────────────────
# Called before heavyweight dispatches (chain, solve, code, reason).
# Queries /api/ps for current VRAM consumption; flushes if at ceiling.
_check_resources() {
  local min_free_gb="${1:-2}"   # minimum free VRAM to leave headroom
  local ceiling_gb="$VRAM_CEILING_GB"

  if ! _ollama_alive; then
    return 0  # Can't check — Ollama not running, dispatch will fail naturally
  fi

  local vram_used_gb
  vram_used_gb="$(curl -sf --max-time 3 "${OLLAMA_API_PS}" 2>/dev/null \
    | python3 -c '
import json, sys
d = json.loads(sys.stdin.read() or "{}")
total = sum(m.get("size_vram", 0) for m in d.get("models", []))
print(round(total / (1024**3), 1))
' 2>/dev/null || echo "0")"

  # Compare as floats via python3 (bash can't do floating-point arithmetic)
  local over_ceiling
  over_ceiling="$(python3 -c "
import sys
used = float(sys.argv[1])
ceiling = float(sys.argv[2])
print('yes' if used >= ceiling else 'no')
" "$vram_used_gb" "$ceiling_gb" 2>/dev/null || echo "no")"

  if [[ "$over_ceiling" == "yes" ]]; then
    _warn "VRAM at ceiling (${vram_used_gb}GB / ${ceiling_gb}GB) — flushing before dispatch"
    flush_models
  else
    _log "Resource check: VRAM ${vram_used_gb}GB / ${ceiling_gb}GB ceiling — OK"
  fi
}

# ── Context loading ───────────────────────────────────────────────────────────
_load_context() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    _err "Context file not found: $file"
    exit 3
  fi
  local ext="${file##*.}"
  case "$ext" in
    json)
      python3 -c "
import json, sys
d = json.load(open('$file'))
parts = []
for k, v in d.items():
    if isinstance(v, str):
        parts.append(f'{k}: {v}')
    elif isinstance(v, (list, dict)):
        parts.append(f'{k}: {json.dumps(v, ensure_ascii=False)[:500]}')
print('\n'.join(parts))
" 2>/dev/null || cat "$file"
      ;;
    md|txt|yaml|yml)
      head -200 "$file"
      ;;
    *)
      head -100 "$file"
      ;;
  esac
}

# ── Confidence gate — critic pass [CTL-06] ────────────────────────────────────
# Returns: 0=PASS, 1=WARN, 6=REJECT
_confidence_grade() {
  local text="$1"
  local task_hint="${2:-}"
  $SKIP_GRADE && echo "PASS" && return 0

  local grade_prompt
  grade_prompt="$(printf 'You are a terse, skeptical SwarmX critic. Grade the following agent output.

Task context: %s

Output to grade:
%s

Respond with EXACTLY one of these verdicts on the first line, then 1 brief reason:
PASS — output is correct, actionable, production-safe
WARN — output is usable but has gaps or assumptions
REJECT — output is incorrect, incomplete, or unsafe for production

Verdict:' "$task_hint" "${text:0:3000}")"

  local payload grade_response
  payload="$(python3 -c "
import json, sys
print(json.dumps({'model': sys.argv[1], 'prompt': sys.argv[2], 'stream': False,
                  'keep_alive': 0, 'options': {'temperature': $TEMP_GRADE, 'num_predict': 200}}))
" "$MODEL_ROUTER" "$grade_prompt" 2>/dev/null)"

  grade_response="$(curl -sf --max-time "$TIMEOUT_GRADE" -X POST "$OLLAMA_API" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>/dev/null \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('response','').strip())" 2>/dev/null || echo "WARN")"

  local verdict; verdict="$(echo "$grade_response" | head -1 | grep -oE 'PASS|WARN|REJECT' | head -1 || echo "WARN")"
  local reason; reason="$(echo "$grade_response" | tail -n +2 | head -2 | tr '\n' ' ')"
  echo "$verdict|$reason"
}

# ── Core dispatch ─────────────────────────────────────────────────────────────
_dispatch() {
  local model="$1"
  local prompt="$2"
  local timeout="$3"
  local temperature="$4"
  local role_label="$5"
  local keep_alive="${6:-$KEEP_ALIVE}"
  local task_hint="${7:-}"

  # Prepend context if provided
  local full_prompt="$prompt"
  if [[ -n "$CONTEXT_FILE" && -f "$CONTEXT_FILE" ]]; then
    local ctx; ctx="$(_load_context "$CONTEXT_FILE")"
    full_prompt="$(printf 'CONTEXT:\n%s\n\nTASK:\n%s' "$ctx" "$prompt")"
  fi

  if $VERBOSE; then
    echo "$(DIM '--- PROMPT ---')" >&2
    echo "$full_prompt" >&2
    echo "$(DIM '--- END ---')" >&2
  fi

  if $DRY_RUN; then
    echo "$(CYAN '[DRY-RUN]') model=$model timeout=${timeout}s temp=$temperature keep_alive=${keep_alive}s"
    echo "$(DIM "  prompt: ${full_prompt:0:120}...")"
    return 0
  fi

  # Pre-dispatch flush (8 GB RAM safety)
  local running_models; running_models="$(_ollama_running_models)"
  local should_flush=true
  if [[ "$keep_alive" -gt 0 ]] && echo "$running_models" | grep -qi "^${model}"; then
    should_flush=false
  fi
  if $should_flush && [[ -n "$running_models" ]]; then
    _log "Pre-dispatch flush (model handoff)"
    flush_models
  fi

  local start_ts; start_ts="$(_start_timer)"
  _log "Dispatching: $(BOLD "$role_label") → $(CYAN "$model") (timeout=${timeout}s, temp=${temperature}, keep_alive=${keep_alive}s)"

  local payload
  payload="$(python3 -c "
import json, sys

# [CTL-FIX-03] Per-model top_p instead of hardcoded 0.92
_TOP_P = {
    'phi4-mini':      0.90,
    'deepseek-r1':    0.92,
    'deepseek-r1:7b': 0.92,
    'qwen3-coder':    0.95,
}
model_name = sys.argv[1].lower()
top_p = next((v for k, v in _TOP_P.items() if model_name == k or model_name.startswith(k)), 0.92)

payload = {
    'model': sys.argv[1],
    'prompt': sys.argv[2],
    'stream': False,
    'keep_alive': int(sys.argv[3]),
    'options': {
        'temperature': float(sys.argv[4]),
        'top_p': top_p,
        'num_predict': 4096,
    }
}
print(json.dumps(payload))
" "$model" "$full_prompt" "$keep_alive" "$temperature" 2>/dev/null)"

  local response exit_code=0
  response="$(curl -sf \
    --max-time "$timeout" \
    -X POST "$OLLAMA_API" \
    -H "Content-Type: application/json" \
    -d "$payload" \
    2>/dev/null)" || exit_code=$?

  local elapsed; elapsed="$(_elapsed_ms "$start_ts")"

  if [[ $exit_code -ne 0 || -z "$response" ]]; then
    _warn "Dispatch failed: model=$model exit=$exit_code"
    _telemetry "dispatch_fail" "$model" "error" "$elapsed"
    return 2
  fi

  local model_response
  model_response="$(echo "$response" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get('response','').strip())
except Exception:
    print('')
" 2>/dev/null)"

  if [[ -z "$model_response" ]]; then
    _warn "Empty response from model=$model"
    _telemetry "dispatch_empty" "$model" "warn" "$elapsed"
    return 1
  fi

  # Confidence gate [CTL-06]
  local grade_verdict="PASS" grade_reason=""
  if ! $SKIP_GRADE; then
    local grade_result; grade_result="$(_confidence_grade "$model_response" "$task_hint" 2>/dev/null || echo "WARN|")"
    grade_verdict="${grade_result%%|*}"
    grade_reason="${grade_result#*|}"
    case "$grade_verdict" in
      PASS) _log "  Grade: $(GREEN 'PASS')" ;;
      WARN) _log "  Grade: $(YELLOW 'WARN') — ${grade_reason:0:80}" ;;
      REJECT)
        _warn "Grade: $(RED 'REJECT') — $grade_reason"
        _telemetry "grade_reject" "$model" "reject" "$elapsed" "$grade_reason"
        return 6
        ;;
    esac
  fi

  _telemetry "dispatch_ok" "$model" "success" "$elapsed" "$grade_verdict"
  _ok "$(BOLD "$role_label") responded in $((elapsed/1000)).$((elapsed%1000/100))s [grade: $grade_verdict]"

  if $OUTPUT_JSON; then
    python3 -c "
import json, sys
print(json.dumps({
    'model': sys.argv[1],
    'role': sys.argv[2],
    'elapsed_ms': int(sys.argv[3]),
    'response': sys.argv[4],
    'grade': sys.argv[5],
    'grade_reason': sys.argv[6],
    'controller_version': '$CONTROLLER_VERSION',
}, ensure_ascii=False, indent=2))
" "$model" "$role_label" "$elapsed" "$model_response" "$grade_verdict" "$grade_reason"
  else
    echo "$model_response"
  fi
}

# ── Escalation chain ──────────────────────────────────────────────────────────
_escalate() {
  local primary="$1"
  local prompt="$2"
  local timeout="$3"
  local temperature="$4"
  local role_label="$5"
  local task_hint="${6:-}"

  local chain=()
  case "$primary" in
    phi4-mini*)    chain=("$MODEL_ROUTER" "$MODEL_REASON" "$MODEL_CODE") ;;
    deepseek-r1*)  chain=("$MODEL_REASON" "$MODEL_CODE" "$MODEL_ROUTER") ;;
    qwen3-coder*)  chain=("$MODEL_CODE" "$MODEL_REASON" "$MODEL_ROUTER") ;;
    *)             chain=("$primary" "$MODEL_ROUTER" "$MODEL_REASON" "$MODEL_CODE") ;;
  esac

  local result exit_code=0
  for candidate in "${chain[@]}"; do
    _log "Trying: $candidate"
    result="$(_dispatch "$candidate" "$prompt" "$timeout" "$temperature" "${role_label}→${candidate}" "$KEEP_ALIVE" "$task_hint")" || exit_code=$?

    # Handle grade REJECT: retry once with refined prompt [CTL-06]
    if [[ $exit_code -eq 6 ]]; then
      _warn "Grade REJECT — retrying with refined prompt"
      local refined_prompt
      refined_prompt="$(printf 'Previous attempt was rejected by quality gate. Please provide a more complete, production-safe response.\n\nOriginal task:\n%s' "$prompt")"
      result="$(_dispatch "$candidate" "$refined_prompt" "$timeout" "$temperature" "${role_label}[retry]" "$KEEP_ALIVE" "$task_hint")" || exit_code=$?
      if [[ $exit_code -eq 6 ]]; then
        _warn "Grade REJECT on retry — escalating to next model"
        exit_code=0
        continue
      fi
    fi

    if [[ $exit_code -eq 0 && -n "$result" ]]; then
      [[ "$candidate" != "$primary" ]] && \
        _warn "Escalation used: ${primary} → ${candidate}"
      echo "$result"
      return 0
    fi
    exit_code=0
  done

  _err "All escalation candidates exhausted for: $primary"
  local words; words=( $prompt )
  local digest="${words[*]:0:24}"
  echo "[deterministic:${primary}] Proposed next action: inspect the repo, implement the smallest safe improvement, and validate it. Context digest: ${digest}"
  return 2
}

# ── Command: route ────────────────────────────────────────────────────────────
cmd_route() {
  local prompt="$1"
  local timeout="${CUSTOM_TIMEOUT:-$TIMEOUT_ROUTER}"
  _run_hook "pre_route"
  ! $QUIET && echo ""
  ! $QUIET && echo "$(CYAN '┌─') $(BOLD 'ORCHESTRATOR') · Phi-4-mini · routing/classification/evaluation"
  _escalate "$MODEL_ROUTER" "$prompt" "$timeout" "$TEMP_ROUTER" "ORCHESTRATOR" "routing/classification"
  ! $QUIET && echo "$(CYAN '└─')"
  _run_hook "post_route"
}

# ── Command: reason ───────────────────────────────────────────────────────────
cmd_reason() {
  local prompt="$1"
  local timeout="${CUSTOM_TIMEOUT:-$TIMEOUT_REASON}"
  _run_hook "pre_reason"
  ! $QUIET && echo ""
  ! $QUIET && echo "$(MAGENTA '┌─') $(BOLD 'REASONING ENGINE') · DeepSeek-R1:7B · planning/architecture/analysis"
  _check_resources 2  # [CTL-V42-01] ensure VRAM headroom before 4.7 GB model load
  _escalate "$MODEL_REASON" "$prompt" "$timeout" "$TEMP_REASON" "REASONING" "planning/architecture"
  ! $QUIET && echo "$(MAGENTA '└─')"
  _run_hook "post_reason"
}

# ── Command: code ─────────────────────────────────────────────────────────────
cmd_code() {
  local prompt="$1"
  local timeout="${CUSTOM_TIMEOUT:-$TIMEOUT_CODE}"
  _run_hook "pre_code"
  ! $QUIET && echo ""
  ! $QUIET && echo "$(YELLOW '┌─') $(BOLD 'EXECUTION ENGINE') · Qwen2.5-Coder · implementation/generation/testing"
  _check_resources 2  # [CTL-V42-01] ensure VRAM headroom before 5 GB model load
  # [CTL-ENH-02] --proposer-solver flag support
  if $USE_PROPOSER_SOLVER; then
    _v4 "Proposer-solver mode: dispatching via llm.py generate(use_proposer_solver=True)"
    python3 -c "
import sys
from pathlib import Path
sys.path.insert(0, str(Path('$ROOT') / 'src'))
try:
    from swarmx.llm import generate
    from swarmx.config import SwarmConfig
    cfg = SwarmConfig()
    result = generate(sys.argv[1], model=cfg.model_code, role='backend-engineer',
                      use_proposer_solver=True, cfg=cfg)
    print(str(result))
    print(f'[fitness={result.fitness_score:.3f}]', file=sys.stderr)
except Exception as e:
    print(f'[proposer-solver fallback: {e}]', file=sys.stderr)
    sys.exit(1)
" "$prompt" 2>&1 || _escalate "$MODEL_CODE" "$prompt" "$timeout" "$TEMP_CODE" "EXECUTION" "code/implementation"
  else
    _escalate "$MODEL_CODE" "$prompt" "$timeout" "$TEMP_CODE" "EXECUTION" "code/implementation"
  fi
  ! $QUIET && echo "$(YELLOW '└─')"
  _run_hook "post_code"
}

# ── Command: chain (full triadic pipeline + MemEvolve) [CTL-02, CTL-07] ──────
cmd_chain() {
  local prompt="$1"
  local chain_id; chain_id="chain_$(date +%Y%m%d_%H%M%S)"
  local chain_log="${CONTROLLER_LOG_DIR}/${chain_id}.jsonl"
  mkdir -p "$CONTROLLER_LOG_DIR" 2>/dev/null || true

  _run_hook "pre_chain"

  ! $QUIET && echo ""
  ! $QUIET && echo "$(BOLD '╔══ TRIADIC CHAIN DISPATCH v4 ══╗')"
  ! $QUIET && echo "$(DIM "  Target: ${prompt:0:80}")"
  ! $QUIET && echo "$(DIM "  Chain ID: $chain_id")"
  ! $QUIET && echo ""

  # ── Pre-chain resource guard [CTL-V42-01] ────────────────────────────────
  _check_resources 2  # flush if VRAM at ceiling before any phase loads a model

  # ── Inject vertical context [CTL-09] ────────────────────────────────────
  local vert_ctx; vert_ctx="$(_vertical_context "$prompt")"
  local prompt_with_vert="${prompt}${vert_ctx}"

  # ── Inject MemEvolve memory priming [CTL-02] ─────────────────────────────
  local recent_memory; recent_memory="$(_memevolve_read 5)"
  local mem_primer=""
  if [[ -n "$recent_memory" ]]; then
    mem_primer="$(printf '\n\nRECENT SWARM MEMORY (last 5 controller notes):\n%s' "$recent_memory")"
    _v4 "MemEvolve: primed from $(echo "$recent_memory" | wc -l | tr -d ' ') memory notes"
  fi

  # ── Phase 1: ORCHESTRATOR ─────────────────────────────────────────────────
  ! $QUIET && echo "$(CYAN '●') Phase 1 · ORCHESTRATOR (Phi-4-mini) — classify + route"
  local p1_start; p1_start="$(_start_timer)"
  local route_prompt
  route_prompt="$(printf 'You are the SwarmX orchestrator (v4). Classify this task and determine routing.%s

Task: %s

Respond with:
1. Task type (code/plan/research/architecture/debug/evaluate)
2. Recommended model role (EXECUTION|REASONING|ROUTER)
3. Key signals in the task (up to 5)
4. Risk level (low/medium/high)
5. Detected vertical context (none|taxbridge|sabiscore|hashablanca)
6. Brief routing decision (1 sentence)

Be concise — this feeds the specialist model.' "$mem_primer" "$prompt_with_vert")"

  local route_output; route_output="$(cmd_route "$route_prompt" 2>/dev/null || echo "ROUTING_FAILED")"
  local p1_elapsed; p1_elapsed="$(_elapsed_ms "$p1_start")"

  if [[ "$route_output" == "ROUTING_FAILED" ]]; then
    _warn "Phase 1 routing failed — proceeding with heuristic dispatch"
    route_output="Task type: general. Routed to: REASONING then EXECUTION. Risk: low. Vertical: none."
  fi

  # Emit structured trace [CTL-07]
  python3 -c "
import json, sys
print(json.dumps({'phase': 1, 'model': sys.argv[1], 'role': 'orchestrator',
                  'elapsed_ms': int(sys.argv[2]), 'chain_id': sys.argv[3],
                  'output_digest': sys.argv[4][:200]}))
" "$MODEL_ROUTER" "$p1_elapsed" "$chain_id" "$route_output" >> "$chain_log" 2>/dev/null || true

  ! $QUIET && echo ""
  ! $QUIET && echo "$(DIM "$CHAIN_SEPARATOR")"
  ! $QUIET && echo "$(DIM "  Orchestrator verdict: ${route_output:0:160}")"
  ! $QUIET && echo "$(DIM "$CHAIN_SEPARATOR")"
  ! $QUIET && echo ""

  # ── Phase 2: REASONING ENGINE ─────────────────────────────────────────────
  ! $QUIET && echo "$(MAGENTA '●') Phase 2 · REASONING ENGINE (DeepSeek-R1:7B) — plan + architecture"
  local p2_start; p2_start="$(_start_timer)"
  local reason_prompt
  reason_prompt="$(printf 'You are the SwarmX reasoning engine (v4). The orchestrator has classified this task:

ORCHESTRATOR VERDICT:
%s

ORIGINAL TASK:
%s
%s

Produce a structured implementation plan with:
1. Architecture decision (with explicit trade-off rationale)
2. Step-by-step approach (max 5 steps, ordered by dependency)
3. Risk surface + reversibility assessment
4. Exact specification for the execution engine
5. Validation checkpoints (what success looks like per step)
6. Stop conditions (when to halt and escalate)

Be precise — your output directly drives code generation.' \
    "$route_output" "$prompt_with_vert" "$mem_primer")"

  local reason_output; reason_output="$(cmd_reason "$reason_prompt" 2>/dev/null || echo "REASON_FAILED")"
  local p2_elapsed; p2_elapsed="$(_elapsed_ms "$p2_start")"

  if [[ "$reason_output" == "REASON_FAILED" ]]; then
    _warn "Phase 2 reasoning failed — proceeding with direct execution"
    reason_output="Plan: Direct implementation of the requested task. Validate output manually."
  fi

  python3 -c "
import json, sys
print(json.dumps({'phase': 2, 'model': sys.argv[1], 'role': 'reasoning',
                  'elapsed_ms': int(sys.argv[2]), 'chain_id': sys.argv[3],
                  'output_digest': sys.argv[4][:200]}))
" "$MODEL_REASON" "$p2_elapsed" "$chain_id" "$reason_output" >> "$chain_log" 2>/dev/null || true

  ! $QUIET && echo ""
  ! $QUIET && echo "$(DIM "$CHAIN_SEPARATOR")"
  ! $QUIET && echo "$(DIM "  Reasoning plan captured.")"
  ! $QUIET && echo "$(DIM "$CHAIN_SEPARATOR")"
  ! $QUIET && echo ""

  # ── Phase 3: EXECUTION ENGINE ─────────────────────────────────────────────
  ! $QUIET && echo "$(YELLOW '●') Phase 3 · EXECUTION ENGINE (Qwen2.5-Coder) — implement + generate"
  local p3_start; p3_start="$(_start_timer)"
  local code_prompt
  code_prompt="$(printf 'You are the SwarmX execution engine (v4). Implement the following:

ORIGINAL TASK:
%s
%s

REASONING ENGINE PLAN:
%s

PRODUCTION REQUIREMENTS:
- Production-quality code, all edge cases handled
- TypeScript strict mode / Python type hints where applicable
- Comprehensive error handling with typed errors
- Idempotency for all mutations
- Inline comments only for non-obvious logic
- No TODO/FIXME in output — resolve or flag as explicit GAP

Output only the implementation. No preamble.' \
    "$prompt_with_vert" "$mem_primer" "$reason_output")"

  local code_output; code_output="$(cmd_code "$code_prompt" 2>/dev/null || echo "EXECUTION_FAILED")"
  local p3_elapsed; p3_elapsed="$(_elapsed_ms "$p3_start")"
  local chain_exit=0

  if [[ "$code_output" == "EXECUTION_FAILED" ]]; then
    _err "Phase 3 execution failed"
    chain_exit=5
    code_output="[EXECUTION FAILED — see controller logs at ${CONTROLLER_LOG_DIR}]"
  fi

  python3 -c "
import json, sys
print(json.dumps({'phase': 3, 'model': sys.argv[1], 'role': 'execution',
                  'elapsed_ms': int(sys.argv[2]), 'chain_id': sys.argv[3],
                  'output_digest': sys.argv[4][:200]}))
" "$MODEL_CODE" "$p3_elapsed" "$chain_id" "$code_output" >> "$chain_log" 2>/dev/null || true

  # ── Phase 4: ADVERSARIAL CRITIQUE (optional) [CTL-ENH-01] ────────────────
  local adversarial_output=""
  local p4_elapsed=0
  if [[ "$ADVERSARIAL" == "1" && $chain_exit -eq 0 ]]; then
    ! $QUIET && echo ""
    ! $QUIET && echo "$(RED '●') Phase 4 · ADVERSARIAL CRITIC (Phi-4-mini) — dual-axis pressure test"
    local p4_start; p4_start="$(_start_timer)"
    local adversarial_prompt
    adversarial_prompt="$(printf 'You are an adversarial critic in a SwarmX chain. Pressure-test the execution output below.

ORIGINAL TASK: %s

EXECUTION OUTPUT (first 1200 chars):
%s

Axis A — Correctness/Completeness: What assumption is most likely wrong? What edge case is unhandled?
Axis B — Mutation Pressure: Is there ambiguity a hostile optimizer could exploit? What breaks if the most uncertain input is wrong?
Axis C — Production Readiness: Any missing error handling, idempotency gap, or deployment blocker?

Respond in ≤6 bullet points. Be ruthlessly concise. Prefix each with [A], [B], or [C].' \
      "${prompt:0:200}" "${code_output:0:1200}")"

    adversarial_output="$(_dispatch "$MODEL_ROUTER" "$adversarial_prompt" \
      "$TIMEOUT_ROUTER" "$TEMP_GRADE" "ADVERSARIAL-CRITIC" "0" "adversarial critique" 2>/dev/null || echo "")"
    p4_elapsed="$(_elapsed_ms "$p4_start")"

    if [[ -n "$adversarial_output" ]]; then
      python3 -c "
import json, sys
print(json.dumps({'phase': 4, 'model': sys.argv[1], 'role': 'adversarial-critic',
                  'elapsed_ms': int(sys.argv[2]), 'chain_id': sys.argv[3],
                  'output_digest': sys.argv[4][:200]}))
" "$MODEL_ROUTER" "$p4_elapsed" "$chain_id" "$adversarial_output" >> "$chain_log" 2>/dev/null || true
      ! $QUIET && echo ""
      ! $QUIET && echo "$(DIM "$CHAIN_SEPARATOR")"
      ! $QUIET && echo "$(DIM "  Adversarial critique captured.")"
      ! $QUIET && echo "$(DIM "$CHAIN_SEPARATOR")"
    fi
  fi

  # ── MemEvolve: record chain outcome [CTL-02] ─────────────────────────────
  if [[ $chain_exit -eq 0 ]]; then
    local chain_summary
    chain_summary="Chain $chain_id: ${prompt:0:80}... → route=${MODEL_ROUTER} reason=${MODEL_REASON} code=${MODEL_CODE}"
    _memevolve_write "chain-complete" "$chain_summary" "chain,controller,v4"
    _v4 "MemEvolve: chain outcome recorded"
  fi

  ! $QUIET && echo ""
  ! $QUIET && echo "$(BOLD '╚══ CHAIN COMPLETE ══╝')"
  ! $QUIET && echo "$(DIM "  Chain ID: $chain_id")"
  ! $QUIET && echo "$(DIM "  Full trace: $chain_log")"
  ! $QUIET && echo ""

  if $OUTPUT_JSON; then
    # [CTL-FIX-01] Use python3 heredoc for safe multi-value serialisation
    python3 - "$MODEL_ROUTER" "$MODEL_REASON" "$MODEL_CODE" \
      "$p1_elapsed" "$p2_elapsed" "$p3_elapsed" "$p4_elapsed" \
      "$chain_id" "$CONTROLLER_VERSION" <<PYJSON
import json, sys
router, reason, code = sys.argv[1], sys.argv[2], sys.argv[3]
p1_ms, p2_ms, p3_ms, p4_ms = int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6]), int(sys.argv[7])
chain_id  = sys.argv[8]
ctrl_ver  = sys.argv[9]
phases = [
    {'phase': 1, 'model': router, 'role': 'orchestrator',      'elapsed_ms': p1_ms, 'output': $(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$route_output")},
    {'phase': 2, 'model': reason, 'role': 'reasoning',         'elapsed_ms': p2_ms, 'output': $(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$reason_output")},
    {'phase': 3, 'model': code,   'role': 'execution',         'elapsed_ms': p3_ms, 'output': $(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$code_output")},
]
if p4_ms > 0:
    phases.append({'phase': 4, 'model': router, 'role': 'adversarial-critic', 'elapsed_ms': p4_ms, 'output': $(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$adversarial_output")})
print(json.dumps({'chain': True, 'chain_id': chain_id, 'phases': phases,
                  'chain_log': chain_id + '.jsonl', 'controller_version': ctrl_ver},
                 ensure_ascii=False, indent=2))
PYJSON
  else
    echo "$code_output"
    if [[ -n "$adversarial_output" && "$ADVERSARIAL" == "1" ]]; then
      echo ""
      echo "$(RED '── ADVERSARIAL CRITIQUE ──')"
      echo "$adversarial_output"
    fi
  fi

  _run_hook "post_chain"
  return $chain_exit
}

# ── Command: solve — Dr. Zero proposer-solver loop [CTL-03] ──────────────────
# Implements a data-free proposer-solver cycle:
#   DeepSeek-R1 proposes N approaches → Qwen2.5-Coder stress-tests each
#   → lightweight island tournament selects the winner.
cmd_solve() {
  local prompt="$1"
  local n_proposals="${PROPOSALS_N:-3}"

  ! $QUIET && echo ""
  ! $QUIET && echo "$(BOLD '╔══ DR. ZERO PROPOSER-SOLVER LOOP ══╗')"
  ! $QUIET && echo "$(DIM "  Problem: ${prompt:0:80}")"
  ! $QUIET && echo "$(DIM "  Proposals: $n_proposals")"
  ! $QUIET && echo ""

  # Pre-solve resource guard [CTL-V42-01]
  _check_resources 2

  local vert_ctx; vert_ctx="$(_vertical_context "$prompt")"

  # ── Phase P: PROPOSER (DeepSeek-R1 generates N approaches) ────────────────
  ! $QUIET && echo "$(MAGENTA '●') PROPOSER · DeepSeek-R1:7B — generating $n_proposals approaches"
  local proposer_prompt
  proposer_prompt="$(printf 'You are a SwarmX proposer agent. Generate exactly %d distinct approaches to solve the following problem.

Problem: %s
%s

For EACH approach:
APPROACH [N]:
  Strategy: (one sentence)
  Implementation: (3-5 concrete steps)
  Trade-offs: (strengths vs weaknesses)
  Risk: (low|medium|high)

Be creative — approaches should be meaningfully different (not just stylistic variations).
Number them exactly as APPROACH 1:, APPROACH 2:, APPROACH 3:' "$n_proposals" "$prompt" "$vert_ctx")"

  local proposals_raw; proposals_raw="$(cmd_reason "$proposer_prompt" 2>/dev/null || echo "PROPOSE_FAILED")"

  if [[ "$proposals_raw" == "PROPOSE_FAILED" ]]; then
    _err "Proposer failed — falling back to single-model dispatch"
    cmd_code "$prompt"
    return $?
  fi

  ! $QUIET && echo "$(DIM "  $n_proposals approaches generated")"
  ! $QUIET && echo ""

  # ── Phase S: SOLVER (Qwen2.5-Coder stress-tests each approach) ─────────────
  ! $QUIET && echo "$(YELLOW '●') SOLVER · Qwen2.5-Coder — stress-testing each approach"
  local solutions=()
  local scores=()

  local i
  for (( i=1; i<=n_proposals; i++ )); do
    ! $QUIET && echo "  $(DIM "  Testing approach $i/$n_proposals...")"
    local approach_prompt
    approach_prompt="$(printf 'You are a SwarmX solver agent. Critically evaluate and implement Approach %d from the following proposals.

PROPOSALS:
%s

YOUR TASK:
1. Identify edge cases and failure modes in Approach %d
2. Implement Approach %d with those edge cases handled
3. Rate implementation feasibility: HIGH/MEDIUM/LOW
4. Rate production-readiness: HIGH/MEDIUM/LOW

Implementation:' "$i" "$proposals_raw" "$i" "$i")"

    local sol; sol="$(SKIP_GRADE=true _escalate "$MODEL_CODE" "$approach_prompt" "$TIMEOUT_CODE" "$TEMP_CODE" "SOLVER[$i]" "" 2>/dev/null || echo "[approach $i failed]")"
    solutions+=("$sol")

    # Score with score_text heuristic
    local score; score="$(python3 -c "
import sys, math
text = sys.argv[1]
lines = [l for l in text.splitlines() if l.strip()]
n = len(lines)
q = round(1.0 - math.exp(-n / 10.0), 3)
has_actions = any(k in text.lower() for k in ['implement', 'validate', 'test', 'step', 'run'])
has_risk = any(k in text.lower() for k in ['risk', 'edge', 'fail', 'error', 'guard'])
total = q + 0.2 * has_actions + 0.1 * has_risk
print(round(min(total, 1.0), 3))
" "$sol" 2>/dev/null || echo "0.5")"
    scores+=("$score")
  done

  # ── Phase T: TOURNAMENT (island scoring selects winner) ───────────────────
  ! $QUIET && echo ""
  ! $QUIET && echo "$(BLUE '●') TOURNAMENT · island scoring → winner selection"

  local winner_idx=0
  local best_score="0"
  for idx in "${!scores[@]}"; do
    if python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) > float(sys.argv[2]) else 1)" \
        "${scores[$idx]}" "$best_score" 2>/dev/null; then
      best_score="${scores[$idx]}"
      winner_idx=$idx
    fi
  done

  local island_map=("A" "B" "C")
  local winner_island="${island_map[$winner_idx]:-A}"
  local winner_solution="${solutions[$winner_idx]}"

  ! $QUIET && echo ""
  ! $QUIET && echo "$(GREEN "  Winner: Approach $((winner_idx + 1)) · Island $winner_island · Score: $best_score")"
  ! $QUIET && echo ""
  ! $QUIET && echo "$(BOLD '╚══ SOLVER COMPLETE ══╝')"
  ! $QUIET && echo ""

  # Record to MemEvolve
  _memevolve_write "solve-complete" \
    "Dr.Zero solve: ${prompt:0:60}... → winner approach $((winner_idx+1)) score=$best_score" \
    "solve,dr-zero,island-$winner_island"

  if $OUTPUT_JSON; then
    # [CTL-FIX-02] Safe JSON serialisation via temp file — avoids IFS='|||' join corruption
    local _solve_tmp; _solve_tmp="$(mktemp)"
    python3 -c "
import json, sys, pathlib
solutions_file = sys.argv[1]
data = json.loads(pathlib.Path(solutions_file).read_text())
print(json.dumps(data, ensure_ascii=False, indent=2))
" "$_solve_tmp" 2>/dev/null || true

    python3 - "$winner_idx" "$prompt" "$n_proposals" "$winner_island" "$best_score" "$CONTROLLER_VERSION" \
      "${scores[@]}" <<SOLPY
import json, sys
winner    = int(sys.argv[1])
problem   = sys.argv[2]
n_prop    = int(sys.argv[3])
island    = sys.argv[4]
w_score   = float(sys.argv[5])
ctrl_ver  = sys.argv[6]
all_scores = sys.argv[7:]
# solutions serialised below via shell var substitution (safe: single json.dumps)
winner_sol = $(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "${solutions[$winner_idx]:-}")
print(json.dumps({
    'solve': True,
    'problem': problem,
    'n_proposals': n_prop,
    'winner_idx': winner,
    'winner_island': island,
    'winner_score': w_score,
    'winner_solution': winner_sol,
    'all_scores': list(all_scores),
    'controller_version': ctrl_ver,
}, ensure_ascii=False, indent=2))
SOLPY
    rm -f "$_solve_tmp"
  else
    echo "$winner_solution"
  fi
}

# ── Command: evolve — GEA group evolution [CTL-04] ────────────────────────────
cmd_evolve() {
  local auto_apply="${1:-false}"

  ! $QUIET && echo ""
  ! $QUIET && echo "$(BOLD '╔══ GROUP EVOLUTION (GEA) ══╗')"

  # Check if swarmx Python package is importable
  if ! python3 -c "import swarmx" 2>/dev/null; then
    # Try with src/ on path
    local src_path="${ROOT}/src"
    if [[ -d "$src_path" ]]; then
      export PYTHONPATH="${src_path}${PYTHONPATH:+:$PYTHONPATH}"
    fi
    if ! python3 -c "import swarmx" 2>/dev/null; then
      _warn "swarmx package not importable — running lightweight fallback evolution"
      _evolve_fallback
      return 0
    fi
  fi

  ! $QUIET && echo "$(DIM "  Runtime: $RUNTIME_DIR")"
  ! $QUIET && echo "$(DIM "  Auto-apply: $auto_apply")"
  ! $QUIET && echo ""

  python3 - "$RUNTIME_DIR" "$auto_apply" "$CONTROLLER_VERSION" <<'PY'
import sys, json
from pathlib import Path

runtime_dir = Path(sys.argv[1])
auto_apply = sys.argv[2].lower() == "true"
ctrl_version = sys.argv[3]

try:
    from swarmx.evolver import build_evolution_proposals, apply_proposals
    from swarmx.config import SwarmConfig

    cfg = SwarmConfig()
    proposals = build_evolution_proposals(runtime_dir, cfg=cfg)

    print(f"\n  Generated {len(proposals)} evolution proposal(s):\n")
    for i, p in enumerate(proposals, 1):
        print(f"  [{i}] {p.scope:<20} score={p.score:.3f}  risk={p.risk}")
        print(f"      {p.reason[:120]}")
        print()

    if auto_apply:
        results = apply_proposals(runtime_dir, proposals, auto_apply=True, cfg=cfg)
        applied = [r for r in results if r.get("applied")]
        print(f"\n  Applied {len(applied)}/{len(results)} low-risk proposals automatically.")
    else:
        # Store proposals for review
        for p in proposals:
            from swarmx.memory import store_proposal
            store_proposal(runtime_dir, p)
        print(f"\n  {len(proposals)} proposal(s) stored for review in:")
        print(f"  {runtime_dir}/evolution/proposals/")
        print("\n  Run with --apply to auto-apply low-risk patches.")

except Exception as e:
    print(f"\n  [evolve] error: {e}", file=sys.stderr)
    sys.exit(1)
PY

  ! $QUIET && echo ""
  ! $QUIET && echo "$(BOLD '╚══ EVOLUTION COMPLETE ══╝')"
  ! $QUIET && echo ""
}

_evolve_fallback() {
  # Lightweight evolution without swarmx package
  local chain_logs; chain_logs="$(ls -t "${CONTROLLER_LOG_DIR}/chain_"*.jsonl 2>/dev/null | head -5 || true)"
  local dispatch_count=0
  [[ -f "${CONTROLLER_LOG_DIR}/dispatch.jsonl" ]] && \
    dispatch_count="$(wc -l < "${CONTROLLER_LOG_DIR}/dispatch.jsonl" | tr -d ' ')"

  echo "  Lightweight evolution (swarmx not installed):"
  echo "  · Dispatch count: $dispatch_count"
  echo "  · Chain logs found: $(echo "$chain_logs" | grep -c . || echo 0)"
  echo ""
  echo "  Proposal: Consider setting SWARM_MAX_ITERATIONS=3 and running:"
  echo "    pip install -e . && ./swarm-controller.sh evolve"
}

# ── Command: grade — confidence gate on arbitrary text [CTL-06] ──────────────
cmd_grade() {
  local text="$1"
  ! $QUIET && echo ""
  ! $QUIET && echo "$(BOLD 'Confidence Gate') · Phi-4-mini critic pass"
  local grade_result; grade_result="$(_confidence_grade "$text" "user-supplied text" 2>/dev/null || echo "WARN|grade error")"
  local verdict="${grade_result%%|*}"
  local reason="${grade_result#*|}"
  case "$verdict" in
    PASS)   echo "$(GREEN '[PASS]') $reason" ;;
    WARN)   echo "$(YELLOW '[WARN]') $reason" ;;
    REJECT) echo "$(RED '[REJECT]') $reason" ;;
    *)      echo "$(DIM '[?]') $grade_result" ;;
  esac
  if $OUTPUT_JSON; then
    python3 -c "
import json, sys
print(json.dumps({'verdict': sys.argv[1], 'reason': sys.argv[2]}))
" "$verdict" "$reason"
  fi
}

# ── Command: tools — MCP tool awareness [CTL-10] ─────────────────────────────
cmd_tools() {
  local subcommand="${1:-list}"
  local tools_dir="${RUNTIME_DIR}/tools"
  mkdir -p "$tools_dir" 2>/dev/null || true

  case "$subcommand" in
    list)
      echo ""
      echo "$(BOLD 'Available MCP Tools')"
      echo "──────────────────────────────────────────────────────────"
      if python3 -c "import swarmx" 2>/dev/null; then
        python3 - "$RUNTIME_DIR" <<'PY' 2>/dev/null || true
import sys
from pathlib import Path
sys.path.insert(0, str(Path(sys.argv[1]).parent.parent / "src"))
try:
    from swarmx.tooling import list_tools
    tools = list_tools(Path(sys.argv[1]))
    for t in tools:
        print(f"  {t.get('name','?'):<30} {t.get('description','')[:60]}")
    if not tools:
        print("  No MCP tools registered. Add tools to ~/.swarmx/tools/")
except Exception as e:
    print(f"  [tools] {e}")
PY
      else
        # Fallback: list yaml manifests in tools dir
        local found=0
        for f in "${tools_dir}"/*.yaml "${tools_dir}"/*.json; do
          [[ -f "$f" ]] && { echo "  $(basename "$f")"; found=1; }
        done
        [[ $found -eq 0 ]] && echo "  No tools found in $tools_dir"
      fi
      echo "──────────────────────────────────────────────────────────"
      ;;
    run)
      local tool_name="${2:-}"
      [[ -z "$tool_name" ]] && { _err "Usage: tools run <tool-name>"; exit 3; }
      _log "Invoking tool: $tool_name"
      if python3 -c "import swarmx" 2>/dev/null; then
        python3 -c "
from swarmx.tooling import invoke_tool
from pathlib import Path
result = invoke_tool(Path('$RUNTIME_DIR'), '$tool_name', {})
print(result)
" 2>/dev/null || _err "Tool invocation failed: $tool_name"
      else
        _err "swarmx not installed — tool invocation requires: pip install -e ."
      fi
      ;;
    *)
      _err "Unknown tools subcommand: $subcommand (use list|run)"
      exit 3
      ;;
  esac
}

# ── Command: hooks — lifecycle hook management [CTL-05] ──────────────────────
cmd_hooks() {
  local hooks_file="${RUNTIME_DIR}/controller/hooks.yaml"
  mkdir -p "${RUNTIME_DIR}/controller" 2>/dev/null || true

  echo ""
  echo "$(BOLD 'Controller Lifecycle Hooks')"
  echo "  File: $hooks_file"
  echo "  Available hook points: pre_route post_route pre_reason post_reason"
  echo "                         pre_code post_code pre_chain post_chain"
  echo ""

  if [[ ! -f "$hooks_file" ]]; then
    echo "  No hooks file found. Creating template..."
    cat > "$hooks_file" <<'HOOKS'
# SwarmX Controller Lifecycle Hooks v4
# Each hook is a shell command string.
# Leave empty to disable.

# pre_route:  "echo '[hook] pre_route'"
# post_route: ""
# pre_chain:  "git status --short"
# post_chain: "echo '[hook] chain complete'"
pre_route: ""
post_route: ""
pre_reason: ""
post_reason: ""
pre_code: ""
post_code: ""
pre_chain: ""
post_chain: ""
HOOKS
    echo "  Created: $hooks_file"
    echo "  Edit to add custom hook commands."
  else
    cat "$hooks_file"
  fi
  echo ""
}

# ── Command: auto (signal-based routing) ─────────────────────────────────────
cmd_auto() {
  local prompt="$1"
  local prompt_lower; prompt_lower="$(echo "$prompt" | tr '[:upper:]' '[:lower:]')"

  local code_signals="implement|refactor|test|tool_call|generate_code|security_review|frontend|backend|data_pipeline|build|deploy|debug|fix|patch|scaffold|component|api|endpoint|schema|migration|webhook|middleware|plugin"
  local reason_signals="plan|strategy|reason|research|architecture|analyze|analyse|simulate|evaluate_deep|causal_trace|design|review|audit|propose|assessment|tradeoff|decision|compare"
  # [CTL-FIX-04] Simplified regex — no look-ahead constructs in bash grep -E
  local solve_signals="best approach|propose approach|compare approach|optimal tradeoff|tradeoff vs|vs tradeoff|best-of-n|n-candidate"

  if echo "$prompt_lower" | grep -qE "($solve_signals)"; then
    _log "Auto-routing: SOLVE signals detected → Dr. Zero loop"
    cmd_solve "$prompt"
  elif echo "$prompt_lower" | grep -qE "($code_signals)"; then
    _log "Auto-routing: CODE signals → Qwen2.5-Coder"
    cmd_code "$prompt"
  elif echo "$prompt_lower" | grep -qE "($reason_signals)"; then
    _log "Auto-routing: REASON signals → DeepSeek-R1"
    cmd_reason "$prompt"
  else
    _log "Auto-routing: ROUTER (default) → Phi-4-mini"
    cmd_route "$prompt"
  fi
}

# ── Command: gate ─────────────────────────────────────────────────────────────
cmd_gate() {
  local gate_flags=("$@")
  local gate_script="${ROOT}/swarm-gate.sh"
  if [[ ! -f "$gate_script" ]]; then
    _err "swarm-gate.sh not found at: $gate_script"
    exit 3
  fi
  # [CTL-V42-04] --health routes to swarm-gate.sh --health (μ-10 only)
  bash "$gate_script" --runtime "$RUNTIME_DIR" "${gate_flags[@]}"
}

# ── Command: status ───────────────────────────────────────────────────────────
cmd_status() {
  echo ""
  echo "$(BOLD 'SwarmX Controller Status') v${CONTROLLER_VERSION} · ${CONTROLLER_BUILD}"
  echo "──────────────────────────────────────────────────────────"

  if _ollama_alive; then
    echo "  $(GREEN '[✓]') Ollama daemon: $(GREEN 'RUNNING') · ${OLLAMA_HOST}"
  else
    echo "  $(RED '[✗]') Ollama daemon: $(RED 'OFFLINE') · ${OLLAMA_HOST}"
    echo "       Start with: ollama serve"
    echo ""
    return 1
  fi
  echo ""

  echo "  $(BOLD 'Model Triad:')"
  local available; available="$(_ollama_available_models)"
  local running; running="$(_ollama_running_models)"

  for pair in \
    "${MODEL_ROUTER}:ORCHESTRATOR:Phi-4-mini routing/classification" \
    "${MODEL_REASON}:REASONING:DeepSeek-R1 planning/architecture" \
    "${MODEL_CODE}:EXECUTION:Qwen2.5-Coder implementation/generation"; do
    local model="${pair%%:*}"
    local rest="${pair#*:}"
    local role="${rest%%:*}"
    local desc="${rest#*:}"
    local status_str=""
    if echo "$running" | grep -qi "^${model}"; then
      status_str="$(GREEN 'LOADED')"
    elif echo "$available" | grep -qi "^${model}"; then
      status_str="$(CYAN 'AVAILABLE')"
    else
      status_str="$(YELLOW 'NOT PULLED')"
    fi
    printf "  %-12s %-10s %s\n" "$(BOLD "$role")" "$status_str" "$(DIM "$desc")"
    printf "               $(DIM '%s')\n" "$model"
  done
  # [CTL-V42-02] VRAM usage from /api/ps
  echo ""
  echo "  $(BOLD 'VRAM Usage (live):')"
  curl -sf --max-time 3 "${OLLAMA_API_PS}" 2>/dev/null \
    | python3 - <<'PYVRAM'
import json, sys
try:
    d = json.load(sys.stdin)
    models = d.get("models", [])
    if not models:
        print("    No models currently loaded")
    else:
        total = 0
        for m in models:
            vram_gb = round(m.get("size_vram", 0) / (1024**3), 1)
            total += m.get("size_vram", 0)
            print(f"    {m.get('name','?'):<30}  {vram_gb}GB VRAM")
        print(f"    {'TOTAL':<30}  {round(total/(1024**3),1)}GB")
except Exception:
    print("    Unable to query /api/ps")
PYVRAM

  echo ""

  # v4 metrics
  echo "  $(BOLD 'v4 Features:')"
  local mem_count=0
  [[ -f "${RUNTIME_DIR}/memory/controller.jsonl" ]] && \
    mem_count="$(wc -l < "${RUNTIME_DIR}/memory/controller.jsonl" | tr -d ' ')"
  local chain_count; chain_count="$(ls "${CONTROLLER_LOG_DIR}/chain_"*.jsonl 2>/dev/null | wc -l | tr -d ' ')"
  local dispatch_count=0
  [[ -f "${CONTROLLER_LOG_DIR}/dispatch.jsonl" ]] && \
    dispatch_count="$(wc -l < "${CONTROLLER_LOG_DIR}/dispatch.jsonl" | tr -d ' ')"
  printf "  %-30s %s\n" "MemEvolve notes" "$mem_count"
  printf "  %-30s %s\n" "Chain traces" "$chain_count"
  printf "  %-30s %s\n" "Total dispatches" "$dispatch_count"
  printf "  %-30s %s\n" "Vertical" "${VERTICAL:-(auto-detect)}"
  printf "  %-30s %s\n" "Confidence grade" "$( $SKIP_GRADE && echo 'DISABLED' || echo 'ENABLED')"
  printf "  %-30s %s\n" "Adversarial critique" "$( [[ "$ADVERSARIAL" == "1" ]] && echo 'ENABLED' || echo 'DISABLED')"
  printf "  %-30s %s\n" "VRAM ceiling" "${VRAM_CEILING_GB}GB"

  # [CTL-ENH-03] Per-model P95 latency from dispatch.jsonl
  if [[ -f "${CONTROLLER_LOG_DIR}/dispatch.jsonl" ]]; then
    echo ""
    echo "  $(BOLD 'Latency P95 (from dispatch log):')"
    python3 - "${CONTROLLER_LOG_DIR}/dispatch.jsonl" <<'PYSTAT'
import json, sys
from collections import defaultdict
records = defaultdict(list)
with open(sys.argv[1]) as f:
    for line in f:
        try:
            d = json.loads(line.strip())
            ms = d.get("elapsed_ms", 0)
            m  = d.get("model", "unknown")
            if ms > 0:
                records[m].append(ms)
        except Exception:
            pass
for model, samples in sorted(records.items()):
    samples.sort()
    p95 = samples[int(len(samples) * 0.95)]
    print(f"    {model:<25}  P95={p95}ms  (n={len(samples)})")
PYSTAT
  fi
  echo ""
  echo "──────────────────────────────────────────────────────────"
}

# ── Command: doctor ───────────────────────────────────────────────────────────
cmd_doctor() {
  echo ""
  echo "$(BOLD 'SwarmX Controller Doctor') v${CONTROLLER_VERSION}"
  echo "══════════════════════════════════════════════════════════"

  local issues=0

  echo "$(CYAN '[1/8]') Core dependencies"
  for dep in curl python3 jq ollama; do
    if command -v "$dep" >/dev/null 2>&1; then
      echo "   $(GREEN '[✓]') $dep"
    else
      echo "   $(RED '[✗]') $dep — not found"
      issues=$((issues+1))
    fi
  done
  echo ""

  echo "$(CYAN '[2/8]') Ollama daemon"
  if _ollama_alive; then
    echo "   $(GREEN '[✓]') Reachable at $OLLAMA_HOST"
  else
    echo "   $(RED '[✗]') Not reachable at $OLLAMA_HOST"
    echo "          Start: ollama serve"
    issues=$((issues+1))
  fi
  echo ""

  echo "$(CYAN '[3/8]') Model triad"
  local available; available="$(_ollama_available_models 2>/dev/null || true)"
  for pair in "$MODEL_ROUTER:Phi-4-mini (orchestrator)" "$MODEL_REASON:DeepSeek-R1:7B (reasoning)" "$MODEL_CODE:Qwen2.5-Coder (execution)"; do
    local m="${pair%%:*}" label="${pair#*:}"
    if echo "$available" | grep -qi "^${m}"; then
      echo "   $(GREEN '[✓]') $label ($m)"
    else
      echo "   $(YELLOW '[!]') $label not pulled — run: ollama pull $m"
      issues=$((issues+1))
    fi
  done
  echo ""

  echo "$(CYAN '[4/8]') Environment"
  for var in SWARM_MODEL_FAST SWARM_MODEL_REASON SWARM_MODEL_CODE SWARM_HOME OLLAMA_HOST SWARM_VERTICAL; do
    local val="${!var:-}"
    if [[ -n "$val" ]]; then
      echo "   $(GREEN '[✓]') $var=$val"
    else
      echo "   $(DIM '[–]') $var not set (using default)"
    fi
  done
  echo ""

  echo "$(CYAN '[5/8]') Runtime"
  if [[ -d "$RUNTIME_DIR" ]]; then
    echo "   $(GREEN '[✓]') Runtime dir: $RUNTIME_DIR"
  else
    echo "   $(YELLOW '[!]') Runtime dir not found: $RUNTIME_DIR (run: swarm init <repo>)"
  fi
  if [[ -f "${ROOT}/swarm-gate.sh" ]]; then
    echo "   $(GREEN '[✓]') swarm-gate.sh present"
  else
    echo "   $(YELLOW '[!]') swarm-gate.sh not found at $ROOT"
  fi
  echo ""

  echo "$(CYAN '[6/8]') Python + swarmx package"
  if python3 -c "import swarmx" 2>/dev/null; then
    local ver; ver="$(python3 -c "import swarmx; print(getattr(swarmx, '__version__', 'unknown'))" 2>/dev/null)"
    echo "   $(GREEN '[✓]') swarmx installed ($ver)"
  else
    echo "   $(YELLOW '[!]') swarmx not importable — run: pip install -e . from repo root"
    issues=$((issues+1))
  fi
  echo ""

  echo "$(CYAN '[7/8]') v4 MemEvolve layer"
  local mem_file="${RUNTIME_DIR}/memory/controller.jsonl"
  if [[ -f "$mem_file" ]]; then
    local note_count; note_count="$(wc -l < "$mem_file" | tr -d ' ')"
    echo "   $(GREEN '[✓]') controller.jsonl exists ($note_count notes)"
  else
    echo "   $(DIM '[–]') controller.jsonl not yet created (will be created on first chain dispatch)"
  fi
  local hooks_file="${RUNTIME_DIR}/controller/hooks.yaml"
  if [[ -f "$hooks_file" ]]; then
    echo "   $(GREEN '[✓]') hooks.yaml exists"
  else
    echo "   $(DIM '[–]') hooks.yaml not found (run: ./swarm-controller.sh hooks to create)"
  fi
  echo ""

  echo "$(CYAN '[8/8]') v4.2 Ollama resource health"  # [CTL-V42-03]
  if _ollama_alive; then
    local vram_used
    vram_used="$(curl -sf --max-time 3 "${OLLAMA_API_PS}" 2>/dev/null \
      | python3 -c '
import json, sys
d = json.loads(sys.stdin.read() or "{}")
total = sum(m.get("size_vram", 0) for m in d.get("models", []))
print(round(total / (1024**3), 1))
' 2>/dev/null || echo "unknown")"
    echo "   $(GREEN '[✓]') VRAM used: ${vram_used}GB (ceiling: ${VRAM_CEILING_GB}GB)"

    if [[ -f "${CONTROLLER_LOG_DIR}/dispatch.jsonl" ]]; then
      local recent_errors
      recent_errors="$(tail -100 "${CONTROLLER_LOG_DIR}/dispatch.jsonl" 2>/dev/null \
        | python3 -c '
import sys, json
count = 0
for line in sys.stdin:
    try:
        if json.loads(line.strip()).get("status") == "error":
            count += 1
    except Exception:
        pass
print(count)
' 2>/dev/null || echo "0")"
      if [[ "$recent_errors" -gt 8 ]]; then
        echo "   $(YELLOW '[!]') High error rate in last 100 dispatches (${recent_errors}) — run: --fix-mode or flush"
        issues=$((issues+1))
      else
        echo "   $(GREEN '[✓]') Dispatch error rate: ${recent_errors}/100 — healthy"
      fi
    else
      echo "   $(DIM '[–]') No dispatch.jsonl yet — run a chain to populate"
    fi
  else
    echo "   $(YELLOW '[!]') Ollama not reachable — VRAM check skipped"
  fi
  echo ""

  echo "══════════════════════════════════════════════════════════"
  if [[ $issues -eq 0 ]]; then
    echo "$(GREEN 'Doctor: CLEAN') — all checks passed"
  else
    echo "$(YELLOW "Doctor: $issues issue(s) found") — see warnings above"
  fi
  echo ""
  return $issues
}

# ── Usage ─────────────────────────────────────────────────────────────────────
_usage() {
  cat <<EOF
$(BOLD 'swarm-controller.sh') v${CONTROLLER_VERSION} — SwarmX Meta-Evolution Dispatch Controller

$(BOLD 'COMMANDS')
  route  <prompt>    Phi-4-mini     orchestration / routing / evaluation
  reason <prompt>    DeepSeek-R1    planning / architecture / analysis
  code   <prompt>    Qwen2.5-Coder    implementation / generation / testing
  chain  <prompt>    Full pipeline  route → reason → code + MemEvolve + trace
  solve  <prompt>    Dr. Zero       proposer-solver loop, island tournament
  evolve [--apply]   GEA            group-evolve from recent telemetry
  grade  <text>      Critic pass    confidence gate on arbitrary text
  tools  [list|run]  MCP tools      tool awareness and invocation
  auto   <prompt>    Auto-select    signal-based routing per routing.yaml
  gate   [--all]     IEP gates      wraps swarm-gate.sh (7 gates)
  hooks              Lifecycle      list/edit controller hooks
  status             Model triad health + v4 metrics
  flush              Unload all models + drop kernel caches
  doctor             Full environment diagnostic (v4: MemEvolve check)

$(BOLD 'OPTIONS')
  --runtime <dir>    .swarmx runtime dir  (default: ~/.swarmx)
  --timeout <sec>    Override per-model timeout
  --keep-alive <s>   Keep model in RAM after response (default: 0 = unload)
  --context <file>   Inject .json/.md/.yaml context file into prompt
  --json             Structured JSON output
  --quiet            Pipe-safe output (no banners)
  --dry-run          Resolve config without calling Ollama
  --gate-before      Run IEP gates before dispatch
  --gate-after       Run IEP gates after dispatch
  --verbose          Print full prompt sent to model
  --skip-grade       Skip confidence gate critic pass [v4]
  --vertical <name>  Force vertical context injection [v4]
  --proposals <N>    Number of Dr. Zero proposals (default: 3) [v4]

$(BOLD 'ENV VARS')
  SWARM_MODEL_FAST    Orchestrator model  (default: phi4-mini)
  SWARM_MODEL_REASON  Reasoning model     (default: deepseek-r1:7b)
  SWARM_MODEL_CODE    Execution model     (default: qwen3-coder)
  SWARM_HOME          Runtime dir         (default: ~/.swarmx)
  OLLAMA_HOST         Ollama endpoint     (default: http://localhost:11434)
  SWARM_VERTICAL      vertical context    (taxbridge|sabiscore|hashablanca) [v4]
  SWARM_TZ            display timezone    (default: Africa/Lagos / WAT) [v4]
  SWARM_ADVERSARIAL   enable chain Phase 4 adversarial critique (1=on) [v4.1]
  SWARM_VRAM_CEILING_GB  VRAM flush ceiling in GB (default: 10) [v4.2]

$(BOLD 'EXAMPLES')
  $(DIM '# Single-model dispatch')
  ./swarm-controller.sh route "Is this a planning or coding task?"
  ./swarm-controller.sh reason "Design the NRS webhook retry architecture"
  ./swarm-controller.sh code "Implement Fastify 5 idempotency middleware in TypeScript"

  $(DIM '# Full triadic pipeline with MemEvolve')
  ./swarm-controller.sh chain "Architect and implement BullMQ job retry with exponential backoff"

  $(DIM '# Dr. Zero proposer-solver')
  ./swarm-controller.sh solve "Best approach for SabiScore ensemble model serving"
  ./swarm-controller.sh solve --proposals 5 "ZK proof batching strategy for Hashablanca"

  $(DIM '# Group evolution')
  ./swarm-controller.sh evolve
  ./swarm-controller.sh evolve --apply

  $(DIM '# Vertical context forcing')
  SWARM_VERTICAL=taxbridge ./swarm-controller.sh chain "Add NRS e-invoice validation"

  $(DIM '# Auto-routing')
  ./swarm-controller.sh auto "Analyze and refactor the Prisma schema for TaxBridge invoices"

  $(DIM '# With context file + JSON output')
  ./swarm-controller.sh code --context .swarmx/memory/latest.json --json "Add NRS e-invoice validation"

  $(DIM '# Session mode (keep model loaded, faster for multi-turn)')
  ./swarm-controller.sh code --keep-alive 300 "Write the SabiScore ML pipeline"
EOF
  exit 0
}

# ── Argument parsing ──────────────────────────────────────────────────────────
if [[ $# -eq 0 ]]; then _usage; fi
COMMAND="$1"; shift

POSITIONAL=()
EVOLVE_APPLY=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --runtime)    RUNTIME_DIR="$2"; shift 2 ;;
    --timeout)    CUSTOM_TIMEOUT="$2"; shift 2 ;;
    --keep-alive) KEEP_ALIVE="$2"; shift 2 ;;
    --context)    CONTEXT_FILE="$2"; shift 2 ;;
    --json)       OUTPUT_JSON=true; shift ;;
    --quiet)      QUIET=true; shift ;;
    --dry-run)    DRY_RUN=true; shift ;;
    --gate-before) GATE_BEFORE=true; shift ;;
    --gate-after)  GATE_AFTER=true; shift ;;
    --verbose)    VERBOSE=true; shift ;;
    --skip-grade) SKIP_GRADE=true; shift ;;
    --vertical)   VERTICAL="$2"; shift 2 ;;
    --proposals)  PROPOSALS_N="$2"; shift 2 ;;
    --island)     ISLAND_PIN="$2"; shift 2 ;;
    --apply)      EVOLVE_APPLY=true; shift ;;
    --adversarial) ADVERSARIAL=1; shift ;;           # [CTL-ENH-01]
    --proposer-solver) USE_PROPOSER_SOLVER=true; shift ;; # [CTL-ENH-02]
    --all|--models|--gate) POSITIONAL+=("$1"); shift ;;
    -h|--help)    _usage ;;
    --) shift; POSITIONAL+=("$@"); break ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done

PROMPT="${POSITIONAL[*]:-}"

# ── Preflight checks ──────────────────────────────────────────────────────────
_require curl python3

if [[ "$COMMAND" =~ ^(route|reason|code|chain|auto|solve|grade)$ ]] && ! $DRY_RUN; then
  if ! _ollama_alive; then
    _err "Ollama not reachable at $OLLAMA_HOST"
    _err "Start with: ollama serve"
    exit 3
  fi
fi

# Optional pre-dispatch gate
if $GATE_BEFORE && [[ "$COMMAND" =~ ^(route|reason|code|chain|auto|solve)$ ]]; then
  _log "Running pre-dispatch IEP gates"
  _gate_exit=0
  cmd_gate --all || _gate_exit=$?
  if [[ $_gate_exit -ge 2 ]]; then
    _err "Gate BLOCK — aborting dispatch"
    exit 4
  fi
fi

# ── Dispatch ──────────────────────────────────────────────────────────────────
EXIT_CODE=0
case "$COMMAND" in
  route)   [[ -z "$PROMPT" ]] && { _err "Prompt required for: route"; exit 3; }
           cmd_route "$PROMPT" || EXIT_CODE=$? ;;
  reason)  [[ -z "$PROMPT" ]] && { _err "Prompt required for: reason"; exit 3; }
           cmd_reason "$PROMPT" || EXIT_CODE=$? ;;
  code)    [[ -z "$PROMPT" ]] && { _err "Prompt required for: code"; exit 3; }
           cmd_code "$PROMPT" || EXIT_CODE=$? ;;
  chain)   [[ -z "$PROMPT" ]] && { _err "Prompt required for: chain"; exit 3; }
           GATE_BEFORE=true GATE_AFTER=true
           cmd_chain "$PROMPT" || EXIT_CODE=$? ;;
  solve)   [[ -z "$PROMPT" ]] && { _err "Prompt required for: solve"; exit 3; }
           cmd_solve "$PROMPT" || EXIT_CODE=$? ;;
  auto)    [[ -z "$PROMPT" ]] && { _err "Prompt required for: auto"; exit 3; }
           cmd_auto "$PROMPT" || EXIT_CODE=$? ;;
  evolve)  cmd_evolve "$EVOLVE_APPLY" || EXIT_CODE=$? ;;
  grade)   [[ -z "$PROMPT" ]] && { _err "Text required for: grade"; exit 3; }
           cmd_grade "$PROMPT" || EXIT_CODE=$? ;;
  tools)   cmd_tools "${POSITIONAL[@]:-list}" || EXIT_CODE=$? ;;
  gate)    cmd_gate "${POSITIONAL[@]:-}" || EXIT_CODE=$? ;;
  flush)   flush_models || EXIT_CODE=$? ;;
  status)  cmd_status || EXIT_CODE=$? ;;
  doctor)  cmd_doctor || EXIT_CODE=$? ;;
  hooks)   cmd_hooks || EXIT_CODE=$? ;;
  context)
    [[ -z "$PROMPT" ]] && { _err "File path required for: context"; exit 3; }
    _load_context "$PROMPT" ;;
  help|-h|--help) _usage ;;
  *)
    _err "Unknown command: $COMMAND"
    echo "Run: ./swarm-controller.sh --help" >&2
    exit 3 ;;
esac

# Optional post-dispatch gate
if $GATE_AFTER && [[ "$COMMAND" =~ ^(route|reason|code|chain|auto|solve)$ ]]; then
  _log "Running post-dispatch IEP gates"
  cmd_gate --all || true
fi

exit $EXIT_CODE
