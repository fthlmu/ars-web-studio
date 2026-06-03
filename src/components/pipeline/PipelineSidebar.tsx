'use client'

// P18.6/7 — the persistent 12-checkpoint pipeline sidebar.
//
// Driven by checkpointIndex (0..12): the checkpoint at array position `checkpointIndex`
// is CURRENT, everything before it is CLEARED, everything after is UPCOMING. A failed
// gate (2.5 / 4.5) renders the current row as ✗. Research that was never run renders as
// — (skipped). Each status icon carries a text label (NFR-17). Always-visible loop/round
// counters sit under the tracker (SC-X-03).

import type { PaperState } from '@/lib/types'
import {
  CHECKPOINTS,
  deriveCheckpointIndex,
  derivePipelineStatus,
  pipelineStatusLabel,
  MAX_REVISION_LOOPS,
  MAX_COACHING_ROUNDS,
  MAX_RESIDUAL_COACHING_ROUNDS,
} from '@/lib/pipeline-router'
import { MaterialPassportPanel } from './MaterialPassportPanel'

type CPState = 'cleared' | 'current' | 'upcoming' | 'skipped' | 'failed'

// Text-labeled status marks (NFR-17): the symbol is decoration, the word is the signal.
const MARK: Record<CPState, { sym: string; word: string; cls: string }> = {
  cleared:  { sym: '✓', word: 'cleared',  cls: 'text-green-600 dark:text-green-400' },
  current:  { sym: '●', word: 'current',  cls: 'text-blue-600 dark:text-blue-400 font-semibold' },
  upcoming: { sym: '◌', word: 'upcoming', cls: 'text-muted-foreground' },
  skipped:  { sym: '—', word: 'skipped',  cls: 'text-muted-foreground' },
  failed:   { sym: '✗', word: 'failed',   cls: 'text-red-600 dark:text-red-400 font-semibold' },
}

function checkpointState(paper: PaperState, cpIndex: number, currentIndex: number): CPState {
  // CP-01 research is "skipped" if the flow has advanced past it but research never ran
  // (the legacy intake→outline path never enters the research stage).
  if (cpIndex === 0 && currentIndex > 0 && !paper.researchStatus && !paper.researchApproved) {
    return 'skipped'
  }
  if (cpIndex < currentIndex) return 'cleared'
  if (cpIndex > currentIndex) return 'upcoming'
  // The current checkpoint — flag a failed gate explicitly.
  const failedGate =
    (CHECKPOINTS[cpIndex].id === 'CP-05' && paper.integrityStatus === 'failed') ||
    (CHECKPOINTS[cpIndex].id === 'CP-11' && paper.finalIntegrityStatus === 'failed')
  return failedGate ? 'failed' : 'current'
}

export function PipelineSidebar({ paper }: { paper: PaperState }) {
  const currentIndex = deriveCheckpointIndex(paper)
  const status = derivePipelineStatus(paper)

  const revisionLoop = paper.revisionLoopCount ?? 0
  const coachingRound = paper.coachingRoundCount ?? 0
  const residualRound = paper.residualCoachingRoundCount ?? 0

  return (
    <nav
      aria-label="Pipeline checkpoints"
      className="space-y-4"
    >
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
          Pipeline
        </h2>
        <p className="text-xs text-muted-foreground" data-testid="pipeline-current-status">
          {pipelineStatusLabel(status)} · {Math.min(currentIndex, 12)} of 12 cleared
        </p>
      </div>

      <ol className="space-y-1.5" data-testid="checkpoint-tracker">
        {CHECKPOINTS.map((cp, i) => {
          const st = checkpointState(paper, i, currentIndex)
          const mark = MARK[st]
          return (
            <li
              key={cp.id}
              data-testid={`checkpoint-${cp.id}`}
              data-state={st}
              aria-current={st === 'current' ? 'step' : undefined}
              className="flex items-start gap-2 text-sm"
            >
              <span className={`mt-0.5 w-4 text-center ${mark.cls}`} aria-hidden="true">{mark.sym}</span>
              <span className="flex-1">
                <span className={st === 'current' || st === 'failed' ? 'font-medium' : 'text-foreground/80'}>
                  {cp.label}
                </span>
                {/* Text label for the status icon (NFR-17), available to screen readers. */}
                <span className="sr-only"> — {mark.word}</span>
                <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">{mark.word}</span>
              </span>
            </li>
          )
        })}
      </ol>

      {/* Always-visible loop / round counters (SC-X-03). */}
      <div className="space-y-1 border-t pt-3 text-xs" data-testid="loop-counters">
        <p data-testid="revision-loop-counter" className={revisionLoop >= MAX_REVISION_LOOPS ? 'text-orange-600 dark:text-orange-400 font-semibold' : 'text-muted-foreground'}>
          Revision Loop {revisionLoop} of {MAX_REVISION_LOOPS}
        </p>
        {(status === 'coaching' || coachingRound > 0) && (
          <p data-testid="coaching-round-counter" className={coachingRound >= MAX_COACHING_ROUNDS ? 'text-orange-600 dark:text-orange-400 font-semibold' : 'text-muted-foreground'}>
            Coaching Round {coachingRound}/{MAX_COACHING_ROUNDS}
          </p>
        )}
        {(paper.residualCoachingStatus !== undefined || residualRound > 0) && (
          <p data-testid="residual-round-counter" className={residualRound >= MAX_RESIDUAL_COACHING_ROUNDS ? 'text-orange-600 dark:text-orange-400 font-semibold' : 'text-muted-foreground'}>
            Residual Coaching Round {residualRound}/{MAX_RESIDUAL_COACHING_ROUNDS}
          </p>
        )}
      </div>

      <MaterialPassportPanel paper={paper} />
    </nav>
  )
}
