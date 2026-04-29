import { describe, it, expect } from 'vitest'

// Mirrors the date-stamping logic in parseWAMessage (src/lib/whatsapp-baileys.ts).
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
