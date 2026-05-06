# Tunnel-Flap Postmortem & Hardening Plan

**Status:** Draft — pending approval
**Owner:** @bajajvinamr
**Date:** 2026-05-06
**Incident window:** 2026-05-04 11:27 UTC → 2026-05-06 (chronic, ongoing)

---

## TL;DR

Five `PROD DOWN` issues auto-opened in 48h. All transient. App container stable (zero restarts in 24h). Root cause is the **Cloudflare tunnel layer flapping** between edge POPs — 59 reconnect events in the last 30 hours. Three contributing factors stacked:

1. `cloudflare/cloudflared:latest` (unpinned image) was rebuilt May 5 14:11 UTC, picking up a build with QUIC instability.
2. QUIC default protocol is failing repeatedly: `failed to dial to edge with quic: timeout: no recent network activity`.
3. The tunnel was restarted ~28 min before the app finished its rebuild — `connection refused` from origin while edge POPs cached "origin down."

The app itself was up the entire time. Users hit 503s only when their request landed on an edge POP whose tunnel slot was mid-handshake (~30–90s windows, several times per day).

---

## Evidence

| Signal | Value | Source |
|---|---|---|
| Auto-opened `PROD DOWN` issues, 48h | 5 (#36, #37, #38, #43, #45) — all auto-closed on next probe | `gh issue list --label prod-incident` |
| App container restarts, 24h | 0 | `docker inspect ... .State.RestartCount` |
| Tunnel reconnect/terminated events, 30h | 59 | `docker compose logs tunnel` |
| `Health Watch` failures, 24h | 3 (16:14, 17:53, 20:44 UTC) | `gh run list --workflow="Health Watch"` |
| Failure response shape | HTTP 503, empty body | `gh run view` log capture |
| Deploy `localhost:3000` probe | always 200 (per PR #42 design) | `deploy.yml` step `Wait for health` |
| Tunnel image | `cloudflare/cloudflared:latest` (unpinned) | `docker-compose.yml:60` |
| Tunnel protocol | QUIC default (no `protocol:` in `cloudflared.yml`) | `cloudflared.yml` |

The empty-body 503 is the canonical signature of "Cloudflare edge POP could not reach a registered tunnel connector" — Cloudflare's own error page, not a Next.js error page.

---

## Phase 0 — Stop the bleed (today, ~30 min)

**Goal:** End the recurring 503 alerts. Reversible. Zero schema/code risk.

### Changes

**File: `docker-compose.yml`**

```diff
   tunnel:
-    image: cloudflare/cloudflared:latest
+    # Pin to a specific tag — `:latest` re-pulls on every rebuild and has shipped
+    # QUIC regressions multiple times. Bump deliberately, never automatically.
+    # See docs/incidents/2026-05-tunnel-flap.md.
+    image: cloudflare/cloudflared:2025.7.0
     restart: unless-stopped
-    command: tunnel --no-autoupdate --config /cloudflared.yml run
+    # --protocol http2 forces HTTP/2 over TLS instead of the default QUIC.
+    # QUIC is the failure mode in 100% of our flap logs ("failed to dial to
+    # edge with quic: timeout: no recent network activity"). HTTP/2 is more
+    # robust over flaky network paths and matches cloudflared's pre-2024 default.
+    command: tunnel --no-autoupdate --protocol http2 --config /cloudflared.yml run
```

**Verification (run in this order, do NOT skip steps):**

1. **Pre-change baseline** — `gh issue list --label prod-incident --state all --limit 10 --json createdAt,title` — record count.
2. **Local syntax check** — `cd ~/Projects/sales-agent-publisher && docker compose config -q` (validates compose file without applying).
3. **Commit + push** — small atomic commit: `chore(tunnel): pin cloudflared to 2025.7.0 + switch to HTTP/2`.
4. **Deploy** — let `deploy.yml` run on push; it will rebuild the tunnel container.
5. **Post-deploy verification (in this exact order):**
   - `ssh salestracker 'cd /root/sales-agent-publisher && docker compose ps tunnel'` — confirm `Up`.
   - `ssh salestracker 'cd /root/sales-agent-publisher && docker compose logs tunnel --tail=30'` — confirm 4× `Registered tunnel connection ... protocol=http2` (NOT `quic`).
   - **Wait 15 minutes** for Cloudflare edge POPs to globally re-propagate. Do NOT touch anything else during this window.
   - `for i in {1..30}; do curl -s -o /dev/null -w "%{http_code} " https://sales.telligences.com/api/health; sleep 10; done; echo` — expect 30/30 = 200.
6. **24h watch** — `gh issue list --label prod-incident --state all --json createdAt --jq '.[].createdAt' | head -5` next morning. Expect zero new issues since the deploy timestamp.

**Rollback:** revert the commit and redeploy. The previous behavior is just `:latest` + QUIC default.

**Risk:** ~10–15 min of edge-propagation lag during which public 503s may briefly increase before they stop. Acceptable.

---

## Phase 1 — Stabilize alerting (this week, ~1 hour)

**Goal:** Stop paging on single transient 503s. Distinguish app failures from tunnel failures.

### 1a. Implement the 2-consecutive-failures grace in `health-watch.yml`

The workflow comment already describes this; just implement it.

**File: `.github/workflows/health-watch.yml`**

Replace the "Create incident on failure" block with a two-sample probe:

```yaml
- name: Probe (with grace — second sample 60s later if first fails)
  id: probe
  run: |
    URL="${{ secrets.APP_URL }}/api/health"
    CODE1=$(curl -s -o /tmp/h1.json -w "%{http_code}" "$URL" --max-time 12 || echo "000")
    if [ "$CODE1" = "200" ]; then
      echo "status=200" >> $GITHUB_OUTPUT
      echo "Probe: HTTP 200 on first sample"
      exit 0
    fi
    echo "First sample: HTTP $CODE1 — waiting 60s for second sample"
    sleep 60
    CODE2=$(curl -s -o /tmp/h2.json -w "%{http_code}" "$URL" --max-time 12 || echo "000")
    BODY=$(cat /tmp/h2.json 2>/dev/null || echo "(no body)")
    echo "status=$CODE2" >> $GITHUB_OUTPUT
    echo "first_sample=$CODE1" >> $GITHUB_OUTPUT
    {
      echo "body<<EOF"
      echo "$BODY"
      echo "EOF"
    } >> $GITHUB_OUTPUT
    echo "Probe: HTTP $CODE2 on second sample (after $CODE1)"
```

**Why this matters specifically:** All three failures today were under 90 seconds wide. A 60-second second-sample gate would have caught zero of them. We'd still know about a real outage in <2 min.

### 1b. Add a tunnel-vs-app distinguisher

When the public probe fails, also probe the droplet's localhost endpoint via SSH (same path as `deploy.yml`). If localhost is 200 but public is 5xx, the issue body says **"TUNNEL FLAP"** instead of **"APP DOWN"** — different diagnosis, different response.

**File: `.github/workflows/health-watch.yml`** (new step before issue creation):

```yaml
- name: Disambiguate tunnel vs app on failure
  id: disambiguate
  if: steps.probe.outputs.status != '200'
  env:
    DEPLOY_SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}
  run: |
    mkdir -p ~/.ssh && echo "$DEPLOY_SSH_KEY" | tr -d '\r' > ~/.ssh/id_ed25519 && chmod 600 ~/.ssh/id_ed25519
    ssh-keyscan -T 10 -H "${{ secrets.DEPLOY_HOST }}" >> ~/.ssh/known_hosts 2>/dev/null || true
    LOCAL_CODE=$(ssh -i ~/.ssh/id_ed25519 -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=10 \
      "${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }}" \
      "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/health --max-time 5 || echo 000")
    if [ "$LOCAL_CODE" = "200" ]; then
      echo "kind=tunnel" >> $GITHUB_OUTPUT
      echo "Disambiguation: localhost=200, public=$( cat /tmp/h2.json 2>/dev/null || echo '?' ) → TUNNEL FLAP"
    else
      echo "kind=app" >> $GITHUB_OUTPUT
      echo "Disambiguation: localhost=$LOCAL_CODE → APP DOWN"
    fi
```

Then in the issue title/body, branch on `steps.disambiguate.outputs.kind`. Tunnel-flap issues get a different label (`tunnel-flap` not `prod-incident`) so they don't page the same way.

**Verification:**
- Force a tunnel-only failure (manual `docker compose restart tunnel` on droplet, observe Health Watch run during the propagation window) → expect `tunnel-flap` issue, not `prod-incident`.
- Force an app failure (don't actually do this in prod — confirm the logic by reviewing the workflow run logs from the manual tunnel-restart test; localhost still 200, so kind=tunnel; correctly does NOT fire app-down path).

**Rollback:** revert the workflow file.

---

## Phase 2 — Deploy hygiene (this week, ~1 hour)

**Goal:** Eliminate the deploy-time tunnel restart anti-pattern. Make app-only deploys not touch the tunnel.

### 2a. Make `deploy.yml` rebuild only the `app` service, not the tunnel

**File: `.github/workflows/deploy.yml`**

```diff
       cd sales-agent-publisher
       git fetch origin main
       git reset --hard origin/main
-      docker compose up -d --build
+      # Rebuild ONLY the app service. The tunnel and db are intentionally
+      # left running. Restarting cloudflared causes 5–15 min of Cloudflare
+      # edge propagation lag (false-positive 503s for users) and is never
+      # required for an app-only deploy. See docs/incidents/2026-05-tunnel-flap.md.
+      docker compose up -d --build app
```

This makes the existing `--accept-data-loss` Prisma push still run (it's in the app `command`), and leaves `tunnel` + `db` untouched.

**Edge case:** if `docker-compose.yml` itself changed (e.g., a tunnel pin bump like Phase 0), we DO want the tunnel to restart. Add a guard:

```bash
if git diff --name-only HEAD~1 HEAD | grep -qE '^(docker-compose\.yml|cloudflared\.yml)$'; then
  echo "Compose/tunnel config changed — rebuilding all services"
  docker compose up -d --build
else
  echo "App-only deploy — leaving tunnel and db untouched"
  docker compose up -d --build app
fi
```

### 2b. If we ever DO restart the tunnel, gate the post-deploy public canary on a 15-min grace window

Add a final step to `deploy.yml` (only runs when tunnel was rebuilt):

```yaml
- name: Public canary (post-deploy, 15-min grace)
  if: steps.deploy.outputs.tunnel_rebuilt == 'true'
  run: |
    echo "Tunnel was rebuilt — skipping public-URL canary for 15 min (edge propagation)."
    echo "Health Watch (15-min cron) will catch any persistent failure."
```

**Verification:** trigger an app-only deploy (no compose change) → confirm `docker compose up -d --build app` log line, NOT `--build` everything. Tunnel container start time should be unchanged before/after.

---

## Phase 3 — Observability (next sprint, ~2 hours)

**Goal:** Catch the next regression in 1 minute, not via "field rep called and said the site is down."

### 3a. Surface tunnel state in `/api/health`

Right now `/api/health` returns `{"status":"ok",...}` based on app-internal checks. It has no way to detect that Cloudflare can't reach it. That's structural — but we can add a *metadata* field that's useful for ops:

**File: `src/app/api/health/route.ts`** (or wherever the handler lives — search for `dbConnected`).

Add a `tunnelHostname` field that the response includes when the request came in via the tunnel (vs. localhost):

```ts
// Pseudocode — adapt to actual handler shape
const viaTunnel = req.headers.get('cf-connecting-ip') !== null
return NextResponse.json({
  status: 'ok',
  // ... existing fields ...
  viaTunnel,  // true = request came through Cloudflare; false = localhost / direct
})
```

This lets `health-watch.yml` and any external monitor distinguish the route a 200 came back through.

### 3b. Daily tunnel-health summary

Add a tiny workflow that runs once a day and posts a comment to a tracking issue with:
- Number of tunnel reconnect events in last 24h (`docker compose logs tunnel | grep "Connection terminated" | wc -l`)
- Number of `Health Watch` failures
- Highest sustained failure window

This gives a **trend signal** without paging — if reconnects climb from 5/day to 50/day, you find out before users do.

### 3c. Add tunnel restart detection to the auto-memory invariants

Already captured in `vinamr-invariants.md` (the `depends_on: app` does-not-cascade rule and the unrelated tunnel-restart rule). Add a new entry on this incident:

> **`cloudflare/cloudflared:latest` is a footgun in production.** Pin to a specific version and bump deliberately. The default `:latest` + default-QUIC combination has shipped at least one regression that caused chronic 503 flapping — see `docs/incidents/2026-05-tunnel-flap.md`. When pinning, also pass `--protocol http2` to skip QUIC entirely; QUIC is more sensitive to network conditions and is the failure mode in 100% of observed flap events on Bangalore (`blr02`) and Mumbai (`bom09`) edge POPs.

---

## Phase 4 — Codify (do alongside Phase 0, ~15 min)

These are zero-code changes that prevent re-introduction.

### 4a. CLAUDE.md update

Add to the "Behavioral rules" section:

```markdown
- **Cloudflared image is pinned (never `:latest`).** Current pin: `cloudflare/cloudflared:2025.7.0`. Bump deliberately by editing `docker-compose.yml`. `:latest` shipped a QUIC regression on 2026-05-04 that caused 48h of intermittent 503s. See `docs/incidents/2026-05-tunnel-flap.md`.
- **Tunnel uses `--protocol http2`, not QUIC.** Default QUIC is fragile on Bangalore + Mumbai edge POPs. Do not remove the flag.
- **`deploy.yml` rebuilds only the `app` service unless `docker-compose.yml` or `cloudflared.yml` changed.** A full `docker compose up -d --build` triggers a tunnel restart and a 5–15 min Cloudflare edge propagation window of false-positive 503s.
```

### 4b. PR checklist

Add a `.github/pull_request_template.md` line (if not already present):

```markdown
- [ ] If this PR changes `docker-compose.yml` or `cloudflared.yml`, I have read `docs/incidents/2026-05-tunnel-flap.md` and understand the tunnel-restart consequences.
```

### 4c. New invariant for `vinamr-invariants.md`

(Outside this repo — at `~/.claude/rules/vinamr-invariants.md`.) Already drafted in §3c above.

---

## Decision points (your call before I execute)

1. **Cloudflared pin version.** Plan currently picks `2025.7.0` as a safe-looking recent tag. If you have a known-good prior tag from when the tunnel was stable, name it instead. ([Cloudflare release log](https://github.com/cloudflare/cloudflared/releases) — pick a tag from before May 4 if unsure.)
2. **HTTP/2 vs. QUIC.** Plan defaults to HTTP/2. The tradeoff: QUIC has slightly lower latency on healthy networks; HTTP/2 is more robust on flaky ones. Given 59 reconnects in 30h on QUIC, HTTP/2 is the right call here. Reversible if it ever becomes a problem.
3. **`prod-incident` vs `tunnel-flap` label split.** Plan splits them; tunnel-flap stops auto-assigning to you. Confirm you want that — or keep them merged with a different severity treatment.
4. **Council review before execution?** This touches deploy infra and the Cloudflare boundary. Per CLAUDE.md "Vanta Protocol" rules, infra changes >2 services warrant `/council`. Phase 0 is small enough to skip; Phases 2–3 may benefit. My recommendation: skip council on Phase 0 (it's tactical and reversible), run council on Phases 2–3 once Phase 0 stabilizes the system.

---

## Execution order (when approved)

1. Phase 4a (CLAUDE.md update) — same commit as Phase 0 changes.
2. Phase 0 (pin + http2) — deploy, verify 30/30 200s, watch 24h.
3. Phase 1a (2-failure grace) — small workflow PR.
4. Phase 1b (tunnel-vs-app distinguisher) — same workflow PR.
5. Phase 2a (app-only deploy) — small workflow PR.
6. Phase 4c (invariant capture) — `/vanta-sync` after Phase 0 is verified stable.
7. Phase 3 (observability) — separate sprint; only after 0–2 prove the diagnosis.

Total active work across phases: ~4 hours. Total elapsed: ~1 week (most of it watching for regressions, not coding).
