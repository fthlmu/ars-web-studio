'use client'

// Stage-3' Re-Review page (Phase P14) — the narrow 3-agent verification loop.
//
// Reached from the P13 revise Approve handoff when one revision loop remains
// (revisionLoopCount < 2 → revisionStatus 're-review'). A NARROW panel (EIC + R1 + R2,
// plus DA only if a DA-CRITICAL fired at Stage 3) re-scores the REVISED draft and
// produces an R&R Traceability Matrix + a per-dimension Score Trajectory vs Stage 3.
//
// IRON RULE #2 enforced here (max 2 revision loops / max 1 RE-REVISE) — MECHANICALLY:
//   • "Request Final Revision" renders ONLY when `revisionLoopCount < 2 AND
//     reReviseUsed === false`. Otherwise it is ABSENT FROM THE DOM (not disabled), the
//     loop-cap banner shows "Revision loop cap reached (2 of 2)", and the ONLY forward
//     exit is the final integrity gate.
//   • Nothing auto-advances — the human clicks to move forward.
//
// State machine (mirrors the P11 review / P13 revise pages deliberately):
//   loading           → read saved paper; decide whether this page is even legal
//   running           → runReReview() streaming the narrow re-review
//   awaiting-decision → panel + trajectory shown; the human picks the next move
//   routed            → "Proceed to Final Gate" recorded. P15 (final gate) is not built
//                       yet, so — like P11/P13 — we record the handoff + name the phase
//                       rather than navigating to a dead route.
//   error             → runReReview THREW (API/parse/403); Retry re-runs it.

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ReReviewPanel } from '@/components/pipeline/ReReviewPanel'
import { ScoreTrajectoryTable } from '@/components/pipeline/ScoreTrajectoryTable'
import { runReReview } from '@/lib/ars-client'
import { deriveReviewDecision } from '@/lib/review'
import { loadPaper, savePaper, loadModelConfig } from '@/lib/storage'
import type { PaperState, ModelConfig, ReviewerScoreSet } from '@/lib/types'

type Phase = 'loading' | 'running' | 'awaiting-decision' | 'routed' | 'error'

// The max number of revision loops (FR-05, iron rule 2). Reaching it forces the final gate.
const MAX_REVISION_LOOPS = 2

export default function ReReviewPage() {
  const router = useRouter()

  const [paper, setPaper] = useState<PaperState | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [reReview, setReReview] = useState<ReviewerScoreSet | null>(null)
  const [streamingText, setStreamingText] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // refs (avoid stale closures inside async callbacks; mirror the revise page).
  const isRunningRef = useRef(false)
  const paperRef = useRef<PaperState | null>(null)
  const modelConfigRef = useRef<ModelConfig | undefined>(undefined)

  // ── Persist helper (immutable update + localStorage write) — copied from revise/review. ──
  const persist = useCallback((updater: (prev: PaperState) => PaperState) => {
    if (!paperRef.current) return
    const next = updater(paperRef.current)
    next.updatedAt = new Date().toISOString()
    paperRef.current = next
    setPaper(next)
    savePaper(next)
  }, [])

  // ── Run the narrow re-review over the REVISED draft. ──
  const run = useCallback(async () => {
    if (isRunningRef.current) return
    const p = paperRef.current
    if (!p || !p.revisedDraft || !p.reviewReport) return
    isRunningRef.current = true

    setErrorMessage(null)
    setStreamingText('')
    setReReview(null)
    setPhase('running')
    persist((prev) => ({ ...prev, reReviewStatus: 'running' }))

    try {
      const report = await runReReview(
        p.config,
        p.revisedDraft,
        p.reviewReport,
        p.revisionRoadmap ?? [],
        (chunk) => setStreamingText((prev) => prev + chunk),
        modelConfigRef.current,
      )
      setReReview(report)
      setPhase('awaiting-decision')
      persist((prev) => ({
        ...prev,
        reReviewReport: report,
        reReviewStatus: 'awaiting-decision',
      }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMessage(msg)
      setPhase('error')
      persist((prev) => ({ ...prev, reReviewStatus: 'error' }))
      console.error('Re-review failed to complete:', err)
    } finally {
      isRunningRef.current = false
      setStreamingText('')
    }
  }, [persist])

  // ── Mount: load paper, enforce the re-review precondition, then run/resume. ──
  useEffect(() => {
    if (paperRef.current !== null) return

    const saved = loadPaper()
    if (!saved) {
      router.replace('/intake')
      return
    }

    // Re-review is legal only with a completed revision (a revised draft + the Stage-3 report).
    if (!saved.revisedDraft || !saved.reviewReport) {
      router.replace('/pipeline/revise')
      return
    }
    // …and only once a revision Approve routed here (or we are already mid/post re-review).
    const entered =
      saved.revisionStatus === 're-review' || !!saved.reReviewReport || saved.reReviseUsed === true
    if (!entered) {
      router.replace('/pipeline/revise')
      return
    }

    paperRef.current = saved
    modelConfigRef.current = loadModelConfig()

    queueMicrotask(() => {
      setPaper(saved)
      // Returning to the page: show saved state instead of re-paying for the re-review.
      if (saved.reReviewStatus === 'final-gate') {
        if (saved.reReviewReport) setReReview(saved.reReviewReport)
        setPhase('routed')
      } else if (saved.reReviewStatus === 'awaiting-decision' && saved.reReviewReport) {
        setReReview(saved.reReviewReport)
        setPhase('awaiting-decision')
      } else {
        run()
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Proceed to the Stage-4.5 final integrity gate (always-available forward exit). ──
  const proceedToFinalGate = useCallback(() => {
    persist((prev) => ({ ...prev, reReviewStatus: 'final-gate' }))
    setPhase('routed')
  }, [persist])

  // ── Request one final revision: enter residual coaching (max 5), then the single
  // permitted RE-REVISE. Only reachable when the cap allows it (guarded in render). ──
  const requestFinalRevision = useCallback(() => {
    // Reset the residual-coaching thread so a fresh dialogue opens at maxRounds=5.
    persist((prev) => ({
      ...prev,
      residualCoachingThread: [],
      residualCoachingRoundCount: 0,
      residualCoachingStatus: 'idle',
    }))
    router.push('/pipeline/coaching?stage=re-review')
  }, [persist, router])

  // ─── Render ─────────────────────────────────────────────────────────────────────

  if (phase === 'loading' || !paper) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading re-review…</p>
      </div>
    )
  }

  // The binding decision from the re-review report (single source of truth).
  const decision = reReview ? deriveReviewDecision(reReview) : null

  // IRON RULE #2: a further revision loop is offered ONLY when one loop still remains
  // AND the single RE-REVISE has not been used. Both conditions are required.
  const loopCount = paper.revisionLoopCount ?? 0
  const canRequestFinalRevision = loopCount < MAX_REVISION_LOOPS && paper.reReviseUsed !== true
  // After the cap, the forward action is "Confirm Content Frozen" (post re-revise) rather
  // than a plain Accept — but it is the SAME advance to the final gate either way.
  const frozenLabel = paper.reReviseUsed === true

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-8 sm:py-8">

        {/* ── Header ── */}
        <div>
          <h1 className="text-2xl font-bold mb-1 truncate">{paper.config.topic}</h1>
          <p className="text-sm text-muted-foreground">
            Stage 3′ — Re-Review ·{' '}
            {paper.config.paperType.replace('_', ' ').toUpperCase()} ·{' '}
            Revision loop {Math.min(loopCount, MAX_REVISION_LOOPS)} of {MAX_REVISION_LOOPS}
          </p>
        </div>

        {/* ── ERROR: re-review could not complete. Retry re-runs it. ── */}
        {phase === 'error' && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-5 space-y-3">
            <p className="font-semibold text-destructive">Re-review failed to complete. Retry?</p>
            {errorMessage && <p className="text-sm text-muted-foreground">{errorMessage}</p>}
            <p className="text-xs text-muted-foreground">
              Your revised draft and original review are preserved — retrying re-runs only the re-review.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button data-testid="re-review-retry" onClick={() => run()}>Retry re-review</Button>
              <Button variant="outline" onClick={() => router.push('/pipeline')}>Back to pipeline</Button>
            </div>
          </div>
        )}

        {/* ── RUNNING: the narrow panel re-scores the revised paper. ── */}
        {phase === 'running' && (
          <div className="space-y-4">
            <p className="text-sm font-medium">Re-reviewing the revised paper (narrow panel)…</p>
            <div
              aria-live="polite"
              aria-busy="true"
              className="max-h-64 overflow-y-auto rounded-md border bg-muted/30 p-3 text-xs leading-relaxed whitespace-pre-wrap text-foreground/80"
            >
              {streamingText || 'Waiting for the re-review panel…'}
            </div>
          </div>
        )}

        {/* ── AWAITING DECISION: panel + score trajectory + the (guarded) routing buttons. ── */}
        {phase === 'awaiting-decision' && reReview && decision && paper.reviewReport && (
          <div className="space-y-6">
            <ReReviewPanel reReview={reReview} stage3={paper.reviewReport} decision={decision} />

            {reReview.scoreTrajectory && reReview.scoreTrajectory.length > 0 && (
              <ScoreTrajectoryTable trajectory={reReview.scoreTrajectory} />
            )}

            <div className="rounded-lg border bg-card p-5 space-y-4">
              {/* Loop-cap banner: shown when no further revision loop is permitted. */}
              {!canRequestFinalRevision && (
                <div
                  role="status"
                  data-testid="loop-cap-banner"
                  className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
                >
                  <span className="font-semibold">Revision loop cap reached ({MAX_REVISION_LOOPS} of {MAX_REVISION_LOOPS}).</span>{' '}
                  No further revision loop is permitted. The only remaining step is the
                  zero-tolerance Final Integrity Gate (Stage 4.5).
                </div>
              )}

              <div>
                <p className="font-semibold">What next?</p>
                <p className="text-sm text-muted-foreground">{decision.reason}</p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {/* Proceed to the final gate — ALWAYS available (the forward exit). The label
                    becomes "Confirm Content Frozen" once the single re-revise has been used. */}
                <Button
                  type="button"
                  data-testid="re-review-proceed-final-gate"
                  onClick={proceedToFinalGate}
                >
                  {frozenLabel
                    ? 'Confirm Content Frozen — Advance to Final Integrity Gate'
                    : 'Accept — Proceed to Final Integrity Gate'}
                </Button>

                {/* Request Final Revision — IRON RULE #2: rendered ONLY when a loop remains
                    AND the single re-revise is unused. Otherwise ABSENT FROM THE DOM. */}
                {canRequestFinalRevision && (
                  <Button
                    type="button"
                    variant="outline"
                    data-testid="re-review-request-final-revision"
                    onClick={requestFinalRevision}
                  >
                    Request Final Revision — Enter Residual Coaching
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── ROUTED: record the final-gate handoff + name Stage 4.5 (P15 not built yet, so
            we do NOT navigate to a non-existent route — mirrors review/revise). ── */}
        {phase === 'routed' && (
          <div
            role="status"
            className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20 p-5 space-y-3"
          >
            <p className="font-semibold text-green-800 dark:text-green-200">
              {frozenLabel
                ? 'Content frozen — advancing to the Final Integrity Gate (Stage 4.5)'
                : 'Re-review accepted — advancing to the Final Integrity Gate (Stage 4.5)'}
            </p>
            <p className="text-sm text-green-700 dark:text-green-300">
              The only remaining step is the zero-tolerance final integrity gate; your revised
              draft and re-review are saved. {frozenLabel
                ? `Both permitted revision loops have been used (${MAX_REVISION_LOOPS} of ${MAX_REVISION_LOOPS}).`
                : ''}
            </p>
            <div className="flex flex-col items-start gap-2 sm:flex-row">
              <Button data-testid="enter-final-gate" onClick={() => router.push('/pipeline/final-integrity')}>
                Continue to Final Integrity Gate →
              </Button>
              <Button variant="outline" onClick={() => router.push('/pipeline')}>Back to pipeline</Button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
