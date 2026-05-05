import { NextResponse } from 'next/server'
import { connect, getStatus } from '@/lib/whatsapp-baileys'

export async function POST() {
  console.log('[api/whatsapp/connect] POST')
  try {
    const result = await connect()
    console.log(`[api/whatsapp/connect] POST result status=${result.status}${result.error ? ` error=${result.error}` : ''}`)
    return NextResponse.json(result)
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[api/whatsapp/connect] POST threw: ${msg}`)
    return NextResponse.json({ status: 'failed', error: msg }, { status: 500 })
  }
}

export async function GET() {
  const s = getStatus()
  // Compact GET log — UI polls every 2s so verbose here would drown actual signal.
  console.log(`[api/whatsapp/connect] GET status=${s.status} hasQr=${!!s.qrDataUrl}${s.error ? ` error=${s.error}` : ''}`)
  return NextResponse.json(s)
}
