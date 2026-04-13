import Fuse from 'fuse.js'

// ── Types ────────────────────────────────────────────────────
export interface SchoolRecord {
  id: string
  canonicalName: string
  aliases: string[]
}

export interface MatchResult {
  matched: boolean
  schoolId?: string
  canonicalName?: string
  score: number        // 0–100 (100 = perfect)
  possibleMatch: boolean  // true if score is 60–79 (below threshold but close)
}

// ── 1. normalizeSchoolName ───────────────────────────────────
export function normalizeSchoolName(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')           // collapse whitespace
    .replace(/[.,;:!?]+$/, '')      // strip trailing punctuation
    .replace(/\b\w/g, (c) => c.toUpperCase())  // title case each word
}

// ── 2. findMatch (single query against a pre-built Fuse index) ─
export function findMatch(
  rawName: string,
  existingSchools: SchoolRecord[]
): MatchResult {
  const normalized = normalizeSchoolName(rawName)

  if (existingSchools.length === 0) {
    return { matched: false, score: 0, possibleMatch: false }
  }

  // Flatten schools into searchable entries (canonical + aliases)
  const entries: Array<{ id: string; canonicalName: string; searchName: string }> = []

  for (const school of existingSchools) {
    entries.push({
      id: school.id,
      canonicalName: school.canonicalName,
      searchName: normalizeSchoolName(school.canonicalName),
    })
    for (const alias of school.aliases) {
      entries.push({
        id: school.id,
        canonicalName: school.canonicalName,
        searchName: normalizeSchoolName(alias),
      })
    }
  }

  const fuse = new Fuse(entries, {
    keys: ['searchName'],
    threshold: 0.5,           // Fuse threshold: 0 = exact, 1 = all — 0.5 covers ~60+ score
    includeScore: true,
    minMatchCharLength: 3,
    ignoreLocation: true,
  })

  const results = fuse.search(normalized)

  if (results.length === 0) {
    return { matched: false, score: 0, possibleMatch: false }
  }

  const best = results[0]!
  // Fuse score: 0 = perfect, 1 = no match → invert to 0–100 scale
  const score = Math.round((1 - (best.score ?? 1)) * 100)

  if (score >= 80) {
    return {
      matched: true,
      schoolId: best.item.id,
      canonicalName: best.item.canonicalName,
      score,
      possibleMatch: false,
    }
  }

  if (score >= 60) {
    return {
      matched: false,
      schoolId: best.item.id,
      canonicalName: best.item.canonicalName,
      score,
      possibleMatch: true,
    }
  }

  return { matched: false, score, possibleMatch: false }
}

// ── 3. createSchoolMatcher (cached Fuse index) ───────────────
export function createSchoolMatcher(schools: SchoolRecord[]) {
  // Flatten all searchable entries once
  const entries: Array<{ id: string; canonicalName: string; searchName: string }> = []

  for (const school of schools) {
    entries.push({
      id: school.id,
      canonicalName: school.canonicalName,
      searchName: normalizeSchoolName(school.canonicalName),
    })
    for (const alias of school.aliases) {
      entries.push({
        id: school.id,
        canonicalName: school.canonicalName,
        searchName: normalizeSchoolName(alias),
      })
    }
  }

  const fuse = new Fuse(entries, {
    keys: ['searchName'],
    threshold: 0.5,
    includeScore: true,
    minMatchCharLength: 3,
    ignoreLocation: true,
  })

  return function match(rawName: string): MatchResult {
    const normalized = normalizeSchoolName(rawName)

    if (entries.length === 0) {
      return { matched: false, score: 0, possibleMatch: false }
    }

    const results = fuse.search(normalized)

    if (results.length === 0) {
      return { matched: false, score: 0, possibleMatch: false }
    }

    const best = results[0]!
    const score = Math.round((1 - (best.score ?? 1)) * 100)

    if (score >= 80) {
      return {
        matched: true,
        schoolId: best.item.id,
        canonicalName: best.item.canonicalName,
        score,
        possibleMatch: false,
      }
    }

    if (score >= 60) {
      return {
        matched: false,
        schoolId: best.item.id,
        canonicalName: best.item.canonicalName,
        score,
        possibleMatch: true,
      }
    }

    return { matched: false, score, possibleMatch: false }
  }
}
