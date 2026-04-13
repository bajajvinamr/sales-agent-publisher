import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const executives = await prisma.executive.findMany({
      where: { active: true },
      orderBy: { displayName: 'asc' },
      select: {
        id: true,
        displayName: true,
        name: true,
        phone: true,
        email: true,
        dailyTarget: true,
        createdAt: true,
        visits: {
          where: { visitDate: { gte: today, lt: tomorrow } },
          select: {
            id: true,
            dataComplete: true,
            remark: true,
          },
        },
      },
    })

    const result = executives.map((exec) => {
      const todayVisits = exec.visits.length
      return {
        id: exec.id,
        displayName: exec.displayName,
        name: exec.name,
        phone: exec.phone,
        email: exec.email,
        dailyTarget: exec.dailyTarget,
        createdAt: exec.createdAt,
        todayVisits,
        targetMet: todayVisits >= exec.dailyTarget,
        gap: Math.max(0, exec.dailyTarget - todayVisits),
        todayDataCompletePct:
          todayVisits > 0
            ? Math.round(
                (exec.visits.filter((v) => v.dataComplete).length /
                  todayVisits) *
                  100
              )
            : 0,
      }
    })

    return NextResponse.json({ executives: result })
  } catch (error) {
    console.error('[executives] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to load executives' },
      { status: 500 }
    )
  }
}
