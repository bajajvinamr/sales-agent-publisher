import { NextResponse } from 'next/server'
import { startMonitoringGroup, listGroups, getStatus } from '@/lib/whatsapp-baileys'

// POST — start monitoring a group
export async function POST(req: Request) {
  try {
    const { status } = getStatus()
    if (status !== 'connected') {
      return NextResponse.json({ error: 'WhatsApp not connected' }, { status: 400 })
    }

    const body = await req.json()
    const groupName = body.groupName

    if (!groupName) {
      return NextResponse.json({ error: 'groupName required' }, { status: 400 })
    }

    const result = await startMonitoringGroup(groupName)
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}

// GET — list available groups
export async function GET() {
  try {
    const { status } = getStatus()
    if (status !== 'connected') {
      return NextResponse.json({ error: 'WhatsApp not connected', groups: [] }, { status: 400 })
    }

    const groups = await listGroups()
    return NextResponse.json({ groups })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed', groups: [] },
      { status: 500 }
    )
  }
}
