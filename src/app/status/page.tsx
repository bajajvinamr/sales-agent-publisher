'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { RefreshCw, CheckCircle, XCircle, Zap } from 'lucide-react'

interface IngestionRun {
  runDate: string
  messagesScraped: number
  messagesAfterFilter: number
  chunksCreated: number
  visitsExtracted: number
  alertsGenerated: number
  haikuTokensUsed: number
  sonnetTokensUsed: number
  status: string
  errorLog: string | null
  createdAt: string
}

export default function StatusPage() {
  const [run, setRun] = useState<IngestionRun | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/ingest/status')
      .then(r => r.json())
      .then(data => setRun(data.run ?? null))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <RefreshCw size={28} className="animate-spin text-amber-400" />
      </div>
    )
  }

  if (!run) {
    return (
      <div className="py-5">
        <h1 className="text-xl font-bold text-zinc-50">Ingestion Status</h1>
        <div className="mt-6 bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
          <p className="text-zinc-400">No ingestion runs yet.</p>
          <p className="text-sm mt-1 text-zinc-500">
            Connect WhatsApp or upload a chat file to start.
          </p>
        </div>
      </div>
    )
  }

  const haikuCost = (run.haikuTokensUsed * 0.00000125 * 85).toFixed(2)
  const sonnetCost = (run.sonnetTokensUsed * 0.000015 * 85).toFixed(2)
  const totalCost = (parseFloat(haikuCost) + parseFloat(sonnetCost)).toFixed(2)
  const isSuccess = run.status === 'success'

  return (
    <div className="py-5 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-zinc-50">Ingestion Status</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Pipeline health &amp; token usage</p>
      </div>

      {/* Last run card */}
      <div
        className={`bg-zinc-900 rounded-xl p-4 flex items-center justify-between border ${
          isSuccess ? 'border-emerald-500' : 'border-red-500'
        }`}
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Last Run</p>
          <p className="text-sm font-medium mt-0.5 text-zinc-50">
            {format(new Date(run.createdAt), 'd MMM yyyy, h:mm a')}
          </p>
          {run.errorLog && (
            <p className="text-xs mt-1 text-red-400">{run.errorLog}</p>
          )}
        </div>
        {isSuccess ? (
          <CheckCircle size={28} className="text-emerald-400" />
        ) : (
          <XCircle size={28} className="text-red-400" />
        )}
      </div>

      {/* Pipeline stats */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide mb-2 text-zinc-500">
          Pipeline Stats
        </p>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-800">
          <Row label="Messages Scraped" value={run.messagesScraped} />
          <Row label="After Noise Filter" value={run.messagesAfterFilter} />
          <Row label="Visit Chunks" value={run.chunksCreated} />
          <Row label="Visits Extracted" value={run.visitsExtracted} valueColor="text-emerald-400" />
          <Row
            label="Alerts Generated"
            value={run.alertsGenerated}
            valueColor={run.alertsGenerated > 0 ? 'text-amber-400' : undefined}
          />
        </div>
      </div>

      {/* Token usage & cost */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide mb-2 text-zinc-500">
          Token Usage &amp; Cost
        </p>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-amber-400" />
            <div className="flex-1 flex items-center justify-between">
              <span className="text-sm text-zinc-400">Haiku tokens</span>
              <span className="text-sm font-semibold text-zinc-50">
                {run.haikuTokensUsed.toLocaleString('en-IN')}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Zap size={14} className="text-blue-400" />
            <div className="flex-1 flex items-center justify-between">
              <span className="text-sm text-zinc-400">Sonnet tokens</span>
              <span className="text-sm font-semibold text-zinc-50">
                {run.sonnetTokensUsed.toLocaleString('en-IN')}
              </span>
            </div>
          </div>

          <div className="pt-3 flex items-center justify-between border-t border-zinc-800">
            <span className="text-sm font-medium text-zinc-400">Estimated cost</span>
            <span className="text-base font-bold text-amber-400 font-data">
              ₹{totalCost}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  valueColor,
}: {
  label: string
  value: number
  valueColor?: string
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-sm text-zinc-400">{label}</span>
      <span className={`text-sm font-semibold ${valueColor ?? 'text-zinc-50'}`}>
        {value.toLocaleString('en-IN')}
      </span>
    </div>
  )
}
