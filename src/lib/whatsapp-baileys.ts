/**
 * WhatsApp via Baileys — gateway-style lifecycle.
 *
 * State machine: disconnected → connecting → qr_ready → connecting → connected
 * Errors classified as: loggedOut | restartRequired | replaced | transient
 *
 * Public API is unchanged — callers in src/app/api/whatsapp/* keep working.
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
import path from 'node:path'
import { rm } from 'node:fs/promises'
import type { RawMessage } from '@/types'

// ── Types ────────────────────────────────────────────────────────────────────

export type BaileysStatus = 'disconnected' | 'qr_ready' | 'connecting' | 'connected' | 'failed'

type DisconnectKind = 'loggedOut' | 'restartRequired' | 'replaced' | 'transient'

interface BaileysState {
  status: BaileysStatus
  qrDataUrl: string | null
  error: string | null
  socket: WASocket | null
  connectingPromise: Promise<{ status: BaileysStatus; error?: string }> | null
  reconnectAttempts: number
  lastConnectedAt: number | null
  reconnectTimer: ReturnType<typeof setTimeout> | null
  // True while disconnect() is running. Causes connect/scheduleReconnect/close
  // handler to bail so a late event can't undo the disconnect.
  shuttingDown: boolean
  // Real-time message capture
  capturedMessages: RawMessage[]
  monitoredGroupJid: string | null
  monitoredGroupName: string | null
  captureStartDate: string | null // YYYY-MM-DD
  messagesCapturedToday: number
}

const AUTH_DIR = path.join(process.cwd(), '.baileys_auth')

const RECONNECT_POLICY = {
  initialMs: 2_000,
  maxMs: 30_000,
  factor: 1.8,
  jitter: 0.25,
  maxAttempts: 12,
  // After this much continuous uptime, treat the connection as healthy and
  // reset the attempt counter so a future drop starts a fresh backoff curve.
  healthyAfterMs: 60_000,
}

const state: BaileysState = {
  status: 'disconnected',
  qrDataUrl: null,
  error: null,
  socket: null,
  connectingPromise: null,
  reconnectAttempts: 0,
  lastConnectedAt: null,
  reconnectTimer: null,
  shuttingDown: false,
  capturedMessages: [],
  monitoredGroupJid: null,
  monitoredGroupName: null,
  captureStartDate: null,
  messagesCapturedToday: 0,
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

export function getStatusCode(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined
  const e = err as {
    output?: { statusCode?: number }
    status?: number
    error?: { output?: { statusCode?: number } }
  }
  return e.output?.statusCode ?? e.status ?? e.error?.output?.statusCode
}

export function classifyDisconnect(err: unknown): DisconnectKind {
  const code = getStatusCode(err)
  if (code === DisconnectReason.loggedOut) return 'loggedOut'
  if (code === DisconnectReason.restartRequired) return 'restartRequired'
  // 440 = replaced (another device opened this session)
  if (code === DisconnectReason.connectionReplaced) return 'replaced'
  return 'transient'
}

export function computeBackoff(attempt: number): number {
  const { initialMs, maxMs, factor, jitter } = RECONNECT_POLICY
  const base = Math.min(maxMs, initialMs * Math.pow(factor, Math.max(0, attempt - 1)))
  const j = base * jitter * (Math.random() * 2 - 1)
  return Math.max(initialMs, Math.round(base + j))
}

function formatErr(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  const code = getStatusCode(err)
  return code ? `status=${code}` : String(err)
}

async function wipeAuthDir(): Promise<void> {
  try {
    await rm(AUTH_DIR, { recursive: true, force: true })
  } catch (e) {
    console.warn('[Baileys] Failed to wipe auth dir:', formatErr(e))
  }
}

function clearReconnectTimer(): void {
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer)
    state.reconnectTimer = null
  }
}

function teardownSocket(): void {
  const sock = state.socket
  state.socket = null
  if (!sock) return
  try {
    sock.ev.removeAllListeners('connection.update')
    sock.ev.removeAllListeners('messages.upsert')
    sock.ev.removeAllListeners('creds.update')
  } catch {
    // listeners may already be detached
  }
  try {
    sock.ws?.close?.()
  } catch {
    // best-effort
  }
}

// ── Public read API ──────────────────────────────────────────────────────────

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

export function getCapturedMessages(date?: string): RawMessage[] {
  const target = date || new Date().toISOString().slice(0, 10)
  return state.capturedMessages.filter((m) => m.date === target)
}

export function clearCapturedMessages(date?: string): void {
  if (date) {
    state.capturedMessages = state.capturedMessages.filter((m) => m.date !== date)
  } else {
    state.capturedMessages = []
  }
}

// ── Connect / Disconnect ─────────────────────────────────────────────────────

export async function connect(): Promise<{ status: BaileysStatus; error?: string }> {
  if (state.shuttingDown) {
    return { status: 'disconnected', error: 'Disconnect in progress' }
  }
  if (state.socket && state.status === 'connected') {
    return { status: 'connected' }
  }
  if (state.connectingPromise) {
    return state.connectingPromise
  }

  clearReconnectTimer()
  teardownSocket()

  state.connectingPromise = openSocket().finally(() => {
    state.connectingPromise = null
  })

  return state.connectingPromise
}

async function openSocket(): Promise<{ status: BaileysStatus; error?: string }> {
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
    state.socket = sock

    sock.ev.on('creds.update', saveCreds)
    sock.ev.on('connection.update', handleConnectionUpdate)
    sock.ev.on('messages.upsert', handleMessagesUpsert)

    return { status: state.status }
  } catch (e) {
    const msg = formatErr(e)
    state.status = 'failed'
    state.error = msg
    teardownSocket()
    return { status: 'failed', error: msg }
  }
}

async function handleConnectionUpdate(update: BaileysEventMap['connection.update']): Promise<void> {
  const { connection, lastDisconnect, qr } = update

  if (qr) {
    try {
      state.qrDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 })
      state.status = 'qr_ready'
      console.log('[Baileys] QR ready — scan with your phone')
    } catch (e) {
      console.error('[Baileys] QR generation error:', formatErr(e))
    }
  }

  if (connection === 'open') {
    state.status = 'connected'
    state.qrDataUrl = null
    state.error = null
    state.lastConnectedAt = Date.now()
    state.reconnectAttempts = 0
    console.log('[Baileys] Connected')
    return
  }

  if (connection === 'close') {
    if (state.shuttingDown) {
      // disconnect() owns cleanup; ignore any close events that arrive
      // mid-shutdown so we can't accidentally schedule a reconnect.
      return
    }
    const err = lastDisconnect?.error
    const kind = classifyDisconnect(err)
    const code = getStatusCode(err)
    console.log(`[Baileys] Closed: kind=${kind} code=${code ?? 'n/a'}`)

    teardownSocket()

    // Connection was healthy long enough to count as "good" — reset attempts.
    if (
      state.lastConnectedAt &&
      Date.now() - state.lastConnectedAt >= RECONNECT_POLICY.healthyAfterMs
    ) {
      state.reconnectAttempts = 0
    }
    state.lastConnectedAt = null

    if (kind === 'loggedOut') {
      // Phone unlinked the device, OR we just called logout(). Either way,
      // creds are now invalid — wipe them so the next connect() generates a
      // fresh QR instead of looping on stale creds.
      await wipeAuthDir()
      state.status = 'disconnected'
      state.qrDataUrl = null
      state.error = 'Logged out from WhatsApp. Click Connect to scan a new QR.'
      state.monitoredGroupJid = null
      state.monitoredGroupName = null
      return
    }

    if (kind === 'replaced') {
      // Another device took over this session — do not auto-reconnect, that
      // would just keep stealing the session back and forth.
      state.status = 'disconnected'
      state.qrDataUrl = null
      state.error = 'Another device opened this WhatsApp session.'
      return
    }

    if (kind === 'restartRequired') {
      // Status 515 — Baileys handshake completed and asks for a fresh socket.
      // This is normal during first-time pairing right after the QR scan.
      console.log('[Baileys] Restart required — reconnecting immediately')
      void scheduleReconnect(0)
      return
    }

    // Pairing timeout: close fires before user has ever connected. Baileys
    // emits 408 after ~6 unscanned QR refreshes ("QR refs attempts ended").
    // Treating this as transient + retrying just regenerates QRs the user
    // isn't watching anyway, hammering Baileys' QR allocator.
    if (state.lastConnectedAt === null && kind === 'transient') {
      state.status = 'failed'
      state.error = 'QR not scanned in time. Click Connect to generate a new QR.'
      state.qrDataUrl = null
      console.log('[Baileys] Pairing timed out — user did not scan')
      return
    }

    // Transient: WS dropped, network blip, server hiccup. Backoff + retry.
    state.reconnectAttempts += 1
    if (state.reconnectAttempts >= RECONNECT_POLICY.maxAttempts) {
      state.status = 'failed'
      state.error = `Reconnect failed after ${state.reconnectAttempts} attempts. ${formatErr(err)}`
      console.error('[Baileys]', state.error)
      return
    }
    const delay = computeBackoff(state.reconnectAttempts)
    console.log(`[Baileys] Reconnect attempt ${state.reconnectAttempts} in ${delay}ms`)
    void scheduleReconnect(delay)
  }
}

function scheduleReconnect(delayMs: number): Promise<void> {
  clearReconnectTimer()
  if (state.shuttingDown) return Promise.resolve()
  state.status = 'connecting'
  return new Promise<void>((resolve) => {
    state.reconnectTimer = setTimeout(async () => {
      state.reconnectTimer = null
      if (state.shuttingDown) {
        resolve()
        return
      }
      try {
        await connect()
      } catch (e) {
        console.error('[Baileys] Reconnect failed:', formatErr(e))
      } finally {
        resolve()
      }
    }, delayMs)
  })
}

export async function disconnect(): Promise<void> {
  state.shuttingDown = true
  try {
    clearReconnectTimer()

    // 1. Wait for any in-flight connect() to finish, otherwise its socket would
    //    survive our teardown and become a phantom connection.
    if (state.connectingPromise) {
      await state.connectingPromise.catch(() => {})
    }

    // 2. Detach listeners FIRST so the close event from logout/teardown can't
    //    re-enter handleConnectionUpdate and schedule a reconnect.
    const sock = state.socket
    state.socket = null
    if (sock) {
      try {
        sock.ev.removeAllListeners('connection.update')
        sock.ev.removeAllListeners('messages.upsert')
        sock.ev.removeAllListeners('creds.update')
      } catch {
        // best-effort
      }

      // 3. Tell WhatsApp to revoke this linked device.
      try {
        await sock.logout()
      } catch (e) {
        console.warn('[Baileys] logout() failed (continuing with local cleanup):', formatErr(e))
      }

      // 4. Close the underlying WebSocket.
      try {
        sock.ws?.close?.()
      } catch {
        // best-effort
      }
    }

    // 5. Wipe creds so next connect() starts fresh with a new QR.
    await wipeAuthDir()

    // 6. Reset all state.
    state.status = 'disconnected'
    state.qrDataUrl = null
    state.error = null
    state.reconnectAttempts = 0
    state.lastConnectedAt = null
    state.monitoredGroupJid = null
    state.monitoredGroupName = null
    state.captureStartDate = null
    state.messagesCapturedToday = 0
    state.capturedMessages = []
  } finally {
    state.shuttingDown = false
  }
}

// ── Message capture ──────────────────────────────────────────────────────────

function handleMessagesUpsert(m: BaileysEventMap['messages.upsert']): void {
  if (m.type !== 'notify') return // only new messages, not history sync

  for (const msg of m.messages) {
    if (!state.monitoredGroupJid) continue
    if (msg.key.remoteJid !== state.monitoredGroupJid) continue
    if (msg.key.fromMe) continue

    const parsed = parseWAMessage(msg)
    if (!parsed) continue

    if (state.capturedMessages.length >= 5000) state.capturedMessages.shift()
    state.capturedMessages.push(parsed)

    const today = new Date().toISOString().slice(0, 10)
    if (state.captureStartDate === today) {
      state.messagesCapturedToday += 1
    } else {
      state.captureStartDate = today
      state.messagesCapturedToday = 1
    }
    console.log(`[Baileys] Captured from ${parsed.sender}: ${parsed.message.slice(0, 60)}…`)
  }
}

function parseWAMessage(msg: WAMessage): RawMessage | null {
  const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || ''
  if (!body && !msg.message?.locationMessage) return null

  const ts = msg.messageTimestamp ? new Date(Number(msg.messageTimestamp) * 1000) : new Date()
  const date = ts.toISOString().slice(0, 10)
  const time = ts.toTimeString().slice(0, 5)
  const sender = msg.pushName || msg.key.participant || msg.key.remoteJid || 'Unknown'

  let messageType: RawMessage['messageType'] = 'Text'
  let url: string | undefined

  if (msg.message?.locationMessage || msg.message?.liveLocationMessage) {
    messageType = msg.message?.liveLocationMessage ? 'LiveLocation' : 'Location'
    const loc = msg.message?.locationMessage || msg.message?.liveLocationMessage
    if (loc?.degreesLatitude && loc?.degreesLongitude) {
      url = `https://maps.google.com/?q=${loc.degreesLatitude},${loc.degreesLongitude}`
    }
  } else if (
    msg.message?.imageMessage ||
    msg.message?.videoMessage ||
    msg.message?.audioMessage ||
    msg.message?.documentMessage ||
    msg.message?.stickerMessage
  ) {
    messageType = 'MediaOmitted'
  }

  return { date, time, sender, message: body, messageType, url }
}

// ── Group monitoring & sending ───────────────────────────────────────────────

export async function startMonitoringGroup(
  groupName: string,
): Promise<{ success: boolean; groupName?: string; error?: string }> {
  if (!state.socket || state.status !== 'connected') {
    return { success: false, error: 'WhatsApp not connected' }
  }
  try {
    const groups = await state.socket.groupFetchAllParticipating()
    const group = Object.values(groups).find((g) =>
      g.subject.toLowerCase().includes(groupName.toLowerCase()),
    )
    if (!group) {
      const available = Object.values(groups)
        .map((g) => g.subject)
        .slice(0, 10)
        .join(', ')
      return { success: false, error: `Group "${groupName}" not found. Available: ${available}` }
    }
    // Switching groups: clear the buffer so we don't pipe old-group messages
    // into a report for the new group.
    if (state.monitoredGroupJid && state.monitoredGroupJid !== group.id) {
      state.capturedMessages = []
    }
    state.monitoredGroupJid = group.id
    state.monitoredGroupName = group.subject
    state.captureStartDate = new Date().toISOString().slice(0, 10)
    state.messagesCapturedToday = 0
    console.log(`[Baileys] Monitoring group: ${group.subject} (${group.id})`)
    return { success: true, groupName: group.subject }
  } catch (e) {
    return { success: false, error: formatErr(e) }
  }
}

export async function listGroups(): Promise<{ name: string; id: string; participants: number }[]> {
  if (!state.socket || state.status !== 'connected') {
    throw new Error('WhatsApp not connected')
  }
  const groups = await state.socket.groupFetchAllParticipating()
  return Object.values(groups).map((g) => ({
    name: g.subject,
    id: g.id,
    participants: g.participants.length,
  }))
}

export async function sendMessage(phone: string, message: string): Promise<boolean> {
  if (!state.socket || state.status !== 'connected') {
    throw new Error('WhatsApp not connected')
  }
  const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`
  try {
    await state.socket.sendMessage(jid, { text: message })
    console.log(`[Baileys] Sent to ${phone}`)
    return true
  } catch (e) {
    console.error(`[Baileys] Failed to send to ${phone}:`, formatErr(e))
    return false
  }
}

export async function sendDailyReport(
  phone: string,
  report: {
    date: string
    totalVisits: number
    execsReporting: number
    totalExecs: number
    targetsMet: number
    topPerformers: { name: string; visits: number }[]
    alerts: { exec: string; message: string }[]
    summaryText?: string
  },
): Promise<boolean> {
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
    report.alerts.slice(0, 5).forEach((a) => {
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
