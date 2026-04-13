// ═══════════════════════════════════════════════════════════════
// Excel chat / daily-report parser
// Handles two layouts:
//   1. Chat dump  — Date | Time | Sender | Message | Message Type | URL
//   2. Daily report — publisher's existing report format
// ═══════════════════════════════════════════════════════════════

import ExcelJS from 'exceljs'
import { format } from 'date-fns'
import type { RawMessage } from '../types/index.js'

// ── Chat dump parser ──────────────────────────────────────────

/**
 * Parse the publisher's Excel chat dump into RawMessage[].
 *
 * Expected columns (case-insensitive, any order):
 *   Date | Time | Sender | Message | Message Type | URL
 *
 * The first row is assumed to be a header row.
 */
export async function parseExcelChat(filePath: string): Promise<RawMessage[]> {
  const workbook = new ExcelJS.Workbook()

  try {
    await workbook.xlsx.readFile(filePath)
  } catch (err: unknown) {
    throw new Error(
      `[ExcelParser] Could not read file "${filePath}": ${err instanceof Error ? err.message : String(err)}`
    )
  }

  const sheet = workbook.worksheets[0]
  if (!sheet) {
    throw new Error(`[ExcelParser] No worksheets found in "${filePath}"`)
  }

  // Build column index map from header row
  const headerRow = sheet.getRow(1)
  const colMap = buildColumnMap(headerRow)

  validateColumns(colMap, ['date', 'time', 'sender', 'message'], filePath)

  const results: RawMessage[] = []

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return // skip header

    const rawDate = getCellValue(row, colMap['date'])
    const rawTime = getCellValue(row, colMap['time'])
    const rawSender = getCellValue(row, colMap['sender'])
    const rawMessage = getCellValue(row, colMap['message'])
    const rawType = getCellValue(row, colMap['messagetype'] ?? colMap['message type'])
    const rawUrl = getCellValue(row, colMap['url'])

    // Skip entirely empty rows
    if (!rawDate && !rawSender && !rawMessage) return

    const date = parseExcelDate(rawDate)
    const time = parseExcelTime(rawTime)
    const messageType = normalizeMessageType(rawType)
    const url = rawUrl?.trim() || undefined

    results.push({
      date,
      time,
      sender: String(rawSender ?? '').trim(),
      message: String(rawMessage ?? '').trim(),
      messageType,
      ...(url ? { url } : {}),
    })
  })

  return results
}

// ── Daily report parser ───────────────────────────────────────

/**
 * Parse the publisher's existing daily report Excel for comparison/validation.
 * Returns raw row objects — structure depends on the actual report format.
 *
 * Column names are normalized to camelCase keys.
 */
export async function parseDailyReportExcel(filePath: string): Promise<Record<string, unknown>[]> {
  const workbook = new ExcelJS.Workbook()

  try {
    await workbook.xlsx.readFile(filePath)
  } catch (err: unknown) {
    throw new Error(
      `[ExcelParser] Could not read report file "${filePath}": ${err instanceof Error ? err.message : String(err)}`
    )
  }

  const sheet = workbook.worksheets[0]
  if (!sheet) {
    throw new Error(`[ExcelParser] No worksheets found in "${filePath}"`)
  }

  const headerRow = sheet.getRow(1)
  const headers: string[] = []
  headerRow.eachCell((cell) => {
    headers.push(toCamelCase(String(cell.value ?? '')))
  })

  const rows: Record<string, unknown>[] = []

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return

    const obj: Record<string, unknown> = {}
    row.eachCell((cell, colNumber) => {
      const key = headers[colNumber - 1]
      if (key) {
        obj[key] = cell.value
      }
    })

    // Skip empty rows
    if (Object.values(obj).every((v) => v == null || v === '')) return

    rows.push(obj)
  })

  return rows
}

// ── Private helpers ───────────────────────────────────────────

type ColMap = Record<string, number>

function buildColumnMap(headerRow: ExcelJS.Row): ColMap {
  const map: ColMap = {}
  headerRow.eachCell((cell, colNumber) => {
    const key = String(cell.value ?? '')
      .toLowerCase()
      .trim()
    if (key) {
      map[key] = colNumber
    }
  })
  return map
}

function validateColumns(colMap: ColMap, required: string[], filePath: string): void {
  const missing = required.filter((col) => colMap[col] == null)
  if (missing.length > 0) {
    throw new Error(
      `[ExcelParser] "${filePath}" is missing required columns: ${missing.join(', ')}. ` +
        `Found columns: ${Object.keys(colMap).join(', ')}`
    )
  }
}

function getCellValue(row: ExcelJS.Row, colNumber: number | undefined): string | null {
  if (colNumber == null) return null
  const cell = row.getCell(colNumber)
  const val = cell.value

  if (val == null) return null

  // ExcelJS returns Date objects for date-formatted cells
  if (val instanceof Date) {
    return val.toISOString()
  }

  // Rich text
  if (typeof val === 'object' && 'richText' in val) {
    return (val as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('')
  }

  return String(val)
}

function parseExcelDate(raw: string | null): string {
  if (!raw) return ''

  // ISO string from ExcelJS Date cell
  if (raw.includes('T')) {
    return format(new Date(raw), 'yyyy-MM-dd')
  }

  // Already "YYYY-MM-DD"
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw

  // "DD/MM/YYYY"
  const ddmmyyyy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  // Fallback: try native Date parse
  const parsed = new Date(raw)
  if (!isNaN(parsed.getTime())) return format(parsed, 'yyyy-MM-dd')

  return raw
}

function parseExcelTime(raw: string | null): string {
  if (!raw) return ''

  // ISO string — extract time component
  if (raw.includes('T')) {
    return format(new Date(raw), 'HH:mm')
  }

  // "HH:MM" or "HH:MM:SS"
  const hmMatch = raw.match(/^(\d{1,2}):(\d{2})/)
  if (hmMatch) {
    return `${hmMatch[1].padStart(2, '0')}:${hmMatch[2]}`
  }

  // "HH:MM AM/PM"
  const ampmMatch = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)/i)
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1], 10)
    const minutes = ampmMatch[2]
    const meridiem = ampmMatch[3].toUpperCase()
    if (meridiem === 'AM' && hours === 12) hours = 0
    if (meridiem === 'PM' && hours !== 12) hours += 12
    return `${String(hours).padStart(2, '0')}:${minutes}`
  }

  return raw
}

function normalizeMessageType(raw: string | null): RawMessage['messageType'] {
  const s = (raw ?? '').toLowerCase().trim()
  if (s === 'location' || s === 'loc') return 'Location'
  if (s === 'livelocation' || s === 'live location' || s === 'live_location') return 'LiveLocation'
  if (s === 'mediaomitted' || s === 'media' || s === 'media omitted') return 'MediaOmitted'
  if (s === 'deleted' || s === 'revoked') return 'Deleted'
  if (s === 'link' || s === 'url') return 'Link'
  return 'Text'
}

function toCamelCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .trim()
    .replace(/\s+(.)/g, (_, char: string) => char.toUpperCase())
}
