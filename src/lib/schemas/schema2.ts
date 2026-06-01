// P9 Schema 2 — parses the literature_searcher / source_verification output into
// a Bibliography. Both agents emit the SAME shape; source_verification just flips
// each source's `verified` flag. We re-run this parser on both stages.
//
// Validation is per-source: if source #2 is missing its evidenceTier we report
// 'sources[2].evidenceTier' so the user can see exactly which entry is broken.
// Any failure throws HandoffIncompleteError('schema2', missing).

import type { BibSource, Bibliography, SearchStrategy, SourceType, QualityTier, Relevance } from '@/lib/types'
import { extractJsonBlock } from './index'
import { HandoffIncompleteError } from './errors'

// ── small defensive guards ──

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Coerce to a string array (each element stringified); non-arrays become [].
function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : []
}

// Required scalar fields on each source. Mapped to their expected kind so we can
// loop instead of repeating a typeof check per field.
// 'string'  -> typeof === 'string'
// 'number'  -> Number(value) is not NaN (coerced)
const SOURCE_STRING_FIELDS = ['id', 'title', 'authors', 'citation', 'type', 'qualityTier', 'relevance', 'annotation'] as const
const SOURCE_NUMBER_FIELDS = ['year', 'evidenceTier', 'relevanceScore'] as const

// Allowed values for the three enum fields. We validate membership (not just that
// they are strings) so a garbage value like type:'magazine' is reported as missing
// rather than blind-cast into the union and rendered as a blank label downstream.
const SOURCE_TYPES: SourceType[] = ['journal_article', 'book', 'chapter', 'conference', 'report', 'thesis', 'preprint', 'web']
const QUALITY_TIERS: QualityTier[] = ['tier_1', 'tier_2', 'tier_3', 'tier_4']
const RELEVANCES: Relevance[] = ['core', 'supporting', 'peripheral']

// Parse + validate a Bibliography. Throws HandoffIncompleteError on any problem.
export function parseSchema2(raw: string): Bibliography {
  const data = extractJsonBlock(raw)
  const missing: string[] = []

  if (!isObject(data)) {
    throw new HandoffIncompleteError('schema2', ['(root is not a JSON object)'])
  }

  // sources — array with at least 1 entry
  const rawSources = data.sources
  if (!Array.isArray(rawSources) || rawSources.length < 1) {
    missing.push('sources')
  } else {
    // Validate each source individually with an indexed name.
    rawSources.forEach((src, i) => {
      const prefix = 'sources[' + i + ']'
      if (!isObject(src)) {
        missing.push(prefix)
        return // can't inspect fields of a non-object
      }
      const s = src as Record<string, unknown>
      for (const field of SOURCE_STRING_FIELDS) {
        if (typeof s[field] !== 'string') missing.push(prefix + '.' + field)
      }
      for (const field of SOURCE_NUMBER_FIELDS) {
        if (Number.isNaN(Number(s[field]))) missing.push(prefix + '.' + field)
      }
      // Enum membership — only flag when the field IS a string (a non-string was
      // already reported above; don't double-report it as "out of range" too).
      if (typeof s.type === 'string' && !SOURCE_TYPES.includes(s.type as SourceType)) missing.push(prefix + '.type')
      if (typeof s.qualityTier === 'string' && !QUALITY_TIERS.includes(s.qualityTier as QualityTier)) missing.push(prefix + '.qualityTier')
      if (typeof s.relevance === 'string' && !RELEVANCES.includes(s.relevance as Relevance)) missing.push(prefix + '.relevance')
      // verified defaults to false and doi defaults to '' — not required, so no checks.
    })
  }

  // searchStrategy — must be an object (its inner arrays are coerced, not required)
  if (!isObject(data.searchStrategy)) missing.push('searchStrategy')

  // coverageAssessment — string
  if (typeof data.coverageAssessment !== 'string') missing.push('coverageAssessment')

  // minimumSources — numeric (coerced)
  if (Number.isNaN(Number(data.minimumSources))) missing.push('minimumSources')

  if (missing.length > 0) {
    throw new HandoffIncompleteError('schema2', missing)
  }

  // Build clean, coerced sources. Past the guards, casts are safe.
  const sources: BibSource[] = (data.sources as unknown[]).map((src) => {
    const s = src as Record<string, unknown>
    return {
      id: String(s.id),
      title: String(s.title),
      authors: String(s.authors),
      year: Number(s.year),
      doi: typeof s.doi === 'string' ? s.doi : '', // defaults to '' when absent
      citation: String(s.citation),
      type: String(s.type) as SourceType,
      evidenceTier: Number(s.evidenceTier),
      qualityTier: String(s.qualityTier) as QualityTier,
      relevance: String(s.relevance) as Relevance,
      relevanceScore: Number(s.relevanceScore),
      annotation: String(s.annotation),
      verified: s.verified === true, // defaults to false when absent or non-true
    }
  })

  const ss = data.searchStrategy as Record<string, unknown>
  const searchStrategy: SearchStrategy = {
    databases: toStringArray(ss.databases),
    keywords: toStringArray(ss.keywords),
    inclusionCriteria: toStringArray(ss.inclusionCriteria),
    exclusionCriteria: toStringArray(ss.exclusionCriteria),
    dateRange: typeof ss.dateRange === 'string' ? ss.dateRange : '',
  }

  return {
    sources,
    searchStrategy,
    coverageAssessment: String(data.coverageAssessment),
    minimumSources: Number(data.minimumSources),
  }
}
