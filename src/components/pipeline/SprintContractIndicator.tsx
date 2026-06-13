'use client'

// SprintContractIndicator — tiny presentational banner for Stage 3 (Review).
//
// EE analogy: the Sprint Contract is a two-phase calibration. In Phase 1 the
// reviewers write down HOW they will measure (the scoring plan) BEFORE the
// device-under-test (the paper) is connected — a paper-blind pre-commitment so
// they can't tune the rubric to flatter the result. In Phase 2 the paper is
// connected and measured against that pre-committed plan. This component just
// shows which phase is energized right now.
//
// FR-22: presentational only — no state, no I/O. The parent page owns the run.
// NFR-17: the "committed" status is shown as a TEXT badge, never colour alone.

import { FileCheck, ScrollText } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

// ── Prop types ──────────────────────────────────────────────────────────────

interface Props {
  /** Which Sprint-Contract phase is active. phase1 = paper-blind, phase2 = paper-visible. */
  phase: 'phase1' | 'phase2'
  /** Phase-2 only: true once the Phase-1 scoring plan has been committed (shows a badge). */
  committed?: boolean
}

// ── Component ───────────────────────────────────────────────────────────────

export function SprintContractIndicator({ phase, committed }: Props) {
  // Pick the icon + copy for the active phase. Kept as plain locals (not a map)
  // so the two short branches stay easy to read for a beginner web dev.
  const isPhase1 = phase === 'phase1'
  const Icon = isPhase1 ? ScrollText : FileCheck
  const headline = isPhase1
    ? 'Reviewers are committing a scoring plan…'
    : 'Reviewers are now evaluating the paper'
  const sub = isPhase1
    ? 'Paper-blind pre-commitment (Sprint Contract). The reviewers commit how they will score BEFORE they see the paper.'
    : 'Paper-visible review against the committed scoring plan.'

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {/* Decorative icon — the headline text carries the meaning (NFR-17). */}
          <Icon className="size-4 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          {/* aria-live="polite" so a screen reader announces the phase swap without interrupting. */}
          <span aria-live="polite">{headline}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">{sub}</p>

        {/* Phase 2 only: a TEXT-labelled badge confirming the plan was committed. */}
        {!isPhase1 && committed && (
          <Badge variant="secondary" className="shrink-0">
            <FileCheck className="size-3" aria-hidden="true" />
            Scoring plan committed
          </Badge>
        )}
      </CardContent>
    </Card>
  )
}
