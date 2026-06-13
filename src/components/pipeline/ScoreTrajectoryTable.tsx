'use client'

// ScoreTrajectoryTable — the Stage-3 → Stage-3' per-dimension comparison (P14.4).
//
// EE analogy: this is a before/after bench sweep. Each rubric dimension is a channel;
// we plot its Stage-3 reading next to its Stage-3' reading and show the delta. A drop
// of MORE THAN 3 points on any channel trips a red "regression" flag — a MANDATORY
// MANUAL CHECKPOINT, not a hard block: the panel still lets the human Accept, but it
// must be a deliberate choice made while looking at the regression.
//
// IRON-RULE note: this component is PRESENTATIONAL. The trajectory is computed in
// software by computeScoreTrajectory() in ars-client (never trusted from the agent),
// and the regression threshold lives here as one named constant so the flag and the
// copy can never drift apart.

import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import type { ScoreTrajectoryEntry } from '@/lib/types'

// A dimension REGRESSES when its score dropped by MORE THAN this many points
// (delta < -REGRESSION_THRESHOLD). Kept as one constant so the badge and the
// summary copy stay in sync (FR-35).
const REGRESSION_THRESHOLD = 3

interface Props {
  trajectory: ScoreTrajectoryEntry[]
}

// True when a row regressed by more than the threshold (a >3-point drop).
function isRegression(delta: number): boolean {
  return delta < -REGRESSION_THRESHOLD
}

// Render the delta with a sign and a text-labelled direction (NFR-17: never color alone).
function deltaLabel(delta: number): string {
  if (delta > 0) return `+${delta} (improved)`
  if (delta < 0) return `${delta} (dropped)`
  return '0 (no change)'
}

export function ScoreTrajectoryTable({ trajectory }: Props) {
  const regressed = trajectory.filter((t) => isRegression(t.delta))

  return (
    <section aria-labelledby="score-trajectory-heading" className="space-y-3">
      <h3 id="score-trajectory-heading" className="text-sm font-semibold">
        Score Trajectory — Stage 3 → Stage 3′
      </h3>

      {/* Mandatory-checkpoint banner: rendered only when at least one dimension regressed
          by more than the threshold. role="status" — advisory, NOT a block (Accept stays). */}
      {regressed.length > 0 && (
        <div
          role="status"
          data-testid="score-regression-flag"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <p className="font-semibold">
            Score regression — manual review required
          </p>
          <p className="text-destructive/90">
            {regressed.map((t) => t.dimension).join(', ')}{' '}
            {regressed.length === 1 ? 'dropped' : 'each dropped'} by more than{' '}
            {REGRESSION_THRESHOLD} points after the revision. Review the change before accepting.
          </p>
        </div>
      )}

      <div className="rounded-md border">
        <Table data-testid="score-trajectory-table">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[16rem]">Dimension</TableHead>
              <TableHead>Stage 3</TableHead>
              <TableHead>Stage 3′</TableHead>
              <TableHead>Delta</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trajectory.map((t) => {
              const regression = isRegression(t.delta)
              return (
                <TableRow key={t.dimension}>
                  <TableCell className="font-medium">{t.dimension}</TableCell>
                  <TableCell className="tabular-nums">{t.stage3}/100</TableCell>
                  <TableCell className="tabular-nums">{t.stage3Prime}/100</TableCell>
                  <TableCell className="tabular-nums">
                    {regression ? (
                      <Badge variant="destructive">{deltaLabel(t.delta)}</Badge>
                    ) : (
                      <span
                        className={
                          t.delta > 0
                            ? 'text-green-700 dark:text-green-400'
                            : 'text-muted-foreground'
                        }
                      >
                        {deltaLabel(t.delta)}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}
