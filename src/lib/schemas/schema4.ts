// P10 Schema 4 — parses a PaperDraft (the flat plain-text draft handed to the
// integrity agent). Same defensive contract as schema1/schema2: validate
// field-by-field, collect every problem by name, throw HandoffIncompleteError
// if anything required is missing or malformed.
//
// Two deliberate non-trust rules:
//   1. We recompute materialGapCount from the section content via the regex — we
//      do NOT trust the agent's reported count (it might lie or drift). FR-13/FR-14
//      depend on the gap count being real.
//   2. We recompute wordCountTotal from the sections if the agent omits/garbles it.

import type { PaperDraft, DraftSection } from '@/lib/types'
import { extractJsonBlock } from './index'
import { HandoffIncompleteError } from './errors'

// ── small defensive guards (mirror schema1/schema2) ──

// True only for a plain object (not null, not an array).
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// True for a non-empty string after trimming whitespace.
function isNonEmptyString(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

// The [MATERIAL GAP ...] tag matcher. Global flag so .match() returns all hits;
// [^\]]* lets the tag carry an optional note like "[MATERIAL GAP: no data]".
// This is the SAME regex the editor decoration + buildPaperDraft use — keep them
// identical so the count the UI shows matches the count the gate reasons about.
const MATERIAL_GAP_REGEX = /\[MATERIAL GAP[^\]]*\]/g

// Count [MATERIAL GAP ...] tags in a piece of content (recomputed, never trusted).
function countMaterialGaps(content: string): number {
  const matches = content.match(MATERIAL_GAP_REGEX)
  return matches ? matches.length : 0
}

// Rough word count for the total fallback: split on whitespace, drop empties.
function wordsIn(content: string): number {
  const trimmed = content.trim()
  if (trimmed.length === 0) return 0
  return trimmed.split(/\s+/).length
}

// Parse + validate a PaperDraft. Throws HandoffIncompleteError on any problem.
export function parseSchema4(raw: string): PaperDraft {
  const data = extractJsonBlock(raw)
  const missing: string[] = []

  if (!isObject(data)) {
    throw new HandoffIncompleteError('schema4', ['(root is not a JSON object)'])
  }

  // schemaId — must be the literal 4 (coerced) so a mis-routed block is rejected.
  if (Number(data.schemaId) !== 4) missing.push('schemaId')

  // versionLabel — non-empty string.
  if (!isNonEmptyString(data.versionLabel)) missing.push('versionLabel')

  // sections — ordered array with at least 1 entry; each entry validated by index.
  const rawSections = data.sections
  if (!Array.isArray(rawSections) || rawSections.length < 1) {
    missing.push('sections')
  } else {
    rawSections.forEach((sec, i) => {
      const prefix = 'sections[' + i + ']'
      if (!isObject(sec)) {
        missing.push(prefix)
        return // can't inspect fields of a non-object
      }
      const s = sec as Record<string, unknown>
      if (!isNonEmptyString(s.sectionId)) missing.push(prefix + '.sectionId')
      if (!isNonEmptyString(s.heading)) missing.push(prefix + '.heading')
      if (Number.isNaN(Number(s.targetWords))) missing.push(prefix + '.targetWords')
      // content must be a string (may be empty — a section can be a stub).
      if (typeof s.content !== 'string') missing.push(prefix + '.content')
    })
  }

  if (missing.length > 0) {
    throw new HandoffIncompleteError('schema4', missing)
  }

  // Build clean, coerced sections. Past the guards, casts are safe. We RECOMPUTE
  // materialGapCount from content (never trust the agent's number).
  const sections: DraftSection[] = (data.sections as unknown[]).map((sec) => {
    const s = sec as Record<string, unknown>
    const content = String(s.content)
    return {
      sectionId: String(s.sectionId),
      heading: String(s.heading),
      targetWords: Number(s.targetWords),
      content,
      materialGapCount: countMaterialGaps(content),
    }
  })

  // wordCountTotal — use the agent's number if it is a clean number; otherwise
  // recompute by summing per-section word counts so the field is always present.
  const reported = Number(data.wordCountTotal)
  const wordCountTotal = Number.isNaN(reported)
    ? sections.reduce((sum, sec) => sum + wordsIn(sec.content), 0)
    : reported

  return {
    schemaId: 4,
    versionLabel: String(data.versionLabel),
    sections,
    wordCountTotal,
  }
}
