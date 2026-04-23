# HANDOVER.md — sales-agent-publisher

If you are taking over this system, this is your starting point. Read top-to-bottom once. Then bookmark `HEALTH.md` (runbook) and `CLAUDE.md` (invariants for AI pair-programming).

## What this system does

Field sales reps visit schools and report each visit in a WhatsApp group. This system:
1. Listens to the group via a Baileys WhatsApp socket (not a phone app — a headless client tied to a QR pairing)
2. Extracts each message into structured data (school name, board, principal, strength, book seller, remark) using Anthropic Claude
3. Stores it in Postgres; exposes a dashboard; emails daily reports; syncs to Google Sheets
4. Runs on a single DigitalOcean droplet fronted by a Cloudflare quick-tunnel

Primary users: Prakhar, Nishkarsh (field reps, Bhopal). Manager sees the dashboard + Excel. The reps interact only through their existing WhatsApp group.

## What you own after handover

| Thing | Location | Credential holder before handover |
|---|---|---|
| GitHub repo | `github.com/bajajvinamr/sales-agent-publisher` | bajajvinamr |
| DO droplet | `168.144.95.212` (Bangalore, 1 vCPU, 1.9GB + 2GB swap) | bajajvinamr's DO account |
| SSH key for droplet | `~/.ssh/sales-agent-deploy` (passphrase-less) | local to handover laptop — **transfer the private key** |
| Anthropic API key | `.env` on droplet + `ANTHROPIC_API_KEY` in repo secrets | `console.anthropic.com` org billing |
| Cloudflare quick-tunnel | Anonymous, rotates on restart; current URL via `ssh salestracker 'get-url.sh'` | N/A — no account |
| Google Sheets service account | `GOOGLE_SERVICE_ACCOUNT_JSON` in droplet `.env` | Google Cloud project under bajajvinamr |
| Resend (email) API key | `RESEND_API_KEY` in droplet `.env` | `resend.com` account |
| WhatsApp session auth | `./baileys_auth/` on droplet (bind-mounted volume) | Tied to the phone number that scanned the initial QR |

**Transfer steps before you walk away:**
1. Copy the SSH private key to the new operator's machine; update `~/.ssh/config` with host alias `salestracker`
2. Add new operator as GitHub repo admin
3. Move Anthropic billing to new operator's organization (or they generate a new key and you rotate)
4. Hand over the Google Cloud project (IAM → add new operator as owner)
5. Hand over Resend account access
6. The WhatsApp pairing stays tied to the original phone — if the new operator wants to re-pair with their own number, delete `./baileys_auth/` on droplet, restart app container, scan new QR

## Credential rotation — do this before handover

These secrets may have been exposed during development. Rotate all of them before transferring ownership:

| Secret | Current risk | How to rotate |
|---|---|---|
| `APP_PASSWORD` (HTTP Basic) | **Leaked in a session transcript** | `ssh salestracker 'cd sales-agent-publisher && sed -i "s/^APP_PASSWORD=.*/APP_PASSWORD=<new>/" .env && docker compose restart app'`. Update `APP_PASSWORD` GitHub repo secret too. |
| `CRON_SECRET` | Unclear whether droplet `.env` and GH repo secret are in sync | Generate a new value; set in both places. `sync-sheet.yml` depends on match. |
| `ANTHROPIC_API_KEY` | Unknown exposure | Generate new key at `console.anthropic.com`; set on droplet `.env` + GH repo secret; revoke old. |
| `DEPLOY_SSH_KEY` | Paired to current laptop | Generate new key pair; add public to droplet `~/.ssh/authorized_keys`; update `DEPLOY_SSH_KEY` GH repo secret with private; remove old public from droplet. |
| `RESEND_API_KEY` | Only used for daily report emails | Rotate at `resend.com`; update droplet `.env`. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Only used for Sheets sync | If handing over ownership, generate a new service account under the new operator's Google Cloud project and swap. |

## Daily operation — what a non-engineer needs to know

- **Current public URL:** `ssh salestracker '/root/sales-agent-publisher/get-url.sh'` — prints the Cloudflare quick-tunnel URL. It **changes on droplet reboot**. When it changes, update the `APP_URL` repo secret (used by `health-watch.yml`, `deploy.yml` post-deploy check, `sync-sheet.yml`).
- **Did a visit not show up?** SSH in, `docker compose logs app --tail 100 | grep -i <rep name>`. If you see a parse error, the extractor failed on their message — ping them to send it again, cleaner.
- **WhatsApp disconnected:** visit the dashboard, go to `/connect`, scan QR with the **original paired phone** (ideally stays same forever).
- **Email report didn't send:** check `RESEND_API_KEY`, check Resend dashboard for delivery status, check cron ran (`docker compose logs app --tail 200 | grep cron`).
- **Droplet got rebooted:** tunnel URL rotated. Fetch new URL via `get-url.sh`, update `APP_URL` repo secret, re-run the `deploy.yml` workflow so health check points at the right place.

## Failure playbook — top 5

### 1. Site returns 401 Unauthorized unexpectedly
Middleware uses HTTP Basic with `APP_PASSWORD`. If suddenly broken, check the env var is set on the droplet: `ssh salestracker 'grep APP_PASSWORD sales-agent-publisher/.env'`. If missing, put it back.

### 2. Site returns 502 / can't reach it at all
Cloudflare quick-tunnel died. `ssh salestracker 'cd sales-agent-publisher && docker compose restart tunnel'`. Then fetch new URL, update `APP_URL` repo secret.

### 3. WhatsApp messages stopped ingesting
Baileys socket disconnected. UI → `/connect` → QR-rescan. Worst case wipe the auth: `ssh salestracker 'rm -rf sales-agent-publisher/baileys_auth/* && docker compose restart app'`, re-pair.

### 4. Deploy fails, prod is down
`deploy.yml` auto-rolls back if the health check fails. If it didn't: `ssh salestracker 'cd sales-agent-publisher && docker compose down && docker compose up -d --build'`. If even that fails, check `docker compose logs app --tail 200` for the actual error.

### 5. Excel reports have blank names or duplicate rows
This was the whole Apr-23 bug class. If it comes back after a refactor, see `docs/tickets/002-ingest-fixture-suite.md` for the fixture patterns. The relevant code is `src/lib/pipeline/orchestrator.ts` (dedup upsert on `uniq_exec_day_text`) and `src/lib/pipeline/excel-export.ts:180-188` (name fallback chain).

## In-flight as of handover

Branch `chore/local-act-ci` (~10 commits, not yet merged):
- Local CI runner via `act` + `.githooks/pre-push` hook (workaround for a GitHub Actions account-level block at the previous owner's account — may auto-resolve once you own the repo)
- Prisma `validate` DATABASE_URL stub env
- `CLAUDE.md` (AI pair-programming invariants)
- `vitest` + 3 seed tests (JID filter, dedup hash, Excel DB→xlsx mapping)
- `gitleaks` secret scan in `security.yml`
- ESLint v9 flat config
- `CONTINUE.md` session handoff + `docs/PLAN-FORWARD-2026-04-23.md` (90-day plan with 4 milestones — treat as advisory, not committed)

Review the PR, merge if happy. If the GH Actions block is gone after ownership transfer, the `act` setup becomes optional — the hooks still save time but you could disable them by removing `core.hooksPath`.

## Known limits (read before setting expectations)

- **Single droplet, no staging, no blue/green.** ~15s of 502s during `docker compose up -d --build`.
- **Cloudflare quick-tunnel URL rotates on reboot.** Permanent fix: named Cloudflare Tunnel (needs a domain). See `docs/PLAN-FORWARD-2026-04-23.md` M3.
- **3 seed tests, no integration tests.** The codebase is small enough that this is workable, but the test gap will hurt you on the first meaningful refactor. Ticket `002` seeds the pattern for expanding coverage.
- **No observability.** You learn about prod bugs from the field reps on WhatsApp, days later. Ticket `003` proposes structured logging as the substrate.
- **15 npm advisories** (2 critical, 1 high, 12 moderate) — triage via `npm audit`. Not blocking, but don't let it grow.

## Not handed over

- No domain name is owned by this system — operator must provide one if they want a named Cloudflare Tunnel.
- No customer contract / TOS / privacy policy. The system processes field-rep WhatsApp messages containing school principal names + phone numbers. If the incoming operator is in a jurisdiction with data-protection law (India DPDP, GDPR, etc.), they must review.
- No SLA. The system is best-effort. The previous owner can provide ~1 week of post-handover support on a best-effort basis.

## Contacts

- **Previous owner:** Vinamr Bajaj · bajajvinamr@gmail.com
- **Field reps (end users):** Prakhar, Nishkarsh (WhatsApp contact via the group)
- **Vendor support:**
  - DigitalOcean — cloud.digitalocean.com/support
  - Anthropic — support@anthropic.com
  - Cloudflare — tunnel docs at developers.cloudflare.com/cloudflare-one
