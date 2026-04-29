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
  capturedMessageKeys: Set<string>
  monitoredGroupJid: string | null
  monitoredGroupName: string | null
  captureStartDate: string | null // YYYY-MM-DD
  messagesCapturedToday: number
  // History sync — populated by 'messaging-history.set' events. Bucketed by
  // remoteJid so we can grab the right group's backlog when the user picks one.
  historicalByJid: Map<string, RawMessage[]>
  historySyncProgress: number // 0–100, last value from Baileys
  historySyncComplete: boolean
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
  capturedMessageKeys: new Set(),
  monitoredGroupJid: null,
  monitoredGroupName: null,
  captureStartDate: null,
  messagesCapturedToday: 0,
  historicalByJid: new Map(),
  historySyncProgress: 0,
  historySyncComplete: false,
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

export function buildMessageKey(m: Pick<RawMessage, 'sender' | 'date' | 'time' | 'message'>): string {
  return `${m.sender}|${m.date}|${m.time}|${m.message}`
}

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
  const historicalForGroup = state.monitoredGroupJid
    ? state.historicalByJid.get(state.monitoredGroupJid)?.length ?? 0
    : 0
  // Sum sizes across all buckets so the UI can show total history downloaded
  // even before the user picks a group.
  let historicalTotal = 0
  for (const arr of state.historicalByJid.values()) historicalTotal += arr.length
  return {
    status: state.status,
    qrDataUrl: state.qrDataUrl,
    error: state.error,
    monitoredGroup: state.monitoredGroupName,
    messagesCapturedToday: state.captureStartDate === today ? state.messagesCapturedToday : 0,
    totalCaptured: state.capturedMessages.length,
    historicalForGroup,
    historicalTotal,
    historySyncProgress: state.historySyncProgress,
    historySyncComplete: state.historySyncComplete,
  }
}

export function getCapturedMessages(date?: string): RawMessage[] {
  const target = date || new Date().toISOString().slice(0, 10)
  return state.capturedMessages.filter((m) => m.date === target)
}

export function clearCapturedMessages(date?: string): void {
  if (date) {
    state.capturedMessages = state.capturedMessages.filter((m) => m.date !== date)
    // Rebuild key set to stay in sync with the trimmed buffer
    state.capturedMessageKeys = new Set(state.capturedMessages.map(buildMessageKey))
  } else {
    state.capturedMessages = []
    state.capturedMessageKeys = new Set()
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
      // Ask WhatsApp for the full chat history on this pair. Without this we
      // only get ~3 months of recent messages. The history arrives via
      // 'messaging-history.set' events in chunks.
      syncFullHistory: true,
    })
    state.socket = sock

    sock.ev.on('creds.update', saveCreds)
    sock.ev.on('connection.update', handleConnectionUpdate)
    sock.ev.on('messages.upsert', handleMessagesUpsert)
    sock.ev.on('messaging-history.set', handleHistorySet)

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

    // Capture before nulling — we need to know whether we were ever connected
    // when classifying transient closes vs pairing timeouts further down.
    const wasEverConnected = state.lastConnectedAt !== null
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
    if (!wasEverConnected && kind === 'transient') {
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
    state.capturedMessageKeys = new Set()
  } finally {
    state.shuttingDown = false
  }
}

// ── Message capture ──────────────────────────────────────────────────────────

function handleHistorySet(payload: BaileysEventMap['messaging-history.set']): void {
  const { messages, isLatest, progress } = payload
  if (typeof progress === 'number') state.historySyncProgress = progress
  if (isLatest) state.historySyncComplete = true

  if (!messages?.length) {
    if (isLatest) console.log('[Baileys] History sync complete')
    return
  }

  let added = 0
  for (const msg of messages) {
    const jid = msg.key?.remoteJid
    if (!jid) continue
    if (msg.key?.fromMe) continue
    const parsed = parseWAMessage(msg)
    if (!parsed) continue

    let bucket = state.historicalByJid.get(jid)
    if (!bucket) {
      bucket = []
      state.historicalByJid.set(jid, bucket)
    }
    if (bucket.length >= 5000) bucket.shift()
    bucket.push(parsed)
    added++
  }
  console.log(
    `[Baileys] History chunk: +${added} messages across ${state.historicalByJid.size} chats (progress=${state.historySyncProgress}%${isLatest ? ', LATEST' : ''})`,
  )
}

function handleMessagesUpsert(m: BaileysEventMap['messages.upsert']): void {
  if (m.type !== 'notify') return // only new messages, not history sync

  for (const msg of m.messages) {
    if (!state.monitoredGroupJid) continue
    if (msg.key.remoteJid !== state.monitoredGroupJid) continue
    if (msg.key.fromMe) continue

    const parsed = parseWAMessage(msg)
    if (!parsed) continue

    const keyOf = buildMessageKey
    const parsedKey = keyOf(parsed)
    if (state.capturedMessageKeys.has(parsedKey)) continue

    if (state.capturedMessages.length >= 5000) state.capturedMessages.shift()
    state.capturedMessages.push(parsed)
    state.capturedMessageKeys.add(parsedKey)

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
  // remoteJid is the GROUP's JID in group chats, not an individual.
  // If pushName and participant are both missing, we have no real human — skip the message.
  const rawSender = msg.pushName || msg.key.participant
  if (!rawSender) return null
  if (/@(g\.us|broadcast|newsletter)$/i.test(rawSender)) return null
  const sender = rawSender

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
    const needle = groupName.toLowerCase()
    const group = Object.values(groups).find((g) =>
      // g.subject is undefined for some Baileys group types (community parents,
      // freshly-created groups before sync); skip those.
      g.subject?.toLowerCase().includes(needle),
    )
    if (!group) {
      const available = Object.values(groups)
        .map((g) => g.subject)
        .filter((s): s is string => Boolean(s))
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

    // Pull whatever history we already buffered for this group into the
    // captured queue. Cap at 5000 to match the live-capture limit.
    const historical = state.historicalByJid.get(group.id) ?? []
    if (historical.length > 0) {
      const seen = new Set<string>()
      const keyOf = buildMessageKey
      const combined: RawMessage[] = []
      for (const m of [...historical, ...state.capturedMessages]) {
        const k = keyOf(m)
        if (seen.has(k)) continue
        seen.add(k)
        combined.push(m)
      }
      state.capturedMessages = combined.slice(-5000)
      state.capturedMessageKeys = new Set(state.capturedMessages.map(buildMessageKey))
      const dupes = historical.length + state.capturedMessages.length - combined.length
      console.log(
        `[Baileys] Loaded ${historical.length} historical messages for ${group.subject} (${dupes} dupes skipped)`,
      )
    }

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
  return Object.values(groups)
    .filter((g): g is typeof g & { subject: string } => Boolean(g.subject))
    .map((g) => ({
      name: g.subject,
      id: g.id,
      participants: g.participants?.length ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
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
