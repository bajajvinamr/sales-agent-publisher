# CONTINUE.md

## 2026-04-23 — field hotfix sprint + enterprise CI + local act + retro

### Shipped
- PR #2 — field-team feedback fixes (Apr 23): blank Excel names, team card crash, duplicate visits, JID-as-exec bug, double messages on ingest, APP_PASSWORD HTTP Basic auth
- PR #3 / #4 — `prisma db push --accept-data-loss` on container boot (unblocked prod deploy)
- PR #5 — 6-workflow enterprise CI pipeline (ci, deploy, health-watch, security, claude-review, sync-sheet) + dependabot + HEALTH.md
- Local branch `chore/local-act-ci` (not yet pushed, 4 commits ahead of main):
  - Local GH Actions via `act` + `.githooks/pre-push` (workaround for account-level Actions block)
  - `ci.yml` prisma validate DATABASE_URL stub env (caught by first local run)
  - Project `CLAUDE.md` (behavioral rules for sessions)
  - vitest + 3 seed tests (baileys JID filter, orchestrator dedup hash, excel DB→xlsx mapping)
  - gitleaks in security.yml + ESLint v9 flat config
- Retro: `docs/retros/2026-04-23-retro.md`

### Pending (exact state)
- **Push `chore/local-act-ci` and open PR** — `git push -u origin chore/local-act-ci && gh pr create --fill`. Pre-push hook will run act first (~2 min with cache).
- **File GitHub support ticket** — account-level Actions `startup_failure` on every workflow. All user repos affected, not scoped to this one. Include a failed run URL + system.txt excerpt.
- **Rotate `APP_PASSWORD`** — leaked in an earlier session transcript. On droplet: `ssh salestracker 'cd sales-agent-publisher && sed -i "s/^APP_PASSWORD=.*/APP_PASSWORD=<new>/" .env && docker compose restart app'`. Update GH secret too.
- **Sync `CRON_SECRET`** — droplet `.env` and GitHub repo secret drifted after rotation. Check both match.
- **Reconnect WhatsApp** — app container restart during deploys dropped the live Baileys socket; re-pair via `/connect` on the dashboard.
- **Dependabot queue** — 7 open PRs (see triage note below).
- **15 npm advisories** (2 critical, 1 high, 12 moderate) surfaced during lockfile regen. Not caused by this session's additions. Run `npm audit` + triage via dependabot sweep; do not blind `npm audit fix --force` (breaking changes).

### Known issues
- ESLint step is `continue-on-error: true` — warnings won't surface until we clean the repo. Ratchet later.
- Cloudflare quick-tunnel `APP_URL` rotates on droplet reboot. Health-watch + deploy health check + sync-sheet all break until the `APP_URL` repo secret is rotated. Permanent fix: named Cloudflare Tunnel.
- First `act` run cold-installs ~440 npm packages inside the container (~18 min). Subsequent runs hit the local cache tarball and finish in ~2 min.

### Dependabot triage (do NOT blind-merge — act each one locally first)
Low risk — merge after local act green:
- #12 `minor-and-patch group` — patch bumps, safe cluster
- #10 `actions/setup-node 4 → 6` — typically backwards compatible

Medium risk — verify build works:
- #9 `github/codeql-action 3 → 4` — search for codeql refs first; if unused, merge
- #7 `docker/setup-buildx-action 3 → 4` — used in ci.yml + security.yml
- #8 `docker/build-push-action 6 → 7` — used in ci.yml
- #6 `actions/github-script 7 → 9` — used in security.yml issue-open step

Defer:
- #11 `node 20-slim → 25-slim` — major Node jump. Next 15 + Prisma 6 compatibility unclear. Hold until Node 22 LTS path is clear.

### Exact next step
`git push -u origin chore/local-act-ci` (pre-push hook runs act check only, ~2 min) → `gh pr create --fill` → merge when green. Then start ticket 001 (`docs/tickets/001-lint-ratchet.md`) in a fresh session.

### Forward plan
Plan locked as `docs/PLAN-FORWARD-2026-04-23.md`. Four milestones (M1 test+lint ratchet, M2 observability, M3 named tunnel + staging, M4 30-day zero-data-loss streak). 90-day outcome target: 2026-07-22. Next retro: 2026-05-07.
