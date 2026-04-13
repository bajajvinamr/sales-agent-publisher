// ═══════════════════════════════════════════════════════════════
// WhatsApp exported chat .txt parser
// Fallback when live scraping isn't available
// ═══════════════════════════════════════════════════════════════

import { parse, format } from 'date-fns'
import type { RawMessage } from '../types/index.js'

// [13/04/2026, 10:32 AM] Fp Sunil: message body here
const MESSAGE_HEADER_RE = /^\[(\d{1,2}\/\d{1,2}\/\d{4}),\s*(\d{1,2}:\d{2}(?::\d{2})?\s*[AP]M)\]\s+(.+?):\s*(.*)$/

const MAPS_URL_RE =
  /(https?:\/\/(maps\.google\.[a-z.]+\/[^\s]+|goo\.gl\/maps\/[^\s]+|google\.[a-z.]+\/maps[^\s]*))/i

// ── Parse exported .txt ───────────────────────────────────────

/**
 * Parse a full WhatsApp exported chat text into RawMessage[].
 * Multi-line messages are correctly aggregated.
 * Returns results sorted by timestamp (ascending).
 */
export function parseChatExport(text: string): RawMessage[] {
  const lines = text.split('\n')
  const messages: RawMessage[] = []

  let current: RawMessage | null = null

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    const match = line.match(MESSAGE_HEADER_RE)

    if (match) {
      // Flush previous message
      if (current) {
        messages.push(finalizeMessage(current))
      }

      const [, datePart, timePart, sender, bodyFirstLine] = match

      const ts = parseTimestamp(datePart, timePart)
      if (!ts) {
        // Could not parse timestamp — treat as continuation of previous
        if (current) {
          current = appendLine(current, line)
        }
        continue
      }

      current = {
        date: format(ts, 'yyyy-MM-dd'),
        time: format(ts, 'HH:mm'),
        sender: sender.trim(),
        message: bodyFirstLine ?? '',
        messageType: 'Text', // resolved later in finalizeMessage
      }
    } else {
      // Continuation line — belongs to current message
      if (current) {
        current = appendLine(current, line)
      }
      // Lines before any message (export header etc.) are silently skipped
    }
  }

  // Flush last message
  if (current) {
    messages.push(finalizeMessage(current))
  }

  return messages.sort((a, b) => {
    const aTs = `${a.date} ${a.time}`
    const bTs = `${b.date} ${b.time}`
    return aTs.localeCompare(bTs)
  })
}

// ── Helpers ───────────────────────────────────────────────────

function appendLine(msg: RawMessage, line: string): RawMessage {
  return {
    ...msg,
    message: msg.message ? `${msg.message}\n${line}` : line,
  }
}

function finalizeMessage(msg: RawMessage): RawMessage {
  const body = msg.message.trim()
  const { messageType, url } = detectTypeAndUrl(body)

  return {
    ...msg,
    message: body,
    messageType,
    ...(url ? { url } : {}),
  }
}

function detectTypeAndUrl(body: string): {
  messageType: RawMessage['messageType']
  url?: string
} {
  if (body === '<Media omitted>') {
    return { messageType: 'MediaOmitted' }
  }

  if (body === '<This message was deleted>') {
    return { messageType: 'Deleted' }
  }

  // Maps URL in body
  const mapsMatch = body.match(MAPS_URL_RE)
  if (mapsMatch) {
    return { messageType: 'Location', url: mapsMatch[1] }
  }

  // Any URL
  if (/https?:\/\//.test(body)) {
    return { messageType: 'Link' }
  }

  return { messageType: 'Text' }
}

/**
 * Parse "DD/MM/YYYY" + "HH:MM AM/PM" (or "HH:MM:SS AM/PM") into a Date.
 * Returns null if parsing fails so callers can skip gracefully.
 */
function parseTimestamp(datePart: string, timePart: string): Date | null {
  try {
    const normalizedTime = timePart.trim().replace(/\s+/, ' ')
    const hasSeconds = /\d{1,2}:\d{2}:\d{2}\s*[AP]M/i.test(normalizedTime)
    const timeFormat = hasSeconds ? 'hh:mm:ss a' : 'hh:mm a'
    const combined = `${datePart.trim()} ${normalizedTime}`
    const fullFormat = `dd/MM/yyyy ${timeFormat}`
    const parsed = parse(combined, fullFormat, new Date())
    if (isNaN(parsed.getTime())) return null
    return parsed
  } catch {
    return null
  }
}

// ── Filter helpers ────────────────────────────────────────────

/** Convenience: return only messages for a specific YYYY-MM-DD date. */
export function filterByDate(messages: RawMessage[], date: string): RawMessage[] {
  return messages.filter((m) => m.date === date)
}
