'use client'

// IntegrityOverride — the BOUNDED OVERRIDE control (FR-19).
//
// When the integrity gate result is BOUNDED_OVERRIDE, one or more SOFT modes
// (M2 citation / M4 shortcut / M7 frame-lock) came back INSUFFICIENT_EVIDENCE —
// the agent could not verify them, but they are not hard interlocks. The user is
// allowed to proceed anyway, but ONLY by signing a written reason that gets
// written to the permanent compliance log.
//
// EE analogy: this is the "operator override" key on a protected panel. The soft
// alarm is lit; you may turn the key and proceed, but the act of turning it is
// recorded in the maintenance log forever — you cannot quietly bypass it.
//
// This component is PRESENTATIONAL only: it collects a reason and hands it back
// to the parent via onOverride. It does NOT touch localStorage and does NOT
// decide whether an override is allowed — the parent only renders it when the
// passed-in GateDecision.kind === 'BOUNDED_OVERRIDE'.

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import type { FailureModeId } from '@/lib/types'

// ── prop type ──────────────────────────────────────────────────────────────
interface Props {
  // The soft modes (subset of M2/M4/M7) that are INSUFFICIENT and thus being
  // overridden. Comes straight from GateDecision.overrideEligibleModes.
  eligibleModes: FailureModeId[]
  // Called with the trimmed, non-empty reason when the user submits the override.
  onOverride: (reason: string) => void
}

// ── component ────────────────────────────────────────────────────────────────
export function IntegrityOverride({ eligibleModes, onOverride }: Props) {
  // The free-text override rationale. Submit is disabled until this is non-empty
  // after trimming whitespace — an override MUST have a real reason on record.
  const [reason, setReason] = useState('')

  const trimmed = reason.trim()
  const canSubmit = trimmed.length > 0

  // Guard the submit path so an empty reason can never slip through even if the
  // disabled button is bypassed (defensive — no empty catch, just an early return).
  function handleSubmit() {
    if (!canSubmit) return
    onOverride(trimmed)
  }

  return (
    <div
      data-testid="integrity-override"
      className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 p-4 space-y-3"
    >
      {/* Heading — name the modes being overridden so the choice is explicit. */}
      <div>
        <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
          Bounded override required
        </h4>
        <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
          {/* List exactly which soft modes (M2/M4/M7) are being overridden. */}
          The following soft check{eligibleModes.length !== 1 ? 's' : ''} could not
          be verified and {eligibleModes.length !== 1 ? 'are' : 'is'} being overridden:{' '}
          <span className="font-mono font-medium">{eligibleModes.join(', ')}</span>.
          These must still be resolved at the Stage 4.5 gate.
        </p>
      </div>

      {/* Permanent-log warning — make the consequence unmistakable (FR-19). */}
      <p
        role="status"
        aria-live="polite"
        className="text-xs font-medium text-amber-900 dark:text-amber-200"
      >
        Warning: your reason will be written to the permanent compliance log and
        cannot be removed.
      </p>

      {/* Reason input */}
      <div className="space-y-1.5">
        <Label htmlFor="integrity-override-reason">
          Override reason (required)
        </Label>
        <Textarea
          id="integrity-override-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Explain why it is acceptable to proceed despite the unverified soft check(s)…"
          aria-describedby="integrity-override-hint"
        />
        <p id="integrity-override-hint" className="text-xs text-muted-foreground">
          A written reason is required before you can submit the override.
        </p>
      </div>

      {/* Submit — disabled until a non-empty (trimmed) reason exists. */}
      <Button
        type="button"
        variant="destructive"
        onClick={handleSubmit}
        disabled={!canSubmit}
      >
        Submit override &amp; proceed
      </Button>
    </div>
  )
}
