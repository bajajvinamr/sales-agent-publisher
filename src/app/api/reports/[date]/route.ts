import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ date: string }> }
) {
  try {
    const { date } = await params

    if (!DATE_REGEX.test(date)) {
      return NextResponse.json(
        { error: 'Invalid date format. Use YYYY-MM-DD.' },
        { status: 400 }
      )
    }

    const dayStart = new Date(`${date}T00:00:00.000Z`)
    const dayEnd = new Date(`${date}T23:59:59.999Z`)

    const visits = await prisma.visit.findMany({
      where: { visitDate: { gte: dayStart, lte: dayEnd } },
      orderBy: [{ executive: { displayName: 'asc' } }, { createdAt: 'asc' }],
      select: {
        id: true,
        visitDate: true,
        schoolNameRaw: true,
        address: true,
        board: true,
        strength: true,
        principalName: true,
        principalMobile: true,
        principalEmail: true,
        bookSeller: true,
        remark: true,
        remarkDetail: true,
        locationUrl: true,
        dataComplete: true,
        missingFields: true,
        isRepeatVisit: true,
        visitNumberInSession: true,
        extractionModel: true,
        executive: { select: { id: true, displayName: true, dailyTarget: true } },
        school: { select: { id: true, canonicalName: true, board: true } },
      },
    })

    // Build per-executive summaries
    type ExecSummary = {
      executiveId: string
      displayName: string
      visitCount: number
      targetMet: boolean
      target: number
      newVisits: number
      followUps: number
      samplings: number
      dataCompletePct: number
    }
    const execMap = new Map<string, ExecSummary>()

    for (const visit of visits) {
      const exec = visit.executive
      if (!execMap.has(exec.id)) {
        execMap.set(exec.id, {
          executiveId: exec.id,
          displayName: exec.displayName,
          visitCount: 0,
          targetMet: false,
          target: exec.dailyTarget,
          newVisits: 0,
          followUps: 0,
          samplings: 0,
          dataCompletePct: 0,
        })
      }

      const summary = execMap.get(exec.id)!
      summary.visitCount++
      if (visit.remark === 'New Visit') summary.newVisits++
      if (visit.remark === 'Follow up Visit') summary.followUps++
      if (visit.remark === 'Sampling') summary.samplings++
    }

    // Calculate completeness and target for each exec
    for (const [execId, summary] of execMap) {
      const execVisits = visits.filter((v) => v.executive.id === execId)
      const completeCount = execVisits.filter((v) => v.dataComplete).length
      summary.dataCompletePct =
        execVisits.length > 0
          ? Math.round((completeCount / execVisits.length) * 100)
          : 0
      summary.targetMet = summary.visitCount >= summary.target
    }

    return NextResponse.json({
      date,
      visits: visits.map((v) => ({
        id: v.id,
        visitDate: v.visitDate,
        executive: v.executive,
        school: v.school,
        schoolNameRaw: v.schoolNameRaw,
        address: v.address,
        board: v.board,
        strength: v.strength,
        principalName: v.principalName,
        principalMobile: v.principalMobile,
        principalEmail: v.principalEmail,
        bookSeller: v.bookSeller,
        remark: v.remark,
        remarkDetail: v.remarkDetail,
        locationUrl: v.locationUrl,
        dataComplete: v.dataComplete,
        missingFields: v.missingFields,
        isRepeatVisit: v.isRepeatVisit,
        visitNumberInSession: v.visitNumberInSession,
        extractionModel: v.extractionModel,
      })),
      executiveSummaries: Array.from(execMap.values()),
    })
  } catch (error) {
    console.error('[reports/date] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to load report' },
      { status: 500 }
    )
  }
}
