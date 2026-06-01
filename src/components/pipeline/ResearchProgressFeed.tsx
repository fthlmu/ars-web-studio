'use client'

// ResearchProgressFeed — live progress display for the Stage-1 research pipeline.
// Shows a 10-minute advisory banner, a per-agent status list, a streaming text
// panel (aria-live), and a caption about the 5-of-13 agent subset.
// NFR-04: non-blocking advisory panel; NFR-17: all status indicators have text labels.

// ── Prop types ────────────────────────────────────────────────────────────────

export interface ResearchProgressFeedProps {
  /** Ordered list of agent step names, e.g. ['Research Question', 'Literature Search', ...] */
  steps: { name: string }[]
  /** Index of the currently active step (0-based). -1 = not yet started. */
  currentIndex: number
  /** Total number of steps (should equal steps.length; kept explicit for clarity). */
  total: number
  /** Raw text streaming from the currently active agent. Reset between agents. */
  streamingText: string
  /** True while any agent is actively running. */
  running: boolean
}

// ── Status helpers ────────────────────────────────────────────────────────────

// Each step can be in one of three states from the perspective of this display.
type StepState = 'done' | 'active' | 'pending'

function getStepState(idx: number, currentIndex: number, running: boolean): StepState {
  if (idx < currentIndex) return 'done'
  if (idx === currentIndex && running) return 'active'
  return 'pending'
}

// Text symbols + labels kept together so NFR-17 (no icon-only status) is guaranteed.
// Think of these as status LEDs on RF test gear: each has a light AND a silk-screen label.
const STATUS_SYMBOL: Record<StepState, string> = {
  done:    '✓',
  active:  '▶',
  pending: '○',
}
const STATUS_LABEL: Record<StepState, string> = {
  done:    'Done',
  active:  'Active',
  pending: 'Pending',
}
const STATUS_COLOR: Record<StepState, string> = {
  done:    'text-green-600 dark:text-green-400',
  active:  'text-blue-600 dark:text-blue-400',
  pending: 'text-muted-foreground',
}
const ROW_BG: Record<StepState, string> = {
  done:    'bg-background',
  active:  'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800',
  pending: 'bg-background',
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ResearchProgressFeed({
  steps,
  currentIndex,
  total,
  streamingText,
  running,
}: ResearchProgressFeedProps) {
  return (
    <div className="space-y-4">

      {/* ── Advisory banner (NFR-04: non-blocking, informational only) ── */}
      <div
        role="note"
        className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-4 py-3"
      >
        <p className="text-sm text-amber-800 dark:text-amber-200 font-medium">
          Stage 1 research can take up to ~10 minutes. You can keep this tab open.
        </p>
        <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
          The pipeline is running in the background. Results appear below as each agent
          finishes. Do not close the tab while research is in progress.
        </p>
      </div>

      {/* ── Per-agent step list ── */}
      {/* Each row shows "Agent N of total — <name>" with a text-labeled status icon. */}
      <div className="space-y-1">
        {steps.map((step, idx) => {
          const state = getStepState(idx, currentIndex, running)
          const humanN = idx + 1  // 1-based display number

          return (
            <div
              key={step.name}
              className={`flex items-center gap-3 rounded-md border px-4 py-2.5 transition-colors ${ROW_BG[state]}`}
            >
              {/* Status symbol — always paired with a text label (NFR-17) */}
              <span
                className={`text-base shrink-0 ${STATUS_COLOR[state]}`}
                aria-hidden="true"
              >
                {STATUS_SYMBOL[state]}
              </span>

              {/* Step identifier: "Agent N of total — Name" */}
              <span
                className={`flex-1 text-sm font-medium ${
                  state === 'pending' ? 'text-muted-foreground' : 'text-foreground'
                }`}
              >
                {`Agent ${humanN} of ${total} — ${step.name}`}
              </span>

              {/* Text status label on the right (NFR-17: always a visible word) */}
              <span
                className={`text-xs font-medium shrink-0 ${STATUS_COLOR[state]}`}
              >
                {/* Pulse the "Active" label while the step is running */}
                <span className={state === 'active' ? 'animate-pulse' : undefined}>
                  {STATUS_LABEL[state]}
                </span>
              </span>
            </div>
          )
        })}
      </div>

      {/* ── Streaming text panel ── */}
      {/* aria-live="polite" so screen readers announce new chunks without interrupting. */}
      {/* Shown whenever running is true (even if streamingText is empty yet). */}
      {running && (
        <div className="rounded-lg border bg-muted/20 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
            <span className="text-sm font-semibold">
              {currentIndex >= 0 && currentIndex < steps.length
                ? `${steps[currentIndex].name} — live output`
                : 'Agent output'}
            </span>
            <span className="text-xs text-blue-500 font-medium animate-pulse">
              Generating…
            </span>
          </div>

          <div
            aria-live="polite"
            aria-label="Live agent output"
            aria-atomic="false"
            className="px-4 py-3 text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto font-mono"
          >
            {streamingText
              ? (
                <>
                  {streamingText}
                  {/* Blinking cursor — decorative, hidden from screen readers */}
                  <span
                    aria-hidden="true"
                    className="inline-block w-0.5 h-4 bg-blue-400 ml-0.5 animate-pulse align-middle"
                  />
                </>
              )
              : (
                <span className="text-muted-foreground italic">
                  Waiting for agent response…
                </span>
              )
            }
          </div>
        </div>
      )}

      {/* ── 5-of-13 subset caption ── */}
      {/* Explains why this feed shows fewer steps than the full ARS deep-research suite. */}
      <p className="text-xs text-muted-foreground text-center">
        The ARS deep-research skill has 13 agents in total. This app runs a focused
        5-agent web-based subset optimised for single-user paper generation.
      </p>

    </div>
  )
}
