'use client'

// DeltaReportView — the Stage 4 (revision) before→after readout (P13.4).
//
// After runRevision() rewrites the paper, this shows WHAT changed, section by section.
// For every CHANGED section it renders a side-by-side view: the original on the left
// (with removed words highlighted light-red) and the revised text on the right (with
// added words highlighted light-green). Sections the agent left untouched are folded
// into a single collapsed "unchanged" accordion so the diff stays readable.
//
// The word-level diff is computed HERE at render time with the `diff` library
// (diffWords) from the plain-text old/new content the DeltaReport stores — we do NOT
// persist a pre-computed diff, keeping localStorage small.
//
// IRON RULE: this component is PRESENTATIONAL. It never calls the agent, never touches
// localStorage, and renders no routing buttons (those live in the revise page, P13.6).
//
// EE analogy: think of it as an A/B trace overlay — the old waveform and the new one
// on the same time axis, with the deltas colour-coded so you see exactly where the
// signal moved.

import { diffWords } from 'diff'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { DeltaReport, DeltaSection } from '@/lib/types'

interface Props {
  // The per-section before→after data produced by runRevision(). Read-only.
  delta: DeltaReport
}

// Render the OLD side of one section: unchanged + removed words (removed = light-red,
// struck through). Added words are skipped here (they belong on the NEW side).
function OldColumn({ section }: { section: DeltaSection }) {
  const parts = diffWords(section.oldContent, section.newContent)
  return (
    <div className="rounded-md border bg-muted/20 p-3 text-sm leading-relaxed prose prose-sm max-w-none">
      {parts.map((part, i) => {
        if (part.added) return null
        if (part.removed) {
          return (
            <span
              key={i}
              className="rounded-sm bg-red-100 text-red-900 line-through dark:bg-red-950/40 dark:text-red-200"
            >
              {part.value}
            </span>
          )
        }
        return <span key={i}>{part.value}</span>
      })}
    </div>
  )
}

// Render the NEW side of one section: unchanged + added words (added = light-green).
// Removed words are skipped here (they belong on the OLD side).
function NewColumn({ section }: { section: DeltaSection }) {
  const parts = diffWords(section.oldContent, section.newContent)
  return (
    <div className="rounded-md border bg-muted/20 p-3 text-sm leading-relaxed prose prose-sm max-w-none">
      {parts.map((part, i) => {
        if (part.removed) return null
        if (part.added) {
          return (
            <span
              key={i}
              className="rounded-sm bg-green-100 text-green-900 dark:bg-green-950/40 dark:text-green-200"
            >
              {part.value}
            </span>
          )
        }
        return <span key={i}>{part.value}</span>
      })}
    </div>
  )
}

export function DeltaReportView({ delta }: Props) {
  const changed = delta.sections.filter((s) => s.changed)
  const unchanged = delta.sections.filter((s) => !s.changed)

  return (
    <Card data-testid="delta-report">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg">Delta Report — what changed</CardTitle>
          {/* NFR-17: the badge carries a TEXT label, not just a colour. */}
          <Badge variant="secondary">
            {delta.changedCount} of {delta.sections.length} sections changed
          </Badge>
        </div>
        {delta.summary && (
          <p className="text-sm text-muted-foreground">{delta.summary}</p>
        )}
      </CardHeader>

      <CardContent className="space-y-6">
        {/* ── Changed sections: side-by-side old → new. ── */}
        {changed.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No sections were changed in this revision.
          </p>
        )}

        {changed.map((section) => (
          <div key={section.heading} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{section.heading}</h3>
              <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-200">
                Changed
              </Badge>
            </div>
            {section.changeSummary && (
              <p className="text-xs text-muted-foreground">{section.changeSummary}</p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Before (removed in red)</p>
                <OldColumn section={section} />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">After (added in green)</p>
                <NewColumn section={section} />
              </div>
            </div>
          </div>
        ))}

        {/* ── Unchanged sections: collapsed accordion (native <details>). ── */}
        {unchanged.length > 0 && (
          <details className="rounded-md border bg-muted/10 p-3">
            <summary className="cursor-pointer text-sm font-medium">
              {unchanged.length} unchanged section{unchanged.length === 1 ? '' : 's'} (click to expand)
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {unchanged.map((section) => (
                <li key={section.heading}>{section.heading}</li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  )
}
