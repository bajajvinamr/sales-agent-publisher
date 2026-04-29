import { describe, it, expect } from 'vitest'
import { z } from 'zod'

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
