import { createHash } from 'node:crypto'
import type {
  RawMessage,
  ValidatedVisit,
  Alert,
  DailySummary,
  IngestionRun,
  PipelineConfig,
} from '@/types'
import { extractVisitData, generateDailySummary } from '@/lib/ai'
import { prisma } from '@/lib/db'
import { preprocess } from './preprocessor'
import { validateFields, checkTargets, compareWithHistory, generateAlerts } from './validator'
import { createSchoolMatcher, normalizeSchoolName } from './school-matcher'

// ── Pipeline output ──────────────────────────────────────────
export interface PipelineResult {
  visits: ValidatedVisit[]
  alerts: Alert[]
  summary: DailySummary
  run: IngestionRun
}

// ── Main pipeline ────────────────────────────────────────────
export async function runPipeline(
  messages: RawMessage[],
  config: PipelineConfig
): Promise<PipelineResult> {
  const errors: string[] = []
  let haikuTokensUsed = 0
  let sonnetTokensUsed = 0

  const runDate = messages[0]?.date ?? new Date().toISOString().substring(0, 10)

  // ── Step 1: Preprocess ──────────────────────────────────────
  const chunks = preprocess(messages)

  // ── Step 2: Load reference data ─────────────────────────────
  const [schools, executives] = await Promise.all([
    prisma.school.findMany({ select: { id: true, canonicalName: true, aliases: true } }),
    prisma.executive.findMany({
      where: { active: true },
      select: { id: true, displayName: true, dailyTarget: true },
    }),
  ])

  const execNameToId = new Map(executives.map((e) => [e.displayName.toLowerCase(), e.id]))
  const allExecutiveNames = executives.map((e) => e.displayName)

  // Auto-onboard senders we've never seen before. Without this, every visit
  // from a new rep is silently dropped at the FK guard further down.
  const getOrCreateExecId = async (rawName: string): Promise<string | null> => {
    const trimmed = rawName.trim()
    if (!trimmed) return null
    if (trimmed === 'Unknown') return null
    if (/@(g\.us|s\.whatsapp\.net|broadcast|newsletter)$/i.test(trimmed)) return null
    const key = trimmed.toLowerCase()
    const cached = execNameToId.get(key)
    if (cached) return cached

    const id =
      trimmed
        .replace(/[^a-zA-Z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase() || `unnamed-${Date.now()}`

    try {
      const created = await prisma.executive.upsert({
        where: { id },
        update: {},
        create: {
          id,
          name: trimmed,
          displayName: trimmed,
          dailyTarget: config.dailyTargetVisits,
          active: true,
        },
      })
      execNameToId.set(key, created.id)
      if (!allExecutiveNames.includes(created.displayName)) {
        allExecutiveNames.push(created.displayName)
      }
      return created.id
    } catch (err) {
      throw new Error(
        `Executive upsert failed for "${trimmed}": ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  // Cast schools for compatibility (SQLite stores aliases as string, PostgreSQL as string[])
  const parsedSchools = schools.map(s => ({
    ...s,
    aliases: Array.isArray(s.aliases) ? s.aliases : (typeof s.aliases === 'string' ? JSON.parse(s.aliases as string) : []) as string[],
  }))
  const matchSchool = createSchoolMatcher(parsedSchools)

  // ── Step 3: Load today's + yesterday's visits (for repeat detection) ──
  const todayStart = new Date(`${runDate}T00:00:00.000Z`)
  const todayEnd   = new Date(`${runDate}T23:59:59.999Z`)
  const yesterdayStart = new Date(todayStart)
  yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1)

  const [todayDbVisits, yesterdayDbVisits] = await Promise.all([
    prisma.visit.findMany({
      where: { visitDate: { gte: todayStart, lte: todayEnd } },
      include: { executive: true, school: true },
    }),
    prisma.visit.findMany({
      where: { visitDate: { gte: yesterdayStart, lt: todayStart } },
      include: { executive: true, school: true },
    }),
  ])

  const previousDbVisits = [...yesterdayDbVisits, ...todayDbVisits]

  // Convert DB visits to ValidatedVisit shape for history comparison
  const previousVisits: ValidatedVisit[] = previousDbVisits.map((v) => ({
    isVisitReport: true,
    schoolName: v.schoolNameRaw,
    canonicalSchoolName: v.school?.canonicalName,
    schoolId: v.school?.id,
    address: v.address,
    board: v.board as ValidatedVisit['board'],
    strength: v.strength,
    principalName: v.principalName,
    principalMobile: v.principalMobile,
    principalEmail: v.principalEmail,
    principalDob: v.principalDob,
    bookSeller: v.bookSeller,
    remark: v.remark as ValidatedVisit['remark'],
    remarkDetail: v.remarkDetail,
    executiveName: v.executive.displayName,
    visitDate: v.visitDate.toISOString().substring(0, 10),
    rawText: v.rawText ?? '',
    locationUrl: v.locationUrl ?? undefined,
    dataComplete: v.dataComplete,
    missingFields: (Array.isArray(v.missingFields) ? v.missingFields : JSON.parse(v.missingFields as unknown as string)) as string[],
    extractionModel: (v.extractionModel ?? 'haiku') as 'haiku' | 'sonnet',
    isRepeatVisit: v.isRepeatVisit,
    visitNumberInSession: v.visitNumberInSession,
    changesFromLast: (v.changesFromLast as unknown as ValidatedVisit['changesFromLast']) ?? [],
  }))

  // ── Step 4: Extract + validate each chunk ───────────────────
  const validatedVisits: ValidatedVisit[] = []
  const sessionVisits: ValidatedVisit[] = [...previousVisits] // grows as we process

  for (const chunk of chunks) {
    let extraction: Awaited<ReturnType<typeof extractVisitData>> | null = null

    try {
      extraction = await extractVisitData(
        chunk.senderNormalized,
        chunk.date,
        chunk.combinedText
      )
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`Extraction failed for ${chunk.senderNormalized}/${chunk.date}: ${msg}`)
      continue
    }

    // Skip if LLM says it's not a visit report
    if (!extraction.data.isVisitReport) continue

    // Track token usage
    if (extraction.model === 'haiku') {
      haikuTokensUsed += extraction.tokensUsed
    } else {
      sonnetTokensUsed += extraction.tokensUsed
    }

    // Validate fields
    const { dataComplete, missingFields } = validateFields(extraction.data)

    // School matching
    const schoolMatchResult = extraction.data.schoolName
      ? matchSchool(extraction.data.schoolName)
      : { matched: false, score: 0, possibleMatch: false }

    // History comparison
    const historyResult = compareWithHistory(
      {
        ...extraction.data,
        executiveName: chunk.senderNormalized,
        visitDate: chunk.date,
        rawText: chunk.combinedText,
        locationUrl: chunk.locationUrl,
        dataComplete,
        missingFields,
        extractionModel: extraction.model,
        canonicalSchoolName: schoolMatchResult.canonicalName,
        schoolId: schoolMatchResult.schoolId,
        isRepeatVisit: false,
        visitNumberInSession: 1,
        changesFromLast: [],
      },
      sessionVisits
    )

    const visit: ValidatedVisit = {
      ...extraction.data,
      executiveName: chunk.senderNormalized,
      visitDate: chunk.date,
      rawText: chunk.combinedText,
      locationUrl: chunk.locationUrl,
      dataComplete,
      missingFields,
      extractionModel: extraction.model,
      canonicalSchoolName: schoolMatchResult.canonicalName,
      schoolId: schoolMatchResult.schoolId,
      isRepeatVisit: historyResult.isRepeatVisit,
      visitNumberInSession: historyResult.visitNumberInSession,
      changesFromLast: historyResult.changesFromLast,
    }

    validatedVisits.push(visit)
    sessionVisits.push(visit)

    // ── Persist visit to DB ────────────────────────────────────
    try {
      const execId = await getOrCreateExecId(chunk.senderNormalized)

      if (execId) {
        // Stable 16-char hash for dedup; fall back to sentinel when rawText is empty
        const rawTextHash = createHash('md5')
          .update(chunk.combinedText || '__no_text__')
          .digest('hex')
          .slice(0, 16)

        const visitDate = new Date(`${chunk.date}T00:00:00.000Z`)

        const visitMutableFields = {
          schoolId: schoolMatchResult.matched ? schoolMatchResult.schoolId : null,
          remark: extraction.data.remark,
          remarkDetail: extraction.data.remarkDetail,
          dataComplete,
          missingFields: missingFields as any,
          extractionModel: extraction.model,
          isRepeatVisit: historyResult.isRepeatVisit,
          visitNumberInSession: historyResult.visitNumberInSession,
          changesFromLast: JSON.parse(JSON.stringify(historyResult.changesFromLast)),
        }

        await prisma.visit.upsert({
          where: { uniq_exec_day_text: { executiveId: execId, visitDate, rawTextHash } },
          create: {
            executiveId: execId,
            visitDate,
            rawText: chunk.combinedText,
            rawTextHash,
            schoolNameRaw: extraction.data.schoolName,
            address: extraction.data.address,
            board: extraction.data.board,
            strength: extraction.data.strength,
            principalName: extraction.data.principalName,
            principalMobile: extraction.data.principalMobile,
            principalEmail: extraction.data.principalEmail,
            principalDob: extraction.data.principalDob,
            bookSeller: extraction.data.bookSeller,
            locationUrl: chunk.locationUrl,
            ...visitMutableFields,
          },
          update: visitMutableFields,
          // NOTE: sheetAppendedAt is intentionally excluded from update to
          // avoid re-queueing already-synced rows on re-runs.
        })

        // Upsert school knowledge if we have enough data
        if (schoolMatchResult.matched && schoolMatchResult.schoolId) {
          await updateSchoolKnowledge(schoolMatchResult.schoolId, extraction.data)
        } else if (!schoolMatchResult.matched && extraction.data.schoolName) {
          await maybeCreateSchool(extraction.data)
        }
      } else {
        errors.push(`Unknown executive: ${chunk.senderNormalized} — visit not persisted`)
      }
    } catch (dbErr: unknown) {
      const msg = dbErr instanceof Error ? dbErr.message : String(dbErr)
      errors.push(`DB write failed for ${chunk.senderNormalized}: ${msg}`)
    }
  }

  // ── Step 5: Target checks + alerts ──────────────────────────
  const targetResults = checkTargets(validatedVisits, config.dailyTargetVisits)

  const alerts = generateAlerts(
    validatedVisits,
    targetResults,
    allExecutiveNames,
    config.maxRepeatsBeforeAlert
  )

  // ── Step 6: Persist alerts ───────────────────────────────────
  for (const alert of alerts) {
    try {
      const execId = await getOrCreateExecId(alert.executiveName)
      if (execId) {
        // Dedup: skip if an unresolved alert with same (exec, type, message) exists today
        const today = new Date(`${runDate}T00:00:00.000Z`)
        const existing = await prisma.alert.findFirst({
          where: {
            executiveId: execId,
            alertType: alert.alertType,
            message: alert.message,
            resolved: false,
            createdAt: { gte: today },
          },
        })
        if (existing) continue

        await prisma.alert.create({
          data: {
            executiveId: execId,
            alertType: alert.alertType,
            message: alert.message,
            severity: alert.severity,
          },
        })
      }
    } catch (dbErr: unknown) {
      const msg = dbErr instanceof Error ? dbErr.message : String(dbErr)
      errors.push(`Alert persist failed: ${msg}`)
    }
  }

  // ── Step 7: Build summary stats ──────────────────────────────
  const reportingExecs = new Set(validatedVisits.map((v) => v.executiveName))
  const notReporting = allExecutiveNames.filter((n) => !reportingExecs.has(n))
  const newSchoolsCount = validatedVisits.filter((v) => !v.isRepeatVisit).length
  const repeatVisitsCount = validatedVisits.filter((v) => v.isRepeatVisit).length
  const completeCount = validatedVisits.filter((v) => v.dataComplete).length
  const dataCompletenessPct =
    validatedVisits.length > 0
      ? Math.round((completeCount / validatedVisits.length) * 100)
      : 0

  const targetsMetCount = targetResults.filter((r) => r.targetMet).length
  const targetsMissedCount = targetResults.filter((r) => !r.targetMet).length

  const keyIssues: string[] = []
  if (notReporting.length > 0)
    keyIssues.push(`${notReporting.length} executives not reporting`)
  if (dataCompletenessPct < 70)
    keyIssues.push(`Low data completeness: ${dataCompletenessPct}%`)
  if (targetsMissedCount > 0)
    keyIssues.push(`${targetsMissedCount} executives missed target`)

  // ── Step 8: Generate AI summary text ─────────────────────────
  let summaryText: string | undefined
  try {
    const summaryResult = await generateDailySummary({
      date: runDate,
      executivesReporting: reportingExecs.size,
      totalExecutives: allExecutiveNames.length,
      notReporting,
      totalVisits: validatedVisits.length,
      targetsMet: targetsMetCount,
      targetsMissed: targetsMissedCount,
      newSchools: newSchoolsCount,
      repeatVisits: repeatVisitsCount,
      dataCompleteness: dataCompletenessPct,
      keyIssues,
    })
    summaryText = summaryResult.text
    sonnetTokensUsed += summaryResult.tokensUsed
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(`Summary generation failed: ${msg}`)
  }

  const summary: DailySummary = {
    date: runDate,
    totalExecutivesReporting: reportingExecs.size,
    totalExecutives: allExecutiveNames.length,
    notReporting,
    totalVisits: validatedVisits.length,
    avgVisitsPerExec:
      reportingExecs.size > 0
        ? Math.round((validatedVisits.length / reportingExecs.size) * 10) / 10
        : 0,
    targetsMetCount,
    targetsMissedCount,
    newSchoolsCount,
    repeatVisitsCount,
    dataCompletenessPct,
    summaryText,
  }

  // ── Step 9: Persist daily summary ───────────────────────────
  try {
    await prisma.dailySummary.upsert({
      where: { summaryDate: new Date(`${runDate}T00:00:00.000Z`) },
      create: {
        summaryDate: new Date(`${runDate}T00:00:00.000Z`),
        totalExecutivesReporting: summary.totalExecutivesReporting,
        totalVisits: summary.totalVisits,
        avgVisitsPerExec: summary.avgVisitsPerExec,
        targetsMetCount: summary.targetsMetCount,
        targetsMissedCount: summary.targetsMissedCount,
        newSchoolsCount: summary.newSchoolsCount,
        repeatVisitsCount: summary.repeatVisitsCount,
        dataCompletenessPct: summary.dataCompletenessPct,
        summaryText: summary.summaryText,
      },
      update: {
        totalExecutivesReporting: summary.totalExecutivesReporting,
        totalVisits: summary.totalVisits,
        avgVisitsPerExec: summary.avgVisitsPerExec,
        targetsMetCount: summary.targetsMetCount,
        targetsMissedCount: summary.targetsMissedCount,
        newSchoolsCount: summary.newSchoolsCount,
        repeatVisitsCount: summary.repeatVisitsCount,
        dataCompletenessPct: summary.dataCompletenessPct,
        summaryText: summary.summaryText,
      },
    })
  } catch (dbErr: unknown) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr)
    errors.push(`DailySummary persist failed: ${msg}`)
  }

  // ── Step 10: Persist ingestion run ───────────────────────────
  const runStatus: IngestionRun['status'] =
    errors.length === 0
      ? 'success'
      : validatedVisits.length > 0
        ? 'partial'
        : 'failed'

  let dbRun
  try {
    dbRun = await prisma.ingestionRun.create({
      data: {
        runDate: new Date(`${runDate}T00:00:00.000Z`),
        messagesScraped: messages.length,
        messagesAfterFilter: chunks.length,
        chunksCreated: chunks.length,
        visitsExtracted: validatedVisits.length,
        alertsGenerated: alerts.length,
        haikuTokensUsed,
        sonnetTokensUsed,
        status: runStatus,
        errorLog: errors.length > 0 ? errors.join('\n') : null,
      },
    })
  } catch (dbErr: unknown) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr)
    errors.push(`IngestionRun persist failed: ${msg}`)
    // Return a synthetic run object so the caller still gets a result
    dbRun = null
  }

  const run: IngestionRun = {
    date: runDate,
    messagesScraped: messages.length,
    messagesAfterFilter: chunks.length, // post-filter chunks as proxy
    chunksCreated: chunks.length,
    visitsExtracted: validatedVisits.length,
    alertsGenerated: alerts.length,
    haikuTokensUsed,
    sonnetTokensUsed,
    status: runStatus,
    errors,
  }

  return { visits: validatedVisits, alerts, summary, run }
}

// ── Helpers: DB knowledge updates ───────────────────────────

async function updateSchoolKnowledge(
  schoolId: string,
  data: Awaited<ReturnType<typeof extractVisitData>>['data']
): Promise<void> {
  await prisma.school.update({
    where: { id: schoolId },
    data: {
      ...(data.board            && { board: data.board }),
      ...(data.strength         && { lastKnownStrength: data.strength }),
      ...(data.principalName    && { principalName: data.principalName }),
      ...(data.principalMobile  && { principalMobile: data.principalMobile }),
      ...(data.principalEmail   && { principalEmail: data.principalEmail }),
      ...(data.principalDob     && { principalDob: data.principalDob }),
      ...(data.bookSeller       && { bookSeller: data.bookSeller }),
      ...(data.address          && { address: data.address }),
      updatedAt: new Date(),
    },
  })
}

async function maybeCreateSchool(
  data: Awaited<ReturnType<typeof extractVisitData>>['data']
): Promise<void> {
  if (!data.schoolName) return

  const canonicalName = normalizeSchoolName(data.schoolName)

  // Avoid duplicate creation with a quick lookup
  const existing = await prisma.school.findFirst({
    where: { canonicalName },
  })

  if (existing) return

  await prisma.school.create({
    data: {
      canonicalName,
      aliases: (data.schoolName !== canonicalName ? [data.schoolName] : []) as any,
      address: data.address,
      board: data.board,
      lastKnownStrength: data.strength,
      principalName: data.principalName,
      principalMobile: data.principalMobile,
      principalEmail: data.principalEmail,
      principalDob: data.principalDob,
      bookSeller: data.bookSeller,
    },
  })
}
