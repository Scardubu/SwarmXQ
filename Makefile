# ═══════════════════════════════════════════════════════════════════════════════
# SwarmX Production Makefile
#
# Usage: make <target>
# Run `make help` for a full list of targets.
#
# Prerequisites: docker, docker compose v2, python 3.11+, pnpm, curl
# ═══════════════════════════════════════════════════════════════════════════════

.DEFAULT_GOAL := help
.PHONY: help build build-fast up down restart logs logs-api logs-python \
        logs-dashboard ps health health-quick migrate db-check ollama-pull \
        ollama-list install lint typecheck-py typecheck-ts test test-cov \
        test-ts clean purge check-env dev check-phase1 dry-run \
        test-brain test-memory test-agents test-evolution test-fast \
        validate-imports check-v58

# ── Configuration ─────────────────────────────────────────────────────────────

COMPOSE        := docker compose
PYTHON         := python3
PIP            := $(PYTHON) -m pip
SWARM_HOME     ?= $(HOME)/.swarmx
OLLAMA_HOST    ?= http://localhost:11434
DASHBOARD_URL  ?= http://localhost:3000
API_URL        ?= http://localhost:3001
PYTHON_URL     ?= http://localhost:8787

# Colour helpers (silent no-op if terminal does not support them)
GREEN  := $(shell tput setaf 2 2>/dev/null || echo "")
YELLOW := $(shell tput setaf 3 2>/dev/null || echo "")
RESET  := $(shell tput sgr0  2>/dev/null || echo "")

# ── Help ──────────────────────────────────────────────────────────────────────

help: ## Show this help message
	@echo ""
	@echo "$(GREEN)SwarmX Production Make Targets$(RESET)"
	@echo "──────────────────────────────────────────────────────────────────"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-22s$(RESET) %s\n", $$1, $$2}'
	@echo ""

# ── Prerequisites check ───────────────────────────────────────────────────────

check-env: ## Validate all prerequisites before deployment
	@echo "$(YELLOW)Checking prerequisites...$(RESET)"
	@command -v docker   >/dev/null 2>&1 || (echo "ERROR: docker not found"   && exit 1)
	@docker compose version >/dev/null 2>&1 || (echo "ERROR: docker compose v2 not found" && exit 1)
	@command -v python3  >/dev/null 2>&1 || (echo "ERROR: python3 not found"  && exit 1)
	@command -v curl     >/dev/null 2>&1 || (echo "ERROR: curl not found"     && exit 1)
	@[ -f env.local ] || (echo "$(YELLOW)WARN: env.local missing — copy env.example and fill in values$(RESET)")
	@echo "$(GREEN)Prerequisites OK$(RESET)"

# ── Build ─────────────────────────────────────────────────────────────────────

build: check-env ## Build all Docker images (no cache — for CI / fresh deploy)
	@echo "$(YELLOW)Building all images...$(RESET)"
	$(COMPOSE) build --pull --no-cache
	@echo "$(GREEN)Build complete$(RESET)"

build-fast: ## Build all Docker images (use cache — for iterative dev)
	$(COMPOSE) build --pull

# ── Lifecycle ─────────────────────────────────────────────────────────────────

up: ## Start all services in detached mode
	@echo "$(YELLOW)Starting SwarmX stack...$(RESET)"
	$(COMPOSE) up -d
	@echo "$(GREEN)Stack up. Run 'make ps' to verify health.$(RESET)"

down: ## Stop and remove containers (volumes are preserved)
	@echo "$(YELLOW)Stopping SwarmX stack...$(RESET)"
	$(COMPOSE) down
	@echo "$(GREEN)Stack down$(RESET)"

restart: down up ## Full stop + start cycle

# ── Observability ─────────────────────────────────────────────────────────────

ps: ## Show container status and health
	$(COMPOSE) ps

logs: ## Follow logs for all services (Ctrl+C to stop)
	$(COMPOSE) logs -f --tail=100

logs-api: ## Follow logs for swarmx-api only
	$(COMPOSE) logs -f --tail=100 swarmx-api

logs-python: ## Follow logs for swarmx-python only
	$(COMPOSE) logs -f --tail=100 swarmx-python

logs-dashboard: ## Follow logs for swarmx-dashboard only
	$(COMPOSE) logs -f --tail=100 swarmx-dashboard

# ── Health checks ─────────────────────────────────────────────────────────────

health: ## Run the comprehensive deployment health check
	@bash scripts/healthcheck.sh

health-quick: ## Quick liveness check (curl only, no Docker required)
	@echo "$(YELLOW)Checking liveness...$(RESET)"
	@curl -sf $(PYTHON_URL)/health    >/dev/null && echo "  Python    $(GREEN)OK$(RESET)" || echo "  Python    $(YELLOW)DOWN$(RESET)"
	@curl -sf $(API_URL)/health       >/dev/null && echo "  API       $(GREEN)OK$(RESET)" || echo "  API       $(YELLOW)DOWN$(RESET)"
	@curl -sf $(OLLAMA_HOST)/api/tags >/dev/null && echo "  Ollama    $(GREEN)OK$(RESET)" || echo "  Ollama    $(YELLOW)DOWN$(RESET)"
	@curl -sf $(DASHBOARD_URL)        >/dev/null && echo "  Dashboard $(GREEN)OK$(RESET)" || echo "  Dashboard $(YELLOW)DOWN$(RESET)"

# ── Database ──────────────────────────────────────────────────────────────────

migrate: ## Run V5 schema migration (idempotent — safe to re-run)
	@echo "$(YELLOW)Running V5 migrations...$(RESET)"
	$(PYTHON) -c "from swarmx.migrations.v5_memory import run_migration; \
	              from pathlib import Path; import os; \
	              home=Path(os.environ.get('SWARM_HOME','$(SWARM_HOME)')); \
	              run_migration(home); print('Migration complete')"
	@echo "$(GREEN)Migration done$(RESET)"

db-check: ## Run SQLite integrity check on the runtime database
	@echo "$(YELLOW)Checking database integrity...$(RESET)"
	$(PYTHON) -c "from swarmx.core.db import db_integrity_check; \
	              from pathlib import Path; import os; \
	              home=Path(os.environ.get('SWARM_HOME','$(SWARM_HOME)')); \
	              ok=db_integrity_check(home); print('OK' if ok else 'FAIL'); \
	              exit(0 if ok else 1)"

# ── Models ────────────────────────────────────────────────────────────────────

ollama-pull: ## Pull the full triadic model set into Ollama
	@echo "$(YELLOW)Pulling LLM model triad...$(RESET)"
	OLLAMA_HOST="$(OLLAMA_HOST)" ollama pull phi4-mini
	OLLAMA_HOST="$(OLLAMA_HOST)" ollama pull qwen2.5-coder
	OLLAMA_HOST="$(OLLAMA_HOST)" ollama pull deepseek-r1:7b
	@echo "$(GREEN)All models pulled$(RESET)"

ollama-list: ## List models currently loaded in Ollama
	@curl -sf $(OLLAMA_HOST)/api/tags | python3 -m json.tool

# ── Python development ────────────────────────────────────────────────────────

install: ## Install Python package in editable mode with all extras
	$(PIP) install --upgrade pip wheel setuptools
	$(PIP) install -r requirements.txt
	$(PIP) install -e ".[all,dev]"

dev: install ## Alias for install (development setup)

lint: ## Run ruff linter on all Python source (auto-fix)
	$(PYTHON) -m ruff check src/ tests/ brain/ agents/ memory/ core/ --fix

typecheck-py: ## Run mypy type checking on Python source
	$(PYTHON) -m mypy src/swarmx/ brain/ --ignore-missing-imports

test: ## Run full Python test suite (all modules)
	$(PYTHON) -m pytest tests/ -q --tb=short

test-brain: ## Run brain/ subsystem tests only
	$(PYTHON) -m pytest tests/brain/ -q --tb=short -v

test-memory: ## Run memory/ subsystem tests only
	$(PYTHON) -m pytest tests/memory/ -q --tb=short -v

test-agents: ## Run agents/ subsystem tests only
	$(PYTHON) -m pytest tests/agents/ -q --tb=short -v

test-evolution: ## Run evolution subsystem tests only
	$(PYTHON) -m pytest tests/evolution/ -q --tb=short -v

test-fast: ## Run only tests marked as fast (skip slow integration tests)
	$(PYTHON) -m pytest tests/ -q --tb=short -m "not slow"

test-cov: ## Run Python tests with coverage report (all modules)
	$(PYTHON) -m pytest tests/ -q --tb=short \
	    --cov=src/swarmx --cov=brain --cov=memory --cov=agents \
	    --cov-report=term-missing --cov-report=html

# ── V5.8 validation ──────────────────────────────────────────────────────────

validate-imports: ## Validate all brain/ and memory/ modules import cleanly (no ML deps required)
	@echo "$(YELLOW)Validating brain/ imports...$(RESET)"
	$(PYTHON) -c "import brain; print('  brain OK')"
	$(PYTHON) -c "import brain.rag; print('  brain.rag OK')"
	$(PYTHON) -c "import brain.scorer; print('  brain.scorer OK')"
	$(PYTHON) -c "import brain.roles; print('  brain.roles OK')"
	$(PYTHON) -c "import brain.graph; print('  brain.graph OK')"
	@echo "$(YELLOW)Validating memory/ imports...$(RESET)"
	$(PYTHON) -c "import memory; print('  memory OK')"
	$(PYTHON) -c "from memory import get_store; s=get_store(); print(f'  store={type(s).__name__} OK')"
	@echo "$(YELLOW)Validating agents/ imports...$(RESET)"
	$(PYTHON) -c "from agents.executor import execute_parallel; print('  agents.executor OK')"
	$(PYTHON) -c "from agents.analyzer import analyze_output; print('  agents.analyzer OK')"
	@echo "$(GREEN)All imports validated$(RESET)"

check-v58: check-env validate-imports test-brain test-memory test-agents ## Full V5.8 validation suite
	@echo "$(GREEN)V5.8 validation complete$(RESET)"

check-phase1: ## Verify Phase 1 canonical runtime boundary invariants (no pytest required)
	@echo "$(YELLOW)Running Phase 1 invariant checks...$(RESET)"
	@bash scripts/ci_phase1_check.sh
	@echo "$(GREEN)Phase 1 check complete$(RESET)"

dry-run: ## Show resolved dispatch target and dependency readiness without launching
	@SWARM_DRY_RUN=1 bash swarm.sh

# ── TypeScript / Node ─────────────────────────────────────────────────────────

typecheck-ts: ## Run TypeScript type check across all packages
	pnpm run typecheck

test-ts: ## Run dashboard and package tests (vitest)
	pnpm run test

# ── Cleanup ───────────────────────────────────────────────────────────────────

clean: ## Remove Python build artefacts and caches
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name "*.egg-info" -exec rm -rf {} + 2>/dev/null || true
	find . -name "*.pyc" -delete 2>/dev/null || true
	rm -rf dist/ build/ .pytest_cache/ .mypy_cache/ .ruff_cache/ htmlcov/ || true

purge: down clean ## Full teardown including Docker volumes (DESTRUCTIVE)
	@echo "$(YELLOW)WARNING: This will permanently delete all runtime data volumes.$(RESET)"
	@read -p "Type YES to continue: " confirm && [ "$$confirm" = "YES" ] || exit 1
	$(COMPOSE) down -v
	@echo "$(GREEN)All volumes purged$(RESET)"
