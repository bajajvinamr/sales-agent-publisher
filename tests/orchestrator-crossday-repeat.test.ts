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

  it('detects field changes between yesterday and today', () => {
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
