# Production Hardening Plan (Business-Aligned)

Date: 2026-05-01

## Business objective anchor

For this product, failures are not abstract technical bugs — they directly break next-day manager trust. The non-negotiables are:

- Process all WhatsApp activity for the IST business day.
- Emit exactly one daily report cycle (no duplicates, no drops).
- Keep rep attribution accurate and tamper-resistant.
- Keep operational overhead low (no frequent re-QR, no manual recovery).

## Completed in current session

- EBUSY auth-directory wipe resilience has already been shipped (retry-safe wipe behavior).
- Permanent tunnel endpoint (`sales.telligences.com`) is already in place.

## Triage of provided findings (validated)

### Critical (ship first)

1. **Double `initApp()` module-scope init can duplicate cron startup**  
   Files: `src/app/api/health/route.ts`, `src/app/api/dashboard/route.ts`.
2. **Cron day-boundary guard uses ambiguous local date parsing**  
   File: `src/lib/cron.ts`.
3. **In-memory-only capture risks data loss on restart**  
   File: `src/lib/whatsapp-baileys.ts`.
4. **`CRON_SECRET` accepted via URL query parameter**  
   File: `src/app/api/cron/sync-sheet/route.ts`.

### High

5. Remove dead `whatsapp-web.js` runtime dependency.  
   Files: `package.json`, `next.config.ts`.
6. Auto-creating executives from display name is spoofable.  
   File: `src/lib/pipeline/orchestrator.ts`.
7. `/api/ingest` has no message-count upper bound.  
   File: `src/app/api/ingest/route.ts`.
8. Hand-rolled ISO week function in cron.  
   File: `src/lib/cron.ts`.
9. Google Sheets client cache has no invalidation on auth errors.  
   File: `src/lib/integrations/google-sheets.ts`.
10. Chat date parsing ambiguity (DD/MM vs MM/DD).  
    File: `src/app/connect/page.tsx`.

### Medium

11. School creation TOCTOU risk; no unique canonical name guard.  
    Files: `src/lib/pipeline/orchestrator.ts`, `prisma/schema.prisma`.
12. Weekly window uses UTC end-of-day, not IST.  
    File: `src/lib/cron.ts`.
13. Module-scope init runs during build/runtime import time.  
    Files: `src/app/api/health/route.ts`, `src/app/api/dashboard/route.ts`.
14. `setInterval` cron overlap risk for long runs.  
    File: `src/lib/cron.ts`.
15. Disconnect flow always wipes creds (high operator friction).  
    File: `src/lib/whatsapp-baileys.ts`.
16. Lint not strictly enforced in CI/build.  
    Files: `.github/workflows/ci.yml`, `next.config.ts`.
17. Ingest path blocks on synchronous sheet sync call.  
    File: `src/app/api/ingest/route.ts`.
18. Duplicate Fuse matching logic in school matcher.  
    File: `src/lib/pipeline/school-matcher.ts`.
19. Missing focused unit tests on pure pipeline utilities.  
    Files: `src/lib/pipeline/*`, `src/lib/whatsapp-baileys.ts`, `src/app/connect/page.tsx`.

## Final execution plan

## Phase 0 — Same-day safety patch (2–4 hours)

- Add explicit ops check: `RESEND_API_KEY` configured in production and tested via canary alert send.

- Remove `initApp()` from `dashboard` route module scope.
- Keep a single initialization path (temporary: health route) and add in-process lock in `init.ts`.
- Remove query-param auth fallback from cron sync endpoint.
- Add `.max(2000)` to ingest payload schema.
- Make sheet sync in ingest fire-and-forget (`void ...catch(...)`) to avoid request timeout.

**Outcome:** immediate reduction in duplicate runs, secret leakage, runaway ingestion cost, and timeout failures.

## Phase 1 — Timezone and scheduling correctness (0.5–1 day)

- Move initialization to Next.js 15 `instrumentation.ts` (authoritative startup point).

- Introduce a centralized IST day-window helper and replace all ad-hoc `new Date("YYYY-MM-DDT...")` usage.
- Fix daily guard, weekly window, and reporting date derivation to explicit `+05:30` logic.
- Replace custom ISO-week logic with `date-fns` ISO helpers.
- Add cron re-entrancy guard (`running` flag + `finally` reset).

**Outcome:** no missed/duplicate runs around midnight/week boundaries.

## Phase 2 — Data integrity and anti-spoofing (1–2 days)

- Remove auto-create executive path from sender display name.
- Introduce unknown-sender alert path and explicit admin mapping flow.
- Add unique constraint for canonical school and upsert path.
- Improve chat date parsing with ambiguity detection/warning.

**Outcome:** trusted attribution, reduced bad rows, safer school identity lifecycle.

## Phase 3 — Reliability of ingestion state (2–4 days)

- Fix Sheets duplicate append race with idempotent write design (`pending -> appending -> appended`) and visit-ID dedupe key in destination sheet.

- Implement persisted `CapturedMessage` store with TTL and replay-on-startup.
- Add optional quick-recovery boot behavior: auto-connect + auto-monitor configured group.
- Split disconnect into soft disconnect vs explicit logout.
- Add Google Sheets auth cache invalidation on 401/403.

**Outcome:** restart-safe daily processing and fewer operator interventions.

## Phase 4 — Quality gates and maintainability (1–2 days)

- Remove `continue-on-error` for lint once baseline fixed.
- Remove `ignoreDuringBuilds` once lint debt is paid.
- Deduplicate school matcher implementation.
- Add high-value unit tests first: chat date parsing, normalizeSchoolName, computeBackoff bounds, validateFields.

**Outcome:** fewer regressions and faster refactors.

## Acceptance criteria (must pass before “production-hardened” label)

- Exactly one daily auto-run row in `IngestionRun` for each IST day.
- No cron-auth secrets accepted in query params.
- Ingest API rejects >2000 messages with clear 4xx.
- Weekly summaries are sent once per ISO week, correctly across year boundaries.
- Restart during daytime does not cause irreversible message loss.
- Unknown senders do not silently create executive identities.

## Rollout guidance

- Ship Phase 0 and 1 behind a short-lived feature flag if needed.
- Backfill tests before Phase 2 schema changes hit production.
- For schema constraints (`School.canonicalName` unique), run data cleanup migration first.


## Additional implementation tracks (explicitly added)

1. **LLM circuit breaker and timeout budget**
   - Add per-request timeout + retry budget in `src/lib/ai.ts`.
   - Add fallback disable switch when upstream instability exceeds threshold.

2. **Auth hardening beyond tunnel boundary**
   - Keep middleware Basic auth for immediate protection.
   - Add route-level authorization policy for mutation endpoints and signed service-to-service auth for automation.

3. **School canonical-name migration safety**
   - Step A: run duplicate detection query grouped by normalized canonical name.
   - Step B: merge duplicates deterministically (preserve oldest school ID, re-point visits).
   - Step C: add `@@unique([canonicalName])` and convert create path to upsert.

4. **Dependency/config cleanup coupling**
   - Remove `whatsapp-web.js` from `package.json` **and** from `next.config.ts` `serverExternalPackages` in same PR to keep builds clean.
