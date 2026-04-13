import ExcelJS from 'exceljs'
import type { ValidatedVisit, ExecWeeklyPerformance } from '@/types'

// ── Shared style helpers ─────────────────────────────────────
const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F4E79' },
}

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: 'FFFFFFFF' },
  size: 11,
}

const BORDER: Partial<ExcelJS.Borders> = {
  top:    { style: 'thin' },
  left:   { style: 'thin' },
  bottom: { style: 'thin' },
  right:  { style: 'thin' },
}

function styleHeader(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = BORDER
  })
  row.height = 22
}

function styleDataCell(cell: ExcelJS.Cell, wrapText = false): void {
  cell.alignment = { vertical: 'top', wrapText }
  cell.border = BORDER
}

// ── Format the Details multiline cell value ──────────────────
function formatDetails(visit: ValidatedVisit): string {
  const lines = [
    `Board: ${visit.board ?? '—'}`,
    `Strength: ${visit.strength ?? '—'}`,
    `Principal: ${visit.principalName ?? '—'}`,
    `Mobile No: ${visit.principalMobile ?? '—'}`,
    `DOB: ${visit.principalDob ?? '—'}`,
    `Email: ${visit.principalEmail ?? '—'}`,
    `Book Seller: ${visit.bookSeller ?? '—'}`,
  ]
  return lines.join('\n')
}

// ── 1. generateDailyReportExcel ──────────────────────────────
export async function generateDailyReportExcel(
  visits: ValidatedVisit[],
  date: string
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'WhatsApp Sales Agent'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet(`Daily Report ${date}`)

  // Column definitions
  sheet.columns = [
    { header: 'Date',          key: 'date',         width: 14 },
    { header: 'Employee Name', key: 'employee',     width: 20 },
    { header: 'School Name',   key: 'school',       width: 30 },
    { header: 'Address',       key: 'address',      width: 30 },
    { header: 'Details',       key: 'details',      width: 40 },
    { header: 'Remark',        key: 'remark',       width: 30 },
  ]

  styleHeader(sheet.getRow(1))

  for (const visit of visits) {
    const row = sheet.addRow({
      date:     visit.visitDate,
      employee: visit.executiveName,
      school:   visit.canonicalSchoolName ?? visit.schoolName ?? '—',
      address:  visit.address ?? '—',
      details:  formatDetails(visit),
      remark:   visit.remark
        ? visit.remarkDetail
          ? `${visit.remark} — ${visit.remarkDetail}`
          : visit.remark
        : '—',
    })

    row.eachCell((cell, colNumber) => {
      // Details column (col 5) needs wrapText for multiline
      styleDataCell(cell, colNumber === 5)
    })

    // Auto-height for the Details cell (7 lines × ~15px each)
    row.height = 7 * 15
  }

  // Freeze header row
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  // Auto-filter
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to:   { row: 1, column: 6 },
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

// ── 2. generateWeeklyReportExcel ─────────────────────────────
export async function generateWeeklyReportExcel(
  performances: ExecWeeklyPerformance[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'WhatsApp Sales Agent'
  workbook.created = new Date()

  // Derive week label from first entry (fallback to generic)
  const weekLabel =
    performances.length > 0
      ? `${performances[0]!.weekStart} to ${performances[0]!.weekEnd}`
      : 'Weekly Report'

  const sheet = workbook.addWorksheet(`Weekly ${weekLabel}`)

  const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  sheet.columns = [
    { header: 'Executive',   key: 'executive',  width: 20 },
    ...DAY_HEADERS.map((d) => ({ header: d, key: d.toLowerCase(), width: 8 })),
    { header: 'Total',       key: 'total',      width: 9 },
    { header: 'Target',      key: 'target',     width: 9 },
    { header: 'Met?',        key: 'met',        width: 8 },
    { header: 'New Schools', key: 'newSchools', width: 14 },
    { header: 'Sampling',    key: 'sampling',   width: 12 },
    { header: 'Meetings',    key: 'meetings',   width: 12 },
  ]

  styleHeader(sheet.getRow(1))

  for (const perf of performances) {
    const daily = perf.dailyVisits

    const row = sheet.addRow({
      executive: perf.executiveName,
      mon:       daily[0] ?? 0,
      tue:       daily[1] ?? 0,
      wed:       daily[2] ?? 0,
      thu:       daily[3] ?? 0,
      fri:       daily[4] ?? 0,
      sat:       daily[5] ?? 0,
      total:     perf.totalVisits,
      target:    perf.weeklyTarget,
      met:       perf.targetMet ? 'Yes' : 'No',
      newSchools: perf.newSchools,
      sampling:  perf.samplingCount,
      meetings:  perf.meetingCount,
    })

    row.eachCell((cell, colNumber) => {
      styleDataCell(cell)

      // Colour the "Met?" column green/red
      if (colNumber === 10) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: perf.targetMet ? 'FF92D050' : 'FFFF4C4C' },
        }
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
        cell.alignment = { horizontal: 'center' }
      }
    })
  }

  // Totals row
  const totalRow = sheet.addRow({
    executive: 'TOTAL',
    mon: performances.reduce((s, p) => s + (p.dailyVisits[0] ?? 0), 0),
    tue: performances.reduce((s, p) => s + (p.dailyVisits[1] ?? 0), 0),
    wed: performances.reduce((s, p) => s + (p.dailyVisits[2] ?? 0), 0),
    thu: performances.reduce((s, p) => s + (p.dailyVisits[3] ?? 0), 0),
    fri: performances.reduce((s, p) => s + (p.dailyVisits[4] ?? 0), 0),
    sat: performances.reduce((s, p) => s + (p.dailyVisits[5] ?? 0), 0),
    total: performances.reduce((s, p) => s + p.totalVisits, 0),
    target: performances.reduce((s, p) => s + p.weeklyTarget, 0),
    met: `${performances.filter((p) => p.targetMet).length}/${performances.length}`,
    newSchools: performances.reduce((s, p) => s + p.newSchools, 0),
    sampling: performances.reduce((s, p) => s + p.samplingCount, 0),
    meetings: performances.reduce((s, p) => s + p.meetingCount, 0),
  })

  totalRow.font = { bold: true }
  totalRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD6E4F0' },
    }
    cell.border = BORDER
  })

  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
