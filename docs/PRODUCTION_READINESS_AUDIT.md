# Production Readiness Audit (Senior Engineer Review)

Date: 2026-05-01
Scope: Full repository pass with emphasis on correctness, reliability, security, scale, maintainability, DX, and cost.

Business context considered: this system is designed for India-first field-sales teams (10–50 reps) who send 50–200 free-form WhatsApp messages daily, with a manager expectation of reliable, structured intelligence and summaries on an 8 PM IST cadence.

## Ranked findings (highest impact first)

### 1) Unauthenticated mutation/reporting endpoints are exposed
- **Path/module**: `src/app/api/ingest/route.ts`, `src/app/api/whatsapp/process/route.ts`, `src/app/api/whatsapp/send-report/route.ts`, `src/app/api/settings/route.ts` (PATCH), and other non-GET API routes.
- **Problem**: Most mutation endpoints are publicly callable without auth/session/API key checks.
- **Why it matters**: Anyone who can reach the app can trigger LLM spend, modify settings, run ingestion, or send WhatsApp reports (abuse, data corruption, cost spike).
- **Severity**: **Critical**
- **Suggested fix**: Add centralized auth middleware for `/api/*` routes (JWT/session + RBAC). Keep cron endpoints on bearer secret, remove query-secret fallback. Add rate limiting and audit logs.
- **Estimated effort**: **Medium**

### 2) Potential duplicate Google Sheet appends on partial failures
- **Path/module**: `src/lib/pipeline/sync-sheet.ts`
- **Problem**: Rows are appended to Google Sheets first, then DB is marked synced. If marking fails, next run re-appends same rows.
- **Why it matters**: Permanent duplicate rows in sheet, manual cleanup burden, loss of trust in reports.
- **Severity**: **High**
- **Suggested fix**: Use an idempotency key column in sheet (visit ID), or write-through ledger table with retry-safe state machine (`pending -> appending -> appended`). Optionally upsert-by-ID behavior via Sheets API pattern.
- **Estimated effort**: **Medium**

### 3) Date/time handling is inconsistent and can cause off-by-one day bugs
- **Path/module**: `src/lib/pipeline/orchestrator.ts`, `src/app/api/whatsapp/send-report/route.ts`, general date construction patterns.
- **Problem**: Mix of `toISOString`, local `setHours`, and manual `YYYY-MM-DDT00:00:00.000Z` construction.
- **Why it matters**: Day boundaries drift across server timezone vs business timezone; visits can be classified on wrong day, affecting targets and reporting.
- **Severity**: **High**
- **Suggested fix**: Standardize on a single business timezone utility (e.g., `date-fns-tz`) and only store/query day windows derived from that timezone.
- **Estimated effort**: **Medium**

### 4) In-memory WhatsApp capture can grow unbounded
- **Path/module**: `src/lib/whatsapp-baileys.ts`
- **Problem**: `capturedMessages`/history maps are process-memory buffers without strict retention caps.
- **Why it matters**: Long-lived process can accumulate large arrays, increase memory pressure, and eventually OOM/restarts.
- **Severity**: **High**
- **Suggested fix**: Add bounded ring buffer + TTL + max per JID/day; persist to DB/queue for durable ingestion.
- **Estimated effort**: **Medium**

### 5) Fragile executive identity generation can collide/fragment users
- **Path/module**: `src/lib/pipeline/orchestrator.ts` (`getOrCreateExecId`)
- **Problem**: Slugified display names become primary IDs. Similar names can collide; renamed reps create new identities; non-Latin names degrade.
- **Why it matters**: Incorrect attribution, historical data splits, hard-to-reconcile analytics.
- **Severity**: **High**
- **Suggested fix**: Use stable UUID PK, add unique normalized name index separately, or map by phone/JID when available.
- **Estimated effort**: **Medium**

### 6) Secret accepted via URL query parameter in cron endpoint
- **Path/module**: `src/app/api/cron/sync-sheet/route.ts`
- **Problem**: `?secret=` authorization is accepted.
- **Why it matters**: Secrets can leak into logs, referrers, caches, browser history.
- **Severity**: **Medium**
- **Suggested fix**: Accept only `Authorization: Bearer` header and reject query-secret paths.
- **Estimated effort**: **Small**

### 7) Repeated ingestion/report notification flow is duplicated
- **Path/module**: `src/app/api/ingest/route.ts` and `src/app/api/whatsapp/process/route.ts`
- **Problem**: Near-identical email sending logic appears in multiple routes.
- **Why it matters**: Bugfix drift, inconsistent behavior, slower feature changes.
- **Severity**: **Medium**
- **Suggested fix**: Extract shared post-ingestion notifier service with typed contract + shared error handling.
- **Estimated effort**: **Small**

### 8) Route-level origin checks are not a strong security boundary
- **Path/module**: `src/app/api/sheet-sync/run/route.ts`
- **Problem**: `sameOrigin` checks `Origin/Referer`, but these headers are not a full auth mechanism.
- **Why it matters**: False sense of protection; requests from compromised origins or server-side callers can bypass intent.
- **Severity**: **Medium**
- **Suggested fix**: Use explicit user auth + CSRF strategy for browser-initiated writes.
- **Estimated effort**: **Small**

### 9) LLM extraction path lacks strong fallback circuit controls
- **Path/module**: `src/lib/ai.ts`
- **Problem**: Haiku->Sonnet fallback retries on errors, but no per-request timeout/circuit/rate guard in this module.
- **Why it matters**: Under upstream instability, latency/cost can spike and ingestion queues back up.
- **Severity**: **Medium**
- **Suggested fix**: Add timeouts, retry budget, and configurable fallback gates; emit model-specific failure metrics.
- **Estimated effort**: **Medium**

### 10) Observability is mostly console logs; weak production telemetry
- **Path/module**: Multiple (`src/app/api/*`, `src/lib/*`)
- **Problem**: Limited structured logs/metrics/traces; no explicit SLO dashboards or alert thresholds.
- **Why it matters**: Hard to detect regressions (dedup failures, ingest latency, sheet sync lag, WhatsApp disconnect patterns).
- **Severity**: **Medium**
- **Suggested fix**: Add structured logger, request IDs, metric counters/histograms, and error taxonomy.
- **Estimated effort**: **Large**

### 11) Prisma client instantiated without tuned pool/runtime safeguards
- **Path/module**: `src/lib/db.ts`
- **Problem**: Standard singleton setup is fine for dev, but no explicit pool sizing/timeout guardrails for prod bursts.
- **Why it matters**: Saturation under concurrent ingestion/jobs can cause latency spikes or connection churn.
- **Severity**: **Low**
- **Suggested fix**: Set DB pool params in `DATABASE_URL` and monitor wait/timeout metrics.
- **Estimated effort**: **Small**

### 12) Test coverage skewed toward pipeline/baileys; gaps in API security and failure modes
- **Path/module**: `tests/*`
- **Problem**: Existing tests are strong in parsing/dedup paths but light on auth, cron security, and integration failure paths (sheet partial write, timezone boundary).
- **Why it matters**: High-impact production failures likely to escape CI.
- **Severity**: **Medium**
- **Suggested fix**: Add API contract tests + integration tests for auth rejection, idempotency, and timezone day rollover.
- **Estimated effort**: **Medium**


### 13) Business KPI definitions are implicit (not codified)
- **Path/module**: Cross-cutting (dashboard/report aggregation and summary generation).
- **Problem**: Metrics like “high-interest school”, “underperforming rep”, and follow-up urgency are not clearly codified as versioned rules.
- **Why it matters**: Managers may see inconsistent KPI interpretations over time; trust and adoption drops if business definitions drift.
- **Severity**: **Medium**
- **Suggested fix**: Define KPI rule registry (versioned constants + documentation + tests), and surface active rule versions in reports.
- **Estimated effort**: **Medium**

## Quick wins (under 1 hour)

1. Remove query-param secret support from cron sync endpoint.
2. Extract shared notification function used by both ingest routes.
3. Add hard cap constants for in-memory message/history buffers.
4. Add a lint/check rule for unauthenticated POST/PATCH routes.
5. Add structured log fields (`route`, `runId`, `date`, `model`, `tokens`) to critical paths.

## Larger refactors worth considering

1. Introduce a unified **IngestionService** pipeline orchestration layer (API routes become thin transport adapters).
2. Create **authz middleware** for all API writes with role-based policy.
3. Replace in-memory Baileys capture with durable queue/table + worker consumer.
4. Implement sheet sync idempotency with visit-ID keyed upsert semantics.
5. Centralize timezone/day-window utility used across all date queries.

## Missing tests / observability gaps

- Unauthorized access tests for every non-GET route.
- Day-boundary tests for business timezone (e.g., just before/after midnight).
- Sync-sheet duplicate prevention test when DB mark step fails.
- Backpressure tests for large WhatsApp history loads.
- Metrics for: ingest latency p50/p95, extraction failures by model, dedup rate, sync lag, reconnect attempts, and alert volume.

## AI-assisted automation opportunities

1. CI bot that comments on PRs introducing unauthenticated mutable API routes.
2. Automated prompt-regression harness for extraction schema drift/cost tracking.
3. Nightly anomaly detection over ingestion metrics (token spikes, dedup drops, missing summaries).
4. Auto-generated runbooks from structured incident logs.
