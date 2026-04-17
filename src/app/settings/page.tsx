'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, Save, Check } from 'lucide-react'
import GoogleSheetSection from './GoogleSheetSection'

interface Settings {
  dailyVisitTarget: number
  alertEmail: string
  managerEmail: string
  whatsappGroupName: string
  sessionStartDate: string
  sessionEndDate: string
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({
    dailyVisitTarget: 8,
    alertEmail: '',
    managerEmail: '',
    whatsappGroupName: '',
    sessionStartDate: '',
    sessionEndDate: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/settings')
        if (!res.ok) throw new Error('Failed to load settings')
        const json = await res.json()
        setSettings((prev) => ({ ...prev, ...json }))
      } catch {
        // Use defaults if settings can't be loaded
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleSave = async () => {
    try {
      setSaving(true)
      setError(null)
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (!res.ok) throw new Error('Failed to save settings')
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  const update = (field: keyof Settings, value: string | number) => {
    setSettings((prev) => ({ ...prev, [field]: value }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <RefreshCw size={28} className="animate-spin text-amber-400" />
      </div>
    )
  }

  return (
    <div className="py-5 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-zinc-50">Settings</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Configure your sales tracking</p>
      </div>

      <div className="space-y-4">
        <Section title="Targets & Notifications">
          <Field label="Daily Visit Target">
            <input
              type="number"
              min={1}
              max={50}
              value={settings.dailyVisitTarget}
              onChange={(e) => update('dailyVisitTarget', parseInt(e.target.value) || 1)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-100 transition-colors outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 placeholder:text-zinc-500"
            />
          </Field>
          <Field label="Alert Email">
            <input
              type="email"
              placeholder="alerts@company.com"
              value={settings.alertEmail}
              onChange={(e) => update('alertEmail', e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-100 transition-colors outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 placeholder:text-zinc-500"
            />
          </Field>
          <Field label="Manager Email">
            <input
              type="email"
              placeholder="manager@company.com"
              value={settings.managerEmail}
              onChange={(e) => update('managerEmail', e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-100 transition-colors outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 placeholder:text-zinc-500"
            />
          </Field>
        </Section>

        <Section title="WhatsApp">
          <Field label="Group Name">
            <input
              type="text"
              placeholder="Sales Team - 2024"
              value={settings.whatsappGroupName}
              onChange={(e) => update('whatsappGroupName', e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-100 transition-colors outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 placeholder:text-zinc-500"
            />
          </Field>
        </Section>

        <GoogleSheetSection />

        <Section title="Session Period">
          <Field label="Start Date">
            <input
              type="date"
              value={settings.sessionStartDate}
              onChange={(e) => update('sessionStartDate', e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-100 transition-colors outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
              style={{ colorScheme: 'dark' }}
            />
          </Field>
          <Field label="End Date">
            <input
              type="date"
              value={settings.sessionEndDate}
              onChange={(e) => update('sessionEndDate', e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-100 transition-colors outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
              style={{ colorScheme: 'dark' }}
            />
          </Field>
        </Section>
      </div>

      {error && (
        <div className="rounded-lg px-3 py-2.5 text-sm bg-red-950 border border-red-500 text-red-400">
          {error}
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className={`w-full flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold transition-all disabled:opacity-60 ${
          saved
            ? 'bg-emerald-950 text-emerald-400 border border-emerald-500'
            : 'bg-amber-500 text-zinc-950 hover:bg-amber-400'
        }`}
      >
        {saving ? (
          <RefreshCw size={18} className="animate-spin" />
        ) : saved ? (
          <Check size={18} />
        ) : (
          <Save size={18} />
        )}
        {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Settings'}
      </button>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-zinc-800 bg-zinc-800">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</p>
      </div>
      <div className="p-4 space-y-4">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium block text-zinc-400">{label}</label>
      {children}
    </div>
  )
}
