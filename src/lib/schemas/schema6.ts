// P11 Schema 6 — parses the Phase-2 (PAPER-VISIBLE) Review Report into a
// ReviewerScoreSet. Same defensive contract as schema5: the reviewers end their
// reply with one fenced ```json block, extractJsonBlock() pulls it out, and here
// we VALIDATE field-by-field, collecting every problem by name and throwing
// HandoffIncompleteError('schema6', missing) if anything is missing or malformed.
//
// The one EXTRA guarantee this parser makes (the review logic depends on it): the
// returned report ALWAYS has exactly 5 reviewer rows, one per role EIC/R1/R2/R3/DA,
// with no dupes and none missing — exactly how schema5 guarantees 7 mode rows.
// deriveReviewDecision() averages those 5 overall scores, so a 4-row or duplicated
// reply must abort rather than silently under-count.

import type {
  ReviewerScoreSet,
  ReviewerReport,
  ReviewerRole,
  ReviewerDimensionScores,
  EditorialDecision,
  ReviewConsensus,
  RoadmapItem,
  RRMatrixRow,
  RRResolutionStatus,
  ScoreTrajectoryEntry,
} from '@/lib/types'
import { extractJsonBlock } from './index'
import { HandoffIncompleteError } from './errors'

// ── P14 re-review options ────────────────────────────────────────────────────
// The Stage-3' re-review is a NARROW 3-agent panel (EIC + R1 + R2; DA only if a
// DA-CRITICAL fired at Stage 3), so it cannot satisfy the standard "exactly 5
// reviewers" guarantee. `mode: 'reReview'` relaxes the role requirement to the
// narrow team and additionally parses the R&R Traceability Matrix, the residual
// issues, and any agent-supplied score trajectory (runReReview recomputes the
// trajectory in software, so the parsed one is only a fallback).
export interface ParseSchema6Options {
  mode?: 'standard' | 'reReview'
}

// The 3 roles a Stage-3' narrow re-review MUST include. R3 + DA are optional there.
const RE_REVIEW_REQUIRED_ROLES: ReviewerRole[] = ['EIC', 'R1', 'R2']

// The three R&R resolution-status literals.
const RR_STATUSES: RRResolutionStatus[] = ['Resolved', 'Partially Resolved', 'Unresolved']

// ── small defensive guards (mirror schema5) ──

// True only for a plain object (not null, not an array).
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Coerce to a string array (each element stringified); non-arrays become [].
function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : []
}

// The 5 canonical roles in order. We iterate THIS list (not the agent's array
// order) so the output is always EIC,R1,R2,R3,DA regardless of reply ordering.
const ROLE_ORDER: ReviewerRole[] = ['EIC', 'R1', 'R2', 'R3', 'DA']

// The 5 rubric dimension keys every reviewer must score (each 0-100).
const DIMENSION_KEYS: (keyof ReviewerDimensionScores)[] = [
  'novelty',
  'methodology',
  'clarity',
  'contribution',
  'citation',
]

// The four editorial-decision literals (used for both the per-reviewer
// recommendation and the top-level editorialDecision).
const EDITORIAL_DECISIONS: EditorialDecision[] = [
  'Accept',
  'Minor Revision',
  'Major Revision',
  'Reject',
]

// The four consensus literals.
const CONSENSUS_VALUES: ReviewConsensus[] = ['CONSENSUS-4', 'CONSENSUS-3', 'SPLIT', 'DA-CRITICAL']

// The three roadmap priority literals (for the lenient roadmap mapping below).
const ROADMAP_PRIORITIES = ['must_fix', 'should_fix', 'consider'] as const

// Validate a value as a JSON number in [0,100]. Returns NaN (treated as "missing"
// by the caller) for any non-number input OR a number outside the valid range, so
// a bogus overallScore of 150 or -1 — and also a `null`/`""`/`[]`, which JS
// `Number()` would silently coerce to 0 — is reported rather than rendered as-is.
// The agent contract specifies a JSON number, so non-number types are NOT coerced.
// (This is schema5's toUnitScore, retargeted from [0,1] to the [0,100] review scale.)
function toScore100(v: unknown): number {
  if (typeof v !== 'number' || Number.isNaN(v) || v < 0 || v > 100) return NaN
  return v
}

// Leniently map ONE raw item to a RoadmapItem. The roadmap is ADVISORY in P11
// (the full Schema-7 parser is P13), so a malformed item is SKIPPED with a warn —
// we never throw on roadmap problems. Returns null when the item can't be mapped.
function toRoadmapItem(raw: unknown, index: number): RoadmapItem | null {
  if (!isObject(raw)) {
    console.warn('parseSchema6: revisionRoadmap[' + index + '] is not an object — skipping')
    return null
  }
  const r = raw as Record<string, unknown>
  // id + description + priority are the minimum needed to include an item.
  if (typeof r.id !== 'string' || r.id.trim().length === 0) {
    console.warn('parseSchema6: revisionRoadmap[' + index + '] missing id — skipping')
    return null
  }
  if (typeof r.description !== 'string' || r.description.trim().length === 0) {
    console.warn('parseSchema6: revisionRoadmap[' + index + '] missing description — skipping')
    return null
  }
  if (!ROADMAP_PRIORITIES.includes(r.priority as (typeof ROADMAP_PRIORITIES)[number])) {
    console.warn('parseSchema6: revisionRoadmap[' + index + '] invalid priority — skipping')
    return null
  }
  const item: RoadmapItem = {
    id: String(r.id),
    description: String(r.description),
    priority: r.priority as RoadmapItem['priority'],
  }
  // The rest are optional enrichment — include only when validly present.
  if (typeof r.reviewer === 'string') item.reviewer = String(r.reviewer)
  if (r.type === 'Major' || r.type === 'Minor' || r.type === 'Editorial') item.type = r.type
  if (typeof r.targetSection === 'string') item.targetSection = String(r.targetSection)
  if (typeof r.suggestedAction === 'string') item.suggestedAction = String(r.suggestedAction)
  return item
}

// Leniently map ONE raw item to an RRMatrixRow (P14 re-review only). The R&R matrix is
// ADVISORY display data, so a malformed row is SKIPPED with a warn — we never throw on it.
function toRRMatrixRow(raw: unknown, index: number): RRMatrixRow | null {
  if (!isObject(raw)) {
    console.warn('parseSchema6: rrMatrix[' + index + '] is not an object — skipping')
    return null
  }
  const r = raw as Record<string, unknown>
  // comment + status are the minimum needed to render a meaningful row.
  if (typeof r.comment !== 'string' || r.comment.trim().length === 0) {
    console.warn('parseSchema6: rrMatrix[' + index + '] missing comment — skipping')
    return null
  }
  if (!RR_STATUSES.includes(r.status as RRResolutionStatus)) {
    console.warn('parseSchema6: rrMatrix[' + index + '] invalid status — skipping')
    return null
  }
  const row: RRMatrixRow = {
    id: typeof r.id === 'string' && r.id.trim().length > 0 ? String(r.id) : 'rr-' + index,
    comment: String(r.comment),
    revision: typeof r.revision === 'string' ? String(r.revision) : '',
    status: r.status as RRResolutionStatus,
  }
  if (typeof r.reviewer === 'string') row.reviewer = String(r.reviewer)
  if (typeof r.targetSection === 'string') row.targetSection = String(r.targetSection)
  return row
}

// Leniently map ONE raw item to a ScoreTrajectoryEntry (P14 re-review only). Only used as
// a fallback — runReReview computes the authoritative trajectory in software. Skips
// malformed rows; computes `delta` if the agent omitted it.
function toTrajectoryEntry(raw: unknown, index: number): ScoreTrajectoryEntry | null {
  if (!isObject(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r.dimension !== 'string' || r.dimension.trim().length === 0) return null
  const s3 = toScore100(r.stage3)
  const s3p = toScore100(r.stage3Prime)
  if (Number.isNaN(s3) || Number.isNaN(s3p)) {
    console.warn('parseSchema6: scoreTrajectory[' + index + '] missing/invalid scores — skipping')
    return null
  }
  const delta = typeof r.delta === 'number' && !Number.isNaN(r.delta) ? r.delta : s3p - s3
  return { dimension: String(r.dimension), stage3: s3, stage3Prime: s3p, delta }
}

// Parse + validate the Phase-2 Review Report. Throws HandoffIncompleteError if
// any required field is missing or invalid. In re-review mode (P14) only the narrow
// 3-agent team is required and the R&R matrix / residual issues / trajectory are parsed.
export function parseSchema6(raw: string, opts?: ParseSchema6Options): ReviewerScoreSet {
  const mode = opts?.mode ?? 'standard'
  // Which roles MUST be present. Standard Stage 3: all 5. Re-review Stage 3': the narrow team.
  const requiredRoles: ReviewerRole[] = mode === 'reReview' ? RE_REVIEW_REQUIRED_ROLES : ROLE_ORDER
  const data = extractJsonBlock(raw)
  const missing: string[] = []

  if (!isObject(data)) {
    throw new HandoffIncompleteError('schema6', ['(root is not a JSON object)'])
  }

  // sprintContractId — ties this report back to its Phase-1 scoring plan.
  if (typeof data.sprintContractId !== 'string' || data.sprintContractId.trim().length === 0) {
    missing.push('sprintContractId')
  }

  // reviewers — must be a non-empty array; index by role so we can demand exactly
  // one row per EIC/R1/R2/R3/DA. A duplicate role is itself an error (don't pick one).
  const rawReviewers = data.reviewers
  const byRole = new Map<string, Record<string, unknown>>()
  if (!Array.isArray(rawReviewers)) {
    missing.push('reviewers')
  } else {
    rawReviewers.forEach((rv, i) => {
      if (!isObject(rv)) {
        missing.push('reviewers[' + i + ']')
        return
      }
      const role = rv.role
      if (typeof role !== 'string' || !ROLE_ORDER.includes(role as ReviewerRole)) {
        // An unknown / non-canonical role — it can't fill an EIC..DA slot.
        missing.push('reviewers[' + i + '].role')
        return
      }
      if (byRole.has(role)) {
        // Duplicate row for the same role — ambiguous, so abort.
        missing.push('reviewers.' + role + ' (duplicate)')
        return
      }
      byRole.set(role, rv)
    })
  }

  // Now demand one valid row for each REQUIRED role and validate it. In standard mode
  // that is all 5 (EIC..DA); in re-review mode only the narrow team (EIC,R1,R2) is
  // required while R3/DA are included opportunistically when validly present. We still
  // walk ROLE_ORDER so any present optional role lands in canonical order.
  const reviewerRows: ReviewerReport[] = []
  for (const role of ROLE_ORDER) {
    const isRequired = requiredRoles.includes(role)
    const row = byRole.get(role)
    if (!row) {
      // A REQUIRED role missing is fatal (the review logic cannot average it); an
      // OPTIONAL role missing (re-review R3/DA) is simply skipped.
      if (isRequired) missing.push('reviewers.' + role)
      continue
    }

    // Collect this row's problems locally; only escalate them to missing[] when the
    // role is required, so a malformed OPTIONAL reviewer is skipped, not fatal.
    const rowMissing: string[] = []

    // overallScore — numeric in [0,100].
    const overallScore = toScore100(row.overallScore)
    if (Number.isNaN(overallScore)) rowMissing.push('reviewers.' + role + '.overallScore')

    // dimensions — object with all 5 numeric 0-100 keys.
    const dims = row.dimensions
    const dimScores: Partial<ReviewerDimensionScores> = {}
    if (!isObject(dims)) {
      rowMissing.push('reviewers.' + role + '.dimensions')
    } else {
      for (const key of DIMENSION_KEYS) {
        const n = toScore100((dims as Record<string, unknown>)[key])
        if (Number.isNaN(n)) rowMissing.push('reviewers.' + role + '.dimensions.' + key)
        else dimScores[key] = n
      }
    }

    // recommendation — one of the 4 EditorialDecision literals.
    const recommendation = row.recommendation
    if (!EDITORIAL_DECISIONS.includes(recommendation as EditorialDecision)) {
      rowMissing.push('reviewers.' + role + '.recommendation')
    }

    // reviewerName defaults to the role string; keyComments/requiredChanges to [].
    const reviewerName =
      typeof row.reviewerName === 'string' && row.reviewerName.trim().length > 0
        ? String(row.reviewerName)
        : role

    const rowValid =
      !Number.isNaN(overallScore) &&
      isObject(dims) &&
      DIMENSION_KEYS.every((k) => dimScores[k] !== undefined) &&
      EDITORIAL_DECISIONS.includes(recommendation as EditorialDecision)

    if (rowValid) {
      reviewerRows.push({
        role,
        reviewerName,
        overallScore,
        dimensions: dimScores as ReviewerDimensionScores,
        keyComments: toStringArray(row.keyComments),
        requiredChanges: toStringArray(row.requiredChanges),
        recommendation: recommendation as EditorialDecision,
      })
    } else if (isRequired) {
      // A required role that didn't validate aborts the parse (record its problems).
      missing.push(...rowMissing)
    } else {
      console.warn('parseSchema6: optional reviewer ' + role + ' malformed — skipping:', rowMissing.join(', '))
    }
  }

  // editorialDecision — the agent's advisory call; one of the 4 literals.
  if (!EDITORIAL_DECISIONS.includes(data.editorialDecision as EditorialDecision)) {
    missing.push('editorialDecision')
  }

  // consensus — one of the 4 literals.
  if (!CONSENSUS_VALUES.includes(data.consensus as ReviewConsensus)) {
    missing.push('consensus')
  }

  // confidenceScore — numeric in [0,100].
  const confidenceScore = toScore100(data.confidenceScore)
  if (Number.isNaN(confidenceScore)) missing.push('confidenceScore')

  if (missing.length > 0) {
    throw new HandoffIncompleteError('schema6', missing)
  }

  // All checks passed. Past the guards, casts are safe.
  const consensus = data.consensus as ReviewConsensus

  // daCritical: accept an explicit boolean from the agent; otherwise derive from
  // consensus. (Be tolerant — a 'DA-CRITICAL' consensus ALWAYS means daCritical,
  // even if the agent forgot the flag.) review.ts re-derives this too as a safety net.
  const daCritical =
    typeof data.daCritical === 'boolean'
      ? data.daCritical || consensus === 'DA-CRITICAL'
      : consensus === 'DA-CRITICAL'

  const report: ReviewerScoreSet = {
    sprintContractId: String(data.sprintContractId),
    reviewers: reviewerRows, // exactly 5, ordered EIC..DA, no dupes (guaranteed above)
    editorialDecision: data.editorialDecision as EditorialDecision,
    consensus,
    confidenceScore,
    daCritical,
  }

  // revisionRoadmap is OPTIONAL and ADVISORY in P11. If present as an array,
  // leniently map each item (skipping malformed ones with a warn). If the array
  // is absent or every item is malformed, leave the field undefined.
  if (Array.isArray(data.revisionRoadmap)) {
    const mapped: RoadmapItem[] = []
    data.revisionRoadmap.forEach((item, i) => {
      const roadmapItem = toRoadmapItem(item, i)
      if (roadmapItem) mapped.push(roadmapItem)
    })
    if (mapped.length > 0) report.revisionRoadmap = mapped
  }

  // ── P14 re-review extras (only in reReview mode; all ADVISORY / lenient) ──
  // The R&R matrix, residual issues, and any agent-supplied score trajectory. None of
  // these abort the parse — they enrich the Stage-3' panel. runReReview overwrites the
  // trajectory with a software-computed one, so the parsed value is only a fallback.
  if (mode === 'reReview') {
    if (Array.isArray(data.rrMatrix)) {
      const rows: RRMatrixRow[] = []
      data.rrMatrix.forEach((item, i) => {
        const row = toRRMatrixRow(item, i)
        if (row) rows.push(row)
      })
      if (rows.length > 0) report.rrMatrix = rows
    }
    if (Array.isArray(data.residualIssues)) {
      const issues = toStringArray(data.residualIssues).filter((s) => s.trim().length > 0)
      if (issues.length > 0) report.residualIssues = issues
    }
    if (Array.isArray(data.scoreTrajectory)) {
      const traj: ScoreTrajectoryEntry[] = []
      data.scoreTrajectory.forEach((item, i) => {
        const entry = toTrajectoryEntry(item, i)
        if (entry) traj.push(entry)
      })
      if (traj.length > 0) report.scoreTrajectory = traj
    }
  }

  return report
}
