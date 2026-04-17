import { google, sheets_v4 } from 'googleapis'

/**
 * Column order for the Visits sheet. Keep in sync with SHEET_HEADERS and buildRowFromVisit().
 * Changing order requires migrating the target sheet — do not reorder without a plan.
 */
export const SHEET_HEADERS = [
  'Date',
  'Employee Name',
  'School Name',
  'Address',
  'Board',
  'Strength',
  'Principal Name',
  'Principal Mobile',
  'Principal DOB',
  'Principal Email',
  'Book Seller',
  'Remark',
  'Visit ID',
] as const

export type SheetRowVisit = {
  id: string
  visitDate: Date | string
  executiveName: string
  schoolName: string | null
  address: string | null
  board: string | null
  strength: number | null
  principalName: string | null
  principalMobile: string | null
  principalDob: string | null
  principalEmail: string | null
  bookSeller: string | null
  remark: string | null
  remarkDetail: string | null
}

function formatDate(d: Date | string): string {
  if (typeof d === 'string') return d.substring(0, 10)
  return d.toISOString().substring(0, 10)
}

export function buildRowFromVisit(v: SheetRowVisit): (string | number)[] {
  const remarkCell = v.remark
    ? v.remarkDetail
      ? `${v.remark} — ${v.remarkDetail}`
      : v.remark
    : ''

  return [
    formatDate(v.visitDate),
    v.executiveName ?? '',
    v.schoolName ?? '',
    v.address ?? '',
    v.board ?? '',
    v.strength ?? '',
    v.principalName ?? '',
    v.principalMobile ?? '',
    v.principalDob ?? '',
    v.principalEmail ?? '',
    v.bookSeller ?? '',
    remarkCell,
    v.id,
  ]
}

/**
 * Parse GOOGLE_SERVICE_ACCOUNT_JSON env. Accepts raw JSON or base64-encoded JSON.
 */
function loadServiceAccount(): { client_email: string; private_key: string } {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not set')

  let jsonString = raw.trim()
  if (!jsonString.startsWith('{')) {
    jsonString = Buffer.from(jsonString, 'base64').toString('utf-8')
  }

  const parsed = JSON.parse(jsonString) as {
    client_email?: string
    private_key?: string
  }

  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('Service account JSON missing client_email or private_key')
  }

  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key.replace(/\\n/g, '\n'),
  }
}

export function getServiceAccountEmail(): string | null {
  try {
    return loadServiceAccount().client_email
  } catch {
    return null
  }
}

let sheetsClientCache: sheets_v4.Sheets | null = null

function getSheetsClient(): sheets_v4.Sheets {
  if (sheetsClientCache) return sheetsClientCache

  const sa = loadServiceAccount()
  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })

  sheetsClientCache = google.sheets({ version: 'v4', auth })
  return sheetsClientCache
}

/**
 * Ensure the target tab exists and has headers in row 1.
 * Idempotent — safe to call on every sync.
 */
export async function ensureSheetReady(
  spreadsheetId: string,
  tabName: string
): Promise<void> {
  const sheets = getSheetsClient()

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(title,sheetId))',
  })

  const existing = meta.data.sheets?.find(
    (s) => s.properties?.title === tabName
  )

  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: tabName } } }],
      },
    })
  }

  // Read row 1 to see if headers are present
  const headerRange = `${tabName}!A1:${columnLetter(SHEET_HEADERS.length)}1`
  const current = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: headerRange,
  })

  const firstRow = current.data.values?.[0] ?? []
  const headersMatch =
    firstRow.length === SHEET_HEADERS.length &&
    SHEET_HEADERS.every((h, i) => firstRow[i] === h)

  if (!headersMatch) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: headerRange,
      valueInputOption: 'RAW',
      requestBody: { values: [SHEET_HEADERS as unknown as string[]] },
    })
  }
}

export async function appendVisitRows(
  spreadsheetId: string,
  tabName: string,
  visits: SheetRowVisit[]
): Promise<number> {
  if (visits.length === 0) return 0

  const sheets = getSheetsClient()
  const values = visits.map(buildRowFromVisit)

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tabName}!A:A`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  })

  return values.length
}

function columnLetter(n: number): string {
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}
