# SwarmX Troubleshooting

## First steps

Always start with:

```bash
swarm doctor
```

`swarm doctor` runs all health checks and reports the exact failure with a fix suggestion for each. Most issues are diagnosed here.

```bash
swarm status --json
```

Provides machine-readable runtime state.

---

## Common problems

### `swarm: command not found`

The CLI is not on `$PATH`.

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Add this line to `~/.bashrc` or `~/.zshrc`, then reload:

```bash
source ~/.bashrc
```

If `~/.local/bin/swarm` does not exist, reinstall:

```bash
./scripts/install.sh
```

---

### `swarm doctor` reports Python version failure

SwarmX requires Python 3.11+.

```bash
python3 --version
```

If the version is below 3.11, install a newer Python:

```bash
# Ubuntu
sudo add-apt-repository ppa:deadsnakes/ppa
sudo apt-get install python3.11

# macOS
brew install python@3.11
```

---

### Redis connection refused

```
ECONNREFUSED redis://localhost:6379
```

Start Redis:

```bash
sudo systemctl start redis        # Linux systemd
brew services start redis         # macOS
```

Verify:

```bash
redis-cli ping
# → PONG
```

If using a remote Redis, set:

```bash
export SWARMX_REDIS_URL=redis://host:6379
```

---

### API starts but dashboard shows "Connecting…"

The SSE stream at `/api/events` is not reachable from the dashboard.

Confirm the API is running and then follow the runtime logs:

```bash
swarm status
swarm logs --follow --level warn
```

Test the endpoint directly:

```bash
curl -N http://localhost:3001/api/events
```

---

### Terminal sessions disconnect immediately

The WebSocket endpoint `/ws/terminal/:sessionId` is timing out.

Check that `node-pty` is installed:

```bash
cd apps/swarmx-api && node -e "require('node-pty')"
```

If it fails, rebuild native modules:

```bash
pnpm rebuild
```

node-pty requires a C++ toolchain. On Ubuntu:

```bash
sudo apt-get install build-essential
```

---

### Ollama models not found

```
model not found: llama3.2:3b
```

Pull the required models:

```bash
ollama pull llama3.2:3b
ollama pull qwen2.5-coder:7b
ollama pull nomic-embed-text
```

Verify Ollama is running:

```bash
curl http://localhost:11434/api/tags
```

---

### `swarm run` exits immediately with no output

Check the runtime and then inspect recent logs:

```bash
swarm status
swarm logs --lines 100 --level info
```

Enable verbose logging:

```bash
SWARMX_LOG_LEVEL=debug swarm run <workspace> --target "..." --verbose
```

---

### Dashboard performance is slow

For large agent fleets (>50 agents), the virtualized list is active by default. If scrolling is still slow:

- Reduce `SWARMX_MAX_LOG_BUFFER` (default 1000 entries)
- Lower the SSE event rate in `configs/brain.yaml`

---

### Database locked / `SQLITE_BUSY`

Multiple processes are writing to the same SQLite file.

Only one SwarmX stack instance should run per `SWARMX_HOME`. Check for orphaned processes:

```bash
ps aux | grep swarmx
```

Kill any duplicates, then restart:

```bash
swarm up --down
swarm up
```

---

## Debug flags

| Environment variable | Effect |
|---|---|
| `SWARMX_LOG_LEVEL=debug` | Verbose logging everywhere |
| `SWARMX_JSON=1` | All CLI output as JSON |
| `SWARMX_NO_COLOR=1` | Disable terminal colors |
| `SWARMX_QUIET=1` | Suppress decorative output |
| `SWARMX_DRY_RUN=1` | Run planning steps only, no execution |

## Getting help

Collect the following before filing an issue:

- `swarm doctor`
- `swarm status --json`
- `swarm logs --lines 200 --json`
