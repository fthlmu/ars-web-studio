'use client'

// Stage-1 Research page — the FIRST gate of the paper pipeline (Phase P9).
//
// Think of this like the calibration stage of an instrument: before the main
// measurement (writing the paper) runs, we must run a 5-agent research pass and
// have the human SIGN OFF on the result. Nothing auto-advances (FR-03) — the user
// must tick three review checkboxes before the "Approve Research" button unlocks.
//
// State machine (high level):
//   loading           → reading saved paper from localStorage, deciding what to do
//   running           → runResearch() is streaming the 5 agents; partials are saved
//   awaiting-approval → all 3 artifacts ready; show cards + the 3-checkbox gate
//   approved          → user signed off; persist + navigate to /pipeline (outline stage)
//   error             → a ResearchStageError was thrown; offer retry-from-checkpoint
//   blocked           → "No verifiable sources" — only action is Return to Intake (EH-01)
//
// FR-04 skip: if the saved research is already approved AND its input fingerprint
// (researchInputHash) still matches the current config, the research is "current"
// and we jump straight to /pipeline without re-running anything.

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RQBriefCard } from '@/components/pipeline/RQBriefCard'
import { BibliographyBrowser } from '@/components/pipeline/BibliographyBrowser'
import { SynthesisReportView } from '@/components/pipeline/SynthesisReport'
import { ResearchProgressFeed } from '@/components/pipeline/ResearchProgressFeed'
import { runResearch, ResearchStageError } from '@/lib/ars-client'
import {
  loadPaper,
  savePaper,
  loadModelConfig,
  researchInputHash,
} from '@/lib/storage'
import type {
  PaperState,
  ModelConfig,
  RQBrief,
  Bibliography,
  SynthesisReport,
  ResearchResult,
} from '@/lib/types'

// ─── Constants ──────────────────────────────────────────────────────────────────

// The 5 research agents, in order. Must match RESEARCH_STEP_NAMES in ars-client.
// We keep our own copy here only to render the progress feed (names + count).
const RESEARCH_STEPS: { name: string }[] = [
  { name: 'Research Question' },
  { name: 'Literature Search' },
  { name: 'Source Verification' },
  { name: 'Synthesis' },
  { name: 'Methodology' },
]
const TOTAL_STEPS = RESEARCH_STEPS.length

// The marker the M2 guard puts in the error message when nothing could be verified.
// If we see this, the only safe path is back to intake (EH-01) — no retry.
const NO_SOURCES_MARKER = 'No verifiable sources'

// ─── Page-level UI state machine ─────────────────────────────────────────────────
// A simple enum-like union (like a state register in a controller). Each value
// drives which block renders below.
type Phase =
  | 'loading'
  | 'running'
  | 'awaiting-approval'
  | 'approved'
  | 'error'
  | 'blocked'

// ─── Component ────────────────────────────────────────────────────────────────────

export default function ResearchPage() {
  const router = useRouter()

  // The full paper state (config + research artifacts). Single source of truth.
  const [paper, setPaper] = useState<PaperState | null>(null)

  // Which top-level phase the page is in (see Phase union above).
  const [phase, setPhase] = useState<Phase>('loading')

  // The three Stage-1 artifacts, shown once available.
  const [rqBrief, setRqBrief] = useState<RQBrief | null>(null)
  const [bibliography, setBibliography] = useState<Bibliography | null>(null)
  const [synthesis, setSynthesis] = useState<SynthesisReport | null>(null)

  // Live progress: which agent is active (0-based) and the streaming text.
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [streamingText, setStreamingText] = useState('')

  // Error recovery state. errorMessage drives the error banner; failedIndex tells
  // "Retry from checkpoint" where to resume from (the agent that failed).
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const failedIndexRef = useRef(0)
  const partialRef = useRef<Partial<ResearchResult>>({})

  // The three acknowledge checkboxes — the human sign-off gate (P9.10, FR-10).
  const [ack1, setAck1] = useState(false) // reviewed RQ + FINER scores
  const [ack2, setAck2] = useState(false) // reviewed bibliography + verification
  const [ack3, setAck3] = useState(false) // reviewed synthesis themes/gaps/debates

  // ── refs (avoid stale closures inside async callbacks; mirror legacy page) ──

  // Generation lock — prevents two runResearch() loops at once.
  const isRunningRef = useRef(false)

  // StrictMode double-mount guard. In dev, React runs the mount effect twice; the
  // second run sees this !== null and exits, so research never double-runs.
  const paperRef = useRef<PaperState | null>(null)

  // Latest model choice — loaded once on mount, passed to runResearch.
  const modelConfigRef = useRef<ModelConfig | undefined>(undefined)

  // Latest input fingerprint, so the approve handler stamps the right hash.
  const hashRef = useRef('')

  // Name of the agent currently streaming. Used to reset the streaming panel when
  // a NEW agent starts (so each agent's output starts on a clean panel).
  const activeAgentRef = useRef<string | null>(null)

  // ─── Persist helper (immutable update + localStorage write) ─────────────────────
  // Mirrors the legacy pipeline page: update the ref, mirror to state, then save.
  const persist = useCallback((updater: (prev: PaperState) => PaperState) => {
    if (!paperRef.current) return
    const next = updater(paperRef.current)
    next.updatedAt = new Date().toISOString()
    paperRef.current = next
    setPaper(next)
    savePaper(next)
  }, [])

  // ─── Run the research pipeline (fresh run or resume-from-checkpoint) ────────────
  // resume is set ONLY by the "Retry from checkpoint" button. A fresh run passes
  // nothing and starts at agent 0.
  const startResearch = useCallback(
    async (
      config: PaperState['config'],
      resume?: { startIndex: number; prior: Partial<ResearchResult> },
    ) => {
      if (isRunningRef.current) return
      isRunningRef.current = true

      // Reset error/progress UI for this attempt.
      setErrorMessage(null)
      setPhase('running')
      setCurrentIndex(resume?.startIndex ?? 0)
      setStreamingText('')
      activeAgentRef.current = null // force a panel reset for the first agent of this run

      // Seed the partial accumulator from a resume (so we don't lose earlier agents).
      partialRef.current = resume?.prior ?? {}

      try {
        const result = await runResearch(
          config,
          {
            // onProgress: fires before a step (completed = i) and after (completed = i+1).
            // currentIndex tracks the agent we are "on" for the feed.
            onProgress: (p) => {
              // completed counts FINISHED agents; the active agent index is `completed`
              // while running. Clamp to the last index so the feed never overflows.
              setCurrentIndex(Math.min(p.completed, TOTAL_STEPS - 1))
            },
            // onAgentChunk: reset the streaming panel when a new agent starts, then
            // append its chunks. "New agent" = the agentName differs from the one we
            // were last streaming (tracked in activeAgentRef).
            onAgentChunk: (agentName, chunk) => {
              if (activeAgentRef.current !== agentName) {
                // A different agent is now talking — clear the panel and start fresh.
                activeAgentRef.current = agentName
                setStreamingText(chunk)
              } else {
                setStreamingText((prev) => prev + chunk)
              }
            },
            // onArtifact: accumulate partials into state AND persist them, so a reload
            // mid-run keeps whatever finished (DR-01 / partial recovery).
            onArtifact: (partial) => {
              partialRef.current = { ...partialRef.current, ...partial }
              if (partial.rqBrief) setRqBrief(partial.rqBrief)
              if (partial.bibliography) setBibliography(partial.bibliography)
              if (partial.synthesis) setSynthesis(partial.synthesis)
              persist((prev) => ({
                ...prev,
                rqBrief: partial.rqBrief ?? prev.rqBrief,
                bibliography: partial.bibliography ?? prev.bibliography,
                synthesis: partial.synthesis ?? prev.synthesis,
                researchStatus: 'running',
              }))
            },
          },
          modelConfigRef.current,
          resume,
        )

        // ── Success: all 5 agents finished. Stamp artifacts + hash, await approval. ──
        setRqBrief(result.rqBrief)
        setBibliography(result.bibliography)
        setSynthesis(result.synthesis)
        setPhase('awaiting-approval')
        persist((prev) => ({
          ...prev,
          rqBrief: result.rqBrief,
          bibliography: result.bibliography,
          synthesis: result.synthesis,
          researchHash: hashRef.current,
          researchStatus: 'awaiting-approval',
        }))
      } catch (err) {
        // ResearchStageError carries the failed agent index + partial accumulator,
        // so we can resume from exactly where it broke (EH-01).
        if (err instanceof ResearchStageError) {
          failedIndexRef.current = err.failedIndex
          partialRef.current = err.partial

          // Persist whatever partial work survived so a reload keeps it.
          persist((prev) => ({
            ...prev,
            rqBrief: err.partial.rqBrief ?? prev.rqBrief,
            bibliography: err.partial.bibliography ?? prev.bibliography,
            synthesis: err.partial.synthesis ?? prev.synthesis,
            researchStatus: 'error',
          }))
          if (err.partial.rqBrief) setRqBrief(err.partial.rqBrief)
          if (err.partial.bibliography) setBibliography(err.partial.bibliography)
          if (err.partial.synthesis) setSynthesis(err.partial.synthesis)

          setErrorMessage(err.message)
          // "No verifiable sources" is a dead end — block with only a Return to Intake.
          setPhase(err.message.includes(NO_SOURCES_MARKER) ? 'blocked' : 'error')
          console.error('Research stage failed at agent', err.failedIndex, err)
        } else {
          // Any other (unexpected) error — show a generic retry from the start.
          const msg = err instanceof Error ? err.message : String(err)
          failedIndexRef.current = 0
          partialRef.current = {}
          setErrorMessage(msg)
          setPhase('error')
          persist((prev) => ({ ...prev, researchStatus: 'error' }))
          console.error('Research failed (non-stage error):', err)
        }
      } finally {
        isRunningRef.current = false
        setStreamingText('')
      }
    },
    [persist],
  )

  // ─── Mount: load paper, decide skip / cached / fresh run ────────────────────────
  useEffect(() => {
    // StrictMode guard: paperRef is set below before any async work. The second
    // (dev-only) effect run sees it non-null and bails, preventing double-run.
    if (paperRef.current !== null) return

    const saved = loadPaper()
    if (!saved) {
      router.replace('/intake')
      return
    }

    paperRef.current = saved
    modelConfigRef.current = loadModelConfig()

    const hash = researchInputHash(saved.config)
    hashRef.current = hash

    queueMicrotask(() => {
      setPaper(saved)

      // ── FR-04 skip: already-approved research that still matches the inputs. ──
      // The research is "current"; jump straight to the outline/generation stage.
      if (saved.researchApproved && saved.researchHash === hash && saved.bibliography) {
        router.replace('/pipeline')
        return
      }

      // ── Cached but UNAPPROVED research with a matching hash: show for approval. ──
      // Do NOT re-run — just hydrate the cards and present the gate.
      if (saved.bibliography && saved.researchHash === hash) {
        if (saved.rqBrief) setRqBrief(saved.rqBrief)
        setBibliography(saved.bibliography)
        if (saved.synthesis) setSynthesis(saved.synthesis)
        setPhase('awaiting-approval')
        return
      }

      // ── Otherwise: run the research pipeline fresh. ──
      startResearch(saved.config)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Bibliography exclude toggle (FR-08) ────────────────────────────────────────
  // Flip a source's `excluded` flag in local state AND persist. This is a UI-local
  // decision (which sources to keep), preserved into the approved bibliography.
  const handleToggleExclude = useCallback(
    (id: string, excluded: boolean) => {
      setBibliography((prev) => {
        if (!prev) return prev
        const next: Bibliography = {
          ...prev,
          sources: prev.sources.map((s) =>
            s.id === id ? { ...s, excluded } : s,
          ),
        }
        // Persist the exclusion immediately so a reload remembers it. Editing the
        // source set invalidates any prior approval: the FR-04 skip trusts
        // researchApproved, and the hash only covers topic+question (not excludes),
        // so we clear researchApproved here to force a fresh 3-box sign-off on the
        // exclude-adjusted bibliography (FR-03 — the human must approve the result).
        persist((p) => ({ ...p, bibliography: next, researchApproved: false }))
        return next
      })
    },
    [persist],
  )

  // ─── Retry from checkpoint (EH-01) ──────────────────────────────────────────────
  // Resume runResearch from the agent that failed, reusing the partial accumulator.
  const handleRetryFromCheckpoint = useCallback(() => {
    if (!paperRef.current) return
    startResearch(paperRef.current.config, {
      startIndex: failedIndexRef.current,
      prior: partialRef.current,
    })
  }, [startResearch])

  // ─── Approve research (P9.10, FR-10) — the human sign-off gate ──────────────────
  // Only callable once all three acknowledge boxes are ticked. Persists the approval
  // + the (exclude-adjusted) bibliography, then advances to the outline stage.
  // Single source of truth for the gate condition — reused by BOTH the button's
  // disabled state and the handler guard so they can never drift apart.
  const allAcknowledged = ack1 && ack2 && ack3

  const handleApprove = useCallback(() => {
    // Defense-in-depth: the button is also disabled, but the handler independently
    // refuses unless all three boxes are ticked AND a full artifact set exists, so
    // it is safe regardless of where it might be invoked from.
    if (!(allAcknowledged && rqBrief && bibliography && synthesis)) return

    setPhase('approved')
    persist((prev) => ({
      ...prev,
      rqBrief,
      bibliography, // current exclude-adjusted bibliography
      synthesis,
      researchApproved: true,
      researchStatus: 'approved',
      researchHash: hashRef.current,
    }))
    router.push('/pipeline')
  }, [allAcknowledged, bibliography, rqBrief, synthesis, persist, router])

  // ─── Render ─────────────────────────────────────────────────────────────────────

  // Loading / redirect-in-progress: nothing meaningful to show yet.
  if (phase === 'loading' || !paper) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading research…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-8 sm:py-8">

        {/* ── Header ── */}
        <div>
          <h1 className="text-2xl font-bold mb-1 truncate">{paper.config.topic}</h1>
          <p className="text-sm text-muted-foreground">
            Stage 1 — Research ·{' '}
            {paper.config.paperType.replace('_', ' ').toUpperCase()} ·{' '}
            {paper.config.citationFormat}
          </p>
        </div>

        {/* ── BLOCKED: no verifiable sources (EH-01). Only action: Return to Intake. ── */}
        {phase === 'blocked' && (
          <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-5 space-y-3">
            <p className="font-semibold text-destructive">Research cannot continue</p>
            <p className="text-sm text-muted-foreground">
              {errorMessage ??
                'No verifiable sources were found for this topic.'}{' '}
              The pipeline needs at least one verifiable source before it can build a
              bibliography. Please return to intake and refine your topic or research
              question, then try again.
            </p>
            <Button onClick={() => router.push('/intake')}>Return to Intake</Button>
          </div>
        )}

        {/* ── ERROR: recoverable failure. Offer retry-from-checkpoint + return. ── */}
        {phase === 'error' && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-5 space-y-3">
            <p className="font-semibold text-destructive">Research stage failed</p>
            <p className="text-sm text-muted-foreground">{errorMessage}</p>
            <p className="text-xs text-muted-foreground">
              You can resume from the agent that failed — earlier results are kept.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button onClick={handleRetryFromCheckpoint}>
                Retry from checkpoint (Agent {failedIndexRef.current + 1})
              </Button>
              <Button variant="outline" onClick={() => router.push('/intake')}>
                Return to Intake
              </Button>
            </div>
          </div>
        )}

        {/* ── RUNNING: live per-agent progress feed + streaming output. ── */}
        {phase === 'running' && (
          <ResearchProgressFeed
            steps={RESEARCH_STEPS}
            currentIndex={currentIndex}
            total={TOTAL_STEPS}
            streamingText={streamingText}
            running={true}
          />
        )}

        {/* ── ARTIFACT CARDS ──
            Shown once available (awaiting-approval, or partials while error/blocked).
            These are read-only summaries the human reviews before signing off. */}
        {(phase === 'awaiting-approval' || phase === 'error' || phase === 'blocked') && (
          <div className="space-y-6">
            {rqBrief && <RQBriefCard brief={rqBrief} />}

            {bibliography && (
              <Card>
                <CardHeader>
                  <CardTitle>Bibliography</CardTitle>
                </CardHeader>
                <CardContent>
                  <BibliographyBrowser
                    bibliography={bibliography}
                    onToggleExclude={handleToggleExclude}
                  />
                </CardContent>
              </Card>
            )}

            {synthesis && (
              <Card>
                <CardHeader>
                  <CardTitle>Synthesis</CardTitle>
                </CardHeader>
                <CardContent>
                  <SynthesisReportView synthesis={synthesis} />
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* ── APPROVAL GATE (P9.10, FR-10) ──
            Three acknowledge checkboxes. "Approve Research" stays DISABLED until all
            three are ticked. No auto-advance (FR-03). "Return to Intake" shown only
            pre-approval. Only rendered when we have a full set ready for review. */}
        {phase === 'awaiting-approval' && rqBrief && bibliography && synthesis && (
          <Card>
            <CardHeader>
              <CardTitle>Approve Research</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Review each part above, then confirm. Nothing advances until you
                approve — this is the human sign-off gate for Stage 1.
              </p>

              {/* Acknowledge checkbox 1 — research question + FINER scores */}
              <label className="flex items-start gap-3 cursor-pointer">
                <Checkbox
                  checked={ack1}
                  onCheckedChange={(c: boolean) => setAck1(c)}
                  aria-label="I reviewed the research question and FINER scores"
                  className="mt-0.5"
                />
                <span className="text-sm">
                  I reviewed the research question and FINER scores
                </span>
              </label>

              {/* Acknowledge checkbox 2 — bibliography + verification */}
              <label className="flex items-start gap-3 cursor-pointer">
                <Checkbox
                  checked={ack2}
                  onCheckedChange={(c: boolean) => setAck2(c)}
                  aria-label="I reviewed the bibliography and source verification status"
                  className="mt-0.5"
                />
                <span className="text-sm">
                  I reviewed the bibliography and source verification status
                </span>
              </label>

              {/* Acknowledge checkbox 3 — synthesis themes/gaps/debates */}
              <label className="flex items-start gap-3 cursor-pointer">
                <Checkbox
                  checked={ack3}
                  onCheckedChange={(c: boolean) => setAck3(c)}
                  aria-label="I reviewed the synthesis themes, gaps, and debates"
                  className="mt-0.5"
                />
                <span className="text-sm">
                  I reviewed the synthesis themes, gaps, and debates
                </span>
              </label>

              <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center">
                {/* Approve stays DISABLED until all three boxes are ticked (the gate). */}
                <Button onClick={handleApprove} disabled={!allAcknowledged}>
                  Approve Research →
                </Button>
                {/* Return to Intake shown ONLY pre-approval. */}
                <Button variant="outline" onClick={() => router.push('/intake')}>
                  Return to Intake
                </Button>
                {!allAcknowledged && (
                  <span className="text-xs text-muted-foreground">
                    Tick all three boxes to enable approval.
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── APPROVED: brief confirmation while we navigate to the outline stage. ── */}
        {phase === 'approved' && (
          <div role="status" className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20 p-5 text-center space-y-2">
            <p className="font-semibold text-green-800 dark:text-green-200">
              Research approved
            </p>
            <p className="text-sm text-green-700 dark:text-green-300">
              Advancing to outline generation…
            </p>
          </div>
        )}

      </div>
    </div>
  )
}
