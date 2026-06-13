'use client'

// FinalIntegrityGateReport — the Stage 4.5 zero-tolerance final-gate readout (P15,
// FR-39). It mirrors the P10 IntegrityGateReport's 7-mode table + badge rendering,
// but adds a STAGE-2.5 COMPARISON COLUMN (prior verdict → current verdict) so the
// user can see which previously-deferred modes were actually resolved.
//
// IRON RULE: this component is PRESENTATIONAL. It NEVER decides pass/fail and it
// renders NO proceed/export/override/acknowledge/skip control. The binding decision
// comes from deriveFinalGateDecision() in @/lib/final-integrity, and the route owns
// every affordance (the export button on PASS; the re-run / return-to-editor on FAIL).
// Keeping all controls in the route is what guarantees "no bypass UI" mechanically:
// there is simply no button in this file to hide or mis-wire.

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
import type { FinalGateDecision, ModeComparisonRow } from '@/lib/final-integrity'
import type { IntegrityReport, ModeVerdict } from '@/lib/types'

interface Props {
  // The agent's (advisory) 4.5 report — drives the table + scores.
  report: IntegrityReport
  // The BINDING zero-tolerance decision from deriveFinalGateDecision(). Trusted as-is.
  decision: FinalGateDecision
  // Per-mode Stage-2.5 → 4.5 comparison rows (from buildModeComparison()).
  comparison: ModeComparisonRow[]
}

// verdict → human label (NFR-17: a text label ALWAYS accompanies the colour).
function verdictLabel(v: ModeVerdict): string {
  switch (v) {
    case 'CLEAR':                 return 'Clear'
    case 'SUSPECTED':             return 'Suspected'
    case 'INSUFFICIENT_EVIDENCE': return 'Insufficient evidence'
    default:                      return v
  }
}

// Badge for a verdict — CLEAR green, SUSPECTED red, INSUFFICIENT orange. Text-first.
function VerdictBadge({ verdict }: { verdict: ModeVerdict }) {
  if (verdict === 'SUSPECTED') {
    return <Badge variant="destructive">{verdictLabel(verdict)}</Badge>
  }
  if (verdict === 'INSUFFICIENT_EVIDENCE') {
    return (
      <Badge
        variant="outline"
        className="border-amber-400 text-amber-700 dark:border-amber-600 dark:text-amber-300"
      >
        {verdictLabel(verdict)}
      </Badge>
    )
  }
  return (
    <Badge
      variant="outline"
      className="border-green-400 text-green-700 dark:border-green-600 dark:text-green-400"
    >
      {verdictLabel(verdict)}
    </Badge>
  )
}

// The prior (Stage-2.5) cell: either the earlier verdict label, or "—" when no 2.5 run
// is on record (e.g. the Accept path reached 4.5 first). A resolved mode reads
// "Insufficient evidence → Clear"; an unresolved one keeps the same blocking verdict.
function PriorCell({ prior }: { prior: ModeVerdict | null }) {
  if (prior === null) {
    return <span className="text-xs text-muted-foreground">— (no Stage 2.5 run)</span>
  }
  return <span className="text-xs text-muted-foreground">{verdictLabel(prior)}</span>
}

function pct(score: number): string {
  return `${Math.round(score * 100)}%`
}

export function FinalIntegrityGateReport({ report, decision, comparison }: Props) {
  const passed = decision.kind === 'PASS'

  return (
    <Card>
      <CardHeader>
        <CardTitle>Final Integrity Gate — Stage {report.stage} (zero-tolerance)</CardTitle>
      </CardHeader>

      <CardContent className="space-y-6">

        {/* ── Verdict callout. FAIL is an assertive alert; PASS is a polite status. ── */}
        <div>
          {passed ? (
            <div
              role="status"
              className="rounded-md border border-green-400 bg-green-50 dark:border-green-700 dark:bg-green-950/30 px-4 py-3 text-sm text-green-800 dark:text-green-300"
            >
              <p className="font-semibold">Final integrity gate passed.</p>
              <p className="mt-1">{decision.reason}</p>
            </div>
          ) : (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              <p className="font-semibold">
                Final integrity gate BLOCKED — export is not permitted.
              </p>
              <p className="mt-1">{decision.reason}</p>
              <p className="mt-1">
                Blocking mode(s): <span className="font-mono">{decision.blockingModes.join(', ')}</span>.
                There is no override at this gate.
              </p>
            </div>
          )}
        </div>

        {/* ── Numeric scores + issue counts (same readout as the 2.5 gate). ── */}
        <section aria-labelledby="final-scores-heading">
          <h3 id="final-scores-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Risk Scores
          </h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <div>
              <dt className="text-muted-foreground inline">Citation integrity: </dt>
              <dd className="inline tabular-nums font-medium">{pct(report.citationIntegrityScore)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground inline">Fabrication risk: </dt>
              <dd className="inline tabular-nums font-medium">{pct(report.fabricationRiskScore)}</dd>
            </div>
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant={report.overallIssues.serious > 0 ? 'destructive' : 'outline'}>
              Serious: {report.overallIssues.serious}
            </Badge>
            <Badge variant={report.overallIssues.medium > 0 ? 'secondary' : 'outline'}>
              Medium: {report.overallIssues.medium}
            </Badge>
            <Badge variant="outline">
              Minor: {report.overallIssues.minor}
            </Badge>
          </div>
        </section>

        {/* ── 7-mode table with the Stage-2.5 comparison column. ── */}
        <section aria-labelledby="final-modes-heading">
          <h3 id="final-modes-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Failure-Mode Checks (Stage 2.5 → 4.5)
          </h3>
          <div className="rounded-md border">
            <Table data-testid="final-integrity-table">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[16rem]">Mode</TableHead>
                  <TableHead className="w-[12rem]">Stage 2.5</TableHead>
                  <TableHead className="w-[12rem]">Stage 4.5 (now)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comparison.map((row) => {
                  const modeReport = report.modes.find((m) => m.modeId === row.modeId)
                  return (
                    <TableRow key={row.modeId}>
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground">{row.modeId}</span>{' '}
                        <span className="font-medium">{row.modeName}</span>
                      </TableCell>
                      <TableCell>
                        <PriorCell prior={row.prior} />
                      </TableCell>
                      <TableCell className="space-y-1.5">
                        <VerdictBadge verdict={row.current} />
                        <details className="text-xs">
                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                            Evidence
                          </summary>
                          <p className="mt-1 leading-relaxed text-foreground/80 whitespace-pre-wrap">
                            {modeReport?.evidence || 'No evidence text was provided for this mode.'}
                          </p>
                        </details>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </section>

      </CardContent>
    </Card>
  )
}
