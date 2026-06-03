'use client'

// P18.8 — the Material Passport sidebar panel (Schema 9, DR-05/FR-49).
//
// Renders the paper's chain-of-custody at a glance: its VERIFIED / UNVERIFIED / STALE
// status (one of EXACTLY three — no 4th), the monotonic version label, the last
// integrity-pass date, and — derived from an override RECORD + an UNVERIFIED status,
// never from a status value — an "override logged" badge. Every badge carries a text
// label (NFR-17).

import type { PaperState } from '@/lib/types'
import { buildPassport } from '@/lib/schemas/schema9'

// Map the three verification states to a text label + color classes. The label text is
// always present (NFR-17) — color is decoration, not the only signal.
const STATUS_STYLE: Record<string, { label: string; cls: string; mark: string }> = {
  VERIFIED:   { label: 'VERIFIED',   cls: 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300 border-green-300', mark: '✓' },
  UNVERIFIED: { label: 'UNVERIFIED', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border-amber-300', mark: '○' },
  STALE:      { label: 'STALE',      cls: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300 border-red-300',           mark: '⚠' },
}

export function MaterialPassportPanel({ paper }: { paper: PaperState }) {
  const passport = buildPassport(paper)
  const style = STATUS_STYLE[passport.verificationStatus]

  const passDate = passport.integrityPassDate
    ? new Date(passport.integrityPassDate).toLocaleString()
    : '—'

  return (
    <section
      data-testid="material-passport"
      aria-label="Material Passport"
      className="rounded-lg border bg-muted/20 p-3 text-xs space-y-2"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold uppercase tracking-wide text-muted-foreground">Material Passport</h3>
        <span
          data-testid="passport-status"
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold ${style.cls}`}
        >
          <span aria-hidden="true">{style.mark}</span>
          {style.label}
        </span>
      </div>

      <dl className="space-y-1">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Version</dt>
          <dd className="font-mono">{passport.versionLabel}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Last integrity pass</dt>
          <dd className="text-right">{passDate}</dd>
        </div>
      </dl>

      {/* Override-logged badge — derived from an override RECORD + UNVERIFIED, never
          from a verificationStatus value (DR-05). */}
      {passport.overrideLogged && (
        <p
          data-testid="passport-override-logged"
          className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
        >
          ⚑ Override logged — a bounded integrity override was recorded for this draft.
        </p>
      )}

      {passport.verificationStatus === 'STALE' && (
        <p
          data-testid="passport-stale-banner"
          role="status"
          className="rounded border border-red-300 bg-red-50 px-2 py-1 text-red-800 dark:bg-red-950/30 dark:text-red-300"
        >
          Content changed since the last integrity pass — re-run the integrity check before peer review.
        </p>
      )}
    </section>
  )
}
