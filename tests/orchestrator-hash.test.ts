import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'

// Mirrors the dedup hash in src/lib/pipeline/orchestrator.ts:216.
// Keyed into Visit.rawTextHash → @@unique([executiveId, visitDate, rawTextHash]).
// If the hash changes, all prior rows become un-deduppable — don't touch without a migration.
function dedupHash(rawText: string): string {
  return createHash('md5')
    .update(rawText || '__no_text__')
    .digest('hex')
    .slice(0, 16)
}

describe('visit dedup hash', () => {
  it('returns a stable 16-char hex string', () => {
    const h = dedupHash('Carmel Convent School, CBSE')
    expect(h).toHaveLength(16)
    expect(/^[0-9a-f]{16}$/.test(h)).toBe(true)
  })

  it('same input produces same hash (idempotent)', () => {
    const a = dedupHash('same text')
    const b = dedupHash('same text')
    expect(a).toBe(b)
  })

  it('different inputs produce different hashes', () => {
    expect(dedupHash('A')).not.toBe(dedupHash('B'))
  })

  it('empty string falls back to __no_text__ sentinel', () => {
    const empty = dedupHash('')
    const sentinel = dedupHash('__no_text__')
    expect(empty).toBe(sentinel)
  })
})
