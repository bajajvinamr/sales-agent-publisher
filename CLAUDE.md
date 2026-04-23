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
