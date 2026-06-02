// P11 — the editorial-decision logic. This file is the SINGLE SOURCE OF TRUTH for
// what editorial outcome a 5-reviewer Review Report leads to. It mirrors
// integrity.ts (deriveGateDecision): the agent's own editorialDecision is
// ADVISORY, and the BINDING decision is recomputed HERE from the numeric scores
// plus the DA-CRITICAL interlock.
//
// Why a single source of truth? Like the integrity gate, the editorial decision
// is correctness-critical: if the UI and the route each mapped scores -> outcome
// their own way, they could disagree (one says Accept, the other Major Revision).
// So every consumer calls deriveReviewDecision() here and trusts its result.
//
// Mental model (EE analogy): the average reviewer score is a measured signal level
// compared against four thresholds (gain bands). DA-CRITICAL is a hard interlock
// wired across the top: if the Devil's Advocate trips it, the "Accept" rail is
// physically disconnected no matter how high the signal reads.
//
// Decision thresholds (overall 0-100), from the P11 contract / wiki:
//   >= 80  Accept
//   65-79  Minor Revision
//   50-64  Major Revision
//   < 50   Reject

import type { EditorialDecision, ReviewerScoreSet } from '@/lib/types'

// ── The threshold legend ──────────────────────────────────────────────────────
// ONE source for the four bands so the UI threshold legend (P11.7) and the logic
// below never drift apart. `min` is the inclusive lower bound of each band; a band
// applies when averageOverall >= min and below the next-higher band's min.
export const REVIEW_THRESHOLDS = [
  { band: 'accept', min: 80, label: 'Accept' },
  { band: 'minor', min: 65, label: 'Minor Revision' },
  { band: 'major', min: 50, label: 'Major Revision' },
  { band: 'reject', min: 0, label: 'Reject' },
] as const

// The band an averageOverall falls into. Mirrors REVIEW_THRESHOLDS' `band` values.
type ThresholdBand = 'accept' | 'minor' | 'major' | 'reject'

// ── The review decision ───────────────────────────────────────────────────────

export interface ReviewDecision {
  // BINDING recommended decision — reconciles the agent's advisory value with the
  // numeric thresholds AND the DA-CRITICAL interlock (recomputed, never trusted).
  editorialDecision: EditorialDecision
  // The raw threshold band the average score landed in (before DA-CRITICAL).
  thresholdBand: ThresholdBand
  // Mean of the 5 reviewers' overallScore, rounded to an integer (0-100).
  averageOverall: number
  // True when the Devil's Advocate raised a critical flag (or consensus is DA-CRITICAL).
  daCritical: boolean
  // FALSE when daCritical — DA-CRITICAL overrides a numeric pass, so Accept is impossible.
  acceptAllowed: boolean
  // Recommended next route for the binding decision:
  //   final-gate — Accept -> straight to the Stage 4.5 final integrity gate
  //   coaching   — Minor/Major Revision -> the revision-coach stage
  //   writing    — Reject -> back to drafting
  route: 'final-gate' | 'coaching' | 'writing'
  // One-sentence human explanation naming the band + DA-CRITICAL if applicable.
  reason: string
}

// Map a threshold band to its editorial decision label. (Straight 1:1 mapping —
// the DA-CRITICAL override is applied separately by the caller.)
function bandToDecision(band: ThresholdBand): EditorialDecision {
  switch (band) {
    case 'accept':
      return 'Accept'
    case 'minor':
      return 'Minor Revision'
    case 'major':
      return 'Major Revision'
    case 'reject':
      return 'Reject'
  }
}

// Map a binding editorial decision to its recommended route.
function decisionToRoute(decision: EditorialDecision): ReviewDecision['route'] {
  if (decision === 'Accept') return 'final-gate'
  if (decision === 'Reject') return 'writing'
  // Minor Revision | Major Revision both head to coaching.
  return 'coaching'
}

// Find the band for a 0-100 average by walking REVIEW_THRESHOLDS high -> low and
// taking the first whose `min` the score meets. Since the last band ('reject') has
// min 0, every score in range resolves to a band.
function bandFor(averageOverall: number): ThresholdBand {
  for (const t of REVIEW_THRESHOLDS) {
    if (averageOverall >= t.min) return t.band
  }
  // Defensive only — REVIEW_THRESHOLDS' last band has min 0, so this is unreachable
  // for any non-negative score. A negative average (shouldn't happen post-parse).
  return 'reject'
}

// deriveReviewDecision — turn the (advisory) Review Report into the BINDING
// editorial decision. Pure function: same report in, same decision out — no I/O,
// no localStorage. Mirrors deriveGateDecision() in integrity.ts.
export function deriveReviewDecision(review: ReviewerScoreSet): ReviewDecision {
  // ── Step 1: averageOverall = rounded mean of the 5 reviewers' overallScore ──
  // The Schema-6 parser guarantees exactly 5 reviewers, but guard the empty case
  // defensively so we never divide by zero.
  const scores = review.reviewers.map((r) => r.overallScore)
  const sum = scores.reduce((acc, n) => acc + n, 0)
  const averageOverall = scores.length > 0 ? Math.round(sum / scores.length) : 0

  // ── Step 2: the raw threshold band from the average ──
  const thresholdBand = bandFor(averageOverall)

  // ── Step 3: the DA-CRITICAL interlock ──
  // daCritical from EITHER the parsed flag OR a 'DA-CRITICAL' consensus (belt and
  // braces — schema6 already reconciles these, we re-derive as a safety net).
  const daCritical = review.daCritical || review.consensus === 'DA-CRITICAL'
  // Accept is impossible whenever the DA tripped the interlock.
  const acceptAllowed = !daCritical

  // ── Step 4: the BINDING editorial decision ──
  // Start from the band's natural decision, then apply the DA-CRITICAL override:
  // if the DA raised a critical flag, an Accept/Minor result is FORCED down to
  // Major Revision (a numeric pass cannot stand against a critical flag); a Reject
  // stays Reject. Without DA-CRITICAL, the band maps straight through.
  const bandDecision = bandToDecision(thresholdBand)
  let editorialDecision: EditorialDecision = bandDecision
  if (daCritical && (bandDecision === 'Accept' || bandDecision === 'Minor Revision')) {
    editorialDecision = 'Major Revision'
  }

  // ── Step 5: route + reason ──
  const route = decisionToRoute(editorialDecision)
  const reason = buildReason(averageOverall, thresholdBand, daCritical, editorialDecision)

  return {
    editorialDecision,
    thresholdBand,
    averageOverall,
    daCritical,
    acceptAllowed,
    route,
    reason,
  }
}

// Build a one-sentence human explanation naming the band, the average, and the
// DA-CRITICAL override when it changed the outcome.
function buildReason(
  averageOverall: number,
  band: ThresholdBand,
  daCritical: boolean,
  decision: EditorialDecision,
): string {
  const bandLabel = REVIEW_THRESHOLDS.find((t) => t.band === band)?.label ?? band
  const base =
    'Average reviewer score ' + averageOverall + '/100 falls in the "' + bandLabel + '" band'
  if (daCritical) {
    return (
      base +
      ', but the Devil’s Advocate raised a CRITICAL flag (DA-CRITICAL), which overrides a numeric pass — binding decision: ' +
      decision +
      '.'
    )
  }
  return base + ' — binding decision: ' + decision + '.'
}
