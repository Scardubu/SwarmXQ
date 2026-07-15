# SwarmXQ Installation Guide

## System requirements

| Component | Requirement |
|---|---|
| OS | Linux (Ubuntu 22.04+ recommended), macOS 13+, WSL2 |
| Python | 3.11 or 3.12 |
| Node.js | 22 LTS |
| pnpm | 11.9.0 (`npm install -g pnpm@11.9.0`) |
| Redis | 7.x |
| Disk | 2 GB free (models need additional space — see Step 5) |
| RAM | 8 GB minimum, 16 GB recommended |

## Quick install (recommended)

```bash
chmod +x scripts/install.sh
./scripts/install.sh
```

Reload your shell, then run:

```bash
swarm doctor
```

`swarm doctor` validates every dependency and reports pass/fail for each check.

## Manual install

### 1 — Clone and enter the repo

```bash
git clone https://github.com/Scardubu/SwarmXQ.git
cd SwarmXQ
```

### 2 — Python side

```bash
python3.11 -m venv ~/.swarmx/venv
source ~/.swarmx/venv/bin/activate
pip install --upgrade pip
pip install -e ".[dev]"
```

Add to `~/.bashrc` or `~/.zshrc`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

### 3 — Node.js side

```bash
pnpm install
pnpm build
```

### 4 — Redis

```bash
# Ubuntu / Debian
sudo apt-get install redis-server
sudo systemctl enable --now redis

# macOS
brew install redis
brew services start redis
```

### 5 — Local LLM models (Ollama)

Download the GGUF files referenced by the canonical Modelfiles and place them in
`~/llm-local/gguf/`. The Modelfiles under `models/Modelfiles/` expect that exact
directory path; edit the `FROM` line in each Modelfile if you store GGUFs elsewhere.

| Operator  | Canonical tag                        | GGUF family |
|-----------|--------------------------------------|-------------|
| Relay     | `route-phi4-lite-q4km-prod`         | Phi-4-mini |
| Pilot     | `instruct-phi4-pro-q8-prod`         | Phi-4-mini |
| Architect | `plan-phi4-pro-q8-prod`             | Phi-4-mini |
| Architect | `plan-qwen25-pro-q5km-prod`         | Qwen2.5-7B |
| Forge     | `code-qwen25-pro-q5km-prod`         | Qwen2.5-7B |
| Oracle    | `reason-deepseekr1-pro-q5km-prod`   | DeepSeek-R1-7B |
| Auditor   | `critique-deepseekr1-pro-q5km-prod` | DeepSeek-R1-7B |

The authoritative GGUF filenames and all eleven canonical tags are defined by the
Modelfiles and rebuild script, not by ad hoc `ollama create` commands.

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Rebuild the canonical model set from Modelfiles
bash scripts/rebuild-all-modelfiles.sh

# Verify canonical naming compliance
bash scripts/rebuild-all-modelfiles.sh --validate
```

To remove legacy alias-era models after migration, run:

```bash
bash scripts/rebuild-all-modelfiles.sh --evict-legacy
```

To swap any model later: update the corresponding Modelfile, rebuild the canonical
tag, then rerun the validation and doctor checks.

### 6 — Environment variables

Copy the example and fill in values:

```bash
cp configs/swarmx.defaults.yaml ~/.swarmx/config.yaml
```

Key environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `SWARMX_HOME` | `~/.swarmx` | Runtime data directory |
| `SWARMX_API_PORT` | `3001` | Fastify API port |
| `SWARMX_DASHBOARD_PORT` | `3000` | Dashboard port |
| `SWARMX_REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `SWARMX_WORKSPACE` | current dir | Default workspace |
| `SWARMX_LOG_LEVEL` | `info` | Log verbosity |
| `SWARMX_MAX_PTY_SESSIONS` | `8` | Max concurrent terminal sessions |
| `SWARMX_PTY_SHELL` | `/bin/bash` | Shell for terminal sessions |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama API endpoint |
| `SWARM_MODEL_FAST` | `instruct-phi4-pro-q8-prod` | Override fast fallback model |
| `SWARM_MODEL_REASON` | `reason-deepseekr1-pro-q5km-prod` | Override reasoning model |
| `SWARM_MODEL_CODE` | `code-qwen25-pro-q5km-prod` | Override execution model |

For day-to-day local startup on 8 GB hosts, prefer:

```bash
bash scripts/startup-enhanced.sh --dashboard
```

That wrapper now clamps inherited unsafe Ollama values back to the constrained
profile automatically: `OLLAMA_NUM_PARALLEL=1`, `OLLAMA_MAX_LOADED_MODELS=1`,
and `OLLAMA_KEEP_ALIVE=0`.

Secrets belong in a secrets manager. Never commit API keys or credentials to the repo.

## Post-install verification

```bash
bash scripts/verify.sh
```

Expected output: all 6 checks green.

## Updating

See [UPGRADE.md](UPGRADE.md).

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
