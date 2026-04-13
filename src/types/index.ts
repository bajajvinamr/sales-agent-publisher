// ═══════════════════════════════════════════════════════════════
// Shared types for WhatsApp Sales Agent
// ═══════════════════════════════════════════════════════════════

// ── Raw WhatsApp message (from scraper) ──────────────────────
export interface RawMessage {
  date: string        // "2026-04-13"
  time: string        // "10:32"
  sender: string      // "Fp Sunil"
  message: string     // raw text
  messageType: 'Text' | 'Location' | 'LiveLocation' | 'MediaOmitted' | 'Deleted' | 'Link'
  url?: string        // Google Maps URL if location
}

// ── Pre-processed visit chunk (grouped messages) ─────────────
export interface VisitChunk {
  sender: string
  senderNormalized: string   // "Sunil" (stripped "Fp" prefix)
  date: string
  timestamp: string          // ISO string of first message
  messages: RawMessage[]
  combinedText: string       // all message texts joined
  locationUrl?: string
  messageCount: number
}

// ── LLM extraction output (from Haiku) ───────────────────────
export interface ExtractedVisit {
  isVisitReport: boolean
  schoolName: string | null
  address: string | null
  board: 'CBSE' | 'ICSE' | 'MPBSE' | 'State Board' | null
  strength: number | null
  principalName: string | null
  principalMobile: string | null
  principalEmail: string | null
  principalDob: string | null
  bookSeller: string | null
  remark: 'New Visit' | 'Follow up Visit' | 'Sampling' | 'Meeting with Principal' | 'Order Received' | 'Other' | null
  remarkDetail: string | null
}

// ── Validated visit record (after post-processing) ───────────
export interface ValidatedVisit extends ExtractedVisit {
  executiveName: string
  visitDate: string
  rawText: string
  locationUrl?: string
  dataComplete: boolean
  missingFields: string[]
  extractionModel: 'haiku' | 'sonnet'
  // School matching
  canonicalSchoolName?: string
  schoolId?: string
  // Historical tracking
  isRepeatVisit: boolean
  visitNumberInSession: number
  changesFromLast: FieldChange[]
}

export interface FieldChange {
  field: string
  oldValue: string | number | null
  newValue: string | number | null
}

// ── Alert ────────────────────────────────────────────────────
export type AlertType = 'MISSING_DATA' | 'TARGET_NOT_MET' | 'STATUS_CHANGED' | 'NO_REPORT' | 'EXCESSIVE_REPEAT'

export interface Alert {
  executiveName: string
  alertType: AlertType
  message: string
  visitId?: string
  schoolName?: string
  severity: 'high' | 'medium' | 'low'
}

// ── Target check result ──────────────────────────────────────
export interface TargetResult {
  executiveName: string
  visitsToday: number
  target: number
  targetMet: boolean
  gap: number
}

// ── Daily summary ────────────────────────────────────────────
export interface DailySummary {
  date: string
  totalExecutivesReporting: number
  totalExecutives: number
  notReporting: string[]
  totalVisits: number
  avgVisitsPerExec: number
  targetsMetCount: number
  targetsMissedCount: number
  newSchoolsCount: number
  repeatVisitsCount: number
  dataCompletenessPct: number
  summaryText?: string  // Sonnet-generated
}

// ── Executive performance (weekly) ───────────────────────────
export interface ExecWeeklyPerformance {
  executiveName: string
  weekStart: string
  weekEnd: string
  dailyVisits: number[]  // [mon, tue, wed, thu, fri, sat]
  totalVisits: number
  weeklyTarget: number
  targetMet: boolean
  newSchools: number
  repeatVisits: number
  samplingCount: number
  meetingCount: number
  missingDataCount: number
  summaryText?: string  // Sonnet-generated
}

// ── Pipeline config ──────────────────────────────────────────
export interface PipelineConfig {
  dailyTargetVisits: number
  chunkTimeWindowMinutes: number
  schoolMatchThreshold: number     // fuzzy match score 0-100
  maxRepeatsBeforeAlert: number
  requiredFields: string[]
}

export const DEFAULT_CONFIG: PipelineConfig = {
  dailyTargetVisits: 8,
  chunkTimeWindowMinutes: 5,
  schoolMatchThreshold: 80,
  maxRepeatsBeforeAlert: 3,
  requiredFields: ['schoolName', 'board', 'strength', 'principalName', 'principalMobile']
}

// ── Ingestion run log ────────────────────────────────────────
export interface IngestionRun {
  date: string
  messagesScraped: number
  messagesAfterFilter: number
  chunksCreated: number
  visitsExtracted: number
  alertsGenerated: number
  haikuTokensUsed: number
  sonnetTokensUsed: number
  status: 'success' | 'partial' | 'failed'
  errors: string[]
}
