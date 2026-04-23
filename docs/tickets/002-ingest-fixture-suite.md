# 002 — Ingest fixture suite: regression tests for the 4 field bugs

**Milestone:** M1 — Test ratchet + lint ratchet
**Target date:** 2026-05-07

## Problem

PR #2 (commit `826d626`) fixed four bugs Prakhar + Nishkarsh reported:
1. Blank Employee/School Name in Excel (school/exec join mapping)
2. Team card click crash (date formatting)
3. Duplicate visits (missing upsert dedup key)
4. JID treated as employee (missing rawSender filter)

None have a regression test. If someone refactors any of those paths, the bugs silently return. The retro identified this as the structural gap: test the behavior, not the inline regex.

Ticket #002 seeds the `tests/ingest/` directory with fixture-based tests covering each of the four bug classes, using real-ish WhatsApp message shapes.

## Success criterion

1. `tests/ingest/` exists with ≥4 test files, each mapping 1:1 to a bug class from PR #2
2. Each test uses a fixture file under `tests/ingest/fixtures/` — raw WhatsApp message JSON + expected orchestrator output
3. `npm test` runs all fixtures; count grows from 3 → 12+ (3 per bug class minimum: happy path, failure mode, edge case)
4. Fixtures are checked in; no network or DB access in tests

## Out of scope

- Integration tests hitting Postgres. Too slow, too flaky for unit gate. Use mocks for Prisma client.
- Testing the Anthropic extraction prompt (non-deterministic; handle separately).
- E2E Playwright flow. Separate ticket later.

## Edge cases per bug class

### Bug 1 — Blank names in Excel
- Fixture: DB row with `executive.displayName = null`
- Fixture: DB row with `school.canonicalName = null` but `schoolNameRaw = 'Carmel'`
- Fixture: DB row with both null
- Expected: em-dash or raw fallback, never empty string or "undefined"

### Bug 2 — Team card crash on invalid date
- Fixture: team member with `lastActive = null`
- Fixture: team member with `lastActive = invalid Date object`
- Expected: renders "—" without throwing

### Bug 3 — Duplicate visits
- Fixture: same rep, same day, same message sent twice
- Fixture: same rep, same day, different messages (must both persist)
- Fixture: same message, different reps (must both persist)
- Expected: dedup only when `(executiveId, visitDate, rawTextHash)` tuple matches

### Bug 4 — JID treated as employee
- Fixture: message with `remoteJid = 120363012@g.us`, no pushName, no participant
- Fixture: message with `participant = 919876543210@s.whatsapp.net` (valid human)
- Fixture: message with `pushName = 'Prakhar'` (valid human)
- Expected: JID-only message filtered out; human senders processed

## Verification

```bash
npm test
# Expected: ≥ 12 tests passing, including new tests/ingest/ suite
```

Coverage target: touch every branch of the rawSender filter in `whatsapp-baileys.ts:508-510` and every fallback in `excel-export.ts:180-188`.
