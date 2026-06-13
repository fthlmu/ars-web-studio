// P15 — the ZERO-TOLERANCE Stage-4.5 final-gate logic. This file is the SINGLE
// SOURCE OF TRUTH for whether a paper is allowed to reach export.
//
// Why a separate module from integrity.ts (the 2.5 gate)? The two gates apply
// DIFFERENT rules to the same 7-mode report:
//
//   • Stage 2.5 (integrity.ts) is a graded interlock — soft modes can be
//     bounded-overridden, only-minor issues can be acknowledged, and the user
//     may still proceed. It exists to catch problems EARLY, before peer review.
//
//   • Stage 4.5 (this file) is the FINAL interlock before publication. It is
//     ZERO-TOLERANCE: every one of the 7 modes must read CLEAR. ANY mode that is
//     SUSPECTED *or* INSUFFICIENT_EVIDENCE blocks export — there is no override,
//     no acknowledge, no skip. A mode that was INSUFFICIENT at 2.5 (and was let
//     through on a bounded override) MUST be resolved to CLEAR here or it re-blocks.
//
// EE analogy: 2.5 is the bench-test interlock you can jumper to keep probing; 4.5
// is the final lockout/tagout before the line is energized for real — no jumpers
// exist, the breaker is physically absent unless every channel reads clean.
//
// Like integrity.ts, this is a PURE function: same report in, same decision out.
// Every consumer (the route, the report component) calls deriveFinalGateDecision()
// and trusts it — nobody re-implements the zero-tolerance rule loosely.

import type { FailureModeId, IntegrityReport, ModeVerdict } from '@/lib/types'

// The two zero-tolerance outcomes. Unlike the 2.5 gate there is NO
// PASS_WITH_CONDITIONS and NO BOUNDED_OVERRIDE — a 4.5 run either passes clean or
// it blocks export entirely.
export type FinalGateDecisionKind = 'PASS' | 'FAIL'

export interface FinalGateDecision {
  kind: FinalGateDecisionKind
  // FALSE for FAIL. When false, the UI must NOT render ANY export/proceed affordance
  // (querySelector('[data-testid="export-button"]') must be null) — and there is no
  // override/acknowledge/skip control anywhere on the screen (FR-39, FR-40).
  exportAllowed: boolean
  // Every mode the agent marked SUSPECTED (drives the FAIL reason + UI emphasis).
  suspectedModes: FailureModeId[]
  // Every mode marked INSUFFICIENT_EVIDENCE — at 4.5 these ALSO block (zero-tolerance),
  // unlike 2.5 where soft-mode INSUFFICIENT was override-eligible.
  insufficientModes: FailureModeId[]
  // The union of the two above, in canonical M1..M7 order — the modes that block export.
  blockingModes: FailureModeId[]
  reason: string
}

// deriveFinalGateDecision — turn the agent's (advisory) 4.5 report into the BINDING
// zero-tolerance outcome. PASS requires EVERY mode to be CLEAR; anything else blocks.
export function deriveFinalGateDecision(report: IntegrityReport): FinalGateDecision {
  const suspected: FailureModeId[] = []
  const insufficient: FailureModeId[] = []

  // Walk the 7 rows once, bucketing anything that is not CLEAR. (The Schema-5 parser
  // guarantees exactly 7 rows ordered M1..M7, so iterating report.modes preserves order.)
  for (const mode of report.modes) {
    if (mode.verdict === 'SUSPECTED') {
      suspected.push(mode.modeId)
    } else if (mode.verdict === 'INSUFFICIENT_EVIDENCE') {
      insufficient.push(mode.modeId)
    }
    // CLEAR is the ONLY verdict that does not block at the final gate.
  }

  const blocking = [...suspected, ...insufficient].sort()

  // ── PASS — every mode is CLEAR (zero-tolerance) ──
  if (blocking.length === 0) {
    return {
      kind: 'PASS',
      exportAllowed: true,
      suspectedModes: [],
      insufficientModes: [],
      blockingModes: [],
      reason: 'All 7 failure-mode checks read CLEAR at the final gate. Export is permitted.',
    }
  }

  // ── FAIL — at least one mode is not CLEAR. Export is impossible; the only exits
  //    are edit→re-run. No override path exists (the iron rule). ──
  return {
    kind: 'FAIL',
    exportAllowed: false,
    suspectedModes: suspected,
    insufficientModes: insufficient,
    blockingModes: blocking,
    reason: buildFinalFailReason(suspected, insufficient),
  }
}

// Build a human-readable FAIL reason naming exactly which modes block export and why.
function buildFinalFailReason(
  suspected: FailureModeId[],
  insufficient: FailureModeId[],
): string {
  const parts: string[] = []
  if (suspected.length > 0) {
    parts.push('SUSPECTED failure in ' + suspected.join(', '))
  }
  if (insufficient.length > 0) {
    parts.push(
      'unresolved (insufficient-evidence) mode(s) ' +
        insufficient.join(', ') +
        ' — at the final gate every mode must be CLEARED, not merely deferred',
    )
  }
  return (
    'Final integrity gate BLOCKED export: ' +
    parts.join('; ') +
    '. There is no override at this gate — edit the affected content and re-run the check.'
  )
}

// ── Stage-2.5 → 4.5 comparison ────────────────────────────────────────────────
// One row of the comparison column rendered in the FinalIntegrityGateReport: the
// mode's verdict at the EARLIER 2.5 gate (or null if no 2.5 run is on record) vs
// its verdict NOW at 4.5. This surfaces "INSUFFICIENT EVIDENCE → CLEAR" (resolved)
// and the dangerous "CLEAR → SUSPECTED" / "* → INSUFFICIENT" (regressed/unresolved).
export interface ModeComparisonRow {
  modeId: FailureModeId
  modeName: string
  prior: ModeVerdict | null      // verdict at Stage 2.5 (null = no 2.5 run recorded)
  current: ModeVerdict           // verdict at Stage 4.5
  // True when the mode is still blocking at 4.5 (current !== CLEAR) — drives emphasis.
  stillBlocking: boolean
}

// Pick the most recent Stage-'2.5' report from the append-only integrityReports list,
// or null if none exists (e.g. an old save, or the Accept path reached 4.5 first).
export function latestStage25Report(
  reports: IntegrityReport[] | undefined,
): IntegrityReport | null {
  if (!reports || reports.length === 0) return null
  for (let i = reports.length - 1; i >= 0; i--) {
    if (reports[i].stage === '2.5') return reports[i]
  }
  return null
}

// Build the per-mode 2.5→4.5 comparison rows from the final (4.5) report and the
// prior (2.5) report. Iterates the final report's 7 rows (canonical order); looks up
// each mode's earlier verdict by id.
export function buildModeComparison(
  finalReport: IntegrityReport,
  priorReport: IntegrityReport | null,
): ModeComparisonRow[] {
  const priorById = new Map<FailureModeId, ModeVerdict>()
  if (priorReport) {
    for (const m of priorReport.modes) priorById.set(m.modeId, m.verdict)
  }
  return finalReport.modes.map((m) => ({
    modeId: m.modeId,
    modeName: m.modeName,
    prior: priorById.get(m.modeId) ?? null,
    current: m.verdict,
    stillBlocking: m.verdict !== 'CLEAR',
  }))
}
