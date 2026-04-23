import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { generateDailyReportExcelFromDb } from '@/lib/pipeline/excel-export'

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
        principalDob: true,
        bookSeller: true,
        remark: true,
        remarkDetail: true,
        locationUrl: true,
        dataComplete: true,
        missingFields: true,
        isRepeatVisit: true,
        visitNumberInSession: true,
        executive: { select: { id: true, displayName: true } },
        school: { select: { id: true, canonicalName: true } },
      },
    })

    const buffer = await generateDailyReportExcelFromDb(visits, date)

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="report-${date}.xlsx"`,
        'Content-Length': buffer.byteLength.toString(),
      },
    })
  } catch (error) {
    console.error('[reports/date/excel] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to generate Excel report' },
      { status: 500 }
    )
  }
}
