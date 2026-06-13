// P11 Schema 13 — parses the Phase-1 (PAPER-BLIND) scoring plan into a
// ScoringPlan. Same defensive contract as schema3/schema5: the reviewers end
// their reply with one fenced ```json block, extractJsonBlock() pulls it out, and
// here we VALIDATE field-by-field, collecting every problem by name and throwing
// HandoffIncompleteError('schema13', missing) if anything is missing or malformed.
//
// Mental model: this is the reviewers' "we will grade on THESE axes" contract,
// signed BEFORE they read the paper. The act of emitting a valid plan IS the
// commitment, so `committed` defaults to true once a valid plan parses.

import type { ScoringPlan, ScoringPlanDimension } from '@/lib/types'
import { extractJsonBlock } from './index'
import { HandoffIncompleteError } from './errors'

// ── small defensive guards (mirror schema3/schema5) ──

// True only for a plain object (not null, not an array).
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Is this a non-empty string? Used for the required text fields below.
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

// Parse + validate the Phase-1 scoring plan. Throws HandoffIncompleteError on any
// gap so a half-formed plan aborts rather than letting Phase 2 run blind.
export function parseSchema13(raw: string): ScoringPlan {
  const data = extractJsonBlock(raw)
  const missing: string[] = []

  if (!isObject(data)) {
    throw new HandoffIncompleteError('schema13', ['(root is not a JSON object)'])
  }

  // sprintContractId — the shared id linking this plan to its Phase-2 report.
  if (!isNonEmptyString(data.sprintContractId)) {
    missing.push('sprintContractId')
  }

  // dimensions — non-empty array; each needs dimensionId + whatToLookFor strings.
  const rawDimensions = data.dimensions
  if (!Array.isArray(rawDimensions) || rawDimensions.length < 1) {
    missing.push('dimensions')
  } else {
    rawDimensions.forEach((dim, i) => {
      const prefix = 'dimensions[' + i + ']'
      if (!isObject(dim)) {
        missing.push(prefix)
        return
      }
      const d = dim as Record<string, unknown>
      if (!isNonEmptyString(d.dimensionId)) missing.push(prefix + '.dimensionId')
      if (!isNonEmptyString(d.whatToLookFor)) missing.push(prefix + '.whatToLookFor')
      // whatTriggersBlock / whatTriggersWarn are optional — not required.
    })
  }

  if (missing.length > 0) {
    throw new HandoffIncompleteError('schema13', missing)
  }

  // Build clean, coerced dimensions. Past the guards, casts are safe. The two
  // optional trigger fields are included ONLY when present as non-empty strings.
  const dimensions: ScoringPlanDimension[] = (data.dimensions as unknown[]).map((dim) => {
    const d = dim as Record<string, unknown>
    const dimension: ScoringPlanDimension = {
      dimensionId: String(d.dimensionId),
      whatToLookFor: String(d.whatToLookFor),
    }
    if (isNonEmptyString(d.whatTriggersBlock)) {
      dimension.whatTriggersBlock = String(d.whatTriggersBlock)
    }
    if (isNonEmptyString(d.whatTriggersWarn)) {
      dimension.whatTriggersWarn = String(d.whatTriggersWarn)
    }
    return dimension
  })

  // committed defaults to true: emitting a valid plan IS the commitment. We still
  // honour an explicit `committed: false` if the agent set one (don't silently flip).
  const committed = typeof data.committed === 'boolean' ? data.committed : true

  return {
    sprintContractId: String(data.sprintContractId),
    committed,
    dimensions,
  }
}
