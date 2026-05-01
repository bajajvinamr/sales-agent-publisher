# Codebase Walkthrough

This document gives a fast orientation of the `sales-agent-publisher` repository.

## 0) Business use case (operator reality)

- Team size: typically **10–50 field reps**.
- Daily traffic: **50–200 WhatsApp messages** across the sales group.
- Rep behavior: free-form natural language updates (no structured app usage).
- Core promise: capture group activity automatically and convert it into manager-ready intelligence by **8:00 PM IST**.
- Outputs expected each day: structured visit rows, rep performance status, hot/blocked school signals, and manager-facing WhatsApp summary.

This context should guide technical choices: optimize for noisy text, timezone-correct daily cutoffs (IST), reliability of unattended nightly runs, and low-friction workflows that require zero rep training.

## 1) Product purpose

This app ingests WhatsApp sales updates, extracts structured school-visit data with AI, stores it in PostgreSQL via Prisma, and presents dashboard/reporting views with export + alerting.

## 2) Top-level architecture

- **Frontend (Next.js App Router)**: route pages under `src/app/*` for dashboard, reports, settings, schools, and status.
- **Backend API routes**: `src/app/api/*` handles ingest, reporting, cron, settings, dashboards, WhatsApp, and Google Sheet sync operations.
- **Core domain logic**: `src/lib/pipeline/*` for preprocessing, validation, orchestration, school matching, export, and tests.
- **Integrations**:
  - Anthropic model calls via `src/lib/ai.ts`
  - WhatsApp/Baileys in `src/lib/whatsapp-baileys.ts`
  - Email/Resend via `src/lib/email.ts`
  - Google Sheets integration in `src/lib/integrations/google-sheets.ts`
- **Persistence**: Prisma schema in `prisma/schema.prisma`.

## 3) Important directories

- `src/app/` — app pages + API routes.
- `src/components/ui/` — reusable UI components.
- `src/lib/` — backend helpers and pipeline logic.
- `prisma/` — DB schema + seed scripts.
- `tests/` — Vitest tests for pipeline/orchestrator/WhatsApp behaviors.
- `docs/` — plans, retros, and ticket notes.

## 4) Request/data flow (high-level)

1. User uploads WhatsApp export (Connect flow).
2. Ingest route parses/filters/chunks content.
3. Pipeline extracts visits and validates fields.
4. School matcher links/normalizes schools.
5. Visit + alert records are persisted.
6. Dashboard/report endpoints aggregate by date/executive/target status.
7. Optional outbound notifications (email/WhatsApp) and Google Sheet sync.
8. Manager receives final summary report aligned to IST-day business cadence.

## 5) Data model highlights

Key Prisma models:

- `Executive`: sales rep metadata + targets.
- `School`: canonical school identity and enrichment fields.
- `Visit`: extracted visit row (includes dedup hash and data completeness fields).
- `Alert`: operational alerts (missing data, target misses, etc.).
- `DailySummary`: aggregate day-level summary.
- `IngestionRun`: pipeline telemetry for each run.
- `Settings`: singleton app/integration config.

## 6) Useful operational commands

- `npm run dev` — local development.
- `npm run build` — production build.
- `npm run typecheck` — TypeScript validation.
- `npm run lint` — linting.
- `npm run pipeline:test` — pipeline script test run.
- `npx vitest` — test suite.

## 7) Where to start when modifying behavior

- **Pipeline extraction/validation logic**: start in `src/lib/pipeline/orchestrator.ts`, then `preprocessor.ts`, `validator.ts`, `school-matcher.ts`.
- **Dashboard/report behavior**: inspect `src/app/api/dashboard/route.ts` and `src/app/api/reports/[date]/route.ts`.
- **Settings/config behavior**: inspect `src/app/api/settings/route.ts` and `src/app/settings/page.tsx`.
- **WhatsApp integration**: inspect routes in `src/app/api/whatsapp/*` + `src/lib/whatsapp-baileys.ts`.

## 8) Testing focus areas already covered

The current test suite emphasizes:

- orchestrator dedup/hash/cross-day behavior,
- WhatsApp dedup/date/jid/disconnect alert behavior,
- settings manager phone handling,
- cron phone extraction,
- excel export.

This should be a useful baseline map before deep feature work.
