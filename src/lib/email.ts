import { Resend } from 'resend'

function getResend() {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  return new Resend(key)
}

function todayFormatted(): string {
  return new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export async function sendAlertEmail(
  to: string,
  alerts: { type: string; message: string; executive: string }[]
): Promise<void> {
  const subject = `Sales Tracker: ${alerts.length} alert${alerts.length !== 1 ? 's' : ''} for ${todayFormatted()}`

  const rows = alerts
    .map(
      (a) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;color:#f4f4f5;">${a.executive}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;color:#f4f4f5;">${a.type}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;color:#f4f4f5;">${a.message}</td>
        </tr>`
    )
    .join('')

  const html = `
    <div style="font-family:sans-serif;background:#09090b;padding:32px;max-width:700px;margin:0 auto;">
      <h2 style="color:#f59e0b;margin:0 0 8px;">Sales Tracker Alerts</h2>
      <p style="color:#a1a1aa;margin:0 0 24px;">${todayFormatted()} — ${alerts.length} alert${alerts.length !== 1 ? 's' : ''} require attention</p>
      <table style="width:100%;border-collapse:collapse;background:#18181b;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#27272a;">
            <th style="padding:10px 12px;text-align:left;color:#a1a1aa;font-size:12px;text-transform:uppercase;letter-spacing:.05em;">Executive</th>
            <th style="padding:10px 12px;text-align:left;color:#a1a1aa;font-size:12px;text-transform:uppercase;letter-spacing:.05em;">Type</th>
            <th style="padding:10px 12px;text-align:left;color:#a1a1aa;font-size:12px;text-transform:uppercase;letter-spacing:.05em;">Message</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`

  const resend = getResend()
  if (!resend) { console.log('[email] RESEND_API_KEY not set, skipping alert email'); return }
  await resend.emails.send({ from: 'Sales Tracker <alerts@yourdomain.com>', to, subject, html })
}

export async function sendWeeklyDigest(
  to: string,
  summary: { name: string; text: string }[]
): Promise<void> {
  const subject = 'Sales Tracker: Weekly Performance Report'

  const cards = summary
    .map(
      (s) => `
        <div style="background:#18181b;border:1px solid #27272a;border-radius:8px;padding:16px;margin-bottom:12px;">
          <h3 style="color:#f59e0b;margin:0 0 8px;">${s.name}</h3>
          <p style="color:#d4d4d8;margin:0;line-height:1.6;">${s.text}</p>
        </div>`
    )
    .join('')

  const html = `
    <div style="font-family:sans-serif;background:#09090b;padding:32px;max-width:700px;margin:0 auto;">
      <h2 style="color:#f59e0b;margin:0 0 8px;">Weekly Performance Report</h2>
      <p style="color:#a1a1aa;margin:0 0 24px;">Executive summary for the week ending ${todayFormatted()}</p>
      ${cards}
    </div>`

  const resend = getResend()
  if (!resend) { console.log('[email] RESEND_API_KEY not set, skipping email'); return }
  await resend.emails.send({ from: 'Sales Tracker <reports@yourdomain.com>', to, subject, html })
}

export async function sendDailySummaryEmail(
  to: string,
  summary: string,
  stats: { totalVisits: number; execsReporting: number; targetsMet: number }
): Promise<void> {
  const subject = `Sales Tracker: Daily Summary — ${todayFormatted()}`

  const html = `
    <div style="font-family:sans-serif;background:#09090b;padding:32px;max-width:700px;margin:0 auto;">
      <h2 style="color:#f59e0b;margin:0 0 8px;">Daily Summary</h2>
      <p style="color:#a1a1aa;margin:0 0 24px;">${todayFormatted()}</p>

      <div style="display:flex;gap:12px;margin-bottom:24px;">
        <div style="flex:1;background:#18181b;border:1px solid #27272a;border-radius:8px;padding:16px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:#f4f4f5;">${stats.totalVisits}</div>
          <div style="font-size:12px;color:#a1a1aa;margin-top:4px;">Total Visits</div>
        </div>
        <div style="flex:1;background:#18181b;border:1px solid #27272a;border-radius:8px;padding:16px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:#f4f4f5;">${stats.execsReporting}</div>
          <div style="font-size:12px;color:#a1a1aa;margin-top:4px;">Execs Reporting</div>
        </div>
        <div style="flex:1;background:#18181b;border:1px solid #27272a;border-radius:8px;padding:16px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:#22c55e;">${stats.targetsMet}</div>
          <div style="font-size:12px;color:#a1a1aa;margin-top:4px;">Targets Met</div>
        </div>
      </div>

      <div style="background:#18181b;border:1px solid #27272a;border-radius:8px;padding:16px;">
        <p style="color:#d4d4d8;margin:0;line-height:1.7;white-space:pre-wrap;">${summary}</p>
      </div>
    </div>`

  const resend = getResend()
  if (!resend) { console.log('[email] RESEND_API_KEY not set, skipping email'); return }
  await resend.emails.send({ from: 'Sales Tracker <reports@yourdomain.com>', to, subject, html })
}
