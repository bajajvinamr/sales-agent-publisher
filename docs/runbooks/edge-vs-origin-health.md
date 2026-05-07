# Runbook — Edge vs Origin Health

**Audience:** anyone responding to a `prod-incident`, `app-down`, `ingress-degraded`, or `deploy-failure` GitHub issue.

## Why this runbook exists

Between 2026-05-01 and 2026-05-07 the monitor opened 14 `PROD DOWN` issues. None of them corresponded to the app being down. The app container had `RestartCount=0` for the entire window, the database had 13 days uptime, and every issue auto-closed within 1–3 hours without a human commit.

Root cause: **a 1-strike public health probe sitting in front of a cloudflared tunnel with QUIC reconnects is structurally guaranteed to false-positive ~2x/day.** Cloudflared QUIC connectors periodically fail with `failed to accept QUIC stream: timeout: no recent network activity` and re-register; each re-registration takes ~4 seconds during which that connector slot returns 503-with-empty-body. A single edge probe landing in that ~4-second window opened an issue.

This runbook documents the new monitor's rules and how to read its output.

## The invariant

> A 1-strike public health probe in front of a cloudflared tunnel with QUIC reconnects is structurally guaranteed to false-positive during edge transients. Public-edge monitors need **hysteresis** (multiple consecutive failures before alerting) **and** **origin correlation** (probe the origin directly to disambiguate edge failures from app failures). Hysteresis alone hides real ingress problems. Origin correlation alone still files noise on transients. Both together kill the false positives without losing real-outage signal.

## How the monitor classifies failures now

`.github/workflows/health-watch.yml` runs every 15 minutes. Each run:

1. Probes `${APP_URL}/api/health` 3 times, 30 seconds apart (~90s window).
2. If any probe fails, SSHes to the droplet and probes `http://localhost:3000/api/health` directly.
3. Classifies the failure based on the combined signal.
4. Decides whether to open, comment on, or close an incident.

### Decision matrix

| Edge probes (3 in 90s) | Origin probe | Action | Label |
|---|---|---|---|
| 3 of 3 fail | Origin 200 | Open issue | `ingress-degraded` |
| 3 of 3 fail | Origin also failing | Open issue, assign to owner | `app-down` |
| 3 of 3 fail | SSH failed (can't reach origin) | No issue this run; retry next cron | — |
| 2 of 3 or 1 of 3 fail | (any) | No issue; logged in run summary | — |
| 0 of 3 fail (all 200) | (skipped) | If incident open and last 2 probes were 200, close it | — |

**Single empty 503 from cloudflared no longer pages.** A real edge problem (e.g., tunnel daemon stuck, certificate issue, POP outage) sustained for 90+ seconds DOES still page, but as `ingress-degraded` not `app-down` — different severity, different response.

### Body classification

The monitor also classifies the response body of the last failed edge probe:

| Body | Meaning |
|---|---|
| **Empty** | cloudflared edge returned 5xx; origin was never reached (tunnel/edge issue). |
| **JSON** (starts with `{`) | Reached the Next.js app; the app itself returned a non-200. Real app error. |
| **Other / non-JSON** | Unusual — possibly an HTML 502 page from an upstream proxy, or partial response. |
| **Timeout / `000`** | Network or origin ambiguity; the probe never got a response. |

This is included in the issue body as a secondary signal but origin correlation is the primary classifier.

## What real outage looks like

A `app-down` issue means **3 consecutive edge probes failed AND the SSH origin probe also failed.** That's not a transient — the app container or its dependencies are genuinely unreachable from inside the droplet. Response steps:

1. SSH to the droplet: `ssh salestracker`
2. `cd /root/sales-agent-publisher && docker compose ps` — what's running?
3. `docker compose logs app --tail 200` — last app errors
4. Check container restart count: `docker inspect sales-agent-publisher-app-1 --format '{{.RestartCount}} {{.State.Status}}'`
5. Check db: `docker compose exec db pg_isready -U postgres`
6. If app is crashing: `docker compose logs app | grep -E 'FATAL|Error|panic'`
7. If db is down: `docker compose restart db` (last resort — investigate root cause first)
8. Last-known-good redeploy: GitHub Actions → Deploy → Run workflow

## What an `ingress-degraded` issue means

The app is fine. cloudflared can't reliably forward traffic. Steps:

1. `ssh salestracker 'cd /root/sales-agent-publisher && docker compose logs tunnel --tail 100'`
2. Look for `ERR Connection terminated` patterns sustained over more than ~5 minutes. Brief reconnect loops are normal QUIC churn.
3. Check Cloudflare status page: https://www.cloudflarestatus.com/
4. If this is sustained (>10 min): consider `docker compose restart tunnel` — but accept that Cloudflare edge POPs take 5–15 min to globally re-propagate. **Never restart a working tunnel "out of habit."**
5. If this recurs daily: the tunnel image may need to be re-pinned or the protocol switched. See `docs/incidents/2026-05-tunnel-flap.md`.

## How recovery works

The monitor closes an open incident as soon as a single Health Watch run sees **2 consecutive 200s** from the edge probe. With 3 probes spaced 30s apart, that's the last two probes both returning 200. A single 200 in the middle of a flapping window does NOT auto-close — that prevents flap-close-flap-close cycles.

A human can also manually close any incident at any time; the monitor will only re-open if conditions match the matrix above on a subsequent run.

## Deploy-time semantics

`.github/workflows/deploy.yml` rebuilds **only the `app` service** unless `docker-compose.yml` or `cloudflared.yml` changed in the deploy. This is enforced by diffing the pre-deploy HEAD against the new HEAD on the droplet itself. Rebuilding the tunnel triggers a 5–15 min Cloudflare edge propagation window of false-positive 503s, which is exactly the failure mode this runbook exists to eliminate. App-only deploys leave the tunnel's existing edge connections in place.

If a deploy DOES trigger a tunnel restart (intentionally — compose or tunnel config changed), the deploy-failure issue body now includes the deploy scope so future-you can correlate.

## Things that should NEVER cause a `prod-incident` issue

- A single empty 503 from cloudflared (transient QUIC reconnect)
- A single timeout (network blip on the GitHub Actions runner)
- A 200 that took longer than a few seconds (slow doesn't mean down)
- A WhatsApp pairing timeout (that's a `whatsapp: "failed"` field in the health body, not a 5xx response)

If any of these start firing issues again, the monitor logic regressed — review `.github/workflows/health-watch.yml` against this runbook.

## Cross-references

- `docs/incidents/2026-05-tunnel-flap.md` — original postmortem with the diagnosis
- `.github/workflows/health-watch.yml` — implementation
- `.github/workflows/deploy.yml` — app-only deploy scope detection
- `CLAUDE.md` — repo-level invariants (don't restart tunnel needlessly, localhost is origin truth, etc.)
- `docs/proposals/ingress-hardening.md` — proposed structural fix to remove cloudflared from the dashboard path entirely
