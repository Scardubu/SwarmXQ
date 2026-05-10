# SwarmX Startup Guide

## Quick Start (Recommended)

### Enhanced Startup with Health Checks

For the best experience with built-in health checks and diagnostics:

```bash
cd SwarmX-1.5
bash scripts/startup-enhanced.sh --dashboard
```

**What happens automatically:**
✅ Checks Python 3.11+ is installed  
✅ Checks Node.js 22+ is installed  
✅ Verifies pnpm is available  
✅ Checks port 3000 and 3001 availability (kills stale processes if needed)  
✅ Verifies Ollama is running (non-blocking; continues without it)  
✅ Auto-seeds CORS origins for localhost (`http://localhost:3000`)  
✅ Starts API server on `http://127.0.0.1:3001`  
✅ Starts dashboard on `http://127.0.0.1:3000`  

### Classic Startup

If you prefer the traditional method:

```bash
cd SwarmX-1.5
source .venv/bin/activate
python -m cli up --dashboard --host 127.0.0.1 --port 3001
```

Then open: **http://localhost:3000**

## Advanced Usage

### Health Checks Only (No Startup)

Verify your environment is ready without starting services:

```bash
bash scripts/startup-enhanced.sh --check-only
```

### Verbose Output

See detailed logs for debugging:

```bash
bash scripts/startup-enhanced.sh --dashboard --verbose
```

### Custom Port

Use a different API port (if 3001 is already in use):

```bash
python -m cli up --dashboard --host 127.0.0.1 --port 3002
```

## Environment Variables

### Required (usually auto-set)

| Variable | Default | Purpose |
|----------|---------|---------|
| `SWARMX_DASHBOARD_ORIGIN` | `http://localhost:3000,http://127.0.0.1:3000` | CORS allowlist for API |
| `SWARMX_API_HOST` | `127.0.0.1` | API server bind address |
| `SWARMX_API_PORT` | `3001` | API server port |
| `SWARM_HOME` | `~/.swarmx` | Runtime state directory |

### Optional

| Variable | Default | Purpose |
|----------|---------|---------|
| `NODE_ENV` | `development` | Node environment (dev/production) |
| `TZ` | `Africa/Lagos` | Timezone for dashboard (WAT) |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama LLM backend URL |
| `SWARMX_COMPOSER_TIMEOUT_MS` | `45000` (API default) | Composer model timeout in milliseconds. Increase on slow/cold hosts, decrease for faster fallback behavior. |
| `SWARMX_V5_POLL_TIMEOUT_MS` | `25000` | Timeout for `python -m swarmx metrics` subprocess used by API poller. Increase on slow hosts to avoid SIGTERM skips. |
| `SWARMX_REPO_ROOT` | Auto-detected | Absolute path to SwarmX repository; auto-set by `swarm up`. Required for metrics subprocess PYTHONPATH composition. |
| `SWARMX_PYTHON` | `sys.executable` | Python interpreter for metrics poller and CLI sidecars; auto-detected from active venv by `swarm up`. |
| `VERBOSE` | (not set) | Enable verbose logging in startup script |

### Setting Environment Variables

```bash
# For this session only
export SWARMX_DASHBOARD_ORIGIN=http://localhost:3000
bash scripts/startup-enhanced.sh --dashboard

# Or set inline
VERBOSE=1 bash scripts/startup-enhanced.sh --check-only
```

## Troubleshooting

### "Port 3000 already in use"

The enhanced startup will attempt to free the port automatically. If that fails:

```bash
# Find the process
lsof -i :3000

# Kill it
kill -9 <PID>

# Or use a different port
python -m cli up --dashboard --host 127.0.0.1 --port 3002
```

### "Ollama is not responding"

This is non-blocking — the API will start anyway. To fix:

```bash
# In a new terminal
ollama serve

# Or check the connection
curl http://localhost:11434/api/version
```

### Composer fallback despite models being installed

If Composer falls back even when models are installed:

```bash
# Verify installed model tags
ollama list

# Recommended explicit setting (tag included)
export SWARMX_COMPOSER_MODEL=phi4-fast:latest
```

Notes:
- API auto-normalizes model names by appending `:latest` when omitted.
- First inference after startup can be slower due to model load.
- Presence checks like `are you there?` and `ping` are handled locally from fleet state and do not require model inference.
- Idle-assignment questions (`how many are idle and why no tasks?`) are handled locally and include assignment guidance.
- Verify effective timeout in your shell before startup:
   `echo ${SWARMX_COMPOSER_TIMEOUT_MS:-45000}`

### Repeated "V5 metrics poll skipped" logs

If you see frequent metrics poll skips with subprocess `SIGTERM`, increase the poll timeout:

```bash
export SWARMX_V5_POLL_TIMEOUT_MS=30000
bash scripts/startup-enhanced.sh --dashboard
```

### Agent list initially empty

The API seeds the in-memory agent registry from `agents/catalog.yaml` on startup.
If the catalog is missing, it falls back to a static internal snapshot so the dashboard still renders agents as `idle`.

### "Cross-Origin Request Blocked" in Browser

See [CORS_CONFIGURATION.md](../docs/CORS_CONFIGURATION.md#troubleshooting) for detailed solutions.

Common fixes:
```bash
# 1. Restart with auto-seeding
bash scripts/startup-enhanced.sh --dashboard

# 2. Verify CORS env var is set
echo $SWARMX_DASHBOARD_ORIGIN

# 3. Clear browser cache (Cmd+Shift+Delete on macOS, Ctrl+Shift+Delete on Linux)
```

### "Cannot find Python / Node.js"

```bash
# Check Python
python3 --version

# If missing: Install Python 3.11+
# macOS
brew install python@3.11
# Ubuntu/Debian
sudo apt-get install python3.11 python3.11-venv

# Check Node.js
node --version
# If missing: Download from nodejs.org or use nvm
```

### "Dashboard shows 'Cannot reach API'"

```bash
# Check if API is running
curl http://127.0.0.1:3001/health

# Check API logs
tail -50 ~/.swarmx/logs/swarmx-*.log

# Restart
bash scripts/startup-enhanced.sh --dashboard
```

### Slow Dashboard Load on First Run

First build takes 2-3 minutes. This is normal:
- TypeScript compilation
- Next.js Turbopack build
- Route prerendering

Subsequent startups are faster (~30s).

## Log Files

Logs are stored in `~/.swarmx/logs/`:

```bash
# API server logs
# Foreground mode (`swarm up --dashboard`): API logs stream in the terminal
# where you started the stack.
# Detached mode (`swarm up --detach`):
tail -f ~/.swarmx/logs/swarmx-api.log

# Dashboard logs
tail -f ~/.swarmx/logs/swarmx-dashboard.log

# Enhanced startup logs
tail -f ~/.swarmx/logs/startup-enhanced.log

# All logs
tail -f ~/.swarmx/logs/*.log
```

## Performance Tuning

### Memory Pressure

If you see "MEM HIGH" or "MEM CRITICAL" in the dashboard:

1. **Reduce model concurrency:**
   ```bash
   export SWARMX_MAX_CONCURRENT_TASKS=2
   ```

2. **Reduce token output ceilings:**
   Edit `configs/guardrails.yaml` → `governance.token_ceilings`

3. **Enable ZRAM (Linux):**
   ```bash
   bash setup/zram_setup.sh
   ```

### CPU Optimization

To improve performance on 4-core systems:

```bash
export SWARMX_CONCURRENCY_POOL_SIZE=2
bash scripts/startup-enhanced.sh --dashboard
```

## Stopping Services

```bash
# Graceful shutdown (Ctrl+C in terminal where started)
# Waits for in-flight tasks to complete

# Or force-stop all services
pkill -f "python -m cli up"
pkill -f "next start|@swarmx/dashboard"
```

## Production Deployment

For production, set strict CORS:

```bash
export NODE_ENV=production
export SWARMX_DASHBOARD_ORIGIN=https://swarmx.your-domain.com
bash scripts/startup-enhanced.sh --dashboard
```

**Important:** 
- Never use `NODE_ENV=development` in production
- Always set explicit CORS origins, no fallback
- Use `.env` files or secrets manager, never commit credentials

## Monitoring

### Dashboard Telemetry

The dashboard displays real-time metrics:
- **System Health:** CPU, memory, pressure tier (normal/high/critical)
- **Agent Activity:** Running agents, completed tasks, error count
- **Model Status:** Response times, token usage, Ollama status
- **Recent Events:** Last 100 lifecycle events with timestamps

### Command Palette

Press `Ctrl+K` (or `Cmd+K` on macOS) to open the command palette:
- Navigate to pages
- View running agents
- Run quick diagnostics
- Access system commands

### Health API

```bash
# Check API health
curl http://127.0.0.1:3001/health

# Get system metrics
curl http://127.0.0.1:3001/api/system/metrics

# Stream events
curl -N http://127.0.0.1:3001/api/events
```

## Development Setup

For local development with hot-reload:

```bash
# Terminal 1: Start API (auto-reloads on Python changes)
source .venv/bin/activate
python -m cli up --dashboard --host 127.0.0.1 --port 3001

# Terminal 2: Start Dashboard dev server (auto-reloads on TypeScript/CSS changes)
cd apps/swarmx-dashboard
pnpm dev
```

Navigate to `http://localhost:3000` (dev server) for auto-reload.

## Next Steps

1. ✅ **Startup successful?** Open http://localhost:3000
2. 📚 **Learn the Dashboard:** Explore the Composer, Workflows, and Logs pages
3. 🤖 **Run a Task:** Use the Composer to test a simple task
4. 📖 **Read Documentation:**
   - [CORS Configuration](../docs/CORS_CONFIGURATION.md) — network setup
   - [README.md](../README.md) — project overview
   - [ARCHITECTURE.md](../ARCHITECTURE.md) — system design

## Getting Help

- **Documentation:** See `docs/` directory
- **Logs:** Check `~/.swarmx/logs/` for detailed error messages
- **Issues:** Open an issue on GitHub with logs and environment details
- **Community:** See README.md for community resources

## Further Reading

- [CORS Configuration Guide](../docs/CORS_CONFIGURATION.md)
- [SwarmX Architecture](../ARCHITECTURE.md)
- [Safety & Execution Policy](../SAFETY.md)
- [System Prompt](../SYSTEM-PROMPT.md)
