'use client'

// RevisionRoadmapChecklist — the Stage 4 (revision) roadmap readout (P13.5).
//
// Shows the grouped Revision Roadmap (Schema 7) the revision_coach_agent worked from:
// must_fix items first (red — the reviewers' blocking changes), then should_fix, then
// consider (both advisory). Each must_fix item is shown as ALREADY RESOLVED by the
// agent — it is NOT a checkbox the author ticks by hand (the rewrite addressed it).
//
// IRON RULE (P13.5): must_fix items are auto-resolved by the agent and are NOT manually
// tickable. We deliberately render a STATIC "Resolved" marker, never an interactive
// checkbox, so there is no DOM control a user could toggle to fake completion. should_fix
// and consider are advisory notes only.
//
// PRESENTATIONAL: no agent calls, no localStorage, no routing.

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { RevisionRoadmap, RoadmapItem } from '@/lib/types'

interface Props {
  roadmap: RevisionRoadmap
}

// One roadmap row. `resolved` (must_fix only) renders the static auto-resolved marker;
// advisory rows render a neutral bullet. NFR-17: every badge carries a text label.
function RoadmapRow({ item, resolved }: { item: RoadmapItem; resolved: boolean }) {
  return (
    <li className="flex items-start gap-2 rounded-md border bg-card/40 p-2">
      {/* Static status marker — NOT an interactive checkbox (must_fix is auto-resolved). */}
      {resolved ? (
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-green-600 text-[10px] font-bold text-white"
        >
          ✓
        </span>
      ) : (
        <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
      )}
      <div className="min-w-0 space-y-1">
        <p className="text-sm">{item.description}</p>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {resolved && (
            // The screen-reader-visible label for the ✓ marker above.
            <Badge className="bg-green-100 text-green-900 hover:bg-green-100 dark:bg-green-950/40 dark:text-green-200">
              Auto-resolved by agent
            </Badge>
          )}
          {item.reviewer && <span className="text-muted-foreground">Raised by {item.reviewer}</span>}
          {item.targetSection && (
            <span className="text-muted-foreground">· Section: {item.targetSection}</span>
          )}
        </div>
        {item.suggestedAction && (
          <p className="text-xs text-muted-foreground">Suggested: {item.suggestedAction}</p>
        )}
      </div>
    </li>
  )
}

export function RevisionRoadmapChecklist({ roadmap }: Props) {
  const { mustFix, shouldFix, consider } = roadmap
  const isEmpty = mustFix.length === 0 && shouldFix.length === 0 && consider.length === 0

  return (
    <Card data-testid="revision-roadmap">
      <CardHeader>
        <CardTitle className="text-lg">Revision Roadmap</CardTitle>
        {roadmap.summary && <p className="text-sm text-muted-foreground">{roadmap.summary}</p>}
      </CardHeader>
      <CardContent className="space-y-5">
        {isEmpty && (
          <p className="text-sm text-muted-foreground">
            The revision agent reported no structured roadmap items.
          </p>
        )}

        {/* ── must_fix: red, auto-resolved, NOT tickable. ── */}
        {mustFix.length > 0 && (
          <div className="space-y-2" data-testid="roadmap-must-fix">
            <div className="flex items-center gap-2">
              <Badge className="bg-red-100 text-red-900 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-200">
                Must fix
              </Badge>
              <span className="text-xs text-muted-foreground">
                {mustFix.length} blocking item{mustFix.length === 1 ? '' : 's'} — resolved by the revision
              </span>
            </div>
            <ul className="space-y-2">
              {mustFix.map((item) => (
                <RoadmapRow key={item.id} item={item} resolved />
              ))}
            </ul>
          </div>
        )}

        {/* ── should_fix: advisory. ── */}
        {shouldFix.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Should fix</Badge>
              <span className="text-xs text-muted-foreground">advisory</span>
            </div>
            <ul className="space-y-2">
              {shouldFix.map((item) => (
                <RoadmapRow key={item.id} item={item} resolved={false} />
              ))}
            </ul>
          </div>
        )}

        {/* ── consider: advisory. ── */}
        {consider.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline">Consider</Badge>
              <span className="text-xs text-muted-foreground">optional</span>
            </div>
            <ul className="space-y-2">
              {consider.map((item) => (
                <RoadmapRow key={item.id} item={item} resolved={false} />
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
