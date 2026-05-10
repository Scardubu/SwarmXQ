# SwarmX CORS Configuration Guide

## Overview

SwarmX V6.1 implements a production-grade Cross-Origin Resource Sharing (CORS) policy that protects the API from unauthorized browser-based requests while maintaining flexibility for local development and distributed deployments.

**Key Features:**
- **Environment-driven configuration** — no hardcoded origins
- **Safe development defaults** — automatic fallback for localhost in dev mode
- **Production hardening** — explicit origin whitelist required in production
- **Graceful degradation** — dashboard falls back to direct API URL on failures

## Quick Start

### For Local Development

```bash
cd SwarmX-1.5
source .venv/bin/activate
python -m cli up --dashboard --host 127.0.0.1 --port 3001
```

**What happens automatically:**
1. The `swarm up` command auto-seeds `SWARMX_DASHBOARD_ORIGIN` with `http://127.0.0.1:3000,http://localhost:3000`
2. API server detects `NODE_ENV != 'production'` and adds fallback origins (all localhost variants)
3. Browser requests from dashboard to API succeed without preflight errors
4. **No manual environment configuration needed** ✅

### For Production Deployment

Set the `SWARMX_DASHBOARD_ORIGIN` environment variable explicitly:

```bash
export SWARMX_DASHBOARD_ORIGIN=https://swarmx.your-domain.com
export NODE_ENV=production
node apps/swarmx-api/dist/server.js
```

Or in Docker:

```dockerfile
ENV SWARMX_DASHBOARD_ORIGIN=https://swarmx.your-domain.com
ENV NODE_ENV=production
```

## Configuration

### Environment Variables

#### `SWARMX_DASHBOARD_ORIGIN` (Required in Production)

**Format:** Comma-separated list of allowed browser origins

```bash
# Single origin
SWARMX_DASHBOARD_ORIGIN=https://swarmx.example.com

# Multiple origins (for multi-region deployments)
SWARMX_DASHBOARD_ORIGIN=https://swarmx.example.com,https://swarmx-us.example.com

# Local development (auto-set by swarm up)
SWARMX_DASHBOARD_ORIGIN=http://localhost:3000,http://127.0.0.1:3000
```

**Validation:**
- Trailing slashes are automatically removed
- Whitespace around commas is trimmed
- Empty entries are filtered out
- Case-sensitive matching (https ≠ HTTP)

#### `NODE_ENV`

Controls CORS policy strictness:

| Value | Behavior | Use Case |
|-------|----------|----------|
| `production` | **Strict** — requires explicit `SWARMX_DASHBOARD_ORIGIN`; no localhost fallback | Production deployments |
| `development` (default) | **Permissive** — auto-includes localhost origins even if `SWARMX_DASHBOARD_ORIGIN` not set | Local dev, testing |

**Example:**
```bash
# Development: automatic localhost fallback
NODE_ENV=development python -m cli up

# Production: explicit whitelist required
NODE_ENV=production python -m cli up
```

### Configuration Hierarchy

The API server applies CORS origins in this order:

1. **Parse `SWARMX_DASHBOARD_ORIGIN`** — split by comma, trim whitespace, remove trailing slashes
2. **Add env-specified origins** to the allowlist
3. **If `NODE_ENV !== 'production'`** — append dev fallback origins:
   - `http://localhost:3000`
   - `http://127.0.0.1:3000`
   - `http://localhost:3001`
   - `http://127.0.0.1:3001`
4. **Register with Fastify CORS** — enables preflight validation on all routes

**Code:** [apps/swarmx-api/src/server.ts](../apps/swarmx-api/src/server.ts#L35-L50)

```typescript
function buildAllowedOrigins(): (string | RegExp)[] {
  const origins: (string | RegExp)[] = [];
  const dashboardOrigin = process.env["SWARMX_DASHBOARD_ORIGIN"]?.trim().replace(/\/$/, "");
  if (dashboardOrigin) {
    origins.push(...dashboardOrigin.split(",").map(o => o.trim()).filter(Boolean));
  }
  if (!IS_PRODUCTION) {
    origins.push("http://localhost:3000", "http://127.0.0.1:3000",
                 "http://localhost:3001", "http://127.0.0.1:3001");
  }
  return origins;
}
```

## How It Works

### Browser Request Flow

```
Dashboard (http://localhost:3000)
  ↓
[CORS Preflight Check]
  ↓
OPTIONS /api/composer/chat  ← Browser asks: "Can I make this request?"
  ↓
API CORS Middleware (Fastify)
  ├─ Check request Origin header
  ├─ Match against allowlist
  ├─ Send Access-Control-Allow-Origin response
  ↓
[Preflight Approved or Blocked]
  ↓
POST /api/composer/chat  ← Actual request (if preflight passed)
  ↓
Response  → Dashboard
```

### CORS Response Headers

On successful CORS validation, the API returns:

```http
Access-Control-Allow-Origin: http://localhost:3000
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Max-Age: 86400
```

### Fallback Routing

If the API is unreachable (5xx error), the dashboard falls back to direct API URL:

1. **Primary:** Dashboard attempts `/api/composer/chat` (proxy via Next.js rewrite)
2. **Fallback:** On 5xx, tries `http://127.0.0.1:3001/api/composer/chat` (direct API)
3. **CORS Requirement:** Direct API requests also validate CORS origins

**Why this matters:** The fallback URL is now auto-seeded in `SWARMX_DASHBOARD_ORIGIN` by `swarm up`, so direct requests pass CORS validation.

## Troubleshooting

### "Cross-Origin Request Blocked" Error in Browser Console

**Symptoms:**
```
Cross-Origin Request Blocked: The Same Origin Policy disallows 
reading the remote resource at http://127.0.0.1:3001/api/composer/chat. 
(Reason: CORS header 'Access-Control-Allow-Origin' missing)
```

**Root Cause:** Browser origin is not in the CORS allowlist.

**Solution:**
```bash
# 1. Verify running origin
#    Check dashboard URL in browser address bar (e.g., http://localhost:3000 or http://127.0.0.1:3000)

# 2. Add to SWARMX_DASHBOARD_ORIGIN if using different host/port
export SWARMX_DASHBOARD_ORIGIN=http://your-host:3000

# 3. Restart API server
python -m cli up --dashboard

# 4. Clear browser cache (Cmd+Shift+Delete on macOS, Ctrl+Shift+Delete on Linux)
```

### API Server Not Starting / Port Already in Use

```bash
# Find process on port 3001
lsof -i :3001

# Kill it gracefully
kill -15 <PID>

# If still stuck, force kill
kill -9 <PID>

# Try again
python -m cli up --dashboard --port 3002  # Use different port if 3001 is needed elsewhere
```

Startup hygiene note:
- `scripts/startup-enhanced.sh --dashboard` now performs a stale-instance eviction pass before port checks.
- It targets old SwarmX API/dashboard sessions from the current repository and legacy `SwarmX-1.5` path hint to make restarts deterministic.

### Dashboard Shows "504: Gateway Timeout"

**Root Cause:** API unreachable or taking >90 seconds to respond.

**Solutions:**
```bash
# 1. Verify API is running
curl -i http://127.0.0.1:3001/health

# 2. Check if Ollama is responding
curl -i http://localhost:11434/api/version

# 3. Increase timeout (if needed)
export SWARMX_COMPOSER_TIMEOUT_MS=45000  # 45 seconds (default)
python -m cli up --dashboard

# 4. Check logs
tail -100f ~/.swarmx/logs/swarmx-*.log
```

Composer diagnostics note:
- Fallback responses now include `Model discovery source` to indicate whether model availability came from direct Ollama HTTP (`http`), CLI fallback (`subprocess`), or static env defaults (`static`).

### CORS Works Locally But Not in Production

**Common Issues:**

| Scenario | Fix |
|----------|-----|
| Using IP address in production | Add IP to `SWARMX_DASHBOARD_ORIGIN` (e.g., `https://203.0.113.42`) |
| HTTPS in production, HTTP fallback in code | Update dashboard rewrites to use `https://` URLs |
| Multi-region deployment | Add all origins: `https://us.example.com,https://eu.example.com` |
| Load balancer adds X-Forwarded-Host | Ensure dashboard rewrites use the external host, not internal IP |

## Best Practices

### ✅ Development

```bash
# Best: Auto-setup via swarm up
python -m cli up --dashboard

# Also works: Explicit local origins
export SWARMX_DASHBOARD_ORIGIN=http://localhost:3000
python -m cli up
```

### ✅ Staging

```bash
# Always set NODE_ENV=staging (not 'production' yet)
export NODE_ENV=staging
export SWARMX_DASHBOARD_ORIGIN=https://staging.swarmx.example.com
docker-compose up
```

### ✅ Production

```bash
# Strict: Explicit production origin, no localhost fallback
export NODE_ENV=production
export SWARMX_DASHBOARD_ORIGIN=https://swarmx.example.com
docker-compose -f docker-compose.prod.yml up
```

### ⚠️ Anti-Patterns

❌ **Don't:** Hardcode origins in code
```typescript
// Wrong — bypasses env config
const origins = ["http://localhost:3000"];
```

❌ **Don't:** Accept all origins with `*`
```bash
# Wrong — security vulnerability
export SWARMX_DASHBOARD_ORIGIN="*"
```

❌ **Don't:** Mix production + development mode
```bash
# Wrong — falls back to localhost in production
export NODE_ENV=production  # But forgets to set SWARMX_DASHBOARD_ORIGIN
```

## Security Considerations

### CORS Is Not Authentication

CORS protects against **naive** cross-site request forgery but does **NOT** replace authentication:

- ✅ Prevents `evil.com` from calling `/api/composer/chat` via browser JavaScript
- ❌ Does **NOT** prevent:
  - Server-to-server requests (no browser = no CORS)
  - Authenticated API calls with valid tokens
  - Logged-in users on `evil.com` tricking them into clicking a link

**Mitigation:** Always validate API tokens/sessions independently of CORS.

### Environment Variable Exposure

Never commit `.env.local` or environment variables to version control:

```bash
# Correct: Use .env.local (listed in .gitignore)
echo "SWARMX_DASHBOARD_ORIGIN=https://secret.example.com" > .env.local

# Correct: Use secrets manager in production
AWS Secrets Manager / Azure Key Vault / HashiCorp Vault
```

### Header Injection

The CORS parser sanitizes values:

```bash
# This is safe (trailing slash removed)
export SWARMX_DASHBOARD_ORIGIN=https://example.com/

# This works (whitespace trimmed)
export SWARMX_DASHBOARD_ORIGIN="https://example.com, https://other.com"

# Avoid: Header injection attempts
export SWARMX_DASHBOARD_ORIGIN='https://example.com\r\nX-Injected-Header: bad'
# → Input validated; header injection blocked
```

## Further Reading

- [MDN: Cross-Origin Resource Sharing (CORS)](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
- [Fastify @fastify/cors Plugin](https://github.com/fastify/fastify-cors)
- [OWASP: Cross-Origin Resource Sharing](https://owasp.org/www-community/attacks/csrf)

## Support

For issues or questions:

1. Check [Troubleshooting](#troubleshooting) section above
2. Review [Configuration](#configuration) to ensure env vars are set
3. Open an issue on [GitHub](https://github.com/your-org/swarmx) with:
   - `SWARMX_DASHBOARD_ORIGIN` value (redact if sensitive)
   - `NODE_ENV` setting
   - Browser console error output
   - API server logs (last 50 lines)
