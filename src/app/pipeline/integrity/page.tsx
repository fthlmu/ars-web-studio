'use client'

// Stage-2.5 Integrity Gate page (Phase P10) — the FIRST blocking iron-rule gate.
//
// EE analogy: this is the protection relay sitting between the draft (the energized
// bus) and peer review (the load). Before the draft is allowed downstream, the
// integrity_verification_agent runs 7 fault detectors (M1..M7). Some are hard
// interlocks (M1/M3/M5/M6) and some are soft alarms (M2/M4/M7). The relay trips
// (FAIL) and the breaker physically stays open — the "proceed" control is ABSENT
// from the DOM, not merely disabled (FR-18). Nothing auto-advances: even on a PASS,
// the human must click "Proceed to Peer Review" (no silent advance).
//
// State machine (mirrors the P9 research page deliberately):
//   loading         → reading saved paper from localStorage, deciding what to do
//   running         → runIntegrityGate() is streaming the agent; text shown live
//   awaiting-review → report parsed; render IntegrityGateReport + the gate decision
//   passed          → user signed off (PASS / acknowledged CONDITIONS / override);
//                     show the in-page "PASSED — Stage 3 is built in P11" confirmation
//   error           → runIntegrityGate THREW (API/parse failure, NOT a FAIL verdict);
//                     offer a Retry that re-runs the gate (EH-02)
//
// IMPORTANT: a FAIL *verdict* is NOT the 'error' phase. A FAIL is a successful run
// whose result happens to block — it renders in 'awaiting-review' with the proceed
// control absent + "edit & re-run" guidance. Only a thrown exception is 'error'.

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { IntegrityGateReport } from '@/components/pipeline/IntegrityGateReport'
import { IntegrityOverride } from '@/components/pipeline/IntegrityOverride'
import { buildPaperDraft, runIntegrityGate } from '@/lib/ars-client'
import { deriveGateDecision } from '@/lib/integrity'
import { loadPaper, savePaper, loadModelConfig } from '@/lib/storage'
import type {
  PaperState,
  ModelConfig,
  IntegrityReport,
  ComplianceEntry,
  FailureModeId,
} from '@/lib/types'

// The stage this page runs. The SAME runIntegrityGate is reused at '4.5' in P15;
// here we are always the pre-review gate (2.5). Named so it never gets hard-coded
// inline in two places (single source of the stage string for this page).
const STAGE_25 = '2.5' as const

// The agent id we record in the compliance log for actions the user takes here.
// (The integrity *findings* come from the verification agent; the user's sign-off /
// override are recorded under the human/user actor.)
const USER_AGENT_ID = 'user'

// ─── Page-level UI state machine ─────────────────────────────────────────────────
// A simple enum-like union (like a state register in a controller). Each value
// drives which block renders below.
type Phase =
  | 'loading'
  | 'running'
  | 'awaiting-review'
  | 'passed'
  | 'error'

// ─── Component ────────────────────────────────────────────────────────────────────

export default function IntegrityPage() {
  const router = useRouter()

  // The full paper state (config + draft + integrity results). Single source of truth.
  const [paper, setPaper] = useState<PaperState | null>(null)

  // Which top-level phase the page is in (see Phase union above).
  const [phase, setPhase] = useState<Phase>('loading')

  // The parsed integrity report, shown once the agent run completes.
  const [report, setReport] = useState<IntegrityReport | null>(null)

  // Live streaming text from the agent while it runs (aria-live region below).
  const [streamingText, setStreamingText] = useState('')

  // Error banner text. Drives the EH-02 "failed to complete. Retry?" state. Only set
  // when runIntegrityGate THROWS (not when the verdict is FAIL).
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // ── refs (avoid stale closures inside async callbacks; mirror the research page) ──

  // Generation lock — prevents two runIntegrityGate() loops at once.
  const isRunningRef = useRef(false)

  // StrictMode double-mount guard. In dev, React runs the mount effect twice; the
  // second run sees this !== null and exits, so the gate never double-runs.
  const paperRef = useRef<PaperState | null>(null)

  // Latest model choice — loaded once on mount, passed to runIntegrityGate.
  const modelConfigRef = useRef<ModelConfig | undefined>(undefined)

  // ─── Persist helper (immutable update + localStorage write) ─────────────────────
  // Mirrors the research page: update the ref, mirror to state, then save. Every
  // write stamps updatedAt with the same now-to-ISO call storage / research use.
  const persist = useCallback((updater: (prev: PaperState) => PaperState) => {
    if (!paperRef.current) return
    const next = updater(paperRef.current)
    next.updatedAt = new Date().toISOString()
    paperRef.current = next
    setPaper(next)
    savePaper(next)
  }, [])

  // ─── Run the integrity gate (fresh run; also the EH-02 retry path) ──────────────
  // Builds the Schema-4 draft from the current sections, then streams the
  // integrity_verification_agent and parses the Schema-5 report. A thrown error
  // (API/parse) → 'error' (EH-02 retry). A FAIL *verdict* is a normal result that
  // simply renders with the proceed control absent.
  const startGate = useCallback(async () => {
    if (isRunningRef.current) return
    if (!paperRef.current) return
    isRunningRef.current = true

    // Reset error/stream UI for this attempt and flip the persisted status to running.
    setErrorMessage(null)
    setReport(null)
    setStreamingText('')
    setPhase('running')
    persist((prev) => ({ ...prev, integrityStatus: 'running' }))

    try {
      // Schema-4 draft assembled from the saved sections (word counts, material-gap
      // tags, etc.). runIntegrityGate embeds this + the output contract for the agent.
      const draft = buildPaperDraft(paperRef.current)

      const result = await runIntegrityGate(
        draft,
        paperRef.current.config,
        STAGE_25,
        // onChunk: append each streamed token to the live panel.
        (chunk) => setStreamingText((prev) => prev + chunk),
        modelConfigRef.current,
      )

      // ── Success (the run completed and parsed — regardless of PASS/FAIL verdict). ──
      // Record the report, flip to awaiting-review, and persist it (push onto the
      // append-only integrityReports list). The gate DECISION is derived at render
      // time via deriveGateDecision(report) — the single source of truth.
      setReport(result)
      setPhase('awaiting-review')
      persist((prev) => ({
        ...prev,
        integrityReports: [...(prev.integrityReports ?? []), result],
        integrityStatus: 'awaiting-review',
      }))
    } catch (err) {
      // EH-02: a THROWN error means the check could not complete (API/server failure,
      // or schema5 still incomplete after the one in-client retry). This is NOT a FAIL
      // verdict — we stay able to re-run from this same page via the Retry button.
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMessage(msg)
      setPhase('error')
      persist((prev) => ({ ...prev, integrityStatus: 'error' }))
      console.error('Integrity gate failed to complete:', err)
    } finally {
      isRunningRef.current = false
      setStreamingText('')
    }
  }, [persist])

  // ─── Mount: load paper, then run the gate ───────────────────────────────────────
  useEffect(() => {
    // StrictMode guard: paperRef is set below before any async work. The second
    // (dev-only) effect run sees it non-null and bails, preventing a double-run.
    if (paperRef.current !== null) return

    const saved = loadPaper()
    if (!saved) {
      router.replace('/intake')
      return
    }

    paperRef.current = saved
    modelConfigRef.current = loadModelConfig()

    queueMicrotask(() => {
      setPaper(saved)
      // No FR-04-style skip here: every visit to the gate re-runs the check against
      // the CURRENT draft (the draft can change between visits via the editor). The
      // section-review gate on the pipeline page is what gates entry to this page.
      startGate()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Commit a PASS (PASS / acknowledged CONDITIONS / submitted override) ────────
  // Shared by all three proceed paths. `override` carries the reason ONLY when the
  // user came through the bounded-override control; otherwise it stays undefined.
  // Persists: push the (possibly override-stamped) report, stamp integrityPassDate,
  // append the compliance entries, flip integrityStatus → 'passed', show confirmation.
  const commitPass = useCallback(
    (override?: { reason: string; modes: FailureModeId[] }) => {
      if (!report) return
      const nowIso = new Date().toISOString()

      // If this is an override, stamp the reason onto the report we store so the
      // saved report carries why it was allowed through (contract: report.overrideReason).
      const storedReport: IntegrityReport = override
        ? { ...report, overrideReason: override.reason }
        : report

      // Compliance entries are append-only (never rewritten). Every PASS records an
      // 'integrity_pass'; an override ALSO records a separate 'override' entry whose
      // reason is REQUIRED (the permanent rationale). Order: pass first, override second.
      const entries: ComplianceEntry[] = [
        { timestamp: nowIso, action: 'integrity_pass', agentId: USER_AGENT_ID },
      ]
      if (override) {
        entries.push({
          timestamp: nowIso,
          action: 'override',
          agentId: USER_AGENT_ID,
          reason: override.reason,
        })
      }

      persist((prev) => ({
        ...prev,
        // Push the (override-stamped) report so the saved trail reflects what was
        // signed off. We append rather than replace to keep the full run history.
        integrityReports: [...(prev.integrityReports ?? []), storedReport],
        integrityPassDate: nowIso,
        complianceHistory: [...(prev.complianceHistory ?? []), ...entries],
        integrityStatus: 'passed',
      }))

      setReport(storedReport)
      setPhase('passed')
    },
    [report, persist],
  )

  // PASS / PASS_WITH_CONDITIONS (acknowledged) proceed handler — no override reason.
  const handleProceed = useCallback(() => {
    commitPass()
  }, [commitPass])

  // BOUNDED_OVERRIDE proceed handler — carries the written reason + which soft modes
  // were overridden (for the permanent log). Wired into the IntegrityOverride control.
  const handleOverride = useCallback(
    (reason: string, modes: FailureModeId[]) => {
      commitPass({ reason, modes })
    },
    [commitPass],
  )

  // ─── Render ─────────────────────────────────────────────────────────────────────

  // Loading / redirect-in-progress: nothing meaningful to show yet.
  if (phase === 'loading' || !paper) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading integrity gate…</p>
      </div>
    )
  }

  // Derive the BINDING gate decision once, here, from the report (single source of
  // truth). Only meaningful in awaiting-review/passed; null otherwise.
  const decision = report ? deriveGateDecision(report) : null

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-8 sm:py-8">

        {/* ── Header ── */}
        <div>
          <h1 className="text-2xl font-bold mb-1 truncate">{paper.config.topic}</h1>
          <p className="text-sm text-muted-foreground">
            Stage 2.5 — Integrity Gate ·{' '}
            {paper.config.paperType.replace('_', ' ').toUpperCase()} ·{' '}
            {paper.config.citationFormat}
          </p>
        </div>

        {/* ── ERROR (EH-02): the check could not COMPLETE (API/parse threw). ──
            This is NOT a FAIL verdict — it means the gate never produced a report,
            so the only sensible action is to re-run it. */}
        {phase === 'error' && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-5 space-y-3">
            <p className="font-semibold text-destructive">
              Integrity check failed to complete. Retry?
            </p>
            {errorMessage && (
              <p className="text-sm text-muted-foreground">{errorMessage}</p>
            )}
            <p className="text-xs text-muted-foreground">
              The verification agent did not return a usable report (a network or
              format error, not a content failure). Your draft is unchanged.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button onClick={startGate}>Retry integrity check</Button>
              <Button variant="outline" onClick={() => router.push('/pipeline')}>
                Back to pipeline
              </Button>
            </div>
          </div>
        )}

        {/* ── RUNNING: live streaming output from the verification agent. ──
            aria-live="polite" so assistive tech announces the streamed text. */}
        {phase === 'running' && (
          <div className="rounded-lg border bg-card p-5 space-y-3">
            <p className="font-semibold">Running integrity verification…</p>
            <p className="text-sm text-muted-foreground">
              The agent is checking the draft against the 7 failure modes (M1–M7).
              Nothing advances automatically — you will review the result before any
              proceed control appears.
            </p>
            <div
              aria-live="polite"
              aria-busy="true"
              className="max-h-64 overflow-y-auto rounded-md border bg-muted/30 p-3 text-xs leading-relaxed whitespace-pre-wrap text-foreground/80"
            >
              {streamingText || 'Waiting for the first response…'}
            </div>
          </div>
        )}

        {/* ── AWAITING REVIEW: the report is ready. ──
            The report component is fully verdict-gated by `decision`:
              • FAIL → proceed control ABSENT; we ALSO render the "edit & re-run"
                guidance + a Re-run button + a link to the editor below.
              • PASS → enabled proceed button (Proceed to Peer Review).
              • PASS_WITH_CONDITIONS → acknowledge checkbox gates the button.
              • BOUNDED_OVERRIDE → the IntegrityOverride control (passed as children). */}
        {phase === 'awaiting-review' && report && decision && (
          <div className="space-y-6">
            <IntegrityGateReport
              report={report}
              decision={decision}
              onProceed={handleProceed}
            >
              {/* Only rendered (and only reached) when kind === 'BOUNDED_OVERRIDE'.
                  The report component places these children where the plain proceed
                  button would otherwise go. We map its onOverride → commitPass with
                  the reason + the eligible soft modes for the permanent log. */}
              {decision.kind === 'BOUNDED_OVERRIDE' && (
                <IntegrityOverride
                  eligibleModes={decision.overrideEligibleModes}
                  onOverride={(reason) =>
                    handleOverride(reason, decision.overrideEligibleModes)
                  }
                />
              )}
            </IntegrityGateReport>

            {/* FAIL guidance: the proceed control is absent (the iron rule). The path
                forward is to edit the flagged content and re-run the same check. */}
            {decision.kind === 'FAIL' && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5 space-y-3">
                <p className="font-semibold text-destructive">What to do next</p>
                <p className="text-sm text-muted-foreground">
                  The gate is blocked. Edit the flagged sections to fix the integrity
                  problems (add the missing run logs / raw data, correct citations, or
                  remove the unverifiable claims), then re-run this check.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button onClick={startGate}>Re-run Integrity Check</Button>
                  <Button variant="outline" onClick={() => router.push('/editor')}>
                    Edit sections
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── PASSED: in-page confirmation. ──
            Stage 3 (Peer Review) is built in P11 — there is NO /pipeline/review route
            yet, so we do NOT navigate. The button carries the contract data-testid so
            the test harness can assert the proceed affordance exists on a PASS. */}
        {phase === 'passed' && (
          <div
            role="status"
            className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20 p-5 text-center space-y-3"
          >
            <p className="font-semibold text-green-800 dark:text-green-200">
              Integrity Gate PASSED — Stage 3 (Peer Review) is built in P11
            </p>
            <p className="text-sm text-green-700 dark:text-green-300">
              Your draft cleared the Stage 2.5 integrity gate. The next stage (peer
              review) is not built yet; this sign-off is recorded in the compliance log.
            </p>
            <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
              {/* No navigation target (P11 not built). Disabled, but present so the
                  PASS state still exposes the canonical proceed affordance. */}
              <Button data-testid="proceed-to-review" disabled>
                Proceed to Peer Review
              </Button>
              <Button variant="outline" onClick={() => router.push('/pipeline')}>
                Back to pipeline
              </Button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
