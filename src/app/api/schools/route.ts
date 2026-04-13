import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    const schools = await prisma.school.findMany({
      orderBy: { canonicalName: 'asc' },
      select: {
        id: true,
        canonicalName: true,
        board: true,
        address: true,
        visits: {
          orderBy: { visitDate: 'desc' },
          take: 1,
          select: {
            visitDate: true,
            remark: true,
            remarkDetail: true,
          },
        },
        _count: { select: { visits: true } },
      },
    })

    const result = schools.map((school) => ({
      id: school.id,
      canonicalName: school.canonicalName,
      board: school.board,
      address: school.address,
      visitCount: school._count.visits,
      lastVisitDate: school.visits[0]?.visitDate ?? null,
      lastRemark: school.visits[0]?.remark ?? null,
      lastRemarkDetail: school.visits[0]?.remarkDetail ?? null,
    }))

    return NextResponse.json({ schools: result })
  } catch (error) {
    console.error('[schools] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to load schools' },
      { status: 500 }
    )
  }
}
