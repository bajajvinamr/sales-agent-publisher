# CLAUDE.md — sales-agent-publisher

Behavioral rules for Claude Code sessions in this repo. This is not a human-facing doc — see `HEALTH.md` for ops and `README.md` for setup.

## Stack

- Next.js 15 (App Router only, no pages/), React 19, TypeScript 5
- Prisma 6 + Postgres 16 (Docker)
- WhatsApp via `@whiskeysockets/baileys` (NOT `whatsapp-web.js` — that dep is legacy, remove if touching)
- Anthropic `@ai-sdk/anthropic` for LLM extraction
- exceljs for reports, googleapis for Sheets sync
- Deployed as Docker Compose on a single DigitalOcean droplet; Cloudflare quick-tunnel fronts it

## Commands

- `npm run build` — Next production build
- `npm run typecheck` — `tsc --noEmit`
- `npm run db:generate` — Prisma client
- `act pull_request -W .github/workflows/ci.yml -j check -j build` — **local CI** (GitHub Actions account-level blocked; use this instead)
- `ssh salestracker '<cmd>'` — prod droplet (alias in `~/.ssh/config`)

## Non-obvious rules

- **Prisma schema migrations must use `--accept-data-loss`.** The `Visit.raw_text_hash` column is nullable with a `@@unique([executiveId, visitDate, rawTextHash])` constraint. Existing rows have NULL; Postgres treats NULLs as distinct so the constraint applies cleanly, but Prisma warns and blocks without the flag. See docker-compose `command:`.
- **WhatsApp JIDs are not humans.** Filter `@g.us` / `@broadcast` / `@newsletter` before treating `remoteJid` as an executive identity. See `src/lib/whatsapp-baileys.ts` rawSender guard.
- **Executive/school name rendering:** always `executive.displayName` and `school.canonicalName ?? schoolNameRaw`. Never fall through to `raw` — it's JID noise.
- **TZ=Asia/Kolkata is load-bearing.** `src/lib/cron.ts` checks `now.getHours() === 20` for the 8pm IST auto-process. Docker default UTC breaks this. Set in docker-compose.yml and never remove.
- **APP_URL rotates on tunnel restart.** Cloudflare quick-tunnel URLs change if the droplet reboots. Health-watch + deploy + sync-sheet all depend on the `APP_URL` repo secret being current.
- **Auth middleware allowlist:** `/api/health`, `/api/cron/*`, `/api/sheet-sync/*`, `/_next/*`, `/favicon.ico`, `/icon.svg`. Everything else requires HTTP Basic with `APP_PASSWORD`.
- **Dedup on ingest:** `orchestrator.ts` uses `visit.upsert` keyed on `uniq_exec_day_text`. Don't revert to `create` — field reps re-send the same message and it duplicates.
- **Cron secret must match between droplet `.env` and GitHub `CRON_SECRET` repo secret.** If you rotate one, rotate both.
- **Baileys auth dir is a bind mount — `wipeAuthDir` MUST use per-file `unlink`, not `rm -rf` or `rmdir`.** `./baileys_auth:/app/.baileys_auth` in docker-compose makes `/app/.baileys_auth` a bind mount target; any directory-level delete returns EBUSY because the kernel can't rmdir an active mount. Use `readdir` → per-file `unlink` with ENOENT-tolerance + logging. See `src/lib/whatsapp-baileys.ts` `wipeAuthDir()`. Reverting this to `rm -rf` re-introduces the multi-week QR-trap (PR #39/#40). Self-healing requires all three layers together: bind-mount-safe wipe + auto-retry-once on connect timeout + connect-timeout watchdog.
- **Self-healing connect logic resets `state.autoRetriedThisSession` on user-initiated connect.** When `connect()` is called from `disconnected` or `failed` status, the auto-retry budget refills. Without this reset, a single transient failure permanently consumes the retry budget for the process lifetime and the next user click silently goes nowhere.
- **Deploy health check probes `http://localhost:3000/api/health` via SSH, NOT the public URL.** `.github/workflows/deploy.yml` SSHes into the droplet and curls localhost — bypasses the cloudflared tunnel which holds stale TCP cache to the old app container for 5–15 min after `docker compose up -d --build`. This requires `ports: ["127.0.0.1:3000:3000"]` on the `app` service in docker-compose.yml. Reverting to a public-URL health check causes false-positive rollbacks on otherwise-successful deploys.
- **`depends_on: app` on the `tunnel` service does NOT cascade restarts.** Rebuilding `app` leaves the cloudflared container untouched and serving stale TCP. If you ever need a tunnel restart, run it as an explicit, deliberate `docker compose restart tunnel` step — and accept that Cloudflare edge POPs take 5–15 min to globally re-propagate. Never restart a working tunnel "out of habit"; that's a self-inflicted outage window.
- **Mobile browsers download `text/plain` 401 bodies as files** (e.g., `/connect` → `connect.txt` on iOS Safari and some Android browsers). The middleware `WWW-Authenticate: Basic` 401 response MUST use `Content-Type: text/html` with an HTML body. See `src/middleware.ts`. Reverting to text/plain breaks the mobile auth UX silently.
- **Cloudflared image is pinned (never `:latest`).** Current pin: `cloudflare/cloudflared:2026.2.0`. Bump deliberately by editing `docker-compose.yml`. `:latest` shipped a QUIC regression in `2026.3.0` that caused 48h of intermittent 503s on May 4–6 — see `docs/incidents/2026-05-tunnel-flap.md`.
- **Tunnel uses default QUIC, NOT `--protocol http2`.** `--protocol http2` was tried on 2026-05-06 (commit `a1b0ec2`) and caused Cloudflare edge to silently 503 ALL traffic to HTTP/2-mode connectors despite clean cloudflared registration logs. Reverted in `73990a2`. The version pin (2026.2.0 vs flapping 2026.3.0) is the primary fix; QUIC is the working protocol. Do NOT add `--protocol http2` to `docker-compose.yml` without a Cloudflare-side investigation first.
- **`deploy.yml` rebuilds only the `app` service unless infra config changed.** The deploy step diffs the pre-deploy HEAD against the new HEAD on the droplet for changes to `docker-compose.yml` or `cloudflared.yml`. App-only deploys run `docker compose up -d --build app`, leaving cloudflared and postgres untouched — this avoids a 5–15 min Cloudflare edge propagation window of false-positive 503s on every code deploy. Reverting to unconditional `docker compose up -d --build` re-introduces the recurring `prod-incident` issues that filed 14 false positives in 7 days.
- **Health Watch uses 3-strike hysteresis + SSH origin correlation, never 1-strike.** `.github/workflows/health-watch.yml` requires 3 consecutive edge probe failures over a ~90s window AND an origin probe (SSH → localhost:3000) before opening an incident. Origin healthy → `ingress-degraded` label (investigate). Origin failing → `app-down` label (page). Recovery requires 2 consecutive 200s. A 1-strike public probe in front of cloudflared QUIC reconnects is structurally guaranteed to false-positive ~2x/day; do not regress to single-sample. See `docs/runbooks/edge-vs-origin-health.md`.

## CI / deploy flow

1. PR → `ci.yml` runs typecheck + prisma validate + next build + docker build (all must pass)
2. Merge to main → `deploy.yml` SSH-pulls on droplet, `docker compose up -d --build`, health-checks `/api/health`, auto-rollback on fail
3. `health-watch.yml` every 15 min probes prod; opens `prod-incident` Issue on fail, auto-closes on recovery
4. Local gate: `.githooks/pre-push` runs `act` so failures are caught before they hit the wire

## Workflows (.github/workflows/)

| File | Purpose |
|---|---|
| `ci.yml` | PR + push to main |
| `deploy.yml` | After CI green on main |
| `health-watch.yml` | Every 15 min |
| `security.yml` | Weekly + on package.json change |
| `claude-review.yml` | On PR |
| `sync-sheet.yml` | Daily 21:00 IST |

## What NOT to do

- Don't add `whatsapp-web.js` imports. That dep is present for legacy reasons, do not extend.
- Don't publish Postgres port 5432 to host in docker-compose. Stays on internal network.
- Don't remove `--accept-data-loss` from docker-compose command without proving the schema change doesn't need it.
- Don't touch `TZ=Asia/Kolkata` in docker-compose.
- Don't rename `raw_text_hash` or change the `@@unique` constraint without a migration plan.
