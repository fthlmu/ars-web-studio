'use client'

// IntegrityGateReport — the Stage 2.5 integrity gate readout (FR-16..FR-20, EH-08).
//
// This is the screen the user sees after the integrity_verification_agent has run
// the 7-mode (M1..M7) check on the paper draft. It shows:
//   • a 7-row table: each failure mode, its verdict badge (always with TEXT), and
//     the detection question the agent answered;
//   • a collapsible <details> per mode showing the agent's evidence/reasoning;
//   • the two numeric risk scores + the issue counts;
//   • a verdict-driven "proceed" affordance:
//       FAIL                 → NO proceed control rendered at all (it is absent
//                              from the DOM, not just disabled) + a hard callout;
//       PASS                 → an enabled "Proceed to Peer Review" button;
//       PASS_WITH_CONDITIONS → an advisory callout + an acknowledge checkbox that
//                              gates the proceed button;
//       BOUNDED_OVERRIDE     → renders {children} (the IntegrityOverride) instead
//                              of the plain proceed button.
//
// IRON RULE: this component is PRESENTATIONAL. It NEVER recomputes the gate logic
// — it consumes the `decision` prop produced by deriveGateDecision() in
// @/lib/integrity (the single source of truth). It does not touch localStorage and
// does not call runIntegrityGate. The parent route owns all of that.
//
// EE analogy: think of this as the instrument panel + the physical interlock. The
// breaker logic lives elsewhere (integrity.ts); this panel only displays the fault
// readings and shows-or-hides the "energize" switch according to the interlock.

import { type ReactNode, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import type { GateDecision } from '@/lib/integrity'
import type { IntegrityReport, ModeVerdict } from '@/lib/types'

// data-testid the route + tests look for on the single proceed affordance.
const PROCEED_TESTID = 'proceed-to-review'
// The one canonical proceed label (used wherever a proceed button is rendered).
const PROCEED_LABEL = 'Proceed to Peer Review'

// ── prop type ──────────────────────────────────────────────────────────────
interface Props {
  // The agent's (advisory) report — drives the table + scores.
  report: IntegrityReport
  // The BINDING gate decision from deriveGateDecision(). We trust this completely.
  decision: GateDecision
  // Called when the user is cleared to proceed (PASS, acknowledged CONDITIONS, or
  // a submitted override — the override path comes through {children} → onOverride
  // → the parent → onProceed). Presentational: we don't decide, we just signal.
  onProceed: () => void
  // The BOUNDED_OVERRIDE affordance (an <IntegrityOverride>) injected by the parent.
  // Rendered in place of the plain proceed button only when kind === 'BOUNDED_OVERRIDE'.
  children?: ReactNode
}

// ── verdict → badge variant + human label (NFR-17: ALWAYS a text label) ───────
// CLEAR = green, SUSPECTED = red (destructive), INSUFFICIENT_EVIDENCE = orange.
// Base UI badge has no "success"/"warning" variant, so we add explicit color
// classes for CLEAR (green) and INSUFFICIENT (orange) and lean on `destructive`
// for SUSPECTED. The text label is the source of truth — color is decoration only.
function verdictLabel(v: ModeVerdict): string {
  switch (v) {
    case 'CLEAR':                 return 'Clear'
    case 'SUSPECTED':             return 'Suspected'
    case 'INSUFFICIENT_EVIDENCE': return 'Insufficient evidence'
    default:                      return v
  }
}

// Returns the badge element for a verdict. Always carries the text from verdictLabel.
function VerdictBadge({ verdict }: { verdict: ModeVerdict }) {
  if (verdict === 'SUSPECTED') {
    // Red — a flagged failure. `destructive` is already the red variant.
    return <Badge variant="destructive">{verdictLabel(verdict)}</Badge>
  }
  if (verdict === 'INSUFFICIENT_EVIDENCE') {
    // Orange — could not be verified. No orange variant exists, so color via class.
    return (
      <Badge
        variant="outline"
        className="border-amber-400 text-amber-700 dark:border-amber-600 dark:text-amber-300"
      >
        {verdictLabel(verdict)}
      </Badge>
    )
  }
  // CLEAR — green. Color via class on the outline variant.
  return (
    <Badge
      variant="outline"
      className="border-green-400 text-green-700 dark:border-green-600 dark:text-green-400"
    >
      {verdictLabel(verdict)}
    </Badge>
  )
}

// Format a 0..1 score as a percentage with no decimals (e.g. 0.92 → "92%").
function pct(score: number): string {
  return `${Math.round(score * 100)}%`
}

// ── component ────────────────────────────────────────────────────────────────
export function IntegrityGateReport({ report, decision, onProceed, children }: Props) {
  // Local UI state ONLY for the PASS_WITH_CONDITIONS acknowledge checkbox. This is
  // a view concern (does the user tick the box?), not gate logic — so it lives here.
  const [acknowledged, setAcknowledged] = useState(false)

  const { kind, proceedAllowed } = decision

  return (
    <Card>
      <CardHeader>
        <CardTitle>Integrity Gate — Stage {report.stage}</CardTitle>
      </CardHeader>

      <CardContent className="space-y-6">

        {/* ── Verdict-level callout (drives the user's next action) ── */}
        {/* Each callout carries its OWN live semantics: the FAIL callout is a
            role="alert" (assertive — announced immediately), and the three non-FAIL
            callouts are role="status" (implicit polite). We deliberately do NOT wrap
            them in an aria-live="polite" container: nesting an assertive alert inside
            a polite region produces inconsistent announcements across screen readers
            (double-announce, or the outer politeness wins). The wrapper is a plain
            layout div. */}
        <div>
          {kind === 'FAIL' && (
            // Non-dismissible hard-block callout. There is NO proceed control below.
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              <p className="font-semibold">Integrity gate FAILED — proceeding is blocked.</p>
              <p className="mt-1">{decision.reason}</p>
            </div>
          )}

          {kind === 'BOUNDED_OVERRIDE' && (
            <div
              role="status"
              className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-300"
            >
              <p className="font-semibold">Bounded override available.</p>
              <p className="mt-1">{decision.reason}</p>
            </div>
          )}

          {kind === 'PASS_WITH_CONDITIONS' && (
            <div
              role="status"
              className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-300"
            >
              <p className="font-semibold">Passed with conditions.</p>
              <p className="mt-1">{decision.reason}</p>
            </div>
          )}

          {kind === 'PASS' && (
            <div
              role="status"
              className="rounded-md border border-green-400 bg-green-50 dark:border-green-700 dark:bg-green-950/30 px-4 py-3 text-sm text-green-800 dark:text-green-300"
            >
              <p className="font-semibold">Integrity gate passed.</p>
              <p className="mt-1">{decision.reason}</p>
            </div>
          )}
        </div>

        {/* ── Numeric scores + issue counts ── */}
        <section aria-labelledby="scores-heading">
          <h3 id="scores-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
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

          {/* Issue counts — serious / medium / minor, each a labelled badge. */}
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

        {/* ── 7-mode table (M1..M7) ── */}
        <section aria-labelledby="modes-heading">
          <h3 id="modes-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Failure-Mode Checks
          </h3>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[16rem]">Mode</TableHead>
                  <TableHead className="w-[12rem]">Verdict</TableHead>
                  <TableHead>Detection question</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.modes.map((mode) => (
                  <TableRow key={mode.modeId}>
                    {/* Mode id + name */}
                    <TableCell>
                      <span className="font-mono text-xs text-muted-foreground">{mode.modeId}</span>{' '}
                      <span className="font-medium">{mode.modeName}</span>
                    </TableCell>

                    {/* Verdict badge — always carries text (NFR-17) — plus the
                        collapsible evidence directly beneath it. */}
                    <TableCell className="space-y-1.5">
                      <VerdictBadge verdict={mode.verdict} />
                      {/* Native <details>/<summary>: keyboard-accessible, zero deps. */}
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                          Evidence
                        </summary>
                        <p className="mt-1 leading-relaxed text-foreground/80 whitespace-pre-wrap">
                          {mode.evidence || 'No evidence text was provided for this mode.'}
                        </p>
                      </details>
                    </TableCell>

                    {/* Detection question the agent answered. */}
                    <TableCell className="text-xs text-muted-foreground leading-relaxed">
                      {mode.detectionQuestion}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        {/* ── Proceed affordance — STRICTLY verdict-gated ──
            FAIL: nothing is rendered here, so the proceed control is ABSENT from
            the DOM (querySelector('[data-testid="proceed-to-review"]') === null). */}
        {proceedAllowed && (
          <section aria-labelledby="proceed-heading" className="space-y-3">
            <h3 id="proceed-heading" className="sr-only">Proceed</h3>

            {kind === 'BOUNDED_OVERRIDE' ? (
              // The override control (IntegrityOverride) is injected as children.
              // It owns its own submit; the parent maps its onOverride → onProceed.
              children
            ) : kind === 'PASS_WITH_CONDITIONS' ? (
              // Advisory conditions: an acknowledge checkbox gates the button.
              <>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={acknowledged}
                    aria-label="Acknowledge the minor conditions before proceeding"
                    onCheckedChange={(checked: boolean) => setAcknowledged(checked)}
                  />
                  <span>I acknowledge the minor conditions noted above and want to proceed.</span>
                </label>
                <Button
                  type="button"
                  data-testid={PROCEED_TESTID}
                  onClick={onProceed}
                  disabled={!acknowledged}
                >
                  {PROCEED_LABEL}
                </Button>
              </>
            ) : (
              // PASS: a plain enabled proceed button.
              <Button
                type="button"
                data-testid={PROCEED_TESTID}
                onClick={onProceed}
              >
                {PROCEED_LABEL}
              </Button>
            )}
          </section>
        )}

      </CardContent>
    </Card>
  )
}
