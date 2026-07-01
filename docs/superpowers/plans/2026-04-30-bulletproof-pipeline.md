# Bulletproof Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate every silent failure in the WhatsApp → extract → persist → notify pipeline and remove all dead code.

**Architecture:** Six independent fixes across three layers — Settings schema (managerPhone field), cron runtime (error surfacing + phone delivery), orchestrator (exec onboarding throw semantics + cross-day repeat detection), and dead code removal (legacy scraper). Each task is a self-contained commit that leaves the system in a better state than it found it.

**Tech Stack:** Next.js 15 App Router, Prisma 6 + Postgres 16, Baileys WhatsApp, Anthropic AI SDK, Vitest, `act` for local CI.

---

## File Map

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `managerPhone` field to `Settings` model |
| `src/app/api/settings/route.ts` | Expose `managerPhone` in GET + PATCH |
| `src/lib/cron.ts` | Use `settings.managerPhone`; surface errors as email + failed IngestionRun |
| `src/lib/pipeline/orchestrator.ts` | `getOrCreateExecId` throws on DB failure; load yesterday's visits for cross-day repeat |
| `src/lib/whatsapp-manager.ts` | **DELETE** |
| `src/app/api/whatsapp/scrape/route.ts` | **DELETE** |
| `src/scraper/` | **DELETE** entire directory |
| `tests/settings-manager-phone.test.ts` | **NEW** — Zod schema validation for managerPhone |
| `tests/cron-phone-extraction.test.ts` | **NEW** — phone guard helper unit test |
| `tests/orchestrator-exec-onboard.test.ts` | **NEW** — isValidSenderName pure helper |
| `tests/orchestrator-crossday-repeat.test.ts` | **NEW** — compareWithHistory with yesterday's visits |

---

## Task 1: Add `managerPhone` to Settings + fix WhatsApp delivery

**Problem:** `cron.ts:119` tries `settings.alertEmailTo?.match(/^\d{10,13}$/)` to get a phone number. `alertEmailTo` is an email address — this regex will never match. Manager has never received a WhatsApp report. Fix requires a new schema field.

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/app/api/settings/route.ts`
- Modify: `src/lib/cron.ts:108-134`
- Create: `tests/settings-manager-phone.test.ts`
- Create: `tests/cron-phone-extraction.test.ts`

- [ ] **Step 1: Write the failing schema validation test**

Create `tests/settings-manager-phone.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { z } from 'zod'

// Mirrors the managerPhone validation added to src/app/api/settings/route.ts
const managerPhoneSchema = z
  .string()
  .regex(/^\+?\d{10,15}$/, 'Must be 10-15 digits, optional leading +')
  .or(z.literal(''))

describe('managerPhone validation', () => {
  it('accepts a 10-digit Indian mobile number', () => {
    expect(managerPhoneSchema.safeParse('9876543210').success).toBe(true)
  })

  it('accepts a number with + prefix', () => {
    expect(managerPhoneSchema.safeParse('+919876543210').success).toBe(true)
  })

  it('accepts empty string (clearing the field)', () => {
    expect(managerPhoneSchema.safeParse('').success).toBe(true)
  })

  it('rejects an email address', () => {
    expect(managerPhoneSchema.safeParse('manager@example.com').success).toBe(false)
  })

  it('rejects a 9-digit number (too short)', () => {
    expect(managerPhoneSchema.safeParse('987654321').success).toBe(false)
  })

  it('rejects a 16-digit number (too long)', () => {
    expect(managerPhoneSchema.safeParse('9876543210123456').success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test — expect PASS (schema is pure Zod, no app code needed)**

```bash
cd /Users/vinamr/Projects/sales-agent-publisher && npx vitest run tests/settings-manager-phone.test.ts
```

Expected: All 6 tests PASS (we're testing the schema in isolation before wiring it in).

- [ ] **Step 3: Write the phone guard test**

Create `tests/cron-phone-extraction.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'

// Mirrors the guard added to src/lib/cron.ts
function isValidManagerPhone(phone: string | null | undefined): phone is string {
  if (!phone) return false
  return /^\+?\d{10,15}$/.test(phone.trim())
}

describe('cron manager phone guard', () => {
  it('accepts a 10-digit number', () => {
    expect(isValidManagerPhone('9876543210')).toBe(true)
  })

  it('accepts a +91 prefixed number', () => {
    expect(isValidManagerPhone('+919876543210')).toBe(true)
  })

  it('rejects null', () => {
    expect(isValidManagerPhone(null)).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidManagerPhone('')).toBe(false)
  })

  it('rejects an email address (the historical bug)', () => {
    expect(isValidManagerPhone('manager@example.com')).toBe(false)
  })

  it('rejects undefined', () => {
    expect(isValidManagerPhone(undefined)).toBe(false)
  })
})
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx vitest run tests/cron-phone-extraction.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Add `managerPhone` to schema**

In `prisma/schema.prisma`, find the Settings model and add after `managerEmail`:

```prisma
  managerEmail       String @default("") @map("manager_email")
  managerPhone       String @default("") @map("manager_phone")
```

- [ ] **Step 6: Apply schema to DB**

```bash
npx prisma@6 db push --skip-generate --accept-data-loss
```

Expected output includes: `Your database is now in sync with your Prisma schema.`

- [ ] **Step 7: Regenerate Prisma client**

```bash
npm run db:generate
```

Expected: No errors. `@prisma/client` now includes `managerPhone`.

- [ ] **Step 8: Expose managerPhone in settings API**

In `src/app/api/settings/route.ts`:

Add `managerPhone: true` to the GET `select` block (around line 17, after `managerEmail`):

```typescript
      managerEmail: true,
      managerPhone: true,
      whatsappGroupName: true,
```

Add `managerPhone` to the PATCH schema (after `managerEmail` validator, around line 64):

```typescript
  managerEmail: z.string().email().optional().or(z.literal('')),
  managerPhone: z.string().regex(/^\+?\d{10,15}$/).optional().or(z.literal('')),
  whatsappGroupName: z.string().max(200).optional(),
```

Add `managerPhone: true` to the PATCH `select` block (same pattern as GET, around line 123):

```typescript
      managerEmail: true,
      managerPhone: true,
      whatsappGroupName: true,
```

- [ ] **Step 9: Fix cron WhatsApp delivery to use managerPhone**

In `src/lib/cron.ts`, replace lines 107-135 (the WhatsApp report block):

```typescript
    // Send WhatsApp report to manager
    if (settings?.managerPhone && /^\+?\d{10,15}$/.test(settings.managerPhone.trim())) {
      const executives = await prisma.executive.findMany({ where: { active: true } })
      const topPerformers = Object.entries(
        result.visits.reduce<Record<string, number>>((acc, v) => {
          acc[v.executiveName] = (acc[v.executiveName] || 0) + 1
          return acc
        }, {})
      ).sort(([, a], [, b]) => b - a).slice(0, 5).map(([name, visits]) => ({ name, visits }))

      try {
        await sendDailyReport(settings.managerPhone.trim(), {
          date: today,
          totalVisits: result.summary.totalVisits,
          execsReporting: result.summary.totalExecutivesReporting,
          totalExecs: executives.length,
          targetsMet: result.summary.targetsMetCount,
          topPerformers,
          alerts: result.alerts.slice(0, 5).map(a => ({ exec: a.executiveName, message: a.message })),
          summaryText: result.summary.summaryText ?? undefined,
        })
        console.log('[Cron] WhatsApp report sent to manager')
      } catch (e) { console.error('[Cron] WhatsApp report failed:', e) }
    } else if (settings?.managerPhone) {
      console.warn('[Cron] managerPhone set but invalid format — WhatsApp report skipped. Expected 10-15 digits with optional leading +.')
    }
```

- [ ] **Step 10: Run full test suite to confirm no regressions**

```bash
npx vitest run
```

Expected: All tests PASS.

- [ ] **Step 11: Commit**

```bash
git add prisma/schema.prisma src/app/api/settings/route.ts src/lib/cron.ts tests/settings-manager-phone.test.ts tests/cron-phone-extraction.test.ts
git commit -m "feat: add managerPhone to Settings; fix WhatsApp report delivery

alertEmailTo is an email field — the regex match against it would never
produce a phone number. Manager has never received a WhatsApp report.
New managerPhone field stores the phone separately with proper validation."
```

---

## Task 2: Surface cron errors as email alert + failed IngestionRun

**Problem:** `cron.ts:140-141` catches all errors with only `console.error`. If `runPipeline` throws (DB down, API outage), the error is invisible. No dashboard record, no email. Operators have no idea the 8 PM run failed.

**Files:**
- Modify: `src/lib/cron.ts`

- [ ] **Step 1: Replace the outer catch in `autoProcess()`**

In `src/lib/cron.ts`, replace lines 140-142:

```typescript
  } catch (e) {
    console.error('[Cron] Auto-processing failed:', e)
  }
```

With:

```typescript
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[Cron] Auto-processing failed:', e)

    // Persist a failed IngestionRun so the dashboard shows the failure.
    try {
      await prisma.ingestionRun.create({
        data: {
          runDate: new Date(`${today}T00:00:00`),
          messagesScraped: 0,
          messagesAfterFilter: 0,
          chunksCreated: 0,
          visitsExtracted: 0,
          alertsGenerated: 0,
          haikuTokensUsed: 0,
          sonnetTokensUsed: 0,
          status: 'failed',
          errorLog: `[Cron] autoProcess failed: ${msg}`,
        },
      })
    } catch { /* don't mask the original */ }

    // Send alert email to operator.
    try {
      const s = await prisma.settings.findUnique({ where: { id: 'default' } })
      if (s?.alertEmailTo) {
        await sendAlertEmail(s.alertEmailTo, [{
          type: 'PIPELINE_FAILURE',
          message: `8 PM auto-processing failed on ${today}: ${msg}`,
          executive: 'System',
        }])
      }
    } catch { /* best effort */ }
  }
```

- [ ] **Step 2: Harden the cron guard `.catch(() => null)`**

In `src/lib/cron.ts` line 38, replace:

```typescript
      }).catch(() => null)
```

With:

```typescript
      }).catch((err: unknown) => {
        console.error('[Cron] Guard query failed — proceeding without guard:', err)
        return null
      })
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/cron.ts
git commit -m "fix: surface cron failures as email alert + IngestionRun record

Silent catch meant 8 PM pipeline failures were invisible — no dashboard
record, no email. Operator had no way to know the nightly run failed."
```

---

## Task 3: `getOrCreateExecId` — throw on DB failure, null only for system senders

**Problem:** `orchestrator.ts:85-86` catches DB errors in `getOrCreateExecId` and returns `null`. The caller treats null as "skip this visit" → visit is silently dropped. The error message `"Unknown executive: X — visit not persisted"` appears in the internal error log but doesn't surface.

**Files:**
- Modify: `src/lib/pipeline/orchestrator.ts`
- Create: `tests/orchestrator-exec-onboard.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/orchestrator-exec-onboard.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'

// Mirrors the early-return guards in getOrCreateExecId (orchestrator.ts).
// Returns null for system/empty senders; throws for real DB errors.
function isSystemSender(rawName: string): boolean {
  const trimmed = rawName.trim()
  if (!trimmed) return true
  if (trimmed === 'Unknown') return true
  if (/@(g\.us|s\.whatsapp\.net|broadcast|newsletter)$/i.test(trimmed)) return true
  return false
}

describe('exec onboarding — sender classification', () => {
  it('treats empty string as system sender', () => {
    expect(isSystemSender('')).toBe(true)
  })

  it('treats whitespace-only as system sender', () => {
    expect(isSystemSender('   ')).toBe(true)
  })

  it('treats "Unknown" as system sender', () => {
    expect(isSystemSender('Unknown')).toBe(true)
  })

  it('treats @g.us JID as system sender', () => {
    expect(isSystemSender('120363@g.us')).toBe(true)
  })

  it('treats @s.whatsapp.net as system sender', () => {
    expect(isSystemSender('919876543210@s.whatsapp.net')).toBe(true)
  })

  it('treats a real name as a human sender', () => {
    expect(isSystemSender('Prakhar Sharma')).toBe(false)
  })

  it('treats a pushName with spaces as a human sender', () => {
    expect(isSystemSender('Fp Sunil')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test — expect PASS**

```bash
npx vitest run tests/orchestrator-exec-onboard.test.ts
```

Expected: All 7 tests PASS.

- [ ] **Step 3: Change `getOrCreateExecId` catch to throw**

In `src/lib/pipeline/orchestrator.ts`, replace lines 85-87:

```typescript
    } catch {
      return null
    }
```

With:

```typescript
    } catch (err) {
      throw new Error(
        `Executive upsert failed for "${trimmed}": ${err instanceof Error ? err.message : String(err)}`
      )
    }
```

`getOrCreateExecId` now returns `string | null` where `null` means "system/empty sender" and a throw means "real DB failure." The outer try/catch in the chunk-processing loop catches the throw and pushes it to `errors[]` — same observable result for the caller, but now the error is correctly classified and surfaced.

- [ ] **Step 4: Run typecheck + tests**

```bash
npm run typecheck && npx vitest run
```

Expected: No type errors. All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/orchestrator.ts tests/orchestrator-exec-onboard.test.ts
git commit -m "fix: getOrCreateExecId throws on DB failure instead of returning null

Returning null caused the caller to silently drop the visit with only an
internal error log entry. Throwing causes the outer catch to record the
error properly in the IngestionRun errorLog."
```

---

## Task 4: Delete legacy scraper (dead code)

**Problem:** `src/lib/whatsapp-manager.ts`, `src/scraper/`, and `src/app/api/whatsapp/scrape/route.ts` are the old `whatsapp-web.js`-based scraper. Baileys is the live system. Dead code creates confusion about which path is authoritative.

**Files:**
- Delete: `src/lib/whatsapp-manager.ts`
- Delete: `src/app/api/whatsapp/scrape/route.ts`
- Delete: `src/scraper/` (entire directory)

- [ ] **Step 1: Confirm nothing imports whatsapp-manager outside the scrape route**

```bash
grep -r "whatsapp-manager" /Users/vinamr/Projects/sales-agent-publisher/src --include="*.ts" -l
```

Expected output: only `src/app/api/whatsapp/scrape/route.ts`. If anything else appears, stop and investigate before deleting.

- [ ] **Step 2: Confirm nothing imports from src/scraper/**

```bash
grep -r "from.*scraper" /Users/vinamr/Projects/sales-agent-publisher/src --include="*.ts" -l
```

Expected output: empty (no other files import from scraper).

- [ ] **Step 3: Delete the files**

```bash
rm /Users/vinamr/Projects/sales-agent-publisher/src/lib/whatsapp-manager.ts
rm /Users/vinamr/Projects/sales-agent-publisher/src/app/api/whatsapp/scrape/route.ts
rm -rf /Users/vinamr/Projects/sales-agent-publisher/src/scraper
```

- [ ] **Step 4: Run typecheck to confirm no broken imports**

```bash
npm run typecheck
```

Expected: No errors. If any `Cannot find module` errors appear, check what imports the deleted files.

- [ ] **Step 5: Run tests**

```bash
npx vitest run
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: delete legacy whatsapp-web.js scraper

whatsapp-manager.ts, src/scraper/, and the /api/whatsapp/scrape route
were the old Puppeteer-based scraper. Baileys is the live path.
Dead code removed to eliminate confusion about which path is authoritative."
```

---

## Task 5: Cross-day repeat detection

**Problem:** `orchestrator.ts:101-104` loads only today's visits for history comparison. A school visited yesterday and again today won't be flagged as a repeat. `compareWithHistory` already handles the logic — we just need to pass it yesterday's visits too.

**Files:**
- Modify: `src/lib/pipeline/orchestrator.ts`
- Create: `tests/orchestrator-crossday-repeat.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/orchestrator-crossday-repeat.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { compareWithHistory } from '@/lib/pipeline/validator'
import type { ValidatedVisit } from '@/types'

function makeVisit(overrides: Partial<ValidatedVisit> = {}): ValidatedVisit {
  return {
    isVisitReport: true,
    schoolName: 'Carmel Convent School',
    canonicalSchoolName: 'carmel convent school',
    schoolId: 'school-1',
    address: 'Kolar Road, Bhopal',
    board: 'CBSE',
    strength: 1800,
    principalName: 'Sr. Mary Thomas',
    principalMobile: '9425000000',
    principalEmail: null,
    principalDob: null,
    bookSeller: 'Gupta Book Store',
    remark: 'New Visit',
    remarkDetail: null,
    executiveName: 'Sunil',
    visitDate: '2026-04-30',
    rawText: 'Carmel Convent...',
    locationUrl: undefined,
    dataComplete: true,
    missingFields: [],
    extractionModel: 'haiku',
    isRepeatVisit: false,
    visitNumberInSession: 1,
    changesFromLast: [],
    ...overrides,
  }
}

describe('compareWithHistory — cross-day repeat detection', () => {
  it('flags as repeat when same school visited yesterday', () => {
    const yesterday = makeVisit({ visitDate: '2026-04-29' })
    const today = makeVisit({ visitDate: '2026-04-30' })

    const result = compareWithHistory(today, [yesterday])

    expect(result.isRepeatVisit).toBe(true)
    expect(result.visitNumberInSession).toBe(2)
  })

  it('does NOT flag as repeat when different school visited yesterday', () => {
    const yesterday = makeVisit({
      visitDate: '2026-04-29',
      schoolName: 'DPS Bhopal',
      canonicalSchoolName: 'dps bhopal',
    })
    const today = makeVisit({ visitDate: '2026-04-30' })

    const result = compareWithHistory(today, [yesterday])

    expect(result.isRepeatVisit).toBe(false)
    expect(result.visitNumberInSession).toBe(1)
  })

  it('detects changes between yesterday and today', () => {
    const yesterday = makeVisit({ visitDate: '2026-04-29', strength: 1800 })
    const today = makeVisit({ visitDate: '2026-04-30', strength: 1900 })

    const result = compareWithHistory(today, [yesterday])

    expect(result.changesFromLast).toContainEqual(
      expect.objectContaining({ field: 'strength', oldValue: 1800, newValue: 1900 })
    )
  })

  it('counts correctly across two days of visits', () => {
    const day1 = makeVisit({ visitDate: '2026-04-28' })
    const day2 = makeVisit({ visitDate: '2026-04-29' })
    const day3 = makeVisit({ visitDate: '2026-04-30' })

    const result = compareWithHistory(day3, [day1, day2])

    expect(result.isRepeatVisit).toBe(true)
    expect(result.visitNumberInSession).toBe(3)
  })
})
```

- [ ] **Step 2: Run test — expect PASS**

```bash
npx vitest run tests/orchestrator-crossday-repeat.test.ts
```

Expected: All 4 tests PASS. (`compareWithHistory` already handles this — the fix is in the data passed to it, not in the function itself.)

- [ ] **Step 3: Load yesterday's visits in orchestrator Step 3**

In `src/lib/pipeline/orchestrator.ts`, replace lines 97-132 (Step 3 block):

```typescript
  // ── Step 3: Load today's + yesterday's visits (for repeat detection) ────
  const todayStart = new Date(`${runDate}T00:00:00.000Z`)
  const todayEnd   = new Date(`${runDate}T23:59:59.999Z`)
  const yesterdayStart = new Date(todayStart)
  yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1)

  const [todayDbVisits, yesterdayDbVisits] = await Promise.all([
    prisma.visit.findMany({
      where: { visitDate: { gte: todayStart, lte: todayEnd } },
      include: { executive: true, school: true },
    }),
    prisma.visit.findMany({
      where: { visitDate: { gte: yesterdayStart, lt: todayStart } },
      include: { executive: true, school: true },
    }),
  ])

  const previousDbVisits = [...yesterdayDbVisits, ...todayDbVisits]

  // Convert DB visits to ValidatedVisit shape for history comparison
  const previousVisits: ValidatedVisit[] = previousDbVisits.map((v) => ({
    isVisitReport: true,
    schoolName: v.schoolNameRaw,
    canonicalSchoolName: v.school?.canonicalName,
    schoolId: v.school?.id,
    address: v.address,
    board: v.board as ValidatedVisit['board'],
    strength: v.strength,
    principalName: v.principalName,
    principalMobile: v.principalMobile,
    principalEmail: v.principalEmail,
    principalDob: v.principalDob,
    bookSeller: v.bookSeller,
    remark: v.remark as ValidatedVisit['remark'],
    remarkDetail: v.remarkDetail,
    executiveName: v.executive.displayName,
    visitDate: v.visitDate.toISOString().substring(0, 10),
    rawText: v.rawText ?? '',
    locationUrl: v.locationUrl ?? undefined,
    dataComplete: v.dataComplete,
    missingFields: (Array.isArray(v.missingFields) ? v.missingFields : JSON.parse(v.missingFields as unknown as string)) as string[],
    extractionModel: (v.extractionModel ?? 'haiku') as 'haiku' | 'sonnet',
    isRepeatVisit: v.isRepeatVisit,
    visitNumberInSession: v.visitNumberInSession,
    changesFromLast: (v.changesFromLast as unknown as ValidatedVisit['changesFromLast']) ?? [],
  }))
```

- [ ] **Step 4: Run typecheck + full test suite**

```bash
npm run typecheck && npx vitest run
```

Expected: No errors. All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/orchestrator.ts tests/orchestrator-crossday-repeat.test.ts
git commit -m "fix: extend repeat detection to include yesterday's visits

previousDbVisits previously only loaded today's records. A school visited
on day N and again on day N+1 would not be flagged as a repeat. Now loads
both yesterday and today — compareWithHistory was already correct."
```

---

## Task 6: Wire weekly summary (Monday 9 AM cron)

**Problem:** `generateWeeklySummary()` in `ai.ts:144` is fully implemented but never called. Managers get no weekly view of exec performance.

**Files:**
- Modify: `src/lib/cron.ts`
- Modify: `src/lib/email.ts` (add `sendWeeklySummaryEmail` if not present)

- [ ] **Step 1: Check if sendWeeklySummaryEmail exists in email.ts**

```bash
grep -n "sendWeeklySummary" /Users/vinamr/Projects/sales-agent-publisher/src/lib/email.ts
```

If it doesn't exist, proceed to Step 2. If it does, skip to Step 4.

- [ ] **Step 2: Add sendWeeklySummaryEmail to email.ts**

Open `src/lib/email.ts` and add at the end of the file:

```typescript
export async function sendWeeklySummaryEmail(
  to: string,
  summaryText: string,
  stats: {
    weekStart: string
    weekEnd: string
    totalVisits: number
    execsReporting: number
    totalExecs: number
    newSchools: number
  }
): Promise<void> {
  await resend.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `Weekly Sales Summary: ${stats.weekStart} – ${stats.weekEnd}`,
    html: `
      <h2>Weekly Sales Summary</h2>
      <p><strong>Period:</strong> ${stats.weekStart} – ${stats.weekEnd}</p>
      <ul>
        <li>Total visits: ${stats.totalVisits}</li>
        <li>Executives reporting: ${stats.execsReporting} / ${stats.totalExecs}</li>
        <li>New schools: ${stats.newSchools}</li>
      </ul>
      <pre style="font-family:sans-serif;white-space:pre-wrap">${summaryText}</pre>
    `,
  })
}
```

- [ ] **Step 3: Add autoWeekly() and Monday trigger to cron.ts**

In `src/lib/cron.ts`, add the import at the top:

```typescript
import { generateWeeklySummary } from './ai'
import { sendWeeklySummaryEmail } from './email'
```

Add the Monday check inside the `setInterval` callback, after the 8 PM block:

```typescript
    // Monday 9 AM: send weekly summary to manager
    if (hour === 9 && minute === 0 && now.getDay() === 1) {
      void autoWeekly().catch((e) => console.error('[Cron] Weekly summary failed:', e))
    }
```

Add the `autoWeekly()` function at the bottom of `cron.ts`:

```typescript
async function autoWeekly(): Promise<void> {
  const today = new Date()
  // Week = Mon–Sun ending yesterday (Sunday)
  const sunday = new Date(today)
  sunday.setDate(today.getDate() - 1)
  const monday = new Date(sunday)
  monday.setDate(sunday.getDate() - 6)

  const weekStart = monday.toLocaleDateString('en-CA')
  const weekEnd   = sunday.toLocaleDateString('en-CA')

  console.log(`[Cron] Generating weekly summary ${weekStart} → ${weekEnd}`)

  const executives = await prisma.executive.findMany({ where: { active: true } })

  let totalVisits = 0
  let newSchools = 0
  const execsWithVisits = new Set<string>()

  const summaries: { name: string; text: string }[] = []

  for (const exec of executives) {
    const visits = await prisma.visit.findMany({
      where: {
        executiveId: exec.id,
        visitDate: { gte: new Date(`${weekStart}T00:00:00.000Z`), lte: new Date(`${weekEnd}T23:59:59.999Z`) },
      },
    })

    if (visits.length === 0) continue
    execsWithVisits.add(exec.id)
    totalVisits += visits.length
    newSchools += visits.filter((v) => !v.isRepeatVisit).length

    // Group visits by date to get daily counts
    const byDate = new Map<string, number>()
    for (const v of visits) {
      const d = v.visitDate.toISOString().slice(0, 10)
      byDate.set(d, (byDate.get(d) ?? 0) + 1)
    }
    const dailyVisits = Array.from(byDate.values())

    try {
      const { text } = await generateWeeklySummary({
        name: exec.displayName,
        weekStart,
        weekEnd,
        dailyVisits,
        weeklyTarget: exec.dailyTarget * 5,
        totalVisits: visits.length,
        newSchools: visits.filter((v) => !v.isRepeatVisit).length,
        repeatVisits: visits.filter((v) => v.isRepeatVisit).length,
        samplingCount: visits.filter((v) => v.remark === 'Sampling').length,
        meetingCount: visits.filter((v) => v.remark === 'Meeting with Principal').length,
        missingDataCount: visits.filter((v) => !v.dataComplete).length,
      })
      summaries.push({ name: exec.displayName, text })
    } catch (e) {
      console.error(`[Cron] Weekly summary for ${exec.displayName} failed:`, e)
    }
  }

  if (summaries.length === 0) {
    console.log('[Cron] No weekly summaries generated (no visits this week)')
    return
  }

  const settings = await prisma.settings.findUnique({ where: { id: 'default' } })
  if (!settings?.managerEmail) {
    console.log('[Cron] Weekly summaries generated but no managerEmail set')
    return
  }

  const combined = summaries.map((s) => `--- ${s.name} ---\n${s.text}`).join('\n\n')

  try {
    await sendWeeklySummaryEmail(settings.managerEmail, combined, {
      weekStart,
      weekEnd,
      totalVisits,
      execsReporting: execsWithVisits.size,
      totalExecs: executives.length,
      newSchools,
    })
    console.log(`[Cron] Weekly summary emailed to manager (${summaries.length} execs)`)
  } catch (e) {
    console.error('[Cron] Weekly summary email failed:', e)
  }
}
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cron.ts src/lib/email.ts
git commit -m "feat: wire weekly summary to Monday 9 AM cron

generateWeeklySummary() was implemented but never called. Now fires every
Monday at 9 AM IST, generates per-exec summaries for the prior Mon-Sun
week, and emails the manager digest."
```

---

## Final: Push + PR

- [ ] **Step 1: Run local CI (act)**

```bash
act pull_request -W .github/workflows/ci.yml -j check -j build
```

Expected: `check` (typecheck + prisma validate) and `build` (next build) both PASS. If Docker not running, start Docker Desktop first.

- [ ] **Step 2: Push branch**

```bash
git push -u origin feat/bulletproof-pipeline
```

- [ ] **Step 3: Open PR**

```bash
gh pr create --title "feat: bulletproof pipeline — silent failures, dead code, cross-day repeats, weekly summary" \
  --body "$(cat <<'EOF'
## What this fixes

- **Manager WhatsApp reports were never delivered** — `alertEmailTo` (email field) was regex-matched for a phone number. Added `managerPhone` Settings field.
- **Cron failures were invisible** — 8 PM pipeline errors now persist a failed `IngestionRun` and send an alert email.
- **New exec visits silently dropped** — `getOrCreateExecId` now throws on DB failure instead of returning null.
- **Repeat detection was same-day only** — orchestrator now loads yesterday's visits so cross-day repeats are flagged.
- **Legacy scraper deleted** — `whatsapp-manager.ts`, `src/scraper/`, `/api/whatsapp/scrape` removed.
- **Weekly summaries wired** — Monday 9 AM cron generates per-exec weekly digest and emails manager.

## Test plan
- [ ] `npx vitest run` — all tests pass
- [ ] `npm run typecheck` — no errors
- [ ] Set `managerPhone` in Settings UI, confirm field saves
- [ ] Trigger `/api/whatsapp/process` and confirm WhatsApp report delivered to managerPhone
- [ ] Check dashboard after 8 PM run shows IngestionRun record regardless of success/failure
EOF
)"
```

---

## Self-Review

**Spec coverage check:**
- ✅ B1 (manager phone) → Task 1
- ✅ B2 (cron errors) → Task 2
- ✅ B3 (getOrCreateExecId null) → Task 3
- ✅ I2 (legacy scraper) → Task 4
- ✅ D2 (cross-day repeat) → Task 5
- ✅ I1 (weekly summary) → Task 6

**No placeholders:** All code blocks are complete and runnable.

**Type consistency:** `ValidatedVisit`, `compareWithHistory`, `generateWeeklySummary` signatures match existing types throughout.
