# DONE.md — Definition of Done (sales-agent-publisher)

Nothing ships unless every check below is green. Local gate is automated;
remote gate is three commands on the droplet, copy-paste ready.

## 1. Local gate (automated)

```bash
./verify.sh
```

Must print `RESULT: PASS` and exit 0. What it runs (mirrors
`.github/workflows/ci.yml`):

| Check | Command | Blocking |
|---|---|---|
| Prisma client | `npx prisma generate` | yes |
| Schema valid | `npx prisma validate` (stub DATABASE_URL) | yes |
| Typecheck | `npx tsc --noEmit` | yes |
| Unit tests | `npm test` (vitest) | yes |
| Lint | `npm run lint` | no (CI uses continue-on-error) |
| Prod build | `npx next build` (dummy env) | yes |

CI additionally docker-builds the image on every PR/push — not replicated
locally.

## 2. REMOTE gate — droplet checks (MANUAL, after every deploy)

### 2a. Origin health probe — NOT the public URL

```bash
ssh salestracker 'curl -s -o /tmp/h.json -w "%{http_code}\n" http://127.0.0.1:3000/api/health && cat /tmp/h.json'
```

Expected: `200` and a JSON body like
`{"status":"ok","timestamp":...,"dbConnected":true,"whatsapp":...}`.

**Why origin, not the public URL:** the app sits behind a cloudflared tunnel.
An empty-body 503 from the public URL is Cloudflare edge noise (connector
re-registration, ~2x/day) — it does NOT mean the app is down. Empty body =
edge couldn't reach the tunnel; JSON body = origin responded. Only the
loopback probe (`127.0.0.1:3000`, exposed via the compose `ports` mapping)
tells the truth about the app. Do not restart a working tunnel on edge noise —
that creates a 5–15 min self-inflicted outage window.

### 2b. TZ=Asia/Kolkata present in the container

```bash
ssh salestracker 'cd /root/sales-agent-publisher && docker compose exec app printenv TZ'
```

Expected output: exactly `Asia/Kolkata`.

This is **load-bearing**: the 8pm IST send cron computes its window from the
process timezone. If TZ is missing (stripped in a Dockerfile change or compose
edit), the send window silently shifts to UTC (1:30am IST) with no error
anywhere. The setting lives in `docker-compose.yml` under
`services.app.environment`.

### 2c. Deploy was scoped to the app service

Deploys go through `.github/workflows/deploy.yml`, which diffs
`docker-compose.yml` / `cloudflared.yml` and picks the scope automatically:

- app-only change → `docker compose up -d --build app` (tunnel/db untouched)
- infra change → full `docker compose up -d --build` (expect 5–15 min of
  Cloudflare edge 503 noise after — that is propagation, not failure)

If deploying by hand on the droplet, **always**:

```bash
cd /root/sales-agent-publisher && docker compose up -d --build app
```

Never bare `docker compose up -d --build` unless docker-compose.yml or
cloudflared.yml actually changed — the unscoped form rebuilds the tunnel and
triggers the false-positive 503 window (14 incidents in 7 days before this
was fixed in PR #49).

Verify scope after a CI deploy:

```bash
ssh salestracker 'cat /tmp/deploy-scope'
# Expected for a code-only deploy: tunnel_rebuilt=false / scope=app-only
```

## Known gaps

- ESLint is non-blocking (matches CI) — ratchet to blocking once the repo
  lints clean.
- No automated post-deploy check of the WhatsApp session state; if
  `/api/health` shows `whatsapp` not connected after a deploy, see
  CLAUDE.md / HANDOVER.md for the Baileys auth-wipe procedure.
