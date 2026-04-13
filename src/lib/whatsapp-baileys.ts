/**
 * WhatsApp via Baileys — lightweight WebSocket connection.
 * Used for: reading group messages + sending daily reports to execs.
 * No Chromium needed. Session persists via auth state files.
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
} from '@whiskeysockets/baileys'
import QRCode from 'qrcode'
import { Boom } from '@hapi/boom'
import path from 'path'

export type BaileysStatus = 'disconnected' | 'qr_ready' | 'connecting' | 'connected' | 'failed'

interface BaileysState {
  status: BaileysStatus
  qrDataUrl: string | null
  error: string | null
  socket: WASocket | null
}

const state: BaileysState = {
  status: 'disconnected',
  qrDataUrl: null,
  error: null,
  socket: null,
}

const AUTH_DIR = path.join(process.cwd(), '.baileys_auth')

export function getStatus() {
  return {
    status: state.status,
    qrDataUrl: state.qrDataUrl,
    error: state.error,
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
      printQRInTerminal: true,
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
          console.log('[Baileys] Logged out')
        } else {
          // Reconnect on other disconnect reasons
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

    state.socket = sock
    return { status: state.status }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    state.status = 'failed'
    state.error = msg
    return { status: 'failed', error: msg }
  }
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
 * Send a text message to a WhatsApp number.
 * @param phone — phone number with country code, no +. e.g. "919876543210"
 * @param message — text message to send
 */
export async function sendMessage(phone: string, message: string): Promise<boolean> {
  if (!state.socket || state.status !== 'connected') {
    throw new Error('WhatsApp not connected')
  }

  // Ensure JID format
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

/**
 * Send daily report to a WhatsApp number.
 */
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
    report.alerts.forEach(a => {
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

/**
 * Read messages from a WhatsApp group.
 * Note: Baileys only receives real-time messages after connection.
 * For historical messages, use the file upload approach.
 */
export async function getGroupMessages(groupName: string): Promise<string[]> {
  if (!state.socket || state.status !== 'connected') {
    throw new Error('WhatsApp not connected')
  }

  // Find group by name
  const groups = await state.socket.groupFetchAllParticipating()
  const group = Object.values(groups).find(g =>
    g.subject.toLowerCase().includes(groupName.toLowerCase())
  )

  if (!group) {
    const available = Object.values(groups).map(g => g.subject).join(', ')
    throw new Error(`Group "${groupName}" not found. Available: ${available}`)
  }

  console.log(`[Baileys] Found group: ${group.subject} (${group.id})`)

  // Note: Baileys doesn't fetch historical messages easily.
  // For historical data, use the file upload flow.
  // This function is mainly for listing groups and verifying connection.
  return [`Group found: ${group.subject}, ${group.participants.length} members`]
}
