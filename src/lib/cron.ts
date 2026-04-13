/**
 * Auto-processing cron — runs at 8 PM daily.
 * 1. Processes captured WhatsApp messages through AI pipeline
 * 2. Sends alerts via email
 * 3. Sends daily report via WhatsApp to manager
 *
 * After initial setup (connect WhatsApp + select group + set manager phone),
 * everything runs automatically. No manual action needed.
 */

import { getCapturedMessages, clearCapturedMessages, getStatus, sendDailyReport } from './whatsapp-baileys'
import { runPipeline } from './pipeline/orchestrator'
import { sendAlertEmail, sendDailySummaryEmail } from './email'
import { prisma } from './db'
import { DEFAULT_CONFIG } from '@/types'

let cronInterval: ReturnType<typeof setInterval> | null = null

export function startCron() {
  if (cronInterval) return // already running

  // Check every minute if it's 8 PM
  cronInterval = setInterval(async () => {
    const now = new Date()
    const hour = now.getHours()
    const minute = now.getMinutes()

    // Run at 8:00 PM (20:00)
    if (hour === 20 && minute === 0) {
      // Guard: check if we already ran today
      const today = new Date().toISOString().slice(0, 10)
      const todayStart = new Date(today + 'T00:00:00Z')
      const existing = await prisma.ingestionRun.findFirst({
        where: { runDate: { gte: todayStart } },
      }).catch(() => null)
      if (existing) {
        console.log('[Cron] Already ran today, skipping')
        return
      }
      console.log('[Cron] 8 PM — starting auto-processing')
      await autoProcess()
    }
  }, 60_000) // check every 60 seconds

  console.log('[Cron] Auto-processing scheduled for 8:00 PM daily')
}

export function stopCron() {
  if (cronInterval) {
    clearInterval(cronInterval)
    cronInterval = null
  }
}

async function autoProcess() {
  const today = new Date().toISOString().slice(0, 10)

  try {
    const { status, monitoredGroup } = getStatus()

    if (status !== 'connected' || !monitoredGroup) {
      console.log('[Cron] Skipping — WhatsApp not connected or no group monitored')
      return
    }

    const messages = getCapturedMessages(today)
    if (messages.length === 0) {
      console.log('[Cron] No messages captured today, skipping')
      return
    }

    console.log(`[Cron] Processing ${messages.length} messages for ${today}`)

    // Run AI pipeline
    const result = await runPipeline(messages, DEFAULT_CONFIG)

    // Ingestion run already persisted by orchestrator
    console.log(`[Cron] Pipeline complete: ${result.run.visitsExtracted} visits, ${result.run.alertsGenerated} alerts`)

    // Send emails
    const settings = await prisma.settings.findUnique({ where: { id: 'default' } })

    if (result.alerts.length > 0 && settings?.alertEmailTo) {
      try {
        await sendAlertEmail(settings.alertEmailTo, result.alerts.map(a => ({
          type: a.alertType, message: a.message, executive: a.executiveName,
        })))
        console.log('[Cron] Alert email sent')
      } catch (e) { console.error('[Cron] Alert email failed:', e) }
    }

    if (result.summary.summaryText && settings?.managerEmail) {
      try {
        await sendDailySummaryEmail(settings.managerEmail, result.summary.summaryText, {
          totalVisits: result.summary.totalVisits,
          execsReporting: result.summary.totalExecutivesReporting,
          targetsMet: result.summary.targetsMetCount,
        })
        console.log('[Cron] Summary email sent')
      } catch (e) { console.error('[Cron] Summary email failed:', e) }
    }

    // Send WhatsApp report to manager
    if (settings?.managerEmail) {
      // Use manager's phone if available from executives table
      const executives = await prisma.executive.findMany({ where: { active: true } })
      const topPerformers = Object.entries(
        result.visits.reduce<Record<string, number>>((acc, v) => {
          acc[v.executiveName] = (acc[v.executiveName] || 0) + 1
          return acc
        }, {})
      ).sort(([, a], [, b]) => b - a).slice(0, 5).map(([name, visits]) => ({ name, visits }))

      // Try sending to alertEmailTo as phone (if it's a number)
      const managerPhone = settings.alertEmailTo?.match(/^\d{10,13}$/)?.[0]
      if (managerPhone) {
        try {
          await sendDailyReport(managerPhone, {
            date: today,
            totalVisits: result.summary.totalVisits,
            execsReporting: result.summary.totalExecutivesReporting,
            totalExecs: executives.length,
            targetsMet: result.summary.targetsMetCount,
            topPerformers,
            alerts: result.alerts.slice(0, 5).map(a => ({ exec: a.executiveName, message: a.message })),
            summaryText: result.summary.summaryText ?? undefined,
          })
          console.log('[Cron] WhatsApp report sent to manager')
        } catch (e) { console.error('[Cron] WhatsApp report failed:', e) }
      }
    }

    // Clear processed messages
    clearCapturedMessages(today)
    console.log(`[Cron] Done for ${today}`)
  } catch (e) {
    console.error('[Cron] Auto-processing failed:', e)
  }
}
