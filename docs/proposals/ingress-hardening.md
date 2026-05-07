# Proposal — Ingress Hardening (eliminate cloudflared from the dashboard path)

**Status:** Proposal — NOT executed in PR `feat/reliability-monitor-hardening`. This document scopes a separate, follow-up PR.
**Owner:** @bajajvinamr
**Date:** 2026-05-07

## Why this is a separate PR

The monitor + deploy hardening in PR `feat/reliability-monitor-hardening` eliminates the *false-positive paging* from the cloudflared QUIC reconnect failure mode. It does not eliminate the failure mode itself — public requests during a reconnect window still get a real 503 from the Cloudflare edge. With hysteresis, the monitor doesn't notice. Users do.

This proposal covers replacing the cloudflared tunnel layer with a more conventional ingress so transient 503s during edge re-registrations stop happening at all. It is **not blocking on the monitor PR** — the monitor PR makes the system tolerable; this proposal makes it good.

## Constraints

- Field reps on mobile (Android + iOS Safari) hit `sales.telligences.com` from arbitrary networks. Authenticated public ingress is a hard requirement.
- HTTP Basic auth via `APP_PASSWORD` is the only access control; mobile-friendly behavior was hard-won (PR #44).
- The droplet is Bangalore (`blr1`), 1.9 GB RAM, 2 GB swap, 78% disk. No room for a heavy ingress proxy.
- DNS for `telligences.com` is on Cloudflare (assumed — verify before any change).
- The named tunnel `sales.telligences.com` currently maps to a `*.cfargotunnel.com` CNAME. Switching ingress means changing this DNS record.
- Zero downtime is required. A failed migration must be rolled back in <5 minutes.

## Options compared

| Option | Public exposure | DDoS protection | TLS termination | Failure modes eliminated | Failure modes added | Cost |
|---|---|---|---|---|---|---|
| **A. cloudflared tunnel (status quo)** | Hidden (only egress to CF) | Cloudflare edge | Cloudflare edge | — | QUIC reconnect 503s, edge propagation lag on tunnel restart, cloudflared image regressions (`:latest` 2026-05 incident) | $0 |
| **B. Cloudflare proxy + Caddy on droplet 443** | Droplet IP hidden behind CF proxy | Cloudflare edge | Caddy on droplet (Let's Encrypt or CF Origin Cert) | All cloudflared-tunnel failure modes | Need port 443 firewall rule; origin cert lifecycle; origin pinned to droplet IP | $0 |
| **C. Caddy direct (no Cloudflare proxy)** | Droplet IP public in DNS | None — droplet faces internet | Caddy on droplet (Let's Encrypt) | All cloudflared failure modes | Direct DDoS surface; IP exposure; no edge cache for static assets | $0 |
| **D. Vercel / Fly proxy** | Managed | Vendor edge | Managed | All cloudflared failure modes | Vendor lock-in; egress costs; new account/auth | ~$5–20/mo |
| **E. Tailscale Funnel** | Funnel proxy | Tailscale's network | Tailscale | All cloudflared failure modes | Funnel is opt-in per machine, less mature; field-rep mobile access via Funnel works but is unusual | $0 (free tier) |

## Recommendation: **Option B — Cloudflare proxy (orange cloud) + Caddy on droplet 443**

Rationale:

1. Keeps Cloudflare's DDoS protection and IP-hiding (the reasons cloudflared was chosen originally).
2. Eliminates the entire cloudflared/QUIC layer — no connector pool, no edge re-registration window, no protocol switch debate.
3. Caddy on the droplet auto-renews Let's Encrypt certificates and reverse-proxies to `app:3000` over the docker-internal network. Total config: ~10 lines.
4. DNS migration is one A record change with ~5 min Cloudflare TTL — fully reversible.
5. Costs nothing additional and reuses the existing Cloudflare account/zone.
6. Caddy is ~15 MB resident; fits on the 1.9 GB droplet without measurable impact.

Option C is rejected because exposing the droplet IP to the public internet without DDoS protection is a regression. Options D and E add vendor complexity for a problem that has a $0 in-house solution.

## Architecture (proposed)

```
                ┌────────────────────────┐
  field rep ───►│ Cloudflare edge (proxy)│ ── orange-cloud DNS ──┐
   on mobile    └────────────────────────┘                       │
                                                                  ▼
                                                    ┌────────────────────────┐
                                                    │   droplet (Bangalore)  │
                                                    │  ┌──────────────────┐  │
                                                    │  │ Caddy : 443      │  │
                                                    │  │  TLS (LE auto)   │  │
                                                    │  │  reverse_proxy   │  │
                                                    │  │   → app:3000     │  │
                                                    │  └──────────────────┘  │
                                                    │  app, db (unchanged)   │
                                                    │  cloudflared (off)     │
                                                    └────────────────────────┘
```

Compose-level changes (sketch — not committed):

```yaml
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "443:443"
      - "80:80"  # for Let's Encrypt HTTP-01 challenge + auto-redirect
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - app

# Caddyfile (root of repo):
sales.telligences.com {
  reverse_proxy app:3000
  # Optional security headers
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Frame-Options "DENY"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "strict-origin-when-cross-origin"
  }
}
```

Removals: the entire `tunnel:` service block and `cloudflared.yml`.

## Zero-downtime migration plan

The principle: bring the new ingress up alongside the old one, prove it works on a temporary hostname, then switch the DNS record. Roll back by switching the DNS record back.

### Step 0 — Pre-flight (local, ~10 min)

- [ ] Verify `telligences.com` zone is on Cloudflare (DNS dashboard).
- [ ] Confirm droplet's public IPv4 (via `ssh salestracker 'curl -s ifconfig.me'`).
- [ ] Confirm port 443 and 80 are not currently firewalled outbound on the droplet (`ssh salestracker 'sudo ufw status'` — most DO droplets are wide open by default).
- [ ] Add a Caddyfile to the repo on a feature branch.

### Step 1 — Stage Caddy on a temporary hostname (~30 min, zero impact)

- [ ] Add `caddy` service to `docker-compose.yml` listening on a non-conflicting port (e.g. `8443`) initially. Tunnel service stays running.
- [ ] Add a temporary DNS A record `staging.telligences.com` → droplet IP, **proxy off** (grey cloud) so Let's Encrypt can hit the droplet directly for the HTTP-01 challenge.
- [ ] Configure Caddyfile to serve `staging.telligences.com` on port 443.
- [ ] Open port 443 in the droplet firewall.
- [ ] Verify: `curl -I https://staging.telligences.com/api/health` returns 200.
- [ ] Verify mobile auth flow on the staging hostname (full /connect → QR → scan path). HTTP Basic must still prompt, /api/health must still allowlist.

### Step 2 — Cutover prep (~15 min, zero impact)

- [ ] Set Cloudflare DNS TTL on `sales.telligences.com` to 60 seconds, **24 hours before** cutover. (Reduces rollback time.)
- [ ] Bind Caddy to host port 443 in compose (alongside the tunnel — they don't conflict; tunnel doesn't listen on host 443).
- [ ] Pre-warm Caddy with the production hostname configured (Caddy will provision the LE cert preemptively).
- [ ] Verify production cert is provisioned: `ssh salestracker 'docker compose exec caddy caddy list-certificates'`.

### Step 3 — Cutover (~5 min, ~30s of edge propagation)

- [ ] Change Cloudflare DNS for `sales.telligences.com`: from CNAME `<tunnel-id>.cfargotunnel.com` (proxy off) → A record droplet-ip, **proxy ON** (orange cloud).
- [ ] Watch `ssh salestracker 'docker compose logs caddy --tail 50 -f'` for inbound traffic.
- [ ] Verify: `curl -I https://sales.telligences.com/api/health` returns 200 from the runner AND from a phone.
- [ ] Run the Health Watch workflow manually (`gh workflow run health-watch.yml`) — expect 3/3 passes in the new monitor.

### Step 4 — Decommission cloudflared (~10 min, after 24h soak)

- [ ] Wait 24 hours of clean health-watch runs.
- [ ] `ssh salestracker 'docker compose down tunnel'`.
- [ ] Delete the named tunnel from Cloudflare Zero Trust dashboard.
- [ ] Remove `tunnel:` service and `cloudflared.yml` from the repo. Update CLAUDE.md to reflect the new architecture.

### Rollback plan (any time before Step 4)

If anything looks wrong at any stage:

1. **Step 3 rollback (DNS-level):** revert the DNS A record back to the tunnel CNAME with proxy off. With TTL=60s, propagation is ~1 minute. cloudflared is still running on the droplet, so traffic resumes via the tunnel within ~60s.
2. **Step 2 rollback (compose-level):** `docker compose stop caddy` and remove the service. The tunnel keeps serving traffic.
3. **Step 4 reversal:** if we get to Step 4 and want to restore cloudflared, the tunnel config is in git history; redeploy to a previous SHA and update DNS back.

The whole migration is reversible because we never delete cloudflared until 24h after the cutover proves clean.

## Failure modes added by this migration

| Failure | Likelihood | Mitigation |
|---|---|---|
| Let's Encrypt rate limits | Low (5 certs/week per domain) | Caddy persists certs in `caddy_data` volume — survives container restarts |
| Caddy OOMs the 1.9 GB droplet | Very low (~15 MB resident) | Monitor `docker stats caddy` for first week |
| LE HTTP-01 fails (port 80 blocked) | Low | Confirmed open in pre-flight; Caddy logs the failure clearly |
| DDoS during the brief window when DNS changes hit cache but Cloudflare proxy isn't fully active | Very low | TTL=60s window is tight; Cloudflare proxy is up the moment the DNS record flips |
| Origin pinned to droplet IP — if droplet IP changes (e.g., DO reassignment) the site drops | Low (DO reassignments are rare) | Add monitoring on `dig sales.telligences.com` vs `ssh salestracker 'curl -s ifconfig.me'` |

## What NOT to do

- Don't migrate to Caddy direct (Option C) without Cloudflare proxy. Exposing droplet IP to the public internet without DDoS protection is a regression.
- Don't bundle this into the same PR as the monitor hardening. They're independently valuable; combining them makes both harder to revert.
- Don't migrate while a cloudflared incident is active — wait for stable conditions before touching ingress.
- Don't skip the 24h soak in Step 4. Edge propagation issues sometimes show up only after multiple cron cycles.

## Decision points (need user input before execution)

1. **Confirm `telligences.com` is on Cloudflare DNS.** If it's elsewhere (Namecheap, DO DNS, etc.), Option B's "use existing CF proxy" advantage disappears and Options C or D become more attractive.
2. **Origin cert: Let's Encrypt vs Cloudflare Origin Cert?** LE is automatic and standard; CF Origin Cert is 15-year-valid, free, but requires Cloudflare's Full (Strict) mode and a manual cert generation step. LE is simpler; recommend that.
3. **Soak window: 24h enough?** A weekend deploy with 72h soak is safer if there's no urgency.
4. **Field-rep notification?** Cutover is transparent (same hostname, same auth) but if any rep has cached the old tunnel hostname (`*.trycloudflare.com` from the quick-tunnel days), they'll need a fresh URL. Worth a Slack heads-up.

## Estimate

- Pre-flight: 10 min
- Stage Caddy on `staging.telligences.com`: 30 min
- Cutover prep + cutover: 30 min
- 24h soak (no active work)
- Decommission cloudflared: 10 min
- Doc cleanup (CLAUDE.md, runbook updates): 15 min

**Total active work:** ~95 min. **Total elapsed:** ~2 days (most of it the soak).

## Open questions

- Do we want Cloudflare's WAF rules in front of the dashboard (e.g., rate-limit /connect, block known bad IPs)? Free tier offers basic rules; could be added separately after migration.
- Do we want Cloudflare's edge cache for static assets (`/_next/static/*`)? Default rules cache them already once it's behind the proxy.
- Do we want to add a synthetic external monitor (UptimeRobot, BetterUptime free tier) as a third independent signal beyond Health Watch + the field reps' eyes? Useful when health-watch.yml itself is the thing that breaks.
