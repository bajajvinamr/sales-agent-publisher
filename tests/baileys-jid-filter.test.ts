import { describe, it, expect } from 'vitest'

// Mirrors the guard in src/lib/whatsapp-baileys.ts parseWAMessage.
// If you change this regex there, update it here and vice versa.
const JID_REJECT = /@(g\.us|broadcast|newsletter)$/i

describe('baileys JID filter', () => {
  it('rejects group JIDs', () => {
    expect(JID_REJECT.test('120363012345678901@g.us')).toBe(true)
  })

  it('rejects broadcast and newsletter JIDs', () => {
    expect(JID_REJECT.test('status@broadcast')).toBe(true)
    expect(JID_REJECT.test('1203@newsletter')).toBe(true)
  })

  it('accepts human pushNames', () => {
    expect(JID_REJECT.test('Prakhar')).toBe(false)
    expect(JID_REJECT.test('Nishkarsh Bajaj')).toBe(false)
  })

  it('accepts individual JIDs (participant field)', () => {
    expect(JID_REJECT.test('919876543210@s.whatsapp.net')).toBe(false)
  })

  it('is case-insensitive on suffix', () => {
    expect(JID_REJECT.test('abc@G.US')).toBe(true)
  })
})
