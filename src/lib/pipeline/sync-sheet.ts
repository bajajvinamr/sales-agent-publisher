import { prisma } from '@/lib/db'
import {
  appendVisitRows,
  ensureSheetReady,
  type SheetRowVisit,
} from '@/lib/integrations/google-sheets'

export interface SyncResult {
  appended: number
  pendingBefore: number
  skipped: 'disabled' | 'no_sheet_id' | 'no_creds' | null
  error: string | null
}

/**
 * Append all visits where sheetAppendedAt IS NULL to the configured Google Sheet,
 * then mark them synced. Idempotent — safe to call repeatedly. Never throws.
 */
export async function syncPendingVisits(): Promise<SyncResult> {
  const base = { appended: 0, pendingBefore: 0, skipped: null, error: null }

  try {
    const settings = await prisma.settings.findUnique({ where: { id: 'default' } })

    if (!settings?.sheetSyncEnabled) {
      return { ...base, skipped: 'disabled' }
    }
    if (!settings.googleSheetId) {
      return { ...base, skipped: 'no_sheet_id' }
    }
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      return { ...base, skipped: 'no_creds' }
    }

    const tabName = settings.googleSheetTab || 'Visits'

    const pending = await prisma.visit.findMany({
      where: { sheetAppendedAt: null },
      orderBy: [{ visitDate: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        visitDate: true,
        schoolNameRaw: true,
        address: true,
        board: true,
        strength: true,
        principalName: true,
        principalMobile: true,
        principalEmail: true,
        principalDob: true,
        bookSeller: true,
        remark: true,
        remarkDetail: true,
        executive: { select: { displayName: true } },
        school: { select: { canonicalName: true } },
      },
    })

    if (pending.length === 0) {
      await prisma.settings.update({
        where: { id: 'default' },
        data: { lastSheetSyncAt: new Date(), lastSheetSyncError: null },
      })
      return { ...base, pendingBefore: 0 }
    }

    await ensureSheetReady(settings.googleSheetId, tabName)

    const rows: SheetRowVisit[] = pending.map((v) => ({
      id: v.id,
      visitDate: v.visitDate,
      executiveName: v.executive.displayName,
      schoolName: v.school?.canonicalName ?? v.schoolNameRaw,
      address: v.address,
      board: v.board,
      strength: v.strength,
      principalName: v.principalName,
      principalMobile: v.principalMobile,
      principalDob: v.principalDob,
      principalEmail: v.principalEmail,
      bookSeller: v.bookSeller,
      remark: v.remark,
      remarkDetail: v.remarkDetail,
    }))

    const BATCH_SIZE = 500
    let appended = 0

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE)
      const batchIds = batch.map((r) => r.id)

      await appendVisitRows(settings.googleSheetId, tabName, batch)

      try {
        await prisma.visit.updateMany({
          where: { id: { in: batchIds } },
          data: { sheetAppendedAt: new Date() },
        })
      } catch (markErr) {
        console.error('[sync-sheet] append succeeded but marking failed — next sync will re-append this batch:', markErr)
        // Continue — don't fail the whole sync for a marking error
      }

      appended += batch.length
    }

    await prisma.settings.update({
      where: { id: 'default' },
      data: { lastSheetSyncAt: new Date(), lastSheetSyncError: null },
    })

    return {
      appended,
      pendingBefore: pending.length,
      skipped: null,
      error: null,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[sync-sheet] failed:', message)
    try {
      await prisma.settings.update({
        where: { id: 'default' },
        data: { lastSheetSyncError: message },
      })
    } catch {
      // swallow — don't mask the original
    }
    return { ...base, error: message }
  }
}
