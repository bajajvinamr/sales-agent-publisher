'use client'
import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Download, FileText, RefreshCw, TrendingUp, Users, Target, CheckCircle2, XCircle, AlertTriangle, Info, ChevronRight } from 'lucide-react'
import Link from 'next/link'

interface Data {
  stats: { date:string; totalVisits:number; avgVisitsPerExec:number; targetsMet:number; targetsMissed:number; activeExecutives:number; execsReporting:number; dataCompletenessPct:number }
  alerts: { id:string; alertType:string; message:string; severity:'high'|'medium'|'low'; executive?:{displayName:string} }[]
  executiveProgress: { id:string; displayName:string; visitsToday:number; target:number; targetMet:boolean; gap:number }[]
  summary?: { summaryText?:string }
}

export default function Dashboard() {
  const [d, setD] = useState<Data|null>(null)
  const [loading, setLoading] = useState(true)
  const today = format(new Date(), 'yyyy-MM-dd')

  useEffect(() => { fetch('/api/dashboard').then(r=>r.json()).then(setD).finally(()=>setLoading(false)) }, [])

  if (loading) return <div className="flex items-center justify-center min-h-[70vh]"><RefreshCw size={22} className="animate-spin text-amber-400" /></div>
  if (!d) return null

  const { stats: s, alerts, executiveProgress: execs } = d
  const sorted = [...execs].sort((a,b) => b.visitsToday - a.visitsToday)
  const critical = alerts.filter(a => a.severity === 'high')
  const warnings = alerts.filter(a => a.severity !== 'high')

  return (
    <div className="pt-5 pb-4 space-y-4">

      {/* ── Header ──────────────────────────── */}
      <div className="anim">
        <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-amber-400">{format(new Date(s.date+'T12:00:00'),'EEEE')}</p>
        <h1 className="text-xl font-extrabold text-zinc-50 tracking-tight">{format(new Date(s.date+'T12:00:00'),'d MMMM yyyy')}</h1>
      </div>

      {/* ── Stat Grid ───────────────────────── */}
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Visits" val={s.totalVisits} accent="bg-blue-500" text="text-blue-400" cn="anim d1" />
        <Stat label="Reporting" val={`${s.execsReporting}/${s.activeExecutives}`} accent="bg-amber-500" text="text-amber-400" cn="anim d2" />
        <Stat label="On Target" val={`${s.targetsMet}/${s.activeExecutives}`} accent={s.targetsMet >= s.activeExecutives/2 ? 'bg-emerald-500' : 'bg-red-500'} text={s.targetsMet >= s.activeExecutives/2 ? 'text-emerald-400' : 'text-red-400'} cn="anim d3" />
      </div>

      {/* ── Completeness ────────────────────── */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-3 anim d3">
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Data Quality</span>
          <span className={`font-data text-xs font-bold ${s.dataCompletenessPct >= 90 ? 'text-emerald-400' : 'text-amber-400'}`}>{s.dataCompletenessPct}%</span>
        </div>
        <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-700 ease-out ${s.dataCompletenessPct >= 90 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{width:`${s.dataCompletenessPct}%`}} />
        </div>
      </div>

      {/* ── AI Summary ──────────────────────── */}
      {d.summary?.summaryText && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-3.5 anim d4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">AI Summary</p>
          <p className="text-[13px] text-zinc-300 leading-relaxed">{d.summary.summaryText}</p>
        </div>
      )}

      {/* ── Critical Alerts ─────────────────── */}
      {critical.length > 0 && (
        <div className="anim d4">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-red-400 mb-2">Needs Attention</p>
          <div className="space-y-1.5">{critical.map(a => <Alert key={a.id} a={a} />)}</div>
        </div>
      )}

      {/* ── Team Leaderboard ────────────────── */}
      <div className="anim d5">
        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-2">Team Performance</p>
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden divide-y divide-zinc-800/60">
          {sorted.map((e, i) => <Exec key={e.id} e={e} rank={i+1} />)}
        </div>
      </div>

      {/* ── Warnings ────────────────────────── */}
      {warnings.length > 0 && (
        <div className="anim d6">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-2">Warnings</p>
          <div className="space-y-1.5">{warnings.map(a => <Alert key={a.id} a={a} />)}</div>
        </div>
      )}

      {/* ── Actions ─────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 anim d7">
        <a href={`/api/reports/${today}/excel`} className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-500 transition-colors">
          <Download size={16} /> Excel
        </a>
        <Link href={`/report/${today}`} className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold bg-zinc-800 text-zinc-200 border border-zinc-700 hover:bg-zinc-700 transition-colors">
          <FileText size={16} /> Report
        </Link>
      </div>
    </div>
  )
}

function Stat({ label, val, accent, text, cn }: { label:string; val:string|number; accent:string; text:string; cn:string }) {
  return (
    <div className={`bg-zinc-900 rounded-xl border border-zinc-800 p-3 ${cn}`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <div className={`w-1.5 h-1.5 rounded-full ${accent}`} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
      </div>
      <p className={`font-data text-2xl font-bold ${text}`}>{val}</p>
    </div>
  )
}

function Alert({ a }: { a: Data['alerts'][0] }) {
  const c = { high: { bg:'bg-red-950', border:'border-red-900', icon:<XCircle size={14} className="text-red-400 shrink-0 mt-px" />, name:'text-red-400' }, medium: { bg:'bg-amber-950', border:'border-amber-900', icon:<AlertTriangle size={14} className="text-amber-400 shrink-0 mt-px" />, name:'text-amber-400' }, low: { bg:'bg-blue-950', border:'border-blue-900', icon:<Info size={14} className="text-blue-400 shrink-0 mt-px" />, name:'text-blue-400' } }[a.severity]
  return (
    <div className={`flex items-start gap-2 px-3 py-2.5 rounded-lg ${c.bg} border ${c.border}`}>
      {c.icon}
      <div className="min-w-0">
        {a.executive && <p className={`text-[10px] font-bold uppercase tracking-wide ${c.name}`}>{a.executive.displayName}</p>}
        <p className="text-xs text-zinc-300 leading-snug">{a.message}</p>
      </div>
    </div>
  )
}

function Exec({ e, rank }: { e: Data['executiveProgress'][0]; rank:number }) {
  const pct = e.target > 0 ? Math.min(100, Math.round((e.visitsToday/e.target)*100)) : 0
  const bar = pct >= 100 ? 'bg-emerald-500' : pct >= 75 ? 'bg-amber-500' : 'bg-red-500'
  const num = pct >= 100 ? 'text-emerald-400' : pct >= 75 ? 'text-amber-400' : 'text-red-400'
  return (
    <Link href={`/team/${e.id}`} className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-zinc-800/50 transition-colors">
      <span className={`font-data text-[11px] font-bold w-4 text-center ${rank<=3?'text-amber-400':'text-zinc-600'}`}>{rank}</span>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center mb-1">
          <span className="text-[13px] font-semibold text-zinc-100 truncate">{e.displayName}</span>
          <span className={`font-data text-[11px] font-bold ${num}`}>{e.visitsToday}/{e.target}</span>
        </div>
        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${bar} transition-all duration-500`} style={{width:`${pct}%`}} />
        </div>
      </div>
      {pct >= 100 ? <CheckCircle2 size={14} className="text-emerald-400 shrink-0" /> : <ChevronRight size={14} className="text-zinc-600 shrink-0" />}
    </Link>
  )
}
