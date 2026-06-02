'use client'

// P17.2 — AI Self-Reflection Report (Stage 6, FR-45). Four sections render here:
//   1. Execution timeline   — every pipeline stage that ran/skipped/failed (local)
//   2. Key decisions        — outline edits, any 2.5 override, coaching rounds (local)
//   3. Agent disagreements  — contested verdicts, from the process_summary_agent
//   4. Model per stage       — which model ran each completed stage (local)
//
// timeline / keyDecisions / modelPerStage are assembled locally (process-summary.ts) and
// are ALWAYS present. narrative + agentDisagreements come from the Stage-6 agent and may be
// absent — the component degrades gracefully (presentational only, no data fetching here).

import { Badge } from '@/components/ui/badge'
import type { AISelfReflection } from '@/lib/types'

// Status → text-first badge (NFR-17: every badge carries a word, not just a colour).
function StatusBadge({ status }: { status: AISelfReflection['timeline'][number]['status'] }) {
  if (status === 'completed') {
    return (
      <Badge variant="outline" className="border-green-400 text-green-700 dark:border-green-600 dark:text-green-400">
        Completed
      </Badge>
    )
  }
  if (status === 'failed') {
    return <Badge variant="destructive">Failed</Badge>
  }
  if (status === 'skipped') {
    return (
      <Badge variant="outline" className="border-amber-400 text-amber-700 dark:border-amber-600 dark:text-amber-300">
        Skipped
      </Badge>
    )
  }
  return <Badge variant="outline">Not run</Badge>
}

export function AISelfReflectionReport({ reflection }: { reflection: AISelfReflection }) {
  return (
    <section aria-labelledby="self-reflection-heading" className="space-y-5" data-testid="self-reflection-report">
      <div>
        <h2 id="self-reflection-heading" className="text-lg font-semibold">
          AI Self-Reflection Report
        </h2>
        <p className="text-sm text-muted-foreground">
          An honest account of how this paper was produced.
        </p>
      </div>

      {/* Optional reflective narrative from the process_summary_agent. */}
      {reflection.narrative && reflection.narrative.trim().length > 0 && (
        <div
          data-testid="reflection-narrative"
          className="rounded-lg border bg-muted/20 p-4 text-sm leading-relaxed whitespace-pre-wrap"
        >
          {reflection.narrative}
        </div>
      )}

      {/* 1. Execution timeline (local). */}
      <div className="space-y-2" data-testid="reflection-timeline">
        <h3 className="text-sm font-semibold">Execution timeline</h3>
        <ul className="space-y-1.5">
          {reflection.timeline.map((t, i) => (
            <li key={`${t.stage}-${i}`} className="flex items-start justify-between gap-3 rounded-md border p-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t.stage}</p>
                <p className="text-xs text-muted-foreground">
                  {t.label}
                  {t.detail ? ` · ${t.detail}` : ''}
                </p>
              </div>
              <StatusBadge status={t.status} />
            </li>
          ))}
        </ul>
      </div>

      {/* 2. Key decisions (local). */}
      <div className="space-y-2" data-testid="reflection-decisions">
        <h3 className="text-sm font-semibold">Key decisions</h3>
        <ul className="space-y-1.5">
          {reflection.keyDecisions.map((d, i) => (
            <li key={`${d.label}-${i}`} className="rounded-md border p-2.5">
              <p className="text-sm font-medium">{d.label}</p>
              <p className="text-xs text-muted-foreground">{d.detail}</p>
            </li>
          ))}
        </ul>
      </div>

      {/* 3. Agent disagreements (from the agent; may be empty). */}
      <div className="space-y-2" data-testid="reflection-disagreements">
        <h3 className="text-sm font-semibold">Logged agent disagreements</h3>
        {reflection.agentDisagreements.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No material agent disagreements were logged during this run.
          </p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {reflection.agentDisagreements.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        )}
      </div>

      {/* 4. Model per stage (local). */}
      <div className="space-y-2" data-testid="reflection-models">
        <h3 className="text-sm font-semibold">Model per stage</h3>
        <ul className="space-y-1.5">
          {reflection.modelPerStage.map((m, i) => (
            <li key={`${m.stage}-${i}`} className="flex items-center justify-between gap-3 rounded-md border p-2.5">
              <span className="text-sm">{m.stage}</span>
              <span className="text-xs font-mono text-muted-foreground">{m.model}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
