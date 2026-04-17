'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Smartphone, Upload, CheckCircle, AlertCircle, ArrowRight, RefreshCw, Wifi, Send, Power } from 'lucide-react'

type WaStatus = 'disconnected' | 'qr_ready' | 'connecting' | 'connected' | 'failed'
type UploadState = 'idle' | 'uploading' | 'processing' | 'done' | 'error'

export default function ConnectPage() {
  const [waStatus, setWaStatus] = useState<WaStatus>('disconnected')
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [waError, setWaError] = useState<string | null>(null)
  const [sendingReport, setSendingReport] = useState(false)
  const [reportSent, setReportSent] = useState(false)
  const [monitoredGroup, setMonitoredGroup] = useState<string | null>(null)
  const [capturedCount, setCapturedCount] = useState(0)
  const [groups, setGroups] = useState<{ name: string; id: string; participants: number }[]>([])
  const [loadingGroups, setLoadingGroups] = useState(false)
  const [groupsError, setGroupsError] = useState<string | null>(null)
  const [groupsLoaded, setGroupsLoaded] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [processResult, setProcessResult] = useState<{ visits: number; alerts: number } | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [uploadState, setUploadState] = useState<UploadState>('idle')
  const [uploadResult, setUploadResult] = useState<{ visits: number; alerts: number } | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [dropHover, setDropHover] = useState(false)

  // Poll WhatsApp status
  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/connect')
      const data = await res.json()
      setWaStatus(data.status)
      setQrDataUrl(data.qrDataUrl)
      if (data.error) setWaError(data.error)
      if (data.monitoredGroup) setMonitoredGroup(data.monitoredGroup)
      if (data.messagesCapturedToday !== undefined) setCapturedCount(data.messagesCapturedToday)
      if (data.status === 'connected' && pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    } catch {}
  }, [])

  useEffect(() => {
    pollStatus()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [pollStatus])

  const handleConnect = async () => {
    setWaStatus('connecting')
    setWaError(null)
    try {
      await fetch('/api/whatsapp/connect', { method: 'POST' })
      pollRef.current = setInterval(pollStatus, 2000)
    } catch (e) {
      setWaStatus('failed')
      setWaError(e instanceof Error ? e.message : 'Failed')
    }
  }

  const handleDisconnect = async () => {
    await fetch('/api/whatsapp/disconnect', { method: 'POST' })
    setWaStatus('disconnected')
    setQrDataUrl(null)
  }

  const handleLoadGroups = async () => {
    setLoadingGroups(true)
    setGroupsError(null)
    try {
      // Baileys may take a moment to sync groups after connect — retry once on empty.
      let data: { groups?: typeof groups; error?: string } = {}
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch('/api/whatsapp/monitor')
        data = await res.json()
        if (!res.ok) {
          throw new Error(data.error || `HTTP ${res.status}`)
        }
        if (data.groups && data.groups.length > 0) break
        if (attempt === 0) await new Promise((r) => setTimeout(r, 1500))
      }
      setGroups(data.groups || [])
      setGroupsLoaded(true)
    } catch (e) {
      setGroupsError(e instanceof Error ? e.message : 'Failed to load groups')
    } finally {
      setLoadingGroups(false)
    }
  }

  const handleMonitorGroup = async (groupName: string) => {
    const res = await fetch('/api/whatsapp/monitor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupName }),
    })
    const data = await res.json()
    if (data.success) { setMonitoredGroup(data.groupName); setGroups([]) }
    else { alert(data.error || 'Failed to monitor group') }
  }

  const handleProcessMessages = async () => {
    setProcessing(true)
    setProcessResult(null)
    try {
      const res = await fetch('/api/whatsapp/process', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const data = await res.json()
      if (data.success) { setProcessResult({ visits: data.visitsExtracted, alerts: data.alertsGenerated }) }
      else { alert(data.error || 'Processing failed') }
    } catch (e) { alert('Processing failed') }
    finally { setProcessing(false) }
  }

  const handleSendReport = async () => {
    const phone = prompt('Enter WhatsApp number with country code (e.g. 919876543210):')
    if (!phone) return
    setSendingReport(true)
    try {
      const res = await fetch('/api/whatsapp/send-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      })
      if (res.ok) { setReportSent(true); setTimeout(() => setReportSent(false), 5000) }
      else { const d = await res.json(); alert(d.error || 'Send failed') }
    } catch { alert('Send failed') }
    finally { setSendingReport(false) }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadState('uploading')
    setUploadError(null)
    setUploadResult(null)

    try {
      const text = await file.text()
      setUploadState('processing')

      const lines = text.split('\n')
      const messages = parseChatLines(lines)

      if (messages.length === 0) {
        throw new Error("No messages found in file. Make sure it's a WhatsApp chat export (.txt).")
      }

      const res = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Ingestion failed')
      }

      const result = await res.json()
      setUploadResult({
        visits: result.stats?.visitsExtracted ?? 0,
        alerts: result.stats?.alertsGenerated ?? 0,
      })
      setUploadState('done')
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
      setUploadState('error')
    }
  }

  return (
    <div className="py-5 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-50">Connect WhatsApp</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Link your sales team WhatsApp group</p>
      </div>

      {/* Option 1 (HERO): Upload Chat Export */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 flex items-center gap-2 border-b border-zinc-800 bg-zinc-800">
          <Upload size={15} className="text-blue-400" />
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Option 2: Upload Chat Export
          </p>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-sm text-zinc-400">
            Export chat from WhatsApp and upload the .txt file. Works offline — no live connection needed.
          </p>

          {/* How to export steps */}
          <div className="rounded-lg p-3 space-y-2 bg-blue-950 border border-blue-500">
            <p className="text-xs font-semibold text-blue-400">How to export chat:</p>
            <div className="text-xs space-y-1.5 text-blue-400">
              {[
                'Open the sales group in WhatsApp',
                'Tap ⋮ (menu) → More → Export Chat',
                'Choose "Without Media"',
                'Save the .txt file and upload below',
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="rounded-full w-4 h-4 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 bg-blue-900 text-blue-400">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Upload zone */}
          {uploadState === 'idle' || uploadState === 'error' ? (
            <label className="block cursor-pointer">
              <div
                className={`w-full border-2 border-dashed rounded-xl p-6 text-center transition-all ${
                  dropHover ? 'border-amber-500 bg-amber-950' : 'border-zinc-700 bg-transparent'
                }`}
                onMouseEnter={() => setDropHover(true)}
                onMouseLeave={() => setDropHover(false)}
              >
                <Upload size={24} className="mx-auto mb-2 text-zinc-500" />
                <p className="text-sm font-medium text-zinc-400">Drop .txt file here or tap to browse</p>
                <p className="text-xs mt-1 text-zinc-500">WhatsApp chat export (.txt)</p>
              </div>
              <input
                type="file"
                accept=".txt,.text"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          ) : uploadState === 'uploading' || uploadState === 'processing' ? (
            <div className="text-center py-6 space-y-3">
              <RefreshCw size={28} className="animate-spin mx-auto text-amber-400" />
              <p className="text-sm font-medium text-zinc-50">
                {uploadState === 'uploading' ? 'Reading file...' : 'Running pipeline (Haiku extracting visits)...'}
              </p>
              <p className="text-xs text-zinc-500">This may take 30–60 seconds for large files</p>
            </div>
          ) : uploadState === 'done' && uploadResult ? (
            <div className="rounded-xl p-4 text-center space-y-3 bg-emerald-950 border border-emerald-500">
              <CheckCircle size={32} className="mx-auto text-emerald-400" />
              <div>
                <p className="text-sm font-semibold text-emerald-400">Processing Complete!</p>
                <p className="text-xs mt-1 text-emerald-400">
                  {uploadResult.visits} visits extracted · {uploadResult.alerts} alerts generated
                </p>
              </div>
              <a
                href="/"
                className="inline-flex items-center gap-1 text-sm font-medium hover:underline text-emerald-400"
              >
                View Dashboard <ArrowRight size={14} />
              </a>
            </div>
          ) : null}

          {uploadError && (
            <div className="rounded-lg px-3 py-2.5 flex items-start gap-2 bg-red-950 border border-red-500">
              <AlertCircle size={16} className="shrink-0 mt-0.5 text-red-400" />
              <p className="text-sm text-red-400">{uploadError}</p>
            </div>
          )}
        </div>
      </div>

      {/* WhatsApp Connection (Baileys) — for sending reports */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 flex items-center gap-2 border-b border-zinc-800 bg-zinc-800">
          <Smartphone size={15} className="text-amber-400" />
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">WhatsApp Connection</p>
          {waStatus === 'connected' && <span className="ml-auto text-[9px] font-bold uppercase tracking-wider bg-emerald-500 text-zinc-950 px-2 py-0.5 rounded-full">Connected</span>}
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-zinc-500">Connect WhatsApp to send daily reports and alerts directly to the team.</p>

          {(waStatus === 'disconnected' || waStatus === 'failed') && (
            <>
              <button onClick={handleConnect} className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold bg-amber-500 text-zinc-950 hover:bg-amber-400 transition-colors">
                <Smartphone size={16} /> Connect WhatsApp
              </button>
              {waError && <p className="text-xs text-red-400 bg-red-950 border border-red-900 rounded-lg px-3 py-2">{waError}</p>}
            </>
          )}

          {waStatus === 'connecting' && (
            <div className="text-center py-4">
              <RefreshCw size={22} className="animate-spin mx-auto text-amber-400" />
              <p className="text-xs text-zinc-400 mt-2">Starting WhatsApp...</p>
            </div>
          )}

          {waStatus === 'qr_ready' && (
            <div className="text-center py-3 space-y-3">
              <div className="mx-auto w-56 h-56 rounded-xl overflow-hidden border-2 border-amber-500 bg-white flex items-center justify-center">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="Scan QR" className="w-full h-full object-contain" />
                ) : (
                  <RefreshCw size={20} className="animate-spin text-zinc-400" />
                )}
              </div>
              <p className="text-xs text-zinc-400">Scan with WhatsApp → Linked Devices → Link a Device</p>
              <div className="flex items-center justify-center gap-2 text-xs text-amber-400">
                <RefreshCw size={12} className="animate-spin" /> Waiting for scan...
              </div>
            </div>
          )}

          {waStatus === 'connected' && (
            <div className="space-y-3">
              <div className="rounded-lg p-3 bg-emerald-950 border border-emerald-800 flex items-center gap-2">
                <Wifi size={14} className="text-emerald-400" />
                <span className="text-sm font-medium text-emerald-400">WhatsApp Connected</span>
              </div>

              {/* Group monitoring */}
              {!monitoredGroup ? (
                <div className="space-y-2">
                  <p className="text-xs text-zinc-400">Select a group to monitor:</p>
                  <button onClick={handleLoadGroups} disabled={loadingGroups} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 transition-colors">
                    {loadingGroups ? <RefreshCw size={12} className="animate-spin" /> : null}
                    {loadingGroups ? 'Loading groups...' : 'Load My Groups'}
                  </button>
                  {groups.length > 0 && (
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {groups.map(g => (
                        <button key={g.id} onClick={() => handleMonitorGroup(g.name)} className="w-full text-left px-3 py-2 rounded-lg text-xs bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 transition-colors text-zinc-200">
                          {g.name} <span className="text-zinc-500">({g.participants} members)</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {groupsError && (
                    <p className="text-xs text-red-400 bg-red-950 border border-red-900 rounded-lg px-3 py-2">
                      {groupsError}
                    </p>
                  )}
                  {groupsLoaded && !groupsError && groups.length === 0 && (
                    <p className="text-xs text-zinc-400 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2">
                      No groups found yet — WhatsApp is still syncing. Wait ~10s and click again.
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="rounded-lg p-3 bg-zinc-800 border border-zinc-700">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">Monitoring Group</p>
                    <p className="text-sm font-semibold text-zinc-100">{monitoredGroup}</p>
                    <p className="text-xs text-amber-400 mt-1">{capturedCount} messages captured today</p>
                  </div>

                  {/* Process captured messages */}
                  <button
                    onClick={handleProcessMessages}
                    disabled={processing || capturedCount === 0}
                    className="w-full flex items-center justify-center gap-1.5 py-3 rounded-lg text-sm font-bold bg-amber-500 text-zinc-950 hover:bg-amber-400 disabled:opacity-50 transition-colors"
                  >
                    {processing ? <RefreshCw size={14} className="animate-spin" /> : null}
                    {processing ? 'Processing with AI...' : `Process ${capturedCount} Messages`}
                  </button>

                  {processResult && (
                    <div className="rounded-lg p-3 bg-emerald-950 border border-emerald-800 text-center">
                      <CheckCircle size={20} className="mx-auto text-emerald-400 mb-1" />
                      <p className="text-xs text-emerald-400">{processResult.visits} visits extracted · {processResult.alerts} alerts</p>
                      <a href="/" className="text-xs text-emerald-400 font-medium underline mt-1 inline-block">View Dashboard →</a>
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  onClick={handleSendReport}
                  disabled={sendingReport}
                  className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-semibold bg-zinc-800 text-amber-400 border border-zinc-700 hover:bg-zinc-700 transition-colors"
                >
                  {sendingReport ? <RefreshCw size={12} className="animate-spin" /> : <Send size={12} />}
                  {reportSent ? 'Sent!' : 'Send Report'}
                </button>
                <button onClick={handleDisconnect} className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700 transition-colors">
                  <Power size={12} /> Disconnect
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* How it works */}
      <div className="rounded-xl p-4 space-y-2 bg-zinc-800 border border-zinc-700">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">How It Works</p>
        <div className="text-xs text-zinc-400 space-y-1">
          <p>1. Export chat from WhatsApp sales group → upload .txt file</p>
          <p>2. AI pipeline extracts all visit data (school, board, principal, etc.)</p>
          <p>3. Dashboard updates with visits, alerts, summaries</p>
          <p>4. Connect WhatsApp above to auto-send daily reports to the team</p>
        </div>
      </div>
    </div>
  )
}

/** Parse WhatsApp .txt export into RawMessage format */
function parseChatLines(lines: string[]): Array<{
  date: string; time: string; sender: string; message: string; messageType: string
}> {
  const messageRegex = /^\[?(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)\]?\s*-?\s*(.+?):\s(.+)$/
  const messages: Array<{ date: string; time: string; sender: string; message: string; messageType: string }> = []
  let current: typeof messages[0] | null = null

  for (const line of lines) {
    const match = line.match(messageRegex)
    if (match) {
      if (current) messages.push(current)
      const [, dateStr, time, sender, text] = match

      let messageType = 'Text'
      if (text.includes('<Media omitted>')) messageType = 'MediaOmitted'
      else if (text.includes('message was deleted')) messageType = 'Deleted'
      else if (text.includes('maps.google') || text.includes('goo.gl/maps')) messageType = 'Location'

      const parts = dateStr.split('/')
      const day = parts[0].padStart(2, '0')
      const month = parts[1].padStart(2, '0')
      const year = parts[2].length === 2 ? '20' + parts[2] : parts[2]

      current = {
        date: `${year}-${month}-${day}`,
        time: time.trim().slice(0, 5),
        sender: sender.trim(),
        message: text.trim(),
        messageType,
      }
    } else if (current && line.trim()) {
      current.message += '\n' + line.trim()
    }
  }
  if (current) messages.push(current)

  return messages
}
