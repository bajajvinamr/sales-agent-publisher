import { NextResponse } from 'next/server'
import { disconnect } from '@/lib/whatsapp-baileys'

export async function POST() {
  try {
    await disconnect()
    return NextResponse.json({ status: 'disconnected' })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Disconnect failed' },
      { status: 500 }
    )
  }
}
