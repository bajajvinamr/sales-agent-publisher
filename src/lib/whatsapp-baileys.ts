/**
 * WhatsApp via Baileys — lightweight WebSocket connection.
 * - Captures group messages in real-time (no upload needed after connect)
 * - Sends daily reports to manager/execs via WhatsApp
 * - Session persists to disk (.baileys_auth/)
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
  type WAMessage,
  type BaileysEventMap,
} from '@whiskeysockets/baileys'
import QRCode from 'qrcode'
import { Boom } from '@hapi/boom'
import path from 'path'
import type { RawMessage } from '@/types'

export type BaileysStatus = 'disconnected' | 'qr_ready' | 'connecting' | 'connected' | 'failed'

interface BaileysState {
  status: BaileysStatus
  qrDataUrl: string | null
  error: string | null
  socket: WASocket | null
  // Real-time message capture
  capturedMessages: RawMessage[]
  monitoredGroupJid: string | null
  monitoredGroupName: string | null
  captureStartDate: string | null // YYYY-MM-DD
  messagesCapturedToday: number
}

const state: BaileysState = {
  status: 'disconnected',
  qrDataUrl: null,
  error: null,
  socket: null,
  capturedMessages: [],
  monitoredGroupJid: null,
  monitoredGroupName: null,
  captureStartDate: null,
  messagesCapturedToday: 0,
}

const AUTH_DIR = path.join(process.cwd(), '.baileys_auth')

export function getStatus() {
  const today = new Date().toISOString().slice(0, 10)
  return {
    status: state.status,
    qrDataUrl: state.qrDataUrl,
    error: state.error,
    monitoredGroup: state.monitoredGroupName,
    messagesCapturedToday: state.captureStartDate === today ? state.messagesCapturedToday : 0,
    totalCaptured: state.capturedMessages.length,
  }
}

/**
 * Get all captured messages for today (or a specific date).
 * These are ready to be sent to /api/ingest.
 */
export function getCapturedMessages(date?: string): RawMessage[] {
  const target = date || new Date().toISOString().slice(0, 10)
  return state.capturedMessages.filter(m => m.date === target)
}

/** Clear captured messages after successful ingestion */
export function clearCapturedMessages(date?: string) {
  if (date) {
    state.capturedMessages = state.capturedMessages.filter(m => m.date !== date)
  } else {
    state.capturedMessages = []
  }
}

export async function connect(): Promise<{ status: BaileysStatus; error?: string }> {
  if (state.socket && state.status === 'connected') {
    return { status: 'connected' }
  }

  try {
    state.status = 'connecting'
    state.error = null
    state.qrDataUrl = null

    const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
      version,
      auth: authState,
      generateHighQualityLinkPreview: false,
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        try {
          state.qrDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 })
          state.status = 'qr_ready'
          console.log('[Baileys] QR code ready — scan with your phone')
        } catch (e) {
          console.error('[Baileys] QR generation error:', e)
        }
      }

      if (connection === 'close') {
        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode
        if (reason === DisconnectReason.loggedOut) {
          state.status = 'disconnected'
          state.error = 'Logged out. Please reconnect.'
          state.socket = null
        } else {
          console.log('[Baileys] Disconnected, reconnecting...', reason)
          state.status = 'connecting'
          setTimeout(() => connect(), 3000)
        }
      }

      if (connection === 'open') {
        state.status = 'connected'
        state.qrDataUrl = null
        state.error = null
        console.log('[Baileys] Connected!')
      }
    })

    // ── Real-time message listener ─────────────────────────────
    sock.ev.on('messages.upsert', async (m: BaileysEventMap['messages.upsert']) => {
      if (m.type !== 'notify') return // only new messages, not history sync

      for (const msg of m.messages) {
        // Skip if no monitored group set
        if (!state.monitoredGroupJid) continue
        // Only capture from the monitored group
        if (msg.key.remoteJid !== state.monitoredGroupJid) continue
        // Skip messages sent by us
        if (msg.key.fromMe) continue

        const parsed = parseWAMessage(msg)
        if (parsed) {
          // Cap at 5000 messages to prevent OOM
          if (state.capturedMessages.length >= 5000) state.capturedMessages.shift()
          state.capturedMessages.push(parsed)
          const today = new Date().toISOString().slice(0, 10)
          if (state.captureStartDate === today) {
            state.messagesCapturedToday++
          } else {
            state.captureStartDate = today
            state.messagesCapturedToday = 1
          }
          console.log(`[Baileys] Captured message from ${parsed.sender}: ${parsed.message.slice(0, 60)}...`)
        }
      }
    })

    state.socket = sock
    return { status: state.status }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    state.status = 'failed'
    state.error = msg
    return { status: 'failed', error: msg }
  }
}

/** Parse a Baileys WAMessage into our RawMessage format */
function parseWAMessage(msg: WAMessage): RawMessage | null {
  const body = msg.message?.conversation
    || msg.message?.extendedTextMessage?.text
    || ''

  if (!body && !msg.message?.locationMessage) return null

  const ts = msg.messageTimestamp
    ? new Date(Number(msg.messageTimestamp) * 1000)
    : new Date()

  const date = ts.toISOString().slice(0, 10)
  const time = ts.toTimeString().slice(0, 5)
  const sender = msg.pushName || msg.key.participant || msg.key.remoteJid || 'Unknown'

  // Detect message type
  let messageType: RawMessage['messageType'] = 'Text'
  let url: string | undefined

  if (msg.message?.locationMessage || msg.message?.liveLocationMessage) {
    messageType = msg.message?.liveLocationMessage ? 'LiveLocation' : 'Location'
    const loc = msg.message?.locationMessage || msg.message?.liveLocationMessage
    if (loc?.degreesLatitude && loc?.degreesLongitude) {
      url = `https://maps.google.com/?q=${loc.degreesLatitude},${loc.degreesLongitude}`
    }
  } else if (msg.message?.imageMessage || msg.message?.videoMessage || msg.message?.audioMessage || msg.message?.documentMessage || msg.message?.stickerMessage) {
    messageType = 'MediaOmitted'
  }

  return { date, time, sender, message: body, messageType, url }
}

export async function disconnect() {
  if (state.socket) {
    state.socket.end(undefined)
    state.socket = null
  }
  state.status = 'disconnected'
  state.qrDataUrl = null
}

/**
 * Start monitoring a WhatsApp group for messages.
 * Call this after connecting and setting the group name in settings.
 */
export async function startMonitoringGroup(groupName: string): Promise<{ success: boolean; groupName?: string; error?: string }> {
  if (!state.socket || state.status !== 'connected') {
    return { success: false, error: 'WhatsApp not connected' }
  }

  try {
    const groups = await state.socket.groupFetchAllParticipating()
    const group = Object.values(groups).find(g =>
      g.subject.toLowerCase().includes(groupName.toLowerCase())
    )

    if (!group) {
      const available = Object.values(groups).map(g => g.subject).slice(0, 10).join(', ')
      return { success: false, error: `Group "${groupName}" not found. Available: ${available}` }
    }

    state.monitoredGroupJid = group.id
    state.monitoredGroupName = group.subject
    state.captureStartDate = new Date().toISOString().slice(0, 10)
    state.messagesCapturedToday = 0

    console.log(`[Baileys] Now monitoring group: ${group.subject} (${group.id})`)
    return { success: true, groupName: group.subject }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Failed to find group' }
  }
}

/** List available WhatsApp groups */
export async function listGroups(): Promise<{ name: string; id: string; participants: number }[]> {
  if (!state.socket || state.status !== 'connected') {
    throw new Error('WhatsApp not connected')
  }

  const groups = await state.socket.groupFetchAllParticipating()
  return Object.values(groups).map(g => ({
    name: g.subject,
    id: g.id,
    participants: g.participants.length,
  }))
}

/** Send a text message to a WhatsApp number */
export async function sendMessage(phone: string, message: string): Promise<boolean> {
  if (!state.socket || state.status !== 'connected') {
    throw new Error('WhatsApp not connected')
  }

  const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`

  try {
    await state.socket.sendMessage(jid, { text: message })
    console.log(`[Baileys] Sent message to ${phone}`)
    return true
  } catch (e) {
    console.error(`[Baileys] Failed to send to ${phone}:`, e)
    return false
  }
}

/** Send formatted daily report to a WhatsApp number */
export async function sendDailyReport(phone: string, report: {
  date: string
  totalVisits: number
  execsReporting: number
  totalExecs: number
  targetsMet: number
  topPerformers: { name: string; visits: number }[]
  alerts: { exec: string; message: string }[]
  summaryText?: string
}): Promise<boolean> {
  const lines: string[] = [
    `📊 *Sales Tracker — Daily Report*`,
    `📅 ${report.date}`,
    ``,
    `*Summary*`,
    `• Total visits: ${report.totalVisits}`,
    `• Reporting: ${report.execsReporting}/${report.totalExecs}`,
    `• Targets met: ${report.targetsMet}/${report.totalExecs}`,
    ``,
  ]

  if (report.topPerformers.length > 0) {
    lines.push(`*Top Performers*`)
    report.topPerformers.forEach((p, i) => {
      lines.push(`${i + 1}. ${p.name}: ${p.visits} visits`)
    })
    lines.push(``)
  }

  if (report.alerts.length > 0) {
    lines.push(`⚠️ *Alerts*`)
    report.alerts.slice(0, 5).forEach(a => {
      lines.push(`• ${a.exec}: ${a.message}`)
    })
    lines.push(``)
  }

  if (report.summaryText) {
    lines.push(`*AI Summary*`)
    lines.push(report.summaryText)
  }

  return sendMessage(phone, lines.join('\n'))
}
