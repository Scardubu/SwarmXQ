# SwarmX Installation Guide

## System requirements

| Component | Requirement |
|---|---|
| OS | Linux (Ubuntu 22.04+ recommended), macOS 13+, WSL2 |
| Python | 3.11 or 3.12 |
| Node.js | 22 LTS |
| pnpm | 9.x (`npm install -g pnpm@9`) |
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
git clone https://github.com/Scardubu/SwarmX.git
cd SwarmX
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

Download the three GGUF files listed below and place them in `~/llm-local/gguf/`.
The Modelfiles in `models/Modelfiles/` expect that exact directory path; edit the
`FROM` line in each Modelfile if you store GGUFs elsewhere.

| Role          | GGUF file                                      | Quant  | ~Size |
|---------------|------------------------------------------------|--------|-------|
| orchestrator  | `microsoft_Phi-4-mini-instruct-Q8_0.gguf`      | Q8_0   | ~4 GB |
| reasoning     | `DeepSeek-R1-Distill-Qwen-7B-Q5_K_M.gguf`     | Q5_K_M | ~5 GB |
| execution     | `Qwen2.5-Coder-7B-Instruct-Q5_K_M.gguf`       | Q5_K_M | ~5 GB |

Role names match `models/registry.yaml`. The authoritative GGUF filenames are
always in `registry.yaml` — the table above is for quick reference only.

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Register the V6 model triad from local GGUF files
ollama create phi4-mini      -f models/Modelfiles/Modelfile.phi4-mini
ollama create deepseek-r1:7b -f models/Modelfiles/Modelfile.deepseek-r1
ollama create qwen2.5-coder  -f models/Modelfiles/Modelfile.qwen2.5-coder

# Verify all three are registered
ollama list
```

To swap any model later: edit `models/registry.yaml`, update the corresponding
Modelfile in `models/Modelfiles/`, run `ollama rm <old-tag>` then `ollama create`,
then `swarm doctor`. See `models/README.md` for the full swap workflow.

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
| `SWARM_MODEL_FAST` | `phi4-mini` | Override orchestrator model |
| `SWARM_MODEL_REASON` | `deepseek-r1:7b` | Override reasoning model |
| `SWARM_MODEL_CODE` | `qwen2.5-coder` | Override execution model |

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
