import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    const latest = await prisma.ingestionRun.findFirst({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        runDate: true,
        messagesScraped: true,
        messagesAfterFilter: true,
        chunksCreated: true,
        visitsExtracted: true,
        alertsGenerated: true,
        haikuTokensUsed: true,
        sonnetTokensUsed: true,
        status: true,
        errorLog: true,
        createdAt: true,
      },
    })

    if (!latest) {
      return NextResponse.json({ run: null, message: 'No ingestion runs found' })
    }

    return NextResponse.json({ run: latest })
  } catch (error) {
    console.error('[ingest/status] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to load ingestion status' },
      { status: 500 }
    )
  }
}
