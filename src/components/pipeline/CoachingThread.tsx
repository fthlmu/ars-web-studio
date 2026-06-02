'use client'

// CoachingThread — the EIC Socratic coaching dialogue (Phase P12, Stage 3→4).
//
// EE analogy: this is a bounded feedback loop. The author and the Editor-in-Chief
// exchange turns; a hard counter caps the loop at `maxRounds` so it can never run
// away, and at every point the author has an escape hatch to stop coaching and
// proceed straight to the Stage-4 revision executor.
//
// Reused by P14 with maxRounds=5 (residual coaching) — everything stage-specific
// (the system prompt, the seed message, what "proceed" does) is injected via props,
// so this component holds ONLY the dialogue + the bounded-loop invariant.
//
// The bounded-loop invariant (iron rule, FR-28) is MECHANICAL, not cosmetic:
//   - A "round" = one author reply + the EIC's response to it.
//   - roundCount is DERIVED from the thread (count of author turns), never a
//     free-floating counter that could drift out of sync with what's on screen.
//   - At roundCount === maxRounds the reply composer is REMOVED FROM THE DOM
//     (not merely disabled) and the only way forward is a manual "Proceed to
//     Revision" button. Nothing auto-advances — the human always clicks.
//
// Persistence + resume (EH-07): every completed turn is handed up via onPersist so
// the page can write it to localStorage. On reload the page passes the saved thread
// back as initialThread and the dialogue restores verbatim. A failed turn keeps all
// prior bubbles and offers a Retry that re-runs only that turn.

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { streamCoaching } from '@/lib/coaching'
import { loadModelConfig } from '@/lib/storage'
import type { CoachingMessage, ModelConfig } from '@/lib/types'

interface CoachingThreadProps {
  // The EIC coaching system prompt (COACHING_SYSTEM_PROMPT from ars-client).
  systemPrompt: string
  // The seed message that opens the dialogue (buildCoachingSeed). Sent as the first
  // user-role turn to give the EIC its grounding; NEVER shown as a visible bubble.
  seedMessage: string
  // The bounded-loop cap. 8 for P12 coaching; 5 for the P14 residual re-review coaching.
  maxRounds: number
  // The persisted dialogue so far (empty on a fresh entry; populated on resume).
  initialThread: CoachingMessage[]
  // Which model to route to. Optional — falls back to the saved model choice.
  modelConfig?: ModelConfig
  // Called after every completed turn (and before proceeding) so the page can persist.
  onPersist: (thread: CoachingMessage[], roundCount: number) => void
  // Called when the author leaves coaching for the Stage-4 revision executor
  // (round-0 Skip, an in-progress Skip, or the cap-reached Proceed all land here).
  onProceed: () => void
}

// Derive the round count from the thread: one round = one author (user) turn.
// Deriving (instead of a separate counter) guarantees the counter can never disagree
// with what is actually on screen.
function countRounds(thread: CoachingMessage[]): number {
  return thread.filter((m) => m.role === 'user').length
}

export function CoachingThread({
  systemPrompt,
  seedMessage,
  maxRounds,
  initialThread,
  modelConfig,
  onPersist,
  onProceed,
}: CoachingThreadProps) {
  // The visible dialogue. The EIC opening is the first bubble; then user/eic pairs.
  const [thread, setThread] = useState<CoachingMessage[]>(initialThread)
  // Have we left the round-0 choice screen? True immediately on resume (thread present).
  const [started, setStarted] = useState(initialThread.length > 0)
  const [draft, setDraft] = useState('')            // the in-progress author reply box
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Generation lock — prevents two coaching turns running at once.
  const isBusyRef = useRef(false)
  // The model choice, resolved once on mount (prop wins; else the saved choice).
  const modelConfigRef = useRef<ModelConfig | undefined>(modelConfig)
  // The thread state a failed turn should retry from (ends with the author turn whose
  // EIC reply failed; empty for a failed opening). Drives the EH-07 Retry button.
  const retryFromRef = useRef<CoachingMessage[] | null>(null)
  const threadEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (modelConfigRef.current === undefined) modelConfigRef.current = loadModelConfig()
  }, [])

  // Auto-scroll to the bottom as new content streams in.
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread, streaming])

  const roundCount = countRounds(thread)
  const atCap = roundCount >= maxRounds
  // The round currently in progress (for the counter). Capped for display.
  const currentRound = Math.min(roundCount + 1, maxRounds)
  // Orange warning band as the cap approaches (k >= maxRounds-1, e.g. 7 of 8).
  const nearCap = currentRound >= maxRounds - 1

  // ── Run one turn: stream the EIC reply for a thread that ends needing one ────────
  // `base` is the visible thread that should END with the turn awaiting an EIC reply:
  //   - opening:  base = []            (no author turn yet)
  //   - reply:    base = [...thread, {user: reply}]
  // We send the seed as a hidden first user turn so the model always has context.
  const runTurn = useCallback(
    async (base: CoachingMessage[]) => {
      if (isBusyRef.current) return
      isBusyRef.current = true
      setStreaming(true)
      setError(null)
      retryFromRef.current = base

      // Show an empty EIC bubble we stream into.
      setThread([...base, { role: 'eic', content: '' }])

      // The full wire history: hidden seed (user) + the visible dialogue so far.
      const history: CoachingMessage[] = [{ role: 'user', content: seedMessage }, ...base]

      try {
        const full = await streamCoaching(
          systemPrompt,
          history,
          (chunk) => {
            setThread((prev) => {
              const next = [...prev]
              const last = next[next.length - 1]
              if (last && last.role === 'eic') {
                next[next.length - 1] = { role: 'eic', content: last.content + chunk }
              }
              return next
            })
          },
          modelConfigRef.current,
        )

        const finalThread: CoachingMessage[] = [...base, { role: 'eic', content: full }]
        setThread(finalThread)
        retryFromRef.current = null
        onPersist(finalThread, countRounds(finalThread))
      } catch (err) {
        // EH-07: keep the prior bubbles (incl. the author's words in `base`) and drop
        // only the empty EIC bubble, so the author can retry this one turn.
        setError(err instanceof Error ? err.message : String(err))
        setThread(base)
      } finally {
        isBusyRef.current = false
        setStreaming(false)
      }
    },
    [seedMessage, systemPrompt, onPersist],
  )

  // ── Round-0: the author chooses to engage the coach (opening = empty base) ───────
  function handleEngage() {
    if (streaming) return
    setStarted(true)
    void runTurn([])
  }

  // ── Send an author reply (only reachable below the cap) ──────────────────────────
  function handleSend() {
    const text = draft.trim()
    if (!text || streaming || atCap) return
    const base: CoachingMessage[] = [...thread, { role: 'user', content: text }]
    setDraft('')
    void runTurn(base)
  }

  // ── Retry the failed turn, preserving every prior bubble (EH-07) ─────────────────
  function handleRetry() {
    const base = retryFromRef.current
    if (base === null || streaming) return
    void runTurn(base)
  }

  // ── Leave coaching for the Stage-4 revision executor ─────────────────────────────
  // Persist the current thread first so nothing is lost, then hand off to the page.
  function handleProceed() {
    if (streaming) return
    onPersist(thread, roundCount)
    onProceed()
  }

  // ─── Round-0 choice screen ────────────────────────────────────────────────────────
  if (!started) {
    return (
      <div className="space-y-5">
        <div className="rounded-lg border bg-card p-5 space-y-2">
          <p className="font-semibold">Revision coaching</p>
          <p className="text-sm text-muted-foreground">
            The Editor-in-Chief can coach you through this revision with up to{' '}
            <strong>{maxRounds} rounds</strong> of Socratic questions before the paper is
            revised — or you can skip straight to the revision step.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" data-testid="coaching-engage" onClick={handleEngage}>
            Engage with Coach →
          </Button>
          {/* Skip consumes 0 rounds — the thread stays empty, so roundCount stays 0. */}
          <Button
            type="button"
            data-testid="coaching-skip"
            variant="outline"
            onClick={handleProceed}
          >
            Skip — Just Fix It
          </Button>
        </div>
      </div>
    )
  }

  // ─── The dialogue ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Round counter — orange as the cap approaches. Carries a text label (NFR-17). */}
      <div className="flex items-center justify-between">
        <span
          data-testid="coaching-round-counter"
          className={`text-xs font-medium ${nearCap ? 'text-orange-600 dark:text-orange-400' : 'text-muted-foreground'}`}
        >
          {atCap ? `Round ${maxRounds} of ${maxRounds} — limit reached` : `Round ${currentRound} of ${maxRounds}`}
        </span>
      </div>

      <div className="rounded-lg border bg-muted/20 overflow-hidden">
        <div className="max-h-[60vh] overflow-y-auto px-4 py-4 space-y-4">
          {thread.map((m, i) => (
            <CoachBubble
              key={i}
              role={m.role}
              content={m.content}
              streaming={streaming && i === thread.length - 1 && m.role === 'eic'}
            />
          ))}
          <div ref={threadEndRef} />
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 space-y-2">
          <p className="text-sm font-medium text-destructive">The coach did not respond</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button type="button" size="sm" onClick={handleRetry} disabled={streaming}>
            Retry this turn
          </Button>
        </div>
      )}

      {/* ── CAP REACHED (FR-28): the reply composer is ABSENT FROM THE DOM (not disabled).
          The only way forward is the manual Proceed button — nothing auto-advances. ── */}
      {atCap ? (
        <div
          role="status"
          className="rounded-lg border border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/20 p-5 space-y-3"
        >
          <p className="font-semibold text-orange-800 dark:text-orange-200">
            Maximum coaching rounds reached — advancing to revision
          </p>
          <p className="text-sm text-orange-700 dark:text-orange-300">
            You have used all {maxRounds} coaching rounds. Click below when you are ready to
            run the Stage-4 revision.
          </p>
          <Button type="button" data-testid="coaching-proceed" onClick={handleProceed} disabled={streaming}>
            Proceed to Revision →
          </Button>
        </div>
      ) : (
        // ── Below the cap: the reply composer + an always-available Skip (verify: "Skip
        // present every round"). Both route to the same Stage-4 handoff. ──
        <div className="space-y-2">
          <Label htmlFor="coaching-reply" className="text-sm font-medium">
            Your reply
          </Label>
          <Textarea
            id="coaching-reply"
            data-testid="coaching-reply-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter inserts a newline.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="Answer the coach… (Enter to send, Shift+Enter for a new line)"
            rows={3}
            className="resize-none"
            disabled={streaming}
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              data-testid="coaching-send"
              onClick={handleSend}
              disabled={streaming || !draft.trim()}
            >
              {streaming ? 'Coaching…' : 'Send →'}
            </Button>
            <Button
              type="button"
              data-testid="coaching-skip"
              variant="outline"
              onClick={handleProceed}
              disabled={streaming}
            >
              Skip — Proceed to Revision
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// One message bubble. The EIC (coach) is left-aligned; the author (user) right-aligned.
function CoachBubble({
  role,
  content,
  streaming,
}: {
  role: 'eic' | 'user'
  content: string
  streaming: boolean
}) {
  const isUser = role === 'user'
  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={
          isUser
            ? 'max-w-[85%] rounded-lg bg-primary/10 px-3.5 py-2.5'
            : 'max-w-[85%] rounded-lg bg-background border px-3.5 py-2.5'
        }
      >
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
          {isUser ? 'You' : 'Editor-in-Chief'}
        </p>
        {/* aria-live on the streaming EIC bubble so screen readers announce the reply. */}
        <div
          aria-live={streaming ? 'polite' : undefined}
          className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed"
        >
          {content || (streaming ? <span className="text-muted-foreground italic">Thinking…</span> : null)}
          {streaming && (
            <span className="inline-block w-0.5 h-4 bg-orange-400 ml-0.5 animate-pulse align-middle" />
          )}
        </div>
      </div>
    </div>
  )
}
