// P10 Schema 5 — parses the integrity_verification agent's output into an
// IntegrityReport. Same defensive contract as schema1/schema2: the agent ends
// its reply with one fenced ```json block, extractJsonBlock() pulls it out, and
// here we VALIDATE field-by-field, collecting every problem by name and throwing
// HandoffIncompleteError if anything is missing or malformed.
//
// The one EXTRA guarantee this parser makes (the iron rule depends on it): the
// returned report ALWAYS has exactly 7 mode rows, one per id M1..M7, in canonical
// order, with no dupes and none missing. The whole gate logic walks those 7 rows,
// so a 6-row or duplicated reply must abort rather than silently under-check.

import type {
  IntegrityReport,
  FailureModeResult,
  FailureModeId,
  ModeVerdict,
} from '@/lib/types'
import { FAILURE_MODES } from '@/lib/integrity'
import { extractJsonBlock } from './index'
import { HandoffIncompleteError } from './errors'

// ── small defensive guards (mirror schema1/schema2) ──

// True only for a plain object (not null, not an array).
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// The 7 canonical ids in order. We iterate THIS list (not the agent's array order)
// so the output is always M1..M7 regardless of how the agent ordered its reply.
const MODE_ORDER: FailureModeId[] = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7']

// The allowed per-mode verdicts.
const MODE_VERDICTS: ModeVerdict[] = ['CLEAR', 'SUSPECTED', 'INSUFFICIENT_EVIDENCE']

// The allowed top-level (advisory) verdicts and stages.
const REPORT_VERDICTS = ['PASS', 'PASS_WITH_CONDITIONS', 'FAIL'] as const
const STAGES = ['2.5', '4.5'] as const

// The issue-count fields that must all be present and numeric.
const ISSUE_KEYS = ['serious', 'medium', 'minor'] as const

// Validate a value as a JSON number in [0,1]. Returns NaN (treated as "missing" by
// the caller) for any non-number input OR a number outside the valid range, so a
// bogus citationIntegrityScore of 7 or -1 — and also a `null`/`""`/`[]`, which JS
// `Number()` would silently coerce to 0 — is reported rather than rendered as-is.
// The agent contract specifies a JSON number, so non-number types are NOT coerced.
function toUnitScore(v: unknown): number {
  if (typeof v !== 'number' || Number.isNaN(v) || v < 0 || v > 1) return NaN
  return v
}

// Look up the canonical name/question for a mode id (always found — MODE_ORDER
// is a subset of FAILURE_MODES). Used to fill fields the agent omitted.
function metaFor(id: FailureModeId): { modeName: string; detectionQuestion: string } {
  const meta = FAILURE_MODES.find((m) => m.modeId === id)
  // FAILURE_MODES covers all 7 ids, so this fallback is defensive only.
  return meta
    ? { modeName: meta.modeName, detectionQuestion: meta.detectionQuestion }
    : { modeName: id, detectionQuestion: '' }
}

// Parse + validate the integrity_verification output. Throws
// HandoffIncompleteError if any required field is missing or invalid.
export function parseSchema5(raw: string): IntegrityReport {
  const data = extractJsonBlock(raw)
  const missing: string[] = []

  if (!isObject(data)) {
    throw new HandoffIncompleteError('schema5', ['(root is not a JSON object)'])
  }

  // stage — must be one of the allowed literals.
  if (!STAGES.includes(data.stage as (typeof STAGES)[number])) {
    missing.push('stage')
  }

  // verdict — the advisory top-level verdict; must be one of the allowed literals.
  if (!REPORT_VERDICTS.includes(data.verdict as (typeof REPORT_VERDICTS)[number])) {
    missing.push('verdict')
  }

  // modes — must be a non-empty array; each entry validated below by id lookup.
  const rawModes = data.modes
  // Index the agent's modes by id so we can demand exactly one row per M1..M7.
  // A duplicate id (two M3 rows) is itself an error — we must not silently pick one.
  const byId = new Map<string, Record<string, unknown>>()
  if (!Array.isArray(rawModes)) {
    missing.push('modes')
  } else {
    rawModes.forEach((m, i) => {
      if (!isObject(m)) {
        missing.push('modes[' + i + ']')
        return
      }
      const id = m.modeId
      if (typeof id !== 'string' || !MODE_ORDER.includes(id as FailureModeId)) {
        // An unknown / non-canonical id — report it; it can't fill an M1..M7 slot.
        missing.push('modes[' + i + '].modeId')
        return
      }
      if (byId.has(id)) {
        // Duplicate row for the same mode — ambiguous, so abort.
        missing.push('modes.' + id + ' (duplicate)')
        return
      }
      byId.set(id, m)
    })
  }

  // Now demand exactly one valid row for EACH of the 7 ids, and validate it.
  // We build the coerced rows here so the "exactly 7, M1..M7" guarantee holds.
  const modeRows: FailureModeResult[] = []
  for (const id of MODE_ORDER) {
    const row = byId.get(id)
    if (!row) {
      // Missing entirely — the iron rule cannot tolerate an unchecked mode.
      missing.push('modes.' + id)
      continue
    }
    // verdict — required and must be in the ModeVerdict union.
    const verdict = row.verdict
    if (typeof verdict !== 'string' || !MODE_VERDICTS.includes(verdict as ModeVerdict)) {
      missing.push('modes.' + id + '.verdict')
      continue
    }
    // name / detectionQuestion / evidence are OPTIONAL on the wire — we fill
    // name + question from the canonical catalog when the agent omits them, and
    // default evidence to ''. So a terse-but-valid row still produces a full row.
    const meta = metaFor(id)
    const modeName =
      typeof row.modeName === 'string' && row.modeName.trim().length > 0
        ? String(row.modeName)
        : meta.modeName
    const detectionQuestion =
      typeof row.detectionQuestion === 'string' && row.detectionQuestion.trim().length > 0
        ? String(row.detectionQuestion)
        : meta.detectionQuestion
    const evidence = typeof row.evidence === 'string' ? String(row.evidence) : ''

    modeRows.push({
      modeId: id,
      modeName,
      verdict: verdict as ModeVerdict,
      detectionQuestion,
      evidence,
    })
  }

  // citationIntegrityScore / fabricationRiskScore — numeric in [0,1].
  const citationIntegrityScore = toUnitScore(data.citationIntegrityScore)
  if (Number.isNaN(citationIntegrityScore)) missing.push('citationIntegrityScore')
  const fabricationRiskScore = toUnitScore(data.fabricationRiskScore)
  if (Number.isNaN(fabricationRiskScore)) missing.push('fabricationRiskScore')

  // overallIssues — object with numeric serious/medium/minor (coerced).
  const issues = data.overallIssues
  if (!isObject(issues)) {
    missing.push('overallIssues')
  } else {
    for (const key of ISSUE_KEYS) {
      // Must be a genuine JSON number. A `null`/`""`/`[]` would coerce to 0 under
      // JS `Number()`, silently feeding `minor:0` to the iron rule and skipping the
      // PASS_WITH_CONDITIONS branch — so we type-check rather than coerce.
      const n = (issues as Record<string, unknown>)[key]
      if (typeof n !== 'number' || Number.isNaN(n)) {
        missing.push('overallIssues.' + key)
      }
    }
  }

  if (missing.length > 0) {
    throw new HandoffIncompleteError('schema5', missing)
  }

  // All checks passed. Past the guards, casts are safe. timestamp may be absent —
  // leave it '' for the caller (runIntegrityGate) to stamp with the current ISO time.
  // Past the guards above, every issue key is a validated JSON number — no coercion.
  const issuesObj = data.overallIssues as Record<string, number>
  const report: IntegrityReport = {
    stage: data.stage as '2.5' | '4.5',
    verdict: data.verdict as IntegrityReport['verdict'],
    modes: modeRows, // exactly 7, ordered M1..M7, no dupes (guaranteed above)
    citationIntegrityScore,
    fabricationRiskScore,
    overallIssues: {
      serious: issuesObj.serious,
      medium: issuesObj.medium,
      minor: issuesObj.minor,
    },
    timestamp: typeof data.timestamp === 'string' ? data.timestamp : '',
  }

  // overrideReason is set only by the override flow, never by the agent — but if a
  // valid non-empty string came through, preserve it rather than dropping data.
  if (typeof data.overrideReason === 'string' && data.overrideReason.trim().length > 0) {
    report.overrideReason = String(data.overrideReason)
  }

  return report
}
