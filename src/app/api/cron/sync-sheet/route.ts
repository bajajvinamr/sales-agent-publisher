import { NextResponse } from 'next/server'
import { syncPendingVisits } from '@/lib/pipeline/sync-sheet'

export const dynamic = 'force-dynamic'

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const header = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  if (header === expected) return true

  return false
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await syncPendingVisits()
  const status = result.error ? 500 : 200
  return NextResponse.json(result, { status })
}

export async function POST(request: Request) {
  return GET(request)
}
