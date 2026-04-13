import type {
  ExtractedVisit,
  ValidatedVisit,
  TargetResult,
  Alert,
  AlertType,
  FieldChange,
} from '@/types'

// ── 1. validateFields ────────────────────────────────────────
export function validateFields(visit: ExtractedVisit): {
  dataComplete: boolean
  missingFields: string[]
} {
  const required: (keyof ExtractedVisit)[] = [
    'schoolName',
    'board',
    'strength',
    'principalName',
    'principalMobile',
  ]

  const missingFields = required.filter((field) => {
    const value = visit[field]
    return value === null || value === undefined || value === ''
  })

  return {
    dataComplete: missingFields.length === 0,
    missingFields: missingFields as string[],
  }
}

// ── 2. checkTargets ──────────────────────────────────────────
export function checkTargets(
  visits: ValidatedVisit[],
  dailyTarget: number
): TargetResult[] {
  const visitsByExec = new Map<string, number>()

  for (const visit of visits) {
    const key = visit.executiveName
    visitsByExec.set(key, (visitsByExec.get(key) ?? 0) + 1)
  }

  return Array.from(visitsByExec.entries()).map(([executiveName, visitsToday]) => ({
    executiveName,
    visitsToday,
    target: dailyTarget,
    targetMet: visitsToday >= dailyTarget,
    gap: Math.max(0, dailyTarget - visitsToday),
  }))
}

// ── 3. compareWithHistory ────────────────────────────────────
export function compareWithHistory(
  visit: ValidatedVisit,
  previousVisits: ValidatedVisit[]
): {
  isRepeatVisit: boolean
  visitNumberInSession: number
  changesFromLast: FieldChange[]
} {
  // Match previous visits to the same school (by canonicalSchoolName if available, else schoolName)
  const targetSchool = (
    visit.canonicalSchoolName ?? visit.schoolName ?? ''
  ).toLowerCase()

  const sameSchoolVisits = previousVisits.filter((v) => {
    const school = (v.canonicalSchoolName ?? v.schoolName ?? '').toLowerCase()
    return school === targetSchool && school !== ''
  })

  const isRepeatVisit = sameSchoolVisits.length > 0
  const visitNumberInSession = sameSchoolVisits.length + 1

  const changesFromLast: FieldChange[] = []

  if (sameSchoolVisits.length > 0) {
    const last = sameSchoolVisits[sameSchoolVisits.length - 1]!

    const fieldsToCompare: (keyof ExtractedVisit)[] = [
      'board',
      'strength',
      'principalName',
      'principalMobile',
      'principalEmail',
      'principalDob',
      'bookSeller',
      'remark',
    ]

    for (const field of fieldsToCompare) {
      const oldValue = last[field] as string | number | null
      const newValue = visit[field] as string | number | null

      if (oldValue !== newValue && (oldValue !== null || newValue !== null)) {
        changesFromLast.push({ field, oldValue, newValue })
      }
    }
  }

  return { isRepeatVisit, visitNumberInSession, changesFromLast }
}

// ── 4. generateAlerts ────────────────────────────────────────
export function generateAlerts(
  visits: ValidatedVisit[],
  targetResults: TargetResult[],
  allExecutives: string[],
  maxRepeatsBeforeAlert = 3
): Alert[] {
  const alerts: Alert[] = []

  // MISSING_DATA: visits with incomplete data
  for (const visit of visits) {
    if (!visit.dataComplete) {
      alerts.push({
        executiveName: visit.executiveName,
        alertType: 'MISSING_DATA' as AlertType,
        message: `Missing fields for ${visit.schoolName ?? 'unknown school'}: ${visit.missingFields.join(', ')}`,
        schoolName: visit.schoolName ?? undefined,
        severity: visit.missingFields.length >= 3 ? 'high' : 'medium',
      })
    }
  }

  // TARGET_NOT_MET: executives who reported but didn't hit target
  for (const result of targetResults) {
    if (!result.targetMet) {
      alerts.push({
        executiveName: result.executiveName,
        alertType: 'TARGET_NOT_MET' as AlertType,
        message: `${result.executiveName} completed ${result.visitsToday}/${result.target} visits today (gap: ${result.gap})`,
        severity: result.gap >= 4 ? 'high' : 'medium',
      })
    }
  }

  // STATUS_CHANGED: visits with meaningful field changes from last visit
  for (const visit of visits) {
    if (visit.changesFromLast.length > 0) {
      const changedFields = visit.changesFromLast.map((c) => c.field).join(', ')
      alerts.push({
        executiveName: visit.executiveName,
        alertType: 'STATUS_CHANGED' as AlertType,
        message: `${visit.schoolName ?? 'Unknown school'} data changed since last visit: ${changedFields}`,
        schoolName: visit.schoolName ?? undefined,
        severity: 'low',
      })
    }
  }

  // NO_REPORT: executives in the roster who didn't submit any visits
  const reportingExecs = new Set(visits.map((v) => v.executiveName))
  for (const exec of allExecutives) {
    if (!reportingExecs.has(exec)) {
      alerts.push({
        executiveName: exec,
        alertType: 'NO_REPORT' as AlertType,
        message: `${exec} has not submitted any visit report today`,
        severity: 'high',
      })
    }
  }

  // EXCESSIVE_REPEAT: same school visited more than maxRepeatsBeforeAlert times
  const schoolVisitCount = new Map<string, { exec: string; count: number }>()

  for (const visit of visits) {
    const key = `${visit.executiveName}:${(visit.canonicalSchoolName ?? visit.schoolName ?? '').toLowerCase()}`
    const existing = schoolVisitCount.get(key)
    if (existing) {
      existing.count++
    } else {
      schoolVisitCount.set(key, { exec: visit.executiveName, count: 1 })
    }
  }

  for (const [key, { exec, count }] of schoolVisitCount.entries()) {
    if (count > maxRepeatsBeforeAlert) {
      const schoolPart = key.split(':').slice(1).join(':')
      alerts.push({
        executiveName: exec,
        alertType: 'EXCESSIVE_REPEAT' as AlertType,
        message: `${exec} has visited "${schoolPart}" ${count} times today (threshold: ${maxRepeatsBeforeAlert})`,
        schoolName: schoolPart,
        severity: 'medium',
      })
    }
  }

  return alerts
}
