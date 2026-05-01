import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getStatus } from '@/lib/whatsapp-baileys'


export async function GET() {
  let dbConnected = false

  try {
    await prisma.$queryRaw`SELECT 1`
    dbConnected = true
  } catch {}

  const wa = getStatus()

  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    dbConnected,
    whatsapp: wa.status,
    monitoredGroup: wa.monitoredGroup,
    messagesCapturedToday: wa.messagesCapturedToday,
  })
}
