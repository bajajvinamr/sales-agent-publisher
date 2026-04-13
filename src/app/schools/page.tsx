'use client'

import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Search, RefreshCw, ChevronDown } from 'lucide-react'

interface SchoolVisit {
  id: string
  visitDate: string
  executive: { displayName: string }
  remark: string | null
}

interface School {
  id: string
  canonicalName: string
  board: string | null
  totalVisits: number
  lastVisitDate: string | null
  lastRemark: string | null
  visits: SchoolVisit[]
}

export default function SchoolsPage() {
  const [schools, setSchools] = useState<School[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        const res = await fetch('/api/schools')
        if (!res.ok) throw new Error('Failed to load schools')
        const json = await res.json()
        setSchools(json.schools ?? json)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const filtered = query.trim()
    ? schools.filter((s) =>
        s.canonicalName.toLowerCase().includes(query.toLowerCase())
      )
    : schools

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

  return (
    <div className="py-5 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-zinc-50">Schools</h1>
        <p className="text-sm text-zinc-500 mt-0.5">{schools.length} schools tracked</p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-3 text-zinc-500 pointer-events-none" />
        <input
          type="text"
          placeholder="Search schools…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-zinc-100 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 box-border"
        />
      </div>

      {filtered.length === 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
          <p className="text-zinc-500 text-sm">No schools match your search.</p>
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((school) => {
          const isExpanded = expandedId === school.id
          return (
            <div
              key={school.id}
              className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden"
            >
              <button
                onClick={() => setExpandedId(isExpanded ? null : school.id)}
                className="w-full text-left px-4 py-3 flex items-start justify-between gap-2 bg-transparent border-none cursor-pointer transition-colors hover:bg-zinc-800"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-zinc-50">
                    {school.canonicalName}
                  </p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                    {school.board && (
                      <span className="text-xs text-zinc-500">{school.board}</span>
                    )}
                    <span className="text-xs font-semibold text-amber-400 bg-amber-950 px-1.5 py-px rounded-full">
                      {school.totalVisits} visit{school.totalVisits !== 1 ? 's' : ''}
                    </span>
                    {school.lastVisitDate && (
                      <span className="text-xs text-zinc-500">
                        Last: {format(parseISO(school.lastVisitDate), 'd MMM')}
                      </span>
                    )}
                  </div>
                  {school.lastRemark && (
                    <p className="truncate text-xs text-zinc-400 mt-0.5">
                      {school.lastRemark}
                    </p>
                  )}
                </div>
                <ChevronDown
                  size={16}
                  className="text-zinc-500 shrink-0 mt-1 transition-transform duration-200"
                  style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                />
              </button>

              {/* Visit timeline */}
              {isExpanded && (
                <div className="border-t border-zinc-800 px-4 py-3 bg-zinc-800">
                  <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                    Visit History
                  </p>
                  {school.visits && school.visits.length > 0 ? (
                    <div className="space-y-2">
                      {school.visits.map((v) => (
                        <div key={v.id} className="flex items-start gap-3">
                          <div className="w-1.5 h-1.5 bg-blue-400 rounded-full mt-1.5 shrink-0" />
                          <div>
                            <p className="text-xs font-medium text-zinc-100">
                              {v.executive.displayName}
                            </p>
                            <p className="text-xs text-zinc-500">
                              {format(parseISO(v.visitDate), 'd MMM yyyy')}
                              {v.remark ? ` · ${v.remark}` : ''}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-500">No visit history available.</p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
