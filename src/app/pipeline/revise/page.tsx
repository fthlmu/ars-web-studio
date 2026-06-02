'use client'

// Stage-4 Revision page (Phase P13) — the revision_coach_agent executor.
//
// Reached from the P12 coaching 'proceed-revision' handoff. The revision agent rewrites
// the paper against the reviewers' report + roadmap + coaching dialogue, and this page
// shows the Revision Roadmap checklist + the before→after Delta Report, then routes by
// the revision-loop count (FR-05 / FR-33).
//
// IRON RULES enforced here:
//   • P13.7 — the ORIGINAL draft (paper.sections) is NEVER overwritten. The revised draft
//     lands in paper.revisedDraft as a SEPARATE field, so a failed/abandoned revision
//     leaves the source intact and EH-04 "Retry Revision" preserves Schema 4 + Schema 6.
//   • FR-05 / FR-33 — on Approve we increment revisionLoopCount; <2 routes to re-review
//     (Stage 3', P14), ==2 routes to the final integrity gate (Stage 4.5, P15). There is
//     NO third revision loop — a paper already on its final loop (revisionLoopCount===1)
//     shows a persistent orange banner saying the next stop is the final gate.
//
// State machine (mirrors the P11 review / P12 coaching pages deliberately):
//   loading           → read saved paper; decide whether this page is even legal
//   running           → runRevision() streaming the rewrite
//   awaiting-approval → roadmap + delta shown; the human clicks Approve (no auto-advance)
//   routed            → approved; record the FR-05/33 handoff + name the next phase.
//                       P14 (re-review) / P15 (final gate) are not built yet, so — exactly
//                       like review/coaching handled "next stage not built" — we record the
//                       decision + name the phase rather than navigating to a dead route.
//   error             → runRevision THREW (API/parse); EH-04 Retry re-runs it, preserving
//                       the review report + the (untouched) original draft.

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { RevisionRoadmapChecklist } from '@/components/pipeline/RevisionRoadmapChecklist'
import { DeltaReportView } from '@/components/pipeline/DeltaReportView'
import { runRevision, buildPaperDraft } from '@/lib/ars-client'
import { loadPaper, savePaper, loadModelConfig } from '@/lib/storage'
import type { PaperState, ModelConfig } from '@/lib/types'

type Phase = 'loading' | 'running' | 'awaiting-approval' | 'routed' | 'error'

// The max number of revision loops (FR-05). Reaching it forces the final gate.
const MAX_REVISION_LOOPS = 2

export default function RevisePage() {
  const router = useRouter()

  const [paper, setPaper] = useState<PaperState | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [streamingText, setStreamingText] = useState('')
  // Error banner text — set ONLY when runRevision throws (EH-04). Drives the Retry state.
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // refs (avoid stale closures inside async callbacks; mirror the review page).
  const isRunningRef = useRef(false)
  const paperRef = useRef<PaperState | null>(null)
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

  // ── Run the revision. The ORIGINAL draft is built fresh from the editor sections and
  // passed read-only; runRevision returns a NEW revisedDraft (P13.7 — never overwrite). ──
  const run = useCallback(async () => {
    if (isRunningRef.current) return
    if (!paperRef.current || !paperRef.current.reviewReport) return
    isRunningRef.current = true

    setErrorMessage(null)
    setStreamingText('')
    setPhase('running')
    persist((prev) => ({ ...prev, revisionStatus: 'running' }))

    try {
      const original = buildPaperDraft(paperRef.current)
      const result = await runRevision(
        paperRef.current.config,
        original,
        paperRef.current.reviewReport,
        paperRef.current.coachingThread ?? [],
        (chunk) => setStreamingText((prev) => prev + chunk),
        modelConfigRef.current,
      )

      // Success: store the roadmap + revised draft + delta SEPARATELY (sections untouched),
      // flip to awaiting-approval, and persist so a reload restores without re-paying.
      persist((prev) => ({
        ...prev,
        revisionPlan: result.roadmap,
        revisedDraft: result.revisedDraft,
        deltaReport: result.deltaReport,
        revisionStatus: 'awaiting-approval',
      }))
      setPhase('awaiting-approval')
    } catch (err) {
      // EH-04: a THROWN error means the revision could not complete. Retry re-runs it; the
      // review report + the original draft are preserved (we never touched paper.sections).
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

  // ── Mount: load paper, enforce the coaching-handoff precondition, then run. ──
  useEffect(() => {
    if (paperRef.current !== null) return

    const saved = loadPaper()
    if (!saved) {
      router.replace('/intake')
      return
    }

    // Revision is legal ONLY after a "Request Revision" review decision with a report.
    if (!saved.reviewReport) {
      router.replace('/pipeline/review')
      return
    }
    // …and only once coaching has handed off (Skip / cap / Proceed all set this).
    const isRevision =
      saved.reviewDecision === 'Minor Revision' || saved.reviewDecision === 'Major Revision'
    if (!isRevision || saved.coachingStatus !== 'proceed-revision') {
      router.replace('/pipeline/coaching')
      return
    }

    paperRef.current = saved
    modelConfigRef.current = loadModelConfig()

    queueMicrotask(() => {
      setPaper(saved)
      // Returning to the page: show whatever state was saved rather than re-running the
      // (paid) revision. 'routed' if already approved; 'awaiting-approval' if the revision
      // ran but wasn't approved; otherwise start a fresh run.
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

  // ── Approve the revision (P13.6): increment the loop counter and route by FR-05/33. ──
  const approve = useCallback(() => {
    if (!paperRef.current) return
    const newCount = (paperRef.current.revisionLoopCount ?? 0) + 1
    // <2 → re-review (Stage 3', P14); ==2 (cap reached) → final integrity gate (Stage 4.5, P15).
    const route: PaperState['revisionStatus'] =
      newCount < MAX_REVISION_LOOPS ? 're-review' : 'final-gate'
    persist((prev) => ({
      ...prev,
      revisionLoopCount: newCount,
      revisionStatus: route,
    }))
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

  // FR-33: this is the FINAL permitted loop when one loop has already been consumed.
  // After approving here, revisionLoopCount reaches the cap and the next stop is the
  // final gate — there is no further review loop. Shown persistently while on this page.
  const isFinalLoop = (paper.revisionLoopCount ?? 0) === MAX_REVISION_LOOPS - 1

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-8 sm:py-8">

        {/* ── Header ── */}
        <div>
          <h1 className="text-2xl font-bold mb-1 truncate">{paper.config.topic}</h1>
          <p className="text-sm text-muted-foreground">
            Stage 4 — Revision ·{' '}
            {paper.config.paperType.replace('_', ' ').toUpperCase()} ·{' '}
            Decision: {paper.reviewDecision}
          </p>
        </div>

        {/* ── FR-33 final-loop banner: persistent orange warning on the last permitted loop. ── */}
        {isFinalLoop && phase !== 'routed' && (
          <div
            role="status"
            data-testid="final-loop-banner"
            className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
          >
            <span className="font-semibold">Final revision loop.</span> One revision loop has
            already been used. After you approve this revision, the paper advances straight to the
            zero-tolerance Final Integrity Gate (Stage 4.5) — there is no further review loop.
          </div>
        )}

        {/* ── ERROR (EH-04): the revision could not complete. Retry re-runs it; the review
            report and the original draft are preserved (sections were never touched). ── */}
        {phase === 'error' && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-5 space-y-3">
            <p className="font-semibold text-destructive">Revision failed to complete. Retry?</p>
            {errorMessage && <p className="text-sm text-muted-foreground">{errorMessage}</p>}
            <p className="text-xs text-muted-foreground">
              Your peer-review report and original draft are preserved — retrying re-runs only the rewrite.
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
            <p className="text-sm font-medium">Revising the paper against the reviewers’ roadmap…</p>
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
                  {isFinalLoop
                    ? 'Approving advances the paper to the Final Integrity Gate (Stage 4.5) — no further review loop.'
                    : 'Approving sends the revised paper back for a re-review (Stage 3′).'}
                </p>
              </div>
              <Button data-testid="revision-approve" onClick={approve}>
                {isFinalLoop
                  ? 'Approve Revision — Advance to Final Integrity Gate'
                  : 'Approve Revision — Send for Re-Review'}
              </Button>
            </div>
          </div>
        )}

        {/* ── ROUTED: record the FR-05/33 handoff + name the next phase (P14/P15 not built
            yet, so we do NOT navigate to a non-existent route — mirrors review/coaching). ── */}
        {phase === 'routed' && (
          <div
            role="status"
            className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20 p-5 space-y-3"
          >
            {paper.revisionStatus === 're-review' && (
              <>
                <p className="font-semibold text-green-800 dark:text-green-200">
                  Revision approved — advancing to Re-Review (Stage 3′)
                </p>
                <p className="text-sm text-green-700 dark:text-green-300">
                  Revision loop {paper.revisionLoopCount ?? 1} of {MAX_REVISION_LOOPS}. The narrow
                  3-agent re-review (Stage 3′) is built in P14; your revised draft and Delta Report are saved.
                </p>
              </>
            )}
            {paper.revisionStatus === 'final-gate' && (
              <>
                <p className="font-semibold text-green-800 dark:text-green-200">
                  Revision approved — advancing to the Final Integrity Gate (Stage 4.5)
                </p>
                <p className="text-sm text-green-700 dark:text-green-300">
                  The maximum of {MAX_REVISION_LOOPS} revision loops has been used, so there is no
                  further review loop. The zero-tolerance final integrity gate is built in P15; your
                  revised draft is saved.
                </p>
              </>
            )}
            <div className="flex flex-col items-start gap-2 sm:flex-row">
              <Button variant="outline" onClick={() => router.push('/pipeline')}>Back to pipeline</Button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
