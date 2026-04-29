/**
 * App initialization — runs once on server start.
 * Starts the auto-processing cron job and wires the Baileys alert callback.
 */

import { startCron } from './cron'
import { setAlertHandler } from './whatsapp-baileys'
import { sendAlertEmail } from './email'
import { prisma } from './db'

let initialized = false

export function initApp() {
  if (initialized) return
  initialized = true

  // Loud startup warnings for missing production-critical env vars
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[Init] CRITICAL: ANTHROPIC_API_KEY is not set — AI extraction will fail at 8 PM. Set it in .env and restart.')
  }
  if (!process.env.APP_PASSWORD && process.env.NODE_ENV === 'production') {
    console.error('[Init] CRITICAL: APP_PASSWORD is not set in production — all routes are publicly accessible.')
  }
  if (!process.env.RESEND_API_KEY) {
    console.warn('[Init] WARNING: RESEND_API_KEY is not set — all alert/summary emails will be skipped silently.')
  }

  // Wire Baileys disconnect alerts → email. Keeps whatsapp-baileys.ts
  // free of db/email imports while ensuring operators get notified.
  setAlertHandler(async (message) => {
    try {
      const settings = await prisma.settings.findUnique({ where: { id: 'default' } })
      if (settings?.alertEmailTo) {
        await sendAlertEmail(settings.alertEmailTo, [{
          type: 'CONNECTION_FAILURE',
          message,
          executive: 'System',
        }])
      }
    } catch (e) {
      console.error('[Init] Baileys alert email failed:', e)
    }
  })

  startCron()
  console.log('[Init] Sales Tracker started — auto-processing at 8 PM daily')
}
