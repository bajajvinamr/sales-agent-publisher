# Forward Plan — sales-agent-publisher · 2026-04-23

## North Star

**Outcome (90 days):** By **2026-07-22**, achieve **30 consecutive days with zero silent-data-loss incidents** (no message dropped without being either successfully ingested or surfaced as an error issue) across ≥4 active field reps. Measured from prod metric `ingest_failure_ratio = failed_parses / received_messages`, target <0.5%, alerted >1%.

**Constraint:** Solo operator; must stay deployable from a single laptop with `ssh salestracker 'docker compose up -d --build'`. No multi-engineer infra (Kubernetes, IaC platforms, SaaS APM suites). Everything must survive a founder laptop reboot.

**Excellence dimensions:**
1. **Data integrity** — Every WhatsApp message lands in DB or opens an issue. Never silent.
2. **Recoverability** — Any prod failure either auto-rolls back or opens a `prod-incident` Issue within 15 min. Human intervention optional, not required for detection.

## What the retro actually told us

1. **Root cause of the Apr-23 hot-patch sprint:** no compounding layers. Six fixes (PRs #2–#5 + chore branch) hit prod on vibes — no test gate, no lint gate, no local CI, no behavioral rules. Each fix was a firefight, not a system.
2. **Next 30–90 days direction:** stop firefighting. Every bug fix must drop a regression fixture. Every decision must leave a trace (ADR, CLAUDE.md rule, or failing test). The pre-push hook must be trusted or deleted — never bypassed.
3. **Blind spot:** "zero incidents" is not a metric we have today. We learn about silent data loss from Prakhar on WhatsApp, days later. Observability is the missing compounding layer — without it, every regression test we add only catches the ones we thought to write.

## Milestones

### M1 — Test ratchet + lint ratchet

- **Deliverable:** 15+ tests (from 3), ESLint step flipped to blocking (`continue-on-error: false`), all existing warnings fixed, `next build` runs with ESLint re-enabled.
- **Success criterion:** `npm test` shows ≥15 passing tests; `npm run lint` exits 0; `next build` finishes without disabling ESLint.
- **Verification method:** `act pull_request -W .github/workflows/ci.yml -j check` green; `grep ignoreDuringBuilds next.config.ts` returns nothing.
- **Effort:** human ~2 days / CC ~6 hours
- **Blast radius:** If lint blocking merges, can't ship hotfixes without cleaning warnings first. Acceptable — that's the point.
- **One-way door?** No. Revert is a one-line config flip.
- **Dependencies:** None. Current branch (`chore/local-act-ci`, pending push) unlocks this.
- **Target date:** 2026-05-07 (2 weeks)

### M2 — Observability layer

- **Deliverable:** Structured JSON logs with request IDs on all ingest paths; `ingest_failure_ratio` metric exposed on `/api/metrics`; `health-watch.yml` probes both `/api/health` AND a synthetic ingest test; alert fires when ratio >1% over 1 hour.
- **Success criterion:** Inject a deliberately malformed WhatsApp message in staging → `prod-incident` Issue opens within 15 min with request ID in the title.
- **Verification method:** `curl /api/metrics | grep ingest_failure_ratio`; `gh issue list -l prod-incident` after synthetic-break test.
- **Effort:** human ~4 days / CC ~12 hours
- **Blast radius:** If logs balloon disk, droplet OOMs. Mitigation: pino with rotate+compress, 500MB cap.
- **One-way door?** No. Log shape is versioned; rolling back replaces handlers.
- **Dependencies:** M1 (need tests before touching orchestrator logging).
- **Target date:** 2026-05-21 (4 weeks)

### M3 — Eliminate tunnel fragility + staging env

- **Deliverable:** Named Cloudflare Tunnel replaces quick-tunnel (`APP_URL` stops rotating); basic staging env on same droplet via Docker Compose profile (`docker compose --profile staging up`); `deploy.yml` deploys to staging first, waits 2 min, then prod.
- **Success criterion:** Droplet reboot → `APP_URL` unchanged; `gh workflow run deploy.yml` puts change on staging first, auto-promotes on health-check green.
- **Verification method:** `ssh salestracker 'reboot'; sleep 60; curl -f $APP_URL/api/health` from cold state.
- **Effort:** human ~3 days / CC ~10 hours
- **Blast radius:** Staging shares droplet with prod — DB corruption in staging could bleed to prod DB if schemas drift. Mitigation: separate postgres database inside same container with different DB name.
- **One-way door?** Partial — Cloudflare named tunnel requires domain. If domain fails, revert to quick-tunnel in 5 min.
- **Dependencies:** M1 (lint-clean repo), M2 (observability to see staging health).
- **Target date:** 2026-06-18 (8 weeks)

### M4 — Prove the 30-day streak

- **Deliverable:** 30 consecutive calendar days with `ingest_failure_ratio <0.5%` and zero `prod-incident` Issues needing human intervention.
- **Success criterion:** Dashboard/metric shows 30-day rolling window at target. Audit trail in Issues.
- **Verification method:** `gh issue list --state all -l prod-incident --search "created:>2026-06-22"` returns 0 (or only auto-resolved), AND metric consistently below threshold.
- **Effort:** human ~0 days (no work, just time) / CC ~0 hours
- **Blast radius:** N/A — observation period.
- **One-way door?** No.
- **Dependencies:** M1, M2, M3 all complete and operating.
- **Target date:** 2026-07-22 (12 weeks)

## Quality gates (every milestone before "done")

- [ ] Tests pass — `npm test` (vitest) green
- [ ] Typecheck clean — `npx tsc --noEmit` exits 0
- [ ] Lint clean — `npm run lint` exits 0 (M1+; before M1 this is continue-on-error)
- [ ] Performance threshold met — Next build <2 min (`time npm run build`)
- [ ] Security: SAST + secret scan clean — `npm audit --audit-level=high --omit=dev` + gitleaks CI both exit 0
- [ ] Fresh-session human review + `/codex` on ingest path, auth middleware, cron endpoints
- [ ] Data-integrity gate (project-specific) — regression fixture added for the bug being fixed, or justified in PR body why none applies
- [ ] CONTINUE.md updated with today's entry
- [ ] PR merged by human via `gh pr merge --squash`, not by Claude

## Process guarantees

| Gate | Trigger | Skill |
|---|---|---|
| Pre-feature | Every ticket | Fresh session, Plan Mode, TDD (write failing test first) |
| Pre-merge | Every PR | `/review` + `act` CI green + fresh-session read of diff |
| Data/auth/external-I/O PRs | Touching orchestrator, baileys, middleware, cron | `/codex` adversarial review required |
| Post-deploy | Every merge | `health-watch.yml` auto-monitors; manual `/canary` for M3+ |
| Weekly | Friday | `/retro` — one-hour review, file `docs/retros/WEEKLY-YYYY-MM-DD.md` |
| Quarterly | End of quarter | `/retrospect-project` — full audit pass, file `docs/retros/YYYY-MM-DD-retro.md` |

## Output standard (what "excellent" means for THIS project)

1. **Every WhatsApp message accounted for.** Either in `Visit` DB row OR in `ingest_failures` table with reason. Zero messages in limbo.
2. **Every prod rollback completes in <60s.** Measured in `deploy.yml` timestamps; fail build on slower rollback.
3. **Every schema change preserves prior rows' queryability.** Verified by regression test that seeds pre-change data shape, runs migration, asserts reads still work.
4. **Every ingest path covered by at least one fixture-based test.** Measured by `tests/ingest/*.test.ts` file count ≥ ingest path count. New path without test = red PR.
5. **Every prod incident has an auto-opened Issue with repro within 15 min.** Measured by time delta: `created_at(Issue) - timestamp(failure log line)`.

## Anticipated drift (max 4)

- **Dependabot fatigue** — will drift because weekly runs generate 4+ PRs, each needs act+review. Mitigation: monthly "dependabot sweep" on the first Friday, merge the patch-group blindly after act green, triage the majors case-by-case.
- **CLAUDE.md rot** — will drift because invariants change silently (someone edits docker-compose, JID filter, TZ) and no automated check enforces the rules file. Mitigation: `/retrospect-project` has a CLAUDE.md audit step; quarterly cadence catches it.
- **Test staleness** — will drift because tests mirror inline regex/hashes via drift-detection comments, not imports. Mitigation: quarterly review of the three seed tests' source-location comments; extract to shared helpers when a third call site appears.
- **Observability cost** — structured logs will grow toward droplet disk limit. Mitigation: pino rotate+compress at 500MB, drop to 100MB when disk <10GB free, auto-alert on disk pressure via existing health-watch.

## First three tickets

Created as stubs:
- `docs/tickets/001-lint-ratchet.md` — M1, fix the 20+ preexisting ESLint warnings blocking `ignoreDuringBuilds` removal
- `docs/tickets/002-ingest-fixture-suite.md` — M1, add fixture-based tests for orchestrator+baileys covering all 4 field bugs from PR #2
- `docs/tickets/003-structured-logging.md` — M2, introduce pino with per-request-id context through ingest path

## Kill criteria (specific triggers to STOP and re-plan)

- **If M1 not shipped by 2026-05-14** (2× original estimate) → test-ratchet effort was underestimated, re-plan the scope (maybe fewer tests, stricter gates).
- **If `ingest_failure_ratio >2%` over any 24h window** → pause feature work, declare P0. Fix the ingest path before any other work.
- **If M2 ships but Prakhar/Nishkarsh still surface bugs first in WhatsApp** → observability isn't working. Problem is metric selection, not coverage. Re-scope M2.
- **If dependabot PR queue exceeds 15 open** → merge discipline has broken. Pause feature work, do a "sweep-only week" until queue <5.

## Calendar

- Next retro: **2026-05-07** (2 weeks) — weekly `/retro` cadence begins this Friday
- Next plan review: **2026-05-21** (4 weeks) — are M1+M2 on track?
- 90-day outcome check: **2026-07-22**
