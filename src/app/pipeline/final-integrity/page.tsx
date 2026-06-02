'use client'

// Stage-4.5 FINAL Integrity Gate page (Phase P15) — the ZERO-TOLERANCE iron-rule gate
// and the last interlock before export.
//
// EE analogy: this is the final lockout/tagout before the line is energized for real.
// Unlike the Stage-2.5 bench-test interlock (which you could jumper with a bounded
// override), there are NO jumpers here. The integrity_verification_agent re-runs the 7
// fault detectors (M1..M7) on the now-final draft; if ANY mode is not CLEAR the breaker
// stays open — the export control is ABSENT from the DOM (not disabled), and there is
// NO override, acknowledge, or skip control anywhere on the screen.
//
// Both export paths converge here:
//   • P11 Accept            → /pipeline/review records reviewDecision='Accept' → here
//   • P13/P14 post-revision → revise/re-review record *Status='final-gate' → here
// Whichever path arrived, the SAME zero-tolerance rule (final-integrity.ts) applies.
//
// State machine (mirrors the P10 integrity page deliberately):
//   loading         → read saved paper from localStorage
//   running         → runFinalGate() streaming the agent; text shown live
//   awaiting-review → report parsed; render FinalIntegrityGateReport + the verdict
//                     PASS → an enabled "Proceed to Finalize" export control
//                     FAIL → NO export control; only "Re-run" + "Return to Editor"
//   passed          → export-ready committed; in-page confirmation
//   error           → runFinalGate THREW (API/parse, NOT a FAIL verdict); EH-05 retry,
//                     export control stays absent, pipelineStatus stays running-final-gate
//
// IMPORTANT: a FAIL *verdict* is NOT the 'error' phase. A FAIL is a successful run whose
// result blocks; only a thrown exception is 'error' (EH-05).

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { FinalIntegrityGateReport } from '@/components/pipeline/FinalIntegrityGateReport'
import { buildPaperDraft, runFinalGate } from '@/lib/ars-client'
import {
  deriveFinalGateDecision,
  buildModeComparison,
  latestStage25Report,
} from '@/lib/final-integrity'
import { loadPaper, savePaper, loadModelConfig } from '@/lib/storage'
import type { PaperState, ModelConfig, IntegrityReport, ComplianceEntry } from '@/lib/types'

// The agent id recorded in the compliance log for the user's final-gate sign-off.
const USER_AGENT_ID = 'user'

type Phase = 'loading' | 'running' | 'awaiting-review' | 'passed' | 'error'

export default function FinalIntegrityPage() {
  const router = useRouter()

  const [paper, setPaper] = useState<PaperState | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [report, setReport] = useState<IntegrityReport | null>(null)
  const [streamingText, setStreamingText] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // refs (avoid stale closures inside async callbacks; mirror the integrity page).
  const isRunningRef = useRef(false)
  const paperRef = useRef<PaperState | null>(null)
  const modelConfigRef = useRef<ModelConfig | undefined>(undefined)

  // Persist helper (immutable update + localStorage write).
  const persist = useCallback((updater: (prev: PaperState) => PaperState) => {
    if (!paperRef.current) return
    const next = updater(paperRef.current)
    next.updatedAt = new Date().toISOString()
    paperRef.current = next
    setPaper(next)
    savePaper(next)
  }, [])

  // ─── Run the final gate (fresh run; also the EH-05 retry path) ──────────────────
  const startGate = useCallback(async () => {
    if (isRunningRef.current) return
    if (!paperRef.current) return
    isRunningRef.current = true

    setErrorMessage(null)
    setReport(null)
    setStreamingText('')
    setPhase('running')
    // While running, the paper is NOT export-ready — pin the high-level phase so a
    // mid-run reload never looks export-ready (EH-09: no export-ready edge from a non-PASS).
    persist((prev) => ({
      ...prev,
      finalIntegrityStatus: 'running',
      pipelineStatus: 'running-final-gate',
    }))

    try {
      const draft = buildPaperDraft(paperRef.current)
      const result = await runFinalGate(
        draft,
        paperRef.current.config,
        (chunk) => setStreamingText((prev) => prev + chunk),
        modelConfigRef.current,
      )

      // The run completed and parsed (regardless of PASS/FAIL). Record the 4.5 report
      // (append to the shared integrityReports list — it carries stage '4.5'), and set
      // the 4.5 status from the BINDING decision. A FAIL is 'failed' (a blocking verdict),
      // not 'error' (a thrown exception). pipelineStatus stays running-final-gate until a
      // PASS is committed — there is NO export-ready edge from a FAIL (EH-09).
      const decision = deriveFinalGateDecision(result)
      setReport(result)
      setPhase('awaiting-review')
      persist((prev) => ({
        ...prev,
        integrityReports: [...(prev.integrityReports ?? []), result],
        finalIntegrityStatus: decision.kind === 'FAIL' ? 'failed' : 'awaiting-review',
      }))
    } catch (err) {
      // EH-05: a THROWN error means the check could not complete (API/server/parse).
      // This is NOT a FAIL verdict — the export control stays absent and we can re-run.
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMessage(msg)
      setPhase('error')
      persist((prev) => ({ ...prev, finalIntegrityStatus: 'error' }))
      console.error('Final integrity gate failed to complete:', err)
    } finally {
      isRunningRef.current = false
      setStreamingText('')
    }
  }, [persist])

  // ─── Mount: load paper, then run the gate ───────────────────────────────────────
  useEffect(() => {
    if (paperRef.current !== null) return

    const saved = loadPaper()
    if (!saved || saved.sections.length === 0) {
      router.replace('/pipeline')
      return
    }

    paperRef.current = saved
    modelConfigRef.current = loadModelConfig()

    queueMicrotask(() => {
      setPaper(saved)
      // Every visit re-runs the check against the CURRENT draft (it can change between
      // visits via the editor). Re-running is the ONLY way past a FAIL (edit → re-run).
      startGate()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Commit a PASS → export-ready (the ONLY edge that sets export-ready) ─────────
  const commitPass = useCallback(() => {
    if (!report) return
    const nowIso = new Date().toISOString()
    const entry: ComplianceEntry = {
      timestamp: nowIso,
      action: 'integrity_pass',
      agentId: USER_AGENT_ID,
    }
    persist((prev) => ({
      ...prev,
      finalIntegrityPassDate: nowIso,
      finalIntegrityStatus: 'passed',
      pipelineStatus: 'export-ready',
      complianceHistory: [...(prev.complianceHistory ?? []), entry],
    }))
    setPhase('passed')
  }, [report, persist])

  // ─── Render ─────────────────────────────────────────────────────────────────────
  if (phase === 'loading' || !paper) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading final integrity gate…</p>
      </div>
    )
  }

  // Derive the BINDING zero-tolerance decision + the 2.5→4.5 comparison once, here.
  const decision = report ? deriveFinalGateDecision(report) : null
  const comparison = report
    ? buildModeComparison(report, latestStage25Report(paper.integrityReports))
    : []

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-8 sm:py-8">

        {/* ── Header ── */}
        <div>
          <h1 className="text-2xl font-bold mb-1 truncate">{paper.config.topic}</h1>
          <p className="text-sm text-muted-foreground">
            Stage 4.5 — Final Integrity Gate (zero-tolerance) ·{' '}
            {paper.config.paperType.replace('_', ' ').toUpperCase()} ·{' '}
            {paper.config.citationFormat}
          </p>
        </div>

        {/* ── ERROR (EH-05): the check could not COMPLETE (API/parse threw). ──
            NOT a FAIL verdict — the export control stays absent, the only action is re-run. */}
        {phase === 'error' && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-5 space-y-3">
            <p className="font-semibold text-destructive">
              Final integrity check could not complete. Retry?
            </p>
            {errorMessage && <p className="text-sm text-muted-foreground">{errorMessage}</p>}
            <p className="text-xs text-muted-foreground">
              The verification agent did not return a usable report (a network or format
              error, not a content failure). Your draft is unchanged and is not export-ready.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button onClick={startGate}>Retry final integrity check</Button>
              <Button variant="outline" onClick={() => router.push('/pipeline')}>
                Back to pipeline
              </Button>
            </div>
          </div>
        )}

        {/* ── RUNNING: live streaming output from the verification agent. ── */}
        {phase === 'running' && (
          <div className="rounded-lg border bg-card p-5 space-y-3">
            <p className="font-semibold">Running final integrity verification…</p>
            <p className="text-sm text-muted-foreground">
              The agent is re-checking the final draft against the 7 failure modes (M1–M7)
              at zero tolerance. Nothing advances automatically — and there is no way to
              bypass this gate.
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

        {/* ── AWAITING REVIEW: the report is ready. ── */}
        {phase === 'awaiting-review' && report && decision && (
          <div className="space-y-6">
            <FinalIntegrityGateReport
              report={report}
              decision={decision}
              comparison={comparison}
            />

            {/* PASS: the SINGLE export affordance. data-testid="export-button" so the
                blocking-gate DOM test can assert it is ABSENT on any non-PASS verdict. */}
            {decision.kind === 'PASS' && (
              <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20 p-5 space-y-3">
                <p className="font-semibold text-green-800 dark:text-green-200">
                  Cleared the zero-tolerance final gate.
                </p>
                <p className="text-sm text-green-700 dark:text-green-300">
                  Every failure mode reads CLEAR. The paper is now export-ready; proceed to
                  finalize and export.
                </p>
                <div className="flex flex-col items-start gap-2 sm:flex-row">
                  <Button data-testid="export-button" onClick={commitPass}>
                    Proceed to Finalize →
                  </Button>
                  <Button variant="outline" onClick={() => router.push('/pipeline')}>
                    Back to pipeline
                  </Button>
                </div>
              </div>
            )}

            {/* FAIL: zero-tolerance block. There is NO export control, NO override, NO
                acknowledge, NO skip — only re-run and return-to-editor (FR-39/FR-40). */}
            {decision.kind === 'FAIL' && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5 space-y-3">
                <p className="font-semibold text-destructive">What to do next</p>
                <p className="text-sm text-muted-foreground">
                  Export is blocked. There is no override at this gate. Edit the flagged
                  content to clear every failure mode (supply the missing run logs / raw
                  data, fix citations, or remove unverifiable claims), then re-run this check.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button data-testid="rerun-final-integrity" onClick={startGate}>
                    Re-run Final Integrity Check
                  </Button>
                  <Button
                    data-testid="return-to-editor"
                    variant="outline"
                    onClick={() => router.push('/editor')}
                  >
                    Return to Editor
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── PASSED: export-ready committed. ── */}
        {phase === 'passed' && (
          <div
            role="status"
            className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20 p-5 text-center space-y-3"
          >
            <p className="font-semibold text-green-800 dark:text-green-200">
              Final Integrity Gate PASSED — paper is export-ready
            </p>
            <p className="text-sm text-green-700 dark:text-green-300">
              Your draft cleared the zero-tolerance Stage 4.5 gate; this sign-off is recorded
              in the compliance log. Finalize and export are now available.
            </p>
            <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
              <Button
                data-testid="proceed-to-finalize"
                onClick={() => router.push('/pipeline/finalize')}
              >
                Proceed to Finalize
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
