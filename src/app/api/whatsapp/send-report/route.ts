import { NextResponse } from 'next/server'
import { sendDailyReport, sendMessage, getStatus } from '@/lib/whatsapp-baileys'
import { prisma } from '@/lib/db'

// POST — send daily report via WhatsApp to manager
export async function POST(req: Request) {
  try {
    const { status } = getStatus()
    if (status !== 'connected') {
      return NextResponse.json({ error: 'WhatsApp not connected' }, { status: 400 })
    }

    const body = await req.json()
    const phone = body.phone // e.g. "919876543210"
    const date = body.date // e.g. "2025-12-30"

    if (!phone) {
      return NextResponse.json({ error: 'Phone number required' }, { status: 400 })
    }

    // Get the day's data
    const targetDate = date ? new Date(date + 'T00:00:00Z') : new Date()
    targetDate.setHours(0, 0, 0, 0)
    const nextDate = new Date(targetDate)
    nextDate.setDate(nextDate.getDate() + 1)

    // If no specific date, find most recent date with visits
    let queryStart = targetDate
    let queryEnd = nextDate

    if (!date) {
      const latest = await prisma.visit.findFirst({
        orderBy: { visitDate: 'desc' },
        select: { visitDate: true },
      })
      if (latest) {
        queryStart = new Date(latest.visitDate)
        queryStart.setHours(0, 0, 0, 0)
        queryEnd = new Date(queryStart)
        queryEnd.setDate(queryEnd.getDate() + 1)
      }
    }

    const [visits, executives, alerts, summary] = await Promise.all([
      prisma.visit.findMany({
        where: { visitDate: { gte: queryStart, lt: queryEnd } },
        include: { executive: true },
      }),
      prisma.executive.findMany({ where: { active: true } }),
      prisma.alert.findMany({
        where: { resolved: false },
        include: { executive: true },
        take: 10,
      }),
      prisma.dailySummary.findFirst({
        where: { summaryDate: { gte: queryStart, lt: queryEnd } },
      }),
    ])

    // Build top performers
    const byExec: Record<string, number> = {}
    for (const v of visits) {
      byExec[v.executive.displayName] = (byExec[v.executive.displayName] || 0) + 1
    }
    const sorted = Object.entries(byExec).sort(([, a], [, b]) => b - a)
    const topPerformers = sorted.slice(0, 5).map(([name, count]) => ({ name, visits: count }))

    const execsReporting = new Set(visits.map(v => v.executiveId)).size
    const targetsMet = sorted.filter(([, count]) => count >= 8).length

    const reportDate = queryStart.toISOString().slice(0, 10)

    const sent = await sendDailyReport(phone, {
      date: reportDate,
      totalVisits: visits.length,
      execsReporting,
      totalExecs: executives.length,
      targetsMet,
      topPerformers,
      alerts: alerts.map(a => ({
        exec: a.executive.displayName,
        message: a.message,
      })),
      summaryText: summary?.summaryText ?? undefined,
    })

    return NextResponse.json({ success: sent, date: reportDate, phone })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Send failed' },
      { status: 500 }
    )
  }
}
