import { describe, it, expect } from 'vitest'

// Mirrors the early-return guards in getOrCreateExecId (orchestrator.ts).
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
