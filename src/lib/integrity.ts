// P10 — the IRON-RULE gate logic. This file is the SINGLE SOURCE OF TRUTH for
// whether a paper draft is allowed to proceed past the Stage 2.5 integrity gate.
//
// Why a single source of truth? The block decision is correctness-critical: if
// the UI and the route each computed "can proceed?" their own way, they could
// disagree and let a SUSPECTED-fabrication paper through. So every consumer
// (the route, the report component) calls deriveGateDecision() here and trusts
// its result — nobody re-implements the rules loosely.
//
// Mental model (EE analogy): think of the 7 modes as 7 fault detectors on a
// power rail. Some are "hard interlocks" (M1/M3/M5/M6) — if they can't even be
// measured, the breaker stays open. Others are "soft alarms" (M2/M4/M7) — an
// operator may sign off and proceed, but the override is logged permanently.
//
// Grounding: the 7 modes + their block conditions come from
// wiki/(C) concept-ars-failure-modes (Lu et al. 2026, Nature 651:914–919).

import type { FailureModeId, IntegrityReport } from '@/lib/types'

// ── Mode partition: which failures are hard interlocks vs soft alarms ─────────

// HARD-BLOCK modes. These four CANNOT be cleared by the AI alone — they require
// the user's own run logs / configs (a bug, a fabricated result, a bug spun into
// a "discovery," or a fabricated methodology). So INSUFFICIENT_EVIDENCE here is
// treated as a FAIL: no evidence == no proceed (FR-16). Order is M1, M3, M5, M6.
export const HARD_BLOCK_MODES: FailureModeId[] = ['M1', 'M3', 'M5', 'M6']

// SOFT modes. INSUFFICIENT_EVIDENCE here does NOT hard-block: the user may sign a
// bounded override and proceed (it must still be resolved by Stage 4.5). These
// are the citation / shortcut / frame-lock checks. Order is M2, M4, M7.
export const SOFT_MODES: FailureModeId[] = ['M2', 'M4', 'M7']

// ── The canonical mode catalog ───────────────────────────────────────────────
// Names + detection questions, ordered M1..M7. The Schema-5 parser fills any
// modeName/detectionQuestion the agent omits from THIS table, so the UI always
// shows a complete, correctly-worded row even on a terse agent reply.
export interface FailureModeMeta {
  modeId: FailureModeId
  modeName: string
  detectionQuestion: string
}

export const FAILURE_MODES: FailureModeMeta[] = [
  {
    modeId: 'M1',
    modeName: 'Implementation bug passing AI self-review',
    // Hard-block: a bug can only be ruled out against the real run, not by re-reading the prose.
    detectionQuestion:
      'For every quantitative claim, is there a saved run log (exit code 0, no silent crashes or suppressed warnings) confirming the code that produced it actually ran correctly?',
  },
  {
    modeId: 'M2',
    modeName: 'Hallucinated citation',
    // Soft: external databases (DOI / Semantic Scholar) can often verify, so a gap is recoverable.
    detectionQuestion:
      'Does every cited reference correspond to a real, correctly-attributed publication (verifiable DOI / database record), with no "vibe-cited" blends of two or three real papers into one fake one?',
  },
  {
    modeId: 'M3',
    modeName: 'Hallucinated experimental result',
    // Hard-block: a number like "12% improvement" must trace to the user's own raw data.
    detectionQuestion:
      'For every reported number, effect size, or "X% improvement," do the user-supplied raw results contain the data it was actually computed from (not a plausible-looking invented figure)?',
  },
  {
    modeId: 'M4',
    modeName: 'Shortcut reliance',
    // Soft: "real result, wrong reason" — flagged here, the Devil's Advocate at Stage 3 is its real home.
    detectionQuestion:
      'Does the result depend on the intended mechanism rather than a spurious shortcut (e.g. a dataset artifact or leaked feature) that would not generalize?',
  },
  {
    modeId: 'M5',
    modeName: 'Bug reframed as novel insight',
    // Hard-block: a compound failure (M1 + narrative) — needs the run to rule out "the surprise is just a bug."
    detectionQuestion:
      'Are any "surprising," "unexpected," or first-run findings backed by a verified correct run, rather than an unexplained output that has been narrated into a discovery?',
  },
  {
    modeId: 'M6',
    modeName: 'Methodology fabrication',
    // Hard-block: every Methods number must appear in the actual run config/log.
    detectionQuestion:
      'Does every detail in the Methods section (hyperparameters, sample sizes, procedures) match the actual run configuration the user supplied, with nothing plausible-sounding but invented?',
  },
  {
    modeId: 'M7',
    modeName: 'Frame-lock',
    // Soft: a wrong RQ/methodology commitment — if flagged, the user may return to Stage 1/2.
    detectionQuestion:
      'Is the paper answering the right research question with an appropriate methodology, rather than being locked into an early wrong commitment it cannot back out of?',
  },
]

// ── The gate decision ─────────────────────────────────────────────────────────

// The four possible gate outcomes:
//   PASS                 — clean; proceed control shown and enabled.
//   PASS_WITH_CONDITIONS — only MINOR issues; proceed allowed after an acknowledge checkbox.
//   BOUNDED_OVERRIDE     — soft modes (M2/M4/M7) are INSUFFICIENT; proceed allowed only via a
//                          logged override with a written reason.
//   FAIL                 — any SUSPECTED, or any hard mode INSUFFICIENT; proceed is IMPOSSIBLE
//                          (the control is absent from the DOM, not merely disabled).
export type GateDecisionKind = 'PASS' | 'PASS_WITH_CONDITIONS' | 'BOUNDED_OVERRIDE' | 'FAIL'

export interface GateDecision {
  kind: GateDecisionKind
  // FALSE only for FAIL. When false, the UI must NOT render any proceed affordance
  // (querySelector('[data-testid="proceed-to-review"]') must be null) — FR-18.
  proceedAllowed: boolean
  // The soft modes that are INSUFFICIENT and thus override-eligible. Non-empty
  // ONLY when kind === 'BOUNDED_OVERRIDE'.
  overrideEligibleModes: FailureModeId[]
  // All modes the agent marked SUSPECTED (drives the FAIL reason text + UI emphasis).
  suspectedModes: FailureModeId[]
  // Hard modes (M1/M3/M5/M6) that are INSUFFICIENT_EVIDENCE — each one alone forces FAIL.
  hardInsufficientModes: FailureModeId[]
  // Soft modes (M2/M4/M7) that are INSUFFICIENT_EVIDENCE — these enable the bounded override.
  softInsufficientModes: FailureModeId[]
  reason: string
}

// Small helper: is this mode id in the given partition list?
function inList(list: FailureModeId[], id: FailureModeId): boolean {
  return list.includes(id)
}

// deriveGateDecision — turn the agent's (advisory) report into the BINDING gate
// outcome. This implements the EXACT 5-step rule from the P10 contract; each
// branch is annotated with its functional-requirement id. Pure function: same
// report in, same decision out — no I/O, no state.
export function deriveGateDecision(report: IntegrityReport): GateDecision {
  // ── Step 1: bucket the 7 mode verdicts into the three lists that matter ──
  // suspected: ANY mode the agent flagged SUSPECTED.
  // hardInsufficient: HARD_BLOCK modes (M1/M3/M5/M6) that are INSUFFICIENT_EVIDENCE.
  // softInsufficient: SOFT modes (M2/M4/M7) that are INSUFFICIENT_EVIDENCE.
  const suspected: FailureModeId[] = []
  const hardInsufficient: FailureModeId[] = []
  const softInsufficient: FailureModeId[] = []

  for (const mode of report.modes) {
    if (mode.verdict === 'SUSPECTED') {
      suspected.push(mode.modeId)
    } else if (mode.verdict === 'INSUFFICIENT_EVIDENCE') {
      // Route the "couldn't verify" verdict by the mode's partition.
      if (inList(HARD_BLOCK_MODES, mode.modeId)) {
        hardInsufficient.push(mode.modeId)
      } else if (inList(SOFT_MODES, mode.modeId)) {
        softInsufficient.push(mode.modeId)
      }
    }
    // CLEAR contributes to none of the three lists.
  }

  // ── Step 2: FAIL — any SUSPECTED, or any HARD mode INSUFFICIENT (FR-16, FR-18, EH-08) ──
  // This is the iron interlock: NO proceed control, NO override path. The user
  // must edit the draft and re-run the check.
  if (suspected.length > 0 || hardInsufficient.length > 0) {
    return {
      kind: 'FAIL',
      proceedAllowed: false,
      overrideEligibleModes: [],
      suspectedModes: suspected,
      hardInsufficientModes: hardInsufficient,
      softInsufficientModes: softInsufficient,
      reason: buildFailReason(suspected, hardInsufficient),
    }
  }

  // ── Step 3: BOUNDED_OVERRIDE — soft modes INSUFFICIENT (FR-17, FR-19) ──
  // No hard problems, but at least one soft mode (M2/M4/M7) couldn't be verified.
  // The user MAY proceed, but only by signing a logged override with a reason.
  if (softInsufficient.length > 0) {
    return {
      kind: 'BOUNDED_OVERRIDE',
      proceedAllowed: true,
      overrideEligibleModes: softInsufficient,
      suspectedModes: suspected,            // empty here, but kept for a uniform shape
      hardInsufficientModes: hardInsufficient,
      softInsufficientModes: softInsufficient,
      reason:
        'Soft modes could not be fully verified: ' +
        softInsufficient.join(', ') +
        '. Proceeding requires a logged override; these must be resolved by Stage 4.5.',
    }
  }

  // ── Step 4: PASS_WITH_CONDITIONS — only MINOR issues remain (FR-20) ──
  // Everything verified, but the agent noted minor issues (or self-reported the
  // PASS_WITH_CONDITIONS verdict). Proceed is allowed after an acknowledgement.
  if (report.overallIssues.minor > 0 || report.verdict === 'PASS_WITH_CONDITIONS') {
    return {
      kind: 'PASS_WITH_CONDITIONS',
      proceedAllowed: true,
      overrideEligibleModes: [],
      suspectedModes: suspected,
      hardInsufficientModes: hardInsufficient,
      softInsufficientModes: softInsufficient,
      reason:
        'No blocking failures, but ' +
        report.overallIssues.minor +
        ' minor issue(s) were noted. Acknowledge before proceeding.',
    }
  }

  // ── Step 5: PASS — clean (FR-20) ──
  return {
    kind: 'PASS',
    proceedAllowed: true,
    overrideEligibleModes: [],
    suspectedModes: suspected,
    hardInsufficientModes: hardInsufficient,
    softInsufficientModes: softInsufficient,
    reason: 'All 7 failure-mode checks cleared. Safe to proceed to peer review.',
  }
}

// Build a human-readable FAIL reason naming exactly which modes blocked and why.
function buildFailReason(suspected: FailureModeId[], hardInsufficient: FailureModeId[]): string {
  const parts: string[] = []
  if (suspected.length > 0) {
    parts.push('SUSPECTED failure in ' + suspected.join(', '))
  }
  if (hardInsufficient.length > 0) {
    parts.push(
      'insufficient evidence for hard-block mode(s) ' +
        hardInsufficient.join(', ') +
        ' (these require your run logs / configs and cannot be cleared by the AI alone)',
    )
  }
  return 'Integrity gate FAILED: ' + parts.join('; ') + '. Edit the affected content and re-run the check.'
}
