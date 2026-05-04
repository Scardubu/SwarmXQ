# SwarmX Quick Start

Get from zero to a working operator console in a few minutes.

## Prerequisites

| Requirement | Minimum version |
|---|---|
| Python | 3.11 |
| Node.js | 22 LTS |
| pnpm | 9 |
| Redis | 7 (local or remote) |
| Ollama | latest (for local models) |

## 1 — Install

```bash
chmod +x scripts/install.sh
./scripts/install.sh
```

The installer:
- Creates a Python venv at `~/.swarmx/venv`
- Installs the `swarm` CLI to `~/.local/bin`
- Pulls the recommended model triad (see `scripts/install.sh`)
- Patches `~/.bashrc` / `~/.zshrc` so `swarm` is on `$PATH`

Reload your shell, then verify:

```bash
swarm --version
swarm doctor
```

## 2 — Start the operator services

```bash
swarm up --dashboard
```

This starts the SwarmX API and, when `--dashboard` is enabled, the Next.js operator dashboard.

Check health:

```bash
swarm status
```

## 3 — Open the dashboard

```bash
swarm status dashboard
```

The operator dashboard opens at `http://localhost:3000` and shows agent fleet, queue depth, metrics, and live logs.

## 4 — Run your first mission

```bash
swarm init ~/projects/my-app
swarm run ~/projects/my-app --target "stabilize the repo" --autonomous --max-iterations 3
```

Watch progress in real time:

```bash
swarm logs --follow
```

## 5 — Stop the stack

```bash
swarm up --down
```

---

Next steps:

- [INSTALL.md](INSTALL.md) — detailed setup, model selection, environment variables
- [OPERATIONS.md](OPERATIONS.md) — day-to-day operator commands
- [CONFIG_REFERENCE.md](CONFIG_REFERENCE.md) — full configuration reference
