import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import {
  generateDailyReportExcelFromDb,
  type DbVisitRow,
} from '../src/lib/pipeline/excel-export'

function makeRow(overrides: Partial<DbVisitRow> = {}): DbVisitRow {
  return {
    id: 'v1',
    visitDate: new Date('2026-04-23T00:00:00.000Z'),
    schoolNameRaw: null,
    address: null,
    board: null,
    strength: null,
    principalName: null,
    principalMobile: null,
    principalEmail: null,
    principalDob: null,
    bookSeller: null,
    remark: null,
    remarkDetail: null,
    locationUrl: null,
    dataComplete: false,
    missingFields: [],
    isRepeatVisit: false,
    visitNumberInSession: 1,
    executive: { id: 'e1', displayName: 'Prakhar' },
    school: null,
    ...overrides,
  }
}

async function readSheet(buf: Buffer) {
  const wb = new ExcelJS.Workbook()
  // Node 22's Buffer is generic (Buffer<ArrayBufferLike>); exceljs's types predate that.
  // The runtime is identical — cast through unknown to satisfy the older signature.
  await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0])
  const sheet = wb.worksheets[0]
  const rows: string[][] = []
  sheet.eachRow((row) => {
    const cells: string[] = []
    row.eachCell({ includeEmpty: true }, (c) => cells.push(String(c.value ?? '')))
    rows.push(cells)
  })
  return rows
}

describe('generateDailyReportExcelFromDb', () => {
  it('renders executive.displayName in Employee Name column', async () => {
    const buf = await generateDailyReportExcelFromDb(
      [makeRow({ executive: { id: 'e1', displayName: 'Prakhar' } })],
      '2026-04-23'
    )
    const rows = await readSheet(buf)
    expect(rows[0]).toEqual([
      'Date',
      'Employee Name',
      'School Name',
      'Address',
      'Details',
      'Remark',
    ])
    expect(rows[1][1]).toBe('Prakhar')
  })

  it('prefers school.canonicalName over schoolNameRaw', async () => {
    const buf = await generateDailyReportExcelFromDb(
      [
        makeRow({
          schoolNameRaw: 'carmel convent',
          school: { id: 's1', canonicalName: 'Carmel Convent School' },
        }),
      ],
      '2026-04-23'
    )
    const rows = await readSheet(buf)
    expect(rows[1][2]).toBe('Carmel Convent School')
  })

  it('falls back to schoolNameRaw when school is null', async () => {
    const buf = await generateDailyReportExcelFromDb(
      [makeRow({ schoolNameRaw: 'DPS Bhopal', school: null })],
      '2026-04-23'
    )
    const rows = await readSheet(buf)
    expect(rows[1][2]).toBe('DPS Bhopal')
  })

  it('renders em-dash for missing school entirely', async () => {
    const buf = await generateDailyReportExcelFromDb(
      [makeRow({ schoolNameRaw: null, school: null })],
      '2026-04-23'
    )
    const rows = await readSheet(buf)
    expect(rows[1][2]).toBe('—')
  })
})
