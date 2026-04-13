import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { runPipeline } from '@/lib/pipeline/orchestrator'
import { sendAlertEmail, sendDailySummaryEmail } from '@/lib/email'
import { DEFAULT_CONFIG, type RawMessage } from '@/types'
import { z } from 'zod'

const rawMessageSchema = z.object({
  date: z.string(),
  time: z.string(),
  sender: z.string(),
  message: z.string(),
  messageType: z.enum(['Text', 'Location', 'LiveLocation', 'MediaOmitted', 'Deleted', 'Link']),
  url: z.string().optional(),
})

const ingestBodySchema = z.object({
  messages: z.array(rawMessageSchema).min(1),
})

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json()
    const parsed = ingestBodySchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { messages } = parsed.data as { messages: RawMessage[] }

    // Run the pipeline
    const result = await runPipeline(messages, DEFAULT_CONFIG)

    // Persist ingestion run log
    const runDate = new Date()
    runDate.setHours(0, 0, 0, 0)

    await prisma.ingestionRun.create({
      data: {
        runDate,
        messagesScraped: result.run.messagesScraped,
        messagesAfterFilter: result.run.messagesAfterFilter,
        chunksCreated: result.run.chunksCreated,
        visitsExtracted: result.run.visitsExtracted,
        alertsGenerated: result.run.alertsGenerated,
        haikuTokensUsed: result.run.haikuTokensUsed,
        sonnetTokensUsed: result.run.sonnetTokensUsed,
        status: result.run.errors.length === 0 ? 'success' : 'partial',
        errorLog:
          result.run.errors.length > 0
            ? result.run.errors.join('\n')
            : null,
      },
    })

    // Send email notifications (non-blocking — don't fail ingest on email error)
    try {
      const settings = await prisma.settings.findUnique({ where: { id: 'default' } })

      if (result.alerts.length > 0 && settings?.alertEmailTo) {
        const emailAlerts = result.alerts.map((a) => ({
          type: a.alertType,
          message: a.message,
          executive: a.executiveName,
        }))
        await sendAlertEmail(settings.alertEmailTo, emailAlerts)
      }

      if (result.summary.summaryText && settings?.managerEmail) {
        await sendDailySummaryEmail(settings.managerEmail, result.summary.summaryText, {
          totalVisits: result.summary.totalVisits,
          execsReporting: result.summary.totalExecutivesReporting,
          targetsMet: result.summary.targetsMetCount,
        })
      }
    } catch (emailErr) {
      console.error('[ingest] Email notification failed (non-fatal):', emailErr)
    }

    return NextResponse.json({
      success: true,
      stats: result.run,
    })
  } catch (error) {
    console.error('[ingest] POST error:', error)

    // Log failed run
    try {
      await prisma.ingestionRun.create({
        data: {
          runDate: new Date(),
          messagesScraped: 0,
          messagesAfterFilter: 0,
          chunksCreated: 0,
          visitsExtracted: 0,
          alertsGenerated: 0,
          haikuTokensUsed: 0,
          sonnetTokensUsed: 0,
          status: 'failed',
          errorLog: error instanceof Error ? error.message : 'Unknown error',
        },
      })
    } catch {
      // Don't mask the original error
    }

    return NextResponse.json(
      { error: 'Ingestion failed' },
      { status: 500 }
    )
  }
}
