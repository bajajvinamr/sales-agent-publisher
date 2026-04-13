// ═══════════════════════════════════════════════════════════════
// WhatsApp Web client — scrapes messages from a group chat
// Uses whatsapp-web.js with LocalAuth for session persistence
// ═══════════════════════════════════════════════════════════════

import { Client, LocalAuth, Message, Chat } from 'whatsapp-web.js'
import qrcode from 'qrcode-terminal'
import { EventEmitter } from 'events'
import { format } from 'date-fns'
import type { RawMessage } from '../types/index.js'

type ConnectionStatus = 'connected' | 'disconnected' | 'connecting'

export class WhatsAppScraper extends EventEmitter {
  private client: Client
  private status: ConnectionStatus = 'disconnected'

  constructor() {
    super()

    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: '.wwebjs_auth',
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
        ],
      },
    })

    this._bindClientEvents()
  }

  // ── Event wiring ──────────────────────────────────────────────

  private _bindClientEvents(): void {
    this.client.on('qr', (qr: string) => {
      console.log('\n[WhatsApp] Scan this QR code to authenticate:\n')
      qrcode.generate(qr, { small: true })
      this.emit('qr', qr)
    })

    this.client.on('authenticated', () => {
      console.log('[WhatsApp] Authenticated — session saved.')
    })

    this.client.on('auth_failure', (message: string) => {
      console.error(`[WhatsApp] Auth failure: ${message}`)
      this.status = 'disconnected'
      this.emit('auth_failure', message)
    })

    this.client.on('ready', () => {
      console.log('[WhatsApp] Client ready.')
      this.status = 'connected'
      this.emit('ready')
    })

    this.client.on('disconnected', (reason: string) => {
      console.warn(`[WhatsApp] Disconnected: ${reason}`)
      this.status = 'disconnected'
      this.emit('disconnected', reason)
      // Attempt reconnect after a short delay
      setTimeout(() => {
        console.log('[WhatsApp] Attempting reconnect…')
        this.initialize().catch((err: unknown) => {
          console.error('[WhatsApp] Reconnect failed:', err instanceof Error ? err.message : String(err))
        })
      }, 5_000)
    })
  }

  // ── Public API ────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.status === 'connecting' || this.status === 'connected') {
      return
    }
    this.status = 'connecting'
    try {
      await this.client.initialize()
    } catch (err: unknown) {
      this.status = 'disconnected'
      throw new Error(
        `[WhatsApp] Failed to initialize: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  /** Wait until the client emits 'ready', up to timeoutMs (default 120 s). */
  waitForReady(timeoutMs = 120_000): Promise<void> {
    if (this.status === 'connected') return Promise.resolve()

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('[WhatsApp] Timed out waiting for ready state'))
      }, timeoutMs)

      this.once('ready', () => {
        clearTimeout(timer)
        resolve()
      })

      this.once('auth_failure', (msg: string) => {
        clearTimeout(timer)
        reject(new Error(`[WhatsApp] Auth failure: ${msg}`))
      })
    })
  }

  /**
   * Fetch all messages in a group chat for a given date.
   *
   * @param groupName - Exact or partial display name of the group
   * @param date      - "YYYY-MM-DD"
   */
  async getGroupMessages(groupName: string, date: string): Promise<RawMessage[]> {
    if (this.status !== 'connected') {
      throw new Error('[WhatsApp] Client is not connected. Call initialize() and wait for ready.')
    }

    // Find the group
    const chats: Chat[] = await this.client.getChats()
    const group = chats.find(
      (c) => c.isGroup && c.name.toLowerCase().includes(groupName.toLowerCase())
    )

    if (!group) {
      throw new Error(
        `[WhatsApp] Group not found: "${groupName}". Available groups: ${chats
          .filter((c) => c.isGroup)
          .map((c) => c.name)
          .join(', ')}`
      )
    }

    console.log(`[WhatsApp] Found group: "${group.name}" — fetching messages for ${date}`)

    // Fetch a generous window; WhatsApp limits how far back you can go
    const messages: Message[] = await group.fetchMessages({ limit: 500 })

    // Normalise to YYYY-MM-DD so partial or differently-formatted inputs still work
    const targetDateStr = format(new Date(date), 'yyyy-MM-dd')

    const rawMessages: RawMessage[] = messages
      .map((msg) => this._mapMessage(msg))
      .filter((rm) => rm.date === targetDateStr)

    console.log(`[WhatsApp] ${rawMessages.length} messages found for ${targetDateStr}`)
    return rawMessages
  }

  getConnectionStatus(): ConnectionStatus {
    return this.status
  }

  async destroy(): Promise<void> {
    try {
      await this.client.destroy()
      this.status = 'disconnected'
      console.log('[WhatsApp] Client destroyed cleanly.')
    } catch (err: unknown) {
      console.error(
        '[WhatsApp] Error during destroy:',
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  // ── Private helpers ───────────────────────────────────────────

  private _mapMessage(msg: Message): RawMessage {
    const ts = new Date(msg.timestamp * 1000)
    const date = format(ts, 'yyyy-MM-dd')
    const time = format(ts, 'HH:mm')

    const sender =
      (msg.author
        ? ((msg as any)._data?.notifyName as string | undefined) ?? msg.author
        : ((msg as any)._data?.notifyName as string | undefined) ?? msg.from) || 'Unknown'

    const { messageType, url } = this._detectTypeAndUrl(msg)

    return {
      date,
      time,
      sender,
      message: msg.body ?? '',
      messageType,
      ...(url ? { url } : {}),
    }
  }

  private _detectTypeAndUrl(msg: Message): {
    messageType: RawMessage['messageType']
    url?: string
  } {
    // Deleted message
    if (msg.type === 'revoked') {
      return { messageType: 'Deleted' }
    }

    // Location / live location
    const msgType = msg.type as string
    if (msgType === 'location' || msgType === 'live_location') {
      const isLive = msgType === 'live_location'
      const loc = msg.location as unknown as { latitude?: number; longitude?: number } | undefined
      const url =
        loc?.latitude != null && loc?.longitude != null
          ? `https://maps.google.com/?q=${loc.latitude},${loc.longitude}`
          : undefined
      return { messageType: isLive ? 'LiveLocation' : 'Location', url }
    }

    // Media (image / video / audio / document / sticker)
    if (['image', 'video', 'audio', 'ptt', 'document', 'sticker'].includes(msg.type)) {
      return { messageType: 'MediaOmitted' }
    }

    // Text — check for Maps URLs
    const body = msg.body ?? ''
    const mapsMatch = body.match(
      /(https?:\/\/(maps\.google\.[a-z.]+\/[^\s]+|goo\.gl\/maps\/[^\s]+|google\.[a-z.]+\/maps[^\s]*))/i
    )
    if (mapsMatch) {
      return { messageType: 'Location', url: mapsMatch[1] }
    }

    // Generic link
    if (/https?:\/\//.test(body)) {
      return { messageType: 'Link' }
    }

    return { messageType: 'Text' }
  }
}

// ── Singleton ─────────────────────────────────────────────────
export const whatsappScraper = new WhatsAppScraper()
