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
        managerPhone: true,
        whatsappGroupName: true,
        sessionStartDate: true,
        sessionEndDate: true,
        googleSheetId: true,
        googleSheetTab: true,
        sheetSyncEnabled: true,
        lastSheetSyncAt: true,
        lastSheetSyncError: true,
        updatedAt: true,
      },
    })

    const pendingSheetRows = await prisma.visit.count({
      where: { sheetAppendedAt: null },
    })

    const { getServiceAccountEmail } = await import(
      '@/lib/integrations/google-sheets'
    )
    const serviceAccountEmail = getServiceAccountEmail()

    return NextResponse.json({
      settings,
      sheetSync: {
        pendingRows: pendingSheetRows,
        serviceAccountEmail,
        credentialsConfigured: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      },
    })
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
  managerPhone: z.string().regex(/^\+?\d{10,15}$/).optional().or(z.literal('')),
  whatsappGroupName: z.string().max(200).optional(),
  sessionStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  sessionEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  googleSheetId: z.string().max(200).optional(),
  googleSheetTab: z.string().min(1).max(100).optional(),
  sheetSyncEnabled: z.boolean().optional(),
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

    // Normalize Google Sheet URL → ID if user pasted the full URL
    if (typeof updates.googleSheetId === 'string' && updates.googleSheetId.includes('/')) {
      const match = updates.googleSheetId.match(/\/d\/([a-zA-Z0-9-_]+)/)
      if (match) updates.googleSheetId = match[1]
    }

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
        managerPhone: true,
        whatsappGroupName: true,
        sessionStartDate: true,
        sessionEndDate: true,
        googleSheetId: true,
        googleSheetTab: true,
        sheetSyncEnabled: true,
        lastSheetSyncAt: true,
        lastSheetSyncError: true,
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
