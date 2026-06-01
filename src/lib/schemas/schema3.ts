// P9 Schema 3 — parses the synthesis_agent output into a SynthesisReport.
//
// Required: at least one theme (each with name/description/strength); a
// researchGaps string[]; keyDebates (may be EMPTY) each with positionA/positionB/
// evidenceBalance; consensusAreas string[]. Source-ID arrays inside themes and
// debates are coerced (default []) rather than required. Any problem throws
// HandoffIncompleteError('schema3', missing).

import type { SynthesisReport, SynthesisTheme, SynthesisDebate, ThemeStrength } from '@/lib/types'
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

// The allowed theme-strength literals.
const STRENGTHS: ThemeStrength[] = ['strong', 'moderate', 'emerging']

// Parse + validate a SynthesisReport. Throws HandoffIncompleteError on any gap.
export function parseSchema3(raw: string): SynthesisReport {
  const data = extractJsonBlock(raw)
  const missing: string[] = []

  if (!isObject(data)) {
    throw new HandoffIncompleteError('schema3', ['(root is not a JSON object)'])
  }

  // themes — array with at least 1 entry; validate each by index
  const rawThemes = data.themes
  if (!Array.isArray(rawThemes) || rawThemes.length < 1) {
    missing.push('themes')
  } else {
    rawThemes.forEach((theme, i) => {
      const prefix = 'themes[' + i + ']'
      if (!isObject(theme)) {
        missing.push(prefix)
        return
      }
      const t = theme as Record<string, unknown>
      if (typeof t.name !== 'string') missing.push(prefix + '.name')
      if (typeof t.description !== 'string') missing.push(prefix + '.description')
      if (!STRENGTHS.includes(t.strength as ThemeStrength)) missing.push(prefix + '.strength')
      // supportingSources / contradictingSources default to [] — not required.
    })
  }

  // researchGaps — string array (may be empty)
  if (!Array.isArray(data.researchGaps)) missing.push('researchGaps')

  // keyDebates — array (MAY be empty); validate each entry by index
  const rawDebates = data.keyDebates
  if (!Array.isArray(rawDebates)) {
    missing.push('keyDebates')
  } else {
    rawDebates.forEach((debate, i) => {
      const prefix = 'keyDebates[' + i + ']'
      if (!isObject(debate)) {
        missing.push(prefix)
        return
      }
      const d = debate as Record<string, unknown>
      if (typeof d.positionA !== 'string') missing.push(prefix + '.positionA')
      if (typeof d.positionB !== 'string') missing.push(prefix + '.positionB')
      if (typeof d.evidenceBalance !== 'string') missing.push(prefix + '.evidenceBalance')
      // sourcesA / sourcesB default to [] — not required.
    })
  }

  // consensusAreas — string array (may be empty)
  if (!Array.isArray(data.consensusAreas)) missing.push('consensusAreas')

  if (missing.length > 0) {
    throw new HandoffIncompleteError('schema3', missing)
  }

  // Build clean, coerced themes and debates. Past the guards, casts are safe.
  const themes: SynthesisTheme[] = (data.themes as unknown[]).map((theme) => {
    const t = theme as Record<string, unknown>
    return {
      name: String(t.name),
      description: String(t.description),
      supportingSources: toStringArray(t.supportingSources),
      contradictingSources: toStringArray(t.contradictingSources),
      strength: t.strength as ThemeStrength,
    }
  })

  const keyDebates: SynthesisDebate[] = (data.keyDebates as unknown[]).map((debate) => {
    const d = debate as Record<string, unknown>
    return {
      positionA: String(d.positionA),
      positionB: String(d.positionB),
      sourcesA: toStringArray(d.sourcesA),
      sourcesB: toStringArray(d.sourcesB),
      evidenceBalance: String(d.evidenceBalance),
    }
  })

  const report: SynthesisReport = {
    themes,
    researchGaps: toStringArray(data.researchGaps),
    keyDebates,
    consensusAreas: toStringArray(data.consensusAreas),
  }

  // Both of these are optional enrichment — include only when present as string[].
  if (Array.isArray(data.methodologyRecommendations)) {
    report.methodologyRecommendations = toStringArray(data.methodologyRecommendations)
  }
  if (Array.isArray(data.theoreticalImplications)) {
    report.theoreticalImplications = toStringArray(data.theoreticalImplications)
  }

  return report
}
