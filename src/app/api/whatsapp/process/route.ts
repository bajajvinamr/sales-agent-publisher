import { NextResponse } from 'next/server'
import { getCapturedMessages, clearCapturedMessages, getStatus } from '@/lib/whatsapp-baileys'
import { runPipeline } from '@/lib/pipeline/orchestrator'
import { sendAlertEmail, sendDailySummaryEmail } from '@/lib/email'
import { prisma } from '@/lib/db'
import { DEFAULT_CONFIG } from '@/types'

/**
 * POST /api/whatsapp/process
 * Process today's captured WhatsApp messages through the AI pipeline.
 * No upload needed — messages were captured in real-time via Baileys.
 */
export async function POST(req: Request) {
  try {
    const { status, monitoredGroup, messagesCapturedToday } = getStatus()

    if (status !== 'connected') {
      return NextResponse.json({ error: 'WhatsApp not connected' }, { status: 400 })
    }

    if (!monitoredGroup) {
      return NextResponse.json({ error: 'No group being monitored. Go to Settings and set a group name, then click Monitor on the Connect page.' }, { status: 400 })
    }

    // Get date from body or default to today
    const body = await req.json().catch(() => ({}))
    const date = body.date || new Date().toISOString().slice(0, 10)

    const messages = getCapturedMessages(date)

    if (messages.length === 0) {
      return NextResponse.json({
        error: `No messages captured for ${date}. ${messagesCapturedToday} messages captured today total. Messages are captured in real-time — make sure the group is active.`,
        messagesCapturedToday,
      }, { status: 400 })
    }

    // Run pipeline
    const result = await runPipeline(messages, DEFAULT_CONFIG)

    // Ingestion run already persisted by orchestrator

    // Send email notifications
    try {
      const settings = await prisma.settings.findUnique({ where: { id: 'default' } })
      if (result.alerts.length > 0 && settings?.alertEmailTo) {
        await sendAlertEmail(settings.alertEmailTo, result.alerts.map(a => ({
          type: a.alertType, message: a.message, executive: a.executiveName,
        })))
      }
      if (result.summary.summaryText && settings?.managerEmail) {
        await sendDailySummaryEmail(settings.managerEmail, result.summary.summaryText, {
          totalVisits: result.summary.totalVisits,
          execsReporting: result.summary.totalExecutivesReporting,
          targetsMet: result.summary.targetsMetCount,
        })
      }
    } catch (emailErr) {
      console.error('[whatsapp/process] Email failed (non-fatal):', emailErr)
    }

    // Clear processed messages
    clearCapturedMessages(date)

    return NextResponse.json({
      success: true,
      date,
      messagesProcessed: messages.length,
      visitsExtracted: result.run.visitsExtracted,
      alertsGenerated: result.run.alertsGenerated,
      summary: result.summary.summaryText,
    })
  } catch (error) {
    console.error('[whatsapp/process] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Processing failed' },
      { status: 500 }
    )
  }
}
