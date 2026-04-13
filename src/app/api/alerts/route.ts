import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { z } from 'zod'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const showResolved = searchParams.get('resolved') === 'true'

    const alerts = await prisma.alert.findMany({
      where: showResolved ? undefined : { resolved: false },
      orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        alertType: true,
        message: true,
        severity: true,
        resolved: true,
        createdAt: true,
        visitId: true,
        executive: { select: { id: true, displayName: true } },
        visit: {
          select: {
            id: true,
            schoolNameRaw: true,
            school: { select: { canonicalName: true } },
          },
        },
      },
    })

    return NextResponse.json({ alerts })
  } catch (error) {
    console.error('[alerts] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to load alerts' },
      { status: 500 }
    )
  }
}

const patchAlertSchema = z.object({
  id: z.string().min(1),
  resolved: z.literal(true),
})

export async function PATCH(request: Request) {
  try {
    const body: unknown = await request.json()
    const parsed = patchAlertSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { id } = parsed.data

    const existing = await prisma.alert.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 })
    }

    const updated = await prisma.alert.update({
      where: { id },
      data: { resolved: true },
      select: {
        id: true,
        alertType: true,
        message: true,
        severity: true,
        resolved: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ alert: updated })
  } catch (error) {
    console.error('[alerts] PATCH error:', error)
    return NextResponse.json(
      { error: 'Failed to update alert' },
      { status: 500 }
    )
  }
}
