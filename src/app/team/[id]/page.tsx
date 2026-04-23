'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { format, parseISO, addDays } from 'date-fns'
import { Mail, RefreshCw, AlertTriangle } from 'lucide-react'

// ── API response shape (matches /api/executives/[id]) ────────
interface ApiResponse {
  executive: {
    id: string
    displayName: string
    email?: string | null
    dailyTarget: number
  }
  weeklyPerformance: {
    weekStart: string
    weekEnd: string
    dailyVisits: number[]   // length 6: Mon[0]…Sat[5]
    totalVisits: number
    weeklyTarget: number
    targetMet: boolean
    newSchools: number
    samplingCount: number
    meetingCount: number
  }
  thisWeekVisits: {
    id: string
    visitDate: string
    schoolNameRaw: string | null
    dataComplete: boolean
    missingFields: string[]
    school: { id: string; canonicalName: string } | null
  }[]
}

// ── Derived UI types ──────────────────────────────────────────
interface DailyVisit {
  date: string
  count: number
  label: string
}

interface ExecStats {
  weekTotal: number
  target: number
  newSchools: number
  samplingCount: number
  meetingCount: number
}

interface MissingData {
  date: string
  school: string
  fields: string[]
}

// ── Helpers ───────────────────────────────────────────────────
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function safeFormatDate(raw: string, fmt: string, fallback: string): string {
  try {
    const d = parseISO(raw)
    if (isNaN(d.getTime())) return fallback
    return format(d, fmt)
  } catch {
    return fallback
  }
}

function buildDailyVisits(weekStart: string, counts: number[]): DailyVisit[] {
  // weekStart is a YYYY-MM-DD string (Monday of this week)
  return counts.slice(0, 6).map((count, idx) => {
    try {
      const base = parseISO(weekStart)
      if (isNaN(base.getTime())) throw new Error('invalid')
      const day = addDays(base, idx)
      return {
        date: format(day, 'yyyy-MM-dd'),
        count,
        label: DAY_LABELS[idx] ?? String(idx),
      }
    } catch {
      return { date: `day-${idx}`, count, label: DAY_LABELS[idx] ?? String(idx) }
    }
  })
}

// ── Page component ────────────────────────────────────────────
export default function TeamPage() {
  const params = useParams()
  const id = typeof params.id === 'string' ? params.id : ''

  const [apiData, setApiData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        const res = await fetch(`/api/executives/${id}`)
        if (!res.ok) throw new Error('Failed to load executive data')
        const json: ApiResponse = await res.json()
        setApiData(json)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <RefreshCw size={28} className="animate-spin text-amber-400" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mt-8 bg-red-950 border border-red-500 rounded-xl p-4 text-center">
        <p className="text-red-400 text-sm">{error}</p>
      </div>
    )
  }

  if (!apiData) return null

  const { executive, weeklyPerformance, thisWeekVisits } = apiData

  // Derive UI values from the API response
  const dailyVisits: DailyVisit[] = buildDailyVisits(
    weeklyPerformance.weekStart,
    weeklyPerformance.dailyVisits
  )

  const stats: ExecStats = {
    weekTotal:     weeklyPerformance.totalVisits,
    target:        weeklyPerformance.weeklyTarget,
    newSchools:    weeklyPerformance.newSchools,
    samplingCount: weeklyPerformance.samplingCount,
    meetingCount:  weeklyPerformance.meetingCount,
  }

  const missingData: MissingData[] = thisWeekVisits
    .filter((v) => !v.dataComplete)
    .map((v) => ({
      date:   v.visitDate,
      school: v.school?.canonicalName ?? v.schoolNameRaw ?? '(unknown)',
      fields: v.missingFields,
    }))

  const maxVisits = Math.max(...dailyVisits.map((d) => d.count), 1)
  const targetMet = stats.weekTotal >= stats.target

  return (
    <div className="py-5 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-zinc-50">{executive.displayName}</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Weekly Performance</p>
      </div>

      {/* Week bar chart */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
        <p className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4">
          This Week&apos;s Visits
        </p>
        <div className="flex items-end gap-2 h-28">
          {dailyVisits.map((day) => {
            const heightPct = maxVisits > 0 ? (day.count / maxVisits) * 100 : 0
            const barColor =
              day.count >= Math.ceil(stats.target / 5)
                ? 'bg-emerald-500'
                : day.count > 0
                ? 'bg-amber-400'
                : 'bg-zinc-700'
            return (
              <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-xs font-semibold text-zinc-50">
                  {day.count > 0 ? day.count : ''}
                </span>
                <div className="w-full flex items-end" style={{ height: '80px' }}>
                  <div
                    className={`w-full rounded-t-md transition-all ${barColor}`}
                    style={{ height: `${Math.max(heightPct, day.count > 0 ? 10 : 4)}%` }}
                  />
                </div>
                <span className="text-xs text-zinc-500">{day.label}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-zinc-500">Week Total</p>
          <p className={`text-3xl font-bold mt-1 ${targetMet ? 'text-emerald-400' : 'text-amber-400'}`}>
            {stats.weekTotal}
          </p>
          <p className="text-xs text-zinc-500 mt-0.5">of {stats.target} target</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-zinc-500">New Schools</p>
          <p className="text-3xl font-bold mt-1 text-blue-400">{stats.newSchools}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-zinc-500">Samplings</p>
          <p className="text-3xl font-bold mt-1 text-indigo-400">{stats.samplingCount}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-zinc-500">Meetings</p>
          <p className="text-3xl font-bold mt-1 text-purple-400">{stats.meetingCount}</p>
        </div>
      </div>

      {/* Missing data */}
      {missingData.length > 0 && (
        <div>
          <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
            Incomplete Records
          </h2>
          <div className="space-y-2">
            {missingData.map((item, i) => (
              <div
                key={i}
                className="bg-amber-950 border border-amber-500 rounded-lg px-3 py-2.5 flex items-start gap-2"
              >
                <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-amber-400">{item.school}</p>
                  <p className="text-xs text-amber-400 mt-0.5 opacity-70">
                    {safeFormatDate(item.date, 'd MMM', item.date)} · Missing: {item.fields.join(', ')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action */}
      <button
        onClick={() => {
          window.location.href = `mailto:?subject=Weekly Report - ${executive.displayName}&body=Please find the weekly sales report attached.`
        }}
        className="w-full flex items-center justify-center gap-2 bg-blue-600 text-zinc-50 rounded-xl py-3.5 text-sm font-semibold transition-colors hover:bg-blue-500"
      >
        <Mail size={18} />
        Email Weekly Report
      </button>
    </div>
  )
}
