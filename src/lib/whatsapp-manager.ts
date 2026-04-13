/**
 * WhatsApp Manager — singleton that holds the whatsapp-web.js client state.
 * Lives in the Next.js server process. Exposes status, QR, and scrape methods via API routes.
 */

import { Client, LocalAuth, type Message } from 'whatsapp-web.js'
import QRCode from 'qrcode'
import type { RawMessage } from '@/types'

export type WaStatus = 'disconnected' | 'qr_ready' | 'connecting' | 'connected' | 'failed'

interface WaState {
  status: WaStatus
  qrDataUrl: string | null
  error: string | null
  lastScrapeDate: string | null
  client: Client | null
}

const state: WaState = {
  status: 'disconnected',
  qrDataUrl: null,
  error: null,
  lastScrapeDate: null,
  client: null,
}

// Prevent multiple initializations in dev (hot reload)
const globalForWa = globalThis as unknown as { __waInitialized?: boolean }

export function getStatus() {
  return {
    status: state.status,
    qrDataUrl: state.qrDataUrl,
    error: state.error,
    lastScrapeDate: state.lastScrapeDate,
  }
}

export async function startClient(): Promise<{ status: WaStatus; error?: string }> {
  // Already running
  if (state.client && (state.status === 'connected' || state.status === 'qr_ready' || state.status === 'connecting')) {
    return { status: state.status }
  }

  try {
    state.status = 'connecting'
    state.error = null
    state.qrDataUrl = null

    // Clean up stale browser lock if exists
    const fs = await import('fs')
    const path = await import('path')
    const lockFiles = [
      path.join('.wwebjs_auth', 'session', 'SingletonLock'),
      path.join('.wwebjs_auth', 'session', 'SingletonCookie'),
      path.join('.wwebjs_auth', 'session', 'SingletonSocket'),
    ]
    for (const lock of lockFiles) {
      try { fs.unlinkSync(lock) } catch {}
    }

    const client = new Client({
      authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          '--disable-extensions',
          '--no-first-run',
        ],
      },
    })

    client.on('qr', async (qr: string) => {
      try {
        state.qrDataUrl = await QRCode.toDataURL(qr, { width: 256, margin: 2 })
        state.status = 'qr_ready'
        console.log('[WhatsApp] QR code ready — scan with your phone')
      } catch (e) {
        console.error('[WhatsApp] QR generation error:', e)
      }
    })

    client.on('ready', () => {
      state.status = 'connected'
      state.qrDataUrl = null
      console.log('[WhatsApp] Client ready and connected')
    })

    client.on('authenticated', () => {
      console.log('[WhatsApp] Authenticated')
      state.status = 'connecting' // still loading after auth
    })

    client.on('auth_failure', (msg: string) => {
      state.status = 'failed'
      state.error = `Auth failed: ${msg}`
      console.error('[WhatsApp] Auth failure:', msg)
    })

    client.on('disconnected', (reason: string) => {
      state.status = 'disconnected'
      state.error = `Disconnected: ${reason}`
      state.client = null
      console.log('[WhatsApp] Disconnected:', reason)
    })

    state.client = client
    await client.initialize()
    return { status: state.status }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    state.status = 'failed'
    state.error = msg
    state.client = null
    return { status: 'failed', error: msg }
  }
}

export async function disconnect(): Promise<void> {
  if (state.client) {
    try { await state.client.destroy() } catch {}
    state.client = null
  }
  state.status = 'disconnected'
  state.qrDataUrl = null
  state.error = null
}

export async function scrapeGroup(groupName: string, targetDate: string): Promise<RawMessage[]> {
  if (!state.client || state.status !== 'connected') {
    throw new Error('WhatsApp not connected')
  }

  const chats = await state.client.getChats()
  const group = chats.find(c => c.isGroup && c.name.toLowerCase().includes(groupName.toLowerCase()))

  if (!group) {
    throw new Error(`Group "${groupName}" not found. Available groups: ${chats.filter(c => c.isGroup).map(c => c.name).join(', ')}`)
  }

  console.log(`[WhatsApp] Scraping group: ${group.name}`)

  // Fetch messages (whatsapp-web.js fetches in batches)
  const messages = await group.fetchMessages({ limit: 500 })

  // Filter to target date
  const target = new Date(targetDate + 'T00:00:00')
  const targetEnd = new Date(targetDate + 'T23:59:59')

  const filtered: RawMessage[] = []
  for (const msg of messages) {
    const ts = new Date(msg.timestamp * 1000)
    if (ts >= target && ts <= targetEnd) {
      filtered.push(mapMessage(msg, ts))
    }
  }

  // Sort by time
  filtered.sort((a, b) => a.time.localeCompare(b.time))

  state.lastScrapeDate = targetDate
  console.log(`[WhatsApp] Scraped ${filtered.length} messages for ${targetDate}`)

  return filtered
}

function mapMessage(msg: Message, ts: Date): RawMessage {
  const date = ts.toISOString().slice(0, 10)
  const time = ts.toTimeString().slice(0, 5)

  // Sender name
  const sender = ((msg as any)._data?.notifyName as string | undefined)
    ?? msg.author
    ?? msg.from
    ?? 'Unknown'

  // Detect type
  const msgType = msg.type as string
  let messageType: RawMessage['messageType'] = 'Text'
  let url: string | undefined

  if (msgType === 'location' || msgType === 'live_location') {
    messageType = msgType === 'live_location' ? 'LiveLocation' : 'Location'
    const loc = msg.location as unknown as { latitude?: number; longitude?: number } | undefined
    if (loc?.latitude != null && loc?.longitude != null) {
      url = `https://maps.google.com/?q=${loc.latitude},${loc.longitude}`
    }
  } else if (msgType === 'image' || msgType === 'video' || msgType === 'audio' || msgType === 'document' || msgType === 'sticker' || msgType === 'ptt') {
    messageType = 'MediaOmitted'
  } else if (msgType === 'revoked') {
    messageType = 'Deleted'
  } else if (msg.body?.includes('http')) {
    messageType = 'Link'
  }

  return {
    date,
    time,
    sender,
    message: msg.body || '',
    messageType,
    url,
  }
}
