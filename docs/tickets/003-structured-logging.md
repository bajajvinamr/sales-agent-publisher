# 003 — Structured logging with per-request IDs

**Milestone:** M2 — Observability layer
**Target date:** 2026-05-21

## Problem

Today's logs are `console.log` strings with no request ID, no level, no structure. When Prakhar says "my message didn't show up," there is no way to find it in the logs. Every investigation is a grep + guess exercise.

The retro identified observability as the missing compounding layer. Tests catch bugs we thought of; observability catches bugs we didn't.

This ticket introduces pino structured logging with a per-message request ID that threads through the ingest path from WhatsApp socket → parser → orchestrator → DB write. Any failure logs the ID; the ID is surfaced in error messages so a WhatsApp bug report can be mapped to a log entry.

## Success criterion

1. `pino` + `pino-pretty` (dev) + `pino-rotating-file` (prod, 500MB cap) installed
2. A `logger.ts` module with `child({ requestId })` helper used consistently
3. Every message ingested via `handleMessagesUpsert` gets a request ID (UUID v7 so it's time-sortable)
4. Log format is JSON in prod (UTC timestamp, level, requestId, module, msg, optional payload)
5. `docker compose logs app | jq 'select(.level=="error")'` works out of the box
6. Adding `console.log` triggers a CI warning (eslint `no-console` rule)

## Out of scope

- Central log aggregation (Loki, Datadog, etc.) — violates the solo-operator constraint. Droplet + `jq` is the ops interface for now.
- Distributed tracing. Overkill for single-node.
- Log-based alerting. That's ticket 004 (metrics endpoint); this is just the substrate.

## Edge cases

- Baileys emits internal log events. Silence or filter — we only want ours.
- Next.js server component rendering uses its own logger; don't double-log user-facing errors.
- Rotation must not block the event loop. Pino's transport is async by default; keep it that way.
- Disk full scenario: rotate must prefer dropping oldest over blocking writes.

## Verification

```bash
# Inject deliberately malformed message through /api/whatsapp/send-report (staging)
# Expect log entry with requestId, level=error, payload including raw message
docker compose logs app --tail 20 | jq 'select(.level=="error")'
```

Follow-up: ticket 004 adds `/api/metrics` endpoint computing `ingest_failure_ratio` from these logs.
