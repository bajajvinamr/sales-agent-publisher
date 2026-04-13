/**
 * App initialization — runs once on server start.
 * Starts the auto-processing cron job.
 */

import { startCron } from './cron'

let initialized = false

export function initApp() {
  if (initialized) return
  initialized = true

  startCron()
  console.log('[Init] Sales Tracker started — auto-processing at 8 PM daily')
}
