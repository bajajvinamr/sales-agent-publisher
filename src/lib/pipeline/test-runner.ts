/**
 * Pipeline Test Runner
 *
 * Reads the real Excel chat dump, runs preprocessing + Haiku extraction,
 * compares output with the manual daily report, and scores accuracy.
 */

import ExcelJS from 'exceljs'
import { filterNoise, groupIntoChunks, isLikelyVisitReport } from './preprocessor.js'
import { extractVisitData } from '../ai.js'
import { validateFields } from './validator.js'
import type { RawMessage, VisitChunk } from '../../types/index.js'

const CHAT_FILE = '/Users/vinamr/Downloads/friends_sales_team_chat_datewise first week1.xlsx'
const REPORT_FILE = '/Users/vinamr/Downloads/Daily report - sample for Nishkarsh.xlsx'

// ── Step 1: Parse Excel chat into RawMessage[] ──────────────
async function parseExcelChat(filePath: string, sheetName: string): Promise<RawMessage[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  const sheet = wb.getWorksheet(sheetName)
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found`)

  const messages: RawMessage[] = []
  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return // skip header
    const date = String(row.getCell(1).value ?? '').trim()
    const time = String(row.getCell(2).value ?? '').trim()
    const sender = String(row.getCell(3).value ?? '').trim()
    const message = String(row.getCell(4).value ?? '').trim()
    const messageType = String(row.getCell(5).value ?? 'Text').trim()
    const url = String(row.getCell(6).value ?? '').trim() || undefined

    if (!sender || !message) return

    const typeMap: Record<string, RawMessage['messageType']> = {
      'Text': 'Text',
      'Location': 'Location',
      'Live Location': 'LiveLocation',
      'Media Omitted': 'MediaOmitted',
      'Deleted': 'Deleted',
      'Link/Message': 'Link',
    }

    messages.push({
      date: formatDate(date),
      time: time.slice(0, 5),
      sender,
      message,
      messageType: typeMap[messageType] ?? 'Text',
      url: url && url !== 'undefined' ? url : undefined,
    })
  })

  return messages
}

function formatDate(raw: string): string {
  // Handle various date formats from Excel
  if (raw.includes('-')) return raw.slice(0, 10)
  if (raw.includes('/')) {
    const parts = raw.split('/')
    if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
  }
  // Excel date number → try parsing
  const d = new Date(raw)
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10)
  }
  return raw
}

// ── Step 2: Parse manual daily report for comparison ────────
async function parseManualReport(filePath: string): Promise<ManualRecord[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  const sheet = wb.getWorksheet(1)
  if (!sheet) throw new Error('No sheet found in daily report')

  const records: ManualRecord[] = []
  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return
    const date = String(row.getCell(1).value ?? '').trim()
    const employee = String(row.getCell(2).value ?? '').trim()
    const schoolName = String(row.getCell(3).value ?? '').trim()
    const address = String(row.getCell(4).value ?? '').trim()
    const details = String(row.getCell(5).value ?? '').trim()
    const remark = String(row.getCell(6).value ?? '').trim()

    if (!schoolName) return

    // Parse details block
    const parsed = parseDetailsBlock(details)

    records.push({
      date: formatDate(date),
      employee,
      schoolName,
      address,
      board: parsed.board,
      strength: parsed.strength,
      principalName: parsed.principalName,
      principalMobile: parsed.principalMobile,
      bookSeller: parsed.bookSeller,
      remark,
    })
  })

  return records
}

interface ManualRecord {
  date: string
  employee: string
  schoolName: string
  address: string
  board: string | null
  strength: number | null
  principalName: string | null
  principalMobile: string | null
  bookSeller: string | null
  remark: string
}

function parseDetailsBlock(details: string): {
  board: string | null
  strength: number | null
  principalName: string | null
  principalMobile: string | null
  bookSeller: string | null
} {
  const lines = details.split('\n').map(l => l.trim())
  const get = (key: string): string | null => {
    const line = lines.find(l => l.toLowerCase().startsWith(key.toLowerCase()))
    if (!line) return null
    const val = line.split(':').slice(1).join(':').trim()
    return val || null
  }

  const strengthStr = get('strength') || get('Strength')
  return {
    board: get('board') || get('Board'),
    strength: strengthStr ? parseInt(strengthStr.replace(/[^\d]/g, ''), 10) || null : null,
    principalName: get('principal') || get('Principal'),
    principalMobile: get('mobile') || get('Mobile No') || get('Mob'),
    bookSeller: get('book seller') || get('Book Seller'),
  }
}

// ── Step 3: Run pipeline on a sample of chunks ──────────────
async function runExtractionTest(chunks: VisitChunk[], maxChunks: number = 15): Promise<ExtractionResult[]> {
  const results: ExtractionResult[] = []
  const sample = chunks.slice(0, maxChunks)

  console.log(`\nExtracting ${sample.length} chunks via Haiku...\n`)

  for (let i = 0; i < sample.length; i++) {
    const chunk = sample[i]
    console.log(`  [${i + 1}/${sample.length}] ${chunk.senderNormalized} — ${chunk.combinedText.slice(0, 60).replace(/\n/g, ' ')}...`)

    try {
      const { data, model, tokensUsed } = await extractVisitData(
        chunk.senderNormalized,
        chunk.date,
        chunk.combinedText
      )

      const validation = validateFields(data)

      results.push({
        sender: chunk.senderNormalized,
        date: chunk.date,
        extracted: data,
        model,
        tokensUsed,
        dataComplete: validation.dataComplete,
        missingFields: validation.missingFields,
        rawPreview: chunk.combinedText.slice(0, 200),
      })

      console.log(`    → ${data.isVisitReport ? data.schoolName ?? 'NO NAME' : 'NOT A VISIT'} (${model}, ${tokensUsed} tokens)`)
    } catch (error: unknown) {
      console.error(`    → ERROR: ${error instanceof Error ? error.message : String(error)}`)
      results.push({
        sender: chunk.senderNormalized,
        date: chunk.date,
        extracted: null,
        model: 'error',
        tokensUsed: 0,
        dataComplete: false,
        missingFields: ['ALL'],
        rawPreview: chunk.combinedText.slice(0, 200),
      })
    }
  }

  return results
}

interface ExtractionResult {
  sender: string
  date: string
  extracted: any
  model: string
  tokensUsed: number
  dataComplete: boolean
  missingFields: string[]
  rawPreview: string
}

// ── Step 4: Evaluate against manual report ──────────────────
function evaluate(extractions: ExtractionResult[], manual: ManualRecord[]): EvalReport {
  const visitExtractions = extractions.filter(e => e.extracted?.isVisitReport)

  let schoolNameMatches = 0
  let boardMatches = 0
  let strengthMatches = 0
  let principalMatches = 0
  let remarkMatches = 0
  let totalComparisons = 0

  for (const ext of visitExtractions) {
    // Find closest manual record by sender + school name similarity
    const match = manual.find(m => {
      const senderMatch = m.employee.toLowerCase().includes(ext.sender.toLowerCase()) ||
                          ext.sender.toLowerCase().includes(m.employee.toLowerCase())
      if (!senderMatch) return false

      const extSchool = (ext.extracted.schoolName || '').toLowerCase()
      const manSchool = m.schoolName.toLowerCase()
      return manSchool.includes(extSchool) || extSchool.includes(manSchool) ||
             levenshteinSimilarity(extSchool, manSchool) > 0.5
    })

    if (!match) continue
    totalComparisons++

    if (fuzzyMatch(ext.extracted.schoolName, match.schoolName)) schoolNameMatches++
    if (ext.extracted.board && match.board && ext.extracted.board.toUpperCase() === match.board.toUpperCase()) boardMatches++
    if (ext.extracted.strength != null && match.strength != null && Math.abs(ext.extracted.strength - match.strength) < 100) strengthMatches++
    if (fuzzyMatch(ext.extracted.principalName, match.principalName)) principalMatches++
    if (fuzzyMatch(ext.extracted.remark, match.remark)) remarkMatches++
  }

  const fieldScores = totalComparisons > 0 ? {
    schoolName: schoolNameMatches / totalComparisons,
    board: boardMatches / totalComparisons,
    strength: strengthMatches / totalComparisons,
    principal: principalMatches / totalComparisons,
    remark: remarkMatches / totalComparisons,
  } : { schoolName: 0, board: 0, strength: 0, principal: 0, remark: 0 }

  const overallScore = totalComparisons > 0
    ? (schoolNameMatches + boardMatches + strengthMatches + principalMatches + remarkMatches) / (totalComparisons * 5)
    : 0

  return {
    totalExtractions: extractions.length,
    visitReports: visitExtractions.length,
    nonVisits: extractions.length - visitExtractions.length,
    errors: extractions.filter(e => e.model === 'error').length,
    matchedWithManual: totalComparisons,
    fieldScores,
    overallScore,
    totalTokensUsed: extractions.reduce((sum, e) => sum + e.tokensUsed, 0),
    haikuCalls: extractions.filter(e => e.model === 'haiku').length,
    sonnetCalls: extractions.filter(e => e.model === 'sonnet').length,
  }
}

interface EvalReport {
  totalExtractions: number
  visitReports: number
  nonVisits: number
  errors: number
  matchedWithManual: number
  fieldScores: Record<string, number>
  overallScore: number
  totalTokensUsed: number
  haikuCalls: number
  sonnetCalls: number
}

function fuzzyMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  const na = a.toLowerCase().trim()
  const nb = b.toLowerCase().trim()
  return na === nb || na.includes(nb) || nb.includes(na) || levenshteinSimilarity(na, nb) > 0.6
}

function levenshteinSimilarity(a: string, b: string): number {
  const matrix: number[][] = []
  for (let i = 0; i <= a.length; i++) matrix[i] = [i]
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
  }
  const maxLen = Math.max(a.length, b.length)
  return maxLen === 0 ? 1 : 1 - matrix[a.length][b.length] / maxLen
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log(' WhatsApp Sales Agent — Pipeline Test & Eval')
  console.log('═══════════════════════════════════════════════════\n')

  // 1. Read chat data
  console.log('1. Reading chat Excel...')
  const allMessages = await parseExcelChat(CHAT_FILE, 'Dec')
  console.log(`   ${allMessages.length} total messages loaded from Dec sheet`)

  // 2. Preprocess
  console.log('\n2. Preprocessing...')
  const filtered = filterNoise(allMessages)
  console.log(`   ${allMessages.length} → ${filtered.length} after noise filter (removed ${allMessages.length - filtered.length})`)

  const chunks = groupIntoChunks(filtered)
  console.log(`   ${filtered.length} messages → ${chunks.length} chunks`)

  const visitChunks = chunks.filter(isLikelyVisitReport)
  console.log(`   ${chunks.length} chunks → ${visitChunks.length} likely visit reports`)

  // 3. Read manual report for comparison
  console.log('\n3. Reading manual daily report...')
  const manualRecords = await parseManualReport(REPORT_FILE)
  console.log(`   ${manualRecords.length} manual records loaded`)

  // 4. Run extraction on sample
  console.log('\n4. Running Haiku extraction...')
  const results = await runExtractionTest(visitChunks, 15)

  // 5. Evaluate
  console.log('\n5. Evaluating against manual report...')
  const evalReport = evaluate(results, manualRecords)

  // 6. Print report
  console.log('\n═══════════════════════════════════════════════════')
  console.log(' EVAL REPORT')
  console.log('═══════════════════════════════════════════════════\n')

  console.log('Pipeline Stats:')
  console.log(`  Total extractions:     ${evalReport.totalExtractions}`)
  console.log(`  Visit reports:         ${evalReport.visitReports}`)
  console.log(`  Non-visit filtered:    ${evalReport.nonVisits}`)
  console.log(`  Errors:                ${evalReport.errors}`)
  console.log(`  Haiku calls:           ${evalReport.haikuCalls}`)
  console.log(`  Sonnet fallback calls: ${evalReport.sonnetCalls}`)
  console.log(`  Total tokens:          ${evalReport.totalTokensUsed}`)
  console.log(`  Est. cost:             $${(evalReport.totalTokensUsed * 0.00000125).toFixed(4)}`)

  console.log('\nAccuracy vs Manual Report:')
  console.log(`  Records matched:       ${evalReport.matchedWithManual}`)
  console.log(`  School name accuracy:  ${(evalReport.fieldScores.schoolName * 100).toFixed(1)}%`)
  console.log(`  Board accuracy:        ${(evalReport.fieldScores.board * 100).toFixed(1)}%`)
  console.log(`  Strength accuracy:     ${(evalReport.fieldScores.strength * 100).toFixed(1)}%`)
  console.log(`  Principal accuracy:    ${(evalReport.fieldScores.principal * 100).toFixed(1)}%`)
  console.log(`  Remark accuracy:       ${(evalReport.fieldScores.remark * 100).toFixed(1)}%`)
  console.log(`  ────────────────────────────────────`)
  console.log(`  OVERALL SCORE:         ${(evalReport.overallScore * 100).toFixed(1)}%`)

  console.log('\nSample Extractions:')
  for (const r of results.slice(0, 5)) {
    if (r.extracted?.isVisitReport) {
      console.log(`  ✓ ${r.sender} → ${r.extracted.schoolName} | ${r.extracted.board} | ${r.extracted.strength} | ${r.extracted.remark}`)
    } else if (r.model === 'error') {
      console.log(`  ✗ ${r.sender} → ERROR`)
    } else {
      console.log(`  ○ ${r.sender} → not a visit report`)
    }
  }

  console.log('\n═══════════════════════════════════════════════════\n')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
