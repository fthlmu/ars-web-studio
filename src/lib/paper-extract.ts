// Paper content extraction (FP-1 — channel separation).
//
// The full pipeline used to persist the model's *entire* reply verbatim as paper content,
// so preambles, metadata tables, self-scoring, manifests, citation markers, and refusals
// all leaked into the paper window. This module is the paper-artifact channel: it takes
// the raw streamed reply and returns ONLY clean paper prose, routing everything else to
// the conversation channel (notes) or a structured citation list.
//
// Pipeline per deliverable:
//   raw reply → extract delimited block (fallback: heading-anchored slice)
//             → sanitize (strip-agent-notes Sanitizer v2)
//             → validate (heading present? long enough? not a refusal?)
//
// Pure module: imports only the pure sanitizer, so it is unit-testable in isolation with
// `node --test`.

import { sanitizePaperContent, stripLeadingPreamble } from './strip-agent-notes'
// Type-only import (fully erased at runtime) so this module stays unit-testable with
// `node --test` without resolving the app's type graph. Re-exported for convenience.
import type { OutlineSection } from './types'
export type { OutlineSection }

/** A cleaned paper deliverable plus the chatter pulled out of it. */
export interface ExtractedPaper {
  /** Clean paper prose, safe to persist. */
  content: string
  /** Conversational chatter / commentary for the chat channel. */
  notes: string[]
  /** Citation slugs recovered from `<!--ref:slug-->` markers. */
  citations: string[]
  /** Whether the content passed the validation gate. */
  valid: boolean
  /** When `valid` is false, why (missing-heading | too-short | refusal-or-question | empty). */
  reason?: string
}

/** Extracted outline plus the derived section list. */
export interface ExtractedOutline {
  /** Clean, human-readable outline markdown (what the user reviews/edits). */
  outline: string
  /** The section list software derives the paper structure from. */
  sections: OutlineSection[]
  notes: string[]
  citations: string[]
  /** True when the architect's section JSON was missing/unusable and defaults were used. */
  usedFallback: boolean
}

export interface ValidationResult {
  ok: boolean
  reason?: string
}

// Fraction of the target word count a section must reach to be accepted.
const MIN_WORD_FRACTION = 0.4

// A reply that opens with one of these is a refusal/apology, not a paper section.
const REFUSAL_START =
  /^\s*(i\s+(can'?t|cannot|am\s+unable|won'?t|am\s+not\s+able)|i\s+apologi[sz]e|i'?m\s+sorry|as an ai\b|unfortunately,?\s+i)/i

// ─── Plain-text helpers ────────────────────────────────────────────────────────

/** Strip markdown/HTML to count real words. */
function plainText(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_`>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function countWords(s: string): number {
  const t = plainText(s)
  return t === '' ? 0 : t.split(' ').filter(Boolean).length
}

/** Normalize a heading to bare comparable text. */
function normalizeHeading(h: string): string {
  return h
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\d+[.)]\s*/, '')
    .replace(/\*+/g, '')
    .replace(/\s*\(.*?\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Does the content contain a heading matching (loosely) the target heading? */
function hasHeading(content: string, heading: string): boolean {
  const target = normalizeHeading(heading)
  if (target === '') return true
  for (const line of content.split('\n')) {
    if (!/^#{1,6}\s+\S/.test(line)) continue
    const h = normalizeHeading(line)
    if (h === target || h.includes(target) || target.includes(h)) return true
  }
  return false
}

// ─── Delimited-block extraction ────────────────────────────────────────────────
//
// The output contract asks the model to wrap the deliverable between explicit markers,
// e.g. `<<<PAPER_SECTION>>>` … `<<<END_PAPER_SECTION>>>`. Everything outside the markers
// is commentary. When the markers are missing (the model ignored the contract or the
// stream was truncated) we fall back to a heading-anchored slice.

interface DelimitedResult {
  /** Text inside the markers, or null if the opening marker was absent. */
  inside: string | null
  /** Text outside the markers (commentary), joined. */
  outside: string
}

function extractDelimited(raw: string, name: string): DelimitedResult {
  const open = `<<<${name}>>>`
  const close = `<<<END_${name}>>>`
  const openIdx = raw.indexOf(open)
  if (openIdx === -1) return { inside: null, outside: raw.trim() }

  const afterOpen = openIdx + open.length
  const closeIdx = raw.indexOf(close, afterOpen)
  if (closeIdx === -1) {
    // Opening marker but no close (truncated stream): take everything after the open.
    const before = raw.slice(0, openIdx).trim()
    return { inside: raw.slice(afterOpen).trim(), outside: before }
  }
  const before = raw.slice(0, openIdx).trim()
  const after = raw.slice(closeIdx + close.length).trim()
  const outside = [before, after].filter(Boolean).join('\n\n')
  return { inside: raw.slice(afterOpen, closeIdx).trim(), outside }
}

/** Heading-anchored fallback: slice from the first markdown heading to the end. */
function sliceFromFirstHeading(raw: string): string {
  const lines = raw.split('\n')
  const idx = lines.findIndex((l) => /^#{1,6}\s+\S/.test(l))
  return idx === -1 ? raw.trim() : lines.slice(idx).join('\n').trim()
}

// ─── Validation gate ───────────────────────────────────────────────────────────

/**
 * Validate that extracted text is actually a usable paper deliverable.
 *   - empty            → reject
 *   - requireHeading   → the target heading must be present
 *   - targetWords      → content must reach ≥40% of the target length
 *   - refusal/question → a heading-less apology or question-only reply is rejected
 */
export function validatePaperContent(
  content: string,
  opts: { heading?: string; targetWords?: number; requireHeading?: boolean } = {}
): ValidationResult {
  const text = content.trim()
  if (text === '') return { ok: false, reason: 'empty' }

  const headingPresent = opts.heading ? hasHeading(text, opts.heading) : /^#{1,6}\s+\S/m.test(text)

  if (opts.requireHeading && opts.heading && !headingPresent) {
    return { ok: false, reason: 'missing-heading' }
  }

  const words = countWords(text)

  // Heading-less short replies that look like a refusal or a clarifying question.
  if (!headingPresent) {
    const firstLine = text.split('\n').find((l) => l.trim() !== '')?.trim() ?? ''
    if (REFUSAL_START.test(firstLine)) return { ok: false, reason: 'refusal-or-question' }
    if (words < 40 && text.includes('?')) return { ok: false, reason: 'refusal-or-question' }
  }

  if (opts.targetWords && opts.targetWords > 0 && words < Math.floor(opts.targetWords * MIN_WORD_FRACTION)) {
    return { ok: false, reason: 'too-short' }
  }

  return { ok: true }
}

// ─── Section extraction ────────────────────────────────────────────────────────

/**
 * Extract one clean paper section from a raw draft-writer reply.
 * Marker path → fallback heading slice → sanitize → strip leading preamble → validate.
 */
export function extractSection(
  raw: string,
  opts: { heading: string; targetWords?: number }
): ExtractedPaper {
  const { inside, outside } = extractDelimited(raw, 'PAPER_SECTION')
  const body = inside !== null ? inside : sliceFromFirstHeading(raw)

  const sanitized = sanitizePaperContent(body)
  const { content: dePreambled, preamble } = stripLeadingPreamble(sanitized.content)

  const notes = [...sanitized.notes]
  if (preamble) notes.push(preamble)
  if (inside !== null && outside.trim()) notes.push(outside.trim())

  const validation = validatePaperContent(dePreambled, {
    heading: opts.heading,
    targetWords: opts.targetWords,
    requireHeading: true,
  })

  return {
    content: dePreambled,
    notes,
    citations: sanitized.citations,
    valid: validation.ok,
    reason: validation.reason,
  }
}

// ─── Abstract extraction ───────────────────────────────────────────────────────
//
// The abstract has no `##` heading, so heading rules don't apply — validation is lenient
// (non-empty, not a refusal). Quality-report tables emitted outside the markers become notes.
export function extractAbstract(raw: string): ExtractedPaper {
  const { inside, outside } = extractDelimited(raw, 'PAPER_ABSTRACT')
  const body = inside !== null ? inside : raw

  const sanitized = sanitizePaperContent(body)
  const notes = [...sanitized.notes]
  if (inside !== null && outside.trim()) notes.push(outside.trim())

  const validation = validatePaperContent(sanitized.content, { requireHeading: false })

  return {
    content: sanitized.content,
    notes,
    citations: sanitized.citations,
    valid: validation.ok,
    reason: validation.reason,
  }
}

// ─── Outline extraction (B4 fix) ───────────────────────────────────────────────

/** Minimal, self-contained extractor for the last fenced ```json object (no schema dep). */
function lastJsonObject(raw: string): unknown {
  const blocks = [...raw.matchAll(/```json\s*([\s\S]*?)```/gi)].map((m) => m[1])
  for (let i = blocks.length - 1; i >= 0; i--) {
    try {
      const v = JSON.parse(blocks[i].trim())
      if (v && typeof v === 'object' && !Array.isArray(v)) return v
    } catch {
      // try the next candidate block
    }
  }
  return null
}

/** Parse `{ "sections": [{ "heading", "targetWords" }] }` leniently. Returns [] if unusable. */
function parseOutlineSections(raw: string): OutlineSection[] {
  const obj = lastJsonObject(raw) as { sections?: unknown } | null
  if (!obj || !Array.isArray(obj.sections)) return []
  const out: OutlineSection[] = []
  for (const s of obj.sections) {
    if (!s || typeof s !== 'object') continue
    const rec = s as Record<string, unknown>
    const heading = typeof rec.heading === 'string' ? rec.heading.trim() : ''
    if (heading === '' || heading.length > 120) continue
    const tw = typeof rec.targetWords === 'number' && rec.targetWords > 0 ? Math.round(rec.targetWords) : 0
    out.push({ heading, targetWords: tw })
  }
  return out
}

/**
 * Extract the human-readable outline AND the derived section list.
 * The section list is taken from the architect's JSON block; if that is missing/unusable,
 * `fallbackHeadings` (the paper-type defaults) are used and `usedFallback` is set true so
 * the caller can SURFACE — not silently apply — the fallback.
 */
export function extractOutline(
  raw: string,
  opts: { wordCount: number; fallbackHeadings: string[] }
): ExtractedOutline {
  const { inside, outside } = extractDelimited(raw, 'PAPER_OUTLINE')
  // The outline body for the user. If markers are absent, slice from the first heading so
  // the trailing json block / commentary doesn't render as outline text.
  const body = inside !== null ? inside : sliceFromFirstHeading(raw)
  const sanitized = sanitizePaperContent(body)

  const notes = [...sanitized.notes]
  if (inside !== null && outside.trim()) notes.push(outside.trim())

  // Section list: prefer the architect's JSON (parsed from the WHOLE reply — the json block
  // lives outside the PAPER_OUTLINE markers).
  let sections = parseOutlineSections(raw)
  let usedFallback = false
  if (sections.length < 2) {
    usedFallback = true
    const per = Math.max(1, Math.round(opts.wordCount / Math.max(opts.fallbackHeadings.length, 1)))
    sections = opts.fallbackHeadings.map((heading) => ({ heading, targetWords: per }))
  }

  return { outline: sanitized.content, sections, notes, citations: sanitized.citations, usedFallback }
}

// ─── Word-count helper (re-exported for callers) ───────────────────────────────

/** Public word count over rendered prose (markdown/HTML stripped). */
export function paperWordCount(s: string): number {
  return countWords(s)
}
