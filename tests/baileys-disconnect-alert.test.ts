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
