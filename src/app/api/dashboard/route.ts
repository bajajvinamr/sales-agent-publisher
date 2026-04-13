import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { initApp } from '@/lib/init'

initApp()

export async function GET() {
  try {
    // Find the most recent date with visits (for demo mode with historical data)
    const latestVisit = await prisma.visit.findFirst({
      orderBy: { visitDate: 'desc' },
      select: { visitDate: true },
    })

    const today = latestVisit ? new Date(latestVisit.visitDate) : new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    // Parallel queries
    const [todayVisits, activeAlerts, latestSummary, executives] =
      await Promise.all([
        prisma.visit.findMany({
          where: { visitDate: { gte: today, lt: tomorrow } },
          select: {
            id: true,
            executiveId: true,
            dataComplete: true,
            remark: true,
            schoolNameRaw: true,
            school: { select: { canonicalName: true } },
            executive: { select: { displayName: true, dailyTarget: true } },
          },
        }),
        prisma.alert.findMany({
          where: { resolved: false },
          orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
          select: {
            id: true,
            alertType: true,
            message: true,
            severity: true,
            createdAt: true,
            executive: { select: { displayName: true } },
          },
        }),
        prisma.dailySummary.findFirst({
          orderBy: { summaryDate: 'desc' },
          select: {
            summaryDate: true,
            totalExecutivesReporting: true,
            totalVisits: true,
            avgVisitsPerExec: true,
            targetsMetCount: true,
            targetsMissedCount: true,
            newSchoolsCount: true,
            repeatVisitsCount: true,
            dataCompletenessPct: true,
            summaryText: true,
          },
        }),
        prisma.executive.findMany({
          where: { active: true },
          select: {
            id: true,
            displayName: true,
            dailyTarget: true,
          },
        }),
      ])

    // Build per-executive visit counts
    const visitsByExec = new Map<string, number>()
    for (const visit of todayVisits) {
      const count = visitsByExec.get(visit.executiveId) ?? 0
      visitsByExec.set(visit.executiveId, count + 1)
    }

    const executiveProgress = executives.map((exec) => {
      const visitsToday = visitsByExec.get(exec.id) ?? 0
      return {
        id: exec.id,
        displayName: exec.displayName,
        visitsToday,
        target: exec.dailyTarget,
        targetMet: visitsToday >= exec.dailyTarget,
        gap: Math.max(0, exec.dailyTarget - visitsToday),
      }
    })

    const totalVisits = todayVisits.length
    const execsWithVisits = visitsByExec.size
    const avgPerExec =
      execsWithVisits > 0 ? totalVisits / execsWithVisits : 0
    const targetsMet = executiveProgress.filter((e) => e.targetMet).length
    const targetsMissed = executiveProgress.filter(
      (e) => !e.targetMet && e.visitsToday > 0
    ).length

    const stats = {
      date: today.toISOString().split('T')[0],
      totalVisits,
      avgVisitsPerExec: Math.round(avgPerExec * 10) / 10,
      targetsMet,
      targetsMissed,
      activeExecutives: executives.length,
      execsReporting: execsWithVisits,
      dataCompletenessPct:
        totalVisits > 0
          ? Math.round(
              (todayVisits.filter((v) => v.dataComplete).length /
                totalVisits) *
                100
            )
          : 0,
    }

    return NextResponse.json({
      stats,
      alerts: activeAlerts,
      executiveProgress,
      summary: latestSummary,
    })
  } catch (error) {
    console.error('[dashboard] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to load dashboard data' },
      { status: 500 }
    )
  }
}
