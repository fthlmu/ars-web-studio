'use client'

// Stage 3→4 Coaching page (Phase P12) — the EIC Socratic coaching loop.
//
// Reached from the P11 review "Request Revision" decision. The Editor-in-Chief coaches
// the author through the revision (bounded at 8 rounds, with an always-available skip)
// BEFORE the Stage-4 executor rewrites the paper.
//
// Iron-rule context (mirrors the review/integrity pages): coaching is legal ONLY after a
// "Request Revision" review decision on a paper that has a review report. Otherwise we
// bounce back to /pipeline/review. The bounded-loop invariant itself lives in
// CoachingThread (the reply composer is removed from the DOM at the cap; nothing
// auto-advances). This page owns load/guard/persist + the Stage-4 handoff.
//
// State machine:
//   loading    → read saved paper; decide whether this page is even legal
//   coaching   → render CoachingThread; persist each turn; wait for the author to proceed
//   proceeded  → the author left coaching (Skip / cap / Proceed). The Stage-4 revision
//                executor is built in P13, so — exactly like the P11 review page handled
//                "P12 not built yet" — we record the handoff + name the next phase rather
//                than navigating to a route that does not exist.

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { CoachingThread } from '@/components/pipeline/CoachingThread'
import { COACHING_SYSTEM_PROMPT, buildCoachingSeed } from '@/lib/ars-client'
import { loadPaper, savePaper, loadModelConfig } from '@/lib/storage'
import type { PaperState, ModelConfig, CoachingMessage } from '@/lib/types'

type Phase = 'loading' | 'coaching' | 'proceeded'

export default function CoachingPage() {
  const router = useRouter()

  const [paper, setPaper] = useState<PaperState | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  // Model choice held in STATE (not a ref) because it is read during render to pass into
  // CoachingThread — refs must never be read in render (react-hooks/refs).
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

  // ── Mount: load paper, enforce the "Request Revision" precondition ───────────────
  useEffect(() => {
    if (paperRef.current !== null) return

    const saved = loadPaper()
    if (!saved) {
      router.replace('/intake')
      return
    }

    // Coaching is legal ONLY after a revision decision with a review report in hand.
    // No such decision → bounce to the review page (client mirror of the stage guard).
    const isRevision =
      saved.reviewDecision === 'Minor Revision' || saved.reviewDecision === 'Major Revision'
    if (!isRevision || !saved.reviewReport) {
      router.replace('/pipeline/review')
      return
    }

    paperRef.current = saved

    queueMicrotask(() => {
      setPaper(saved)
      setModelConfig(loadModelConfig())
      // If the author already left coaching (saved earlier), show the handoff directly
      // instead of re-opening the dialogue.
      setPhase(saved.coachingStatus === 'proceed-revision' ? 'proceeded' : 'coaching')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Persist one coaching turn (thread + derived round count). 'round-0' until the
  // first author reply lands, then 'in-progress' (cosmetic status mirror). ──
  const handlePersist = useCallback(
    (thread: CoachingMessage[], roundCount: number) => {
      persist((prev) => ({
        ...prev,
        coachingThread: thread,
        coachingRoundCount: roundCount,
        coachingStatus: roundCount > 0 ? 'in-progress' : 'round-0',
      }))
    },
    [persist],
  )

  // ── Leave coaching for the Stage-4 revision executor (Skip / cap / Proceed). ──
  const handleProceed = useCallback(() => {
    persist((prev) => ({ ...prev, coachingStatus: 'proceed-revision' }))
    setPhase('proceeded')
  }, [persist])

  // ─── Render ─────────────────────────────────────────────────────────────────────

  if (phase === 'loading' || !paper || !paper.reviewReport) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading coaching…</p>
      </div>
    )
  }

  const seedMessage = buildCoachingSeed(
    paper.config,
    paper.reviewReport,
    paper.revisionRoadmap ?? [],
  )

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-8 sm:py-8">

        {/* ── Header ── */}
        <div>
          <h1 className="text-2xl font-bold mb-1 truncate">{paper.config.topic}</h1>
          <p className="text-sm text-muted-foreground">
            Stage 3→4 — Revision Coaching ·{' '}
            {paper.config.paperType.replace('_', ' ').toUpperCase()} ·{' '}
            Decision: {paper.reviewDecision}
          </p>
        </div>

        {/* ── COACHING: the bounded EIC dialogue. ── */}
        {phase === 'coaching' && (
          <CoachingThread
            systemPrompt={COACHING_SYSTEM_PROMPT}
            seedMessage={seedMessage}
            maxRounds={8}
            initialThread={paper.coachingThread ?? []}
            modelConfig={modelConfig}
            onPersist={handlePersist}
            onProceed={handleProceed}
          />
        )}

        {/* ── PROCEEDED: record the handoff + advance to the Stage-4 revision executor.
            P13 now builds /pipeline/revise, so the revision decisions navigate into the
            live revision page (mirrors how the P11 review page enters coaching). ── */}
        {phase === 'proceeded' && (
          <div
            role="status"
            className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20 p-5 space-y-3"
          >
            <p className="font-semibold text-green-800 dark:text-green-200">
              Coaching complete — advancing to revision (Stage 4)
            </p>
            <p className="text-sm text-green-700 dark:text-green-300">
              {paper.coachingRoundCount && paper.coachingRoundCount > 0
                ? `You completed ${paper.coachingRoundCount} coaching round${paper.coachingRoundCount === 1 ? '' : 's'}.`
                : 'You skipped coaching (0 rounds used).'}{' '}
              The Stage-4 revision agent will now rewrite the paper against the reviewers’ roadmap.
            </p>
            <div className="flex flex-col items-start gap-2 sm:flex-row">
              <Button data-testid="enter-revision" onClick={() => router.push('/pipeline/revise')}>
                Start Revision →
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
