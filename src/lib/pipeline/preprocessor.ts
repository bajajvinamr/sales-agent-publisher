import type { RawMessage, VisitChunk } from '@/types'

// ── Noise patterns ───────────────────────────────────────────
const NOISE_PATTERNS: RegExp[] = [
  /^.{0,4}$/,                                      // < 5 chars
  /^(good\s*morning|gm|ok|done|ji|yes|no|thanku|thank\s*you|thanks|okay|haan|ha|nahi|nhi)[\s!.]*$/i,
  /^👍+$/,
  /^🙏+$/,
  /^<media omitted>$/i,
  /^<this message was deleted>$/i,
  /^\[sticker\]$/i,
  /^REACTION:/i,
]

const VISIT_SIGNALS: RegExp[] = [
  /school|vidyalaya|academy|institute|convent|public school/i,
  /board|cbse|icse|mpbse|state board/i,
  /principal|headmaster|head mistress|director/i,
  /strength|enrollment|students/i,
  /book\s*seller|bookseller|book shop/i,
  /sampling|sample/i,
  /meeting|visited|visit|gaye|gaya|mila/i,
  /follow\s*up|followup/i,
]

// ── Strip "Fp " prefix from sender names ─────────────────────
function normalizeSender(sender: string): string {
  return sender.replace(/^Fp\s+/i, '').trim()
}

// ── Parse "HH:MM" into total minutes for comparison ──────────
function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

// ── 1. filterNoise ───────────────────────────────────────────
export function filterNoise(messages: RawMessage[]): RawMessage[] {
  return messages.filter((msg) => {
    // Always drop non-text structural message types
    if (
      msg.messageType === 'MediaOmitted' ||
      msg.messageType === 'Deleted'
    ) {
      return false
    }

    const text = msg.message.trim()

    // Run all noise patterns
    for (const pattern of NOISE_PATTERNS) {
      if (pattern.test(text)) return false
    }

    return true
  })
}

// ── 2. groupIntoChunks ───────────────────────────────────────
export function groupIntoChunks(
  messages: RawMessage[],
  windowMinutes = 5
): VisitChunk[] {
  if (messages.length === 0) return []

  const chunks: VisitChunk[] = []
  let current: RawMessage[] = [messages[0]!]
  let currentLocationUrl: string | undefined =
    messages[0]!.messageType === 'Location' || messages[0]!.messageType === 'LiveLocation'
      ? messages[0]!.url
      : undefined

  for (let i = 1; i < messages.length; i++) {
    const msg = messages[i]!
    const prev = current[current.length - 1]!

    const sameSender = msg.sender === prev.sender
    const sameDate = msg.date === prev.date
    const timeDiff = Math.abs(timeToMinutes(msg.time) - timeToMinutes(prev.time))
    const withinWindow = timeDiff <= windowMinutes

    if (sameSender && sameDate && withinWindow) {
      current.push(msg)
      if (
        (msg.messageType === 'Location' || msg.messageType === 'LiveLocation') &&
        msg.url
      ) {
        currentLocationUrl = msg.url
      }
    } else {
      chunks.push(buildChunk(current, currentLocationUrl))
      current = [msg]
      currentLocationUrl =
        msg.messageType === 'Location' || msg.messageType === 'LiveLocation'
          ? msg.url
          : undefined
    }
  }

  // Push final chunk
  chunks.push(buildChunk(current, currentLocationUrl))

  // Second pass: pair orphan location messages with nearest text chunk
  // (location messages < 5 min from a chunk get their URL attached)
  return mergeOrphanLocations(chunks)
}

function buildChunk(messages: RawMessage[], locationUrl?: string): VisitChunk {
  const first = messages[0]!
  const textMessages = messages.filter(
    (m) => m.messageType !== 'Location' && m.messageType !== 'LiveLocation'
  )
  const combinedText = textMessages.map((m) => m.message).join('\n').trim()

  return {
    sender: first.sender,
    senderNormalized: normalizeSender(first.sender),
    date: first.date,
    timestamp: `${first.date}T${first.time}:00`,
    messages,
    combinedText,
    locationUrl,
    messageCount: messages.length,
  }
}

function mergeOrphanLocations(chunks: VisitChunk[]): VisitChunk[] {
  // Identify location-only chunks (combinedText is empty, has locationUrl)
  const result: VisitChunk[] = []

  for (const chunk of chunks) {
    const isLocationOnly =
      chunk.combinedText.trim() === '' && chunk.locationUrl !== undefined

    if (isLocationOnly) {
      // Find nearest text chunk from same sender (within 10 min)
      const chunkMinutes = timeToMinutes(chunk.timestamp.substring(11, 16))
      let bestIdx = -1
      let bestDiff = Infinity

      for (let i = 0; i < result.length; i++) {
        const candidate = result[i]!
        if (candidate.senderNormalized !== chunk.senderNormalized) continue
        if (candidate.date !== chunk.date) continue
        const candidateMinutes = timeToMinutes(candidate.timestamp.substring(11, 16))
        const diff = Math.abs(chunkMinutes - candidateMinutes)
        if (diff < bestDiff && diff <= 10) {
          bestDiff = diff
          bestIdx = i
        }
      }

      if (bestIdx >= 0) {
        // Merge location URL into nearest chunk
        result[bestIdx] = { ...result[bestIdx]!, locationUrl: chunk.locationUrl }
        continue
      }
    }

    result.push(chunk)
  }

  return result
}

// ── 3. isLikelyVisitReport ───────────────────────────────────
export function isLikelyVisitReport(chunk: VisitChunk): boolean {
  const text = chunk.combinedText.toLowerCase()
  let signalsFound = 0

  for (const pattern of VISIT_SIGNALS) {
    if (pattern.test(text)) {
      signalsFound++
      if (signalsFound >= 2) return true
    }
  }

  return false
}

// ── 4. preprocess ────────────────────────────────────────────
export function preprocess(messages: RawMessage[]): VisitChunk[] {
  const filtered = filterNoise(messages)
  const chunks = groupIntoChunks(filtered)
  return chunks.filter(isLikelyVisitReport)
}
