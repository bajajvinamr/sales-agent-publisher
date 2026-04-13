/**
 * Seed database from real Excel chat data — regex extraction, no LLM needed.
 * Creates executives, schools, visits, alerts, and summaries from actual WhatsApp messages.
 */

import { PrismaClient } from '@prisma/client'
import ExcelJS from 'exceljs'

const prisma = new PrismaClient()

const CHAT_FILE = '/Users/vinamr/Downloads/friends_sales_team_chat_datewise first week1.xlsx'

interface ParsedVisit {
  sender: string
  date: string
  schoolName: string
  address: string | null
  board: string | null
  strength: number | null
  principalName: string | null
  principalMobile: string | null
  principalEmail: string | null
  bookSeller: string | null
  remark: string | null
  remarkDetail: string | null
  raw: string
}

// ── Regex-based extraction (no LLM) ─────────────────────────
function extractFromText(text: string): Omit<ParsedVisit, 'sender' | 'date' | 'raw'> | null {
  const lower = text.toLowerCase()

  // Must have at least school-like keywords
  const hasSchool = /school|vidyalaya|academy|institute|convent|public|inter college|college|sr\.?\s*sec/i.test(text)
  if (!hasSchool && !lower.includes('board') && !lower.includes('principal') && !lower.includes('strength')) return null

  // School name
  const schoolMatch = text.match(/(?:school\s*name|school)\s*[-=:]\s*(.+?)(?:\n|$)/i)
    ?? text.match(/^([A-Z][A-Za-z\s.'()]+(?:school|vidyalaya|academy|institute|convent|college)[A-Za-z\s.'()]*)/im)
  const schoolName = schoolMatch?.[1]?.trim()?.replace(/\*+/g, '') || null
  if (!schoolName) return null

  // Address
  const addrMatch = text.match(/(?:address|add|adress|addr)\s*[-=:]\s*(.+?)(?:\n|$)/i)
  const address = addrMatch?.[1]?.trim() || null

  // Board
  const boardMatch = text.match(/(?:board)\s*[-=:]\s*(\w+)/i) ?? text.match(/\b(CBSE|ICSE|MPBSE|UP Board|State Board)\b/i)
  let board = boardMatch?.[1]?.trim()?.toUpperCase() || null
  if (board && !['CBSE', 'ICSE', 'MPBSE'].includes(board)) board = 'State Board'

  // Strength
  const strMatch = text.match(/(?:strength|students?)\s*[-=:]\s*(\d+)/i) ?? text.match(/(\d{3,4})\s*(?:students?|strength)/i)
  const strength = strMatch ? parseInt(strMatch[1]) : null

  // Principal
  const prinMatch = text.match(/(?:principal|prin|princi)\s*(?:name)?\s*[-=:]\s*(.+?)(?:\n|$)/i)
    ?? text.match(/(?:manager|director)\s*[-=:]\s*(.+?)(?:\n|$)/i)
  const principalName = prinMatch?.[1]?.trim()?.replace(/\*+/g, '') || null

  // Mobile
  const mobMatch = text.match(/(?:mob|mobile|ph|phone|contact|no)\s*[-=:.]\s*([\d\s+-]{10,})/i)
    ?? text.match(/\b([6-9]\d{9})\b/)
  const principalMobile = mobMatch?.[1]?.trim()?.replace(/\s+/g, '') || null

  // Email
  const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i)
  const principalEmail = emailMatch?.[1] || null

  // Book seller
  const bsMatch = text.match(/(?:book\s*seller|bookseller|book\s*shop)\s*[-=:]\s*(.+?)(?:\n|$)/i)
  const bookSeller = bsMatch?.[1]?.trim() || null

  // Remark
  let remark: string | null = null
  let remarkDetail: string | null = null
  if (/sampl/i.test(text)) { remark = 'Sampling'; remarkDetail = text.match(/sampl[a-z]*\s*[-:]?\s*(.+?)(?:\n|$)/i)?.[1]?.trim() || null }
  else if (/meeting|met with|milna|mila/i.test(text)) { remark = 'Meeting with Principal' }
  else if (/follow\s*up|revisit/i.test(text)) { remark = 'Follow up Visit' }
  else if (/order|booked/i.test(text)) { remark = 'Order Received' }
  else if (/new\s*visit|first\s*visit|new\s*school/i.test(text)) { remark = 'New Visit' }

  return { schoolName, address, board, strength, principalName, principalMobile, principalEmail, bookSeller, remark, remarkDetail }
}

// ── Parse Excel ─────────────────────────────────────────────
async function loadMessages(): Promise<{ sender: string; date: string; message: string }[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(CHAT_FILE)
  const sheet = wb.getWorksheet('Dec')
  if (!sheet) throw new Error('Dec sheet not found')

  const msgs: { sender: string; date: string; message: string }[] = []
  sheet.eachRow((row, i) => {
    if (i === 1) return
    const sender = String(row.getCell(3).value ?? '').trim()
    const message = String(row.getCell(4).value ?? '').trim()
    const rawDate = String(row.getCell(1).value ?? '')
    const type = String(row.getCell(5).value ?? 'Text')
    if (!sender || !message || type !== 'Text') return

    const d = new Date(rawDate)
    const date = !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '2025-12-01'
    msgs.push({ sender, date, message })
  })
  return msgs
}

// ── Group messages into visit chunks ────────────────────────
function groupMessages(msgs: { sender: string; date: string; message: string }[]): { sender: string; date: string; combined: string }[] {
  const chunks: { sender: string; date: string; messages: string[] }[] = []
  let current: typeof chunks[0] | null = null

  for (const m of msgs) {
    if (!current || m.sender !== current.sender || m.date !== current.date) {
      if (current) chunks.push(current)
      current = { sender: m.sender, date: m.date, messages: [m.message] }
    } else {
      current.messages.push(m.message)
    }
  }
  if (current) chunks.push(current)

  return chunks.map(c => ({ sender: c.sender, date: c.date, combined: c.messages.join('\n') }))
}

// ── Main seed ───────────────────────────────────────────────
async function seed() {
  console.log('🌱 Seeding from real Excel data...\n')

  // Clear existing data
  await prisma.alert.deleteMany()
  await prisma.visit.deleteMany()
  await prisma.dailySummary.deleteMany()
  await prisma.ingestionRun.deleteMany()
  await prisma.school.deleteMany()
  await prisma.executive.deleteMany()
  console.log('  Cleared existing data')

  // Load and parse
  const messages = await loadMessages()
  console.log(`  Loaded ${messages.length} text messages from Dec sheet`)

  const chunks = groupMessages(messages)
  console.log(`  Grouped into ${chunks.length} chunks`)

  // Extract visits via regex
  const visits: ParsedVisit[] = []
  for (const chunk of chunks) {
    const extracted = extractFromText(chunk.combined)
    if (extracted) {
      visits.push({
        ...extracted,
        sender: chunk.sender,
        date: chunk.date,
        raw: chunk.combined.slice(0, 500),
      })
    }
  }
  console.log(`  Extracted ${visits.length} visits via regex\n`)

  // Create settings
  await prisma.settings.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      dailyTargetVisits: 8,
      alertEmailTo: 'manager@publisher.com',
      managerEmail: 'nishkarsh@publisher.com',
      whatsappGroupName: 'Friends Sales Team',
    },
  })

  // Create executives from unique senders
  const senderSet = new Set(visits.map(v => v.sender))
  const execMap: Record<string, string> = {}
  let execCount = 0
  for (const sender of senderSet) {
    const display = sender.replace(/^Fp\s*/i, '').replace(/\s*sales\s*/i, '').replace(/\s*-.*$/, '').trim() || sender
    const id = sender.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const exec = await prisma.executive.create({
      data: { id, name: sender, displayName: display, active: true, dailyTarget: 8 },
    })
    execMap[sender] = exec.id
    execCount++
  }
  console.log(`  Created ${execCount} executives`)

  // Create schools and visits
  const schoolMap: Record<string, string> = {}
  let schoolCount = 0
  let visitCount = 0
  const alertList: { execId: string; type: string; message: string; severity: string }[] = []

  // Group visits by date for daily summaries
  const visitsByDate: Record<string, ParsedVisit[]> = {}

  for (const v of visits) {
    // Create or find school
    const schoolKey = v.schoolName.toLowerCase().trim()
    if (!schoolMap[schoolKey]) {
      const school = await prisma.school.create({
        data: {
          canonicalName: v.schoolName,
          aliases: [],
          address: v.address,
          board: v.board,
          lastKnownStrength: v.strength,
          principalName: v.principalName,
          principalMobile: v.principalMobile,
          principalEmail: v.principalEmail,
          bookSeller: v.bookSeller,
        },
      })
      schoolMap[schoolKey] = school.id
      schoolCount++
    }

    // Determine missing fields
    const missing: string[] = []
    if (!v.board) missing.push('board')
    if (!v.strength) missing.push('strength')
    if (!v.principalName) missing.push('principalName')
    if (!v.principalMobile) missing.push('principalMobile')

    const visitDate = new Date(v.date + 'T12:00:00.000Z')

    await prisma.visit.create({
      data: {
        executiveId: execMap[v.sender],
        schoolId: schoolMap[schoolKey],
        visitDate,
        rawText: v.raw,
        schoolNameRaw: v.schoolName,
        address: v.address,
        board: v.board,
        strength: v.strength,
        principalName: v.principalName,
        principalMobile: v.principalMobile,
        principalEmail: v.principalEmail,
        bookSeller: v.bookSeller,
        remark: v.remark,
        remarkDetail: v.remarkDetail,
        dataComplete: missing.length === 0,
        missingFields: missing,
        extractionModel: 'regex-seed',
        isRepeatVisit: false,
        visitNumberInSession: 1,
        changesFromLast: [],
      },
    })
    visitCount++

    // Track by date
    if (!visitsByDate[v.date]) visitsByDate[v.date] = []
    visitsByDate[v.date].push(v)

    // Generate alerts for missing critical data
    if (missing.length > 0 && missing.length <= 2) {
      alertList.push({
        execId: execMap[v.sender],
        type: 'MISSING_DATA',
        message: `Missing ${missing.join(', ')} for ${v.schoolName}`,
        severity: 'medium',
      })
    }
  }
  console.log(`  Created ${schoolCount} schools`)
  console.log(`  Created ${visitCount} visits`)

  // Generate target alerts per date
  for (const [date, dateVisits] of Object.entries(visitsByDate)) {
    const byExec: Record<string, number> = {}
    for (const v of dateVisits) {
      byExec[v.sender] = (byExec[v.sender] || 0) + 1
    }
    for (const [sender, count] of Object.entries(byExec)) {
      if (count < 8) {
        alertList.push({
          execId: execMap[sender],
          type: 'TARGET_NOT_MET',
          message: `Only ${count}/8 visits on ${date}. Gap: ${8 - count}.`,
          severity: count < 4 ? 'high' : 'medium',
        })
      }
    }
  }

  // Write alerts (cap at 30 to keep it reasonable for demo)
  const alertsToWrite = alertList.slice(0, 30)
  for (const a of alertsToWrite) {
    await prisma.alert.create({
      data: {
        executiveId: a.execId,
        alertType: a.type,
        message: a.message,
        severity: a.severity,
        resolved: false,
      },
    })
  }
  console.log(`  Created ${alertsToWrite.length} alerts`)

  // Create daily summaries for each date with visits
  for (const [date, dateVisits] of Object.entries(visitsByDate)) {
    const execsReporting = new Set(dateVisits.map(v => v.sender)).size
    const complete = dateVisits.filter(v => {
      const missing = []
      if (!v.board) missing.push('board')
      if (!v.strength) missing.push('strength')
      if (!v.principalName) missing.push('principalName')
      if (!v.principalMobile) missing.push('principalMobile')
      return missing.length === 0
    }).length
    const completeness = Math.round((complete / dateVisits.length) * 100)

    await prisma.dailySummary.create({
      data: {
        summaryDate: new Date(date + 'T12:00:00.000Z'),
        totalExecutivesReporting: execsReporting,
        totalVisits: dateVisits.length,
        avgVisitsPerExec: Math.round((dateVisits.length / execsReporting) * 10) / 10,
        targetsMetCount: Object.values(
          dateVisits.reduce<Record<string, number>>((acc, v) => { acc[v.sender] = (acc[v.sender] || 0) + 1; return acc }, {})
        ).filter(c => c >= 8).length,
        targetsMissedCount: execsReporting - Object.values(
          dateVisits.reduce<Record<string, number>>((acc, v) => { acc[v.sender] = (acc[v.sender] || 0) + 1; return acc }, {})
        ).filter(c => c >= 8).length,
        newSchoolsCount: dateVisits.length, // simplified
        repeatVisitsCount: 0,
        dataCompletenessPct: completeness,
        summaryText: `${date}: ${execsReporting} executives reported ${dateVisits.length} visits (avg ${(dateVisits.length / execsReporting).toFixed(1)}/exec). Data completeness: ${completeness}%.`,
      },
    })
  }
  console.log(`  Created ${Object.keys(visitsByDate).length} daily summaries`)

  // Ingestion run log
  await prisma.ingestionRun.create({
    data: {
      runDate: new Date(),
      messagesScraped: messages.length,
      messagesAfterFilter: chunks.length,
      chunksCreated: visits.length,
      visitsExtracted: visitCount,
      alertsGenerated: alertsToWrite.length,
      haikuTokensUsed: 0,
      sonnetTokensUsed: 0,
      status: 'success',
    },
  })

  console.log(`\n✅ Demo seeded from real data!`)
  console.log(`   ${execCount} executives | ${schoolCount} schools | ${visitCount} visits | ${alertsToWrite.length} alerts`)
  console.log(`   Dates: ${Object.keys(visitsByDate).sort().join(', ')}`)
}

seed()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
