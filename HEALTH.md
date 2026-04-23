# Operations Runbook

What runs where, how to check it's alive, how to bring it back when it isn't.

## The pipeline

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Open PR    │───▶│      CI      │───▶│    Merge     │───▶│    Deploy    │
│              │    │ typecheck    │    │  (squash)    │    │  SSH pull +  │
│  claude-     │    │ build        │    │              │    │  up -d       │
│  review      │    │ docker-build │    │              │    │  + /health   │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
                                                                     │
                                                                     ▼
                                                            ┌──────────────┐
                                                            │ health-watch │
                                                            │ every 15 min │
                                                            │ opens Issue  │
                                                            │ on failure   │
                                                            └──────────────┘
```

## Workflows

| File | Trigger | What it does |
|---|---|---|
| `ci.yml` | PR + push to main | Typecheck, Prisma validate, Next build, Docker build |
| `deploy.yml` | After CI green on main (and manual dispatch) | SSH to droplet, pull, rebuild, health-check, rollback on fail |
| `health-watch.yml` | Every 15 min + manual | Probes `/api/health`, opens Issue `prod-incident` on fail, auto-closes on recovery |
| `security.yml` | Mondays 04:00 UTC + package.json changes | `npm audit`, Trivy CVE scan of image, uploads SARIF to Code Scanning |
| `claude-review.yml` | On every PR | Sonnet reviews diff, posts review comment |
| `sync-sheet.yml` | Daily 21:00 IST + manual | Hits `/api/cron/sync-sheet` on the droplet, syncs pending visits to Google Sheets |

## Required repo secrets

| Secret | Used by | Where to get it |
|---|---|---|
| `DEPLOY_SSH_KEY` | `deploy.yml` | `~/.ssh/sales-agent-deploy` (private key, no passphrase) |
| `DEPLOY_HOST` | `deploy.yml` | `168.144.95.212` (droplet IP) |
| `DEPLOY_USER` | `deploy.yml` | `root` |
| `APP_URL` | `deploy.yml`, `health-watch.yml`, `sync-sheet.yml` | Current Cloudflare tunnel URL. **Rotates on tunnel restart** |
| `CRON_SECRET` | `sync-sheet.yml` | Matches droplet `.env` `CRON_SECRET` |
| `ANTHROPIC_API_KEY` | `claude-review.yml` | `console.anthropic.com` → API keys |

## Required branch protection

Enable via:
```bash
gh api --method PUT repos/bajajvinamr/sales-agent-publisher/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["typecheck + lint", "build", "docker build"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": true
  },
  "restrictions": null
}
JSON
```

This forces every main change to go through a PR whose CI passes. No direct push to main, no CI bypass.

## Day-to-day

### Opening a PR
1. Branch off main: `git checkout -b feat/<short-name>`
2. Push: `git push -u origin feat/<short-name>`
3. `gh pr create --fill` — CI + Claude review kick off automatically
4. Watch the checks. If CI is green and Claude is `✅ Clean`, merge.

### When CI fails
1. Click the red X in the PR → opens the run page
2. Click the failing job → scroll to the failing step
3. Copy the error, fix locally, push again. Re-runs automatically.

### When deploy fails
1. A `deploy-failure` Issue auto-opens with run link + rollback note
2. Rollback already happened — prior version is live
3. Fix forward with another PR. Don't SSH-patch prod.

### When prod goes down
1. `prod-incident` Issue auto-opens (or you get the email first)
2. Check the linked run logs — health-check body is included
3. Fast move: `gh workflow run deploy.yml` — redeploys current `main`
4. If that fails too: SSH in, `docker compose logs app --tail 100`, fix root cause

### Redeploying manually
Go to **Actions → Deploy → Run workflow → main → Run**.
Or: `gh workflow run deploy.yml --repo bajajvinamr/sales-agent-publisher --ref main`

## Known limits

- **No staging.** Every deploy goes straight to prod. Mitigated by CI catching 80% of issues pre-merge.
- **No blue/green.** ~15s of 502s during `docker compose up -d --build`. Acceptable for internal tool.
- **Cloudflare quick tunnel rotates.** If the droplet reboots, `APP_URL` changes, `deploy.yml` health check + `health-watch.yml` + `sync-sheet.yml` all break. Move to a named Cloudflare Tunnel or the DO droplet's Tailscale Funnel to fix permanently.
- **No actual tests.** CI lints and type-checks; it can't invent unit tests. Writing tests is a separate project.
- **No synthetic user flows.** Health check only hits `/api/health`. Doesn't catch a working DB but broken extractor. Add journey tests as the product matures.

## Rotation cadence

| Thing | Cadence |
|---|---|
| `APP_PASSWORD` | Every 90 days, or on leak |
| `CRON_SECRET` | Every 90 days |
| `DEPLOY_SSH_KEY` | Every 180 days |
| `ANTHROPIC_API_KEY` | Every 90 days |
