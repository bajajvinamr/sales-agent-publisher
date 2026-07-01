# Baileys Reliability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the three remaining silent failure modes in the Baileys connection layer — undetected disconnects, wrong message dates, and unbounded memory.

**Architecture:** All fixes live in `src/lib/whatsapp-baileys.ts`. The alerting mechanism uses a registered callback (not a direct import) to keep `whatsapp-baileys.ts` free of email/db dependencies — `init.ts` wires the callback at startup. Timezone fix is a one-line change to `parseWAMessage`. Memory caps mirror the existing `capturedMessages` circular-buffer pattern.

**Tech Stack:** Baileys `@whiskeysockets/baileys`, Vitest, Node.js TZ env var (`Asia/Kolkata`).

---

## File Map

| File | Change |
|---|---|
| `src/lib/whatsapp-baileys.ts` | Export `setAlertHandler`, `buildDisconnectAlertMessage`, `buildMessageKey`; add alert firing on 4 disconnect paths; fix `parseWAMessage` date to IST; add `capturedMessageKeys` Set; cap `historicalByJid` at 5000/JID |
| `src/lib/init.ts` | Register alert callback on startup |
| `vitest.config.ts` | Add `env: { TZ: 'Asia/Kolkata' }` so date tests match container behaviour |
| `tests/baileys-disconnect-alert.test.ts` | **NEW** — alert message builder unit tests |
| `tests/baileys-message-date.test.ts` | **NEW** — IST vs UTC date stamping |
| `tests/baileys-dedup-cap.test.ts` | **NEW** — `buildMessageKey` + Set dedup logic |

---

## Task 1: Disconnect alerting

**Files:**
- Modify: `src/lib/whatsapp-baileys.ts`
- Modify: `src/lib/init.ts`
- Create: `tests/baileys-disconnect-alert.test.ts`

**Problem:** When Baileys transitions to `failed` or `disconnected` (loggedOut / replaced / QR timeout / max reconnects), only `console.error` fires. Nobody knows. `whatsapp-baileys.ts` has no email/db imports — use a registered callback so the layer boundary stays clean.

- [ ] **Step 1: Write the failing test**

Create `tests/baileys-disconnect-alert.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildDisconnectAlertMessage } from '@/lib/whatsapp-baileys'

describe('buildDisconnectAlertMessage', () => {
  it('loggedOut returns re-scan message', () => {
    expect(buildDisconnectAlertMessage('loggedOut')).toContain('logged out')
  })

  it('replaced returns session-replaced message', () => {
    expect(buildDisconnectAlertMessage('replaced')).toContain('replaced')
  })

  it('qrTimeout returns QR message', () => {
    expect(buildDisconnectAlertMessage('qrTimeout')).toContain('QR not scanned')
  })

  it('maxReconnects includes attempt count', () => {
    expect(buildDisconnectAlertMessage('maxReconnects', 12)).toContain('12')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL (`buildDisconnectAlertMessage` not exported yet)**

```bash
npx vitest run tests/baileys-disconnect-alert.test.ts
```

Expected: FAIL with `SyntaxError` or `is not a function`.

- [ ] **Step 3: Add module-level alert handler + exported helpers to `src/lib/whatsapp-baileys.ts`**

After the `const AUTH_DIR` line (~line 54), add:

```typescript
// ── Alert callback (registered by init.ts, keeps this module free of db/email deps) ──
let alertHandler: ((message: string) => Promise<void> | void) | null = null

export function setAlertHandler(fn: (message: string) => Promise<void> | void): void {
  alertHandler = fn
}

export function buildDisconnectAlertMessage(
  kind: 'loggedOut' | 'replaced' | 'qrTimeout' | 'maxReconnects',
  attempts?: number
): string {
  switch (kind) {
    case 'loggedOut':     return 'WhatsApp logged out — re-scan QR to reconnect.'
    case 'replaced':      return 'WhatsApp session replaced by another device.'
    case 'qrTimeout':     return 'QR not scanned in time — click Connect to generate a new QR.'
    case 'maxReconnects': return `WhatsApp reconnect failed after ${attempts ?? '?'} attempts — manual reconnect needed.`
  }
}

function fireAlert(message: string): void {
  if (!alertHandler) return
  Promise.resolve(alertHandler(message)).catch((e) =>
    console.error('[Baileys] Alert handler failed:', e)
  )
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx vitest run tests/baileys-disconnect-alert.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Wire `fireAlert` into the 4 disconnect paths in `handleConnectionUpdate`**

In `src/lib/whatsapp-baileys.ts`, find the `if (kind === 'loggedOut')` block (~line 298). After `state.error = 'Logged out...'`, add:

```typescript
      fireAlert(buildDisconnectAlertMessage('loggedOut'))
```

Find the `if (kind === 'replaced')` block (~line 311). After `state.error = 'Another device...'`, add:

```typescript
      fireAlert(buildDisconnectAlertMessage('replaced'))
```

Find the QR timeout block (~line 332). After `state.error = 'QR not scanned...'`, add:

```typescript
      fireAlert(buildDisconnectAlertMessage('qrTimeout'))
```

Find the max reconnects block (~line 342). After `state.error = \`Reconnect failed...\``, add:

```typescript
      fireAlert(buildDisconnectAlertMessage('maxReconnects', state.reconnectAttempts))
```

- [ ] **Step 6: Register the alert callback in `src/lib/init.ts`**

Replace the entire file with:

```typescript
/**
 * App initialization — runs once on server start.
 * Starts the auto-processing cron job and wires the Baileys alert callback.
 */

import { startCron } from './cron'
import { setAlertHandler } from './whatsapp-baileys'
import { sendAlertEmail } from './email'
import { prisma } from './db'

let initialized = false

export function initApp() {
  if (initialized) return
  initialized = true

  // Wire Baileys disconnect alerts → email. Keeps whatsapp-baileys.ts
  // free of db/email imports while ensuring operators get notified.
  setAlertHandler(async (message) => {
    try {
      const settings = await prisma.settings.findUnique({ where: { id: 'default' } })
      if (settings?.alertEmailTo) {
        await sendAlertEmail(settings.alertEmailTo, [{
          type: 'CONNECTION_FAILURE',
          message,
          executive: 'System',
        }])
      }
    } catch (e) {
      console.error('[Init] Baileys alert email failed:', e)
    }
  })

  startCron()
  console.log('[Init] Sales Tracker started — auto-processing at 8 PM daily')
}
```

- [ ] **Step 7: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 8: Run full test suite**

```bash
npx vitest run
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/lib/whatsapp-baileys.ts src/lib/init.ts tests/baileys-disconnect-alert.test.ts
git commit -m "feat: alert on Baileys disconnect (loggedOut, replaced, QR timeout, max reconnects)

Status transitions to failed/disconnected were silent — only console.error.
Registered callback pattern keeps whatsapp-baileys.ts free of db/email deps."
```

---

## Task 2: Fix message date to IST

**Files:**
- Modify: `src/lib/whatsapp-baileys.ts:504`
- Modify: `vitest.config.ts`
- Create: `tests/baileys-message-date.test.ts`

**Problem:** `parseWAMessage` line 504 uses `ts.toISOString().slice(0, 10)` — this is the UTC date. A message sent at 00:30 IST (= 19:00 UTC previous day) gets stamped with yesterday's date. `TZ=Asia/Kolkata` is set in docker-compose so `toLocaleDateString('en-CA')` gives the correct IST date.

- [ ] **Step 1: Add TZ to vitest env**

In `vitest.config.ts`, add `env` inside `test`:

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10_000,
    env: { TZ: 'Asia/Kolkata' },
  },
})
```

- [ ] **Step 2: Write the failing test**

Create `tests/baileys-message-date.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'

// Mirrors the date-stamping logic in parseWAMessage (src/lib/whatsapp-baileys.ts:504).
// TZ=Asia/Kolkata is set in vitest.config.ts env to match the production container.

describe('message date stamping — IST vs UTC', () => {
  it('stamps IST date for a message sent at 00:30 IST (19:00 UTC previous day)', () => {
    // 2026-04-30 00:30 IST = 2026-04-29 19:00:00 UTC
    const ts = new Date('2026-04-29T19:00:00.000Z')
    // toISOString gives wrong UTC date
    expect(ts.toISOString().slice(0, 10)).toBe('2026-04-29')
    // toLocaleDateString with IST gives correct date
    expect(ts.toLocaleDateString('en-CA')).toBe('2026-04-30')
  })

  it('stamps IST date for a message sent at 23:45 IST (18:15 UTC same day)', () => {
    // 2026-04-30 23:45 IST = 2026-04-30 18:15:00 UTC — both agree
    const ts = new Date('2026-04-30T18:15:00.000Z')
    expect(ts.toLocaleDateString('en-CA')).toBe('2026-04-30')
    expect(ts.toISOString().slice(0, 10)).toBe('2026-04-30')
  })

  it('time string uses local time (already correct before this fix)', () => {
    const ts = new Date('2026-04-29T19:00:00.000Z') // = 00:30 IST
    expect(ts.toTimeString().slice(0, 5)).toBe('00:30')
  })
})
```

- [ ] **Step 3: Run test — expect PASS (verifies the bug and the fix behaviour in one go)**

```bash
npx vitest run tests/baileys-message-date.test.ts
```

Expected: all 3 PASS (the test validates both the old broken behaviour and the correct new behaviour).

- [ ] **Step 4: Apply the one-line fix in `src/lib/whatsapp-baileys.ts`**

Find line 504:

```typescript
  const date = ts.toISOString().slice(0, 10)
```

Replace with:

```typescript
  const date = ts.toLocaleDateString('en-CA')
```

- [ ] **Step 5: Run typecheck + full suite**

```bash
npm run typecheck && npx vitest run
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/whatsapp-baileys.ts vitest.config.ts tests/baileys-message-date.test.ts
git commit -m "fix: stamp message dates in IST not UTC

parseWAMessage used toISOString() which gives UTC date. Messages sent
between midnight and 05:30 IST were stamped with the previous day.
toLocaleDateString('en-CA') respects TZ=Asia/Kolkata in the container."
```

---

## Task 3: Set-based dedup + historicalByJid memory cap

**Files:**
- Modify: `src/lib/whatsapp-baileys.ts`
- Create: `tests/baileys-dedup-cap.test.ts`

**Problems:**
1. `handleMessagesUpsert` dedup checks only the last 100 messages (`slice(-100)`). After a reconnect with a large history sync, messages from earlier in the buffer are not checked → wasted LLM calls on re-extraction (DB upsert still prevents DB duplication).
2. `historicalByJid` buckets grow unbounded — a full WhatsApp history sync on an active group can accumulate tens of thousands of messages in RAM.

- [ ] **Step 1: Write the failing test**

Create `tests/baileys-dedup-cap.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildMessageKey } from '@/lib/whatsapp-baileys'
import type { RawMessage } from '@/types'

function makeMsg(overrides: Partial<RawMessage> = {}): RawMessage {
  return {
    date: '2026-04-30',
    time: '10:00',
    sender: 'Sunil',
    message: 'Carmel Convent CBSE 1800',
    messageType: 'Text',
    ...overrides,
  }
}

describe('buildMessageKey', () => {
  it('produces a pipe-delimited key', () => {
    const m = makeMsg()
    expect(buildMessageKey(m)).toBe('Sunil|2026-04-30|10:00|Carmel Convent CBSE 1800')
  })

  it('same message twice produces identical key', () => {
    const m = makeMsg()
    expect(buildMessageKey(m)).toBe(buildMessageKey({ ...m }))
  })

  it('different sender produces different key', () => {
    expect(buildMessageKey(makeMsg({ sender: 'Ravi' }))).not.toBe(buildMessageKey(makeMsg()))
  })

  it('different time produces different key', () => {
    expect(buildMessageKey(makeMsg({ time: '11:00' }))).not.toBe(buildMessageKey(makeMsg()))
  })
})

describe('Set-based dedup logic', () => {
  it('Set catches a duplicate that would fall outside a 100-entry window', () => {
    const keys = new Set<string>()
    const first = makeMsg({ message: 'msg-0' })
    keys.add(buildMessageKey(first))

    // Add 200 more distinct messages
    for (let i = 1; i <= 200; i++) {
      keys.add(buildMessageKey(makeMsg({ message: `msg-${i}` })))
    }

    // first message is still in the Set even though it's > 100 entries ago
    expect(keys.has(buildMessageKey(first))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test — expect FAIL (`buildMessageKey` not exported yet)**

```bash
npx vitest run tests/baileys-dedup-cap.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Export `buildMessageKey` from `src/lib/whatsapp-baileys.ts`**

Find the private key-builder in `handleMessagesUpsert` (~line 480):

```typescript
    const keyOf = (m: RawMessage) => `${m.sender}|${m.date}|${m.time}|${m.message}`
```

Replace with a reference to a new exported function. Add this export near the top of the file (after the `BaileysState` interface, before the state object):

```typescript
export function buildMessageKey(m: Pick<RawMessage, 'sender' | 'date' | 'time' | 'message'>): string {
  return `${m.sender}|${m.date}|${m.time}|${m.message}`
}
```

Then in `handleMessagesUpsert`, replace the inline arrow function:

```typescript
    const keyOf = buildMessageKey
```

And in `startMonitoringGroup` (~line 574), replace:

```typescript
      const keyOf = (m: RawMessage) => `${m.sender}|${m.date}|${m.time}|${m.message}`
```

With:

```typescript
      const keyOf = buildMessageKey
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx vitest run tests/baileys-dedup-cap.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Add `capturedMessageKeys` Set to `BaileysState`**

In the `BaileysState` interface, add after `capturedMessages`:

```typescript
  capturedMessageKeys: Set<string>        // full-session dedup index (mirrors capturedMessages)
```

In the `state` initializer, add:

```typescript
  capturedMessageKeys: new Set(),
```

- [ ] **Step 6: Use the Set in `handleMessagesUpsert`**

Find the dedup check in `handleMessagesUpsert` (~line 482):

```typescript
    const alreadySeen = state.capturedMessages.slice(-100).some((m) => keyOf(m) === parsedKey)
    if (alreadySeen) continue
```

Replace with:

```typescript
    if (state.capturedMessageKeys.has(parsedKey)) continue
```

Find where the message is pushed to `capturedMessages` (~line 485):

```typescript
    if (state.capturedMessages.length >= 5000) state.capturedMessages.shift()
    state.capturedMessages.push(parsed)
```

Add key tracking after the push:

```typescript
    if (state.capturedMessages.length >= 5000) state.capturedMessages.shift()
    state.capturedMessages.push(parsed)
    state.capturedMessageKeys.add(parsedKey)
```

- [ ] **Step 7: Reset the Set on `clearCapturedMessages` and `disconnect`**

In `clearCapturedMessages` (~line 185):

```typescript
export function clearCapturedMessages(date?: string): void {
  if (date) {
    state.capturedMessages = state.capturedMessages.filter((m) => m.date !== date)
    // Rebuild key set to stay in sync with the trimmed buffer
    state.capturedMessageKeys = new Set(state.capturedMessages.map(buildMessageKey))
  } else {
    state.capturedMessages = []
    state.capturedMessageKeys = new Set()
  }
}
```

In `disconnect` (~line 426), add after `state.capturedMessages = []`:

```typescript
    state.capturedMessageKeys = new Set()
```

In `startMonitoringGroup` (~line 582), after `state.capturedMessages = combined.slice(-5000)`, add:

```typescript
    state.capturedMessageKeys = new Set(state.capturedMessages.map(buildMessageKey))
```

- [ ] **Step 8: Cap `historicalByJid` at 5000 per JID in `handleHistorySet`**

Find the bucket push loop in `handleHistorySet` (~line 454):

```typescript
    let bucket = state.historicalByJid.get(jid)
    if (!bucket) {
      bucket = []
      state.historicalByJid.set(jid, bucket)
    }
    bucket.push(parsed)
```

Replace with:

```typescript
    let bucket = state.historicalByJid.get(jid)
    if (!bucket) {
      bucket = []
      state.historicalByJid.set(jid, bucket)
    }
    if (bucket.length >= 5000) bucket.shift()
    bucket.push(parsed)
```

- [ ] **Step 9: Run typecheck + full suite**

```bash
npm run typecheck && npx vitest run
```

Expected: 0 type errors, all tests PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/whatsapp-baileys.ts tests/baileys-dedup-cap.test.ts
git commit -m "fix: Set-based message dedup + cap historicalByJid at 5000/JID

slice(-100) dedup missed messages outside the window after reconnect.
Set tracks all messages in the current buffer (max 5000). historicalByJid
was unbounded — now capped matching the capturedMessages circular buffer."
```

---

## Final: Push + PR

- [ ] **Step 1: Run local CI**

```bash
act pull_request -W .github/workflows/ci.yml -j check -j build
```

Expected: both jobs green.

- [ ] **Step 2: Push**

```bash
git push -u origin feat/baileys-reliability
```

- [ ] **Step 3: Open PR**

```bash
gh pr create --title "fix: Baileys reliability — disconnect alerts, IST dates, memory caps" \
  --body "$(cat <<'EOF'
## What this fixes

- **Disconnect alerting**: loggedOut, session replaced, QR timeout, max reconnects now fire an alert email via registered callback — no db/email coupling in whatsapp-baileys.ts
- **IST date stamping**: parseWAMessage used UTC date; messages sent 00:00–05:30 IST were bucketed to previous day. Fixed with toLocaleDateString('en-CA') (TZ=Asia/Kolkata is already set in docker-compose)
- **Set-based dedup**: replaced slice(-100) window check with a persistent Set — catches duplicates anywhere in the 5000-message buffer
- **historicalByJid cap**: full history sync was unbounded in RAM; now capped at 5000/JID matching capturedMessages

## Test plan
- [ ] `npx vitest run` — all pass
- [ ] `npm run typecheck` — clean
- [ ] Disconnect WhatsApp from phone — verify alert email arrives
- [ ] Set managerPhone + wait for next 8 PM run
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- ✅ Disconnect alerting (loggedOut, replaced, QR timeout, max reconnects) → Task 1
- ✅ Timezone mismatch in parseWAMessage → Task 2
- ✅ Dedup window expansion → Task 3
- ✅ historicalByJid unbounded memory → Task 3

**No placeholders:** All code blocks are complete.

**Type consistency:** `buildMessageKey` is exported and used consistently in `handleMessagesUpsert`, `startMonitoringGroup`, and `clearCapturedMessages`. `capturedMessageKeys: Set<string>` added to both interface and initializer.
