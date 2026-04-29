import { describe, it, expect } from 'vitest'

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
