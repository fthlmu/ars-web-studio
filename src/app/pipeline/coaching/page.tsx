'use client'

// Coaching page — the EIC Socratic coaching loop. Serves TWO stages:
//
//   • P12 — Stage 3→4 coaching (default): reached from the review "Request Revision"
//     decision, max 8 rounds, persisted in coachingThread / coachingRoundCount /
//     coachingStatus, proceeds to the Stage-4 revision executor (/pipeline/revise).
//
//   • P14 — Stage 3'→4' RESIDUAL coaching (?stage=re-review): reached from the
//     re-review "Request Final Revision" button, max 5 rounds, persisted in the SEPARATE
//     residualCoaching* fields (so the first coaching thread is never clobbered), and
//     proceeds to the single permitted RE-REVISE (/pipeline/revise?stage=re-revise).
//
// The stage is read from the URL on mount (no useSearchParams → no Suspense boundary
// needed). Everything stage-specific (maxRounds, which report seeds the dialogue, which
// localStorage fields persist, where "proceed" goes) is selected from `mode` below; the
// bounded-loop invariant itself lives in CoachingThread.
//
// Iron-rule context: coaching is legal ONLY after the matching upstream decision exists.
// P12: a Minor/Major revision decision + a review report. P14: a re-review report.
// Otherwise we bounce back to the right page.

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { CoachingThread } from '@/components/pipeline/CoachingThread'
import { COACHING_SYSTEM_PROMPT, buildCoachingSeed } from '@/lib/ars-client'
import { loadPaper, savePaper, loadModelConfig } from '@/lib/storage'
import type { PaperState, ModelConfig, CoachingMessage } from '@/lib/types'

type Phase = 'loading' | 'coaching' | 'proceeded'
// Which stage this coaching screen is serving (selected from the URL on mount).
type Mode = 'p12' | 're-review'

// Round caps per stage. P12 coaching = 8 (FR-28); P14 residual coaching = 5 (FR-36).
const MAX_ROUNDS: Record<Mode, number> = { p12: 8, 're-review': 5 }

export default function CoachingPage() {
  const router = useRouter()

  const [paper, setPaper] = useState<PaperState | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [mode, setMode] = useState<Mode>('p12')
  const [modelConfig, setModelConfig] = useState<ModelConfig | undefined>(undefined)

  // StrictMode double-mount guard + stale-closure-safe SSOT (mirrors the review page).
  const paperRef = useRef<PaperState | null>(null)

  // ── Persist helper (immutable update + localStorage write) — copied from the review page ──
  const persist = useCallback((updater: (prev: PaperState) => PaperState) => {
    if (!paperRef.current) return
    const next = updater(paperRef.current)
    next.updatedAt = new Date().toISOString()
    paperRef.current = next
    setPaper(next)
    savePaper(next)
  }, [])

  // ── Mount: read the stage param, load paper, enforce the matching precondition ──
  useEffect(() => {
    if (paperRef.current !== null) return

    // Read the stage from the URL directly (client-only) so we avoid useSearchParams /
    // the Suspense boundary it would require for this route.
    const stageParam =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('stage')
        : null
    const m: Mode = stageParam === 're-review' ? 're-review' : 'p12'

    const saved = loadPaper()
    if (!saved) {
      router.replace('/intake')
      return
    }

    if (m === 're-review') {
      // Residual coaching is legal only once the re-review has produced a report.
      if (!saved.reReviewReport) {
        router.replace('/pipeline/re-review')
        return
      }
    } else {
      // P12 coaching is legal only after a revision decision with a review report in hand.
      const isRevision =
        saved.reviewDecision === 'Minor Revision' || saved.reviewDecision === 'Major Revision'
      if (!isRevision || !saved.reviewReport) {
        router.replace('/pipeline/review')
        return
      }
    }

    paperRef.current = saved

    queueMicrotask(() => {
      setMode(m)
      setPaper(saved)
      setModelConfig(loadModelConfig())
      const status = m === 're-review' ? saved.residualCoachingStatus : saved.coachingStatus
      // If the author already left coaching, show the handoff directly.
      setPhase(status === 'proceed-revision' ? 'proceeded' : 'coaching')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Persist one coaching turn into the fields for THIS stage. ──
  const handlePersist = useCallback(
    (thread: CoachingMessage[], roundCount: number) => {
      const status: PaperState['coachingStatus'] = roundCount > 0 ? 'in-progress' : 'round-0'
      persist((prev) =>
        mode === 're-review'
          ? {
              ...prev,
              residualCoachingThread: thread,
              residualCoachingRoundCount: roundCount,
              residualCoachingStatus: status,
            }
          : {
              ...prev,
              coachingThread: thread,
              coachingRoundCount: roundCount,
              coachingStatus: status,
            },
      )
    },
    [persist, mode],
  )

  // ── Leave coaching for the revision executor (Skip / cap / Proceed). ──
  const handleProceed = useCallback(() => {
    persist((prev) =>
      mode === 're-review'
        ? { ...prev, residualCoachingStatus: 'proceed-revision' }
        : { ...prev, coachingStatus: 'proceed-revision' },
    )
    setPhase('proceeded')
  }, [persist, mode])

  // ─── Render ─────────────────────────────────────────────────────────────────────

  // The report that seeds the dialogue depends on the stage.
  const seedReport = mode === 're-review' ? paper?.reReviewReport : paper?.reviewReport

  if (phase === 'loading' || !paper || !seedReport) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading coaching…</p>
      </div>
    )
  }

  const maxRounds = MAX_ROUNDS[mode]
  const initialThread =
    (mode === 're-review' ? paper.residualCoachingThread : paper.coachingThread) ?? []
  const roundCount =
    (mode === 're-review' ? paper.residualCoachingRoundCount : paper.coachingRoundCount) ?? 0
  const seedMessage = buildCoachingSeed(paper.config, seedReport, paper.revisionRoadmap ?? [])

  // Where "Start Revision" goes + the copy, per stage.
  const reviseHref = mode === 're-review' ? '/pipeline/revise?stage=re-revise' : '/pipeline/revise'
  const stageLabel = mode === 're-review' ? 'Stage 3′→4′ — Residual Coaching' : 'Stage 3→4 — Revision Coaching'

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-8 sm:py-8">

        {/* ── Header ── */}
        <div>
          <h1 className="text-2xl font-bold mb-1 truncate">{paper.config.topic}</h1>
          <p className="text-sm text-muted-foreground">
            {stageLabel} ·{' '}
            {paper.config.paperType.replace('_', ' ').toUpperCase()} ·{' '}
            {mode === 're-review' ? 'Final revision' : `Decision: ${paper.reviewDecision}`}
          </p>
        </div>

        {/* ── COACHING: the bounded EIC dialogue. ── */}
        {phase === 'coaching' && (
          <CoachingThread
            systemPrompt={COACHING_SYSTEM_PROMPT}
            seedMessage={seedMessage}
            maxRounds={maxRounds}
            initialThread={initialThread}
            modelConfig={modelConfig}
            onPersist={handlePersist}
            onProceed={handleProceed}
          />
        )}

        {/* ── PROCEEDED: record the handoff + advance to the revision executor. ── */}
        {phase === 'proceeded' && (
          <div
            role="status"
            className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20 p-5 space-y-3"
          >
            <p className="font-semibold text-green-800 dark:text-green-200">
              {mode === 're-review'
                ? 'Residual coaching complete — advancing to the final revision (Stage 4′)'
                : 'Coaching complete — advancing to revision (Stage 4)'}
            </p>
            <p className="text-sm text-green-700 dark:text-green-300">
              {roundCount > 0
                ? `You completed ${roundCount} coaching round${roundCount === 1 ? '' : 's'}.`
                : 'You skipped coaching (0 rounds used).'}{' '}
              {mode === 're-review'
                ? 'The revision agent will now make the single permitted final revision.'
                : 'The Stage-4 revision agent will now rewrite the paper against the reviewers’ roadmap.'}
            </p>
            <div className="flex flex-col items-start gap-2 sm:flex-row">
              <Button data-testid="enter-revision" onClick={() => router.push(reviseHref)}>
                {mode === 're-review' ? 'Start Final Revision →' : 'Start Revision →'}
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
