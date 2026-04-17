'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, Save, Check, AlertTriangle, Copy } from 'lucide-react'

interface SheetSettings {
  googleSheetId: string
  googleSheetTab: string
  sheetSyncEnabled: boolean
  lastSheetSyncAt: string | null
  lastSheetSyncError: string | null
}

interface SheetSyncMeta {
  pendingRows: number
  serviceAccountEmail: string | null
  credentialsConfigured: boolean
}

export default function GoogleSheetSection() {
  const [form, setForm] = useState<SheetSettings>({
    googleSheetId: '',
    googleSheetTab: 'Visits',
    sheetSyncEnabled: false,
    lastSheetSyncAt: null,
    lastSheetSyncError: null,
  })
  const [meta, setMeta] = useState<SheetSyncMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [saved, setSaved] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const load = async () => {
    try {
      const res = await fetch('/api/settings')
      if (!res.ok) return
      const json = await res.json()
      if (json.settings) {
        setForm({
          googleSheetId: json.settings.googleSheetId ?? '',
          googleSheetTab: json.settings.googleSheetTab ?? 'Visits',
          sheetSyncEnabled: Boolean(json.settings.sheetSyncEnabled),
          lastSheetSyncAt: json.settings.lastSheetSyncAt ?? null,
          lastSheetSyncError: json.settings.lastSheetSyncError ?? null,
        })
      }
      if (json.sheetSync) setMeta(json.sheetSync)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          googleSheetId: form.googleSheetId,
          googleSheetTab: form.googleSheetTab,
          sheetSyncEnabled: form.sheetSyncEnabled,
        }),
      })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
        await load()
      }
    } finally {
      setSaving(false)
    }
  }

  const handleSyncNow = async () => {
    setSyncing(true)
    setSyncMessage(null)
    try {
      const res = await fetch('/api/sheet-sync/run', { method: 'POST' })
      const json = await res.json()
      if (!res.ok || json.error) {
        setSyncMessage(`Sync failed: ${json.error ?? 'unknown error'}`)
      } else if (json.skipped) {
        setSyncMessage(`Skipped (${json.skipped.replace(/_/g, ' ')})`)
      } else {
        setSyncMessage(`Appended ${json.appended} row${json.appended === 1 ? '' : 's'}`)
      }
      await load()
    } catch (e) {
      setSyncMessage(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  const copyEmail = () => {
    if (!meta?.serviceAccountEmail) return
    navigator.clipboard.writeText(meta.serviceAccountEmail)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) return null

  const credentialsMissing = !meta?.credentialsConfigured

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-zinc-800 bg-zinc-800 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Google Sheets Auto-Fill
        </p>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.sheetSyncEnabled}
            onChange={(e) =>
              setForm((p) => ({ ...p, sheetSyncEnabled: e.target.checked }))
            }
            className="accent-amber-500"
          />
          <span className="text-xs text-zinc-300">
            {form.sheetSyncEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </label>
      </div>

      <div className="p-4 space-y-4">
        {credentialsMissing && (
          <div className="rounded-lg px-3 py-2.5 text-xs bg-amber-950 border border-amber-500 text-amber-200 flex gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>
              <code className="font-mono">GOOGLE_SERVICE_ACCOUNT_JSON</code> is not
              set. Add it to your .env and restart the app.
            </span>
          </div>
        )}

        {meta?.serviceAccountEmail && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium block text-zinc-400">
              Share your sheet with this service account
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 font-mono truncate">
                {meta.serviceAccountEmail}
              </code>
              <button
                onClick={copyEmail}
                className="shrink-0 flex items-center gap-1 px-3 py-2 text-xs rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:border-amber-500"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-xs text-zinc-500">
              Open your sheet → Share → paste this email → give Editor access.
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-sm font-medium block text-zinc-400">
            Google Sheet URL or ID
          </label>
          <input
            type="text"
            placeholder="https://docs.google.com/spreadsheets/d/…"
            value={form.googleSheetId}
            onChange={(e) =>
              setForm((p) => ({ ...p, googleSheetId: e.target.value }))
            }
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium block text-zinc-400">Tab Name</label>
          <input
            type="text"
            placeholder="Visits"
            value={form.googleSheetTab}
            onChange={(e) =>
              setForm((p) => ({ ...p, googleSheetTab: e.target.value }))
            }
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
          />
          <p className="text-xs text-zinc-500">
            Auto-created if missing. Headers are written on first sync.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2">
            <p className="text-zinc-500">Pending rows</p>
            <p className="text-zinc-100 font-semibold text-lg">
              {meta?.pendingRows ?? '—'}
            </p>
          </div>
          <div className="rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2">
            <p className="text-zinc-500">Last sync</p>
            <p className="text-zinc-100 font-semibold text-sm">
              {form.lastSheetSyncAt
                ? new Date(form.lastSheetSyncAt).toLocaleString()
                : 'Never'}
            </p>
          </div>
        </div>

        {form.lastSheetSyncError && (
          <div className="rounded-lg px-3 py-2.5 text-xs bg-red-950 border border-red-500 text-red-300">
            Last error: {form.lastSheetSyncError}
          </div>
        )}

        {syncMessage && (
          <div className="rounded-lg px-3 py-2.5 text-xs bg-zinc-800 border border-zinc-700 text-zinc-300">
            {syncMessage}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-all disabled:opacity-60 ${
              saved
                ? 'bg-emerald-950 text-emerald-400 border border-emerald-500'
                : 'bg-amber-500 text-zinc-950 hover:bg-amber-400'
            }`}
          >
            {saving ? (
              <RefreshCw size={16} className="animate-spin" />
            ) : saved ? (
              <Check size={16} />
            ) : (
              <Save size={16} />
            )}
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
          </button>
          <button
            onClick={handleSyncNow}
            disabled={syncing || !form.sheetSyncEnabled || !form.googleSheetId}
            className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold bg-zinc-800 border border-zinc-700 text-zinc-100 hover:border-amber-500 disabled:opacity-50"
          >
            <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing…' : 'Sync Now'}
          </button>
        </div>
      </div>
    </div>
  )
}
