'use client'

// P17.4 — Failure-Mode Audit Log (Stage 6, FR-47 + FR-19 override surfacing). Lists ALL 7
// failure modes with: the 2.5 verdict, the 4.5 verdict, whether a bounded 2.5 override was
// applied, and the permanent override reason. Assembled ENTIRELY LOCALLY (no LLM call) from
// PaperState via process-summary.ts — so it renders even if the Stage-6 agents fail, which
// is exactly why the paper download is never held hostage to Stage 6.
//
// Downloadable as a plain-text table.

import { useCallback } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { PaperState, FailureModeAuditEntry, ModeVerdict } from '@/lib/types'
import { buildFailureModeAuditLog, serializeAuditLog } from '@/lib/process-summary'

// Verdict → text-first badge (NFR-17). null → a neutral "—".
function VerdictBadge({ verdict }: { verdict: ModeVerdict | null }) {
  if (verdict === null) {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  if (verdict === 'CLEAR') {
    return (
      <Badge variant="outline" className="border-green-400 text-green-700 dark:border-green-600 dark:text-green-400">
        Clear
      </Badge>
    )
  }
  if (verdict === 'SUSPECTED') {
    return <Badge variant="destructive">Suspected</Badge>
  }
  return (
    <Badge variant="outline" className="border-amber-400 text-amber-700 dark:border-amber-600 dark:text-amber-300">
      Insufficient
    </Badge>
  )
}

function downloadText(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function FailureModeAuditLog({ state }: { state: PaperState }) {
  const entries: FailureModeAuditEntry[] = buildFailureModeAuditLog(state)

  const handleDownload = useCallback(() => {
    const safe = state.config.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'paper'
    downloadText(serializeAuditLog(state, entries), `${safe}-failure-mode-audit.txt`)
  }, [state, entries])

  return (
    <section aria-labelledby="audit-log-heading" className="space-y-3" data-testid="failure-mode-audit-log">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="audit-log-heading" className="text-lg font-semibold">
            Failure-Mode Audit Log
          </h2>
          <p className="text-sm text-muted-foreground">
            All 7 integrity failure modes, with the verdict at each gate (assembled locally).
          </p>
        </div>
        <Button variant="outline" size="sm" data-testid="download-audit-log" onClick={handleDownload}>
          Download log
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left">
              <th className="p-2.5 font-semibold">Mode</th>
              <th className="p-2.5 font-semibold">Stage 2.5</th>
              <th className="p-2.5 font-semibold">Stage 4.5</th>
              <th className="p-2.5 font-semibold">Override</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.modeId} className="border-b last:border-0 align-top">
                <td className="p-2.5">
                  <p className="font-medium">{e.modeId}</p>
                  <p className="text-xs text-muted-foreground">{e.modeName}</p>
                </td>
                <td className="p-2.5">
                  <VerdictBadge verdict={e.verdict25} />
                </td>
                <td className="p-2.5">
                  <VerdictBadge verdict={e.verdict45} />
                </td>
                <td className="p-2.5">
                  {e.overrideApplied ? (
                    <div className="space-y-1">
                      <Badge variant="outline" className="border-amber-400 text-amber-700 dark:border-amber-600 dark:text-amber-300">
                        Override applied
                      </Badge>
                      {e.overrideReason && (
                        <p className="text-xs text-muted-foreground">{e.overrideReason}</p>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">None</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
