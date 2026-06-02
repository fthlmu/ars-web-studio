'use client'

// ReReviewPanel — the Stage-3' narrow re-review readout (P14.3).
//
// After a revision is approved (with one loop still available), a NARROW panel
// (EIC + R1 + R2, plus DA only if a DA-CRITICAL fired at Stage 3) re-scores the
// REVISED draft. This component shows:
//   • one card per re-review reviewer, with their overall score AND the delta vs the
//     SAME role's Stage-3 overall (e.g. "↑ +8 · 72→80");
//   • the R&R Traceability Matrix — one row per original reviewer comment → what the
//     revision did → a Resolved / Partially Resolved / Unresolved verdict;
//   • the residual-issues list the re-review still flags (or "None").
//
// IRON RULE: this component is PRESENTATIONAL. It consumes the `decision` prop from
// deriveReviewDecision() (the single source of truth) and renders NO routing buttons —
// those live in the re-review page (P14.6). The Score Trajectory is rendered by the
// separate ScoreTrajectoryTable component (P14.4), composed alongside this panel.

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import type { ReviewDecision } from '@/lib/review'
import type {
  ReviewerRole,
  ReviewerScoreSet,
  RRResolutionStatus,
} from '@/lib/types'

interface Props {
  // The Stage-3' re-review report (narrow team + rrMatrix + residualIssues).
  reReview: ReviewerScoreSet
  // The original Stage-3 review — used to compute each role's overall-score delta.
  stage3: ReviewerScoreSet
  // The BINDING decision from deriveReviewDecision() (single source of truth).
  decision: ReviewDecision
}

// Human label for each reviewer role (NFR-17 — never the bare code letters).
function roleLabel(role: ReviewerRole): string {
  switch (role) {
    case 'EIC': return 'Editor-in-Chief'
    case 'R1':  return 'Referee 1'
    case 'R2':  return 'Referee 2'
    case 'R3':  return 'Referee 3'
    case 'DA':  return "Devil's Advocate"
    default:    return role
  }
}

// The Stage-3 overall for a given role (or null if that role wasn't at Stage 3).
function stage3Overall(stage3: ReviewerScoreSet, role: ReviewerRole): number | null {
  const r = stage3.reviewers.find((x) => x.role === role)
  return r ? r.overallScore : null
}

// A text-labelled overall-delta string, e.g. "↑ +8 · 72→80" / "↓ -5 · 70→65".
function deltaText(before: number, after: number): string {
  const d = after - before
  const arrow = d > 0 ? '↑' : d < 0 ? '↓' : '→'
  const sign = d > 0 ? `+${d}` : `${d}`
  return `${arrow} ${sign} · ${before}→${after}`
}

// Badge styling for an R&R resolution status. Text label is the source of truth.
function statusBadge(status: RRResolutionStatus) {
  if (status === 'Resolved') {
    return (
      <Badge variant="outline" className="border-green-400 text-green-700 dark:border-green-600 dark:text-green-400">
        Resolved
      </Badge>
    )
  }
  if (status === 'Partially Resolved') {
    return (
      <Badge variant="outline" className="border-amber-400 text-amber-700 dark:border-amber-600 dark:text-amber-300">
        Partially Resolved
      </Badge>
    )
  }
  return <Badge variant="destructive">Unresolved</Badge>
}

export function ReReviewPanel({ reReview, stage3, decision }: Props) {
  const matrix = reReview.rrMatrix ?? []
  const residual = reReview.residualIssues ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Re-Review — Stage 3′</CardTitle>
      </CardHeader>

      <CardContent className="space-y-6">

        {/* ── DA-CRITICAL banner (only if the re-review tripped the interlock) ── */}
        {decision.daCritical && (
          <div
            role="alert"
            data-testid="re-review-da-critical-banner"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <p className="font-semibold">
              Devil&apos;s Advocate raised a CRITICAL concern on re-review — this overrides any
              numeric pass; Accept is not available.
            </p>
          </div>
        )}

        {/* ── Reviewer cards with per-role overall deltas vs Stage 3 ── */}
        <section aria-labelledby="re-reviewers-heading" className="space-y-3">
          <h3 id="re-reviewers-heading" className="text-sm font-semibold">
            Reviewer scores (vs Stage 3)
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {reReview.reviewers.map((r) => {
              const before = stage3Overall(stage3, r.role)
              return (
                <div
                  key={r.role}
                  data-testid={`re-reviewer-${r.role}`}
                  className="rounded-lg border bg-card p-4 space-y-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.reviewerName}</span>
                    <Badge variant="secondary">{roleLabel(r.role)}</Badge>
                  </div>
                  <Badge variant="outline" className="tabular-nums">
                    Overall: {r.overallScore}/100
                  </Badge>
                  {/* The delta vs the same role at Stage 3 (NFR-17 text label). */}
                  {before !== null ? (
                    <p
                      className={
                        r.overallScore - before > 0
                          ? 'text-sm font-medium text-green-700 dark:text-green-400'
                          : r.overallScore - before < 0
                            ? 'text-sm font-medium text-destructive'
                            : 'text-sm font-medium text-muted-foreground'
                      }
                    >
                      {deltaText(before, r.overallScore)}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">New at re-review</p>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* ── R&R Traceability Matrix ── */}
        <section aria-labelledby="rr-matrix-heading" className="space-y-3">
          <h3 id="rr-matrix-heading" className="text-sm font-semibold">
            R&amp;R Traceability Matrix
          </h3>
          {matrix.length > 0 ? (
            <div className="rounded-md border">
              <Table data-testid="rr-matrix-table">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[36%]">Original comment</TableHead>
                    <TableHead className="w-[36%]">What the revision did</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {matrix.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="align-top">
                        {row.comment}
                        {(row.reviewer || row.targetSection) && (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {row.reviewer ? row.reviewer : ''}
                            {row.reviewer && row.targetSection ? ' · ' : ''}
                            {row.targetSection ? row.targetSection : ''}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        {row.revision || <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="align-top">{statusBadge(row.status)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              The re-review did not return a traceability matrix.
            </p>
          )}
        </section>

        {/* ── Residual issues ── */}
        <section aria-labelledby="residual-issues-heading" className="space-y-2">
          <h3 id="residual-issues-heading" className="text-sm font-semibold">
            Residual issues
          </h3>
          {residual.length > 0 ? (
            <ul className="list-disc list-inside flex flex-col gap-1 text-sm text-card-foreground">
              {residual.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">None flagged.</p>
          )}
        </section>

      </CardContent>
    </Card>
  )
}
