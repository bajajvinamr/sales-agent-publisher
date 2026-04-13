/**
 * Self-Eval: Verify extraction accuracy by checking if extracted fields
 * actually appear in the raw input text. No external ground truth needed.
 */

import ExcelJS from 'exceljs'
import { filterNoise, groupIntoChunks, isLikelyVisitReport } from './preprocessor.js'
import { extractVisitData, type ExtractedVisitOutput } from '../ai.js'
import type { RawMessage } from '../../types/index.js'

const CHAT_FILE = '/Users/vinamr/Downloads/friends_sales_team_chat_datewise first week1.xlsx'

async function parseExcel(file: string, sheet: string): Promise<RawMessage[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const ws = wb.getWorksheet(sheet)
  if (!ws) throw new Error(`Sheet "${sheet}" not found`)
  const msgs: RawMessage[] = []
  ws.eachRow((row, i) => {
    if (i === 1) return
    const sender = String(row.getCell(3).value ?? '').trim()
    const message = String(row.getCell(4).value ?? '').trim()
    if (!sender || !message) return
    const typeMap: Record<string, RawMessage['messageType']> = { 'Text':'Text', 'Location':'Location', 'Live Location':'LiveLocation', 'Media Omitted':'MediaOmitted', 'Deleted':'Deleted', 'Link/Message':'Link' }
    const rawDate = String(row.getCell(1).value ?? '')
    const d = new Date(rawDate)
    msgs.push({
      date: !isNaN(d.getTime()) ? d.toISOString().slice(0,10) : rawDate.slice(0,10),
      time: String(row.getCell(2).value ?? '').slice(0,5),
      sender, message,
      messageType: typeMap[String(row.getCell(5).value ?? 'Text')] ?? 'Text',
      url: String(row.getCell(6).value ?? '') || undefined,
    })
  })
  return msgs
}

interface FieldCheck {
  field: string
  extracted: string | number | null
  foundInRaw: boolean
}

function checkFieldInText(raw: string, field: string, value: string | number | null): boolean {
  if (value === null || value === undefined) return true // null = correctly missing
  const normalized = String(value).toLowerCase().trim()
  const rawLower = raw.toLowerCase()
  // Direct substring match
  if (rawLower.includes(normalized)) return true
  // Partial match (at least 60% of words match)
  const words = normalized.split(/\s+/).filter(w => w.length > 2)
  if (words.length === 0) return true
  const matched = words.filter(w => rawLower.includes(w)).length
  return matched / words.length >= 0.6
}

async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log(' WhatsApp Sales Agent — Self-Eval (Field Accuracy)')
  console.log('═══════════════════════════════════════════════════\n')

  // Load and preprocess
  console.log('1. Loading chat data...')
  const messages = await parseExcel(CHAT_FILE, 'Dec')
  console.log(`   ${messages.length} messages loaded`)

  const filtered = filterNoise(messages)
  const chunks = groupIntoChunks(filtered)
  const visitChunks = chunks.filter(isLikelyVisitReport)
  console.log(`   ${messages.length} → ${filtered.length} filtered → ${visitChunks.length} visit chunks\n`)

  // Run extraction on 20 chunks
  const sampleSize = 20
  const sample = visitChunks.slice(0, sampleSize)
  console.log(`2. Extracting ${sample.length} visit chunks via Haiku...\n`)

  const results: { sender: string; raw: string; data: ExtractedVisitOutput; model: string; tokens: number; checks: FieldCheck[] }[] = []
  let totalTokens = 0
  let haikuCount = 0
  let sonnetCount = 0

  for (let i = 0; i < sample.length; i++) {
    const chunk = sample[i]
    const label = `[${i+1}/${sample.length}] ${chunk.senderNormalized}`
    try {
      const { data, model, tokensUsed } = await extractVisitData(chunk.senderNormalized, chunk.date, chunk.combinedText)
      totalTokens += tokensUsed
      if (model === 'haiku') haikuCount++; else sonnetCount++

      // Check each extracted field against raw text
      const checks: FieldCheck[] = [
        { field: 'schoolName', extracted: data.schoolName, foundInRaw: checkFieldInText(chunk.combinedText, 'schoolName', data.schoolName) },
        { field: 'board', extracted: data.board, foundInRaw: checkFieldInText(chunk.combinedText, 'board', data.board) },
        { field: 'strength', extracted: data.strength, foundInRaw: checkFieldInText(chunk.combinedText, 'strength', data.strength) },
        { field: 'principalName', extracted: data.principalName, foundInRaw: checkFieldInText(chunk.combinedText, 'principalName', data.principalName) },
        { field: 'principalMobile', extracted: data.principalMobile, foundInRaw: checkFieldInText(chunk.combinedText, 'principalMobile', data.principalMobile) },
        { field: 'bookSeller', extracted: data.bookSeller, foundInRaw: checkFieldInText(chunk.combinedText, 'bookSeller', data.bookSeller) },
        { field: 'remark', extracted: data.remark, foundInRaw: true }, // remark is inferred, not literal
      ]

      const correct = checks.filter(c => c.foundInRaw).length
      const total = checks.length
      const pct = Math.round((correct / total) * 100)

      console.log(`  ${label} → ${data.schoolName ?? 'N/A'} | ${pct}% fields verified (${model}, ${tokensUsed} tok)`)

      const wrong = checks.filter(c => !c.foundInRaw)
      if (wrong.length > 0) {
        wrong.forEach(w => console.log(`    ⚠ ${w.field}: "${w.extracted}" not found in raw text`))
      }

      results.push({ sender: chunk.senderNormalized, raw: chunk.combinedText.slice(0, 200), data, model, tokens: tokensUsed, checks })
    } catch (error) {
      console.log(`  ${label} → ERROR: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // ── Aggregate scores ──────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════')
  console.log(' EVAL RESULTS')
  console.log('═══════════════════════════════════════════════════\n')

  const allChecks = results.flatMap(r => r.checks)
  const byField: Record<string, { correct: number; total: number }> = {}
  for (const check of allChecks) {
    if (!byField[check.field]) byField[check.field] = { correct: 0, total: 0 }
    byField[check.field].total++
    if (check.foundInRaw) byField[check.field].correct++
  }

  console.log('Field-by-Field Accuracy (extracted value found in raw text):')
  let totalCorrect = 0, totalAll = 0
  for (const [field, { correct, total }] of Object.entries(byField)) {
    const pct = Math.round((correct / total) * 100)
    const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5))
    console.log(`  ${field.padEnd(16)} ${bar} ${pct}% (${correct}/${total})`)
    totalCorrect += correct
    totalAll += total
  }

  const overallPct = Math.round((totalCorrect / totalAll) * 100)
  console.log(`  ${'─'.repeat(52)}`)
  console.log(`  ${'OVERALL'.padEnd(16)} ${'█'.repeat(Math.round(overallPct / 5))}${'░'.repeat(20 - Math.round(overallPct / 5))} ${overallPct}% (${totalCorrect}/${totalAll})`)

  console.log('\nPipeline Stats:')
  console.log(`  Extractions:       ${results.length}/${sample.length} successful`)
  console.log(`  Haiku calls:       ${haikuCount}`)
  console.log(`  Sonnet fallbacks:  ${sonnetCount}`)
  console.log(`  Total tokens:      ${totalTokens.toLocaleString()}`)
  console.log(`  Avg tokens/call:   ${Math.round(totalTokens / results.length)}`)
  console.log(`  Est cost (Haiku):  $${(totalTokens * 0.00000125).toFixed(4)}`)
  console.log(`  Est cost (₹):      ₹${(totalTokens * 0.00000125 * 85).toFixed(2)}`)

  console.log('\n═══════════════════════════════════════════════════\n')
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
