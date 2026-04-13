import { NextResponse } from 'next/server'
import { scrapeGroup, getStatus } from '@/lib/whatsapp-manager'
import { prisma } from '@/lib/db'

export async function POST(req: Request) {
  try {
    const { status } = getStatus()
    if (status !== 'connected') {
      return NextResponse.json({ error: 'WhatsApp not connected. Connect first.' }, { status: 400 })
    }

    const body = await req.json()
    const groupName = body.groupName || ''
    const date = body.date || new Date().toISOString().slice(0, 10)

    if (!groupName) {
      // Try to get from settings
      const settings = await prisma.settings.findUnique({ where: { id: 'default' } })
      if (!settings?.whatsappGroupName) {
        return NextResponse.json({ error: 'No group name provided. Set it in Settings.' }, { status: 400 })
      }
      const messages = await scrapeGroup(settings.whatsappGroupName, date)
      return NextResponse.json({ success: true, messageCount: messages.length, messages })
    }

    const messages = await scrapeGroup(groupName, date)
    return NextResponse.json({ success: true, messageCount: messages.length, messages })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Scrape failed' },
      { status: 500 }
    )
  }
}
