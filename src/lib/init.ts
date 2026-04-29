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
