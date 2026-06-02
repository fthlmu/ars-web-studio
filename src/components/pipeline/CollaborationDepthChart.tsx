'use client'

// P17.3 — Collaboration Depth chart (Stage 6, FR-46). Four dimensions, each scored 1–5,
// rendered as labelled horizontal bars, with a PROMINENT Zone badge. When the depth data
// is missing (the collaboration_depth_agent failed or returned an unscored block), the
// component renders a text fallback instead of an empty chart.
//
// Presentational only — the depth object is computed upstream (ars-client.runProcessSummary).

import { Badge } from '@/components/ui/badge'
import type { CollaborationDepth } from '@/lib/types'

const MAX_SCORE = 5

// The four dimensions, in display order, paired with the CollaborationDepth keys.
const DIMENSIONS: { key: keyof Pick<CollaborationDepth, 'delegationIntensity' | 'cognitiveVigilance' | 'cognitiveReallocation' | 'zoneClassification'>; label: string }[] = [
  { key: 'delegationIntensity', label: 'Delegation Intensity' },
  { key: 'cognitiveVigilance', label: 'Cognitive Vigilance' },
  { key: 'cognitiveReallocation', label: 'Cognitive Reallocation' },
  { key: 'zoneClassification', label: 'Zone Classification' },
]

function DimensionBar({ label, score }: { label: string; score: number }) {
  const pct = Math.round((Math.min(MAX_SCORE, Math.max(1, score)) / MAX_SCORE) * 100)
  return (
    <div className="space-y-1" data-testid={`collab-dim-${label.replace(/\s+/g, '-').toLowerCase()}`}>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-muted-foreground" aria-label={`${score} out of ${MAX_SCORE}`}>
          {score} / {MAX_SCORE}
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted" role="presentation">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function CollaborationDepthChart({ depth }: { depth: CollaborationDepth | null }) {
  return (
    <section aria-labelledby="collab-depth-heading" className="space-y-4" data-testid="collaboration-depth-chart">
      <div>
        <h2 id="collab-depth-heading" className="text-lg font-semibold">
          Collaboration Depth
        </h2>
        <p className="text-sm text-muted-foreground">
          How deep the human↔AI collaboration was across four dimensions (1–5).
        </p>
      </div>

      {/* Text fallback when the depth data is missing (FR-46). */}
      {!depth ? (
        <p className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground" data-testid="collab-depth-fallback">
          Collaboration-depth scores are unavailable for this run (the observer could not
          score the collaboration from the available trace). The execution timeline and the
          failure-mode audit log above still describe how the paper was produced.
        </p>
      ) : (
        <div className="space-y-4 rounded-lg border p-4">
          {/* Prominent Zone badge. */}
          <div className="flex items-center justify-between gap-3" data-testid="collab-zone-badge">
            <span className="text-sm font-medium">Collaboration Zone</span>
            <Badge className="text-sm px-3 py-1">
              {depth.zoneLabel} ({depth.zoneClassification}/{MAX_SCORE})
            </Badge>
          </div>

          {/* The four dimension bars. */}
          <div className="space-y-3">
            {DIMENSIONS.map(({ key, label }) => (
              <DimensionBar key={key} label={label} score={depth[key]} />
            ))}
          </div>

          {depth.rationale && (
            <p className="text-xs text-muted-foreground">{depth.rationale}</p>
          )}
        </div>
      )}
    </section>
  )
}
