'use client'

// PeerReviewReport — the Stage 3 (peer review) readout (P11.6 + P11.7 + P11.8).
//
// This is the screen the user sees after the two-phase Sprint Contract has run on
// a 2.5-PASS draft: Phase 1 (paper-blind) committed a scoring plan, Phase 2
// (paper-visible) emitted the 5-reviewer Review Report (Schema 6). This component
// shows:
//   • P11.8 — a DA-CRITICAL banner at the very top (only when the Devil's Advocate
//     tripped the interlock): a role="alert" that announces Accept is off the table;
//   • P11.6 — a base-ui Tabs panel with ONE tab per reviewer (EIC, R1, R2, R3, DA)
//     plus a "Consensus" tab. Each reviewer tab shows their overall score, a 5-row
//     dimension table (Novelty/Methodology/Clarity/Contribution/Citation), their key
//     comments + required changes, and their own advisory recommendation badge;
//   • P11.7 — the Consensus tab: the BINDING editorialDecision, the consensus label,
//     the confidence score, the average overall, and an always-visible threshold
//     legend (>=80 Accept · 65-79 Minor · 50-64 Major · <50 Reject) with the active
//     band highlighted.
//
// IRON RULE: this component is PRESENTATIONAL. It NEVER recomputes the editorial
// decision — it consumes the `decision` prop produced by deriveReviewDecision() in
// @/lib/review (the single source of truth), exactly like IntegrityGateReport
// consumes its `decision` prop. It does not touch localStorage and renders no
// routing/Accept/Reject buttons (those live in the page, P11.9).
//
// EE analogy: this is the instrument panel for the review bench. The five reviewers
// are five independent measurement channels; the Consensus tab is the summed read
// against the four threshold bands (gain stages). DA-CRITICAL is a hard interlock
// wired across the top — when it trips, the "Accept" rail is physically disconnected
// and this panel says so in plain words, not just color.

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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { REVIEW_THRESHOLDS } from '@/lib/review'
import type { ReviewDecision } from '@/lib/review'
import type {
  EditorialDecision,
  ReviewConsensus,
  ReviewerDimensionScores,
  ReviewerReport,
  ReviewerRole,
  ReviewerScoreSet,
} from '@/lib/types'

// ── prop type ──────────────────────────────────────────────────────────────────
interface Props {
  // The agent's (advisory) 5-reviewer Review Report — drives the per-reviewer tabs.
  review: ReviewerScoreSet
  // The BINDING editorial decision from deriveReviewDecision(). We trust it fully and
  // never recompute it here (mirrors IntegrityGateReport consuming its `decision`).
  decision: ReviewDecision
}

// The canonical tab order for the five reviewers. We render tabs in THIS order even
// if review.reviewers arrives in a different order — we look each role up by hand
// below (robustness), so a re-ordered or partial array can't scramble the panel.
const ROLE_ORDER: ReviewerRole[] = ['EIC', 'R1', 'R2', 'R3', 'DA']

// Human label for each reviewer role (NFR-17: a tab is more than its code letters).
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

// The five rubric dimensions, in display order, paired with a human label. Keyed to
// ReviewerDimensionScores so the table rows can index the scores type-safely.
const DIMENSIONS: { key: keyof ReviewerDimensionScores; label: string }[] = [
  { key: 'novelty', label: 'Novelty' },
  { key: 'methodology', label: 'Methodology' },
  { key: 'clarity', label: 'Clarity' },
  { key: 'contribution', label: 'Contribution' },
  { key: 'citation', label: 'Citation' },
]

// ── decision → badge variant (the BINDING editorial outcome) ────────────────────
// The text label is the source of truth (NFR-17); color is decoration. Accept is
// green, the two Revision bands are amber, Reject is red (destructive).
function decisionBadgeClass(decision: EditorialDecision): string {
  switch (decision) {
    case 'Accept':
      return 'border-green-400 text-green-700 dark:border-green-600 dark:text-green-400'
    case 'Minor Revision':
    case 'Major Revision':
      return 'border-amber-400 text-amber-700 dark:border-amber-600 dark:text-amber-300'
    case 'Reject':
      return '' // handled via the destructive variant below — no class needed
    default:
      return ''
  }
}

// Render the BINDING editorial decision as a labelled badge. Always carries the
// decision text; Reject uses the red destructive variant, the rest use outline+color.
function DecisionBadge({ decision }: { decision: EditorialDecision }) {
  if (decision === 'Reject') {
    return <Badge variant="destructive">Decision: {decision}</Badge>
  }
  return (
    <Badge variant="outline" className={decisionBadgeClass(decision)}>
      Decision: {decision}
    </Badge>
  )
}

// Human one-liner for the consensus label (NFR-17: never the bare code).
function consensusLabel(consensus: ReviewConsensus): string {
  switch (consensus) {
    case 'CONSENSUS-4': return 'Consensus (4+ reviewers agree)'
    case 'CONSENSUS-3': return 'Consensus (3 reviewers agree)'
    case 'SPLIT':       return 'Split (no clear majority)'
    case 'DA-CRITICAL': return "Devil's Advocate critical flag"
    default:            return consensus
  }
}

// ── component ────────────────────────────────────────────────────────────────────
export function PeerReviewReport({ review, decision }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Peer Review — Stage 3</CardTitle>
      </CardHeader>

      <CardContent className="space-y-6">

        {/* ── P11.8: DA-CRITICAL banner FIRST ──
            Only rendered when the binding decision flags DA-CRITICAL. role="alert"
            (assertive) so a screen reader announces the override immediately. The
            message is a TEXT label, not color-only (NFR-17). */}
        {decision.daCritical && (
          <div
            role="alert"
            data-testid="da-critical-banner"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <p className="font-semibold">
              Devil&apos;s Advocate raised a CRITICAL concern — this overrides any
              numeric pass; Accept is not available.
            </p>
          </div>
        )}

        {/* ── P11.6 + P11.7: the reviewer + consensus tab panel ── */}
        <Tabs defaultValue="EIC">
          <TabsList>
            {/* One trigger per reviewer role, in canonical EIC,R1,R2,R3,DA order. */}
            {ROLE_ORDER.map((role) => (
              <TabsTrigger key={role} value={role}>
                {role}
              </TabsTrigger>
            ))}
            {/* The summary tab. */}
            <TabsTrigger value="consensus">Consensus</TabsTrigger>
          </TabsList>

          {/* ── one reviewer tab per role ── */}
          {ROLE_ORDER.map((role) => {
            // Robustness: find this role's report by hand rather than trusting the
            // array order. The Schema-6 parser guarantees exactly 5 reviewers, but
            // we never assume position === role.
            const reviewer = review.reviewers.find((r) => r.role === role)
            return (
              <TabsContent key={role} value={role}>
                {reviewer ? (
                  <ReviewerPanel reviewer={reviewer} />
                ) : (
                  // Defensive only — the parser guarantees all 5 roles are present.
                  <p className="pt-2 text-sm text-muted-foreground">
                    No report was provided for {roleLabel(role)}.
                  </p>
                )}
              </TabsContent>
            )
          })}

          {/* ── consensus / decision tab (P11.7) ── */}
          <TabsContent value="consensus">
            <ConsensusPanel review={review} decision={decision} />
          </TabsContent>
        </Tabs>

      </CardContent>
    </Card>
  )
}

// ── one reviewer's scorecard (P11.6) ────────────────────────────────────────────
function ReviewerPanel({ reviewer }: { reviewer: ReviewerReport }) {
  return (
    <div className="flex flex-col gap-4 pt-2">

      {/* Header: name + role + overall score badge. Every badge carries TEXT. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{reviewer.reviewerName}</span>
        <Badge variant="secondary">{roleLabel(reviewer.role)}</Badge>
        <Badge variant="outline" className="tabular-nums">
          Overall: {reviewer.overallScore}/100
        </Badge>
      </div>

      {/* 5-row dimension table — each score as "NN/100" (NFR-17 text). */}
      <section aria-labelledby={`dims-${reviewer.role}`}>
        <h3
          id={`dims-${reviewer.role}`}
          className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Rubric Dimensions
        </h3>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[16rem]">Dimension</TableHead>
                <TableHead>Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DIMENSIONS.map((dim) => (
                <TableRow key={dim.key}>
                  <TableCell className="font-medium">{dim.label}</TableCell>
                  <TableCell className="tabular-nums">
                    {reviewer.dimensions[dim.key]}/100
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* Key comments — a plain list, or a muted "None" when empty. */}
      <section aria-labelledby={`comments-${reviewer.role}`}>
        <h3
          id={`comments-${reviewer.role}`}
          className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Key comments
        </h3>
        {reviewer.keyComments.length > 0 ? (
          <ul className="list-disc list-inside flex flex-col gap-1 text-sm text-card-foreground">
            {reviewer.keyComments.map((comment, idx) => (
              <li key={idx}>{comment}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">None</p>
        )}
      </section>

      {/* Required changes — a plain list, or a muted "None" when empty. */}
      <section aria-labelledby={`changes-${reviewer.role}`}>
        <h3
          id={`changes-${reviewer.role}`}
          className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Required changes
        </h3>
        {reviewer.requiredChanges.length > 0 ? (
          <ul className="list-disc list-inside flex flex-col gap-1 text-sm text-card-foreground">
            {reviewer.requiredChanges.map((change, idx) => (
              <li key={idx}>{change}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">None</p>
        )}
      </section>

      {/* This reviewer's OWN advisory recommendation (distinct from the binding
          decision shown on the Consensus tab). Carries the decision text. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Recommendation
        </span>
        <Badge variant="outline">{reviewer.recommendation}</Badge>
      </div>
    </div>
  )
}

// ── the consensus / binding-decision summary (P11.7) ────────────────────────────
function ConsensusPanel({ review, decision }: Props) {
  return (
    <div className="flex flex-col gap-4 pt-2">

      {/* The headline badges: the BINDING decision, the consensus label, the
          confidence and average. Each carries a TEXT label (NFR-17). */}
      <div className="flex flex-wrap items-center gap-2">
        {/* The binding editorial decision — from decision.editorialDecision, NOT the
            advisory review.editorialDecision (we trust the SSOT). */}
        <DecisionBadge decision={decision.editorialDecision} />
        <Badge variant="secondary">{consensusLabel(review.consensus)}</Badge>
        <Badge variant="outline" className="tabular-nums">
          Confidence: {review.confidenceScore}/100
        </Badge>
        <Badge variant="outline" className="tabular-nums">
          Average overall: {decision.averageOverall}/100
        </Badge>
      </div>

      {/* The human reason string the SSOT produced (names the band + DA override). */}
      <p className="text-sm text-card-foreground">{decision.reason}</p>

      {/* ── Threshold legend (always visible) ──
          Rendered from REVIEW_THRESHOLDS so the legend can never drift from the
          logic. The band matching decision.thresholdBand is highlighted (and called
          out in text, not color alone — NFR-17). */}
      <section aria-labelledby="threshold-legend">
        <h3
          id="threshold-legend"
          className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Decision thresholds (average overall, 0–100)
        </h3>
        <ul className="flex flex-wrap gap-2 text-sm">
          {REVIEW_THRESHOLDS.map((t) => {
            const active = t.band === decision.thresholdBand
            return (
              <li
                key={t.band}
                className={
                  active
                    ? 'rounded-md border border-primary bg-primary/10 px-2 py-1 font-medium text-foreground'
                    : 'rounded-md border border-border px-2 py-1 text-muted-foreground'
                }
              >
                {/* The numeric band hint, e.g. ">=80 Accept". */}
                {bandHint(t.band)} {t.label}
                {/* Text marker for the active band (color-independent — NFR-17). */}
                {active && (
                  <span className="ml-1 font-semibold">(current)</span>
                )}
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

// The numeric hint shown before each band label in the legend. Kept beside the
// component so the rendered ">=80 / 65-79 / 50-64 / <50" string stays in one place.
function bandHint(band: (typeof REVIEW_THRESHOLDS)[number]['band']): string {
  switch (band) {
    case 'accept': return '≥80'
    case 'minor':  return '65–79'
    case 'major':  return '50–64'
    case 'reject': return '<50'
    default:       return ''
  }
}
