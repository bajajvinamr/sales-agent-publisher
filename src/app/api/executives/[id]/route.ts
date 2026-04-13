import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Compute this week's Monday–Sunday window
    const now = new Date()
    const dayOfWeek = now.getDay() // 0=Sun, 1=Mon...
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - daysFromMonday)
    weekStart.setHours(0, 0, 0, 0)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 7)

    const executive = await prisma.executive.findUnique({
      where: { id },
      select: {
        id: true,
        displayName: true,
        name: true,
        phone: true,
        email: true,
        dailyTarget: true,
        active: true,
        createdAt: true,
        visits: {
          where: { visitDate: { gte: weekStart, lt: weekEnd } },
          orderBy: { visitDate: 'asc' },
          select: {
            id: true,
            visitDate: true,
            schoolNameRaw: true,
            board: true,
            remark: true,
            remarkDetail: true,
            dataComplete: true,
            missingFields: true,
            isRepeatVisit: true,
            locationUrl: true,
            school: { select: { id: true, canonicalName: true } },
          },
        },
      },
    })

    if (!executive) {
      return NextResponse.json(
        { error: 'Executive not found' },
        { status: 404 }
      )
    }

    // Build daily breakdown Mon–Sat (6 days)
    const dailyVisits: number[] = [0, 0, 0, 0, 0, 0]
    let newSchools = 0
    let repeatVisits = 0
    let samplingCount = 0
    let meetingCount = 0
    let missingDataCount = 0

    for (const visit of executive.visits) {
      const visitDay = new Date(visit.visitDate).getDay() // 0=Sun
      const idx = visitDay === 0 ? 5 : visitDay - 1       // Mon=0 … Sat=5
      if (idx >= 0 && idx < 6) {
        dailyVisits[idx] = (dailyVisits[idx] ?? 0) + 1
      }
      if (visit.remark === 'New Visit') newSchools++
      if (visit.isRepeatVisit) repeatVisits++
      if (visit.remark === 'Sampling') samplingCount++
      if (visit.remark === 'Meeting with Principal') meetingCount++
      if (!visit.dataComplete) missingDataCount++
    }

    const totalWeeklyVisits = executive.visits.length
    const weeklyTarget = executive.dailyTarget * 6

    return NextResponse.json({
      executive: {
        id: executive.id,
        displayName: executive.displayName,
        name: executive.name,
        phone: executive.phone,
        email: executive.email,
        dailyTarget: executive.dailyTarget,
        active: executive.active,
        createdAt: executive.createdAt,
      },
      weeklyPerformance: {
        weekStart: weekStart.toISOString().split('T')[0],
        weekEnd: new Date(weekEnd.getTime() - 1).toISOString().split('T')[0],
        dailyVisits,
        totalVisits: totalWeeklyVisits,
        weeklyTarget,
        targetMet: totalWeeklyVisits >= weeklyTarget,
        newSchools,
        repeatVisits,
        samplingCount,
        meetingCount,
        missingDataCount,
        dataCompletePct:
          totalWeeklyVisits > 0
            ? Math.round(
                ((totalWeeklyVisits - missingDataCount) /
                  totalWeeklyVisits) *
                  100
              )
            : 0,
      },
      thisWeekVisits: executive.visits,
    })
  } catch (error) {
    console.error('[executives/id] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to load executive' },
      { status: 500 }
    )
  }
}
