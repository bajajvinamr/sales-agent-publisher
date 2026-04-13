import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const school = await prisma.school.findUnique({
      where: { id },
      select: {
        id: true,
        canonicalName: true,
        aliases: true,
        address: true,
        board: true,
        lastKnownStrength: true,
        principalName: true,
        principalMobile: true,
        principalEmail: true,
        principalDob: true,
        bookSeller: true,
        createdAt: true,
        updatedAt: true,
        visits: {
          orderBy: { visitDate: 'desc' },
          select: {
            id: true,
            visitDate: true,
            remark: true,
            remarkDetail: true,
            board: true,
            strength: true,
            principalName: true,
            principalMobile: true,
            dataComplete: true,
            missingFields: true,
            isRepeatVisit: true,
            visitNumberInSession: true,
            locationUrl: true,
            executive: { select: { id: true, displayName: true } },
          },
        },
        _count: { select: { visits: true } },
      },
    })

    if (!school) {
      return NextResponse.json({ error: 'School not found' }, { status: 404 })
    }

    return NextResponse.json({
      school: {
        id: school.id,
        canonicalName: school.canonicalName,
        aliases: school.aliases,
        address: school.address,
        board: school.board,
        lastKnownStrength: school.lastKnownStrength,
        principalName: school.principalName,
        principalMobile: school.principalMobile,
        principalEmail: school.principalEmail,
        principalDob: school.principalDob,
        bookSeller: school.bookSeller,
        totalVisits: school._count.visits,
        createdAt: school.createdAt,
        updatedAt: school.updatedAt,
        visitTimeline: school.visits,
      },
    })
  } catch (error) {
    console.error('[schools/id] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to load school' },
      { status: 500 }
    )
  }
}
