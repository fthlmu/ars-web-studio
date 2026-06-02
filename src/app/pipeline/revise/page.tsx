'use client'

// Revision page — the revision_coach_agent executor. Serves TWO stages:
//
//   • P13 — Stage 4 REVISE (default): reached from the P12 coaching 'proceed-revision'
//     handoff. Revises the ORIGINAL draft against the Stage-3 review + roadmap + coaching.
//     On Approve: increment revisionLoopCount; <2 → re-review (Stage 3'), ==2 → final gate.
//
//   • P14 — Stage 4' RE-REVISE (?stage=re-revise): the SINGLE permitted final revision.
//     Reached from the residual-coaching 'proceed-revision' handoff. Revises the
//     already-revised draft against the RE-REVIEW report + residual coaching. On Approve:
//     increment revisionLoopCount to the cap AND set reReviseUsed = true, then return to
//     re-review (whose only remaining exit is the final gate — iron rule 2).
//
// IRON RULES enforced here:
//   • P13.7 — the ORIGINAL editor draft (paper.sections) is NEVER overwritten. Revised
//     content lands in paper.revisedDraft as a SEPARATE field. (In re-revise the *previous*
//     revisedDraft is the "before"; sections still stay pristine.)
//   • FR-05 / FR-33 / iron rule 2 — the loop counter + reReviseUsed gate the next stage.
//     A re-revise can happen at most ONCE (the re-revise mount bounces if reReviseUsed).

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { RevisionRoadmapChecklist } from '@/components/pipeline/RevisionRoadmapChecklist'
import { DeltaReportView } from '@/components/pipeline/DeltaReportView'
import { runRevision, buildPaperDraft } from '@/lib/ars-client'
import { loadPaper, savePaper, loadModelConfig } from '@/lib/storage'
import type { PaperState, ModelConfig } from '@/lib/types'

type Phase = 'loading' | 'running' | 'awaiting-approval' | 'routed' | 'error'
// Which stage this revise screen is serving (selected from the URL on mount).
type Mode = 'p13' | 're-revise'

// The max number of revision loops (FR-05). Reaching it forces the final gate.
const MAX_REVISION_LOOPS = 2

export default function RevisePage() {
  const router = useRouter()

  const [paper, setPaper] = useState<PaperState | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [mode, setMode] = useState<Mode>('p13')
  const [streamingText, setStreamingText] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // refs (avoid stale closures inside async callbacks; mirror the review page).
  const isRunningRef = useRef(false)
  const paperRef = useRef<PaperState | null>(null)
  const modeRef = useRef<Mode>('p13')
  const modelConfigRef = useRef<ModelConfig | undefined>(undefined)

  // ── Persist helper (immutable update + localStorage write) — copied from review/coaching. ──
  const persist = useCallback((updater: (prev: PaperState) => PaperState) => {
    if (!paperRef.current) return
    const next = updater(paperRef.current)
    next.updatedAt = new Date().toISOString()
    paperRef.current = next
    setPaper(next)
    savePaper(next)
  }, [])

  // ── Run the revision. The inputs differ by stage:
  //   p13:        original = the pristine editor draft; review = Stage-3 report; coaching = P12 thread
  //   re-revise:  original = the prior revised draft;   review = re-review report; coaching = residual thread
  // Either way runRevision returns a NEW revisedDraft (never mutates the "before"). ──
  const run = useCallback(async () => {
    if (isRunningRef.current) return
    const p = paperRef.current
    if (!p) return
    const m = modeRef.current
    // Pick the review report + "before" draft + coaching thread for this stage.
    const review = m === 're-revise' ? p.reReviewReport : p.reviewReport
    if (!review) return
    if (m === 're-revise' && !p.revisedDraft) return
    isRunningRef.current = true

    setErrorMessage(null)
    setStreamingText('')
    setPhase('running')
    persist((prev) => ({ ...prev, revisionStatus: 'running' }))

    try {
      // In re-revise the "before" is the prior revised draft; in p13 it is the editor draft.
      // (The re-revise guard above already ensured p.revisedDraft is present.)
      const original = m === 're-revise' && p.revisedDraft ? p.revisedDraft : buildPaperDraft(p)
      const coaching = m === 're-revise' ? (p.residualCoachingThread ?? []) : (p.coachingThread ?? [])
      const result = await runRevision(
        p.config,
        original,
        review,
        coaching,
        (chunk) => setStreamingText((prev) => prev + chunk),
        modelConfigRef.current,
      )

      persist((prev) => ({
        ...prev,
        revisionPlan: result.roadmap,
        revisedDraft: result.revisedDraft,
        deltaReport: result.deltaReport,
        revisionStatus: 'awaiting-approval',
      }))
      setPhase('awaiting-approval')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMessage(msg)
      setPhase('error')
      persist((prev) => ({ ...prev, revisionStatus: 'error' }))
      console.error('Revision failed to complete:', err)
    } finally {
      isRunningRef.current = false
      setStreamingText('')
    }
  }, [persist])

  // ── Mount: read the stage param, load paper, enforce the handoff precondition, then run. ──
  useEffect(() => {
    if (paperRef.current !== null) return

    const stageParam =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('stage')
        : null
    const m: Mode = stageParam === 're-revise' ? 're-revise' : 'p13'

    const saved = loadPaper()
    if (!saved) {
      router.replace('/intake')
      return
    }

    if (m === 're-revise') {
      // IRON RULE 2: the single permitted re-revise can run at most ONCE. If it has already
      // been used, there is no second re-revise — bounce back to the re-review (final gate only).
      if (saved.reReviseUsed === true) {
        router.replace('/pipeline/re-review')
        return
      }
      // Re-revise is legal only with a re-review report + a revised draft to revise…
      if (!saved.reReviewReport || !saved.revisedDraft) {
        router.replace('/pipeline/re-review')
        return
      }
      // …and only once residual coaching has handed off.
      if (saved.residualCoachingStatus !== 'proceed-revision') {
        router.replace('/pipeline/coaching?stage=re-review')
        return
      }
    } else {
      // P13: legal only after a "Request Revision" decision with a report…
      if (!saved.reviewReport) {
        router.replace('/pipeline/review')
        return
      }
      const isRevision =
        saved.reviewDecision === 'Minor Revision' || saved.reviewDecision === 'Major Revision'
      // …and only once coaching has handed off (Skip / cap / Proceed all set this).
      if (!isRevision || saved.coachingStatus !== 'proceed-revision') {
        router.replace('/pipeline/coaching')
        return
      }
    }

    paperRef.current = saved
    modeRef.current = m
    modelConfigRef.current = loadModelConfig()

    queueMicrotask(() => {
      setMode(m)
      setPaper(saved)
      // Returning to the page: show saved state rather than re-running the (paid) revision.
      if (saved.revisionStatus === 're-review' || saved.revisionStatus === 'final-gate') {
        setPhase('routed')
      } else if (
        saved.revisionStatus === 'awaiting-approval' &&
        saved.revisedDraft &&
        saved.deltaReport &&
        saved.revisionPlan
      ) {
        setPhase('awaiting-approval')
      } else {
        run()
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Approve the revision. Routing differs by stage. ──
  const approve = useCallback(() => {
    const p = paperRef.current
    if (!p) return
    if (modeRef.current === 're-revise') {
      // Stage 4' RE-REVISE: consume the final loop AND mark the single re-revise as used,
      // then return to re-review with a fresh re-review run (its only exit is the final gate).
      persist((prev) => ({
        ...prev,
        revisionLoopCount: MAX_REVISION_LOOPS,
        reReviseUsed: true,
        revisionStatus: 're-review',
        // Clear the prior re-review so the re-review page re-scores the re-revised draft.
        reReviewReport: undefined,
        reReviewStatus: 'idle',
      }))
      setPhase('routed')
      return
    }
    // P13: increment the loop counter and route by FR-05/33.
    const newCount = (p.revisionLoopCount ?? 0) + 1
    const route: PaperState['revisionStatus'] =
      newCount < MAX_REVISION_LOOPS ? 're-review' : 'final-gate'
    persist((prev) => ({ ...prev, revisionLoopCount: newCount, revisionStatus: route }))
    setPhase('routed')
  }, [persist])

  // ─── Render ─────────────────────────────────────────────────────────────────────

  if (phase === 'loading' || !paper) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading revision…</p>
      </div>
    )
  }

  const isReRevise = mode === 're-revise'
  // FR-33: in P13 this is the FINAL permitted loop when one loop is already consumed.
  // A re-revise is ALWAYS the final loop. Either way, the next stop after approve is
  // the re-review (whose only forward exit is then the final gate).
  const isFinalLoop = isReRevise || (paper.revisionLoopCount ?? 0) === MAX_REVISION_LOOPS - 1

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-8 sm:py-8">

        {/* ── Header ── */}
        <div>
          <h1 className="text-2xl font-bold mb-1 truncate">{paper.config.topic}</h1>
          <p className="text-sm text-muted-foreground">
            {isReRevise ? 'Stage 4′ — Final Revision' : 'Stage 4 — Revision'} ·{' '}
            {paper.config.paperType.replace('_', ' ').toUpperCase()} ·{' '}
            {isReRevise ? 'Re-revise (1 of 1)' : `Decision: ${paper.reviewDecision}`}
          </p>
        </div>

        {/* ── Final-loop banner: persistent orange warning on the last permitted loop. ── */}
        {isFinalLoop && phase !== 'routed' && (
          <div
            role="status"
            data-testid="final-loop-banner"
            className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
          >
            <span className="font-semibold">
              {isReRevise ? 'Single permitted final revision.' : 'Final revision loop.'}
            </span>{' '}
            {isReRevise
              ? 'This is the one re-revise allowed. After you approve it, the re-review’s only remaining exit is the zero-tolerance Final Integrity Gate (Stage 4.5).'
              : 'One revision loop has already been used. After you approve this revision, the next re-review’s only remaining exit is the zero-tolerance Final Integrity Gate (Stage 4.5).'}
          </div>
        )}

        {/* ── ERROR (EH-04): the revision could not complete. ── */}
        {phase === 'error' && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-5 space-y-3">
            <p className="font-semibold text-destructive">Revision failed to complete. Retry?</p>
            {errorMessage && <p className="text-sm text-muted-foreground">{errorMessage}</p>}
            <p className="text-xs text-muted-foreground">
              Your review report and source draft are preserved — retrying re-runs only the rewrite.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button data-testid="revision-retry" onClick={() => run()}>Retry revision</Button>
              <Button variant="outline" onClick={() => router.push('/pipeline')}>Back to pipeline</Button>
            </div>
          </div>
        )}

        {/* ── RUNNING: the agent rewrites the paper. ── */}
        {phase === 'running' && (
          <div className="space-y-4">
            <p className="text-sm font-medium">
              {isReRevise
                ? 'Making the final revision against the re-review’s residual issues…'
                : 'Revising the paper against the reviewers’ roadmap…'}
            </p>
            <div
              aria-live="polite"
              aria-busy="true"
              className="max-h-64 overflow-y-auto rounded-md border bg-muted/30 p-3 text-xs leading-relaxed whitespace-pre-wrap text-foreground/80"
            >
              {streamingText || 'Waiting for the revision agent…'}
            </div>
          </div>
        )}

        {/* ── AWAITING APPROVAL: roadmap checklist + delta report + the Approve gate. ── */}
        {phase === 'awaiting-approval' && paper.revisionPlan && paper.deltaReport && (
          <div className="space-y-6">
            <RevisionRoadmapChecklist roadmap={paper.revisionPlan} />
            <DeltaReportView delta={paper.deltaReport} />

            <div className="rounded-lg border bg-card p-5 space-y-4">
              <div>
                <p className="font-semibold">Approve this revision?</p>
                <p className="text-sm text-muted-foreground">
                  {isReRevise
                    ? 'Approving sends the re-revised paper back for a final re-review; after that the only exit is the Final Integrity Gate (Stage 4.5).'
                    : isFinalLoop
                      ? 'Approving sends the revised paper for a re-review; after that the only exit is the Final Integrity Gate (Stage 4.5).'
                      : 'Approving sends the revised paper back for a re-review (Stage 3′).'}
                </p>
              </div>
              <Button data-testid="revision-approve" onClick={approve}>
                {isReRevise
                  ? 'Approve Final Revision — Send for Re-Review'
                  : 'Approve Revision — Send for Re-Review'}
              </Button>
            </div>
          </div>
        )}

        {/* ── ROUTED: re-review IS built (P14), so navigate there. The final-gate handoff
            (P13 loop 2) still only NAMES Stage 4.5 — P15 is not built yet. ── */}
        {phase === 'routed' && (
          <div
            role="status"
            className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20 p-5 space-y-3"
          >
            {paper.revisionStatus === 're-review' && (
              <>
                <p className="font-semibold text-green-800 dark:text-green-200">
                  {isReRevise
                    ? 'Final revision approved — returning to re-review'
                    : 'Revision approved — advancing to Re-Review (Stage 3′)'}
                </p>
                <p className="text-sm text-green-700 dark:text-green-300">
                  Revision loop {Math.min(paper.revisionLoopCount ?? 1, MAX_REVISION_LOOPS)} of {MAX_REVISION_LOOPS}.
                  {isReRevise
                    ? ' The re-review will re-score the re-revised paper; its only remaining exit is the final gate.'
                    : ' The narrow 3-agent re-review re-scores your revised draft.'}
                </p>
                <div className="flex flex-col items-start gap-2 sm:flex-row">
                  <Button data-testid="enter-re-review" onClick={() => router.push('/pipeline/re-review')}>
                    {isReRevise ? 'Return to Re-Review →' : 'Enter Re-Review →'}
                  </Button>
                  <Button variant="outline" onClick={() => router.push('/pipeline')}>Back to pipeline</Button>
                </div>
              </>
            )}
            {paper.revisionStatus === 'final-gate' && (
              <>
                <p className="font-semibold text-green-800 dark:text-green-200">
                  Revision approved — advancing to the Final Integrity Gate (Stage 4.5)
                </p>
                <p className="text-sm text-green-700 dark:text-green-300">
                  The maximum of {MAX_REVISION_LOOPS} revision loops has been used, so there is no
                  further review loop. The only remaining step is the zero-tolerance final
                  integrity gate; your revised draft is saved.
                </p>
                <div className="flex flex-col items-start gap-2 sm:flex-row">
                  <Button data-testid="enter-final-gate" onClick={() => router.push('/pipeline/final-integrity')}>
                    Continue to Final Integrity Gate →
                  </Button>
                  <Button variant="outline" onClick={() => router.push('/pipeline')}>Back to pipeline</Button>
                </div>
              </>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
