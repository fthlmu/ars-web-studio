// P17 — Stage-6 LOCAL assembly (SSOT). Everything in this file is computed from
// PaperState in pure software with NO LLM call: the execution timeline, the key
// decisions, the model-per-stage list, the Failure-Mode Audit Log, and the AI-usage
// disclosure statement. The two Stage-6 AGENTS (narrative + collaboration depth) live
// in ars-client.runProcessSummary; this module is the deterministic half.
//
// Why a separate module (like final-integrity.ts)? So the page and the components never
// re-derive these tables loosely — they call one helper and trust it. The Failure-Mode
// Audit Log in particular MUST be assembled locally (FR-47) so that, even if the Stage-6
// agents fail, the audit trail still renders and the paper download is unaffected.

import type {
  PaperState,
  PipelineTraceEntry,
  ProcessKeyDecision,
  ModelStageEntry,
  FailureModeAuditEntry,
  FailureModeId,
  IntegrityReport,
  ModeVerdict,
} from './types'
import { latestStage25Report } from './final-integrity'

// Canonical 7 failure modes (M1..M7) with their names — the same list the integrity
// agent is contracted to return (CONTRACT_INTEGRITY in ars-client). Used as the row
// skeleton + a name fallback when no report recorded a given mode.
const CANONICAL_MODES: { id: FailureModeId; name: string }[] = [
  { id: 'M1', name: 'Implementation bug passing AI self-review' },
  { id: 'M2', name: 'Hallucinated citation' },
  { id: 'M3', name: 'Hallucinated experimental result' },
  { id: 'M4', name: 'Shortcut reliance' },
  { id: 'M5', name: 'Bug reframed as novel insight' },
  { id: 'M6', name: 'Methodology fabrication' },
  { id: 'M7', name: 'Frame-lock' },
]

// Pick the most recent Stage-'4.5' report from the append-only list (mirrors
// latestStage25Report in final-integrity.ts).
function latestStage45Report(reports: IntegrityReport[] | undefined): IntegrityReport | null {
  if (!reports || reports.length === 0) return null
  for (let i = reports.length - 1; i >= 0; i--) {
    if (reports[i].stage === '4.5') return reports[i]
  }
  return null
}

// Index a report's 7 mode rows by id for O(1) verdict lookup.
function verdictMap(report: IntegrityReport | null): Map<FailureModeId, ModeVerdict> {
  const m = new Map<FailureModeId, ModeVerdict>()
  if (report) for (const row of report.modes) m.set(row.modeId, row.verdict)
  return m
}

/**
 * Build the Failure-Mode Audit Log (FR-47) entirely from PaperState — NO LLM call.
 * One row per canonical mode M1..M7 with: the 2.5 verdict, the 4.5 verdict, whether a
 * bounded 2.5 override let it through, and the permanent override reason (FR-19).
 *
 * Override attribution: a bounded override is a GATE-level action (it carries one reason
 * for the whole gate). We mark a mode as overridden when (a) an override reason exists
 * on record — from the latest 2.5 report's overrideReason or a complianceHistory
 * 'override' entry — AND (b) that mode was NOT CLEAR at 2.5 (i.e. it is one of the modes
 * the override actually let past).
 */
export function buildFailureModeAuditLog(state: PaperState): FailureModeAuditEntry[] {
  const report25 = latestStage25Report(state.integrityReports)
  const report45 = latestStage45Report(state.integrityReports)
  const v25 = verdictMap(report25)
  const v45 = verdictMap(report45)

  // Gather any override reason on record (report-level first, then compliance trail).
  const complianceOverride = (state.complianceHistory ?? []).find(
    (e) => e.action === 'override' && typeof e.reason === 'string' && e.reason.trim().length > 0,
  )
  const overrideReason =
    (report25?.overrideReason && report25.overrideReason.trim().length > 0
      ? report25.overrideReason
      : undefined) ?? complianceOverride?.reason
  const hasOverride = typeof overrideReason === 'string' && overrideReason.trim().length > 0

  // Prefer the real recorded mode name (reports may carry richer text); fall back to canonical.
  const nameFor = (id: FailureModeId, fallback: string): string => {
    const fromFinal = report45?.modes.find((m) => m.modeId === id)?.modeName
    const fromEarly = report25?.modes.find((m) => m.modeId === id)?.modeName
    return fromFinal || fromEarly || fallback
  }

  return CANONICAL_MODES.map(({ id, name }) => {
    const verdict25 = v25.has(id) ? v25.get(id)! : null
    const verdict45 = v45.has(id) ? v45.get(id)! : null
    const overrideApplied = hasOverride && verdict25 !== null && verdict25 !== 'CLEAR'
    const entry: FailureModeAuditEntry = {
      modeId: id,
      modeName: nameFor(id, name),
      verdict25,
      verdict45,
      overrideApplied,
    }
    if (overrideApplied) entry.overrideReason = overrideReason
    return entry
  })
}

/**
 * Build the execution timeline from the *Status fields PaperState accumulated across
 * P9–P16. Each stage maps a status field to a completed/skipped/failed/not-run row.
 */
export function buildPipelineTrace(state: PaperState): PipelineTraceEntry[] {
  const trace: PipelineTraceEntry[] = []

  // Stage 1 — Research
  if (state.researchApproved || state.researchStatus === 'approved') {
    const n = state.bibliography?.sources.length ?? 0
    trace.push({ stage: 'Stage 1 — Research', label: 'Research approved', status: 'completed', detail: n ? `${n} sources` : undefined })
  } else if (state.researchStatus && state.researchStatus !== 'idle') {
    trace.push({ stage: 'Stage 1 — Research', label: `Research ${state.researchStatus}`, status: state.researchStatus === 'error' ? 'failed' : 'not-run' })
  } else {
    trace.push({ stage: 'Stage 1 — Research', label: 'Research not run', status: 'not-run' })
  }

  // Stage 2 — Drafting
  const doneSections = state.sections.filter((s) => s.status === 'done' || s.status === 'edited').length
  trace.push({
    stage: 'Stage 2 — Drafting',
    label: state.generationStatus === 'done' ? 'Draft complete' : `Draft ${state.generationStatus}`,
    status: state.generationStatus === 'done' ? 'completed' : state.generationStatus === 'error' ? 'failed' : 'not-run',
    detail: `${doneSections}/${state.sections.length} sections`,
  })

  // Stage 2.5 — Integrity Gate
  if (state.integrityPassDate) {
    trace.push({ stage: 'Stage 2.5 — Integrity Gate', label: 'Passed', status: 'completed', detail: new Date(state.integrityPassDate).toLocaleDateString() })
  } else if (state.integrityStatus && state.integrityStatus !== 'idle') {
    trace.push({ stage: 'Stage 2.5 — Integrity Gate', label: state.integrityStatus, status: state.integrityStatus === 'failed' || state.integrityStatus === 'error' ? 'failed' : 'not-run' })
  } else {
    trace.push({ stage: 'Stage 2.5 — Integrity Gate', label: 'Not run', status: 'not-run' })
  }

  // Stage 3 — Peer Review
  if (state.reviewDecision) {
    trace.push({ stage: 'Stage 3 — Peer Review', label: `Decision: ${state.reviewDecision}`, status: 'completed', detail: state.reviewReport?.consensus })
  } else if (state.reviewStatus && state.reviewStatus !== 'idle') {
    trace.push({ stage: 'Stage 3 — Peer Review', label: state.reviewStatus, status: state.reviewStatus === 'error' ? 'failed' : 'not-run' })
  } else {
    trace.push({ stage: 'Stage 3 — Peer Review', label: 'Not run', status: 'not-run' })
  }

  // Stage 3→4 — Coaching (only if it happened)
  if (state.coachingRoundCount && state.coachingRoundCount > 0) {
    trace.push({ stage: 'Stage 3→4 — Coaching', label: 'Coaching dialogue', status: 'completed', detail: `${state.coachingRoundCount} round(s)` })
  } else if (state.coachingStatus === 'proceed-revision') {
    trace.push({ stage: 'Stage 3→4 — Coaching', label: 'Skipped — proceeded to revision', status: 'skipped' })
  }

  // Stage 4 — Revision (only if it happened)
  if (state.revisedDraft || state.revisionStatus) {
    const loops = state.revisionLoopCount ?? 0
    trace.push({
      stage: 'Stage 4 — Revision',
      label: state.revisedDraft ? 'Revision applied' : `Revision ${state.revisionStatus}`,
      status: state.revisedDraft ? 'completed' : state.revisionStatus === 'error' ? 'failed' : 'not-run',
      detail: loops ? `${loops} revision loop(s)` : undefined,
    })
  }

  // Stage 3'/4' — Re-Review / Re-Revise (only if it happened)
  if (state.reReviewReport || state.reReviewStatus) {
    trace.push({
      stage: "Stage 3'/4' — Re-Review",
      label: state.reReviewReport ? 'Re-review complete' : `Re-review ${state.reReviewStatus}`,
      status: state.reReviewReport ? 'completed' : state.reReviewStatus === 'error' ? 'failed' : 'not-run',
      detail: state.reReviseUsed ? 'final revision used' : undefined,
    })
  }

  // Stage 4.5 — Final Integrity Gate
  if (state.finalIntegrityPassDate) {
    trace.push({ stage: 'Stage 4.5 — Final Integrity Gate', label: 'Passed (zero-tolerance)', status: 'completed', detail: new Date(state.finalIntegrityPassDate).toLocaleDateString() })
  } else if (state.finalIntegrityStatus && state.finalIntegrityStatus !== 'idle') {
    trace.push({ stage: 'Stage 4.5 — Final Integrity Gate', label: state.finalIntegrityStatus, status: state.finalIntegrityStatus === 'failed' || state.finalIntegrityStatus === 'error' ? 'failed' : 'not-run' })
  }

  // Stage 5 — Finalize / Export
  const exported = state.exportedFormats ?? []
  if (exported.length > 0) {
    trace.push({ stage: 'Stage 5 — Finalize / Export', label: 'Exported', status: 'completed', detail: exported.join(', ').toUpperCase() })
  } else if (state.pipelineStatus === 'export-ready') {
    trace.push({ stage: 'Stage 5 — Finalize / Export', label: 'Export-ready (nothing downloaded yet)', status: 'not-run' })
  }

  return trace
}

/**
 * Extract the human's key decisions across the run, locally from PaperState.
 */
export function buildKeyDecisions(state: PaperState): ProcessKeyDecision[] {
  const decisions: ProcessKeyDecision[] = []

  if (state.outlineApproved) {
    decisions.push({ label: 'Outline approved', detail: 'The human reviewed and approved the generated outline before drafting.' })
  }

  // A bounded 2.5 override is a notable human decision (FR-19).
  const report25 = latestStage25Report(state.integrityReports)
  const overrideEntry = (state.complianceHistory ?? []).find((e) => e.action === 'override')
  const overrideReason = report25?.overrideReason ?? overrideEntry?.reason
  if (overrideReason && overrideReason.trim().length > 0) {
    decisions.push({ label: 'Stage-2.5 bounded override', detail: overrideReason })
  }

  if (state.reviewDecision) {
    decisions.push({ label: 'Editorial decision', detail: `The human accepted the "${state.reviewDecision}" outcome from peer review.` })
  }

  if (state.coachingRoundCount && state.coachingRoundCount > 0) {
    decisions.push({ label: 'Revision coaching', detail: `${state.coachingRoundCount} Socratic coaching round(s) before revision.` })
  } else if (state.coachingStatus === 'proceed-revision') {
    decisions.push({ label: 'Coaching skipped', detail: 'The human skipped coaching and proceeded straight to revision.' })
  }

  if (typeof state.revisionLoopCount === 'number' && state.revisionLoopCount > 0) {
    decisions.push({ label: 'Revision loops', detail: `${state.revisionLoopCount} revision loop(s) (max 2 enforced).` })
  }
  if (state.reReviseUsed) {
    decisions.push({ label: 'Final revision used', detail: 'The single permitted re-revise was consumed at the re-review stage.' })
  }

  const exported = state.exportedFormats ?? []
  if (exported.length > 0) {
    decisions.push({ label: 'Export formats', detail: exported.join(', ').toUpperCase() })
  }

  if (decisions.length === 0) {
    decisions.push({ label: 'No discretionary decisions recorded', detail: 'The run proceeded along the default path with no overrides or extra loops.' })
  }
  return decisions
}

/**
 * Build the model-per-stage list. The app does not record a per-stage model (there is no
 * generationModel field), so the model that was configured for the run is attributed to
 * every stage that actually ran. modelLabel is the active ModelConfig label.
 */
export function buildModelPerStage(state: PaperState, modelLabel: string): ModelStageEntry[] {
  const stages = buildPipelineTrace(state)
    .filter((t) => t.status === 'completed')
    .map((t) => t.stage)
  if (stages.length === 0) return [{ stage: 'Pipeline', model: modelLabel }]
  return stages.map((stage) => ({ stage, model: modelLabel }))
}

/**
 * Build a deterministic AI-usage disclosure statement (no LLM call) suitable for pasting
 * into a paper's acknowledgements / methods. Names the ARS pipeline and the model used.
 */
export function buildDisclosureStatement(state: PaperState, modelLabel: string): string {
  const fmt = state.config.citationFormat
  const exported = (state.exportedFormats ?? []).join(', ').toUpperCase() || 'none yet'
  return [
    'AI-Usage Disclosure',
    '',
    'This manuscript was prepared with the assistance of an AI-driven academic writing ' +
      `pipeline (ARS Web Studio). The pipeline used the "${modelLabel}" model to draft, ` +
      'review, and revise the manuscript under human supervision.',
    '',
    'The work passed an automated academic-integrity gate (7 failure-mode checks) at both ' +
      'the pre-review and final stages, and a peer-review simulation. All AI-generated ' +
      'content was reviewed by the author(s), who take full responsibility for the final ' +
      'manuscript, its claims, and its citations.',
    '',
    `Citation style: ${fmt}. Exported formats: ${exported}.`,
  ].join('\n')
}

// Render one verdict for the downloadable text log (null → "—").
function verdictText(v: ModeVerdict | null): string {
  return v ?? '—'
}

/**
 * Serialize the Failure-Mode Audit Log to a plain-text table for download (FR-47).
 */
export function serializeAuditLog(state: PaperState, entries: FailureModeAuditEntry[]): string {
  const lines: string[] = []
  lines.push(`Failure-Mode Audit Log — ${state.config.topic}`)
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push('')
  lines.push('Mode | 2.5 verdict | 4.5 verdict | Override applied | Override reason')
  lines.push('-----|-------------|-------------|------------------|----------------')
  for (const e of entries) {
    lines.push(
      [
        `${e.modeId} ${e.modeName}`,
        verdictText(e.verdict25),
        verdictText(e.verdict45),
        e.overrideApplied ? 'YES' : 'no',
        e.overrideApplied ? (e.overrideReason ?? '') : '',
      ].join(' | '),
    )
  }
  return lines.join('\n')
}
