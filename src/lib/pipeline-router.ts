// P18 — the pipeline ORCHESTRATION single source of truth (state names match the UX
// gate-to-route map exactly).
//
// One module decides, for any saved paper:
//   • derivePipelineStatus(state)   → which of the 20 PipelineStatus values the paper is in
//   • pipelineRouteFor(status)      → which /pipeline/* route renders that status (exhaustive)
//   • pipelineHrefForState(state)   → the full href incl. the residual-coaching query param
//   • CHECKPOINTS / deriveCheckpointIndex → the 12-checkpoint sidebar model
//   • revertRunningStatus(status)   → the NFR-12 "running-* is not resumable" revert
//   • pipelineStatusLabel(status)   → a human label via an EXHAUSTIVE switch (P18.1)
//
// Why DERIVE rather than store? Every stage route (P9–P17) already writes its OWN
// per-stage *Status field (researchStatus, integrityStatus, reviewStatus, …). Instead of
// retrofitting all of them to also maintain one unified pipelineStatus, the router DERIVES
// the unified state from those fields. This is additive and back-compatible: a pre-P9 paper
// (only outline/sections) derives cleanly to an outline/section state, and the two P15
// strings ('running-final-gate'/'export-ready') keep their exact meaning (DR-01).

import type { PaperState, PipelineStatus } from './types'

// ─── Loop / round counter caps (SC-X-03, FR-05/28/36) ──────────────────────────
export const MAX_REVISION_LOOPS = 2
export const MAX_COACHING_ROUNDS = 8
export const MAX_RESIDUAL_COACHING_ROUNDS = 5

// ─── The exhaustive status label (P18.1) ──────────────────────────────────────
// A `switch` with a case for ALL 20 states and NO `default`. The trailing
// `const _exhaustive: never = status` makes the compiler ERROR if a future state is added
// to the union but not handled here — compile-time exhaustiveness (FR-01).
export function pipelineStatusLabel(status: PipelineStatus): string {
  switch (status) {
    case 'idle':                      return 'Not started'
    case 'running-research':          return 'Researching'
    case 'awaiting-research-review':  return 'Awaiting research review'
    case 'generating-outline':        return 'Generating outline'
    case 'awaiting-outline-review':   return 'Awaiting outline review'
    case 'generating-sections':       return 'Writing sections'
    case 'awaiting-section-review':   return 'Awaiting draft review'
    case 'running-integrity-gate':    return 'Running integrity gate'
    case 'awaiting-integrity-review': return 'Integrity gate (2.5)'
    case 'running-peer-review':       return 'Running peer review'
    case 'awaiting-peer-review':      return 'Awaiting editorial decision'
    case 'coaching':                  return 'Coaching'
    case 'running-revision':          return 'Running revision'
    case 'awaiting-revision-review':  return 'Awaiting revision review'
    case 'running-re-review':         return 'Running re-review'
    case 'awaiting-re-review':        return 'Awaiting re-review decision'
    case 'running-final-gate':        return 'Running final integrity gate'
    case 'awaiting-final-review':     return 'Final integrity gate (4.5)'
    case 'export-ready':              return 'Export ready'
    case 'error':                     return 'Error'
  }
  // If this line ever fails to compile, a PipelineStatus value is unhandled above.
  const _exhaustive: never = status
  return _exhaustive
}

// True for the in-flight states the entry router treats as non-resumable on reload.
export function isRunningStatus(status: PipelineStatus): boolean {
  return status.startsWith('running-') || status.startsWith('generating-')
}

// ─── The 12 checkpoints (the sidebar model) ───────────────────────────────────
// CP-01..CP-12 across the 6 ARS stages (Stage 6 Summary is advisory, not a numbered
// checkpoint). Each entry lists which PipelineStatus values sit ON it, so the sidebar can
// place the current-stage marker and the loop/round counters next to the right rows.
export interface CheckpointMeta {
  id: string                       // 'CP-01' … 'CP-12'
  stageLabel: string               // the ARS stage heading shown in the sidebar
  label: string                    // the checkpoint's own short label
  statuses: PipelineStatus[]       // the PipelineStatus values that map to this checkpoint
  note?: string                    // e.g. the BLOCKING / NO-BYPASS suffix
}

export const CHECKPOINTS: CheckpointMeta[] = [
  { id: 'CP-01', stageLabel: 'Stage 1 · Research',     label: 'RQ Brief + Methodology', statuses: ['running-research', 'awaiting-research-review'] },
  { id: 'CP-02', stageLabel: 'Stage 1 · Research',     label: 'Bibliography',           statuses: [] },
  { id: 'CP-03', stageLabel: 'Stage 2 · Write',        label: 'Outline approved',       statuses: ['generating-outline', 'awaiting-outline-review'] },
  { id: 'CP-04', stageLabel: 'Stage 2 · Write',        label: 'Sections drafted',       statuses: ['generating-sections', 'awaiting-section-review'] },
  { id: 'CP-05', stageLabel: '2.5 Integrity Gate',     label: '7-mode integrity',       statuses: ['running-integrity-gate', 'awaiting-integrity-review'], note: '✓ BLOCKING' },
  { id: 'CP-06', stageLabel: 'Stage 3 · Peer Review',  label: 'Editorial decision',     statuses: ['running-peer-review', 'awaiting-peer-review'] },
  { id: 'CP-07', stageLabel: '3→4 Coaching',           label: 'Engage / just fix it',   statuses: ['coaching'] },
  { id: 'CP-08', stageLabel: 'Stage 4 · Revise',       label: 'Revised draft',          statuses: ['running-revision', 'awaiting-revision-review'] },
  { id: 'CP-09', stageLabel: "3' Re-Review",           label: 'Verification decision',  statuses: ['running-re-review', 'awaiting-re-review'] },
  { id: 'CP-10', stageLabel: "4' Re-Revise",           label: 'Content frozen',         statuses: [] },
  { id: 'CP-11', stageLabel: '4.5 Final Integrity',    label: 'Zero-tolerance re-run',  statuses: ['running-final-gate', 'awaiting-final-review'], note: '✓ NO BYPASS' },
  { id: 'CP-12', stageLabel: 'Stage 5 · Finalize',     label: 'Format + export',        statuses: ['export-ready'] },
]

// The checkpoint position (0..11) that the CURRENT status sits on. Used only to place the
// "● current" marker; cleared/upcoming state comes from deriveCheckpointIndex below.
export function checkpointPositionOf(status: PipelineStatus): number {
  const i = CHECKPOINTS.findIndex((cp) => cp.statuses.includes(status))
  return i === -1 ? 0 : i
}

// ─── deriveCheckpointIndex (P18.6) ─────────────────────────────────────────────
// How many of the 12 checkpoints are CLEARED (0..12). We take the HIGHEST checkpoint with
// direct evidence and count it + everything before it as cleared — so a skipped middle
// stage (e.g. Accept-without-coaching, or a legacy paper that never ran research) does not
// leave an artificial gap. Monotonic: later progress can only raise the count.
export function deriveCheckpointIndex(state: PaperState): number {
  const cleared: boolean[] = [
    /* CP-01 */ state.researchApproved === true,
    /* CP-02 */ state.researchApproved === true,
    /* CP-03 */ state.outlineApproved === true,
    /* CP-04 */ state.sections.length > 0 && state.sections.every((s) => s.status === 'done' || s.status === 'edited'),
    /* CP-05 */ state.integrityStatus === 'passed' || !!state.integrityPassDate,
    /* CP-06 */ !!state.reviewDecision || state.reviewStatus === 'accepted' || state.reviewStatus === 'revision' || state.reviewStatus === 'rejected',
    /* CP-07 */ state.coachingStatus === 'proceed-revision',
    /* CP-08 */ state.revisionStatus === 're-review' || state.revisionStatus === 'final-gate' || !!state.revisedDraft,
    /* CP-09 */ state.reReviewStatus === 'final-gate' || !!state.reReviewReport,
    /* CP-10 */ state.reReviseUsed === true || state.residualCoachingStatus === 'proceed-revision',
    /* CP-11 */ state.finalIntegrityStatus === 'passed' || !!state.finalIntegrityPassDate || state.pipelineStatus === 'export-ready',
    /* CP-12 */ (state.exportedFormats?.length ?? 0) > 0 || state.processSummaryStatus === 'done',
  ]
  let highest = -1
  for (let i = 0; i < cleared.length; i++) {
    if (cleared[i]) highest = i
  }
  return highest + 1
}

// ─── derivePipelineStatus ──────────────────────────────────────────────────────
// Inspect the paper's per-stage *Status fields from the MOST ADVANCED stage backward and
// return the single PipelineStatus that names where the paper actually is. The first
// matching (most-advanced) branch wins.
export function derivePipelineStatus(state: PaperState): PipelineStatus {
  // ── Stage 5/6: exported or final gate passed → export-ready (no separate 'complete') ──
  if (
    state.pipelineStatus === 'export-ready' ||
    state.finalIntegrityStatus === 'passed' ||
    (state.exportedFormats?.length ?? 0) > 0 ||
    state.processSummaryStatus === 'done'
  ) {
    return 'export-ready'
  }

  // ── Stage 4.5 final integrity gate (P15 also writes pipelineStatus here) ──
  if (state.finalIntegrityStatus === 'awaiting-review') return 'awaiting-final-review'
  if (
    state.pipelineStatus === 'running-final-gate' ||
    state.finalIntegrityStatus === 'running' ||
    state.finalIntegrityStatus === 'failed'
  ) {
    return 'running-final-gate'
  }

  // ── Stage 3'/4' re-review + residual coaching (residual folds into 'coaching') ──
  if (
    state.residualCoachingStatus === 'round-0' ||
    state.residualCoachingStatus === 'in-progress' ||
    state.residualCoachingStatus === 'cap-reached'
  ) {
    return 'coaching'
  }
  if (state.reReviewStatus === 'final-gate') return 'running-final-gate'
  if (state.reReviewStatus === 'running') return 'running-re-review'
  if (state.reReviewStatus === 'awaiting-decision') return 'awaiting-re-review'

  // ── Stage 4 revision ──
  if (state.revisionStatus === 'final-gate') return 'running-final-gate'
  if (state.revisionStatus === 're-review') return 'running-re-review'
  if (state.revisionStatus === 'running') return 'running-revision'
  if (state.revisionStatus === 'awaiting-approval') return 'awaiting-revision-review'

  // ── Stage 3→4 coaching ──
  if (
    state.coachingStatus === 'round-0' ||
    state.coachingStatus === 'in-progress' ||
    state.coachingStatus === 'cap-reached' ||
    state.coachingStatus === 'proceed-revision'
  ) {
    return 'coaching'
  }

  // ── Stage 3 peer review ──
  if (state.reviewStatus === 'accepted') return 'running-final-gate'
  if (state.reviewStatus === 'revision' || state.reviewStatus === 'rejected') return 'coaching'
  if (state.reviewStatus === 'running-phase1' || state.reviewStatus === 'running-phase2') {
    return 'running-peer-review'
  }
  if (state.reviewStatus === 'awaiting-decision') return 'awaiting-peer-review'

  // ── Stage 2.5 integrity gate ──
  if (state.integrityStatus === 'running') return 'running-integrity-gate'
  if (state.integrityStatus === 'awaiting-review' || state.integrityStatus === 'failed') {
    return 'awaiting-integrity-review'
  }
  if (state.integrityStatus === 'passed') {
    // 2.5 cleared but peer review not started → the next gate is review.
    return 'running-peer-review'
  }

  // ── Stage 1 research (only when the paper actually ran research) ──
  if (state.researchStatus === 'running') return 'running-research'
  if (state.researchStatus === 'awaiting-approval') return 'awaiting-research-review'
  // 'approved'/'idle'/absent research falls through to the outline/section path below.

  // ── Outline + sections (legacy P0–P8 path; also the post-research path) ──
  if (state.outlineApproved && state.sections.length > 0) {
    const allDone = state.sections.every((s) => s.status === 'done' || s.status === 'edited')
    return allDone ? 'awaiting-section-review' : 'generating-sections'
  }
  if (state.outline) return 'awaiting-outline-review'
  if (state.generationStatus === 'running' || state.generationStatus === 'error') {
    return 'generating-outline'
  }

  // Nothing generated yet.
  return 'idle'
}

// ─── The gate-to-route map (P18.5) ─────────────────────────────────────────────
// Every PipelineStatus maps to exactly one /pipeline/* route via an EXHAUSTIVE switch (no
// default). The entry router reads the derived status and navigates here; the sidebar uses
// it only to mark which stage row is active.
export function pipelineRouteFor(status: PipelineStatus): string {
  switch (status) {
    case 'idle':                      return '/intake'
    case 'running-research':
    case 'awaiting-research-review':  return '/pipeline/research'
    case 'generating-outline':
    case 'awaiting-outline-review':
    case 'generating-sections':
    case 'awaiting-section-review':   return '/pipeline/write'
    case 'running-integrity-gate':
    case 'awaiting-integrity-review': return '/pipeline/integrity'
    case 'running-peer-review':
    case 'awaiting-peer-review':      return '/pipeline/review'
    case 'coaching':                  return '/pipeline/coaching'
    case 'running-revision':
    case 'awaiting-revision-review':  return '/pipeline/revise'
    case 'running-re-review':
    case 'awaiting-re-review':        return '/pipeline/re-review'
    case 'running-final-gate':
    case 'awaiting-final-review':     return '/pipeline/final-integrity'
    case 'export-ready':              return '/pipeline/finalize'
    case 'error':                     return '/pipeline/write'
  }
  const _exhaustive: never = status
  return _exhaustive
}

// The full href for a paper, including the residual-coaching query the coaching route needs
// to switch into its Stage-3'→4' (max-5) mode. Pure status→route can't carry that nuance,
// so it lives here where the state is in hand. Everything else is the plain route.
export function pipelineHrefForState(state: PaperState): string {
  const status = derivePipelineStatus(state)
  if (status === 'coaching') {
    const residual =
      state.residualCoachingStatus === 'round-0' ||
      state.residualCoachingStatus === 'in-progress' ||
      state.residualCoachingStatus === 'cap-reached'
    return residual ? '/pipeline/coaching?stage=re-review' : '/pipeline/coaching'
  }
  return pipelineRouteFor(status)
}

// ─── NFR-12: running-* is NOT resumable on a cold reload ───────────────────────
// An in-flight agent call does not survive a browser close, so on reload a 'running-*'
// (or 'generating-*') status reverts to the SAME stage's human gate — the route is
// unchanged (running/awaiting of a stage share a route), so the page simply shows its
// "Resume / Re-run" affordance instead of implying a live stream. Resumable / terminal
// states pass through unchanged.
export function revertRunningStatus(status: PipelineStatus): PipelineStatus {
  switch (status) {
    case 'running-research':       return 'awaiting-research-review'
    case 'generating-outline':     return 'awaiting-outline-review'
    case 'generating-sections':    return 'awaiting-section-review'
    case 'running-integrity-gate': return 'awaiting-integrity-review'
    case 'running-peer-review':    return 'awaiting-peer-review'
    case 'running-revision':       return 'awaiting-revision-review'
    case 'running-re-review':      return 'awaiting-re-review'
    case 'running-final-gate':     return 'awaiting-final-review'
    // Resumable / terminal — unchanged:
    case 'idle':
    case 'awaiting-research-review':
    case 'awaiting-outline-review':
    case 'awaiting-section-review':
    case 'awaiting-integrity-review':
    case 'awaiting-peer-review':
    case 'coaching':
    case 'awaiting-revision-review':
    case 'awaiting-re-review':
    case 'awaiting-final-review':
    case 'export-ready':
    case 'error':
      return status
  }
  const _exhaustive: never = status
  return _exhaustive
}
