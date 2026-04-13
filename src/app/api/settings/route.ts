import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { z } from 'zod'

export async function GET() {
  try {
    const settings = await prisma.settings.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        dailyTargetVisits: 8,
        alertEmailTo: '',
        managerEmail: '',
        whatsappGroupName: '',
      },
      update: {},
      select: {
        id: true,
        dailyTargetVisits: true,
        alertEmailTo: true,
        managerEmail: true,
        whatsappGroupName: true,
        sessionStartDate: true,
        sessionEndDate: true,
        updatedAt: true,
      },
    })

    return NextResponse.json({ settings })
  } catch (error) {
    console.error('[settings] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to load settings' },
      { status: 500 }
    )
  }
}

const patchSettingsSchema = z.object({
  dailyTargetVisits: z.number().int().min(1).max(50).optional(),
  alertEmailTo: z.string().email().optional().or(z.literal('')),
  managerEmail: z.string().email().optional().or(z.literal('')),
  whatsappGroupName: z.string().max(200).optional(),
  sessionStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  sessionEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
})

export async function PATCH(request: Request) {
  try {
    const body: unknown = await request.json()
    const parsed = patchSettingsSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid settings payload', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const updates = parsed.data

    // Convert date strings to Date objects for Prisma
    const data: Record<string, unknown> = { ...updates }
    if (typeof updates.sessionStartDate === 'string') {
      data.sessionStartDate = new Date(updates.sessionStartDate)
    } else if (updates.sessionStartDate === null) {
      data.sessionStartDate = null
    }
    if (typeof updates.sessionEndDate === 'string') {
      data.sessionEndDate = new Date(updates.sessionEndDate)
    } else if (updates.sessionEndDate === null) {
      data.sessionEndDate = null
    }

    const settings = await prisma.settings.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        dailyTargetVisits: (updates.dailyTargetVisits ?? 8),
        alertEmailTo: (updates.alertEmailTo ?? ''),
        managerEmail: (updates.managerEmail ?? ''),
        whatsappGroupName: (updates.whatsappGroupName ?? ''),
        sessionStartDate:
          typeof updates.sessionStartDate === 'string'
            ? new Date(updates.sessionStartDate)
            : null,
        sessionEndDate:
          typeof updates.sessionEndDate === 'string'
            ? new Date(updates.sessionEndDate)
            : null,
      },
      update: data,
      select: {
        id: true,
        dailyTargetVisits: true,
        alertEmailTo: true,
        managerEmail: true,
        whatsappGroupName: true,
        sessionStartDate: true,
        sessionEndDate: true,
        updatedAt: true,
      },
    })

    return NextResponse.json({ settings })
  } catch (error) {
    console.error('[settings] PATCH error:', error)
    return NextResponse.json(
      { error: 'Failed to update settings' },
      { status: 500 }
    )
  }
}
