'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { format, addDays, subDays, parseISO } from 'date-fns'
import { ChevronLeft, ChevronRight, Download, RefreshCw, ChevronDown } from 'lucide-react'

interface Executive {
  id: string
  displayName: string
}

interface Visit {
  id: string
  visitDate: string
  executive: Executive
  school: { canonicalName: string } | null
  schoolNameRaw: string
  address: string | null
  board: string | null
  strength: number | null
  principalName: string | null
  principalMobile: string | null
  principalEmail: string | null
  bookSeller: string | null
  remark: string | null
  remarkDetail: string | null
  locationUrl: string | null
  dataComplete: boolean
  missingFields: string[]
}

export default function ReportPage() {
  const params = useParams()
  const router = useRouter()
  const dateParam = typeof params.date === 'string' ? params.date : ''

  const [visits, setVisits] = useState<Visit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterExec, setFilterExec] = useState('All')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const currentDate = dateParam || format(new Date(), 'yyyy-MM-dd')

  useEffect(() => {
    if (!currentDate) return
    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        const res = await fetch(`/api/reports/${currentDate}`)
        if (!res.ok) throw new Error('Failed to load report')
        const json = await res.json()
        setVisits(json.visits ?? [])
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [currentDate])

  const execs = ['All', ...Array.from(new Set(visits.map((v) => v.executive.displayName)))]
  const filtered = filterExec === 'All' ? visits : visits.filter((v) => v.executive.displayName === filterExec)

  const navigate = (dir: 'prev' | 'next') => {
    const d = parseISO(currentDate)
    const next = dir === 'prev' ? subDays(d, 1) : addDays(d, 1)
    router.push(`/report/${format(next, 'yyyy-MM-dd')}`)
  }

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.value) router.push(`/report/${e.target.value}`)
  }

  const missing = (field: string | null | undefined) => !field || field.trim() === ''

  return (
    <div className="py-5 space-y-4">
      {/* Header controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate('prev')}
          className="bg-zinc-800 border border-zinc-700 rounded-lg p-2 text-zinc-400 cursor-pointer transition-colors hover:bg-zinc-700"
          aria-label="Previous day"
        >
          <ChevronLeft size={18} />
        </button>
        <input
          type="date"
          value={currentDate}
          onChange={handleDateChange}
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
          style={{ colorScheme: 'dark' }}
        />
        <button
          onClick={() => navigate('next')}
          className="bg-zinc-800 border border-zinc-700 rounded-lg p-2 text-zinc-400 cursor-pointer transition-colors hover:bg-zinc-700"
          aria-label="Next day"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Filter + download row */}
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <select
            value={filterExec}
            onChange={(e) => setFilterExec(e.target.value)}
            className="w-full appearance-none bg-zinc-800 border border-zinc-700 rounded-lg py-2 pl-3 pr-8 text-sm text-zinc-100 outline-none cursor-pointer focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
          >
            {execs.map((e) => (
              <option key={e} value={e} className="bg-zinc-900">
                {e}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="absolute right-2.5 top-3 text-zinc-500 pointer-events-none"
          />
        </div>
        <a
          href={`/api/reports/${currentDate}/excel`}
          className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 text-zinc-50 rounded-lg text-sm font-medium no-underline whitespace-nowrap shrink-0 hover:bg-emerald-500 transition-colors"
        >
          <Download size={16} />
          Excel
        </a>
      </div>

      {/* State: loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <RefreshCw size={28} className="animate-spin text-amber-400" />
        </div>
      )}

      {/* State: error */}
      {!loading && error && (
        <div className="bg-red-950 border border-red-500 rounded-xl p-4 text-center">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* State: empty */}
      {!loading && !error && filtered.length === 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
          <p className="text-zinc-500 text-sm">No visits recorded for this date.</p>
        </div>
      )}

      {/* Visit rows */}
      {!loading && !error && filtered.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-zinc-500">
            {filtered.length} visit{filtered.length !== 1 ? 's' : ''}
          </p>
          {filtered.map((visit) => {
            const school = visit.school?.canonicalName ?? visit.schoolNameRaw
            const isExpanded = expandedId === visit.id
            return (
              <div
                key={visit.id}
                className={`bg-zinc-900 rounded-xl overflow-hidden border ${visit.dataComplete ? 'border-zinc-800' : 'border-amber-500'}`}
              >
                {/* Row summary */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : visit.id)}
                  className="w-full text-left px-4 py-3 flex items-start justify-between gap-2 bg-transparent border-none cursor-pointer transition-colors hover:bg-zinc-800"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-blue-400 bg-blue-950 px-2 py-0.5 rounded-full">
                        {visit.executive.displayName}
                      </span>
                      {!visit.dataComplete && (
                        <span className="text-xs font-medium text-amber-400 bg-amber-950 px-2 py-0.5 rounded-full">
                          Incomplete
                        </span>
                      )}
                    </div>
                    <p className="truncate text-sm font-semibold text-zinc-50 mt-1">
                      {school}
                    </p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                      {visit.board && (
                        <span className="text-xs text-zinc-500">{visit.board}</span>
                      )}
                      {visit.strength && (
                        <span className="text-xs text-zinc-500">{visit.strength} students</span>
                      )}
                      {visit.remark && (
                        <span className="text-xs text-zinc-400 font-medium">{visit.remark}</span>
                      )}
                    </div>
                  </div>
                  <ChevronDown
                    size={16}
                    className="text-zinc-500 shrink-0 mt-1 transition-transform duration-200"
                    style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-zinc-800 px-4 py-3 bg-zinc-800 flex flex-col gap-1.5">
                    <DetailRow label="Principal" value={visit.principalName} warn={missing(visit.principalName)} />
                    <DetailRow label="Phone" value={visit.principalMobile} warn={missing(visit.principalMobile)} />
                    <DetailRow label="Email" value={visit.principalEmail} warn={missing(visit.principalEmail)} />
                    <DetailRow label="Address" value={visit.address} warn={missing(visit.address)} />
                    <DetailRow label="Book Seller" value={visit.bookSeller} />
                    <DetailRow label="Remark Detail" value={visit.remarkDetail} />
                    {visit.locationUrl && (
                      <div className="flex items-start gap-2">
                        <span className="text-xs text-zinc-500 w-24 shrink-0">Location</span>
                        <a
                          href={visit.locationUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-400 underline break-all"
                        >
                          Open Map
                        </a>
                      </div>
                    )}
                    {visit.missingFields.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-amber-500">
                        <span className="text-xs font-medium text-amber-400">
                          Missing: {visit.missingFields.join(', ')}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function DetailRow({
  label,
  value,
  warn,
}: {
  label: string
  value: string | null | undefined
  warn?: boolean
}) {
  return (
    <div className="flex items-start gap-2 rounded px-1 py-0.5">
      <span className="text-xs text-zinc-500 w-24 shrink-0">{label}</span>
      <span className={`text-xs ${warn ? 'text-amber-400 font-medium italic' : 'text-zinc-400'}`}>
        {value || '—'}
      </span>
    </div>
  )
}
