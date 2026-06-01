// RQBriefCard — displays the Research-Question Brief produced by the rq_formulator agent.
// Think of this as a "spec sheet" for the research: question, FINER quality scores,
// methodology, scope, and keywords — all in one glanceable card.
// Props: { brief: RQBrief }  (FR-07)

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { RQBrief } from '@/lib/types'

// ── prop type ────────────────────────────────────────────────────────────────

interface Props {
  brief: RQBrief
}

// ── helpers ───────────────────────────────────────────────────────────────────

// Map a methodology value to a human-readable label (NFR-17: always show text).
function methodologyLabel(m: RQBrief['methodologyType']): string {
  const labels: Record<RQBrief['methodologyType'], string> = {
    qualitative: 'Qualitative',
    quantitative: 'Quantitative',
    mixed: 'Mixed Methods',
  }
  return labels[m] ?? m
}

// The five FINER axes in display order with their full names.
const FINER_AXES = [
  { key: 'feasible',    label: 'Feasible' },
  { key: 'interesting', label: 'Interesting' },
  { key: 'novel',       label: 'Novel' },
  { key: 'ethical',     label: 'Ethical' },
  { key: 'relevant',    label: 'Relevant' },
] as const

// ── component ─────────────────────────────────────────────────────────────────

// RQBriefCard: read-only summary of the research-question brief.
// No 'use client' needed — this is a pure render with no hooks or browser APIs.
export function RQBriefCard({ brief }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Research Question Brief</CardTitle>
      </CardHeader>

      <CardContent className="space-y-6">

        {/* ── Research Question ── */}
        <section aria-labelledby="rq-heading">
          <h3 id="rq-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Research Question
          </h3>
          <p className="text-sm font-medium leading-snug">{brief.researchQuestion}</p>
        </section>

        {/* ── Sub-questions ── */}
        {brief.subQuestions.length > 0 && (
          <section aria-labelledby="sq-heading">
            <h3 id="sq-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              Sub-questions
            </h3>
            <ol className="list-decimal list-inside space-y-1">
              {brief.subQuestions.map((q, i) => (
                <li key={i} className="text-sm text-foreground/80">{q}</li>
              ))}
            </ol>
          </section>
        )}

        {/* ── FINER Scores ── */}
        {/* Each axis gets a labelled progress bar + numeric score/10 (NFR-17). */}
        <section aria-labelledby="finer-heading">
          <h3 id="finer-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            FINER Quality Scores
          </h3>
          <div className="space-y-2">
            {FINER_AXES.map(({ key, label }) => {
              const score = brief.finerScores[key]
              // Progress takes 0–100; scores are 1–10, so multiply by 10.
              return (
                <div key={key} className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-medium w-24 shrink-0">{label}</span>
                  <Progress
                    value={score * 10}
                    aria-label={`${label}: ${score} out of 10`}
                    className="flex-1"
                  />
                  <span className="ml-auto text-sm text-muted-foreground tabular-nums w-10 text-right">{score}/10</span>
                </div>
              )
            })}
          </div>
        </section>

        {/* ── Methodology ── */}
        <section aria-labelledby="method-heading">
          <h3 id="method-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Methodology
          </h3>
          {/* Badge carries the human-readable word, not a raw enum value (NFR-17). */}
          <Badge variant="secondary">{methodologyLabel(brief.methodologyType)}</Badge>
        </section>

        {/* ── Theoretical Framework ── */}
        {brief.theoreticalFramework && (
          <section aria-labelledby="tf-heading">
            <h3 id="tf-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              Theoretical Framework
            </h3>
            <p className="text-sm text-foreground/80">{brief.theoreticalFramework}</p>
          </section>
        )}

        {/* ── Keywords ── */}
        {brief.keywords.length > 0 && (
          <section aria-labelledby="kw-heading">
            <h3 id="kw-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Keywords
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {brief.keywords.map((kw) => (
                <Badge key={kw} variant="outline">{kw}</Badge>
              ))}
            </div>
          </section>
        )}

        {/* ── Scope ── */}
        <section aria-labelledby="scope-heading">
          <h3 id="scope-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Scope
          </h3>

          {/* Context metadata: domain / timeframe / geography / population */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mb-3">
            <div>
              <dt className="text-muted-foreground inline">Domain: </dt>
              <dd className="inline">{brief.scope.domain}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground inline">Timeframe: </dt>
              <dd className="inline">{brief.scope.timeframe}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground inline">Geography: </dt>
              <dd className="inline">{brief.scope.geography}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground inline">Population: </dt>
              <dd className="inline">{brief.scope.population}</dd>
            </div>
          </dl>

          {/* In scope / Out of scope side-by-side */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {brief.scope.inScope.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">In scope</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {brief.scope.inScope.map((item, i) => (
                    <li key={i} className="text-sm text-foreground/80">{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {brief.scope.outOfScope.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Out of scope</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {brief.scope.outOfScope.map((item, i) => (
                    <li key={i} className="text-sm text-foreground/80">{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>

        {/* ── Methodology Recommendations (optional) ── */}
        {brief.methodologyRecommendations && brief.methodologyRecommendations.length > 0 && (
          <section aria-labelledby="mrec-heading">
            <h3 id="mrec-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              Methodology Recommendations
            </h3>
            <ul className="list-disc list-inside space-y-1">
              {brief.methodologyRecommendations.map((rec, i) => (
                <li key={i} className="text-sm text-foreground/80">{rec}</li>
              ))}
            </ul>
          </section>
        )}

      </CardContent>
    </Card>
  )
}
