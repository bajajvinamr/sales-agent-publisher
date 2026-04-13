import { createAnthropic } from '@ai-sdk/anthropic'
import { generateObject, generateText } from 'ai'
import { z } from 'zod'

import { config } from 'dotenv'
config()

const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
if (!apiKey) console.warn('[AI] ANTHROPIC_API_KEY not set — extraction will fail')

const anthropic = createAnthropic({ apiKey: apiKey || 'missing' })

// ── Model routing ────────────────────────────────────────────
// Haiku: structured extraction (95% of calls, $0.02/day)
// Sonnet: summaries, retries, reasoning (5% of calls, $0.07/day)

export const haiku = anthropic('claude-haiku-4-5-20251001')
export const sonnet = anthropic('claude-sonnet-4-20250514')

// ── Extraction schema (Haiku output) ─────────────────────────

export const extractedVisitSchema = z.object({
  isVisitReport: z.boolean().optional().default(true),
  schoolName: z.string().nullable(),
  address: z.string().nullable().optional().default(null),
  board: z.enum(['CBSE', 'ICSE', 'MPBSE', 'State Board']).nullable().optional().default(null),
  strength: z.number().nullable().optional().default(null),
  principalName: z.string().nullable().optional().default(null),
  principalMobile: z.string().nullable().optional().default(null),
  principalEmail: z.string().nullable().optional().default(null),
  principalDob: z.string().nullable().optional().default(null),
  bookSeller: z.string().nullable().optional().default(null),
  remark: z.enum(['New Visit', 'Follow up Visit', 'Sampling', 'Meeting with Principal', 'Order Received', 'Other']).nullable().optional().default(null),
  remarkDetail: z.string().nullable().optional().default(null),
})

export type ExtractedVisitOutput = z.infer<typeof extractedVisitSchema>

// ── Extraction prompt (Haiku) ────────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `You extract structured school visit data from Indian book publisher sales team WhatsApp messages.
Return ONLY the requested JSON schema. No explanation.

If the message is NOT a school visit report, set isVisitReport to false and all other fields to null.
If a field is not mentioned, return null. Do NOT guess or infer.

Example 1:
Input: "Carmel Convent School\\nKolar Road, Bhopal\\nBoard - CBSE\\nStrength - 1800\\nPrincipal - Sr. Mary Thomas\\nMob - 9425XXXXXX\\nBook seller - Gupta Book Store\\nSampling done, will send samples next week"
Output: isVisitReport=true, schoolName="Carmel Convent School", address="Kolar Road, Bhopal", board="CBSE", strength=1800, principalName="Sr. Mary Thomas", principalMobile="9425XXXXXX", bookSeller="Gupta Book Store", remark="Sampling", remarkDetail="Will send samples next week"

Example 2 (Hinglish):
Input: "Aaj DPS gaye the\\nPrincipal se mila, bahut positive tha\\nStrength 1200 hai\\nCBSE board\\nBook seller wahi Sharma Books hai\\nSampling ka time manga hai unhone"
Output: isVisitReport=true, schoolName="DPS", board="CBSE", strength=1200, bookSeller="Sharma Books", remark="Meeting with Principal", remarkDetail="Principal was positive, asked for sampling schedule"

Example 3 (not a visit):
Input: "Kal Sehore area cover karenge\\nSubah 9 baje nikalenge"
Output: isVisitReport=false, all other fields null`

export async function extractVisitData(
  senderName: string,
  date: string,
  chunkText: string
): Promise<{ data: ExtractedVisitOutput; model: 'haiku' | 'sonnet'; tokensUsed: number }> {
  const userPrompt = `Sales exec: ${senderName}\nDate: ${date}\nMessages:\n---\n${chunkText}\n---`

  try {
    // Try Haiku first (cheap, fast)
    const result = await generateObject({
      model: haiku,
      system: EXTRACTION_SYSTEM_PROMPT,
      prompt: userPrompt,
      schema: extractedVisitSchema,
      maxTokens: 200,
    })

    return {
      data: result.object,
      model: 'haiku',
      tokensUsed: (result.usage?.totalTokens ?? 0),
    }
  } catch (haikuError) {
    // Retry with Sonnet on failure
    console.warn(`Haiku extraction failed for ${senderName}/${date}, retrying with Sonnet:`, haikuError)

    const result = await generateObject({
      model: sonnet,
      system: EXTRACTION_SYSTEM_PROMPT,
      prompt: userPrompt,
      schema: extractedVisitSchema,
      maxTokens: 300,
    })

    return {
      data: result.object,
      model: 'sonnet',
      tokensUsed: (result.usage?.totalTokens ?? 0),
    }
  }
}

// ── Daily summary (Sonnet) ───────────────────────────────────

export async function generateDailySummary(stats: {
  date: string
  executivesReporting: number
  totalExecutives: number
  notReporting: string[]
  totalVisits: number
  targetsMet: number
  targetsMissed: number
  newSchools: number
  repeatVisits: number
  dataCompleteness: number
  keyIssues: string[]
}): Promise<{ text: string; tokensUsed: number }> {
  const result = await generateText({
    model: sonnet,
    system: `Write a brief daily summary for a book publisher sales team manager.
Keep it under 5 lines. Plain language. Include numbers.
This person reads it on their phone at night — be concise.
Write in English.`,
    prompt: `Date: ${stats.date}
Executives reporting: ${stats.executivesReporting}/${stats.totalExecutives}
Not reporting: ${stats.notReporting.join(', ') || 'None'}
Total visits: ${stats.totalVisits}
Targets met: ${stats.targetsMet}/${stats.executivesReporting}
New schools: ${stats.newSchools}
Repeat visits: ${stats.repeatVisits}
Data completeness: ${stats.dataCompleteness}%
Key issues: ${stats.keyIssues.join('; ') || 'None'}

Write the summary.`,
    maxTokens: 300,
  })

  return {
    text: result.text,
    tokensUsed: result.usage?.totalTokens ?? 0,
  }
}

// ── Weekly executive summary (Sonnet) ────────────────────────

export async function generateWeeklySummary(perf: {
  name: string
  weekStart: string
  weekEnd: string
  dailyVisits: number[]
  weeklyTarget: number
  totalVisits: number
  newSchools: number
  repeatVisits: number
  samplingCount: number
  meetingCount: number
  missingDataCount: number
}): Promise<{ text: string; tokensUsed: number }> {
  const result = await generateText({
    model: sonnet,
    system: `Write a weekly performance summary for a sales executive at a book publisher.
Tone: direct, supportive, specific. Like a good manager giving feedback.
Include: what went well, what needs attention, numbers.
Keep it under 8 lines. English.`,
    prompt: `Executive: ${perf.name}
Week: ${perf.weekStart} to ${perf.weekEnd}
Daily visits: ${perf.dailyVisits.join(', ')}
Weekly target: ${perf.weeklyTarget} | Achieved: ${perf.totalVisits}
New schools: ${perf.newSchools} | Repeats: ${perf.repeatVisits}
Sampling done: ${perf.samplingCount}
Meetings with principals: ${perf.meetingCount}
Missing data instances: ${perf.missingDataCount}

Write the weekly summary.`,
    maxTokens: 400,
  })

  return {
    text: result.text,
    tokensUsed: result.usage?.totalTokens ?? 0,
  }
}
