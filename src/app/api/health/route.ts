import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET() {
  let dbConnected = false

  try {
    await prisma.$queryRaw`SELECT 1`
    dbConnected = true
  } catch {
    // DB unavailable — still return 200 with status info
  }

  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    dbConnected,
  })
}
