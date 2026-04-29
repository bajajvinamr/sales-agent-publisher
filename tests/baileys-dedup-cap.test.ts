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
