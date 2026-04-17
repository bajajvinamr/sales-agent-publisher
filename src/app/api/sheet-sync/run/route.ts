import { NextResponse } from 'next/server'
import { syncPendingVisits } from '@/lib/pipeline/sync-sheet'

export const dynamic = 'force-dynamic'

/**
 * Manual "Sync Now" triggered from the Settings page.
 * Same-origin enforcement: the Origin/Referer host must match the request host.
 * Cron systems should hit /api/cron/sync-sheet (Bearer-token auth) instead.
 */
function sameOrigin(request: Request): boolean {
  const host = request.headers.get('host')
  if (!host) return false

  const originHeader = request.headers.get('origin') || request.headers.get('referer')
  if (!originHeader) return false

  try {
    return new URL(originHeader).host === host
  } catch {
    return false
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const result = await syncPendingVisits()
  const status = result.error ? 500 : 200
  return NextResponse.json(result, { status })
}
