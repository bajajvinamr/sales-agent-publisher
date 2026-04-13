import { NextResponse } from 'next/server'
import { connect, getStatus } from '@/lib/whatsapp-baileys'

export async function POST() {
  try {
    const result = await connect()
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { status: 'failed', error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json(getStatus())
}
