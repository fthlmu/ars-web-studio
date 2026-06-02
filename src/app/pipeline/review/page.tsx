'use client'

// Stage-3 Peer Review page (Phase P11) — the Sprint-Contract editorial board.
//
// EE analogy: think of this like a two-pass calibration before a measurement is
// trusted. PASS 1 (paper-blind) the reviewers commit a scoring plan WITHOUT seeing
// the device under test — so the rubric can't be tuned to flatter the result. PASS 2
// (paper-visible) the same board measures the paper against that committed plan and
// reports five reviewer scorecards + a consensus + an editorial decision.
//
// Iron-rule context: this page is reachable ONLY for a 2.5-PASS draft. If the paper
// never cleared the Stage-2.5 integrity gate (no integrityPassDate), we bounce back
// to /pipeline/integrity — the client mirror of the server's IR-03 403 guard.
//
// State machine (mirrors the P10 integrity page deliberately):
//   loading          → read saved paper; decide whether this page is even legal
//   running-phase1   → runReviewPhase1() streaming the PAPER-BLIND scoring plan (Schema 13)
//   running-phase2   → runReviewPhase2() streaming the PAPER-VISIBLE review report (Schema 6)
//   awaiting-decision→ report parsed; render the 5-reviewer panel + the editorial routing buttons
//   decided          → the user chose Accept / Request Revision / Reject (no auto-advance)
//   error            → a phase THREW (API/parse/403); offer a Retry that resumes the FAILED
//                      phase only (a Phase-2 retry must NOT re-run the blind Phase 1) — EH-03
//
// NOTE: the next stages (P12 coaching, P15 final integrity gate) are not built yet, so the
// 'decided' confirmations record the choice + name the next phase rather than navigating —
// exactly how the P10 integrity page handled "Stage 3 not built yet".

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { SprintContractIndicator } from '@/components/pipeline/SprintContractIndicator'
import { PeerReviewReport } from '@/components/pipeline/PeerReviewReport'
import { runReviewPhase1, runReviewPhase2, buildPaperDraft } from '@/lib/ars-client'
import { deriveReviewDecision } from '@/lib/review'
import { loadPaper, savePaper, loadModelConfig } from '@/lib/storage'
import type {
  PaperState,
  ModelConfig,
  ScoringPlan,
  ReviewerScoreSet,
  EditorialDecision,
} from '@/lib/types'

// ─── Page-level UI state machine ─────────────────────────────────────────────────
type Phase =
  | 'loading'
  | 'running-phase1'
  | 'running-phase2'
  | 'awaiting-decision'
  | 'decided'
  | 'error'

// Which Sprint-Contract phase failed, so the Retry resumes the RIGHT one (EH-03).
type FailedPhase = 'phase1' | 'phase2'

// ─── Component ────────────────────────────────────────────────────────────────────

export default function ReviewPage() {
  const router = useRouter()

  // The full paper state (config + draft + research + integrity + review). SSOT.
  const [paper, setPaper] = useState<PaperState | null>(null)

  // Which top-level phase the page is in (see Phase union above).
  const [phase, setPhase] = useState<Phase>('loading')

  // The parsed 5-reviewer review report, shown once Phase 2 completes.
  const [review, setReview] = useState<ReviewerScoreSet | null>(null)

  // Live streaming text from whichever review phase is running (aria-live region).
  const [streamingText, setStreamingText] = useState('')

  // Error banner text. Drives the EH-03 "failed to complete. Retry?" state. Only set
  // when a review phase THROWS (network / parse / IR-03 403) — never on a normal result.
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // ── refs (avoid stale closures inside async callbacks; mirror the integrity page) ──

  // Generation lock — prevents two review loops running at once.
  const isRunningRef = useRef(false)

  // StrictMode double-mount guard: set before any async work, so the dev-only second
  // mount effect sees it non-null and bails (the review never double-runs).
  const paperRef = useRef<PaperState | null>(null)

  // Latest model choice — loaded once on mount, passed to both review phases.
  const modelConfigRef = useRef<ModelConfig | undefined>(undefined)

  // Which phase to resume on Retry. State (not a ref) because it is read during render
  // (the error banner copy) and in the Retry click handler — refs must not be read in render.
  const [failedPhase, setFailedPhase] = useState<FailedPhase>('phase1')

  // ─── Persist helper (immutable update + localStorage write) ─────────────────────
  // Copied from the integrity page: update the ref, mirror to state, then save. Every
  // write stamps updatedAt with the same now-to-ISO call storage / the other pages use.
  const persist = useCallback((updater: (prev: PaperState) => PaperState) => {
    if (!paperRef.current) return
    const next = updater(paperRef.current)
    next.updatedAt = new Date().toISOString()
    paperRef.current = next
    setPaper(next)
    savePaper(next)
  }, [])

  // ─── Run the review (fresh run starts at phase1; the Retry path resumes a phase) ──
  // `start` selects the entry point: 'phase1' runs the blind pre-commitment THEN phase2;
  // 'phase2' reuses the already-committed scoringPlan and re-runs ONLY phase2 (EH-03 —
  // a Phase-2 failure must not discard the blind Phase-1 commitment).
  const runFrom = useCallback(
    async (start: FailedPhase) => {
      if (isRunningRef.current) return
      if (!paperRef.current) return
      isRunningRef.current = true

      setErrorMessage(null)
      setReview(null)
      setStreamingText('')

      try {
        // The committed plan we score against. Seeded from any persisted plan so a
        // phase-2-only retry has something to use without re-running phase 1.
        let plan: ScoringPlan | undefined = paperRef.current.scoringPlan

        // ── PASS 1 (paper-blind) — only when starting fresh ──
        if (start === 'phase1') {
          setFailedPhase('phase1')
          setPhase('running-phase1')
          persist((prev) => ({ ...prev, reviewStatus: 'running-phase1' }))

          plan = await runReviewPhase1(
            paperRef.current.config,
            (chunk) => setStreamingText((prev) => prev + chunk),
            modelConfigRef.current,
          )

          // Persist the committed plan immediately so a later phase-2 retry can reuse it.
          const committedPlan = plan
          persist((prev) => ({
            ...prev,
            scoringPlan: committedPlan,
            reviewStatus: 'running-phase2',
          }))
        }

        // A phase-2 retry with no committed plan can't proceed — fall back to phase 1.
        if (!plan) {
          setFailedPhase('phase1')
          throw new Error('No committed scoring plan found — re-run Phase 1 (paper-blind).')
        }

        // ── PASS 2 (paper-visible) ──
        setFailedPhase('phase2')
        setPhase('running-phase2')
        setStreamingText('')
        persist((prev) => ({ ...prev, reviewStatus: 'running-phase2' }))

        // Project the editor sections into the flat Schema-4 draft (reused from the gate).
        const draft = buildPaperDraft(paperRef.current)

        const report = await runReviewPhase2(
          paperRef.current.config,
          draft,
          plan,
          (chunk) => setStreamingText((prev) => prev + chunk),
          modelConfigRef.current,
        )

        // ── Success: store the report, derive the embedded Schema-7 roadmap (P11.10),
        // flip to awaiting-decision, and persist. The editorial DECISION is derived at
        // render time via deriveReviewDecision(review) — the single source of truth. ──
        setReview(report)
        setPhase('awaiting-decision')
        persist((prev) => ({
          ...prev,
          reviewReport: report,
          // Lift the revision roadmap embedded in the review report (the full Schema-7
          // parser arrives in P13; here we only persist the array the agent already gave).
          revisionRoadmap: report.revisionRoadmap ?? [],
          reviewStatus: 'awaiting-decision',
        }))
      } catch (err) {
        // EH-03: a THROWN error means the phase could not complete (API/server/parse, or
        // an IR-03 403). This is NOT an editorial outcome — the Retry resumes the failed
        // phase (failedPhaseRef) so a Phase-2 failure never re-runs the blind Phase 1.
        const msg = err instanceof Error ? err.message : String(err)
        setErrorMessage(msg)
        setPhase('error')
        persist((prev) => ({ ...prev, reviewStatus: 'error' }))
        console.error('Peer review failed to complete:', err)
      } finally {
        isRunningRef.current = false
        setStreamingText('')
      }
    },
    [persist],
  )

  // ─── Mount: load paper, enforce the 2.5-PASS precondition, then run the review ──
  useEffect(() => {
    // StrictMode guard: paperRef is set below before any async work; the dev-only
    // second effect run sees it non-null and bails, preventing a double-run.
    if (paperRef.current !== null) return

    const saved = loadPaper()
    if (!saved) {
      router.replace('/intake')
      return
    }

    // P11.10 precondition (client IR-03 mirror): Stage 3 is legal ONLY on a 2.5-PASS
    // draft. No integrity pass, or no sections to review → bounce to the integrity gate.
    if (!saved.integrityPassDate || saved.sections.length === 0) {
      router.replace('/pipeline/integrity')
      return
    }

    paperRef.current = saved
    modelConfigRef.current = loadModelConfig()

    queueMicrotask(() => {
      setPaper(saved)
      // If a completed review is already saved (e.g. returning to the page), show it
      // instead of re-running the (paid) agent calls. Otherwise start a fresh run.
      if (saved.reviewReport && saved.reviewStatus === 'awaiting-decision') {
        setReview(saved.reviewReport)
        setPhase('awaiting-decision')
      } else if (saved.reviewDecision && saved.reviewReport) {
        setReview(saved.reviewReport)
        setPhase('decided')
      } else {
        runFrom('phase1')
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Editorial decision handlers (P11.9) — persist + show confirmation, NO auto-nav ──
  // Each handler records the chosen outcome. Reject ALSO increments revisionLoopCount so
  // a Reject consumes one of the max-2 revision loops (it cannot be used to bypass the cap).
  const decide = useCallback(
    (decision: EditorialDecision, opts?: { incrementLoop?: boolean }) => {
      const reviewStatus: PaperState['reviewStatus'] =
        decision === 'Accept' ? 'accepted' : decision === 'Reject' ? 'rejected' : 'revision'
      persist((prev) => ({
        ...prev,
        reviewDecision: decision,
        reviewStatus,
        revisionLoopCount: opts?.incrementLoop
          ? (prev.revisionLoopCount ?? 0) + 1
          : prev.revisionLoopCount,
      }))
      setPhase('decided')
    },
    [persist],
  )

  // ─── Render ─────────────────────────────────────────────────────────────────────

  if (phase === 'loading' || !paper) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading peer review…</p>
      </div>
    )
  }

  // Derive the BINDING editorial decision once, here, from the report (single source of
  // truth). Only meaningful in awaiting-decision / decided; null while a phase runs.
  const decision = review ? deriveReviewDecision(review) : null

  // The decision to store when the user OVERRIDES a recommendation by clicking "Request
  // Revision": never store Accept here; if the recommendation was Accept (or Reject),
  // fall to the nearest revision band so the coaching loop has a sensible target.
  const requestRevisionDecision: EditorialDecision =
    decision && decision.editorialDecision !== 'Accept' && decision.editorialDecision !== 'Reject'
      ? decision.editorialDecision
      : decision?.editorialDecision === 'Reject'
        ? 'Major Revision'
        : 'Minor Revision'

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-8 sm:py-8">

        {/* ── Header ── */}
        <div>
          <h1 className="text-2xl font-bold mb-1 truncate">{paper.config.topic}</h1>
          <p className="text-sm text-muted-foreground">
            Stage 3 — Peer Review ·{' '}
            {paper.config.paperType.replace('_', ' ').toUpperCase()} ·{' '}
            {paper.config.citationFormat}
          </p>
        </div>

        {/* ── ERROR (EH-03): a phase could not COMPLETE (API/parse/403 threw). ──
            Retry resumes the FAILED phase only — a Phase-2 retry reuses the committed
            Phase-1 plan and does not re-run the blind pre-commitment. */}
        {phase === 'error' && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-5 space-y-3">
            <p className="font-semibold text-destructive">
              Peer review failed to complete. Retry?
            </p>
            {errorMessage && (
              <p className="text-sm text-muted-foreground">{errorMessage}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {failedPhase === 'phase2'
                ? 'The committed scoring plan is preserved — retrying re-runs only the paper-visible scoring pass.'
                : 'Retrying re-runs the paper-blind scoring-plan pass.'}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button onClick={() => runFrom(failedPhase)}>Retry peer review</Button>
              <Button variant="outline" onClick={() => router.push('/pipeline')}>
                Back to pipeline
              </Button>
            </div>
          </div>
        )}

        {/* ── RUNNING PHASE 1 (paper-blind): the board commits a scoring plan. ── */}
        {phase === 'running-phase1' && (
          <div className="space-y-4">
            <SprintContractIndicator phase="phase1" />
            <div
              aria-live="polite"
              aria-busy="true"
              className="max-h-64 overflow-y-auto rounded-md border bg-muted/30 p-3 text-xs leading-relaxed whitespace-pre-wrap text-foreground/80"
            >
              {streamingText || 'Waiting for the reviewers to commit their scoring plan…'}
            </div>
          </div>
        )}

        {/* ── RUNNING PHASE 2 (paper-visible): the board scores the paper. ── */}
        {phase === 'running-phase2' && (
          <div className="space-y-4">
            <SprintContractIndicator phase="phase2" committed />
            <div
              aria-live="polite"
              aria-busy="true"
              className="max-h-64 overflow-y-auto rounded-md border bg-muted/30 p-3 text-xs leading-relaxed whitespace-pre-wrap text-foreground/80"
            >
              {streamingText || 'Waiting for the first reviewer response…'}
            </div>
          </div>
        )}

        {/* ── AWAITING DECISION: the 5-reviewer panel + the editorial routing buttons. ──
            Nothing advances automatically — the human picks the outcome. */}
        {phase === 'awaiting-decision' && review && decision && (
          <div className="space-y-6">
            <PeerReviewReport review={review} decision={decision} />

            <div className="rounded-lg border bg-card p-5 space-y-4">
              <div>
                <p className="font-semibold">Editorial decision</p>
                <p className="text-sm text-muted-foreground">{decision.reason}</p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {/* Accept — RENDERED ONLY when allowed. DA-CRITICAL removes it from the DOM
                    entirely (a numeric pass cannot stand against a critical flag). */}
                {decision.acceptAllowed && (
                  <Button
                    type="button"
                    data-testid="review-accept"
                    variant={decision.editorialDecision === 'Accept' ? 'default' : 'outline'}
                    onClick={() => decide('Accept')}
                  >
                    Accept Outcome — Advance to Final Integrity Gate
                  </Button>
                )}

                {/* Request Revision — always available; routes to coaching (P12). */}
                <Button
                  type="button"
                  data-testid="review-request-revision"
                  variant={
                    decision.editorialDecision === 'Minor Revision' ||
                    decision.editorialDecision === 'Major Revision'
                      ? 'default'
                      : 'outline'
                  }
                  onClick={() => decide(requestRevisionDecision)}
                >
                  Request Revision — Enter Coaching
                </Button>

                {/* Reject — always available; returns to writing AND consumes one revision
                    loop (revisionLoopCount++) so it can't be used to bypass the max-2 cap. */}
                <Button
                  type="button"
                  data-testid="review-reject"
                  variant={decision.editorialDecision === 'Reject' ? 'default' : 'outline'}
                  onClick={() => decide('Reject', { incrementLoop: true })}
                >
                  Reject — Return to Writing
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── DECIDED: record the choice + name the next phase (P12/P15 not built yet, so
            we do NOT navigate to a non-existent route — mirrors the integrity page). ── */}
        {phase === 'decided' && paper.reviewDecision && (
          <div
            role="status"
            className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20 p-5 space-y-3"
          >
            {paper.reviewDecision === 'Accept' && (
              <>
                <p className="font-semibold text-green-800 dark:text-green-200">
                  Accept — advancing to the Final Integrity Gate (Stage 4.5)
                </p>
                <p className="text-sm text-green-700 dark:text-green-300">
                  Even an Accept does not skip the zero-tolerance final integrity gate. That
                  gate is built in P15; your decision is recorded.
                </p>
              </>
            )}
            {(paper.reviewDecision === 'Minor Revision' || paper.reviewDecision === 'Major Revision') && (
              <>
                <p className="font-semibold text-green-800 dark:text-green-200">
                  Request Revision ({paper.reviewDecision}) — entering coaching
                </p>
                <p className="text-sm text-green-700 dark:text-green-300">
                  The EIC Socratic coaching loop (Stage 3→4) is built in P12; your decision
                  is recorded.
                </p>
              </>
            )}
            {paper.reviewDecision === 'Reject' && (
              <>
                <p className="font-semibold text-green-800 dark:text-green-200">
                  Reject — returning to section writing
                </p>
                <p className="text-sm text-green-700 dark:text-green-300">
                  Revision loop {paper.revisionLoopCount ?? 1} of 2. A Reject consumes one of
                  the two permitted revision loops.
                </p>
              </>
            )}
            <div className="flex flex-col items-start gap-2 sm:flex-row">
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
