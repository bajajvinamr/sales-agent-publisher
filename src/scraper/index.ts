#!/usr/bin/env tsx
// ═══════════════════════════════════════════════════════════════
// WhatsApp Scraper — standalone entry point
// Run:  tsx src/scraper/index.ts [options]
//
// Options:
//   --group  "Group Name"         WhatsApp group name (or set WA_GROUP_NAME env)
//   --date   "2026-04-13"         Date to scrape (default: today)
//   --file   "/path/to/export.txt" Parse a .txt chat export instead
//   --excel  "/path/to/chat.xlsx" Parse an Excel chat dump instead
//   --api    "http://localhost:3000" Base URL for the Next.js API (default: localhost:3000)
//   --dry-run                      Parse/scrape but do NOT POST to API
// ═══════════════════════════════════════════════════════════════

import { readFileSync } from 'fs'
import { format } from 'date-fns'
import { whatsappScraper } from './whatsapp-client.js'
import { parseChatExport } from './chat-parser.js'
import { parseExcelChat } from './excel-parser.js'
import type { RawMessage } from '../types/index.js'

// ── CLI arg parsing ───────────────────────────────────────────

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag)
  if (idx === -1) return undefined
  return process.argv[idx + 1]
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag)
}

const CLI = {
  group: getArg('--group') ?? process.env['WA_GROUP_NAME'] ?? '',
  date: getArg('--date') ?? format(new Date(), 'yyyy-MM-dd'),
  file: getArg('--file'),
  excel: getArg('--excel'),
  api: getArg('--api') ?? process.env['API_BASE_URL'] ?? 'http://localhost:3000',
  dryRun: hasFlag('--dry-run'),
}

// ── Main ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('╔═══════════════════════════════════════╗')
  console.log('║    WhatsApp Sales Agent — Scraper     ║')
  console.log('╚═══════════════════════════════════════╝')
  console.log(`Date   : ${CLI.date}`)
  console.log(`Group  : ${CLI.group || '(from env)'}`)
  console.log(`Mode   : ${CLI.file ? 'txt-file' : CLI.excel ? 'excel-file' : 'live-whatsapp'}`)
  console.log(`DryRun : ${CLI.dryRun}`)
  console.log()

  let messages: RawMessage[] = []

  // ── Source selection ─────────────────────────────────────────

  if (CLI.file) {
    // Text export mode
    console.log(`[Scraper] Parsing chat export: ${CLI.file}`)
    const text = readFileSync(CLI.file, 'utf-8')
    const all = parseChatExport(text)
    messages = all.filter((m) => m.date === CLI.date)
    console.log(`[Scraper] ${all.length} total messages parsed, ${messages.length} for ${CLI.date}`)
  } else if (CLI.excel) {
    // Excel mode
    console.log(`[Scraper] Parsing Excel file: ${CLI.excel}`)
    const all = await parseExcelChat(CLI.excel)
    messages = all.filter((m) => m.date === CLI.date)
    console.log(`[Scraper] ${all.length} total messages parsed, ${messages.length} for ${CLI.date}`)
  } else {
    // Live WhatsApp Web mode
    if (!CLI.group) {
      console.error(
        '[Scraper] ERROR: --group is required for live scraping (or set WA_GROUP_NAME env var)'
      )
      process.exit(1)
    }

    console.log('[Scraper] Initializing WhatsApp client…')
    await whatsappScraper.initialize()

    console.log('[Scraper] Waiting for WhatsApp connection (scan QR if prompted)…')
    await whatsappScraper.waitForReady(120_000)

    console.log(`[Scraper] Connected. Fetching messages from "${CLI.group}"…`)
    messages = await whatsappScraper.getGroupMessages(CLI.group, CLI.date)

    // Clean shutdown after scraping
    await whatsappScraper.destroy()
  }

  // ── Results ───────────────────────────────────────────────────

  console.log(`\n[Scraper] Scraped ${messages.length} messages for ${CLI.date}`)

  if (messages.length === 0) {
    console.log('[Scraper] No messages to ingest. Exiting.')
    process.exit(0)
  }

  // Preview first 5
  console.log('\n[Scraper] Preview (first 5 messages):')
  messages.slice(0, 5).forEach((m, i) => {
    console.log(`  ${i + 1}. [${m.time}] ${m.sender}: ${m.message.slice(0, 80).replace(/\n/g, ' ')}${m.message.length > 80 ? '…' : ''}  [${m.messageType}]`)
  })

  // ── POST to API ───────────────────────────────────────────────

  if (CLI.dryRun) {
    console.log('\n[Scraper] Dry-run mode — skipping POST to API.')
    process.exit(0)
  }

  const ingestUrl = `${CLI.api}/api/ingest`
  console.log(`\n[Scraper] POSTing ${messages.length} messages to ${ingestUrl}…`)

  try {
    const res = await fetch(ingestUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, date: CLI.date }),
    })

    const body = await res.json().catch(() => null)

    if (!res.ok) {
      console.error(`[Scraper] API error ${res.status}:`, body)
      process.exit(1)
    }

    console.log('[Scraper] Ingest successful:')
    console.log(JSON.stringify(body, null, 2))
  } catch (err: unknown) {
    console.error(
      '[Scraper] Failed to reach API:',
      err instanceof Error ? err.message : String(err)
    )
    process.exit(1)
  }
}

// ── Entry ─────────────────────────────────────────────────────

main().catch((err: unknown) => {
  console.error('[Scraper] Fatal error:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
